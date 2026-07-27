from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from unittest.mock import AsyncMock

import pytest

from intelstream.database.repository import Repository
from intelstream.hands.auth import AuthenticatedPlayer
from intelstream.hands.engine import EngineConfig
from intelstream.hands.protocol import encode_client_input
from intelstream.hands.rooms import HandsRoomManager, RoomConfig, RoomError
from intelstream.hands.types import ActionKind, InputCommand, MovementAction


@dataclass
class FakeSocket:
    messages: list[str] = field(default_factory=list)
    closed: bool = False
    close_code: int | None = None
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
    tick_interval: float = 0.001,
    round_ticks: int = 2,
    reconnect_grace: float = 0.03,
    result_hold: float = 0.0,
    outbound_size: int = 16,
    final_delivery_timeout: float = 1.0,
    max_catch_up_ticks: int = 2,
    max_spectators: int = 20,
) -> RoomConfig:
    return RoomConfig(
        tick_interval_seconds=tick_interval,
        broadcast_every_ticks=1,
        reconnect_grace_seconds=reconnect_grace,
        result_hold_seconds=result_hold,
        final_delivery_timeout_seconds=final_delivery_timeout,
        max_catch_up_ticks=max_catch_up_ticks,
        max_inputs_per_second=5,
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

    assert old.role == replacement.role == "spectator"
    assert old_socket.closed is True
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
        config=room_config(round_ticks=1000, reconnect_grace=0.015),
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
    with pytest.raises(RoomError, match="rate_limited"):
        await one.room.submit_frame(
            "one",
            one.connection,
            encode_client_input(InputCommand(sequence=6, client_tick=engine.tick)),
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

    for sequence in range(5):
        await connected.room.submit_frame(
            "two",
            connected.connection,
            encode_client_input(
                InputCommand(sequence=sequence, client_tick=engine.tick, move_x=1000)
            ),
        )
    with pytest.raises(RoomError, match="rate_limited"):
        await connected.room.submit_frame(
            "two",
            connected.connection,
            encode_client_input(InputCommand(sequence=5, client_tick=engine.tick, move_x=1000)),
        )
    assert engine.snapshot().checksum == checksum
    assert engine.fighter("two").last_sequence == -1
    assert not engine.fighter("two").pending_actions

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
            "version": 1,
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
    assert maximum_queued <= outbound_size + 3
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
async def test_reconnect_waits_for_old_close_then_sends_welcome_snapshot_and_resumed(
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
    close_release = asyncio.Event()
    old_socket = FakeSocket(block_close=close_release)
    old = await manager.join(player("one"), old_socket, reconnect_ticket="old-rotation")
    await manager.join(player("two"), FakeSocket())
    engine = old.room.engine
    assert engine is not None
    engine.fighter("two").get_up_meter = 77

    replacement_socket = FakeSocket()
    replacement_task = asyncio.create_task(
        manager.join(player("one"), replacement_socket, reconnect_ticket="new-rotation")
    )
    await asyncio.sleep(0)
    assert replacement_socket.messages == []
    close_release.set()
    replacement = await replacement_task
    await wait_until(lambda: len(replacement_socket.messages) >= 3)

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
        "version": 1,
    }

    two_socket = FakeSocket()
    await manager.join(player("two"), two_socket)
    await wait_until(lambda: "resumed" in message_types(one_socket))
    assert recovered_one.room.engine is not None
    await manager.close()


async def test_reconnect_rechecks_final_state_after_waiting_for_old_socket_close(
    repository: Repository,
) -> None:
    sleep_entered = asyncio.Event()
    sleep_release = asyncio.Event()

    async def controlled_sleep(_delay: float) -> None:
        sleep_entered.set()
        await sleep_release.wait()

    manager = HandsRoomManager(
        repository,
        config=room_config(round_ticks=1000),
        sleep=controlled_sleep,
        match_id_factory=lambda: "match-final-during-reconnect",
    )
    close_entered = asyncio.Event()
    close_release = asyncio.Event()
    old_socket = FakeSocket(block_close=close_release, close_entered=close_entered)
    membership = await manager.join(player("one"), old_socket)
    await manager.join(player("two"), FakeSocket())
    await sleep_entered.wait()
    engine = membership.room.engine
    assert engine is not None
    engine.phase_ticks_remaining = 1

    reconnect_socket = FakeSocket()
    reconnect_task = asyncio.create_task(
        manager.join(player("one"), reconnect_socket, reconnect_ticket="final-rotation")
    )
    await close_entered.wait()
    sleep_release.set()
    await wait_until(lambda: engine.result is not None)
    close_release.set()
    await reconnect_task
    await wait_until(lambda: "final" in message_types(reconnect_socket))

    assert message_types(reconnect_socket)[:3] == ["welcome", "snapshot", "final"]
    assert "resumed" not in message_types(reconnect_socket)
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
        assert errors == [{"code": "persistence_failed", "type": "error", "version": 1}]
        assert all("database detail" not in message for message in socket.messages)
    await manager.close()


async def test_shutdown_after_result_shields_persistence_from_cancelled_waiter(
    repository: Repository,
) -> None:
    original_record = repository.record_hands_match
    entered = asyncio.Event()
    release = asyncio.Event()

    async def delayed_record(result):
        entered.set()
        await release.wait()
        return await original_record(result)

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

    async def delayed_record(result):
        persistence_entered.set()
        await persistence_release.wait()
        return await original_record(result)

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
    with pytest.raises(RoomError, match="match_complete"):
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
    with pytest.raises(RoomError, match="match_complete"):
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
