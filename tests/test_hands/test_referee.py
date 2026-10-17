from __future__ import annotations

import dataclasses
import json
from math import hypot

import pytest

from intelstream.hands.engine import REFEREE_ID, BoxingEngine
from intelstream.hands.protocol import encode_snapshot
from intelstream.hands.rules import (
    FIGHTER_RADIUS,
    REFEREE_COUNT_STANDOFF,
    REFEREE_DOWN_TICKS,
    REFEREE_HEALTH,
    REFEREE_RADIUS,
    REFEREE_STANDOFF,
    TICKS_PER_SECOND,
)
from intelstream.hands.types import (
    ActionKind,
    Hand,
    MatchPhase,
    MovementAction,
    Power,
    PunchClass,
    Target,
)
from tests.test_hands.test_engine import advance_until, command, make_engine, punch


def settle(engine: BoxingEngine, ticks: int = 120) -> None:
    for _ in range(ticks):
        engine.step()


def put_referee_in_front_of_one(engine: BoxingEngine, distance: int = 60) -> None:
    """Fighter one faces along +x; the referee stands on that line between the two, nearer one."""
    one = engine.fighter("one")
    referee = engine._referee
    referee.x, referee.y = one.x + distance, one.y
    referee.stunned_ticks = 200


def test_the_referee_keeps_to_his_side_of_the_action_at_his_standoff() -> None:
    engine = make_engine(round_ticks=2000)
    settle(engine)
    one, two = engine.fighter("one"), engine.fighter("two")
    referee = engine._referee
    mid_x, mid_y = (one.x + two.x) / 2, (one.y + two.y) / 2
    assert hypot(referee.x - mid_x, referee.y - mid_y) == pytest.approx(REFEREE_STANDOFF, abs=2)
    # Off to the side of the line between them, not on it.
    assert abs(referee.x - mid_x) <= 2
    snapshot = engine.snapshot()
    assert (snapshot.referee.x, snapshot.referee.y) == (referee.x, referee.y)
    # He looks at the action.
    assert snapshot.referee.facing_y < 0


def test_he_parts_a_clinch_from_beside_it_and_with_him_gone_it_just_comes_apart() -> None:
    engine = make_engine(round_ticks=2000)
    settle(engine)
    engine.step(
        {
            "one": command(1, action=MovementAction(ActionKind.CLINCH)),
            "two": command(1, action=MovementAction(ActionKind.CLINCH)),
        }
    )
    advance_until(engine, {"clinch"}, limit=20)
    while engine.fighter("one").clinch_ticks:
        engine.step()
        # Right beside the hold, never inside either man.
        for fighter in (engine.fighter("one"), engine.fighter("two")):
            gap = hypot(engine._referee.x - fighter.x, engine._referee.y - fighter.y)
            assert gap >= FIGHTER_RADIUS + REFEREE_RADIUS - 1
    assert any(event.kind == "referee_break" for event in engine.events)

    gone = make_engine(round_ticks=2000)
    gone._referee.alive = False
    gone.step(
        {
            "one": command(1, action=MovementAction(ActionKind.CLINCH)),
            "two": command(1, action=MovementAction(ActionKind.CLINCH)),
        }
    )
    advance_until(gone, {"clinch"}, limit=20)
    advance_until(gone, {"clinch_break", "referee_break"}, limit=60)
    kinds = [event.kind for event in gone.events]
    assert "clinch_break" in kinds and "referee_break" not in kinds


def test_a_fighter_walking_into_the_referee_shoves_him_aside_and_cannot_walk_through_him() -> None:
    engine = make_engine(round_ticks=2000)
    one = engine.fighter("one")
    one.x, one.y = -200, 0
    engine.fighter("two").x, engine.fighter("two").y = 300, 300
    referee = engine._referee
    referee.x, referee.y = -120, 0
    referee.stunned_ticks = 300
    for sequence in range(1, 40):
        engine.step({"one": command(sequence, move_x=1000)})
        assert hypot(referee.x - one.x, referee.y - one.y) >= FIGHTER_RADIUS + REFEREE_RADIUS - 1
    assert referee.x > -120

    # Pinned against the ropes he cannot give way, so the fighter stops short of him.
    pinned = make_engine(round_ticks=2000)
    walker = pinned.fighter("one")
    walker.x, walker.y = 300, 0
    pinned.fighter("two").x, pinned.fighter("two").y = -300, -300
    pinned._referee.x, pinned._referee.y = 462, 0
    pinned._referee.stunned_ticks = 300
    for sequence in range(1, 40):
        pinned.step({"one": command(sequence, move_x=1000)})
    assert pinned._referee.x == 462
    assert walker.x <= 462 - (FIGHTER_RADIUS + REFEREE_RADIUS) + 1


def test_a_punch_that_finds_the_referee_first_hurts_him_and_not_the_other_man() -> None:
    engine = make_engine(round_ticks=2000)
    put_referee_in_front_of_one(engine)
    two = engine.fighter("two")
    poise, head = two.poise, two.trauma.head
    engine.step({"one": command(1, action=punch(PunchClass.STRAIGHT, hand=Hand.RIGHT))})
    advance_until(engine, {"referee_hit", "hit", "whiff"})
    hits = [event for event in engine.events if event.kind == "referee_hit"]
    assert len(hits) == 1
    hit = hits[0]
    assert (hit.actor_id, hit.target_id, hit.detail) == ("one", REFEREE_ID, "straight:head")
    assert hit.amount > 0 and hit.blood > 0
    referee = engine._referee
    assert referee.health == REFEREE_HEALTH - hit.amount
    assert referee.trauma.head > 0
    assert (two.poise, two.trauma.head) == (poise, head)
    # Nothing scores for it.
    assert engine.fighter("one").performance.clean_hits == 0
    assert engine.fighter("one").damage_dealt == 0
    # He reels where he stands.
    assert referee.stunned_ticks > 0
    assert engine.snapshot().referee.stunned_ticks == referee.stunned_ticks


def test_the_nearer_of_the_referee_and_the_other_man_takes_the_punch() -> None:
    engine = make_engine(round_ticks=2000)
    one, two = engine.fighter("one"), engine.fighter("two")
    one.x, two.x = -45, 45
    referee = engine._referee
    # Behind the other man, the punch finds the other man.
    referee.x, referee.y = 110, 0
    referee.stunned_ticks = 200
    engine.step({"one": command(1, action=punch(PunchClass.STRAIGHT, hand=Hand.RIGHT))})
    assert advance_until(engine, {"referee_hit", "hit", "counter_hit", "whiff"}) == "hit"


def test_enough_punches_put_the_referee_down_for_good_and_stop_the_bout_for_the_replay() -> None:
    engine = make_engine(round_ticks=2000)
    put_referee_in_front_of_one(engine)
    engine._referee.health = 30
    clock_before = engine.phase_ticks_remaining
    engine.step(
        {"one": command(1, action=punch(PunchClass.HOOK, hand=Hand.RIGHT, power=Power.POWER))}
    )
    advance_until(engine, {"referee_down"}, limit=30)
    downs = [event for event in engine.events if event.kind == "referee_down"]
    assert [(event.actor_id, event.target_id) for event in downs] == [("one", REFEREE_ID)]
    assert downs[0].action_id is not None
    referee = engine._referee
    assert not referee.alive
    assert engine.phase is MatchPhase.REFEREE_DOWN
    assert engine.phase_ticks_remaining == REFEREE_DOWN_TICKS
    paused_at = engine.phase_ticks_remaining
    stopped = (referee.x, referee.y)
    # Nobody punches or walks while it plays again.
    for sequence in range(2, 2 + REFEREE_DOWN_TICKS - 1):
        engine.step({"one": command(sequence, action=punch(PunchClass.JAB), move_x=1000)})
        assert engine.phase is MatchPhase.REFEREE_DOWN
        assert engine.fighter("one").attack is None
    assert engine.phase_ticks_remaining == paused_at - (REFEREE_DOWN_TICKS - 1)
    engine.step()
    assert engine.phase is MatchPhase.FIGHT
    assert any(event.detail == "referee_down_complete" for event in engine.events)
    # The clock picks up where it stopped.
    assert clock_before - engine.phase_ticks_remaining < 30
    # He stays where he fell, and punches go through where he lies.
    settle(engine, 30)
    assert (referee.x, referee.y) == stopped
    assert not engine.snapshot().referee.alive
    hits = len([event for event in engine.events if event.kind == "referee_hit"])
    put_referee_in_front_of_one(engine)
    engine.step({"one": command(500, action=punch(PunchClass.STRAIGHT, hand=Hand.RIGHT))})
    settle(engine, 12)
    assert len([event for event in engine.events if event.kind == "referee_hit"]) == hits


def test_a_bleeding_referee_loses_health_every_second_and_can_bleed_out() -> None:
    engine = make_engine(round_ticks=2000)
    engine.fighter("one").x, engine.fighter("two").x = -300, 300
    referee = engine._referee
    referee.last_hit_by = "two"
    referee.trauma.bleeding = 600
    referee.health = 25
    for _ in range(TICKS_PER_SECOND * 3):
        engine.step()
        if not referee.alive:
            break
    assert not referee.alive
    assert any(
        event.kind == "bleed" and event.actor_id == REFEREE_ID and event.blood > 0
        for event in engine.events
    )
    downs = [event for event in engine.events if event.kind == "referee_down"]
    assert [(event.actor_id, event.action_id) for event in downs] == [("two", None)]
    assert engine.phase is MatchPhase.REFEREE_DOWN


def test_he_stands_over_a_man_on_the_canvas_for_the_count() -> None:
    engine = make_engine(round_ticks=2000)
    two = engine.fighter("two")
    two.poise = 1
    engine.step({"one": command(1, action=punch(PunchClass.HOOK, power=Power.POWER))})
    advance_until(engine, {"knockdown"}, limit=30)
    for _ in range(90):
        engine.step()
    referee = engine._referee
    assert hypot(referee.x - two.x, referee.y - two.y) == pytest.approx(
        REFEREE_COUNT_STANDOFF, abs=3
    )


def test_the_snapshot_says_where_he_is_and_how_he_looks_but_never_how_much_he_has_left() -> None:
    engine = make_engine(round_ticks=2000)
    snapshot = engine.step()
    payload = json.loads(encode_snapshot(snapshot, viewer_id="one"))["payload"]
    assert set(payload["referee"]) == {
        "x",
        "y",
        "facing_x",
        "facing_y",
        "velocity_x",
        "velocity_y",
        "stunned_ticks",
        "alive",
        "trauma",
    }
    assert "health" not in json.dumps(payload["referee"])
    # The checksum covers what is hidden too.
    before = engine.snapshot().checksum
    engine._referee.health -= 1
    assert engine.snapshot().checksum != before
    assert dataclasses.asdict(snapshot.referee)["alive"] is True


def test_a_body_shot_on_the_referee_marks_the_body_and_not_the_face() -> None:
    engine = make_engine(round_ticks=2000)
    put_referee_in_front_of_one(engine)
    engine.step(
        {"one": command(1, action=punch(PunchClass.STRAIGHT, hand=Hand.RIGHT, target=Target.BODY))}
    )
    advance_until(engine, {"referee_hit"})
    trauma = engine._referee.trauma
    assert trauma.body > 0
    assert (trauma.head, trauma.left_cut, trauma.right_cut) == (0, 0, 0)
