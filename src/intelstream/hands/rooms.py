from __future__ import annotations

import asyncio
import contextlib
import json
import secrets
import time
from collections import deque
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Protocol
from uuid import uuid4

import structlog

from intelstream.hands.engine import BoxingEngine, EngineConfig
from intelstream.hands.protocol import (
    PROTOCOL_VERSION,
    ProtocolError,
    encode_snapshot,
    parse_client_input,
)

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable, Coroutine
    from typing import Any

    from intelstream.database.models import HandsMatch
    from intelstream.database.repository import Repository
    from intelstream.hands.auth import AuthenticatedPlayer
    from intelstream.hands.types import MatchResult

logger = structlog.get_logger(__name__)


class SocketLike(Protocol):
    @property
    def closed(self) -> bool: ...

    async def send_str(self, data: str) -> object: ...

    async def close(self, *, code: int = 1000, message: bytes = b"") -> object: ...


class RoomError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True, slots=True)
class RoomConfig:
    tick_interval_seconds: float = 1 / 30
    broadcast_every_ticks: int = 2
    reconnect_grace_seconds: float = 20.0
    result_hold_seconds: float = 10.0
    final_delivery_timeout_seconds: float = 1.0
    max_catch_up_ticks: int = 4
    max_inputs_per_second: int = 60
    outbound_queue_size: int = 16
    engine_config: EngineConfig = field(default_factory=EngineConfig)

    def __post_init__(self) -> None:
        if self.tick_interval_seconds <= 0:
            raise ValueError("tick interval must be positive")
        if (
            min(
                self.broadcast_every_ticks,
                self.max_catch_up_ticks,
                self.max_inputs_per_second,
                self.outbound_queue_size,
            )
            < 1
        ):
            raise ValueError("room bounds must be positive")
        if (
            self.reconnect_grace_seconds <= 0
            or self.result_hold_seconds < 0
            or self.final_delivery_timeout_seconds <= 0
        ):
            raise ValueError("room durations are invalid")


@dataclass(slots=True)
class PlayerConnection:
    socket: SocketLike
    outbox: asyncio.Queue[tuple[str | None, bool]]
    pending_updates: int = 0
    slow_drop_started: bool = False
    slow_drop_task: asyncio.Task[None] | None = None
    writer_task: asyncio.Task[None] | None = None


@dataclass(slots=True)
class PlayerSlot:
    identity: AuthenticatedPlayer
    rating: int
    connection: PlayerConnection | None
    grace_remaining: float
    last_sequence: int = -1
    input_times: deque[float] = field(default_factory=deque)


@dataclass(frozen=True, slots=True)
class RoomMembership:
    room: HandsRoom
    player_id: str
    connection: PlayerConnection


@dataclass(slots=True)
class UserRoomReservation:
    room: HandsRoom
    owner: object
    established: bool = False


class HandsRoom:
    def __init__(
        self,
        *,
        instance_id: str,
        guild_id: str,
        repository: Repository,
        config: RoomConfig,
        monotonic_clock: Callable[[], float],
        sleep: Callable[[float], Awaitable[None]],
        on_finished: Callable[[HandsRoom], Awaitable[None]],
        match_id_factory: Callable[[], str],
        seed_factory: Callable[[], int],
    ) -> None:
        self.instance_id = instance_id
        self.guild_id = guild_id
        self.repository = repository
        self.config = config
        self._clock = monotonic_clock
        self._sleep = sleep
        self._on_finished = on_finished
        self._match_id_factory = match_id_factory
        self._seed_factory = seed_factory
        self._slots: dict[str, PlayerSlot] = {}
        self._engine: BoxingEngine | None = None
        self._tick_task: asyncio.Task[None] | None = None
        self._persistence_task: asyncio.Task[HandsMatch] | None = None
        self._finish_task: asyncio.Task[None] | None = None
        self._cleanup_task: asyncio.Task[None] | None = None
        self._closed = False
        self._finished = False
        self._accepting_reconnects = True
        self._final_payload: str | None = None
        self._lock = asyncio.Lock()
        self._background_tasks: set[asyncio.Task[None]] = set()

    @property
    def engine(self) -> BoxingEngine | None:
        return self._engine

    @property
    def started(self) -> bool:
        return self._engine is not None

    @property
    def player_ids(self) -> tuple[str, ...]:
        return tuple(self._slots)

    @property
    def finished(self) -> bool:
        return self._finished

    async def add(
        self,
        identity: AuthenticatedPlayer,
        socket: SocketLike,
        rating: int,
        *,
        reconnect_ticket: str | None = None,
    ) -> RoomMembership:
        async with self._lock:
            if identity.guild_id != self.guild_id:
                raise RoomError("invalid_guild")
            existing = self._slots.get(identity.user_id)
            final_recovery = self._engine is not None and (
                self._engine.result is not None
                or self._persistence_task is not None
                or self._finished
            )
            if self._closed or (final_recovery and not self._accepting_reconnects):
                raise RoomError("room_closed")
            if final_recovery and existing is None:
                raise RoomError("room_closed")
            if not final_recovery and (self._finished or self._persistence_task is not None):
                raise RoomError("room_closed")
            if existing is None and len(self._slots) >= 2:
                raise RoomError("room_full")
            if existing is not None and existing.connection is not None:
                await self._stop_connection(existing.connection, code=4001, reason=b"replaced")
                final_recovery = self._engine is not None and (
                    self._engine.result is not None
                    or self._persistence_task is not None
                    or self._finished
                )
                if final_recovery and not self._accepting_reconnects:
                    raise RoomError("room_closed")
            connection = self._new_connection(identity.user_id, socket)
            if existing is not None:
                existing.connection = connection
                existing.identity = identity
                slot = existing
            else:
                slot = PlayerSlot(
                    identity=identity,
                    rating=rating,
                    connection=connection,
                    grace_remaining=self.config.reconnect_grace_seconds,
                )
                self._slots[identity.user_id] = slot
            seat = tuple(self._slots).index(identity.user_id) + 1
            welcome: dict[str, object] = {
                "player_id": identity.user_id,
                "seat": seat,
                "rating": slot.rating,
                "players": self._public_players(),
                "server_tick": self._engine.tick if self._engine is not None else 0,
                "next_sequence": slot.last_sequence + 1,
            }
            if reconnect_ticket is not None:
                welcome["reconnect_ticket"] = reconnect_ticket
            self._enqueue(connection, self._message("welcome", **welcome))
            if existing is not None and self._engine is not None:
                self._enqueue(
                    connection,
                    encode_snapshot(self._engine.snapshot(), viewer_id=identity.user_id),
                )
            if self._final_payload is not None:
                self._enqueue(connection, self._final_payload)
            elif (
                not final_recovery
                and existing is not None
                and self._engine is not None
                and all(current.connection is not None for current in self._slots.values())
            ):
                self._enqueue_all(
                    self._message("resumed", player_id=identity.user_id), bounded_update=True
                )
            elif not final_recovery and len(self._slots) == 1:
                self._enqueue(connection, self._message("waiting", open_seats=1))
            elif not final_recovery and self._engine is None:
                self._start_match()
            return RoomMembership(self, identity.user_id, connection)

    def _new_connection(self, player_id: str, socket: SocketLike) -> PlayerConnection:
        # Finite handshake/final bursts share this ordered queue but do not consume the
        # separately bounded allowance for recurring state updates.
        connection = PlayerConnection(socket=socket, outbox=asyncio.Queue())
        connection.writer_task = asyncio.create_task(
            self._writer(player_id, connection), name=f"hands-writer-{player_id}"
        )
        return connection

    async def _writer(self, player_id: str, connection: PlayerConnection) -> None:
        try:
            while True:
                message, bounded_update = await connection.outbox.get()
                try:
                    if message is None:
                        return
                    await connection.socket.send_str(message)
                finally:
                    if bounded_update:
                        connection.pending_updates -= 1
                    connection.outbox.task_done()
        except (ConnectionError, RuntimeError, asyncio.CancelledError):
            if not self._closed:
                self._spawn(
                    self.disconnect(player_id, connection),
                    name=f"hands-disconnect-{player_id}",
                )

    def _spawn(self, awaitable: Coroutine[Any, Any, None], *, name: str) -> asyncio.Task[None]:
        task: asyncio.Task[None] = asyncio.create_task(awaitable, name=name)
        self._background_tasks.add(task)
        task.add_done_callback(self._background_tasks.discard)
        return task

    @staticmethod
    def _message(message_type: str, **payload: object) -> str:
        return json.dumps(
            {"version": PROTOCOL_VERSION, "type": message_type, **payload},
            separators=(",", ":"),
            sort_keys=True,
        )

    def _public_players(self) -> list[dict[str, object]]:
        return [
            {
                "id": slot.identity.user_id,
                "name": slot.identity.display_name,
                "avatar": slot.identity.avatar_hash,
                "rating": slot.rating,
                "connected": slot.connection is not None,
            }
            for slot in self._slots.values()
        ]

    def _enqueue(
        self, connection: PlayerConnection, message: str, *, bounded_update: bool = False
    ) -> None:
        if bounded_update:
            if connection.pending_updates >= self.config.outbound_queue_size:
                if not connection.slow_drop_started:
                    connection.slow_drop_started = True
                    connection.slow_drop_task = self._spawn(
                        self._drop_slow_connection(connection),
                        name=f"hands-slow-drop-{self.instance_id}",
                    )
                return
            connection.pending_updates += 1
        connection.outbox.put_nowait((message, bounded_update))

    async def _drop_slow_connection(self, connection: PlayerConnection) -> None:
        try:
            await asyncio.sleep(self.config.tick_interval_seconds)
            if connection.pending_updates < self.config.outbound_queue_size:
                connection.slow_drop_started = False
                return
            for player_id, slot in self._slots.items():
                if slot.connection is connection:
                    await self.disconnect(player_id, connection)
                    return
        finally:
            if connection.slow_drop_task is asyncio.current_task():
                connection.slow_drop_task = None

    def _enqueue_all(self, message: str, *, bounded_update: bool = False) -> None:
        for slot in self._slots.values():
            if slot.connection is not None:
                self._enqueue(slot.connection, message, bounded_update=bounded_update)

    def _start_match(self) -> None:
        players = tuple(self._slots)
        assert len(players) == 2
        self._engine = BoxingEngine(
            match_id=self._match_id_factory(),
            activity_instance_id=self.instance_id,
            guild_id=self.guild_id,
            player_one_id=players[0],
            player_two_id=players[1],
            seed=self._seed_factory(),
            config=self.config.engine_config,
        )
        self._enqueue_all(self._message("ready", players=self._public_players()))
        self._tick_task = asyncio.create_task(
            self._run_match(), name=f"hands-match-{self._engine.match_id}"
        )

    async def submit_frame(
        self, player_id: str, connection: PlayerConnection, frame: str | bytes
    ) -> None:
        async with self._lock:
            if (
                self._closed
                or self._finished
                or self._persistence_task is not None
                or (self._engine is not None and self._engine.result is not None)
            ):
                raise RoomError("match_complete")
            slot = self._slots.get(player_id)
            if slot is None or slot.connection is not connection:
                raise RoomError("connection_replaced")
            engine = self._engine
            if engine is None:
                raise RoomError("match_not_started")
            now = self._clock()
            while slot.input_times and slot.input_times[0] <= now - 1.0:
                slot.input_times.popleft()
            if len(slot.input_times) >= self.config.max_inputs_per_second:
                raise RoomError("rate_limited")
            try:
                command = parse_client_input(
                    frame,
                    last_sequence=slot.last_sequence,
                    server_tick=engine.tick,
                )
            except ProtocolError as exc:
                raise RoomError("invalid_input") from exc
            slot.input_times.append(now)
            slot.last_sequence = command.sequence
            if not engine.submit_input(player_id, command):
                raise RoomError("input_queue_full")

    async def disconnect(self, player_id: str, connection: PlayerConnection) -> None:
        pre_match_abandonment = False
        async with self._lock:
            slot = self._slots.get(player_id)
            if slot is None or slot.connection is not connection:
                return
            slot.connection = None
            await self._stop_connection(connection, code=1001, reason=b"disconnected")
            if self._engine is None:
                self._slots.pop(player_id, None)
                pre_match_abandonment = True
            elif not self._finished:
                self._enqueue_all(
                    self._message(
                        "paused",
                        player_id=player_id,
                        grace_ms=max(0, int(slot.grace_remaining * 1000)),
                    ),
                    bounded_update=True,
                )
        if pre_match_abandonment:
            await self._on_finished(self)

    async def _run_match(self) -> None:
        assert self._engine is not None
        engine = self._engine
        next_tick = self._clock()
        last_clock = next_tick
        try:
            while not self._closed and engine.result is None:
                now = self._clock()
                elapsed = max(0.0, now - last_clock)
                last_clock = now
                disconnected = [slot for slot in self._slots.values() if slot.connection is None]
                if disconnected:
                    for slot in disconnected:
                        slot.grace_remaining -= elapsed
                    expired = [slot for slot in disconnected if slot.grace_remaining <= 0]
                    if expired and len(disconnected) == len(self._slots):
                        self._ensure_abandon_task()
                        break
                    if expired:
                        expired_id = expired[0].identity.user_id
                        winner = next(
                            player_id for player_id in self._slots if player_id != expired_id
                        )
                        engine.complete_forfeit(winner)
                        self._ensure_finish_task(engine.result)
                        break
                    next_tick = now + self.config.tick_interval_seconds
                    await self._sleep(min(self.config.tick_interval_seconds, 0.05))
                    continue

                interval = self.config.tick_interval_seconds
                ticks_due = max(1, int((now - next_tick) / interval) + 1)
                if ticks_due > self.config.max_catch_up_ticks:
                    ticks_due = self.config.max_catch_up_ticks
                    next_tick = now - (ticks_due - 1) * interval
                for _ in range(ticks_due):
                    snapshot = engine.step()
                    next_tick += interval
                    if (
                        snapshot.events
                        or snapshot.result is not None
                        or snapshot.tick % self.config.broadcast_every_ticks == 0
                    ):
                        self._broadcast_snapshot(snapshot)
                    if snapshot.result is not None:
                        self._ensure_finish_task(snapshot.result)
                        break
                if engine.result is None:
                    await self._sleep(max(0.0, next_tick - self._clock()))

            finish_task = self._finish_task
            if finish_task is not None and finish_task is not asyncio.current_task():
                await asyncio.shield(finish_task)
        except asyncio.CancelledError:
            raise

    def _broadcast_snapshot(self, snapshot: object) -> None:
        from intelstream.hands.types import EngineSnapshot

        assert isinstance(snapshot, EngineSnapshot)
        for player_id, slot in self._slots.items():
            if slot.connection is not None:
                self._enqueue(
                    slot.connection,
                    encode_snapshot(snapshot, viewer_id=player_id),
                    bounded_update=True,
                )

    def _ensure_finish_task(self, result: MatchResult | None) -> asyncio.Task[None] | None:
        if result is None:
            return None
        if self._persistence_task is None:
            self._persistence_task = asyncio.create_task(
                self.repository.record_hands_match(result),
                name=f"hands-persist-{result.match_id}",
            )
        if self._finish_task is None:
            self._finish_task = asyncio.create_task(
                self._finish_result(result), name=f"hands-finish-{result.match_id}"
            )
        return self._finish_task

    def _ensure_abandon_task(self) -> None:
        if self._finish_task is None:
            self._finish_task = asyncio.create_task(
                self._finish_abandoned(), name=f"hands-abandon-{self.instance_id}"
            )

    async def _finish_abandoned(self) -> None:
        self._finished = True
        self._enqueue_all(self._message("error", code="match_abandoned"))
        await self._drain_outboxes()
        await self._close_now(code=1001, reason=b"match abandoned")
        await self._on_finished(self)

    async def _finish_result(self, result: MatchResult) -> None:
        assert self._persistence_task is not None
        try:
            match = await asyncio.shield(self._persistence_task)
        except Exception as exc:
            async with self._lock:
                self._finished = True
                self._accepting_reconnects = False
                self._enqueue_all(self._message("error", code="persistence_failed"))
            logger.error(
                "Hands match persistence failed",
                match_id=result.match_id,
                error_type=type(exc).__name__,
            )
            await self._drain_outboxes()
            await self._close_now(code=1011, reason=b"persistence failed")
            await self._on_finished(self)
            return
        final_payload = self._final_message(match, result)
        async with self._lock:
            self._finished = True
            self._final_payload = final_payload
            self._enqueue_all(final_payload)
        await self._drain_outboxes()
        if self.config.result_hold_seconds:
            await self._sleep(self.config.result_hold_seconds)
        async with self._lock:
            self._accepting_reconnects = False
        await self._drain_outboxes()
        await self._close_now(code=1000, reason=b"match complete")
        await self._on_finished(self)

    async def _drain_outboxes(self) -> None:
        connections = [
            slot.connection for slot in self._slots.values() if slot.connection is not None
        ]
        if not connections:
            return
        try:
            async with asyncio.timeout(self.config.final_delivery_timeout_seconds):
                await asyncio.gather(*(connection.outbox.join() for connection in connections))
        except TimeoutError:
            logger.warning("Hands final delivery timed out", instance_id=self.instance_id)

    def _final_message(self, match: HandsMatch, result: MatchResult) -> str:
        return self._message(
            "final",
            match_id=result.match_id,
            winner_id=result.winner_id,
            method=result.finish_method.value,
            round=result.round_number,
            scorecards=[
                {
                    "judge": card.judge,
                    "player_one": list(card.player_one),
                    "player_two": list(card.player_two),
                }
                for card in result.scorecards
            ],
            ratings={
                result.player_one_id: {
                    "before": match.player_one_rating_before,
                    "after": match.player_one_rating_after,
                },
                result.player_two_id: {
                    "before": match.player_two_rating_before,
                    "after": match.player_two_rating_after,
                },
            },
        )

    async def _stop_connection(
        self, connection: PlayerConnection, *, code: int, reason: bytes
    ) -> None:
        current = asyncio.current_task()
        slow_drop_task = connection.slow_drop_task
        connection.slow_drop_task = None
        if slow_drop_task is not None and slow_drop_task is not current:
            slow_drop_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await slow_drop_task
        connection.outbox.put_nowait((None, False))
        writer_task = connection.writer_task
        if writer_task is not None and writer_task is not current:
            writer_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await writer_task
        if not connection.socket.closed:
            with contextlib.suppress(ConnectionError, RuntimeError):
                await connection.socket.close(code=code, message=reason[:120])

    async def _close_now(self, *, code: int, reason: bytes) -> None:
        async with self._lock:
            if self._closed:
                return
            self._closed = True
            self._accepting_reconnects = False
            connections = [
                slot.connection for slot in self._slots.values() if slot.connection is not None
            ]
            for slot in self._slots.values():
                slot.connection = None
        for connection in connections:
            await self._stop_connection(connection, code=code, reason=reason)
        tick_task = self._tick_task
        if tick_task is not None and tick_task is not asyncio.current_task():
            tick_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await tick_task
        background = [task for task in self._background_tasks if task is not asyncio.current_task()]
        if background:
            await asyncio.gather(*background, return_exceptions=True)

    async def close(self) -> None:
        engine = self._engine
        finish_task = self._ensure_finish_task(engine.result) if engine is not None else None
        current = asyncio.current_task()
        if finish_task is not None and finish_task is not current:
            await asyncio.shield(finish_task)
            return
        if self._cleanup_task is None:
            self._cleanup_task = asyncio.create_task(
                self._close_now(code=1001, reason=b"server shutdown"),
                name=f"hands-room-close-{self.instance_id}",
            )
        if self._cleanup_task is not current:
            await asyncio.shield(self._cleanup_task)


class HandsRoomManager:
    def __init__(
        self,
        repository: Repository,
        *,
        config: RoomConfig | None = None,
        monotonic_clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        match_id_factory: Callable[[], str] = lambda: str(uuid4()),
        seed_factory: Callable[[], int] = lambda: secrets.randbits(63),
    ) -> None:
        self.repository = repository
        self.config = config or RoomConfig()
        self._clock = monotonic_clock
        self._sleep = sleep
        self._match_id_factory = match_id_factory
        self._seed_factory = seed_factory
        self._rooms: dict[str, HandsRoom] = {}
        self._user_rooms: dict[str, UserRoomReservation] = {}
        self._lock = asyncio.Lock()
        self._closed = False

    @property
    def room_count(self) -> int:
        return len(self._rooms)

    async def join(
        self,
        player: AuthenticatedPlayer,
        socket: SocketLike,
        *,
        reconnect_ticket: str | None = None,
    ) -> RoomMembership:
        owner = object()
        async with self._lock:
            if self._closed:
                raise RoomError("server_shutting_down")
            reservation = self._user_rooms.get(player.user_id)
            if reservation is not None and reservation.room.instance_id != player.instance_id:
                raise RoomError("already_in_room")
            room = self._rooms.get(player.instance_id)
            if room is None:
                room = HandsRoom(
                    instance_id=player.instance_id,
                    guild_id=player.guild_id,
                    repository=self.repository,
                    config=self.config,
                    monotonic_clock=self._clock,
                    sleep=self._sleep,
                    on_finished=self._room_finished,
                    match_id_factory=self._match_id_factory,
                    seed_factory=self._seed_factory,
                )
                self._rooms[player.instance_id] = room
            if reservation is None:
                reservation = UserRoomReservation(room=room, owner=owner)
                self._user_rooms[player.user_id] = reservation
            else:
                reservation.owner = owner
        try:
            rating = await self.repository.get_or_create_hands_rating(
                player.guild_id, player.user_id
            )
            async with self._lock:
                valid = (
                    not self._closed
                    and self._rooms.get(player.instance_id) is room
                    and self._user_rooms.get(player.user_id) is reservation
                    and reservation.owner is owner
                )
                if not valid:
                    rejection = "server_shutting_down" if self._closed else "room_closed"
                    raise RoomError(rejection)
                membership = await room.add(
                    player,
                    socket,
                    rating.rating,
                    reconnect_ticket=reconnect_ticket,
                )
                reservation.established = True
        except BaseException:
            async with self._lock:
                current = self._user_rooms.get(player.user_id)
                if current is reservation and reservation.owner is owner:
                    if not reservation.established:
                        self._user_rooms.pop(player.user_id, None)
                    if not room.player_ids and self._rooms.get(player.instance_id) is room:
                        self._rooms.pop(player.instance_id, None)
            raise
        return membership

    async def _room_finished(self, room: HandsRoom) -> None:
        async with self._lock:
            active_player_ids = set(room.player_ids)
            if not room.finished and active_player_ids:
                for player_id, reservation in list(self._user_rooms.items()):
                    if reservation.room is room and player_id not in active_player_ids:
                        self._user_rooms.pop(player_id, None)
                return
            for player_id, reservation in list(self._user_rooms.items()):
                if reservation.room is room:
                    self._user_rooms.pop(player_id, None)
            if self._rooms.get(room.instance_id) is room:
                self._rooms.pop(room.instance_id, None)

    async def leave(self, membership: RoomMembership) -> None:
        await membership.room.disconnect(membership.player_id, membership.connection)
        if not membership.room.started:
            async with self._lock:
                reservation = self._user_rooms.get(membership.player_id)
                if reservation is not None and reservation.room is membership.room:
                    self._user_rooms.pop(membership.player_id, None)
                if (
                    not membership.room.player_ids
                    and self._rooms.get(membership.room.instance_id) is membership.room
                ):
                    self._rooms.pop(membership.room.instance_id, None)

    async def close(self) -> None:
        async with self._lock:
            if self._closed:
                return
            self._closed = True
            rooms = list(self._rooms.values())
            self._rooms.clear()
            self._user_rooms.clear()
        results = await asyncio.gather(*(room.close() for room in rooms), return_exceptions=True)
        first_error = next(
            (result for result in results if isinstance(result, BaseException)), None
        )
        if first_error is not None:
            raise first_error
