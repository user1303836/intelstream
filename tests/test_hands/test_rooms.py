from __future__ import annotations

import asyncio
import json
from dataclasses import asdict, dataclass, field, replace
from unittest.mock import AsyncMock, MagicMock

import pytest

from intelstream.database.repository import Repository
from intelstream.hands import rooms as rooms_module
from intelstream.hands.auth import AuthenticatedPlayer
from intelstream.hands.cpu import CPU_STYLES, PROFILES, CpuBrain, CpuLevel, cpu_style
from intelstream.hands.engine import BoxingEngine, EngineConfig, PunchCount
from intelstream.hands.protocol import StyleChoice, encode_client_input
from intelstream.hands.rooms import (
    CPU_RECORDS,
    SNAPSHOT_BACKLOG_BYTES,
    HandsRoom,
    HandsRoomManager,
    RoomConfig,
    RoomError,
    RoomMembership,
)
from intelstream.hands.types import (
    ActionKind,
    CombatEvent,
    DefensivePose,
    EngineSnapshot,
    FighterStyle,
    Hand,
    InputCommand,
    MovementAction,
    PunchAction,
    PunchClass,
    Target,
)


@dataclass
class FakeSocket:
    messages: list[str] = field(default_factory=list)
    closed: bool = False
    close_code: int | None = None
    aborted: bool = False
    uncompressed: list[str] = field(default_factory=list)
    buffered: int = 0
    block_send: asyncio.Event | None = None
    block_close: asyncio.Event | None = None
    close_entered: asyncio.Event | None = None
    timeline: list[str] | None = None

    async def send_str(self, data: str) -> None:
        if self.block_send is not None:
            await self.block_send.wait()
        if self.closed:
            raise ConnectionError
        self.messages.append(data)
        if self.timeline is not None:
            self.timeline.append(f"send:{json.loads(data)['type']}")

    async def send_uncompressed(self, data: str) -> None:
        await self.send_str(data)
        self.uncompressed.append(json.loads(data)["type"])

    def write_buffer_size(self) -> int:
        return self.buffered

    async def close(self, *, code: int = 1000, message: bytes = b"") -> None:
        _ = message
        if self.close_entered is not None:
            self.close_entered.set()
        if self.block_close is not None:
            await self.block_close.wait()
        self.closed = True
        self.close_code = code
        if self.timeline is not None:
            self.timeline.append("close")

    def abort(self) -> None:
        self.closed = True
        self.aborted = True


@dataclass
class StalledSocket(FakeSocket):
    """A socket whose peer stopped reading, modelled on aiohttp's flow control.

    Once the transport pauses, every write parks on one shared drain waiter, and close() drains
    through the same waiter. Cancelling a writer parked there cancels the waiter itself.
    """

    paused: bool = True
    drain_waiter: asyncio.Future[None] | None = None

    async def _drain(self) -> None:
        if not self.paused:
            return
        if self.drain_waiter is None:
            self.drain_waiter = asyncio.get_running_loop().create_future()
        await self.drain_waiter

    async def send_str(self, data: str) -> None:
        if self.closed:
            raise ConnectionError
        self.messages.append(data)
        await self._drain()

    async def close(self, *, code: int = 1000, message: bytes = b"") -> None:
        _ = message
        if self.closed:
            return
        self.closed = True
        self.close_code = code
        await self._drain()


@pytest.fixture
async def repository() -> Repository:
    repo = Repository("sqlite+aiosqlite:///:memory:")
    await repo.initialize()
    yield repo
    await repo.close()


def player(user_id: str, instance: str = "instance-1") -> AuthenticatedPlayer:
    return AuthenticatedPlayer(user_id, "guild-1", instance, f"Fighter {user_id}", None)


def room_config(
    *,
    tick_interval: float = 0.005,
    round_ticks: int = 2,
    reconnect_grace: float = 0.03,
    result_hold: float = 0.0,
    outbound_size: int = 16,
    final_delivery_timeout: float = 1.0,
    close_timeout: float = 1.0,
    max_catch_up_ticks: int = 2,
    max_spectators: int = 20,
    style_select: float = 0.0,
    rematch_seat: float = 60.0,
) -> RoomConfig:
    return RoomConfig(
        style_select_seconds=style_select,
        rematch_seat_seconds=rematch_seat,
        tick_interval_seconds=tick_interval,
        broadcast_every_ticks=1,
        reconnect_grace_seconds=reconnect_grace,
        result_hold_seconds=result_hold,
        final_delivery_timeout_seconds=final_delivery_timeout,
        close_timeout_seconds=close_timeout,
        max_catch_up_ticks=max_catch_up_ticks,
        max_inputs_per_second=5,
        max_input_frames_per_second=8,
        outbound_queue_size=outbound_size,
        max_spectators=max_spectators,
        engine_config=EngineConfig(
            rounds=1,
            round_ticks=round_ticks,
            rest_ticks=0,
            countdown_ticks=1,
            flash_ko_enabled=False,
        ),
    )


def test_room_config_allows_no_spectators_but_rejects_negative_bound() -> None:
    assert RoomConfig(max_spectators=0).max_spectators == 0
    with pytest.raises(ValueError, match="spectator bound"):
        RoomConfig(max_spectators=-1)


async def wait_until(predicate, *, deadline_seconds: float = 1.0) -> None:
    async with asyncio.timeout(deadline_seconds):
        while not predicate():  # noqa: ASYNC110
            await asyncio.sleep(0.002)


def message_types(socket: FakeSocket) -> list[str]:
    return [json.loads(message)["type"] for message in socket.messages]


async def test_first_waits_second_starts_and_natural_result_persists_once(
    repository: Repository,
) -> None:
    manager = HandsRoomManager(
        repository,
        config=room_config(),
        match_id_factory=lambda: "match-natural",
        seed_factory=lambda: 7,
    )
    first = FakeSocket()
    second = FakeSocket()
    one = await manager.join(player("one"), first)
    assert one.room.engine is None
    await wait_until(lambda: "waiting" in message_types(first))

    two = await manager.join(player("two"), second)
    assert one.room is two.room
    assert one.room.engine is not None
    await wait_until(lambda: any(kind == "final" for kind in message_types(first)))

    stored = await repository.get_hands_match("match-natural")
    assert stored is not None
    assert stored.finish_method == "draw"
    rating_one = await repository.get_hands_rating("guild-1", "one")
    rating_two = await repository.get_hands_rating("guild-1", "two")
    assert rating_one is not None and rating_two is not None
    assert rating_one.bouts == rating_two.bouts == 1
    assert manager.room_count == 0
    await manager.close()


async def test_repeated_action_spam_is_bounded_without_dropping_connection(
    repository: Repository,
) -> None:
    sleep_release = asyncio.Event()

    async def controlled_sleep(_delay: float) -> None:
        await sleep_release.wait()

    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=1000),
        sleep=controlled_sleep,
        match_id_factory=lambda: "match-key-spam",
    )
    first = await manager.join(player("one"), FakeSocket())
    await manager.join(player("two"), FakeSocket())
    engine = first.room.engine
    assert engine is not None
    repeated = tuple(MovementAction(ActionKind.SWITCH_STANCE) for _ in range(4))

    for sequence in range(3):
        await first.room.submit_frame(
            "one",
            first.connection,
            encode_client_input(
                InputCommand(
                    sequence=sequence,
                    client_tick=engine.tick,
                    actions=repeated,
                )
            ),
        )

    assert first.connection.socket.closed is False
    assert engine.fighter("one").last_sequence == 2
    assert len(engine.fighter("one").pending_actions) == 1
    await manager.close()


async def test_third_user_spectates_without_fighter_authority_and_cap_is_bounded(
    repository: Repository,
) -> None:
    sleep_release = asyncio.Event()

    async def controlled_sleep(_delay: float) -> None:
        await sleep_release.wait()

    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=1000, max_spectators=1),
        sleep=controlled_sleep,
        match_id_factory=lambda: "match-live",
    )
    first_socket = FakeSocket()
    second_socket = FakeSocket()
    first = await manager.join(player("one"), first_socket)
    await manager.join(player("two"), second_socket)
    spectator_socket = FakeSocket()
    spectator = await manager.join(player("three"), spectator_socket)
    await wait_until(lambda: "snapshot" in message_types(spectator_socket))

    assert first.role == "fighter"
    assert spectator.role == "spectator"
    assert spectator.room.player_ids == ("one", "two")
    assert spectator.room.spectator_ids == ("three",)
    welcome = json.loads(spectator_socket.messages[0])
    assert welcome["role"] == "spectator"
    assert welcome["player_id"] == "three"
    assert [current["id"] for current in welcome["players"]] == ["one", "two"]
    assert "seat" not in welcome
    assert "rating" not in welcome
    assert "next_sequence" not in welcome

    engine = spectator.room.engine
    assert engine is not None
    checksum = engine.snapshot().checksum
    with pytest.raises(RoomError, match="spectator_read_only"):
        await spectator.room.submit_frame("three", spectator.connection, "{}")
    assert engine.snapshot().checksum == checksum

    with pytest.raises(RoomError, match="room_full"):
        await manager.join(player("four"), FakeSocket())
    with pytest.raises(RoomError, match="already_in_room"):
        await manager.join(player("one", "other-instance"), FakeSocket())

    paused_before = message_types(first_socket).count("paused")
    await manager.leave(spectator)
    assert spectator.room.spectator_ids == ()
    assert message_types(first_socket).count("paused") == paused_before
    assert first_socket.closed is False
    assert second_socket.closed is False
    await manager.close()


async def test_spectator_receives_final_without_rating_or_result_authority(
    repository: Repository,
) -> None:
    sleep_release = asyncio.Event()

    async def controlled_sleep(_delay: float) -> None:
        await sleep_release.wait()

    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=2),
        sleep=controlled_sleep,
        match_id_factory=lambda: "match-spectated",
        seed_factory=lambda: 11,
    )
    await manager.join(player("one"), FakeSocket())
    await manager.join(player("two"), FakeSocket())
    spectator_socket = FakeSocket()
    spectator = await manager.join(player("three"), spectator_socket)
    await wait_until(lambda: "snapshot" in message_types(spectator_socket))

    sleep_release.set()
    await wait_until(lambda: "final" in message_types(spectator_socket))

    match = await repository.get_hands_match("match-spectated")
    assert match is not None
    assert {match.player_one_id, match.player_two_id} == {"one", "two"}
    spectator_rating = await repository.get_hands_rating("guild-1", "three")
    assert spectator_rating is not None
    assert spectator_rating.bouts == 0
    final = next(
        json.loads(message)
        for message in spectator_socket.messages
        if json.loads(message)["type"] == "final"
    )
    assert set(final["ratings"]) == {"one", "two"}
    assert spectator.player_id not in final["ratings"]
    await manager.close()


async def test_same_spectator_reconnect_replaces_connection_without_promotion(
    repository: Repository,
) -> None:
    sleep_release = asyncio.Event()

    async def controlled_sleep(_delay: float) -> None:
        await sleep_release.wait()

    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=1000, max_spectators=1),
        sleep=controlled_sleep,
        match_id_factory=lambda: "match-spectator-reconnect",
    )
    await manager.join(player("one"), FakeSocket())
    await manager.join(player("two"), FakeSocket())
    old_socket = FakeSocket()
    old = await manager.join(player("three"), old_socket)
    new_socket = FakeSocket()

    replacement = await manager.join(player("three"), new_socket)
    await wait_until(lambda: "snapshot" in message_types(new_socket))
    await wait_until(lambda: old_socket.closed)

    assert old.role == replacement.role == "spectator"
    assert old_socket.close_code == 4001
    assert replacement.room.player_ids == ("one", "two")
    assert replacement.room.spectator_ids == ("three",)
    assert json.loads(new_socket.messages[0])["role"] == "spectator"

    await manager.leave(old)
    with pytest.raises(RoomError, match="already_in_room"):
        await manager.join(player("three", "other-instance"), FakeSocket())
    assert replacement.room.spectator_ids == ("three",)
    assert new_socket.closed is False
    await manager.close()


async def test_same_user_reconnect_replaces_connection_and_resumes(repository: Repository) -> None:
    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=1000),
        match_id_factory=lambda: "match-reconnect",
    )
    old_socket = FakeSocket()
    opponent_socket = FakeSocket()
    old = await manager.join(player("one"), old_socket)
    await manager.join(player("two"), opponent_socket)
    await manager.leave(old)
    assert old_socket.closed
    await wait_until(lambda: "paused" in message_types(opponent_socket))

    new_socket = FakeSocket()
    replacement = await manager.join(player("one"), new_socket)
    assert replacement.room is old.room
    await wait_until(lambda: "resumed" in message_types(new_socket))
    assert old_socket.close_code in {1001, 4001}
    await manager.close()


async def test_post_start_disconnect_forfeits_and_pre_match_abandonment_does_not_score(
    repository: Repository,
) -> None:
    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=1_000_000, reconnect_grace=0.015),
        match_id_factory=lambda: "match-forfeit",
    )
    first = await manager.join(player("one"), FakeSocket())
    second_socket = FakeSocket()
    await manager.join(player("two"), second_socket)
    spectator_socket = FakeSocket()
    await manager.join(player("three"), spectator_socket)
    await manager.leave(first)
    await wait_until(lambda: manager.room_count == 0)
    assert "paused" in message_types(spectator_socket)
    assert "final" in message_types(spectator_socket)

    match = await repository.get_hands_match("match-forfeit")
    assert match is not None
    assert match.finish_method == "forfeit"
    assert match.winner_id == "two"
    rating = await repository.get_hands_rating("guild-1", "two")
    assert rating is not None and rating.wins == 1
    spectator_rating = await repository.get_hands_rating("guild-1", "three")
    assert spectator_rating is not None and spectator_rating.bouts == 0

    waiting_manager = HandsRoomManager(
        repository,
        config=room_config(reconnect_grace=0.015),
    )
    waiting = await waiting_manager.join(player("waiting", "waiting-instance"), FakeSocket())
    await waiting_manager.leave(waiting)
    assert waiting.room.player_ids == ("waiting",)
    await wait_until(lambda: waiting_manager.room_count == 0)
    assert await repository.get_hands_rating("guild-1", "waiting") is not None
    waiting_rating = await repository.get_hands_rating("guild-1", "waiting")
    assert waiting_rating is not None and waiting_rating.bouts == 0
    await waiting_manager.close()


async def test_burst_past_the_input_budget_keeps_the_newest_frame(
    repository: Repository,
) -> None:
    class MutableClock:
        value = 0.0

        def __call__(self) -> float:
            return self.value

    clock = MutableClock()
    sleep_entered = asyncio.Event()
    sleep_release = asyncio.Event()

    async def controlled_sleep(_delay: float) -> None:
        sleep_entered.set()
        await sleep_release.wait()

    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=1000, reconnect_grace=30.0),
        monotonic_clock=clock,
        sleep=controlled_sleep,
        match_id_factory=lambda: "match-burst",
    )
    one = await manager.join(player("one"), FakeSocket())
    await manager.join(player("two"), FakeSocket())
    await sleep_entered.wait()
    engine = one.room.engine
    assert engine is not None

    for sequence in range(1, 6):
        await one.room.submit_frame(
            "one",
            one.connection,
            encode_client_input(
                InputCommand(sequence=sequence, client_tick=engine.tick, move_x=1000)
            ),
        )
    for sequence in range(6, 9):
        await one.room.submit_frame(
            "one",
            one.connection,
            encode_client_input(InputCommand(sequence=sequence, client_tick=engine.tick)),
        )
    assert engine.fighter("one").last_sequence == 5
    assert engine.fighter("one").held_input.move_x == 1000

    clock.value += 0.25
    one.room._apply_deferred_inputs(clock())
    assert engine.fighter("one").last_sequence == 8
    assert engine.fighter("one").held_input.move_x == 0

    one.room._apply_deferred_inputs(clock())
    assert engine.fighter("one").last_sequence == 8
    sleep_release.set()
    await manager.close()


async def test_input_protocol_rate_sequence_and_queue_bounds(repository: Repository) -> None:
    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=1000),
        match_id_factory=lambda: "match-input",
    )
    one = await manager.join(player("one"), FakeSocket())
    await manager.join(player("two"), FakeSocket())
    engine = one.room.engine
    assert engine is not None
    frame = encode_client_input(InputCommand(sequence=1, client_tick=engine.tick))
    await one.room.submit_frame("one", one.connection, frame)

    with pytest.raises(RoomError, match="invalid_input"):
        await one.room.submit_frame("one", one.connection, frame)
    with pytest.raises(RoomError, match="invalid_input"):
        await one.room.submit_frame("one", one.connection, '{"winner_id":"one"}')

    for sequence in range(2, 6):
        tick = engine.tick
        await one.room.submit_frame(
            "one",
            one.connection,
            encode_client_input(InputCommand(sequence=sequence, client_tick=tick)),
        )
    accepted = engine.fighter("one").last_sequence
    await one.room.submit_frame(
        "one",
        one.connection,
        encode_client_input(InputCommand(sequence=6, client_tick=engine.tick, move_x=1000)),
    )
    assert engine.fighter("one").last_sequence == accepted
    assert engine.fighter("one").held_input.move_x == 0
    await one.room.submit_frame(
        "one",
        one.connection,
        encode_client_input(InputCommand(sequence=7, client_tick=engine.tick)),
    )
    assert engine.fighter("one").last_sequence == accepted
    with pytest.raises(RoomError, match="rate_limited"):
        for sequence in range(8, 8 + 4 * 8):
            await one.room.submit_frame(
                "one",
                one.connection,
                encode_client_input(InputCommand(sequence=sequence, client_tick=engine.tick)),
            )
    await manager.close()


async def test_paused_room_discards_inputs_without_advancing_authority(
    repository: Repository,
) -> None:
    class MutableClock:
        value = 0.0

        def __call__(self) -> float:
            return self.value

    clock = MutableClock()
    sleep_entered = asyncio.Event()
    sleep_release = asyncio.Event()

    async def controlled_sleep(_delay: float) -> None:
        sleep_entered.set()
        await sleep_release.wait()

    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=1000, reconnect_grace=30.0),
        monotonic_clock=clock,
        sleep=controlled_sleep,
        match_id_factory=lambda: "match-paused-input",
    )
    disconnected = await manager.join(player("one"), FakeSocket())
    connected = await manager.join(player("two"), FakeSocket())
    await sleep_entered.wait()
    engine = connected.room.engine
    assert engine is not None
    await disconnected.room.submit_frame(
        "one",
        disconnected.connection,
        encode_client_input(
            InputCommand(
                sequence=0,
                client_tick=engine.tick,
                actions=(MovementAction(ActionKind.SWITCH_STANCE),),
            )
        ),
    )
    assert engine.fighter("one").pending_actions
    await manager.leave(disconnected)
    assert not engine.fighter("one").pending_actions
    checksum = engine.snapshot().checksum

    for sequence in range(8):
        await connected.room.submit_frame(
            "two",
            connected.connection,
            encode_client_input(
                InputCommand(sequence=sequence, client_tick=engine.tick, move_x=1000)
            ),
        )
    await connected.room.submit_frame(
        "two",
        connected.connection,
        encode_client_input(InputCommand(sequence=8, client_tick=engine.tick, move_x=1000)),
    )
    assert engine.snapshot().checksum == checksum
    assert engine.fighter("two").last_sequence == -1
    assert not engine.fighter("two").pending_actions
    with pytest.raises(RoomError, match="rate_limited"):
        for sequence in range(9, 9 + 4 * 8):
            await connected.room.submit_frame(
                "two",
                connected.connection,
                encode_client_input(
                    InputCommand(sequence=sequence, client_tick=engine.tick, move_x=1000)
                ),
            )
    assert engine.snapshot().checksum == checksum

    clock.value = 1.01
    await manager.join(player("one"), FakeSocket())
    await connected.room.submit_frame(
        "two",
        connected.connection,
        encode_client_input(InputCommand(sequence=6, client_tick=engine.tick, move_x=1000)),
    )
    assert engine.fighter("two").last_sequence == 6
    assert engine.fighter("two").held_input.move_x == 1000
    await manager.close()


@pytest.mark.parametrize("outbound_size", [1, 2])
async def test_bounded_periodic_snapshots_drop_slow_consumer(
    repository: Repository, outbound_size: int
) -> None:
    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=1000, outbound_size=outbound_size),
        match_id_factory=lambda: "match-slow",
    )
    blocker = asyncio.Event()
    slow = FakeSocket(block_send=blocker)
    await manager.join(player("slow"), slow)
    await manager.join(player("fast"), FakeSocket())

    await wait_until(lambda: slow.closed)
    blocker.set()
    await manager.close()
    await asyncio.sleep(0)
    assert not {
        task.get_name()
        for task in asyncio.all_tasks()
        if task is not asyncio.current_task()
        and not task.done()
        and task.get_name().startswith("hands-")
    }


async def test_a_fighter_dropped_as_a_slow_consumer_still_pauses_and_forfeits(
    repository: Repository,
) -> None:
    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=1_000_000, reconnect_grace=0.05),
        match_id_factory=lambda: "match-stalled",
    )
    stalled = StalledSocket()
    opponent = FakeSocket()
    stalled_membership = await manager.join(player("stalled"), stalled)
    await manager.join(player("opponent"), opponent)

    await wait_until(lambda: "paused" in message_types(opponent), deadline_seconds=2.0)
    slot = stalled_membership.room._slots["stalled"]
    assert slot.connection is None
    assert slot.reconnect_deadline is not None
    await wait_until(lambda: stalled.aborted)
    await wait_until(lambda: "final" in message_types(opponent))
    match = await repository.get_hands_match("match-stalled")
    assert match is not None
    assert match.finish_method == "forfeit"
    assert match.winner_id == "opponent"
    await manager.close()


async def test_transient_queue_pressure_recovers_and_can_debounce_again(
    repository: Repository,
) -> None:
    send_release = asyncio.Event()
    socket = FakeSocket(block_send=send_release)
    manager = HandsRoomManager(
        repository,
        config=room_config(tick_interval=0.05, outbound_size=1),
    )
    membership = await manager.join(player("one"), socket)
    room = membership.room
    connection = membership.connection

    room._enqueue(connection, "first", bounded_update=True)
    room._enqueue(connection, "overflow", bounded_update=True)
    assert connection.slow_drop_started
    assert connection.slow_drop_task is not None
    assert connection.slow_drop_task.get_name().startswith("hands-slow-drop-")
    send_release.set()
    await wait_until(lambda: not connection.slow_drop_started)
    assert not socket.closed
    assert connection.slow_drop_task is None

    send_release.clear()
    room._enqueue(connection, "second", bounded_update=True)
    await asyncio.sleep(0)
    room._enqueue(connection, "overflow-again", bounded_update=True)
    assert connection.slow_drop_started
    await wait_until(lambda: socket.closed)
    assert connection.slow_drop_task is None
    await wait_until(lambda: not room._background_tasks)
    await manager.close()


async def started_room_with_blocked_ticks(
    repository: Repository, socket: FakeSocket, *, outbound_size: int = 16
) -> tuple[HandsRoomManager, HandsRoom, asyncio.Event]:
    """A started bout whose tick loop is parked, so the test broadcasts snapshots itself."""
    sleep_entered = asyncio.Event()
    sleep_release = asyncio.Event()

    async def controlled_sleep(_delay: float) -> None:
        sleep_entered.set()
        await sleep_release.wait()

    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=1000, outbound_size=outbound_size),
        sleep=controlled_sleep,
    )
    membership = await manager.join(player("one"), socket)
    await manager.join(player("two"), FakeSocket())
    await sleep_entered.wait()
    return manager, membership.room, sleep_release


def snapshot_payloads(socket: FakeSocket) -> list[dict[str, object]]:
    return [
        json.loads(message)["payload"]
        for message in socket.messages
        if json.loads(message)["type"] == "snapshot"
    ]


async def test_a_backed_up_connection_gets_the_newest_snapshot_with_the_events_it_missed(
    repository: Repository,
) -> None:
    send_release = asyncio.Event()
    socket = FakeSocket(block_send=send_release)
    manager, room, sleep_release = await started_room_with_blocked_ticks(repository, socket)
    engine = room.engine
    assert engine is not None
    base = engine.snapshot()
    hit = CombatEvent(event_id=900, tick=base.tick + 1, kind="hit", actor_id="two", amount=12)
    for offset in range(1, 6):
        room._broadcast_snapshot(
            replace(base, tick=base.tick + offset, events=(hit,) if offset == 1 else ())
        )

    send_release.set()
    await wait_until(lambda: bool(snapshot_payloads(socket)))
    await asyncio.sleep(0.02)
    snapshots = snapshot_payloads(socket)
    assert [payload["tick"] for payload in snapshots] == [base.tick + 5]
    events = snapshots[0]["events"]
    assert isinstance(events, list)
    assert 900 in {event["event_id"] for event in events}
    sleep_release.set()
    await manager.close()


async def test_snapshots_wait_while_the_transport_is_backed_up_and_then_send_the_newest(
    repository: Repository,
) -> None:
    socket = FakeSocket()
    manager, room, sleep_release = await started_room_with_blocked_ticks(repository, socket)
    engine = room.engine
    assert engine is not None
    await wait_until(lambda: bool(snapshot_payloads(socket)))
    sent = len(snapshot_payloads(socket))
    base = engine.snapshot()

    socket.buffered = SNAPSHOT_BACKLOG_BYTES + 1
    room._broadcast_snapshot(replace(base, tick=base.tick + 1))
    await asyncio.sleep(0.05)
    assert len(snapshot_payloads(socket)) == sent
    room._broadcast_snapshot(replace(base, tick=base.tick + 2))
    socket.buffered = 0
    await wait_until(lambda: len(snapshot_payloads(socket)) == sent + 1)
    assert snapshot_payloads(socket)[-1]["tick"] == base.tick + 2
    sleep_release.set()
    await manager.close()


async def test_a_connection_whose_transport_never_drains_is_dropped(
    repository: Repository,
) -> None:
    socket = FakeSocket()
    manager, room, sleep_release = await started_room_with_blocked_ticks(
        repository, socket, outbound_size=3
    )
    engine = room.engine
    assert engine is not None
    await wait_until(lambda: bool(snapshot_payloads(socket)))
    base = engine.snapshot()

    socket.buffered = SNAPSHOT_BACKLOG_BYTES + 1
    for offset in range(1, 6):
        room._broadcast_snapshot(replace(base, tick=base.tick + offset))
    await wait_until(lambda: socket.closed)
    assert room._slots["one"].connection is None
    sleep_release.set()
    await manager.close()


async def test_frames_that_carry_a_reconnect_ticket_are_never_compressed(
    repository: Repository,
) -> None:
    socket = FakeSocket()
    manager = HandsRoomManager(repository, config=room_config(round_ticks=1000))
    membership = await manager.join(player("one"), socket, reconnect_ticket="first-rotation")
    await manager.join(player("two"), FakeSocket())
    await membership.room.refresh_ticket(
        "one", membership.connection, "next-rotation", "refresh-id-000001"
    )
    await wait_until(lambda: {"ticket", "snapshot"} <= set(message_types(socket)))

    assert socket.uncompressed == ["welcome", "ticket"]
    await manager.close()


async def test_ticket_refresh_queue_coalesces_and_rejects_replaced_connection(
    repository: Repository,
) -> None:
    send_release = asyncio.Event()
    socket = FakeSocket(block_send=send_release)
    manager = HandsRoomManager(repository, config=room_config(round_ticks=1000))
    membership = await manager.join(player("one"), socket)
    await asyncio.sleep(0)
    baseline = membership.connection.outbox.qsize()

    for index in range(100):
        await membership.room.refresh_ticket(
            membership.player_id,
            membership.connection,
            f"ticket-{index}",
            f"refresh-id-{index:06d}",
        )
    assert membership.connection.outbox.qsize() == baseline + 1
    send_release.set()
    await wait_until(lambda: "ticket" in message_types(socket))
    refreshes = [json.loads(message) for message in socket.messages if '"type":"ticket"' in message]
    assert refreshes == [
        {
            "reconnect_ticket": "ticket-99",
            "refresh_id": "refresh-id-000099",
            "type": "ticket",
            "version": 3,
        }
    ]

    replacement = await manager.join(player("one"), FakeSocket())
    with pytest.raises(RoomError, match="connection_replaced"):
        await membership.room.refresh_ticket(
            membership.player_id,
            membership.connection,
            "stale-ticket",
            "stale-refresh-id",
        )
    await replacement.room.refresh_ticket(
        replacement.player_id,
        replacement.connection,
        "fresh-ticket",
        "fresh-refresh-id",
    )
    await manager.close()


@pytest.mark.parametrize("outbound_size", [1, 2])
async def test_reconnect_churn_cannot_grow_blocked_peer_control_queue(
    repository: Repository, outbound_size: int
) -> None:
    sleep_entered = asyncio.Event()
    sleep_release = asyncio.Event()

    async def controlled_sleep(_delay: float) -> None:
        sleep_entered.set()
        await sleep_release.wait()

    manager = HandsRoomManager(
        repository,
        config=room_config(
            round_ticks=1000,
            reconnect_grace=30.0,
            outbound_size=outbound_size,
        ),
        sleep=controlled_sleep,
        match_id_factory=lambda: f"match-control-churn-{outbound_size}",
    )
    send_release = asyncio.Event()
    slow_socket = FakeSocket(block_send=send_release)
    slow = await manager.join(player("slow"), slow_socket)
    attacker_socket = FakeSocket()
    attacker = await manager.join(player("attacker"), attacker_socket)
    await sleep_entered.wait()
    await asyncio.sleep(0)

    maximum_queued = slow.connection.outbox.qsize()
    for _ in range(225):
        await manager.leave(attacker)
        attacker_socket = FakeSocket()
        attacker = await manager.join(player("attacker"), attacker_socket)
        maximum_queued = max(maximum_queued, slow.connection.outbox.qsize())

    await wait_until(lambda: slow_socket.closed)
    maximum_queued = max(maximum_queued, slow.connection.outbox.qsize())
    assert slow.connection.slow_drop_started
    # The initial burst (waiting, ready), one snapshot slot and the stop sentinel, plus at most
    # outbound_size control updates, however long the churn goes on.
    assert maximum_queued <= outbound_size + 4
    active_hands_tasks = {
        task.get_name()
        for task in asyncio.all_tasks()
        if task is not asyncio.current_task()
        and not task.done()
        and task.get_name().startswith("hands-")
    }
    assert len(active_hands_tasks) <= 2

    engine = attacker.room.engine
    assert engine is not None
    engine.complete_forfeit("attacker")
    await manager.close()
    assert message_types(attacker_socket).count("final") == 1
    assert attacker_socket.close_code == 1000
    send_release.set()


@pytest.mark.parametrize("outbound_size", [1, 2])
async def test_critical_initial_burst_is_ordered_despite_blocked_writer(
    repository: Repository, outbound_size: int
) -> None:
    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=1000, outbound_size=outbound_size),
        match_id_factory=lambda: f"match-initial-{outbound_size}",
    )
    release = asyncio.Event()
    first = FakeSocket(block_send=release)
    second = FakeSocket(block_send=release)

    await manager.join(player("one"), first)
    await manager.join(player("two"), second)
    await asyncio.sleep(0)
    assert first.messages == second.messages == []

    release.set()
    await wait_until(lambda: len(first.messages) >= 3 and len(second.messages) >= 2)
    assert message_types(first)[:3] == ["welcome", "waiting", "ready"]
    assert message_types(second)[:2] == ["welcome", "ready"]
    await manager.close()


@pytest.mark.parametrize("outbound_size", [1, 2])
async def test_reconnect_over_a_socket_still_closing_gets_welcome_snapshot_and_resumed(
    repository: Repository, outbound_size: int
) -> None:
    sleep_release = asyncio.Event()

    async def controlled_sleep(_delay: float) -> None:
        await sleep_release.wait()

    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=1000, outbound_size=outbound_size),
        sleep=controlled_sleep,
        match_id_factory=lambda: "match-ordered-reconnect",
    )
    close_entered = asyncio.Event()
    close_release = asyncio.Event()
    old_socket = FakeSocket(block_close=close_release, close_entered=close_entered)
    old = await manager.join(player("one"), old_socket, reconnect_ticket="old-rotation")
    await manager.join(player("two"), FakeSocket())
    engine = old.room.engine
    assert engine is not None
    engine.fighter("two").get_up_meter = 77

    replacement_socket = FakeSocket()
    async with asyncio.timeout(1):
        replacement = await manager.join(
            player("one"), replacement_socket, reconnect_ticket="new-rotation"
        )
    await wait_until(lambda: len(replacement_socket.messages) >= 3)
    await close_entered.wait()
    assert not old_socket.closed
    close_release.set()
    await wait_until(lambda: old_socket.closed)
    assert old_socket.close_code == 4001

    messages = [json.loads(message) for message in replacement_socket.messages[:3]]
    assert [message["type"] for message in messages] == ["welcome", "snapshot", "resumed"]
    assert messages[0]["reconnect_ticket"] == "new-rotation"
    assert messages[0]["next_sequence"] == 0
    assert messages[0]["server_tick"] == messages[1]["payload"]["tick"]
    opponent = next(
        fighter for fighter in messages[1]["payload"]["fighters"] if fighter["player_id"] == "two"
    )
    assert opponent["get_up_meter"] == 0

    frame = encode_client_input(InputCommand(sequence=0, client_tick=replacement.room.engine.tick))
    await replacement.room.submit_frame("one", replacement.connection, frame)
    await manager.leave(replacement)
    reconnect_socket = FakeSocket()
    await manager.join(player("one"), reconnect_socket, reconnect_ticket="next-rotation")
    await wait_until(lambda: bool(reconnect_socket.messages))
    assert json.loads(reconnect_socket.messages[0])["next_sequence"] == 1
    await manager.close()


async def test_one_of_two_disconnected_players_recovers_into_paused_state(
    repository: Repository,
) -> None:
    class MutableClock:
        value = 0.0

        def __call__(self) -> float:
            return self.value

    clock = MutableClock()
    wakes: asyncio.Queue[None] = asyncio.Queue()

    async def controlled_sleep(_delay: float) -> None:
        await wakes.get()

    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=1000, reconnect_grace=30.0),
        monotonic_clock=clock,
        sleep=controlled_sleep,
        match_id_factory=lambda: "match-partial-reconnect",
    )
    one = await manager.join(player("one"), FakeSocket())
    two = await manager.join(player("two"), FakeSocket())
    engine = one.room.engine
    assert engine is not None
    await wait_until(lambda: engine.tick == 1)
    await asyncio.gather(manager.leave(one), manager.leave(two))
    clock.value = 7.25
    wakes.put_nowait(None)
    await wait_until(lambda: one.room._slots["two"].grace_remaining == 22.75)

    one_socket = FakeSocket()
    recovered_one = await manager.join(player("one"), one_socket)
    await wait_until(lambda: len(one_socket.messages) >= 3)
    messages = [json.loads(message) for message in one_socket.messages[:3]]
    assert [message["type"] for message in messages] == ["welcome", "snapshot", "paused"]
    assert messages[2] == {
        "grace_ms": 22_750,
        "player_id": "two",
        "type": "paused",
        "version": 3,
    }

    two_socket = FakeSocket()
    await manager.join(player("two"), two_socket)
    await wait_until(lambda: "resumed" in message_types(one_socket))
    assert recovered_one.room.engine is not None
    await manager.close()


async def test_a_replaced_socket_that_never_closes_is_aborted_without_holding_up_the_bout(
    repository: Repository,
) -> None:
    sleep_entered = asyncio.Event()
    sleep_release = asyncio.Event()

    async def controlled_sleep(_delay: float) -> None:
        sleep_entered.set()
        await sleep_release.wait()

    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=1000, close_timeout=0.05),
        sleep=controlled_sleep,
        match_id_factory=lambda: "match-final-during-reconnect",
    )
    close_entered = asyncio.Event()
    old_socket = FakeSocket(block_close=asyncio.Event(), close_entered=close_entered)
    membership = await manager.join(player("one"), old_socket)
    await manager.join(player("two"), FakeSocket())
    await sleep_entered.wait()
    engine = membership.room.engine
    assert engine is not None
    engine.phase_ticks_remaining = 1

    reconnect_socket = FakeSocket()
    async with asyncio.timeout(1):
        await manager.join(player("one"), reconnect_socket, reconnect_ticket="final-rotation")
    await close_entered.wait()
    sleep_release.set()
    await wait_until(lambda: old_socket.aborted)
    await wait_until(lambda: "final" in message_types(reconnect_socket))

    assert message_types(reconnect_socket)[:3] == ["welcome", "snapshot", "resumed"]
    assert old_socket.close_code is None
    await manager.close()


async def test_reconnect_over_a_socket_parked_on_a_stalled_transport(
    repository: Repository,
) -> None:
    sleep_release = asyncio.Event()

    async def controlled_sleep(_delay: float) -> None:
        await sleep_release.wait()

    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=1000, outbound_size=1000),
        sleep=controlled_sleep,
        match_id_factory=lambda: "match-parked-reconnect",
    )
    stalled = StalledSocket()
    await manager.join(player("one"), stalled)
    await manager.join(player("two"), FakeSocket())
    await wait_until(lambda: stalled.drain_waiter is not None)

    replacement_socket = FakeSocket()
    async with asyncio.timeout(1):
        await manager.join(player("one"), replacement_socket)
    await wait_until(lambda: len(replacement_socket.messages) >= 3)
    assert message_types(replacement_socket)[:3] == ["welcome", "snapshot", "resumed"]
    await wait_until(lambda: stalled.aborted)
    await manager.close()


async def test_admission_into_one_room_does_not_hold_up_joins_elsewhere(
    repository: Repository, monkeypatch: pytest.MonkeyPatch
) -> None:
    manager = HandsRoomManager(repository, config=room_config(round_ticks=1000))
    entered = asyncio.Event()
    release = asyncio.Event()
    original_add = HandsRoom.add

    async def stuck_add(room: HandsRoom, identity: AuthenticatedPlayer, *args, **kwargs):
        if identity.instance_id == "stuck-room":
            entered.set()
            await release.wait()
        return await original_add(room, identity, *args, **kwargs)

    monkeypatch.setattr(HandsRoom, "add", stuck_add)
    stuck = asyncio.create_task(manager.join(player("one", "stuck-room"), FakeSocket()))
    await entered.wait()
    async with asyncio.timeout(0.5):
        elsewhere = await manager.join(player("two", "other-room"), FakeSocket())
    assert elsewhere.role == "fighter"
    release.set()
    assert (await stuck).role == "fighter"
    await manager.close()


async def test_persistence_failure_errors_closes_and_unregisters(repository: Repository) -> None:
    repository.record_hands_match = AsyncMock(side_effect=RuntimeError("database detail"))
    manager = HandsRoomManager(
        repository,
        config=room_config(),
        match_id_factory=lambda: "match-persistence-failure",
    )
    one = FakeSocket()
    two = FakeSocket()
    await manager.join(player("one"), one)
    await manager.join(player("two"), two)

    await wait_until(lambda: manager.room_count == 0)
    assert one.closed and two.closed
    for socket in (one, two):
        errors = [json.loads(message) for message in socket.messages if '"type":"error"' in message]
        assert errors == [{"code": "persistence_failed", "type": "error", "version": 3}]
        assert all("database detail" not in message for message in socket.messages)
    await manager.close()


async def test_an_engine_failure_voids_the_bout_and_frees_the_instance(
    repository: Repository, monkeypatch: pytest.MonkeyPatch
) -> None:
    safe_logger = MagicMock()
    monkeypatch.setattr(rooms_module, "logger", safe_logger)
    sleep_entered = asyncio.Event()
    sleep_release = asyncio.Event()

    async def controlled_sleep(_delay: float) -> None:
        sleep_entered.set()
        await sleep_release.wait()

    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=1000),
        sleep=controlled_sleep,
        match_id_factory=lambda: "match-engine-failure",
    )
    sockets = (FakeSocket(), FakeSocket())
    one = await manager.join(player("one"), sockets[0])
    await manager.join(player("two"), sockets[1])
    await sleep_entered.wait()
    engine = one.room.engine
    assert engine is not None

    def broken_step(*_args: object) -> None:
        raise RuntimeError("engine bug")

    monkeypatch.setattr(engine, "step", broken_step)
    sleep_release.set()
    await wait_until(lambda: manager.room_count == 0)

    for socket in sockets:
        assert socket.closed
        assert socket.close_code == 1011
        errors = [json.loads(message) for message in socket.messages if '"type":"error"' in message]
        assert errors == [{"code": "internal_error", "type": "error", "version": 3}]
    safe_logger.exception.assert_called_once()
    assert await repository.get_hands_match("match-engine-failure") is None
    for user_id in ("one", "two"):
        rating = await repository.get_hands_rating("guild-1", user_id)
        assert rating is not None
        assert (rating.bouts, rating.rating) == (0, 1000)
    again = await manager.join(player("one"), FakeSocket())
    assert again.room is not one.room
    await manager.close()


async def test_a_result_the_engine_reached_is_recorded_even_if_broadcasting_it_fails(
    repository: Repository, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(rooms_module, "logger", MagicMock())
    original_broadcast = HandsRoom._broadcast_snapshot

    def broadcast_failing_on_the_result(room: HandsRoom, snapshot: EngineSnapshot) -> None:
        if snapshot.result is not None:
            raise RuntimeError("encoding bug")
        original_broadcast(room, snapshot)

    monkeypatch.setattr(HandsRoom, "_broadcast_snapshot", broadcast_failing_on_the_result)
    manager = HandsRoomManager(
        repository,
        config=room_config(),
        match_id_factory=lambda: "match-broadcast-failure",
    )
    sockets = (FakeSocket(), FakeSocket())
    await manager.join(player("one"), sockets[0])
    await manager.join(player("two"), sockets[1])
    await wait_until(lambda: manager.room_count == 0)

    match = await repository.get_hands_match("match-broadcast-failure")
    assert match is not None
    assert match.finish_method == "draw"
    for socket in sockets:
        assert "final" in message_types(socket)
    await manager.close()


async def test_shutdown_after_result_shields_persistence_from_cancelled_waiter(
    repository: Repository,
) -> None:
    original_record = repository.record_hands_match
    entered = asyncio.Event()
    release = asyncio.Event()

    async def delayed_record(result, **details):
        entered.set()
        await release.wait()
        return await original_record(result, **details)

    repository.record_hands_match = delayed_record
    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=1000),
        match_id_factory=lambda: "match-shutdown-result",
    )
    membership = await manager.join(player("one"), FakeSocket())
    await manager.join(player("two"), FakeSocket())
    engine = membership.room.engine
    assert engine is not None
    engine.complete_forfeit("one")

    close_waiter = asyncio.create_task(membership.room.close())
    await entered.wait()
    close_waiter.cancel()
    with pytest.raises(asyncio.CancelledError):
        await close_waiter
    release.set()
    await membership.room.close()

    assert await repository.get_hands_match("match-shutdown-result") is not None
    assert manager.room_count == 0
    await manager.close()


async def test_final_delivery_precedes_close_and_blocked_send_times_out(
    repository: Repository,
) -> None:
    timeline: list[str] = []
    manager = HandsRoomManager(
        repository,
        config=room_config(result_hold=0, final_delivery_timeout=0.02),
        match_id_factory=lambda: "match-final-order",
    )
    one = FakeSocket(timeline=timeline)
    two = FakeSocket()
    await manager.join(player("one"), one)
    await manager.join(player("two"), two)
    await wait_until(lambda: one.closed)
    assert timeline.index("send:final") < timeline.index("close")
    await manager.close()

    blocker = asyncio.Event()
    blocked_manager = HandsRoomManager(
        repository,
        config=room_config(result_hold=0, final_delivery_timeout=0.01, outbound_size=16),
        match_id_factory=lambda: "match-blocked-final",
    )
    blocked = FakeSocket(block_send=blocker)
    await blocked_manager.join(player("blocked", "blocked-room"), blocked)
    await blocked_manager.join(player("peer", "blocked-room"), FakeSocket())
    await wait_until(lambda: blocked.closed)
    assert blocked.close_code == 1000
    blocker.set()
    await blocked_manager.close()


async def test_tick_catch_up_drops_old_backlog(repository: Repository) -> None:
    class MutableClock:
        value = 0.0

        def __call__(self) -> float:
            return self.value

    clock = MutableClock()
    wakes: asyncio.Queue[None] = asyncio.Queue()

    async def controlled_sleep(_delay: float) -> None:
        await wakes.get()

    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=1000, max_catch_up_ticks=2),
        monotonic_clock=clock,
        sleep=controlled_sleep,
        match_id_factory=lambda: "match-catch-up",
    )
    membership = await manager.join(player("one"), FakeSocket())
    await manager.join(player("two"), FakeSocket())
    engine = membership.room.engine
    assert engine is not None
    await wait_until(lambda: engine.tick == 1)
    clock.value = 100.0
    wakes.put_nowait(None)
    await wait_until(lambda: engine.tick == 3)
    await asyncio.sleep(0)
    assert engine.tick == 3
    await manager.close()


async def test_both_disconnect_abandons_without_match_or_elo_change(
    repository: Repository,
) -> None:
    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=1000, reconnect_grace=0.01),
        match_id_factory=lambda: "match-both-disconnect",
    )
    one = await manager.join(player("one"), FakeSocket())
    two = await manager.join(player("two"), FakeSocket())
    await asyncio.gather(manager.leave(one), manager.leave(two))
    await wait_until(lambda: manager.room_count == 0)

    assert await repository.get_hands_match("match-both-disconnect") is None
    for user_id in ("one", "two"):
        rating = await repository.get_hands_rating("guild-1", user_id)
        assert rating is not None
        assert rating.bouts == 0 and rating.rating == 1000
    await manager.close()


async def test_the_ready_message_carries_each_fighters_record(repository: Repository) -> None:
    original_get = repository.get_or_create_hands_rating

    async def with_record(guild_id: str, user_id: str):
        rating = await original_get(guild_id, user_id)
        if user_id == "one":
            rating.wins, rating.losses, rating.draws, rating.knockouts = 12, 3, 1, 8
        return rating

    repository.get_or_create_hands_rating = with_record
    manager = HandsRoomManager(repository, config=room_config(round_ticks=1000))
    first_socket = FakeSocket()
    await manager.join(player("one"), first_socket)
    await manager.join(player("two"), FakeSocket())
    await wait_until(lambda: "ready" in message_types(first_socket))
    players = {entry["id"]: entry for entry in payloads(first_socket, "ready")[0]["players"]}
    assert players["one"]["record"] == {"wins": 12, "losses": 3, "draws": 1, "knockouts": 8}
    assert players["two"]["record"] == {"wins": 0, "losses": 0, "draws": 0, "knockouts": 0}
    await manager.close()


async def test_slow_rating_lookup_does_not_block_independent_join(
    repository: Repository,
) -> None:
    original_get = repository.get_or_create_hands_rating
    entered = asyncio.Event()
    release = asyncio.Event()

    async def delayed_get(guild_id: str, user_id: str):
        if user_id == "slow":
            entered.set()
            await release.wait()
        return await original_get(guild_id, user_id)

    repository.get_or_create_hands_rating = delayed_get
    manager = HandsRoomManager(repository, config=room_config(round_ticks=1000))
    slow_task = asyncio.create_task(manager.join(player("slow", "slow-room"), FakeSocket()))
    await entered.wait()
    async with asyncio.timeout(0.2):
        fast = await manager.join(player("fast", "fast-room"), FakeSocket())
    assert fast.player_id == "fast"
    release.set()
    await slow_task
    await manager.close()


async def test_same_instance_admission_preserves_successful_join_order(
    repository: Repository,
) -> None:
    original_get = repository.get_or_create_hands_rating
    first_entered = asyncio.Event()
    release_first = asyncio.Event()

    async def delayed_get(guild_id: str, user_id: str):
        if user_id == "first":
            first_entered.set()
            await release_first.wait()
        return await original_get(guild_id, user_id)

    repository.get_or_create_hands_rating = delayed_get
    manager = HandsRoomManager(repository, config=room_config(round_ticks=1_000_000))
    first_task = asyncio.create_task(manager.join(player("first"), FakeSocket()))
    await first_entered.wait()
    second_task = asyncio.create_task(manager.join(player("second"), FakeSocket()))
    third_task = asyncio.create_task(manager.join(player("third"), FakeSocket()))
    await asyncio.sleep(0)

    assert not second_task.done()
    assert not third_task.done()
    release_first.set()
    first, second, third = await asyncio.gather(first_task, second_task, third_task)

    assert (first.role, second.role, third.role) == ("fighter", "fighter", "spectator")
    assert first.room.player_ids == ("first", "second")
    assert first.room.spectator_ids == ("third",)
    await manager.close()


async def test_pre_match_fighter_keeps_seat_through_reconnect_grace(
    repository: Repository,
) -> None:
    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=1000, reconnect_grace=30.0),
    )
    first = await manager.join(player("first"), FakeSocket())
    await manager.leave(first)

    assert first.room.player_ids == ("first",)
    assert manager.room_count == 1
    second_socket = FakeSocket()
    second = await manager.join(player("second"), second_socket)
    assert second.role == "fighter"
    await wait_until(lambda: "paused" in message_types(second_socket))

    reconnected = await manager.join(player("first"), FakeSocket())
    assert reconnected.role == "fighter"
    assert reconnected.room.player_ids == ("first", "second")
    assert reconnected.room.spectator_ids == ()
    async with asyncio.timeout(0.2):
        await manager.close()


async def test_pre_match_reconnect_is_rejected_after_monotonic_deadline(
    repository: Repository,
) -> None:
    class MutableClock:
        value = 0.0

        def __call__(self) -> float:
            return self.value

    clock = MutableClock()
    sleep_calls = 0
    first_sleep = asyncio.Event()
    match_sleep = asyncio.Event()
    release_sleep = asyncio.Event()

    async def controlled_sleep(_delay: float) -> None:
        nonlocal sleep_calls
        sleep_calls += 1
        first_sleep.set()
        if sleep_calls >= 2:
            match_sleep.set()
        await release_sleep.wait()

    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=1000, reconnect_grace=20.0),
        monotonic_clock=clock,
        sleep=controlled_sleep,
        match_id_factory=lambda: "match-expired-waiting-seat",
    )
    first = await manager.join(player("first"), FakeSocket())
    await manager.leave(first)
    await first_sleep.wait()
    second = await manager.join(player("second"), FakeSocket())
    await match_sleep.wait()

    clock.value = 21.0
    with pytest.raises(RoomError, match="room_closed"):
        await manager.join(player("first"), FakeSocket())

    release_sleep.set()
    await wait_until(lambda: manager.room_count == 0)
    match = await repository.get_hands_match("match-expired-waiting-seat")
    assert match is not None
    assert match.finish_method == "forfeit"
    assert match.winner_id == second.player_id
    await manager.close()


async def test_pre_match_reconnect_churn_keeps_one_grace_worker(
    repository: Repository,
) -> None:
    release_sleep = asyncio.Event()

    async def controlled_sleep(_delay: float) -> None:
        await release_sleep.wait()

    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=1000, reconnect_grace=30.0),
        sleep=controlled_sleep,
    )
    current = await manager.join(player("one"), FakeSocket())
    for _ in range(100):
        await manager.leave(current)
        current = await manager.join(player("one"), FakeSocket())

    grace_tasks = [
        task
        for task in asyncio.all_tasks()
        if not task.done() and task.get_name().startswith("hands-waiting-grace-")
    ]
    assert len(grace_tasks) == 1
    assert current.role == "fighter"
    async with asyncio.timeout(0.2):
        await manager.close()


async def test_detached_join_rejects_orphan_without_messages_or_newer_reservation_damage(
    repository: Repository,
) -> None:
    original_get = repository.get_or_create_hands_rating
    entered = asyncio.Event()
    release = asyncio.Event()
    delayed = True

    async def delayed_get(guild_id: str, user_id: str):
        nonlocal delayed
        if user_id == "two" and delayed:
            delayed = False
            entered.set()
            await release.wait()
        return await original_get(guild_id, user_id)

    repository.get_or_create_hands_rating = delayed_get
    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=1000, reconnect_grace=0.01),
    )
    first = await manager.join(player("one"), FakeSocket())
    orphan_socket = FakeSocket()
    pending = asyncio.create_task(manager.join(player("two"), orphan_socket))
    await entered.wait()

    await manager.leave(first)
    await wait_until(lambda: manager.room_count == 0)
    newer_socket = FakeSocket()
    newer = await manager.join(player("two"), newer_socket)
    release.set()
    with pytest.raises(RoomError, match="room_closed"):
        await pending

    assert orphan_socket.messages == []
    assert manager.room_count == 1
    assert newer.room.player_ids == ("two",)
    assert not newer_socket.closed
    await manager.close()
    assert newer_socket.closed

    await asyncio.sleep(0)
    active_names = {
        task.get_name()
        for task in asyncio.all_tasks()
        if task is not asyncio.current_task() and not task.done()
    }
    assert not {name for name in active_names if name.startswith("hands-")}


async def test_stale_failed_join_cannot_untrack_newer_same_room_success(
    repository: Repository,
) -> None:
    original_get = repository.get_or_create_hands_rating
    older_entered = asyncio.Event()
    older_release = asyncio.Event()
    first_lookup = True

    async def fail_older_get(guild_id: str, user_id: str):
        nonlocal first_lookup
        if user_id == "one" and first_lookup:
            first_lookup = False
            older_entered.set()
            await older_release.wait()
            raise RuntimeError("older lookup failed")
        return await original_get(guild_id, user_id)

    repository.get_or_create_hands_rating = fail_older_get
    manager = HandsRoomManager(repository, config=room_config(round_ticks=1000))
    older_socket = FakeSocket()
    older = asyncio.create_task(manager.join(player("one"), older_socket))
    await older_entered.wait()

    newer_socket = FakeSocket()
    newer_task = asyncio.create_task(manager.join(player("one"), newer_socket))
    older_release.set()
    with pytest.raises(RuntimeError, match="older lookup failed"):
        await older
    newer = await newer_task

    assert older_socket.messages == []
    assert newer.room.player_ids == ("one",)
    assert not newer_socket.closed
    with pytest.raises(RoomError, match="already_in_room"):
        await manager.join(player("one", "other-instance"), FakeSocket())
    assert manager.room_count == 1
    assert newer.room.player_ids == ("one",)
    await manager.close()


async def test_reconnect_during_result_persistence_gets_snapshot_then_exact_final(
    repository: Repository,
) -> None:
    original_record = repository.record_hands_match
    persistence_entered = asyncio.Event()
    persistence_release = asyncio.Event()

    async def delayed_record(result, **details):
        persistence_entered.set()
        await persistence_release.wait()
        return await original_record(result, **details)

    repository.record_hands_match = delayed_record
    manager = HandsRoomManager(
        repository,
        config=room_config(result_hold=0.05),
        match_id_factory=lambda: "match-recover-pending",
    )
    first_socket = FakeSocket()
    opponent_socket = FakeSocket()
    first = await manager.join(player("one"), first_socket)
    await manager.join(player("two"), opponent_socket)
    await persistence_entered.wait()
    await manager.leave(first)

    reconnect_socket = FakeSocket()
    recovered = await manager.join(player("one"), reconnect_socket)
    await wait_until(lambda: len(reconnect_socket.messages) >= 2)
    assert message_types(reconnect_socket)[:2] == ["welcome", "snapshot"]
    await recovered.room.submit_frame("one", recovered.connection, "{}")
    with pytest.raises(RoomError, match="room_closed"):
        await manager.join(player("three"), FakeSocket())

    persistence_release.set()
    await wait_until(lambda: "final" in message_types(reconnect_socket))
    await wait_until(lambda: "final" in message_types(opponent_socket))
    reconnect_final = next(
        json.loads(message) for message in reconnect_socket.messages if '"type":"final"' in message
    )
    opponent_final = next(
        json.loads(message) for message in opponent_socket.messages if '"type":"final"' in message
    )
    assert reconnect_final == opponent_final
    await manager.close()


@pytest.mark.parametrize("outbound_size", [1, 2])
async def test_reconnect_during_result_hold_gets_stored_final_before_close(
    repository: Repository, outbound_size: int
) -> None:
    hold_entered = asyncio.Event()
    hold_release = asyncio.Event()

    async def controlled_sleep(delay: float) -> None:
        if delay >= 0.1:
            hold_entered.set()
            await hold_release.wait()
        else:
            await asyncio.sleep(delay)

    manager = HandsRoomManager(
        repository,
        config=room_config(result_hold=0.1, outbound_size=outbound_size),
        sleep=controlled_sleep,
        match_id_factory=lambda: "match-recover-final",
    )
    first_socket = FakeSocket()
    first = await manager.join(player("one"), first_socket)
    await manager.join(player("two"), FakeSocket())
    await wait_until(lambda: "final" in message_types(first_socket))
    await hold_entered.wait()
    authoritative_final = next(
        json.loads(message) for message in first_socket.messages if '"type":"final"' in message
    )
    await manager.leave(first)

    reconnect_socket = FakeSocket()
    recovered = await manager.join(player("one"), reconnect_socket)
    await wait_until(lambda: len(reconnect_socket.messages) >= 3)
    recovered_messages = [json.loads(message) for message in reconnect_socket.messages]
    assert [message["type"] for message in recovered_messages[:3]] == [
        "welcome",
        "snapshot",
        "final",
    ]
    assert recovered_messages[2] == authoritative_final
    await recovered.room.submit_frame("one", recovered.connection, "{}")
    hold_release.set()
    await wait_until(lambda: reconnect_socket.closed)
    assert message_types(reconnect_socket).index("final") < len(reconnect_socket.messages)
    await manager.close()


async def test_room_rejects_guild_mismatch(repository: Repository) -> None:
    manager = HandsRoomManager(repository, config=room_config(round_ticks=1000))
    await manager.join(player("one"), FakeSocket())
    intruder = AuthenticatedPlayer("intruder", "other-guild", "instance-1", "Intruder", None)
    with pytest.raises(RoomError, match="invalid_guild"):
        await manager.join(intruder, FakeSocket())
    await manager.close()


async def test_close_is_idempotent_and_leaves_no_hands_tasks(repository: Repository) -> None:
    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=1000),
        match_id_factory=lambda: "match-close",
    )
    await manager.join(player("one"), FakeSocket())
    await manager.join(player("two"), FakeSocket())
    await manager.close()
    await manager.close()

    with pytest.raises(RoomError, match="server_shutting_down"):
        await manager.join(player("three"), FakeSocket())
    await asyncio.sleep(0)
    active_names = {
        task.get_name()
        for task in asyncio.all_tasks()
        if task is not asyncio.current_task() and not task.done()
    }
    assert not {name for name in active_names if name.startswith("hands-")}


def payloads(socket: FakeSocket, kind: str) -> list[dict[str, object]]:
    return [
        json.loads(message) for message in socket.messages if json.loads(message)["type"] == kind
    ]


async def test_a_lone_fighter_calls_in_the_computer_for_an_unrated_bout(
    repository: Repository,
) -> None:
    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=90),
        match_id_factory=lambda: "match-cpu",
        seed_factory=lambda: 11,
    )
    socket = FakeSocket()
    one = await manager.join(player("one"), socket)
    await wait_until(lambda: "waiting" in message_types(socket))

    assert await one.room.request_cpu("one", one.connection, CpuLevel.CONTENDER)
    engine = one.room.engine
    assert engine is not None
    assert engine.players == ("one", "cpu:contender")
    await wait_until(lambda: "ready" in message_types(socket))
    ready = payloads(socket, "ready")[0]
    assert ready["players"][1] == {
        "id": "cpu:contender",
        "name": PROFILES[CpuLevel.CONTENDER].name,
        "avatar": None,
        "rating": PROFILES[CpuLevel.CONTENDER].rating,
        "connected": True,
        "cpu": True,
        "style": engine.fighter("cpu:contender").style.value,
        "record": CPU_RECORDS[CpuLevel.CONTENDER].payload(),
    }
    assert engine.fighter("cpu:contender").style in CPU_STYLES[CpuLevel.CONTENDER]
    assert "cpu" not in ready["players"][0]
    await wait_until(lambda: "final" in message_types(socket), deadline_seconds=5)

    final = payloads(socket, "final")[0]
    assert final["ratings"] == {
        "one": {"before": 1000, "after": 1000},
        "cpu:contender": {
            "before": PROFILES[CpuLevel.CONTENDER].rating,
            "after": PROFILES[CpuLevel.CONTENDER].rating,
        },
    }
    assert await repository.get_hands_match("match-cpu") is None
    rating = await repository.get_hands_rating("guild-1", "one")
    assert rating is not None and rating.bouts == 0 and rating.rating == 1000
    assert await repository.get_hands_rating("guild-1", "cpu:contender") is None
    await wait_until(lambda: manager.room_count == 0)
    await manager.close()


async def test_the_run_loop_plays_the_computer_through_the_engine(
    repository: Repository,
) -> None:
    manager = HandsRoomManager(repository, config=room_config(round_ticks=600))
    one = await manager.join(player("one"), FakeSocket())
    assert await one.room.request_cpu("one", one.connection, CpuLevel.CHAMPION)
    engine = one.room.engine
    assert engine is not None
    await wait_until(lambda: engine.tick > 40, deadline_seconds=3)
    computer = engine.fighter("cpu:champion")
    assert computer.last_sequence >= 30
    assert (computer.x, computer.y) != (180, 0)
    await manager.close()


async def test_the_computer_is_not_called_once_a_second_fighter_is_seated(
    repository: Repository,
) -> None:
    manager = HandsRoomManager(repository, config=room_config(round_ticks=1000))
    one = await manager.join(player("one"), FakeSocket())
    two = await manager.join(player("two"), FakeSocket())
    assert not await one.room.request_cpu("one", one.connection, CpuLevel.ROOKIE)
    assert not await two.room.request_cpu("two", two.connection, CpuLevel.ROOKIE)
    assert one.room.cpu is None
    assert one.room.engine is not None and one.room.engine.players == ("one", "two")
    await manager.close()


async def test_the_computer_is_called_once(repository: Repository) -> None:
    manager = HandsRoomManager(repository, config=room_config(round_ticks=1000))
    socket = FakeSocket()
    one = await manager.join(player("one"), socket)
    assert await one.room.request_cpu("one", one.connection, CpuLevel.ROOKIE)
    engine = one.room.engine
    assert not await one.room.request_cpu("one", one.connection, CpuLevel.CHAMPION)
    assert one.room.engine is engine
    assert one.room.cpu is not None and one.room.cpu.level is CpuLevel.ROOKIE
    await wait_until(lambda: "snapshot" in message_types(socket))
    assert message_types(socket).count("ready") == 1
    await manager.close()


async def test_only_the_current_connection_can_call_the_computer(
    repository: Repository,
) -> None:
    manager = HandsRoomManager(repository, config=room_config(round_ticks=1000))
    first = await manager.join(player("one"), FakeSocket())
    await manager.join(player("one"), FakeSocket())
    with pytest.raises(RoomError, match="connection_replaced"):
        await first.room.request_cpu("one", first.connection, CpuLevel.ROOKIE)
    assert first.room.engine is None
    await manager.close()


async def test_a_spectator_joining_a_computer_bout_sees_both_fighters(
    repository: Repository,
) -> None:
    manager = HandsRoomManager(repository, config=room_config(round_ticks=1000))
    one = await manager.join(player("one"), FakeSocket())
    assert await one.room.request_cpu("one", one.connection, CpuLevel.ROOKIE)
    watcher_socket = FakeSocket()
    watcher = await manager.join(player("two"), watcher_socket)
    assert watcher.role == "spectator"
    await wait_until(lambda: "snapshot" in message_types(watcher_socket))
    welcome = payloads(watcher_socket, "welcome")[0]
    assert [entry["id"] for entry in welcome["players"]] == ["one", "cpu:rookie"]
    await manager.close()


async def test_a_computer_bout_is_abandoned_when_its_fighter_never_returns(
    repository: Repository,
) -> None:
    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=1000, reconnect_grace=0.02),
        match_id_factory=lambda: "match-cpu-abandoned",
    )
    one = await manager.join(player("one"), FakeSocket())
    assert await one.room.request_cpu("one", one.connection, CpuLevel.CHAMPION)
    engine = one.room.engine
    assert engine is not None
    await manager.leave(one)
    tick = engine.tick
    await wait_until(lambda: manager.room_count == 0)
    assert engine.result is None and engine.tick - tick <= 2
    assert await repository.get_hands_match("match-cpu-abandoned") is None
    await manager.close()


async def test_a_rematch_against_the_computer_starts_a_fresh_bout(
    repository: Repository,
) -> None:
    ids = iter(("match-cpu-1", "match-cpu-2"))
    manager = HandsRoomManager(
        repository, config=room_config(round_ticks=30), match_id_factory=lambda: next(ids)
    )
    first_socket = FakeSocket()
    first = await manager.join(player("one"), first_socket)
    assert await first.room.request_cpu("one", first.connection, CpuLevel.ROOKIE)
    await wait_until(lambda: "final" in message_types(first_socket), deadline_seconds=5)
    await wait_until(lambda: manager.room_count == 0)

    second_socket = FakeSocket()
    second = await manager.join(player("one"), second_socket)
    assert second.room is not first.room
    await wait_until(lambda: "waiting" in message_types(second_socket))
    assert await second.room.request_cpu("one", second.connection, CpuLevel.ROOKIE)
    await wait_until(lambda: "final" in message_types(second_socket), deadline_seconds=5)
    assert payloads(second_socket, "final")[0]["match_id"] == "match-cpu-2"


async def test_a_rematch_reaches_a_new_room_while_the_old_one_is_still_closing(
    repository: Repository,
) -> None:
    hold = 0.2
    delivery = 0.3
    spectator_seated = asyncio.Event()

    async def sleep_once_the_spectator_is_seated(delay: float) -> None:
        # The first tick only ends the countdown, so however coarse the platform's timer, the
        # two-tick bout cannot finish before the spectator is in.
        await spectator_seated.wait()
        await asyncio.sleep(delay)

    manager = HandsRoomManager(
        repository,
        config=room_config(result_hold=hold, final_delivery_timeout=delivery),
        sleep=sleep_once_the_spectator_is_seated,
    )
    first, second = FakeSocket(), FakeSocket()
    stalled = FakeSocket(block_send=asyncio.Event())
    one = await manager.join(player("one"), first)
    two = await manager.join(player("two"), second)
    await manager.join(player("spectator"), stalled)
    spectator_seated.set()
    await wait_until(
        lambda: any(json.loads(message)["type"] == "final" for message in first.messages),
        deadline_seconds=2.0,
    )
    await manager.leave(one)
    await manager.leave(two)

    outcomes: list[str] = []
    async with asyncio.timeout(hold + 2 * delivery + 1.0):
        while not outcomes or outcomes[-1] != "new room":
            try:
                membership = await manager.join(player("one"), FakeSocket())
                outcome = "old room" if membership.room is one.room else "new room"
                await manager.leave(membership)
            except RoomError as exc:
                outcome = f"refused: {exc.code}"
            if not outcomes or outcomes[-1] != outcome:
                outcomes.append(outcome)
            await asyncio.sleep(0.01)
    assert outcomes == ["old room", "new room"]
    assert stalled.block_send is not None
    stalled.block_send.set()
    await manager.close()


class MutableClock:
    value = 0.0

    def __call__(self) -> float:
        return self.value


async def burst_then_drop(
    repository: Repository, label: str
) -> tuple[HandsRoomManager, RoomMembership, MutableClock, asyncio.Event]:
    clock = MutableClock()
    sleep_entered = asyncio.Event()
    sleep_release = asyncio.Event()

    async def controlled_sleep(_delay: float) -> None:
        sleep_entered.set()
        await sleep_release.wait()

    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=1000, reconnect_grace=30.0),
        monotonic_clock=clock,
        sleep=controlled_sleep,
        match_id_factory=lambda: f"match-{label}",
    )
    one = await manager.join(player("one"), FakeSocket())
    await manager.join(player("two"), FakeSocket())
    await sleep_entered.wait()
    engine = one.room.engine
    assert engine is not None
    for sequence in range(1, 8):
        await one.room.submit_frame(
            "one",
            one.connection,
            encode_client_input(
                InputCommand(sequence=sequence, client_tick=engine.tick, move_x=1000)
            ),
        )
    assert engine.fighter("one").last_sequence == 5
    await manager.leave(one)
    return manager, one, clock, sleep_release


async def test_a_fresh_client_is_not_broken_by_frames_held_back_from_its_dropped_connection(
    repository: Repository,
) -> None:
    manager, one, clock, sleep_release = await burst_then_drop(repository, "fresh")
    room = one.room
    engine = room.engine
    assert engine is not None
    socket = FakeSocket()
    rejoined = await manager.join(player("one"), socket)
    await wait_until(lambda: bool(socket.messages))
    welcome = json.loads(socket.messages[0])
    assert welcome["type"] == "welcome"
    clock.value += 1.0
    room._apply_deferred_inputs(clock())
    assert engine.fighter("one").last_sequence == 5
    await room.submit_frame(
        "one",
        rejoined.connection,
        encode_client_input(
            InputCommand(sequence=welcome["next_sequence"], client_tick=engine.tick)
        ),
    )
    assert engine.fighter("one").last_sequence == welcome["next_sequence"]
    sleep_release.set()
    await manager.close()


async def test_a_new_connection_gets_its_own_frame_allowance(repository: Repository) -> None:
    manager, one, clock, sleep_release = await burst_then_drop(repository, "allowance")
    room = one.room
    engine = room.engine
    assert engine is not None
    socket = FakeSocket()
    rejoined = await manager.join(player("one"), socket)
    await wait_until(lambda: bool(socket.messages))
    welcome = json.loads(socket.messages[0])
    clock.value += 0.4
    sequence = welcome["next_sequence"]
    for offset in range(5):
        await room.submit_frame(
            "one",
            rejoined.connection,
            encode_client_input(InputCommand(sequence=sequence + offset, client_tick=engine.tick)),
        )
    assert engine.fighter("one").last_sequence == sequence + 4
    sleep_release.set()
    await manager.close()


@pytest.mark.parametrize("held_back", ["before the pause", "during the pause"])
async def test_a_frame_held_back_by_the_input_budget_never_fires_after_a_pause(
    repository: Repository, held_back: str
) -> None:
    clock = MutableClock()
    sleep_entered = asyncio.Event()
    sleep_release = asyncio.Event()

    async def controlled_sleep(_delay: float) -> None:
        sleep_entered.set()
        await sleep_release.wait()

    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=1000, reconnect_grace=30.0),
        monotonic_clock=clock,
        sleep=controlled_sleep,
        match_id_factory=lambda: "match-held-across-pause",
    )
    one = await manager.join(player("one"), FakeSocket())
    two = await manager.join(player("two"), FakeSocket())
    await sleep_entered.wait()
    room = one.room
    engine = room.engine
    assert engine is not None
    for sequence in range(1, 6):
        await room.submit_frame(
            "one",
            one.connection,
            encode_client_input(InputCommand(sequence=sequence, client_tick=engine.tick)),
        )
    jab = PunchAction(hand=Hand.LEFT, punch_class=PunchClass.JAB, target=Target.HEAD)
    held = encode_client_input(
        InputCommand(sequence=6, client_tick=engine.tick, move_x=1000, actions=(jab,))
    )
    if held_back == "before the pause":
        await room.submit_frame("one", one.connection, held)
        await manager.leave(two)
    else:
        await manager.leave(two)
        await room.submit_frame("one", one.connection, held)
    assert engine.fighter("one").last_sequence == 5

    clock.value += 10.0
    await manager.join(player("two"), FakeSocket())
    room._apply_deferred_inputs(clock())
    fighter = engine.fighter("one")
    assert fighter.last_sequence == 5
    assert not fighter.pending_actions
    assert fighter.held_input.move_x == 0
    sleep_release.set()
    await manager.close()


async def test_a_pause_returns_both_fighters_held_input_to_neutral(
    repository: Repository,
) -> None:
    sleep_entered = asyncio.Event()
    sleep_release = asyncio.Event()

    async def controlled_sleep(_delay: float) -> None:
        sleep_entered.set()
        await sleep_release.wait()

    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=1000, reconnect_grace=30.0),
        sleep=controlled_sleep,
        match_id_factory=lambda: "match-held-input-pause",
    )
    one = await manager.join(player("one"), FakeSocket())
    two = await manager.join(player("two"), FakeSocket())
    await sleep_entered.wait()
    engine = one.room.engine
    assert engine is not None
    await one.room.submit_frame(
        "one",
        one.connection,
        encode_client_input(
            InputCommand(
                sequence=1,
                client_tick=engine.tick,
                move_x=1000,
                defense=DefensivePose.GUARD_HIGH,
            )
        ),
    )
    await two.room.submit_frame(
        "two",
        two.connection,
        encode_client_input(InputCommand(sequence=1, client_tick=engine.tick, move_y=-1000)),
    )
    assert engine.fighter("one").held_input.move_x == 1000

    await manager.leave(two)
    for player_id in ("one", "two"):
        held = engine.fighter(player_id).held_input
        assert (held.move_x, held.move_y, held.defense) == (0, 0, DefensivePose.NONE)
    sleep_release.set()
    await manager.close()


async def test_a_backlog_after_a_stall_is_dropped_but_a_lasting_flood_ends_the_bout(
    repository: Repository,
) -> None:
    class MutableClock:
        value = 0.0

        def __call__(self) -> float:
            return self.value

    clock = MutableClock()
    sleep_entered = asyncio.Event()
    sleep_release = asyncio.Event()

    async def controlled_sleep(_delay: float) -> None:
        sleep_entered.set()
        await sleep_release.wait()

    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=1000, reconnect_grace=30.0),
        monotonic_clock=clock,
        sleep=controlled_sleep,
        match_id_factory=lambda: "match-flood",
    )
    one = await manager.join(player("one"), FakeSocket())
    await manager.join(player("two"), FakeSocket())
    await sleep_entered.wait()
    room = one.room
    engine = room.engine
    assert engine is not None
    sequence = 0

    async def send(count: int, move_x: int = 0) -> None:
        nonlocal sequence
        for _ in range(count):
            sequence += 1
            await room.submit_frame(
                "one",
                one.connection,
                encode_client_input(
                    InputCommand(sequence=sequence, client_tick=engine.tick, move_x=move_x)
                ),
            )

    await send(20, move_x=0)
    await send(1, move_x=1000)
    clock.value += 1.0
    room._apply_deferred_inputs(clock())
    assert engine.fighter("one").last_sequence == sequence
    assert engine.fighter("one").held_input.move_x == 1000

    with pytest.raises(RoomError, match="rate_limited"):
        for _ in range(40):
            clock.value += 0.1
            await send(1)
            await send(1)
    assert clock.value - 1.0 >= 3.0
    sleep_release.set()
    await manager.close()


async def test_a_connection_that_replaces_a_live_one_starts_with_its_own_input_pacing(
    repository: Repository,
) -> None:
    clock = MutableClock()
    sleep_entered = asyncio.Event()
    sleep_release = asyncio.Event()

    async def controlled_sleep(_delay: float) -> None:
        sleep_entered.set()
        await sleep_release.wait()

    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=1000, reconnect_grace=30.0),
        monotonic_clock=clock,
        sleep=controlled_sleep,
        match_id_factory=lambda: "match-replace",
    )
    one = await manager.join(player("one"), FakeSocket())
    await manager.join(player("two"), FakeSocket())
    await sleep_entered.wait()
    room = one.room
    engine = room.engine
    assert engine is not None
    for sequence in range(1, 10):
        await room.submit_frame(
            "one",
            one.connection,
            encode_client_input(
                InputCommand(sequence=sequence, client_tick=engine.tick, move_x=1000)
            ),
        )
    socket = FakeSocket()
    replacing = await manager.join(player("one"), socket)
    await wait_until(lambda: bool(socket.messages))
    welcome = json.loads(socket.messages[0])
    clock.value += 0.4
    room._apply_deferred_inputs(clock())
    assert engine.fighter("one").last_sequence == 5
    for offset in range(5):
        await room.submit_frame(
            "one",
            replacing.connection,
            encode_client_input(
                InputCommand(sequence=welcome["next_sequence"] + offset, client_tick=engine.tick)
            ),
        )
    assert engine.fighter("one").last_sequence == welcome["next_sequence"] + 4
    sleep_release.set()
    await manager.close()


def ready_choice(style: FighterStyle, *, ready: bool = True) -> StyleChoice:
    return StyleChoice(style, ready)


def shown_styles(message: dict[str, object]) -> dict[str, str]:
    return {entry["id"]: entry["style"] for entry in message["players"] if "style" in entry}


async def test_fighters_pick_styles_and_the_bout_starts_when_both_are_ready(
    repository: Repository,
) -> None:
    manager = HandsRoomManager(repository, config=room_config(round_ticks=600, style_select=5.0))
    first_socket, second_socket = FakeSocket(), FakeSocket()
    one = await manager.join(player("one"), first_socket)
    two = await manager.join(player("two"), second_socket)
    room = one.room
    await wait_until(lambda: "select" in message_types(first_socket))
    assert room.engine is None
    opening = payloads(first_socket, "select")[0]
    assert 4000 < opening["deadline_ms"] <= 5000
    assert opening["ready"] == [] and shown_styles(opening) == {}
    assert [entry["id"] for entry in opening["players"]] == ["one", "two"]

    await room.choose_style("one", one.connection, ready_choice(FighterStyle.SLUGGER))
    await wait_until(lambda: len(payloads(second_socket, "select")) == 2)
    # The other corner learns that one has settled, never on what: both are revealed at the bell.
    assert payloads(second_socket, "select")[1]["ready"] == ["one"]
    assert shown_styles(payloads(second_socket, "select")[1]) == {}
    assert shown_styles(payloads(first_socket, "select")[1]) == {"one": "slugger"}
    assert room.engine is None

    await room.choose_style(
        "two", two.connection, ready_choice(FighterStyle.COUNTER_PUNCHER, ready=False)
    )
    assert room.engine is None
    # A style still being chosen is not shown to anyone, and a settled one only to its fighter.
    watcher_socket = FakeSocket()
    await manager.join(player("three"), watcher_socket)
    await wait_until(lambda: "select" in message_types(watcher_socket))
    assert shown_styles(payloads(watcher_socket, "welcome")[0]) == {}
    assert shown_styles(payloads(watcher_socket, "select")[0]) == {}
    await room.choose_style("two", two.connection, ready_choice(FighterStyle.BOXER))
    engine = room.engine
    assert engine is not None
    assert engine.fighter("one").style is FighterStyle.SLUGGER
    assert engine.fighter("two").style is FighterStyle.BOXER
    await wait_until(lambda: "ready" in message_types(first_socket))
    ready = payloads(first_socket, "ready")[0]
    assert {entry["id"]: entry["style"] for entry in ready["players"]} == {
        "one": "slugger",
        "two": "boxer",
    }
    await manager.close()


async def test_the_deadline_starts_the_bout_with_each_fighters_choice(
    repository: Repository,
) -> None:
    manager = HandsRoomManager(repository, config=room_config(round_ticks=600, style_select=0.15))
    first_socket = FakeSocket()
    one = await manager.join(player("one"), first_socket)
    # Before the pick begins a style changes nothing.
    await one.room.choose_style("one", one.connection, ready_choice(FighterStyle.SWARMER))
    two = await manager.join(player("two"), FakeSocket())
    await two.room.choose_style(
        "two", two.connection, ready_choice(FighterStyle.COUNTER_PUNCHER, ready=False)
    )
    await two.room.choose_style(
        "two", two.connection, ready_choice(FighterStyle.SLUGGER, ready=False)
    )
    assert one.room.engine is None
    await wait_until(lambda: one.room.engine is not None)
    engine = one.room.engine
    assert engine is not None
    assert engine.fighter("one").style is FighterStyle.BALANCED
    assert engine.fighter("two").style is FighterStyle.SLUGGER
    await wait_until(lambda: "ready" in message_types(first_socket))
    await manager.close()


async def test_a_fighter_who_never_picks_boxes_balanced(repository: Repository) -> None:
    manager = HandsRoomManager(repository, config=room_config(round_ticks=600, style_select=0.1))
    one = await manager.join(player("one"), FakeSocket())
    await manager.join(player("two"), FakeSocket())
    await wait_until(lambda: one.room.engine is not None)
    engine = one.room.engine
    assert engine is not None
    assert {engine.fighter(pid).style for pid in ("one", "two")} == {FighterStyle.BALANCED}
    await manager.close()


async def test_whoever_arrives_during_the_pick_is_told_about_it(repository: Repository) -> None:
    manager = HandsRoomManager(repository, config=room_config(round_ticks=600, style_select=5.0))
    one = await manager.join(player("one"), FakeSocket())
    two = await manager.join(player("two"), FakeSocket())
    await one.room.choose_style("one", one.connection, ready_choice(FighterStyle.BOXER))

    returning = FakeSocket()
    one_again = await manager.join(player("one"), returning)
    await wait_until(lambda: "select" in message_types(returning))
    assert payloads(returning, "select")[-1]["ready"] == ["one"]
    assert shown_styles(payloads(returning, "select")[-1]) == {"one": "boxer"}
    # The returning client offers its remembered style again; the settled pick stands.
    await one_again.room.choose_style(
        "one", one_again.connection, ready_choice(FighterStyle.SLUGGER, ready=False)
    )

    watcher_socket = FakeSocket()
    watcher = await manager.join(player("three"), watcher_socket)
    assert watcher.role == "spectator"
    await wait_until(lambda: "select" in message_types(watcher_socket))
    assert "snapshot" not in message_types(watcher_socket)
    with pytest.raises(RoomError) as raised:
        await watcher.room.choose_style(
            "three", watcher.connection, ready_choice(FighterStyle.SLUGGER)
        )
    assert raised.value.code == "spectator_read_only"
    await two.room.choose_style("two", two.connection, ready_choice(FighterStyle.SLUGGER))
    engine = one.room.engine
    assert engine is not None
    assert engine.fighter("one").style is FighterStyle.BOXER
    await manager.close()


async def test_the_computer_picks_at_once_and_waits_for_the_fighter(
    repository: Repository,
) -> None:
    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=600, style_select=5.0),
        seed_factory=lambda: 4242,
    )
    socket = FakeSocket()
    one = await manager.join(player("one"), socket)
    await wait_until(lambda: "waiting" in message_types(socket))
    assert await one.room.request_cpu("one", one.connection, CpuLevel.CHAMPION)
    assert one.room.engine is None
    await wait_until(lambda: "select" in message_types(socket))
    computer_style = cpu_style(CpuLevel.CHAMPION, 4242)
    select = payloads(socket, "select")[0]
    assert select["ready"] == ["cpu:champion"]
    # The computer has settled, but its style is revealed at the bell like anyone's.
    assert shown_styles(select) == {}
    assert [entry["id"] for entry in select["players"]] == ["one", "cpu:champion"]
    assert not await one.room.request_cpu("one", one.connection, CpuLevel.ROOKIE)

    await one.room.choose_style("one", one.connection, ready_choice(FighterStyle.SWARMER))
    engine = one.room.engine
    assert engine is not None
    assert engine.fighter("cpu:champion").style is computer_style
    assert engine.fighter("one").style is FighterStyle.SWARMER
    computer = one.room.cpu
    assert computer is not None and computer.brain is not None
    assert computer.brain.style is computer_style
    await manager.close()


async def test_a_friend_who_arrives_during_the_computers_pick_takes_its_seat(
    repository: Repository,
) -> None:
    manager = HandsRoomManager(
        repository,
        config=room_config(style_select=5.0),
        match_id_factory=lambda: "match-friend",
    )
    first_socket = FakeSocket()
    one = await manager.join(player("one"), first_socket)
    assert await one.room.request_cpu("one", one.connection, CpuLevel.CHAMPION)
    await wait_until(lambda: "select" in message_types(first_socket))

    second_socket = FakeSocket()
    friend = await manager.join(player("two"), second_socket)
    assert friend.role == "fighter"
    assert friend.room is one.room
    assert one.room.cpu is None
    await wait_until(lambda: len(payloads(first_socket, "select")) == 2)
    fresh = payloads(first_socket, "select")[-1]
    assert [entry["id"] for entry in fresh["players"]] == ["one", "two"]
    assert not any(entry.get("cpu") for entry in fresh["players"])
    assert fresh["ready"] == [] and fresh["deadline_ms"] > 4000
    assert message_types(second_socket) == ["welcome", "select"]
    # The computer cannot come back into the pick, and a third arrival watches.
    assert not await one.room.request_cpu("one", one.connection, CpuLevel.ROOKIE)
    watcher = await manager.join(player("three"), FakeSocket())
    assert watcher.role == "spectator"

    await one.room.choose_style("one", one.connection, ready_choice(FighterStyle.BOXER))
    await friend.room.choose_style("two", friend.connection, ready_choice(FighterStyle.SLUGGER))
    engine = one.room.engine
    assert engine is not None and engine.players == ("one", "two")
    await wait_until(lambda: "final" in message_types(first_socket), deadline_seconds=5)
    # A bout between two people is rated.
    assert await repository.get_hands_match("match-friend") is not None
    await manager.close()


async def test_the_computer_keeps_its_seat_once_the_bout_is_on(repository: Repository) -> None:
    manager = HandsRoomManager(repository, config=room_config(round_ticks=600))
    one = await manager.join(player("one"), FakeSocket())
    assert await one.room.request_cpu("one", one.connection, CpuLevel.ROOKIE)
    assert one.room.engine is not None
    late = await manager.join(player("two"), FakeSocket())
    assert late.role == "spectator"
    assert one.room.cpu is not None
    await manager.close()


async def test_the_computer_cannot_be_called_once_two_fighters_are_picking(
    repository: Repository,
) -> None:
    manager = HandsRoomManager(repository, config=room_config(round_ticks=600, style_select=5.0))
    one = await manager.join(player("one"), FakeSocket())
    await manager.join(player("two"), FakeSocket())
    assert not await one.room.request_cpu("one", one.connection, CpuLevel.ROOKIE)
    assert one.room.cpu is None
    await manager.close()


async def test_an_opponent_who_never_comes_back_returns_the_room_to_waiting(
    repository: Repository,
) -> None:
    manager = HandsRoomManager(
        repository, config=room_config(round_ticks=600, style_select=5.0, reconnect_grace=0.05)
    )
    first_socket = FakeSocket()
    one = await manager.join(player("one"), first_socket)
    two = await manager.join(player("two"), FakeSocket())
    await wait_until(lambda: "select" in message_types(first_socket))
    await manager.leave(two)
    await wait_until(lambda: message_types(first_socket)[-1] == "waiting")
    assert one.room.engine is None
    assert one.room.player_ids == ("one",)
    # The corner can be filled again, and the pick starts over.
    third_socket = FakeSocket()
    await manager.join(player("three"), third_socket)
    await wait_until(lambda: "select" in message_types(third_socket))
    await manager.close()


def connected_flags(message: dict[str, object]) -> dict[str, bool]:
    return {entry["id"]: entry["connected"] for entry in message["players"]}


async def test_a_drop_and_a_return_during_the_pick_reach_the_other_corner(
    repository: Repository,
) -> None:
    manager = HandsRoomManager(
        repository, config=room_config(round_ticks=600, style_select=5.0, reconnect_grace=5.0)
    )
    first_socket, second_socket = FakeSocket(), FakeSocket()
    one = await manager.join(player("one"), first_socket)
    two = await manager.join(player("two"), second_socket)
    await wait_until(lambda: "select" in message_types(first_socket))

    await manager.leave(two)
    await wait_until(lambda: len(payloads(first_socket, "select")) == 2)
    assert connected_flags(payloads(first_socket, "select")[-1]) == {"one": True, "two": False}
    # The pick goes on: a pause belongs to the bout, which has not started.
    assert "paused" not in message_types(first_socket)

    returning = FakeSocket()
    await manager.join(player("two"), returning)
    await wait_until(lambda: len(payloads(first_socket, "select")) == 3)
    assert connected_flags(payloads(first_socket, "select")[-1]) == {"one": True, "two": True}
    assert message_types(returning) == ["welcome", "select"]
    assert connected_flags(payloads(returning, "select")[0]) == {"one": True, "two": True}
    assert one.room.engine is None
    await manager.close()


async def test_a_fighter_who_arrives_while_the_other_is_away_sees_him_away_in_the_pick(
    repository: Repository,
) -> None:
    manager = HandsRoomManager(
        repository, config=room_config(round_ticks=600, style_select=5.0, reconnect_grace=5.0)
    )
    one = await manager.join(player("one"), FakeSocket())
    await manager.leave(one)
    second_socket = FakeSocket()
    await manager.join(player("two"), second_socket)
    await wait_until(lambda: "select" in message_types(second_socket))
    assert message_types(second_socket) == ["welcome", "select"]
    assert connected_flags(payloads(second_socket, "select")[0]) == {"one": False, "two": True}

    first_again = FakeSocket()
    await manager.join(player("one"), first_again)
    await wait_until(lambda: len(payloads(second_socket, "select")) == 2)
    assert connected_flags(payloads(second_socket, "select")[-1]) == {"one": True, "two": True}
    assert "paused" not in message_types(second_socket)
    await manager.close()


async def test_a_seat_still_empty_at_the_bell_opens_the_bout_paused(
    repository: Repository,
) -> None:
    manager = HandsRoomManager(
        repository, config=room_config(round_ticks=600, style_select=0.1, reconnect_grace=5.0)
    )
    first_socket = FakeSocket()
    one = await manager.join(player("one"), first_socket)
    two = await manager.join(player("two"), FakeSocket())
    await manager.leave(two)
    await wait_until(lambda: "paused" in message_types(first_socket))
    after_pick = message_types(first_socket)[message_types(first_socket).index("ready") :]
    assert after_pick[:2] == ["ready", "paused"]
    paused = payloads(first_socket, "paused")[0]
    assert paused["player_id"] == "two"
    assert 3000 < paused["grace_ms"] <= 5000
    engine = one.room.engine
    assert engine is not None
    paused_at = engine.tick
    await asyncio.sleep(0.05)
    assert engine.tick == paused_at

    await manager.join(player("two"), FakeSocket())
    await wait_until(lambda: "resumed" in message_types(first_socket))
    await wait_until(lambda: engine.tick > paused_at)
    await manager.close()


async def test_a_seat_that_opens_during_the_pick_goes_to_the_waiting_spectator(
    repository: Repository,
) -> None:
    tickets = iter(f"seat-ticket-{index}" for index in range(10))
    manager = HandsRoomManager(
        repository,
        config=room_config(style_select=5.0, reconnect_grace=0.05),
        match_id_factory=lambda: "match-seated",
    )
    first_socket = FakeSocket()
    one = await manager.join(player("one"), first_socket)
    two = await manager.join(player("two"), FakeSocket())
    watcher_socket = FakeSocket()
    watcher = await manager.join(
        player("three"), watcher_socket, reconnect_ticket_factory=lambda: next(tickets)
    )
    assert watcher.role == "spectator"
    with pytest.raises(RoomError, match="spectator_read_only"):
        await watcher.room.request_cpu("three", watcher.connection, CpuLevel.ROOKIE)

    # Two never comes back: his seat goes to the spectator, on the connection he already has.
    await manager.leave(two)
    await wait_until(lambda: one.room.player_ids == ("one", "three"))
    assert one.room.spectator_ids == ()
    await wait_until(lambda: message_types(watcher_socket)[-2:] == ["welcome", "select"])
    # Watching: the pick, then two dropping out of it. Seated: welcomed again, and a fresh pick.
    assert message_types(watcher_socket) == ["welcome", "select", "select", "welcome", "select"]
    seated = payloads(watcher_socket, "welcome")[1]
    assert (seated["role"], seated["seat"], seated["next_sequence"]) == ("fighter", 2, 0)
    assert seated["reconnect_ticket"] == "seat-ticket-1"
    assert watcher_socket.uncompressed == ["welcome", "welcome"]
    fresh = payloads(first_socket, "select")[-1]
    assert [entry["id"] for entry in fresh["players"]] == ["one", "three"]
    assert fresh["ready"] == [] and fresh["deadline_ms"] > 4000

    # He picks through the membership he joined with, and the bout is his.
    await one.room.choose_style("one", one.connection, ready_choice(FighterStyle.BOXER))
    await watcher.room.choose_style("three", watcher.connection, ready_choice(FighterStyle.SWARMER))
    engine = one.room.engine
    assert engine is not None and engine.players == ("one", "three")
    assert engine.fighter("three").style is FighterStyle.SWARMER
    await wait_until(lambda: "final" in message_types(watcher_socket), deadline_seconds=5)
    assert await repository.get_hands_match("match-seated") is not None
    await manager.close()


async def test_a_seated_spectator_who_leaves_keeps_his_seat_through_the_grace(
    repository: Repository,
) -> None:
    manager = HandsRoomManager(
        repository, config=room_config(style_select=5.0, reconnect_grace=0.05)
    )
    first_socket = FakeSocket()
    one = await manager.join(player("one"), first_socket)
    two = await manager.join(player("two"), FakeSocket())
    watcher = await manager.join(player("three"), FakeSocket())
    await manager.leave(two)
    await wait_until(lambda: one.room.player_ids == ("one", "three"))
    room = one.room

    await manager.leave(watcher)
    # A fighter's place now, so leaving is a drop with a grace, as for anyone seated.
    assert room.player_ids == ("one", "three")
    await wait_until(
        lambda: (
            connected_flags(payloads(first_socket, "select")[-1]) == {"one": True, "three": False}
        )
    )
    returning = FakeSocket()
    again = await manager.join(player("three"), returning)
    assert again.role == "fighter" and again.room is room
    await manager.close()


async def finished_bout(
    manager: HandsRoomManager, first: str = "one", second: str | None = "two"
) -> HandsRoom:
    """A bout fought to its result in instance-1, whose room is then retired."""
    socket = FakeSocket()
    one = await manager.join(player(first), socket)
    if second is None:
        assert await one.room.request_cpu(first, one.connection, CpuLevel.ROOKIE)
    else:
        two = await manager.join(player(second), FakeSocket())
        await two.room.choose_style(second, two.connection, ready_choice(FighterStyle.BOXER))
    await one.room.choose_style(first, one.connection, ready_choice(FighterStyle.BOXER))
    await wait_until(lambda: "final" in message_types(socket), deadline_seconds=5)
    await wait_until(lambda: manager.room_count == 0)
    return one.room


async def test_the_rematch_room_holds_the_fighters_seats_and_seats_others_as_spectators(
    repository: Repository,
) -> None:
    manager = HandsRoomManager(repository, config=room_config(style_select=5.0))
    old = await finished_bout(manager)
    assert set(old.rematch_fighters) == {"one", "two"}

    # Somebody who relaunches before the fighters are back cannot take a seat.
    early_socket = FakeSocket()
    early = await manager.join(player("three"), early_socket)
    assert early.role == "spectator" and early.room is not old
    await wait_until(lambda: message_types(early_socket) == ["welcome", "waiting"])
    welcome, waiting = (json.loads(message) for message in early_socket.messages)
    assert welcome["players"] == []
    assert waiting["open_seats"] == 2

    first_socket = FakeSocket()
    one = await manager.join(player("one"), first_socket)
    assert one.role == "fighter" and one.room is early.room
    latecomer = await manager.join(player("four"), FakeSocket())
    assert latecomer.role == "spectator"
    await manager.join(player("two"), FakeSocket())
    assert one.room.player_ids == ("one", "two")
    assert one.room.spectator_ids == ("three", "four")
    await wait_until(lambda: "select" in message_types(early_socket))
    await manager.close()


async def test_a_held_seat_nobody_comes_back_for_goes_to_whoever_waits_for_it(
    repository: Repository,
) -> None:
    manager = HandsRoomManager(repository, config=room_config(style_select=5.0, rematch_seat=0.2))
    await finished_bout(manager)
    watcher_socket = FakeSocket()
    watcher = await manager.join(player("three"), watcher_socket)
    first_socket = FakeSocket()
    one = await manager.join(player("one"), first_socket)
    assert (watcher.role, one.role) == ("spectator", "fighter")

    # Two never comes back: once the window is over, his seat goes to the one watching.
    await wait_until(lambda: one.room.player_ids == ("one", "three"), deadline_seconds=2)
    assert message_types(watcher_socket)[-2:] == ["welcome", "select"]
    assert payloads(watcher_socket, "welcome")[-1]["role"] == "fighter"
    await wait_until(lambda: "select" in message_types(first_socket))
    assert [entry["id"] for entry in payloads(first_socket, "select")[-1]["players"]] == [
        "one",
        "three",
    ]
    await manager.close()


async def test_a_seat_is_held_only_for_those_still_in_the_ring_at_the_result(
    repository: Repository,
) -> None:
    manager = HandsRoomManager(repository, config=room_config(style_select=5.0))
    # Against the computer, only the person's seat is held: a friend can take the other.
    await finished_bout(manager, second=None)
    friend = await manager.join(player("two"), FakeSocket())
    assert friend.role == "fighter"
    await manager.close()

    manager = HandsRoomManager(
        repository, config=room_config(round_ticks=100_000, reconnect_grace=0.05)
    )
    first_socket = FakeSocket()
    one = await manager.join(player("one"), first_socket)
    two = await manager.join(player("two"), FakeSocket())
    # Two walks out and forfeits: nobody holds his seat for him.
    await manager.leave(two)
    await wait_until(lambda: "final" in message_types(first_socket), deadline_seconds=5)
    await wait_until(lambda: manager.room_count == 0)
    assert one.room.rematch_fighters == ("one",)
    newcomer = await manager.join(player("three"), FakeSocket())
    assert newcomer.role == "fighter"
    await manager.close()


async def test_a_style_sent_after_the_bell_changes_nothing(repository: Repository) -> None:
    manager = HandsRoomManager(repository, config=room_config(round_ticks=600))
    one = await manager.join(player("one"), FakeSocket())
    await manager.join(player("two"), FakeSocket())
    engine = one.room.engine
    assert engine is not None
    await one.room.choose_style("one", one.connection, ready_choice(FighterStyle.SLUGGER))
    assert engine.fighter("one").style is FighterStyle.BALANCED
    await manager.close()


async def test_a_flood_of_style_picks_is_throttled_with_the_fighters_inputs(
    repository: Repository,
) -> None:
    manager = HandsRoomManager(repository, config=room_config(round_ticks=600, style_select=5.0))
    first_socket = FakeSocket()
    one = await manager.join(player("one"), first_socket)
    two = await manager.join(player("two"), FakeSocket())
    await wait_until(lambda: "select" in message_types(first_socket))
    limit = 8
    for _ in range(limit):
        await two.room.choose_style(
            "two", two.connection, ready_choice(FighterStyle.BOXER, ready=False)
        )
    # Over the rate a pick is dropped, settled or not.
    await two.room.choose_style("two", two.connection, ready_choice(FighterStyle.SLUGGER))
    assert one.room.engine is None
    with pytest.raises(RoomError, match="rate_limited"):
        for _ in range(4 * limit):
            await two.room.choose_style(
                "two", two.connection, ready_choice(FighterStyle.SLUGGER, ready=False)
            )
    await one.room.choose_style("one", one.connection, ready_choice(FighterStyle.SWARMER))
    assert one.room.engine is None
    await manager.close()


async def test_a_rated_bout_records_and_logs_both_fighters_styles(
    repository: Repository, monkeypatch: pytest.MonkeyPatch
) -> None:
    safe_logger = MagicMock()
    monkeypatch.setattr(rooms_module, "logger", safe_logger)
    manager = HandsRoomManager(
        repository,
        config=room_config(style_select=5.0),
        match_id_factory=lambda: "match-styles",
    )
    first_socket = FakeSocket()
    one = await manager.join(player("one"), first_socket)
    two = await manager.join(player("two"), FakeSocket())
    await one.room.choose_style("one", one.connection, ready_choice(FighterStyle.SWARMER))
    await two.room.choose_style("two", two.connection, ready_choice(FighterStyle.SLUGGER))
    await wait_until(lambda: "final" in message_types(first_socket), deadline_seconds=5)

    match = await repository.get_hands_match("match-styles")
    assert match is not None
    stored = json.loads(match.result_json)
    assert (stored["player_one_style"], stored["player_two_style"]) == ("swarmer", "slugger")
    safe_logger.info.assert_any_call(
        "Hands bout started",
        instance_id="instance-1",
        match_id="match-styles",
        cpu_level=None,
        player_one_style="swarmer",
        player_two_style="slugger",
    )
    await manager.close()


def test_the_engine_counts_each_fighters_punches_as_the_events_show_them() -> None:
    engine = BoxingEngine(
        match_id="match-count",
        activity_instance_id="instance-1",
        guild_id="guild-1",
        player_one_id="one",
        player_two_id="two",
        seed=29,
        config=EngineConfig(rounds=1, round_ticks=2400, countdown_ticks=0),
    )
    brains = [
        CpuBrain("one", "two", CpuLevel.CHAMPION, 3, FighterStyle.SWARMER),
        CpuBrain("two", "one", CpuLevel.CONTENDER, 5, FighterStyle.BOXER),
    ]
    events: list[CombatEvent] = []
    while engine.result is None and engine.tick < 2400:
        for brain in brains:
            command = brain.decide(engine)
            if command is not None:
                engine.submit_input(brain.player_id, command)
        events.extend(engine.step().events)

    def guarded(hit: CombatEvent) -> bool:
        return any(
            other.kind in {"block", "perfect_block"}
            and other.tick == hit.tick
            and other.action_id == hit.action_id
            for other in events
        )

    blocked = 0
    for fighter_id in ("one", "two"):
        starts = [e for e in events if e.kind == "punch_start" and e.actor_id == fighter_id]
        hits = [e for e in events if e.kind in {"hit", "counter_hit"} and e.actor_id == fighter_id]
        clean = [hit for hit in hits if not guarded(hit)]
        blocked += len(hits) - len(clean)
        assert engine.fighter(fighter_id).punches == PunchCount(
            thrown=len(starts),
            landed=len(clean),
            jabs_thrown=sum(e.detail.split(":")[1] == "jab" for e in starts),
            jabs_landed=sum(hit.detail.split(":")[0] == "jab" for hit in clean),
        )
    # The bout had punches the guard took, which do not count as landed.
    assert blocked > 0


async def test_the_final_carries_the_engines_punch_counts_for_the_whole_bout(
    repository: Repository,
) -> None:
    manager = HandsRoomManager(repository, config=room_config(round_ticks=90))
    socket = FakeSocket()
    one = await manager.join(player("one"), socket)
    assert await one.room.request_cpu("one", one.connection, CpuLevel.CHAMPION)
    engine = one.room.engine
    assert engine is not None
    await wait_until(lambda: "final" in message_types(socket), deadline_seconds=5)
    final = payloads(socket, "final")[0]
    assert set(final["punches"]) == {"one", "cpu:champion"}
    for fighter_id, counted in final["punches"].items():
        assert counted == asdict(engine.fighter(fighter_id).punches)
    assert final["punches"]["cpu:champion"]["thrown"] > 0
    await manager.close()


async def test_a_flood_of_inputs_after_the_result_is_cut_off_through_the_hold(
    repository: Repository,
) -> None:
    manager = HandsRoomManager(repository, config=room_config(result_hold=1.0))
    socket = FakeSocket()
    one = await manager.join(player("one"), socket)
    assert await one.room.request_cpu("one", one.connection, CpuLevel.ROOKIE)
    await wait_until(lambda: "final" in message_types(socket), deadline_seconds=5)
    frame = encode_client_input(InputCommand(sequence=0, client_tick=0))
    limit = 8
    # Inputs in flight as the bout ends are dropped without a word.
    for _ in range(limit):
        await one.room.submit_frame("one", one.connection, frame)
    # A stream of them through the result hold draws on the same allowance as any other.
    with pytest.raises(RoomError, match="rate_limited"):
        for _ in range(4 * limit):
            await one.room.submit_frame("one", one.connection, frame)
    await manager.close()


async def test_a_rematch_picks_styles_afresh(repository: Repository) -> None:
    manager = HandsRoomManager(repository, config=room_config(round_ticks=30, style_select=5.0))
    first_socket = FakeSocket()
    one = await manager.join(player("one"), first_socket)
    two = await manager.join(player("two"), FakeSocket())
    await one.room.choose_style("one", one.connection, ready_choice(FighterStyle.SLUGGER))
    await two.room.choose_style("two", two.connection, ready_choice(FighterStyle.BOXER))
    await wait_until(lambda: "final" in message_types(first_socket), deadline_seconds=5)
    await wait_until(lambda: manager.room_count == 0)

    rematch_socket = FakeSocket()
    one_again = await manager.join(player("one"), rematch_socket)
    assert one_again.room is not one.room
    two_again = await manager.join(player("two"), FakeSocket())
    await wait_until(lambda: "select" in message_types(rematch_socket))
    opening = payloads(rematch_socket, "select")[0]
    assert opening["ready"] == [] and shown_styles(opening) == {}
    await one_again.room.choose_style(
        "one", one_again.connection, ready_choice(FighterStyle.SWARMER)
    )
    await two_again.room.choose_style(
        "two", two_again.connection, ready_choice(FighterStyle.SLUGGER)
    )
    engine = one_again.room.engine
    assert engine is not None
    assert engine.fighter("one").style is FighterStyle.SWARMER
    assert engine.fighter("two").style is FighterStyle.SLUGGER
    await manager.close()


async def test_a_computer_bout_pauses_with_its_fighter_and_resumes_on_his_reconnect(
    repository: Repository,
) -> None:
    manager = HandsRoomManager(
        repository, config=room_config(round_ticks=100_000, reconnect_grace=5.0)
    )
    one = await manager.join(player("one"), FakeSocket(), reconnect_ticket="first-rotation")
    assert await one.room.request_cpu("one", one.connection, CpuLevel.CHAMPION)
    engine = one.room.engine
    assert engine is not None
    computer = engine.fighter("cpu:champion")
    await wait_until(lambda: engine.tick > 20)

    await manager.leave(one)
    # Nobody walks or guards on what he held when the pause began, the computer included, and the
    # computer does not box on while its opponent is away.
    for fighter_id in ("one", "cpu:champion"):
        held = engine.fighter(fighter_id).held_input
        assert (held.move_x, held.move_y, held.defense) == (0, 0, DefensivePose.NONE)
    paused_at = (engine.tick, computer.last_sequence)
    await asyncio.sleep(0.05)
    assert (engine.tick, computer.last_sequence) == paused_at

    socket = FakeSocket()
    again = await manager.join(player("one"), socket, reconnect_ticket="next-rotation")
    assert again.room is one.room
    await wait_until(lambda: len(socket.messages) >= 3)
    assert message_types(socket)[:3] == ["welcome", "snapshot", "resumed"]
    assert socket.uncompressed == ["welcome"]
    await wait_until(lambda: computer.last_sequence > paused_at[1])
    await manager.close()


async def test_a_computer_that_fails_mid_bout_voids_it_and_frees_the_instance(
    repository: Repository, monkeypatch: pytest.MonkeyPatch
) -> None:
    safe_logger = MagicMock()
    monkeypatch.setattr(rooms_module, "logger", safe_logger)
    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=100_000),
        match_id_factory=lambda: "match-cpu-failure",
    )
    socket = FakeSocket()
    one = await manager.join(player("one"), socket)
    assert await one.room.request_cpu("one", one.connection, CpuLevel.ROOKIE)
    computer = one.room.cpu
    engine = one.room.engine
    assert computer is not None and computer.brain is not None and engine is not None
    await wait_until(lambda: engine.tick > 5)

    def broken_decide(_engine: object) -> None:
        raise RuntimeError("computer bug")

    monkeypatch.setattr(computer.brain, "decide", broken_decide)
    await wait_until(lambda: manager.room_count == 0)

    assert socket.closed
    assert socket.close_code == 1011
    errors = [json.loads(message) for message in socket.messages if '"type":"error"' in message]
    assert errors == [{"code": "internal_error", "type": "error", "version": 3}]
    safe_logger.exception.assert_called_once()
    assert engine.result is None
    assert await repository.get_hands_match("match-cpu-failure") is None
    rating = await repository.get_hands_rating("guild-1", "one")
    assert rating is not None
    assert (rating.bouts, rating.rating) == (0, 1000)
    # The instance is free for a fresh bout, against the computer again if he likes.
    again_socket = FakeSocket()
    again = await manager.join(player("one"), again_socket)
    assert again.room is not one.room
    await wait_until(lambda: "waiting" in message_types(again_socket))
    assert await again.room.request_cpu("one", again.connection, CpuLevel.ROOKIE)
    await manager.close()


async def test_a_spectator_who_arrives_during_the_pick_gets_the_newest_snapshot_once_it_starts(
    repository: Repository,
) -> None:
    sleep_release = asyncio.Event()

    async def controlled_sleep(_delay: float) -> None:
        await sleep_release.wait()

    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=1000, style_select=5.0),
        sleep=controlled_sleep,
    )
    one = await manager.join(player("one"), FakeSocket())
    two = await manager.join(player("two"), FakeSocket())
    watcher_socket = FakeSocket()
    watcher = await manager.join(player("three"), watcher_socket)
    assert watcher.role == "spectator"
    await wait_until(lambda: "select" in message_types(watcher_socket))
    assert message_types(watcher_socket) == ["welcome", "select"]
    assert watcher_socket.uncompressed == ["welcome"]

    # The watcher's transport is backed up as the bell goes: snapshots wait, newest kept.
    watcher_socket.buffered = SNAPSHOT_BACKLOG_BYTES + 1
    room = one.room
    await room.choose_style("one", one.connection, ready_choice(FighterStyle.BOXER))
    await room.choose_style("two", two.connection, ready_choice(FighterStyle.SLUGGER))
    engine = room.engine
    assert engine is not None
    # The tick loop has stepped once and is parked in its sleep.
    await wait_until(lambda: engine.tick >= 1)
    base = engine.snapshot()
    hit = CombatEvent(event_id=900, tick=base.tick + 1, kind="hit", actor_id="two", amount=12)
    for offset in range(1, 6):
        room._broadcast_snapshot(
            replace(base, tick=base.tick + offset, events=(hit,) if offset == 1 else ())
        )
    await asyncio.sleep(0.05)
    assert "snapshot" not in message_types(watcher_socket)

    watcher_socket.buffered = 0
    await wait_until(lambda: bool(snapshot_payloads(watcher_socket)))
    await asyncio.sleep(0.02)
    snapshots = snapshot_payloads(watcher_socket)
    assert [payload["tick"] for payload in snapshots] == [base.tick + 5]
    events = snapshots[0]["events"]
    assert isinstance(events, list)
    assert 900 in {event["event_id"] for event in events}
    assert {fighter["style"] for fighter in snapshots[0]["fighters"]} == {"boxer", "slugger"}
    sleep_release.set()
    await manager.close()
