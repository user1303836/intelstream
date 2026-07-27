from __future__ import annotations

import asyncio
import contextlib
import json
import secrets
import time
from collections import deque
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Literal, Protocol
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

ConnectionRole = Literal["fighter", "spectator"]


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
    max_spectators: int = 20
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
        if self.max_spectators < 0:
            raise ValueError("spectator bound must not be negative")


@dataclass(frozen=True, slots=True)
class _OutboundMessage:
    message: str | None = None
    bounded_update: bool = False
    ticket_refresh: bool = False


@dataclass(slots=True)
class PlayerConnection:
    socket: SocketLike
    outbox: asyncio.Queue[_OutboundMessage]
    pending_updates: int = 0
    slow_drop_started: bool = False
    slow_drop_task: asyncio.Task[None] | None = None
    ticket_refresh_queued: bool = False
    latest_ticket_refresh: str | None = None
    writer_task: asyncio.Task[None] | None = None


@dataclass(slots=True)
class PlayerSlot:
    identity: AuthenticatedPlayer
    rating: int
    connection: PlayerConnection | None
    grace_remaining: float
    last_sequence: int = -1
    input_times: deque[float] = field(default_factory=deque)
    reconnect_deadline: float | None = None
    pre_match_grace_event: asyncio.Event = field(default_factory=asyncio.Event)
    pre_match_grace_task: asyncio.Task[None] | None = None


@dataclass(slots=True)
class SpectatorSlot:
    identity: AuthenticatedPlayer
    connection: PlayerConnection


@dataclass(frozen=True, slots=True)
class RoomMembership:
    room: HandsRoom
    player_id: str
    role: ConnectionRole
    connection: PlayerConnection
    reconnect_ticket: str | None


@dataclass(slots=True)
class UserRoomReservation:
    room: HandsRoom
    owner: object
    established: bool = False
    connection: PlayerConnection | None = None


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
        self._spectators: dict[str, SpectatorSlot] = {}
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
        self._admission_lock = asyncio.Lock()
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
    def spectator_ids(self) -> tuple[str, ...]:
        return tuple(self._spectators)

    @property
    def member_ids(self) -> tuple[str, ...]:
        return (*self._slots, *self._spectators)

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
        reconnect_ticket_factory: Callable[[], str] | None = None,
    ) -> RoomMembership:
        if reconnect_ticket is not None and reconnect_ticket_factory is not None:
            raise ValueError("reconnect ticket and factory are mutually exclusive")
        async with self._lock:
            if identity.guild_id != self.guild_id:
                raise RoomError("invalid_guild")
            existing_fighter = self._slots.get(identity.user_id)
            existing_spectator = self._spectators.get(identity.user_id)
            if existing_fighter is not None and existing_spectator is not None:
                raise RuntimeError("Hands member has conflicting room roles")
            existing = existing_fighter or existing_spectator
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
            if (
                not final_recovery
                and existing_fighter is not None
                and existing_fighter.connection is None
                and existing_fighter.reconnect_deadline is not None
            ):
                self._refresh_grace(existing_fighter, self._clock())
                if existing_fighter.grace_remaining <= 0:
                    raise RoomError("room_closed")

            role: ConnectionRole
            if existing_fighter is not None:
                role = "fighter"
            elif existing_spectator is not None:
                role = "spectator"
            elif self._engine is None and len(self._slots) < 2:
                role = "fighter"
            else:
                role = "spectator"
                if len(self._spectators) >= self.config.max_spectators:
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
            if reconnect_ticket_factory is not None:
                reconnect_ticket = reconnect_ticket_factory()
            connection = self._new_connection(identity.user_id, role, socket)

            if role == "fighter":
                if existing_fighter is not None:
                    existing_fighter.connection = connection
                    existing_fighter.identity = identity
                    existing_fighter.grace_remaining = self.config.reconnect_grace_seconds
                    existing_fighter.reconnect_deadline = None
                    existing_fighter.pre_match_grace_event.set()
                    fighter = existing_fighter
                else:
                    fighter = PlayerSlot(
                        identity=identity,
                        rating=rating,
                        connection=connection,
                        grace_remaining=self.config.reconnect_grace_seconds,
                    )
                    self._slots[identity.user_id] = fighter
                seat = tuple(self._slots).index(identity.user_id) + 1
                welcome: dict[str, object] = {
                    "role": role,
                    "player_id": identity.user_id,
                    "seat": seat,
                    "rating": fighter.rating,
                    "players": self._public_players(),
                    "server_tick": self._engine.tick if self._engine is not None else 0,
                    "next_sequence": fighter.last_sequence + 1,
                }
            else:
                if existing_spectator is not None:
                    existing_spectator.connection = connection
                    existing_spectator.identity = identity
                else:
                    self._spectators[identity.user_id] = SpectatorSlot(identity, connection)
                welcome = {
                    "role": role,
                    "player_id": identity.user_id,
                    "players": self._public_players(),
                    "server_tick": self._engine.tick if self._engine is not None else 0,
                }

            if reconnect_ticket is not None:
                welcome["reconnect_ticket"] = reconnect_ticket
            self._enqueue(connection, self._message("welcome", **welcome))
            if (existing is not None and self._engine is not None) or role == "spectator":
                assert self._engine is not None
                self._enqueue(
                    connection,
                    encode_snapshot(
                        self._engine.snapshot(),
                        viewer_id=identity.user_id if role == "fighter" else None,
                    ),
                )
            if self._final_payload is not None:
                self._enqueue(connection, self._final_payload)
            elif (
                not final_recovery
                and role == "fighter"
                and existing_fighter is not None
                and self._engine is not None
            ):
                disconnected = [
                    current for current in self._slots.values() if current.connection is None
                ]
                if not disconnected:
                    self._enqueue_all(
                        self._message("resumed", player_id=identity.user_id),
                        bounded_update=True,
                    )
                else:
                    opponent = disconnected[0]
                    self._enqueue(
                        connection,
                        self._message(
                            "paused",
                            player_id=opponent.identity.user_id,
                            grace_ms=max(0, int(opponent.grace_remaining * 1000)),
                        ),
                    )
            elif not final_recovery and role == "spectator" and self._engine is not None:
                disconnected = [
                    current for current in self._slots.values() if current.connection is None
                ]
                if disconnected:
                    opponent = disconnected[0]
                    self._enqueue(
                        connection,
                        self._message(
                            "paused",
                            player_id=opponent.identity.user_id,
                            grace_ms=max(0, int(opponent.grace_remaining * 1000)),
                        ),
                    )
            elif not final_recovery and len(self._slots) == 1:
                self._enqueue(connection, self._message("waiting", open_seats=1))
            elif not final_recovery and self._engine is None:
                self._start_match()
                disconnected = [
                    current for current in self._slots.values() if current.connection is None
                ]
                if disconnected:
                    opponent = disconnected[0]
                    self._enqueue(
                        connection,
                        self._message(
                            "paused",
                            player_id=opponent.identity.user_id,
                            grace_ms=max(0, int(opponent.grace_remaining * 1000)),
                        ),
                    )
            return RoomMembership(
                self,
                identity.user_id,
                role,
                connection,
                reconnect_ticket,
            )

    async def refresh_ticket(
        self,
        player_id: str,
        connection: PlayerConnection,
        reconnect_ticket: str,
        refresh_id: str,
    ) -> None:
        async with self._lock:
            fighter = self._slots.get(player_id)
            spectator = self._spectators.get(player_id)
            current = fighter.connection if fighter is not None else None
            if spectator is not None:
                current = spectator.connection
            if self._closed or current is not connection:
                raise RoomError("connection_replaced")
            connection.latest_ticket_refresh = self._message(
                "ticket",
                reconnect_ticket=reconnect_ticket,
                refresh_id=refresh_id,
            )
            if not connection.ticket_refresh_queued:
                connection.ticket_refresh_queued = True
                connection.outbox.put_nowait(_OutboundMessage(ticket_refresh=True))

    def _new_connection(
        self, player_id: str, role: ConnectionRole, socket: SocketLike
    ) -> PlayerConnection:
        # Finite handshake/final bursts share this ordered queue but do not consume the
        # separately bounded allowance for recurring state updates.
        connection = PlayerConnection(socket=socket, outbox=asyncio.Queue())
        connection.writer_task = asyncio.create_task(
            self._writer(player_id, role, connection),
            name=f"hands-writer-{role}-{player_id}",
        )
        return connection

    async def _writer(
        self, player_id: str, role: ConnectionRole, connection: PlayerConnection
    ) -> None:
        try:
            while True:
                outbound = await connection.outbox.get()
                try:
                    message = outbound.message
                    if outbound.ticket_refresh:
                        message = connection.latest_ticket_refresh
                        connection.latest_ticket_refresh = None
                        connection.ticket_refresh_queued = False
                        if message is None:
                            continue
                    elif message is None:
                        return
                    await connection.socket.send_str(message)
                finally:
                    if outbound.bounded_update:
                        connection.pending_updates -= 1
                    connection.outbox.task_done()
        except (ConnectionError, RuntimeError, asyncio.CancelledError):
            if not self._closed:
                self._spawn(
                    self.disconnect(player_id, role, connection),
                    name=f"hands-disconnect-{role}-{player_id}",
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
        connection.outbox.put_nowait(
            _OutboundMessage(message=message, bounded_update=bounded_update)
        )

    def _connected_members(self) -> list[tuple[str, ConnectionRole, PlayerConnection]]:
        members: list[tuple[str, ConnectionRole, PlayerConnection]] = [
            (player_id, "fighter", slot.connection)
            for player_id, slot in self._slots.items()
            if slot.connection is not None
        ]
        members.extend(
            (player_id, "spectator", slot.connection)
            for player_id, slot in self._spectators.items()
        )
        return members

    async def _drop_slow_connection(self, connection: PlayerConnection) -> None:
        try:
            await asyncio.sleep(self.config.tick_interval_seconds)
            if connection.pending_updates < self.config.outbound_queue_size:
                connection.slow_drop_started = False
                return
            for player_id, role, current in self._connected_members():
                if current is connection:
                    await self.disconnect(player_id, role, connection)
                    return
        finally:
            if connection.slow_drop_task is asyncio.current_task():
                connection.slow_drop_task = None

    def _enqueue_all(self, message: str, *, bounded_update: bool = False) -> None:
        for _player_id, _role, connection in self._connected_members():
            self._enqueue(connection, message, bounded_update=bounded_update)

    @staticmethod
    def _refresh_grace(slot: PlayerSlot, now: float) -> None:
        if slot.reconnect_deadline is not None:
            slot.grace_remaining = max(0.0, slot.reconnect_deadline - now)

    def _start_match(self) -> None:
        players = tuple(self._slots)
        assert len(players) == 2
        now = self._clock()
        for slot in self._slots.values():
            if slot.connection is None:
                self._refresh_grace(slot, now)
            slot.pre_match_grace_event.set()
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
            spectator = self._spectators.get(player_id)
            if spectator is not None:
                if spectator.connection is not connection:
                    raise RoomError("connection_replaced")
                raise RoomError("spectator_read_only")
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
            if any(current.connection is None for current in self._slots.values()):
                slot.input_times.append(now)
                return
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

    async def disconnect(
        self, player_id: str, role: ConnectionRole, connection: PlayerConnection
    ) -> None:
        async with self._lock:
            if role == "spectator":
                spectator = self._spectators.get(player_id)
                if spectator is None or spectator.connection is not connection:
                    return
                self._spectators.pop(player_id, None)
                await self._stop_connection(connection, code=1001, reason=b"disconnected")
                return

            slot = self._slots.get(player_id)
            if slot is None or slot.connection is not connection:
                return
            slot.connection = None
            await self._stop_connection(connection, code=1001, reason=b"disconnected")
            slot.grace_remaining = self.config.reconnect_grace_seconds
            slot.reconnect_deadline = self._clock() + self.config.reconnect_grace_seconds
            if self._engine is not None:
                self._engine.clear_action_buffers()
            if self._engine is None:
                if slot.pre_match_grace_task is None or slot.pre_match_grace_task.done():
                    slot.pre_match_grace_task = self._spawn(
                        self._expire_pre_match_fighter(player_id, slot),
                        name=f"hands-waiting-grace-{player_id}",
                    )
                slot.pre_match_grace_event.set()
            elif not self._finished:
                self._enqueue_all(
                    self._message(
                        "paused",
                        player_id=player_id,
                        grace_ms=max(0, int(slot.grace_remaining * 1000)),
                    ),
                    bounded_update=True,
                )

    async def _wait_for_pre_match_change(
        self,
        event: asyncio.Event,
        delay: float,
    ) -> None:
        sleeper: asyncio.Future[None] = asyncio.ensure_future(self._sleep(delay))
        changed = asyncio.create_task(event.wait())
        try:
            completed, _pending = await asyncio.wait(
                (sleeper, changed),
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in completed:
                task.result()
        finally:
            sleeper.cancel()
            changed.cancel()
            await asyncio.gather(sleeper, changed, return_exceptions=True)

    async def _expire_pre_match_fighter(
        self,
        player_id: str,
        slot: PlayerSlot,
    ) -> None:
        current = asyncio.current_task()
        try:
            while True:
                expired = False
                async with self._lock:
                    if (
                        self._closed
                        or self._engine is not None
                        or self._slots.get(player_id) is not slot
                    ):
                        return
                    slot.pre_match_grace_event.clear()
                    delay: float | None = None
                    if slot.connection is None:
                        self._refresh_grace(slot, self._clock())
                        if slot.grace_remaining <= 0:
                            self._slots.pop(player_id, None)
                            expired = True
                        else:
                            delay = slot.grace_remaining
                if expired:
                    await self._on_finished(self)
                    return
                if delay is None:
                    await slot.pre_match_grace_event.wait()
                else:
                    await self._wait_for_pre_match_change(
                        slot.pre_match_grace_event,
                        delay,
                    )
        finally:
            if slot.pre_match_grace_task is current:
                slot.pre_match_grace_task = None

    async def _run_match(self) -> None:
        assert self._engine is not None
        engine = self._engine
        next_tick = self._clock()
        try:
            while not self._closed and engine.result is None:
                now = self._clock()
                disconnected = [slot for slot in self._slots.values() if slot.connection is None]
                if disconnected:
                    for slot in disconnected:
                        self._refresh_grace(slot, now)
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
        if self._spectators:
            message = encode_snapshot(snapshot, viewer_id=None)
            for spectator in self._spectators.values():
                self._enqueue(
                    spectator.connection,
                    message,
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
        connections = [connection for _player_id, _role, connection in self._connected_members()]
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
        connection.latest_ticket_refresh = None
        connection.ticket_refresh_queued = False
        connection.outbox.put_nowait(_OutboundMessage())
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
                connection for _player_id, _role, connection in self._connected_members()
            ]
            for slot in self._slots.values():
                slot.connection = None
            self._spectators.clear()
        for connection in connections:
            await self._stop_connection(connection, code=code, reason=reason)
        tick_task = self._tick_task
        if tick_task is not None and tick_task is not asyncio.current_task():
            tick_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await tick_task
        background = [task for task in self._background_tasks if task is not asyncio.current_task()]
        for task in background:
            task.cancel()
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
        reconnect_ticket_factory: Callable[[], str] | None = None,
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
            async with room._admission_lock:
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
                        reconnect_ticket_factory=reconnect_ticket_factory,
                    )
                    reservation.established = True
                    reservation.connection = membership.connection
        except BaseException:
            async with self._lock:
                current = self._user_rooms.get(player.user_id)
                if current is reservation and reservation.owner is owner:
                    if not reservation.established:
                        self._user_rooms.pop(player.user_id, None)
                    if not room.member_ids and self._rooms.get(player.instance_id) is room:
                        self._rooms.pop(player.instance_id, None)
            raise
        return membership

    async def _room_finished(self, room: HandsRoom) -> None:
        async with self._lock:
            active_member_ids = set(room.member_ids)
            if not room.finished and room.player_ids:
                for player_id, reservation in list(self._user_rooms.items()):
                    if reservation.room is room and player_id not in active_member_ids:
                        self._user_rooms.pop(player_id, None)
                return
            for player_id, reservation in list(self._user_rooms.items()):
                if reservation.room is room:
                    self._user_rooms.pop(player_id, None)
            if self._rooms.get(room.instance_id) is room:
                self._rooms.pop(room.instance_id, None)

    async def leave(self, membership: RoomMembership) -> None:
        await membership.room.disconnect(
            membership.player_id,
            membership.role,
            membership.connection,
        )
        if membership.role == "spectator" or (
            not membership.room.started and membership.player_id not in membership.room.player_ids
        ):
            async with self._lock:
                reservation = self._user_rooms.get(membership.player_id)
                if (
                    reservation is not None
                    and reservation.room is membership.room
                    and reservation.connection is membership.connection
                ):
                    self._user_rooms.pop(membership.player_id, None)
                if (
                    not membership.room.member_ids
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
