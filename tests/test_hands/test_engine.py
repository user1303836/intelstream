from __future__ import annotations

import dataclasses
import json
import math
import re
from enum import Enum
from importlib import resources
from math import hypot

import pytest

from intelstream.hands import rules
from intelstream.hands.engine import (
    ACTION_BUFFER_TICKS,
    COUNT_TICK_INTERVAL,
    MAX_PENDING_ACTIONS,
    AttackState,
    BoxingEngine,
    EngineConfig,
    FighterState,
)
from intelstream.hands.protocol import encode_snapshot
from intelstream.hands.rules import (
    BLIND_SIDE_EYE_THRESHOLD,
    BODY_COLLAPSE_DELAY_TICKS,
    BODY_WIND_PERCENT,
    BOX_PAUSE_TICKS,
    CLINCH_HOLD_DISTANCE,
    CORNER_TREATMENTS,
    FIGHTER_RADIUS,
    FLINCH_MINIMUM_DAMAGE,
    FOUL_SEPARATION,
    GET_UP_STUN_TICKS,
    GUARD_BLOCK_MINIMUM,
    MANDATORY_COUNT,
    MINIMUM_SEPARATION,
    PARRY_STAGGER_TICKS,
    PUNCH_RULES,
    REFEREE_WALK_SPEED,
    REST_CORNER_OFFSET,
    RING_CORNER_REACH,
    RING_HALF_HEIGHT,
    RING_HALF_WIDTH,
    ROCKED_HURT_POISE,
    ROCKED_IMMUNITY_TICKS,
    STUN_CHAIN_MAX_TICKS,
    STUN_IMMUNITY_TICKS,
    STUNNED_SPEED_PERCENT,
    TIRED_IMPACT_PERCENT,
    TIRED_RECOVERY_TICKS,
    TIRED_STARTUP_TICKS,
)
from intelstream.hands.types import (
    ActionKind,
    CombatEvent,
    CornerChoice,
    DefensivePose,
    FighterStyle,
    FinishMethod,
    Foul,
    FoulAction,
    Hand,
    InputCommand,
    MatchPhase,
    MovementAction,
    Power,
    PunchAction,
    PunchClass,
    Stance,
    Target,
)


def make_engine(
    seed: int = 7,
    *,
    round_ticks: int = 600,
    rounds: int = 3,
    rest_ticks: int = 10,
    flash: bool = False,
    doctor_cut_threshold: int = 700,
    doctor_swelling_threshold: int = 820,
) -> BoxingEngine:
    engine = BoxingEngine(
        match_id=f"match-{seed}",
        activity_instance_id="instance-1",
        guild_id="guild-1",
        player_one_id="one",
        player_two_id="two",
        seed=seed,
        config=EngineConfig(
            rounds=rounds,
            round_ticks=round_ticks,
            rest_ticks=rest_ticks,
            countdown_ticks=0,
            flash_ko_enabled=flash,
            doctor_cut_threshold=doctor_cut_threshold,
            doctor_swelling_threshold=doctor_swelling_threshold,
        ),
    )
    engine.fighter("one").x = -45
    engine.fighter("two").x = 45
    return engine


def command(
    sequence: int,
    *,
    action: PunchAction | MovementAction | FoulAction | None = None,
    actions: tuple[PunchAction | MovementAction | FoulAction, ...] | None = None,
    defense: DefensivePose = DefensivePose.NONE,
    move_x: int = 0,
    move_y: int = 0,
) -> InputCommand:
    return InputCommand(
        sequence=sequence,
        client_tick=sequence,
        move_x=move_x,
        move_y=move_y,
        defense=defense,
        actions=actions if actions is not None else ((action,) if action else ()),
    )


def punch(
    punch_class: PunchClass = PunchClass.STRAIGHT,
    *,
    hand: Hand = Hand.RIGHT,
    target: Target = Target.HEAD,
    power: Power = Power.NORMAL,
) -> PunchAction:
    return PunchAction(hand, punch_class, target, power)


def advance_until(engine: BoxingEngine, kinds: set[str], limit: int = 100) -> str:
    expected = set(kinds)
    for _ in range(limit):
        snapshot = engine.step()
        for event in snapshot.events:
            if event.kind in expected:
                return event.kind
    raise AssertionError(f"none of {expected} emitted")


@pytest.mark.parametrize(
    ("hand", "punch_class", "target", "power"),
    [
        (hand, punch_class, target, power)
        for hand in Hand
        for punch_class in PunchClass
        for target in Target
        for power in Power
    ],
)
def test_all_punch_variants_use_authored_timing_and_damage(
    hand: Hand, punch_class: PunchClass, target: Target, power: Power
) -> None:
    engine = make_engine()
    defender = engine.fighter("two")

    engine.step(
        {"one": command(1, action=punch(punch_class, hand=hand, target=target, power=power))}
    )
    assert engine.fighter("one").attack is not None
    assert advance_until(engine, {"hit", "counter_hit"}) in {"hit", "counter_hit"}

    if target is Target.HEAD:
        assert defender.trauma.head > 0
    else:
        assert defender.trauma.body > 0
        assert defender.conditioning < 1000


def test_2d_footwork_bounds_collision_facing_and_stance_switch() -> None:
    engine = make_engine(round_ticks=2000)
    one = engine.fighter("one")
    two = engine.fighter("two")
    engine.step(
        {
            "one": command(
                1,
                action=MovementAction(ActionKind.SWITCH_STANCE),
                move_x=-1000,
                move_y=1000,
            )
        }
    )
    for _ in range(300):
        engine.step()

    assert one.stance is Stance.SOUTHPAW
    assert -RING_HALF_WIDTH < one.x < RING_HALF_WIDTH
    assert -RING_HALF_HEIGHT < one.y < RING_HALF_HEIGHT
    assert one.facing in (-1, 1)

    one.x = two.x = 0
    one.y = two.y = 0
    engine.step()
    assert (one.x - two.x) ** 2 + (one.y - two.y) ** 2 > 0


def test_authoritative_movement_caps_diagonals_with_symmetric_integer_motion() -> None:
    def move(move_x: int, move_y: int) -> tuple[int, ...]:
        engine = make_engine(round_ticks=2000)
        fighter = engine.fighter("one")
        fighter.x = fighter.y = 0
        engine.fighter("two").x = 300
        engine.step({"one": command(1, move_x=move_x, move_y=move_y)})
        for _ in range(11):
            engine.step()
        return (
            fighter.x,
            fighter.y,
            fighter.velocity_x,
            fighter.velocity_y,
            fighter.stamina,
            fighter.velocity_fixed_x,
            fighter.velocity_fixed_y,
        )

    cardinal = move(1000, 0)
    diagonal = move(1000, 1000)
    controller_diagonal = move(707, 707)
    negative_diagonal = move(-1000, -1000)

    assert diagonal == controller_diagonal
    assert diagonal[5] ** 2 + diagonal[6] ** 2 <= cardinal[5] ** 2 + cardinal[6] ** 2
    assert diagonal[2] ** 2 + diagonal[3] ** 2 <= cardinal[2] ** 2 + cardinal[3] ** 2
    # Positions carry per-axis integer rounding slack of roughly one unit per axis;
    # the velocity magnitude itself is hard-capped at speed every tick.
    assert diagonal[0] ** 2 + diagonal[1] ** 2 <= (cardinal[0] + 1) ** 2 + 1
    assert negative_diagonal[:4] == tuple(-value for value in diagonal[:4])
    assert negative_diagonal[5:] == tuple(-value for value in diagonal[5:])


def test_fixed_point_movement_is_equal_over_121_ticks_for_every_diagonal_sign() -> None:
    def displacement(move_x: int, move_y: int) -> tuple[int, int]:
        engine = make_engine(seed=90, round_ticks=2000)
        fighter = engine.fighter("one")
        fighter.x = fighter.y = 0
        fighter.conditioning = 0
        fighter.stamina = fighter.maximum_stamina
        opponent = engine.fighter("two")
        opponent.x = -400 if move_x >= 0 else 400
        opponent.y = 280
        engine.step({"one": command(1, move_x=move_x, move_y=move_y)})
        for _ in range(120):
            engine.step()
        return fighter.x, fighter.y

    cardinal_x, cardinal_y = displacement(1000, 0)
    cardinal_distance = hypot(cardinal_x, cardinal_y)
    diagonals = {
        signs: displacement(1000 * signs[0], 1000 * signs[1])
        for signs in ((1, 1), (-1, 1), (1, -1), (-1, -1))
    }

    for diagonal_x, diagonal_y in diagonals.values():
        assert abs(hypot(diagonal_x, diagonal_y) / cardinal_distance - 1) <= 0.02
    assert diagonals[(-1, 1)] == (-diagonals[(1, 1)][0], diagonals[(1, 1)][1])
    assert diagonals[(1, -1)] == (diagonals[(1, 1)][0], -diagonals[(1, 1)][1])
    assert diagonals[(-1, -1)] == tuple(-value for value in diagonals[(1, 1)])


def test_cardinal_and_all_diagonal_signs_have_equal_free_movement_and_replay() -> None:
    vectors = [(1000, 0), (1000, 1000), (-1000, 1000), (1000, -1000), (-1000, -1000)]
    engines = [make_engine(seed=91, round_ticks=2000) for _ in vectors]
    replay = make_engine(seed=91, round_ticks=2000)
    for engine, (move_x, move_y) in zip(engines, vectors, strict=True):
        engine.fighter("one").x = 0
        engine.fighter("two").x = 300
        engine.step({"one": command(1, move_x=move_x, move_y=move_y)})
        for _ in range(120):
            engine.step()
    replay.fighter("one").x = 0
    replay.fighter("two").x = 300
    replay.step({"one": command(1, move_x=1000, move_y=1000)})
    for _ in range(120):
        replay.step()

    resource_states = {
        (fighter.movement_load, fighter.stamina, fighter.conditioning)
        for engine in engines
        for fighter in (engine.fighter("one"),)
    }
    assert resource_states == {(2, 1000, 1000)}
    assert engines[1].snapshot().checksum == replay.snapshot().checksum
    assert encode_snapshot(engines[1].snapshot(), viewer_id="one") == encode_snapshot(
        replay.snapshot(), viewer_id="one"
    )


def test_sub_500_movement_is_free_while_zero_input_recovers_spent_stamina() -> None:
    moving = make_engine(seed=92, round_ticks=2000)
    mover = moving.fighter("one")
    moving.step({"one": command(1, move_x=499)})
    for _ in range(19):
        moving.step()

    assert mover.x > -45
    assert mover.movement_load == 1
    assert mover.stamina == 1000
    assert mover.conditioning == 1000

    stationary = make_engine(seed=93, round_ticks=2000)
    resting = stationary.fighter("one")
    resting.stamina = 700
    for _ in range(20):
        stationary.step()

    assert (resting.x, resting.y) == (-45, 0)
    assert resting.movement_load == 0
    assert resting.stamina > 700
    assert resting.conditioning == 1000


def test_pulsed_and_analog_movement_are_both_free_during_momentum() -> None:
    ticks = 90

    def move(pulsed: bool) -> tuple[int, int, int, list[int]]:
        engine = make_engine(seed=95, round_ticks=2000)
        fighter = engine.fighter("one")
        fighter.x = fighter.y = 0
        engine.fighter("two").x = -400
        neutral_loads: list[int] = []
        for index in range(ticks):
            move_x = 1000 if pulsed and index % 2 == 0 else (0 if pulsed else 499)
            engine.step({"one": command(index + 1, move_x=move_x)})
            if pulsed and move_x == 0:
                neutral_loads.append(fighter.movement_load)
        return fighter.x, fighter.stamina, fighter.conditioning, neutral_loads

    analog_x, analog_stamina, analog_conditioning, _ = move(False)
    pulsed_x, pulsed_stamina, pulsed_conditioning, neutral_loads = move(True)

    assert abs(pulsed_x - analog_x) <= 2
    assert neutral_loads and set(neutral_loads) == {1}
    assert pulsed_stamina == analog_stamina == 1000
    assert pulsed_conditioning == analog_conditioning == 1000


def test_momentum_only_frames_regenerate_at_a_reduced_rate_until_stationary() -> None:
    engine = make_engine(seed=96, round_ticks=2000)
    fighter = engine.fighter("one")
    fighter.stamina = 700
    engine.fighter("two").x = -400
    engine.step({"one": command(1, move_x=1000)})
    for _ in range(9):
        engine.step()
    before_neutral = fighter.stamina
    engine.step({"one": command(2)})

    assert fighter.velocity_fixed_x or fighter.velocity_fixed_y
    assert fighter.movement_load >= 1
    moving_gain = 0
    while fighter.velocity_fixed_x or fighter.velocity_fixed_y:
        before = fighter.stamina
        engine.step()
        if fighter.velocity_fixed_x or fighter.velocity_fixed_y:
            moving_gain += fighter.stamina - before
            assert fighter.movement_load >= 1
            assert fighter.stamina >= before

    stationary = make_engine(seed=97, round_ticks=2000)
    resting = stationary.fighter("one")
    resting.stamina = before_neutral
    stationary_gain = 0
    for _ in range(12):
        before = resting.stamina
        stationary.step()
        stationary_gain += resting.stamina - before

    assert moving_gain > 0
    assert moving_gain < stationary_gain

    stopped_x = fighter.x
    fighter.velocity_fixed_x = 0
    fighter.velocity_fixed_y = 0
    before_recovery = fighter.stamina
    engine.step()

    assert fighter.movement_load == 0
    assert fighter.x == stopped_x
    assert fighter.stamina > before_recovery


def test_corner_posts_keep_fighters_out_of_the_corner_pad() -> None:
    engine = make_engine(seed=95, round_ticks=2000)
    fighter = engine.fighter("one")
    limit = RING_HALF_WIDTH - FIGHTER_RADIUS
    fighter.x = limit - 4
    fighter.y = limit - 4
    engine.fighter("two").x = -300

    for sequence in range(1, 30):
        engine.step({"one": command(sequence, move_x=1000, move_y=1000)})
        assert abs(fighter.x) + abs(fighter.y) <= RING_CORNER_REACH

    assert fighter.x > 0 and fighter.y > 0
    assert abs(fighter.x) + abs(fighter.y) >= RING_CORNER_REACH - 2
    assert abs(fighter.x - fighter.y) <= 2
    assert REST_CORNER_OFFSET * 2 <= RING_CORNER_REACH


@pytest.mark.parametrize(
    ("name", "value", "key"),
    [
        ("FACING_SCALE", 1024, "facing.scale"),
        ("REST_CORNER_OFFSET", RING_CORNER_REACH // 2 + 1, "rest.corner_offset"),
    ],
)
def test_manifest_check_refuses_values_the_engine_cannot_honour(
    monkeypatch: pytest.MonkeyPatch, name: str, value: int, key: str
) -> None:
    rules._manifest_check()
    monkeypatch.setattr(rules, name, value)
    with pytest.raises(RuntimeError, match=re.escape(key)):
        rules._manifest_check()


def test_side_ropes_are_still_reachable_away_from_the_corners() -> None:
    engine = make_engine(seed=96, round_ticks=2000)
    fighter = engine.fighter("one")
    fighter.x = RING_HALF_WIDTH - FIGHTER_RADIUS - 3
    fighter.y = 0
    engine.fighter("two").x = -300

    for sequence in range(1, 6):
        engine.step({"one": command(sequence, move_x=1000)})

    assert fighter.x == RING_HALF_WIDTH - FIGHTER_RADIUS


def in_ring(fighter: object) -> bool:
    x, y = fighter.x, fighter.y  # type: ignore[attr-defined]
    return (
        abs(x) <= RING_HALF_WIDTH - FIGHTER_RADIUS
        and abs(y) <= RING_HALF_HEIGHT - FIGHTER_RADIUS
        and abs(x) + abs(y) <= RING_CORNER_REACH
    )


@pytest.mark.parametrize(
    ("start", "move_one", "move_two"),
    [
        ((341, 215, 315, 334), (1000, 500), (1000, 200)),
        ((286, -229, 413, -209), (1000, -500), (1000, -500)),
        ((272, 304, 194, 326), (0, 1000), (707, 707)),
        ((-351, -314, -206, -413), (-1000, 0), (-1000, 0)),
    ],
)
def test_fighters_pressing_into_a_corner_come_to_rest(
    start: tuple[int, int, int, int], move_one: tuple[int, int], move_two: tuple[int, int]
) -> None:
    engine = make_engine(seed=97, round_ticks=5000)
    one, two = engine.fighter("one"), engine.fighter("two")
    one.x, one.y, two.x, two.y = start

    steps = []
    for sequence in range(1, 261):
        before = (one.x, one.y, two.x, two.y)
        engine.step(
            {
                "one": command(sequence, move_x=move_one[0], move_y=move_one[1]),
                "two": command(sequence, move_x=move_two[0], move_y=move_two[1]),
            }
        )
        assert in_ring(one) and in_ring(two)
        assert (one.x - two.x) ** 2 + (one.y - two.y) ** 2 >= MINIMUM_SEPARATION**2
        after = (one.x, one.y, two.x, two.y)
        steps.append(max(abs(a - b) for a, b in zip(after, before, strict=True)))

    assert max(steps[-60:]) <= 3


def test_fighters_meeting_at_an_angle_are_not_thrown_apart() -> None:
    engine = make_engine(seed=98, round_ticks=5000)
    one, two = engine.fighter("one"), engine.fighter("two")
    one.x, one.y, two.x, two.y = -60, -50, 60, 50

    largest = 0
    closest = hypot(two.x - one.x, two.y - one.y)
    for sequence in range(1, 61):
        before = (one.x, one.y, two.x, two.y)
        engine.step(
            {
                "one": command(sequence, move_x=707, move_y=600),
                "two": command(sequence, move_x=-707, move_y=-600),
            }
        )
        after = (one.x, one.y, two.x, two.y)
        largest = max(largest, *(abs(a - b) for a, b in zip(after, before, strict=True)))
        closest = min(closest, hypot(two.x - one.x, two.y - one.y))

    assert MINIMUM_SEPARATION <= closest <= MINIMUM_SEPARATION + 2
    assert largest <= 8


def test_sliding_along_a_corner_pad_keeps_its_speed_and_is_the_same_both_ways() -> None:
    limit = RING_HALF_WIDTH - FIGHTER_RADIUS
    low = RING_CORNER_REACH - limit

    def slide(start: tuple[int, int], move: tuple[int, int]) -> list[tuple[int, int, int, int]]:
        engine = make_engine(seed=99, round_ticks=5000)
        fighter = engine.fighter("one")
        fighter.x, fighter.y = start
        engine.fighter("two").x = -300
        trail = []
        for sequence in range(1, 21):
            engine.step({"one": command(sequence, move_x=move[0], move_y=move[1])})
            trail.append((fighter.x, fighter.y, fighter.velocity_x, fighter.velocity_y))
        return trail

    up = slide((limit, low), (0, 1000))
    right = slide((low, limit), (1000, 0))
    assert [(y, x, vy, vx) for x, y, vx, vy in up] == right
    assert all(x + y == RING_CORNER_REACH for x, y, _, _ in up)
    assert up[-1][0] < up[0][0] and up[-1][1] > up[0][1]
    assert up[-1][2] < 0 < up[-1][3]

    wedged = slide((low, limit), (259, 966))
    assert {(x, y) for x, y, _, _ in wedged} == {(low, limit)}


@pytest.mark.parametrize(
    ("winner_at", "downed_at"),
    [((367, 366), (300, 300)), ((333, 400), (265, 328)), ((-440, -293), (-370, -230))],
)
def test_cornered_winner_still_reaches_a_neutral_corner(
    winner_at: tuple[int, int], downed_at: tuple[int, int]
) -> None:
    engine = make_engine(seed=100, round_ticks=5000)
    winner, downed = engine.fighter("one"), engine.fighter("two")
    winner.x, winner.y = winner_at
    downed.x, downed.y = downed_at
    engine.step()
    engine._knock_down(downed, winner)
    assert engine.phase is MatchPhase.KNOCKDOWN

    for _ in range(8 * COUNT_TICK_INTERVAL):
        engine.step()
        assert in_ring(winner)
        assert hypot(winner.x - downed.x, winner.y - downed.y) >= MINIMUM_SEPARATION - 8

    corners = [(-REST_CORNER_OFFSET, REST_CORNER_OFFSET), (REST_CORNER_OFFSET, -REST_CORNER_OFFSET)]
    assert min(hypot(winner.x - x, winner.y - y) for x, y in corners) <= REFEREE_WALK_SPEED
    assert (winner.velocity_x, winner.velocity_y) == (0, 0)


def test_clinch_holds_close_whatever_the_angle() -> None:
    engine = make_engine(round_ticks=2000)
    engine.fighter("one").x, engine.fighter("one").y = -30, -36
    engine.fighter("two").x, engine.fighter("two").y = 35, 30
    engine.step({"one": command(1, action=MovementAction(ActionKind.CLINCH))})
    assert advance_until(engine, {"clinch"}, limit=12) == "clinch"

    while engine.fighter("one").clinch_ticks > 1:
        engine.step()
    one, two = engine.fighter("one"), engine.fighter("two")
    assert CLINCH_HOLD_DISTANCE <= hypot(two.x - one.x, two.y - one.y) <= CLINCH_HOLD_DISTANCE + 4


def test_ring_clamp_resets_fixed_point_momentum_and_position_remainder() -> None:
    engine = make_engine(seed=94, round_ticks=2000)
    fighter = engine.fighter("one")
    fighter.x = RING_HALF_WIDTH - FIGHTER_RADIUS - 1
    engine.fighter("two").x = -300

    engine.step({"one": command(1, move_x=1000)})

    assert fighter.x == RING_HALF_WIDTH - FIGHTER_RADIUS
    assert (fighter.velocity_x, fighter.velocity_fixed_x, fighter.position_remainder_x) == (
        0,
        0,
        0,
    )


def test_power_stance_hand_and_eye_localization_change_outcomes() -> None:
    normal = make_engine()
    powered = make_engine()
    normal.step({"one": command(1, action=punch(PunchClass.HOOK, power=Power.NORMAL))})
    powered.step({"one": command(1, action=punch(PunchClass.HOOK, power=Power.POWER))})
    advance_until(normal, {"hit"})
    advance_until(powered, {"hit"})
    assert powered.fighter("two").trauma.head > normal.fighter("two").trauma.head
    assert any(event.kind == "stun" for event in powered.events)

    left = make_engine()
    right = make_engine()
    left.step({"one": command(1, action=punch(PunchClass.HOOK, hand=Hand.LEFT))})
    right.step({"one": command(1, action=punch(PunchClass.HOOK, hand=Hand.RIGHT))})
    advance_until(left, {"hit"})
    advance_until(right, {"hit"})
    assert left.fighter("two").trauma.right_eye > left.fighter("two").trauma.left_eye
    assert right.fighter("two").trauma.left_eye > right.fighter("two").trauma.right_eye

    orthodox = make_engine()
    southpaw = make_engine()
    southpaw.fighter("one").stance = Stance.SOUTHPAW
    orthodox.step({"one": command(1, action=punch(PunchClass.JAB, hand=Hand.LEFT))})
    southpaw.step({"one": command(1, action=punch(PunchClass.JAB, hand=Hand.LEFT))})
    orthodox_attack = orthodox.fighter("one").attack
    southpaw_attack = southpaw.fighter("one").attack
    assert orthodox_attack is not None and southpaw_attack is not None
    assert orthodox_attack.rule.startup < southpaw_attack.rule.startup


def test_range_and_eye_damage_can_turn_a_punch_into_a_whiff() -> None:
    engine = make_engine()
    engine.fighter("two").x = 300
    engine.step({"one": command(1, action=punch())})
    assert advance_until(engine, {"whiff"}) == "whiff"

    impaired = make_engine()
    impaired.fighter("one").trauma.left_eye = 900
    impaired.fighter("one").trauma.right_eye = 900
    impaired.fighter("two").x = 95
    impaired.step({"one": command(1, action=punch())})
    assert advance_until(impaired, {"whiff"}) == "whiff"


def test_discrete_actions_are_consumed_once_while_held_state_persists() -> None:
    engine = make_engine(round_ticks=2000)
    engine.step({"one": command(1, action=punch(PunchClass.JAB), move_y=1000)})
    for _ in range(80):
        engine.step()

    starts = [event for event in engine.events if event.kind == "punch_start"]
    assert len(starts) == 1
    assert engine.fighter("one").y > 0


def test_combo_window_rewards_chaining_different_punches() -> None:
    engine = make_engine(round_ticks=2000)
    engine.step({"one": command(1, action=punch(PunchClass.JAB, hand=Hand.LEFT))})
    advance_until(engine, {"hit"})
    while engine.fighter("one").attack is not None:
        engine.step()

    engine.step({"one": command(2, action=punch(PunchClass.HOOK, hand=Hand.RIGHT))})

    attack = engine.fighter("one").attack
    assert attack is not None
    assert attack.combo_bonus == 10


def test_high_low_guard_guard_wear_break_and_perfect_block() -> None:
    engine = make_engine()
    defender = engine.fighter("two")
    defender.guard = GUARD_BLOCK_MINIMUM + 40
    engine.step({"one": command(1, action=punch(target=Target.HEAD, power=Power.POWER))})
    attack = engine.fighter("one").attack
    assert attack is not None
    while attack.age < attack.rule.startup - 2:
        engine.step()
    engine.step({"two": command(1, defense=DefensivePose.GUARD_HIGH)})

    assert advance_until(engine, {"perfect_block"}) == "perfect_block"
    assert defender.guard < GUARD_BLOCK_MINIMUM + 40

    worn = make_engine()
    worn.fighter("two").guard = GUARD_BLOCK_MINIMUM
    worn.step(
        {
            "one": command(1, action=punch(PunchClass.HOOK, target=Target.HEAD, power=Power.POWER)),
            "two": command(1, defense=DefensivePose.GUARD_HIGH),
        }
    )
    assert advance_until(worn, {"block", "perfect_block"}) == "block"
    assert worn.fighter("two").guard == 0
    assert any(event.kind == "guard_break" for event in worn.events)

    body_engine = make_engine()
    body_engine.step(
        {
            "one": command(1, action=punch(target=Target.BODY)),
            "two": command(1, defense=DefensivePose.GUARD_HIGH),
        }
    )
    assert advance_until(body_engine, {"hit"}) == "hit"
    assert body_engine.fighter("two").trauma.body > 0

    low_guard = make_engine()
    low_guard.step(
        {
            "one": command(1, action=punch(target=Target.BODY)),
            "two": command(1, defense=DefensivePose.GUARD_LOW),
        }
    )
    assert advance_until(low_guard, {"block", "perfect_block"}) in {
        "block",
        "perfect_block",
    }


@pytest.mark.parametrize(
    ("pose_action", "punch_class", "hand"),
    [
        (ActionKind.SLIP_LEFT, PunchClass.STRAIGHT, Hand.RIGHT),
        (ActionKind.SLIP_RIGHT, PunchClass.JAB, Hand.LEFT),
        (ActionKind.WEAVE, PunchClass.HOOK, Hand.RIGHT),
        (ActionKind.PULL, PunchClass.STRAIGHT, Hand.RIGHT),
    ],
)
def test_every_evasion_creates_a_counter_window(
    pose_action: ActionKind, punch_class: PunchClass, hand: Hand
) -> None:
    engine = make_engine()
    if pose_action is ActionKind.PULL:
        engine.fighter("one").x = -70
        engine.fighter("two").x = 70
    engine.step(
        {
            "one": command(1, action=punch(punch_class, hand=hand)),
            "two": command(1, action=MovementAction(pose_action)),
        }
    )

    assert advance_until(engine, {"evade"}) == "evade"
    assert engine.fighter("two").counter_ticks > 0


def test_evade_followed_by_punch_is_scored_as_counter() -> None:
    engine = make_engine(round_ticks=2000)
    engine.step(
        {
            "one": command(1, action=punch(PunchClass.STRAIGHT)),
            "two": command(1, action=MovementAction(ActionKind.SLIP_LEFT)),
        }
    )
    advance_until(engine, {"evade"})
    engine.step({"two": command(2, action=punch(PunchClass.HOOK, power=Power.POWER))})

    assert advance_until(engine, {"counter_hit"}, limit=100) == "counter_hit"


def test_clinch_has_range_cost_hold_and_referee_break() -> None:
    engine = make_engine(round_ticks=2000)
    before = engine.fighter("one").stamina
    snapshot = engine.step({"one": command(1, action=MovementAction(ActionKind.CLINCH))})

    assert any(event.kind == "clinch_start" for event in snapshot.events)
    assert engine.fighter("one").stamina < before
    assert advance_until(engine, {"clinch"}, limit=12) == "clinch"
    assert advance_until(engine, {"referee_break"}, limit=60) == "referee_break"


def test_clinch_draws_the_fighters_to_the_hold_distance_before_the_break() -> None:
    engine = make_engine(round_ticks=2000)
    engine.fighter("one").x = -50
    engine.fighter("two").x = 50
    engine.step({"one": command(1, action=MovementAction(ActionKind.CLINCH))})
    assert advance_until(engine, {"clinch"}, limit=12) == "clinch"

    distances = []
    while engine.fighter("one").clinch_ticks > 1:
        engine.step()
        one, two = engine.fighter("one"), engine.fighter("two")
        distances.append(abs(two.x - one.x))
    assert distances[0] < 100
    assert min(distances) == CLINCH_HOLD_DISTANCE
    assert distances[-1] == CLINCH_HOLD_DISTANCE
    assert engine.fighter("one").x == -engine.fighter("two").x

    assert advance_until(engine, {"referee_break"}, limit=3) == "referee_break"
    gap = abs(engine.fighter("two").x - engine.fighter("one").x)
    assert gap >= MINIMUM_SEPARATION


def test_a_clinch_stops_both_fighters_for_the_whole_hold() -> None:
    engine = make_engine(round_ticks=2000)
    one = engine.fighter("one")
    two = engine.fighter("two")
    one.x, two.x = 0, 100
    # Two walks in at full speed and keeps holding forward through the tie-up.
    engine.step(
        {
            "one": command(1, action=MovementAction(ActionKind.CLINCH)),
            "two": command(1, move_x=-1000),
        }
    )
    assert advance_until(engine, {"clinch"}, limit=12) == "clinch"
    for fighter in (one, two):
        assert (fighter.velocity_x, fighter.velocity_y) == (0, 0)
        assert (fighter.velocity_fixed_x, fighter.velocity_fixed_y) == (0, 0)
        assert (fighter.position_remainder_x, fighter.position_remainder_y) == (0, 0)

    control = two.performance.control
    while two.clinch_ticks:
        snapshot = engine.step()
        assert {(fighter.velocity_x, fighter.velocity_y) for fighter in snapshot.fighters} == {
            (0, 0)
        }
    # Farther from the centre than the man he is tied to, so only pressure could score.
    assert two.performance.control == control


def test_out_of_range_clinch_is_denied_and_still_costs_stamina() -> None:
    engine = make_engine(round_ticks=2000)
    engine.fighter("one").x = -300
    engine.fighter("two").x = 300
    before = engine.fighter("one").stamina

    snapshot = engine.step({"one": command(1, action=MovementAction(ActionKind.CLINCH))})

    assert any(event.kind == "clinch_denied" for event in snapshot.events)
    assert engine.fighter("one").stamina < before
    assert engine.fighter("one").clinch_ticks == 0


def test_fouls_warn_deduct_recover_and_disqualify() -> None:
    engine = make_engine(round_ticks=2000)
    for sequence, foul in enumerate((Foul.LOW_BLOW, Foul.HEADBUTT, Foul.LOW_BLOW), start=1):
        engine.fighter("one").x, engine.fighter("two").x = -45, 45
        engine.step({"one": command(sequence, action=FoulAction(foul))})
        if sequence < 3:
            while engine.phase is MatchPhase.FOUL_RECOVERY:
                engine.step()

    offender = engine.fighter("one")
    assert offender.warnings == 3
    assert offender.deductions == 1
    assert engine.result is not None
    assert engine.result.finish_method is FinishMethod.DISQUALIFICATION
    assert engine.result.winner_id == "two"


def test_exchange_stamina_recovers_but_long_term_fatigue_persists_after_rest() -> None:
    engine = make_engine(round_ticks=90, rounds=2, rest_ticks=30)
    one = engine.fighter("one")
    initial_maximum = one.maximum_stamina
    engine.step(
        {
            "one": command(
                1,
                action=punch(PunchClass.UPPERCUT, power=Power.POWER),
            )
        }
    )
    while engine.phase is MatchPhase.FIGHT and engine.result is None:
        engine.step()
    assert engine.phase is MatchPhase.REST
    while engine.phase is MatchPhase.REST:
        engine.step()

    assert one.stamina <= one.maximum_stamina
    assert one.maximum_stamina < initial_maximum
    assert one.conditioning < 1000

    spent = one.stamina
    engine.step({"one": command(2)})
    for _ in range(30):
        engine.step()
    assert one.stamina >= spent


def test_rest_walks_both_fighters_to_their_corners_and_seats_them_facing_the_ring() -> None:
    engine = make_engine(round_ticks=30, rounds=2, rest_ticks=240)
    one = engine.fighter("one")
    two = engine.fighter("two")
    for _ in range(28):
        engine.step()
    engine.step({"one": command(1, action=punch(PunchClass.UPPERCUT, power=Power.POWER))})
    assert engine.phase is MatchPhase.FIGHT
    assert one.attack is not None or one.pending_actions
    engine.step({"two": command(1, defense=DefensivePose.GUARD_HIGH)})
    assert engine.phase is MatchPhase.REST
    assert one.attack is None and not one.pending_actions
    assert two.defense is DefensivePose.NONE

    engine.step()
    assert one.velocity_x < 0 and one.velocity_y < 0
    assert two.velocity_x > 0 and two.velocity_y > 0
    ticks = 0
    while (one.x, one.y) != (-REST_CORNER_OFFSET, -REST_CORNER_OFFSET):
        engine.step({"one": command(2 + ticks, move_x=1000, move_y=1000)})
        ticks += 1
        assert ticks < 200
    assert (two.x, two.y) == (REST_CORNER_OFFSET, REST_CORNER_OFFSET)
    assert (one.velocity_x, one.velocity_y) == (0, 0)
    assert (two.velocity_x, two.velocity_y) == (0, 0)
    for step in range(12):
        engine.step({"one": command(300 + step, move_x=1000, move_y=1000)})
    assert (one.x, one.y) == (-REST_CORNER_OFFSET, -REST_CORNER_OFFSET)
    assert one.facing_x > 0 and one.facing_y > 0
    assert two.facing_x < 0 and two.facing_y < 0
    while engine.phase is MatchPhase.REST:
        engine.step()
    assert engine.phase is MatchPhase.FIGHT
    assert (one.x, one.y) == (-REST_CORNER_OFFSET, -REST_CORNER_OFFSET)


def test_fatigue_reduces_hand_speed_foot_speed_guard_recovery_and_power() -> None:
    fresh = make_engine(round_ticks=2000)
    tired = make_engine(round_ticks=2000)
    tired_one = tired.fighter("one")
    tired_one.conditioning = 400
    tired_one.trauma.body = 500
    tired_one.guard = 200
    fresh.fighter("one").guard = 200

    fresh.step({"one": command(1, action=punch(PunchClass.STRAIGHT))})
    tired.step({"one": command(1, action=punch(PunchClass.STRAIGHT))})
    fresh_attack = fresh.fighter("one").attack
    tired_attack = tired.fighter("one").attack
    assert fresh_attack is not None and tired_attack is not None
    assert tired_attack.rule.startup > fresh_attack.rule.startup
    advance_until(fresh, {"hit"})
    advance_until(tired, {"hit"})
    assert tired.fighter("two").trauma.head < fresh.fighter("two").trauma.head

    fresh_move = make_engine(round_ticks=2000)
    tired_move = make_engine(round_ticks=2000)
    tired_move.fighter("one").conditioning = 400
    fresh_move.step({"one": command(1, move_y=1000)})
    tired_move.step({"one": command(1, move_y=1000)})
    for _ in range(10):
        fresh_move.step()
        tired_move.step()
    assert abs(tired_move.fighter("one").y) < abs(fresh_move.fighter("one").y)

    fresh_guard = make_engine(round_ticks=2000)
    tired_guard = make_engine(round_ticks=2000)
    fresh_guard.fighter("one").guard = 100
    tired_guard.fighter("one").guard = 100
    tired_guard.fighter("one").conditioning = 400
    for _ in range(20):
        fresh_guard.step()
        tired_guard.step()
    assert fresh_guard.fighter("one").guard > tired_guard.fighter("one").guard


def test_localized_trauma_cut_bleeding_and_doctor_stoppage() -> None:
    engine = make_engine(doctor_cut_threshold=20)
    engine.fighter("two").trauma.right_eye = 300
    engine.step(
        {
            "one": command(
                1,
                action=punch(
                    PunchClass.HOOK,
                    hand=Hand.LEFT,
                    target=Target.HEAD,
                    power=Power.POWER,
                ),
            )
        }
    )
    advance_until(engine, {"result"}, limit=50)

    defender = engine.fighter("two")
    assert defender.trauma.head > 0
    assert defender.trauma.right_eye > 300
    assert defender.trauma.right_cut >= 20
    assert defender.trauma.bleeding > 0
    assert engine.result is not None
    assert engine.result.finish_method is FinishMethod.DOCTOR_STOPPAGE


def test_knockdown_seeded_get_up_and_repeated_knockdown_tko() -> None:
    engine = make_engine(round_ticks=2000)
    defender = engine.fighter("two")
    defender.poise = 1
    engine.step({"one": command(1, action=punch(PunchClass.UPPERCUT, power=Power.POWER))})
    advance_until(engine, {"knockdown"})
    assert engine.phase is MatchPhase.KNOCKDOWN

    sequence = 2
    used_window = -1
    while engine.phase is MatchPhase.KNOCKDOWN and engine.tick < 400:
        snapshot = engine.snapshot()
        fighter = next(item for item in snapshot.fighters if item.player_id == "two")
        if (
            fighter.get_up_prompt is not None
            and engine.tick >= fighter.get_up_window_start_tick
            and fighter.get_up_window_end_tick != used_window
        ):
            engine.step(
                {
                    "two": command(
                        sequence,
                        action=MovementAction(fighter.get_up_prompt),
                    )
                }
            )
            used_window = fighter.get_up_window_end_tick
            sequence += 1
        else:
            engine.step()
    assert engine.phase is MatchPhase.FIGHT
    assert [event.kind for event in engine.events if event.kind in {"get_up", "box"}] == [
        "get_up",
        "box",
    ]

    tko = make_engine(round_ticks=2000)
    tko.fighter("two").knockdowns = 2
    tko.fighter("two").poise = 1
    tko.step({"one": command(1, action=punch(PunchClass.UPPERCUT, power=Power.POWER))})
    advance_until(tko, {"result"})
    assert tko.result is not None
    assert tko.result.finish_method is FinishMethod.TKO


def test_failed_ten_count_finishes_by_ko() -> None:
    engine = make_engine(round_ticks=2000)
    engine.fighter("two").poise = 1
    engine.step({"one": command(1, action=punch(PunchClass.HOOK, power=Power.POWER))})
    advance_until(engine, {"knockdown"})
    advance_until(engine, {"result"}, limit=320)

    assert engine.result is not None
    assert engine.result.finish_method is FinishMethod.KO
    assert engine.result.winner_id == "one"


def test_seeded_flash_ko_is_rare_and_requires_a_skilled_qualifying_counter() -> None:
    qualified_finishes = 0
    neutral_finishes = 0
    samples = 500
    for seed in range(samples):
        qualified = make_engine(seed, round_ticks=2000, flash=True)
        qualified.fighter("one").counter_ticks = 30
        qualified.fighter("two").trauma.head = 500
        qualified.fighter("two").conditioning = 550
        qualified.fighter("two").poise = 100_000
        qualified.step({"one": command(1, action=punch(PunchClass.HOOK, power=Power.POWER))})
        advance_until(qualified, {"hit", "counter_hit", "result"})
        if qualified.result and qualified.result.finish_method is FinishMethod.FLASH_KO:
            qualified_finishes += 1

        neutral = make_engine(seed, round_ticks=2000, flash=True)
        neutral.fighter("two").trauma.head = 500
        neutral.fighter("two").conditioning = 550
        neutral.fighter("two").poise = 100_000
        neutral.step({"one": command(1, action=punch(PunchClass.JAB))})
        advance_until(neutral, {"hit", "counter_hit", "result"})
        if neutral.result and neutral.result.finish_method is FinishMethod.FLASH_KO:
            neutral_finishes += 1

    assert 0 < qualified_finishes < samples // 20
    assert neutral_finishes == 0


def test_rounds_produce_transparent_decision_draw_and_forfeit_results() -> None:
    draw = make_engine(round_ticks=2, rounds=1)
    draw.step()
    draw.step()
    assert draw.result is not None
    assert draw.result.finish_method is FinishMethod.DRAW
    assert all(
        card.player_one == (10,) and card.player_two == (10,) for card in draw.result.scorecards
    )

    decision = make_engine(round_ticks=1, rounds=1)
    decision.fighter("one").performance.damage = 100
    decision.fighter("one").performance.clean_hits = 10
    decision.step()
    assert decision.result is not None
    assert decision.result.finish_method is FinishMethod.DECISION
    assert decision.result.winner_id == "one"

    forfeit = decision.build_forfeit_result("two")
    assert forfeit.finish_method is FinishMethod.FORFEIT
    assert forfeit.winner_id == "two"

    live_forfeit = make_engine(round_ticks=2000)
    completed = live_forfeit.complete_forfeit("two")
    assert completed.finish_method is FinishMethod.FORFEIT
    assert completed.winner_id == "two"
    frozen = live_forfeit.snapshot()
    assert frozen.phase is MatchPhase.COMPLETE
    assert live_forfeit.complete_forfeit("one") is completed


def test_identical_seed_and_input_ledger_replay_byte_equivalent_state() -> None:
    left = make_engine(91, round_ticks=300)
    right = make_engine(91, round_ticks=300)
    ledgers = {
        1: {
            "one": command(1, action=punch(PunchClass.JAB, hand=Hand.LEFT)),
            "two": command(1, action=MovementAction(ActionKind.SLIP_LEFT)),
        },
        25: {"two": command(2, action=punch(PunchClass.HOOK, power=Power.POWER))},
        60: {"one": command(2, defense=DefensivePose.GUARD_HIGH, move_x=1000)},
    }

    left_snapshots = []
    right_snapshots = []
    for tick in range(100):
        left_snapshot = left.step(ledgers.get(tick))
        right_snapshot = right.step(ledgers.get(tick))
        left_snapshots.append((left_snapshot.checksum, left_snapshot.events, left_snapshot.result))
        right_snapshots.append(
            (right_snapshot.checksum, right_snapshot.events, right_snapshot.result)
        )

    assert left_snapshots == right_snapshots
    assert left.events == right.events


def test_natural_effective_aggressor_gets_credit_and_wins_one_round_decision() -> None:
    engine = make_engine(
        seed=101,
        round_ticks=180,
        rounds=1,
        rest_ticks=0,
        doctor_cut_threshold=5000,
        doctor_swelling_threshold=5000,
    )
    sequence = 0
    while engine.result is None:
        inputs = None
        attacker = engine.fighter("one")
        if attacker.attack is None and not attacker.pending_actions:
            sequence += 1
            inputs = {"one": command(sequence, action=punch(PunchClass.JAB, hand=Hand.LEFT))}
        engine.step(inputs)

    assert engine.fighter("one").performance.clean_hits > 0
    assert engine.fighter("one").performance.damage == engine.fighter("one").damage_dealt
    assert engine.fighter("two").performance.clean_hits == 0
    assert engine.fighter("two").performance.damage == 0
    assert engine.result.finish_method is FinishMethod.DECISION
    assert engine.result.winner_id == "one"
    assert all(
        card.player_one == (10,) and card.player_two == (9,) for card in engine.result.scorecards
    )


def test_collision_and_referee_separation_stay_inside_rope_center_bounds() -> None:
    maximum_x = RING_HALF_WIDTH - 38
    maximum_y = RING_HALF_HEIGHT - 38
    engine = make_engine(round_ticks=2000)
    one = engine.fighter("one")
    two = engine.fighter("two")
    one.x = two.x = maximum_x
    one.y = two.y = maximum_y

    engine.step()

    for fighter in (one, two):
        assert -maximum_x <= fighter.x <= maximum_x
        assert -maximum_y <= fighter.y <= maximum_y
        assert abs(fighter.x) + abs(fighter.y) <= RING_CORNER_REACH
    assert (one.x - two.x) ** 2 + (one.y - two.y) ** 2 >= 76**2

    one.x = maximum_x - 40
    two.x = maximum_x
    one.y = two.y = 0
    engine.step({"one": command(1, action=MovementAction(ActionKind.CLINCH))})
    advance_until(engine, {"clinch"}, limit=12)
    advance_until(engine, {"referee_break"}, limit=60)
    for fighter in (one, two):
        assert -maximum_x <= fighter.x <= maximum_x
        assert -maximum_y <= fighter.y <= maximum_y


def test_action_buffer_coalesces_spam_and_new_intent_replaces_or_cancels_stale() -> None:
    engine = make_engine(round_ticks=2000)
    engine.step(
        {
            "one": command(
                1,
                action=punch(PunchClass.UPPERCUT, power=Power.POWER),
            )
        }
    )
    fighter = engine.fighter("one")
    repeated = punch(PunchClass.JAB, hand=Hand.LEFT)

    for sequence in range(2, 102):
        assert engine.submit_input("one", command(sequence, action=repeated)) is True
    assert fighter.pending_actions == [repeated]

    latest = punch(PunchClass.HOOK, hand=Hand.RIGHT)
    assert engine.submit_input("one", command(102, action=latest)) is True
    assert fighter.pending_actions == [latest]

    assert (
        engine.submit_input(
            "one",
            command(103, defense=DefensivePose.GUARD_HIGH),
        )
        is True
    )
    assert fighter.pending_actions == []
    assert fighter.held_input.defense is DefensivePose.GUARD_HIGH


def test_held_guard_heartbeat_preserves_a_new_guarded_follow_up() -> None:
    engine = make_engine(round_ticks=2000)
    engine.step(
        {
            "one": command(
                1,
                action=punch(PunchClass.UPPERCUT, power=Power.POWER),
            )
        }
    )
    attack = engine.fighter("one").attack
    assert attack is not None
    while attack.total_ticks - attack.age > 2:
        engine.step()

    follow_up = punch(PunchClass.JAB)
    assert engine.submit_input(
        "one",
        command(2, action=follow_up, defense=DefensivePose.GUARD_HIGH),
    )
    assert engine.submit_input(
        "one",
        command(3, defense=DefensivePose.GUARD_HIGH),
    )
    assert engine.fighter("one").pending_actions == [follow_up]

    for _ in range(ACTION_BUFFER_TICKS):
        engine.step()
        if [event.kind for event in engine.events].count("punch_start") == 2:
            break
    assert [event.kind for event in engine.events].count("punch_start") == 2


def test_action_buffer_expires_instead_of_forcing_old_directives() -> None:
    engine = make_engine(round_ticks=2000)
    engine.step({"one": command(1, action=MovementAction(ActionKind.TAUNT))})
    assert engine.fighter("one").taunt_ticks > 0
    assert (
        engine.submit_input(
            "one",
            command(2, action=punch(PunchClass.JAB)),
        )
        is True
    )
    assert engine.fighter("one").pending_actions

    for _ in range(ACTION_BUFFER_TICKS + 1):
        engine.step()

    assert engine.fighter("one").pending_actions == []
    assert [event.kind for event in engine.events].count("punch_start") == 0


def test_buffered_punch_survives_the_current_attack_and_dispatches_after_it() -> None:
    engine = make_engine(round_ticks=2000)
    engine.fighter("one").x = -300
    engine.fighter("two").x = 300
    engine.step({"one": command(1, action=punch(PunchClass.UPPERCUT, power=Power.POWER))})
    attack = engine.fighter("one").attack
    assert attack is not None
    total = attack.total_ticks
    assert total > ACTION_BUFFER_TICKS + 1
    engine.step()
    assert engine.submit_input("one", command(2, action=punch(PunchClass.JAB)))

    starts: list[int] = []
    for _ in range(total + 4):
        snapshot = engine.step()
        starts.extend(event.tick for event in snapshot.events if event.kind == "punch_start")
        if not starts:
            assert engine.fighter("one").pending_actions, "buffer dropped during the attack"

    assert len(starts) == 1
    assert starts[0] == 1 + total + 1
    assert engine.fighter("one").pending_actions == []


def test_landed_punch_recovery_cancels_into_a_compatible_follow_up() -> None:
    def follow_up_start(
        first: PunchAction, second: PunchAction, *, in_range: bool, stunned: bool = False
    ) -> tuple[int, int, int]:
        engine = make_engine(round_ticks=2000)
        if not in_range:
            engine.fighter("one").x = -300
            engine.fighter("two").x = 300
        if stunned:
            engine.fighter("two").stunned_ticks = 90
        engine.step({"one": command(1, action=first)})
        attack = engine.fighter("one").attack
        assert attack is not None
        cancel_age = attack.cancel_age
        total = attack.total_ticks
        assert 0 < cancel_age < total
        engine.step({"one": command(2, action=second)})
        for _ in range(total + 4):
            snapshot = engine.step()
            for event in snapshot.events:
                if event.kind == "punch_start" and event.detail.split(":")[1] == second.punch_class:
                    return event.tick - 1, cancel_age, total
        raise AssertionError("follow-up never started")

    jab = punch(PunchClass.JAB, hand=Hand.LEFT)
    straight = punch(PunchClass.STRAIGHT)
    uppercut = punch(PunchClass.UPPERCUT)

    started, cancel_age, total = follow_up_start(jab, straight, in_range=True)
    assert started == cancel_age < total
    whiffed, _cancel_age, total = follow_up_start(jab, straight, in_range=False)
    assert whiffed == total + 1
    incompatible, _cancel_age, total = follow_up_start(jab, uppercut, in_range=True)
    assert incompatible == total + 1
    into_a_stun, _cancel_age, total = follow_up_start(jab, straight, in_range=True, stunned=True)
    assert into_a_stun == total + 1


def test_facing_vector_turns_toward_the_opponent_and_the_hit_test_follows() -> None:
    engine = make_engine(round_ticks=2000)
    one = engine.fighter("one")
    two = engine.fighter("two")
    one.x = one.y = 0
    two.x = 0
    two.y = 100
    assert (one.facing_x, one.facing_y) == (1000, 0)
    for _ in range(12):
        engine.step()
    assert one.facing_y > 950
    assert abs(one.facing_x) < 200
    assert 990_000 <= one.facing_x**2 + one.facing_y**2 <= 1_010_000
    assert two.facing_y < -950

    engine.step({"one": command(1, action=punch(PunchClass.STRAIGHT))})
    assert advance_until(engine, {"hit", "counter_hit"}) in {"hit", "counter_hit"}

    snapshot = engine.snapshot()
    payload = json.loads(encode_snapshot(snapshot, viewer_id="one"))["payload"]
    assert payload["fighters"][0]["facing_y"] == one.facing_y
    assert payload["fighters"][0]["last_input_sequence"] == 1
    assert payload["fighters"][1]["last_input_sequence"] == -1


def test_the_standing_fighter_walks_to_the_far_neutral_corner_without_teleporting() -> None:
    engine = make_engine(round_ticks=2000)
    one, two = engine.fighter("one"), engine.fighter("two")
    _down_two(engine)
    downed_at = (two.x, two.y)
    neutral = [(-REST_CORNER_OFFSET, REST_CORNER_OFFSET), (REST_CORNER_OFFSET, -REST_CORNER_OFFSET)]
    far = max(neutral, key=lambda corner: hypot(corner[0] - two.x, corner[1] - two.y))
    while engine._knockdown_count_ticks < MANDATORY_COUNT * COUNT_TICK_INTERVAL:
        before = (one.x, one.y)
        engine.step()
        assert hypot(one.x - before[0], one.y - before[1]) <= REFEREE_WALK_SPEED + 1
        assert hypot(one.x - two.x, one.y - two.y) >= MINIMUM_SEPARATION - 8
        assert (two.x, two.y) == downed_at
    assert hypot(one.x - far[0], one.y - far[1]) <= REFEREE_WALK_SPEED
    assert (one.velocity_x, one.velocity_y) == (0, 0)


def test_short_buffered_combo_only_rewards_authored_compatible_chain() -> None:
    def buffered_chain(first: PunchAction, second: PunchAction) -> BoxingEngine:
        engine = make_engine(round_ticks=2000)
        engine.step({"one": command(1, action=first)})
        attack = engine.fighter("one").attack
        assert attack is not None
        while attack.total_ticks - attack.age > 2:
            engine.step()
        engine.step({"one": command(2, action=second)})
        for _ in range(10):
            if len([event for event in engine.events if event.kind == "punch_start"]) == 2:
                return engine
            engine.step()
        raise AssertionError("buffered follow-up did not start")

    compatible = buffered_chain(
        punch(PunchClass.JAB, hand=Hand.LEFT),
        punch(PunchClass.STRAIGHT, hand=Hand.RIGHT),
    )
    assert compatible.fighter("one").attack is not None
    assert compatible.fighter("one").attack.combo_bonus == 10

    incompatible = buffered_chain(
        punch(PunchClass.HOOK, hand=Hand.LEFT),
        punch(PunchClass.STRAIGHT, hand=Hand.RIGHT),
    )
    assert incompatible.fighter("one").attack is not None
    assert incompatible.fighter("one").attack.combo_bonus == 0


def test_stun_cancels_non_simultaneous_attack_instead_of_resuming_it() -> None:
    engine = make_engine(round_ticks=2000)
    engine.step(
        {
            "one": command(1, action=punch(PunchClass.UPPERCUT, power=Power.POWER)),
            "two": command(1, action=punch(PunchClass.HOOK, power=Power.POWER)),
        }
    )
    advance_until(engine, {"stun"}, limit=20)
    engine.step()

    assert engine.fighter("one").attack is None
    assert not any(
        event.actor_id == "one" and event.kind in {"hit", "counter_hit"} for event in engine.events
    )


def test_clinch_startup_is_interruptible_and_latest_batch_intent_wins() -> None:
    engine = make_engine(round_ticks=2000)
    engine.step(
        {
            "one": command(1, action=MovementAction(ActionKind.CLINCH)),
            "two": command(1, action=punch(PunchClass.STRAIGHT, power=Power.POWER)),
        }
    )

    assert advance_until(engine, {"clinch_interrupted"}, limit=20) == "clinch_interrupted"
    assert engine.fighter("one").clinch_startup_ticks == 0
    assert engine.fighter("one").clinch_ticks == 0
    for _ in range(30):
        engine.step()
    assert not any(event.kind == "clinch" for event in engine.events)

    latest = make_engine(round_ticks=2000)
    latest.step(
        {
            "one": command(
                1,
                actions=(MovementAction(ActionKind.CLINCH), punch()),
            )
        }
    )
    assert latest.fighter("one").attack is not None
    assert latest.fighter("one").clinch_startup_ticks == 0
    assert [event.kind for event in latest.events].count("punch_start") == 1
    assert not any(event.kind == "clinch" for event in latest.events)


def test_checksum_covers_hidden_authority_state_and_snapshot_encoding_is_stable() -> None:
    left = make_engine(seed=202, round_ticks=2000)
    right = make_engine(seed=202, round_ticks=2000)
    assert left.snapshot().checksum == right.snapshot().checksum

    right.fighter("one").counter_ticks = 1
    assert left.snapshot().checksum != right.snapshot().checksum
    right.fighter("one").counter_ticks = 0
    right.fighter("one").pending_actions.append(MovementAction(ActionKind.SWITCH_STANCE))
    assert left.snapshot().checksum != right.snapshot().checksum
    right.fighter("one").pending_actions.clear()
    right.fighter("one").velocity_fixed_x = 1
    assert left.snapshot().checksum != right.snapshot().checksum
    right.fighter("one").velocity_fixed_x = 0
    right.fighter("one").position_remainder_x = 1
    assert left.snapshot().checksum != right.snapshot().checksum

    replay_a = make_engine(seed=203, round_ticks=2000)
    replay_b = make_engine(seed=203, round_ticks=2000)
    ledger = {
        0: {
            "one": command(
                1, actions=(punch(PunchClass.JAB), MovementAction(ActionKind.SWITCH_STANCE))
            )
        },
        20: {"two": command(1, action=punch(PunchClass.HOOK, power=Power.POWER))},
    }
    for tick in range(80):
        encoded_a = encode_snapshot(replay_a.step(ledger.get(tick)), viewer_id="one")
        encoded_b = encode_snapshot(replay_b.step(ledger.get(tick)), viewer_id="one")
        assert encoded_a == encoded_b


def test_seeded_get_up_prompts_expose_windows_and_penalize_bad_timing() -> None:
    engine = make_engine(seed=303, round_ticks=2000)
    engine.fighter("two").poise = 1
    engine.step({"one": command(1, action=punch(PunchClass.UPPERCUT, power=Power.POWER))})
    advance_until(engine, {"knockdown"})
    first = next(item for item in engine.snapshot().fighters if item.player_id == "two")
    assert first.get_up_prompt in (ActionKind.GET_UP_LEFT, ActionKind.GET_UP_RIGHT)
    assert first.get_up_window_start_tick < first.get_up_window_end_tick
    assert first.get_up_required > 0

    engine.step({"two": command(2, action=MovementAction(first.get_up_prompt))})
    early = next(item for item in engine.snapshot().fighters if item.player_id == "two")
    assert early.get_up_meter == 0
    assert any(event.kind == "get_up_input" and event.detail == "early" for event in engine.events)

    while engine.tick <= early.get_up_window_end_tick:
        engine.step()
    second = next(item for item in engine.snapshot().fighters if item.player_id == "two")
    wrong = (
        ActionKind.GET_UP_RIGHT
        if second.get_up_prompt is ActionKind.GET_UP_LEFT
        else ActionKind.GET_UP_LEFT
    )
    while engine.tick < second.get_up_window_start_tick:
        engine.step()
    engine.step({"two": command(3, action=MovementAction(wrong))})
    assert any(event.kind == "get_up_input" and event.detail == "wrong" for event in engine.events)

    late = make_engine(seed=305, round_ticks=2000)
    late.fighter("two").poise = 1
    late.step({"one": command(1, action=punch(PunchClass.UPPERCUT, power=Power.POWER))})
    advance_until(late, {"knockdown"})
    late_prompt = next(item for item in late.snapshot().fighters if item.player_id == "two")
    while late.tick < late_prompt.get_up_window_end_tick:
        late.step()
    assert late_prompt.get_up_prompt is not None
    late.step({"two": command(2, action=MovementAction(late_prompt.get_up_prompt))})
    assert any(event.kind == "get_up_input" and event.detail == "late" for event in late.events)

    fresh = make_engine(seed=304, round_ticks=2000)
    fresh.fighter("two").poise = 1
    fresh.step({"one": command(1, action=punch(PunchClass.UPPERCUT, power=Power.POWER))})
    advance_until(fresh, {"knockdown"})
    first_required = next(
        item for item in fresh.snapshot().fighters if item.player_id == "two"
    ).get_up_required
    harder = make_engine(seed=304, round_ticks=2000)
    harder.fighter("two").knockdowns = 1
    harder.fighter("two").poise = 1
    harder.step({"one": command(1, action=punch(PunchClass.UPPERCUT, power=Power.POWER))})
    advance_until(harder, {"knockdown"})
    second_required = next(
        item for item in harder.snapshot().fighters if item.player_id == "two"
    ).get_up_required
    assert second_required > first_required


def test_authored_target_power_variants_and_whiff_cost_are_observable() -> None:
    normal = PUNCH_RULES[(PunchClass.STRAIGHT, Target.HEAD, Power.NORMAL)]
    body_power = PUNCH_RULES[(PunchClass.STRAIGHT, Target.BODY, Power.POWER)]
    assert body_power.startup > normal.startup
    assert body_power.recovery > normal.recovery
    assert body_power.stamina_cost > normal.stamina_cost
    assert body_power.whiff_cost > normal.whiff_cost
    assert body_power.impact > normal.impact

    cheap = make_engine(round_ticks=2000)
    costly = make_engine(round_ticks=2000)
    cheap.fighter("two").x = costly.fighter("two").x = 400
    cheap.step({"one": command(1, action=punch(PunchClass.JAB))})
    costly.step(
        {
            "one": command(
                1,
                action=punch(PunchClass.UPPERCUT, target=Target.BODY, power=Power.POWER),
            )
        }
    )
    before_cheap = cheap.fighter("one").stamina
    before_costly = costly.fighter("one").stamina
    advance_until(cheap, {"whiff"})
    advance_until(costly, {"whiff"})
    assert (
        before_costly - costly.fighter("one").stamina > before_cheap - cheap.fighter("one").stamina
    )


def test_counter_vulnerability_slip_sides_and_body_weave_are_skill_based() -> None:
    startup = make_engine(round_ticks=2000)
    startup.step({"two": command(1, action=punch(PunchClass.UPPERCUT, power=Power.POWER))})
    vulnerable = startup.fighter("two").attack
    assert vulnerable is not None
    assert startup._counter_vulnerable(vulnerable) is True
    vulnerable.age = vulnerable.rule.startup
    assert startup._counter_vulnerable(vulnerable) is False
    vulnerable.age = vulnerable.total_ticks - 1
    assert startup._counter_vulnerable(vulnerable) is True
    vulnerable.age = 0
    startup.step({"one": command(1, action=punch(PunchClass.JAB, hand=Hand.LEFT))})
    assert advance_until(startup, {"counter_hit"}, limit=30) == "counter_hit"

    correct = make_engine(round_ticks=2000)
    correct.step(
        {
            "one": command(1, action=punch(PunchClass.STRAIGHT, hand=Hand.RIGHT)),
            "two": command(1, action=MovementAction(ActionKind.SLIP_LEFT)),
        }
    )
    assert advance_until(correct, {"evade"}) == "evade"
    wrong = make_engine(round_ticks=2000)
    wrong.step(
        {
            "one": command(1, action=punch(PunchClass.STRAIGHT, hand=Hand.RIGHT)),
            "two": command(1, action=MovementAction(ActionKind.SLIP_RIGHT)),
        }
    )
    assert advance_until(wrong, {"hit", "counter_hit"}) in {"hit", "counter_hit"}

    def body_shot(punch_class: PunchClass, pose: ActionKind, *, steps_off_the_line: int) -> str:
        engine = make_engine(round_ticks=2000)
        one = engine.fighter("one")
        two = engine.fighter("two")
        one.x, one.y, two.x, two.y = -32, -24, 32, 24
        for _ in range(20):
            engine.step()
        # Settled: the attacker has turned square onto the defender, along (4, 3).
        assert abs(math.degrees(math.atan2(one.facing_y, one.facing_x)) - 36.87) < 1
        shot = command(1, action=punch(punch_class, hand=Hand.RIGHT, target=Target.BODY))
        evasion = command(2, action=MovementAction(pose))
        # Square to the line, the defender steps off it once the punch has started.
        step_aside = command(1, move_x=-600, move_y=800)
        engine.step({"one": shot, "two": step_aside if steps_off_the_line else evasion})
        if steps_off_the_line:
            for _ in range(steps_off_the_line - 1):
                engine.step()
            engine.step({"two": evasion})
        return advance_until(engine, {"hit", "counter_hit", "evade", "whiff"})

    assert body_shot(PunchClass.HOOK, ActionKind.WEAVE, steps_off_the_line=0) == "hit"
    assert body_shot(PunchClass.HOOK, ActionKind.WEAVE, steps_off_the_line=3) == "evade"
    assert body_shot(PunchClass.UPPERCUT, ActionKind.SLIP_LEFT, steps_off_the_line=0) == "hit"
    assert body_shot(PunchClass.UPPERCUT, ActionKind.SLIP_LEFT, steps_off_the_line=3) == "evade"


def test_forward_cone_rejects_beside_and_opponent_who_circles_behind() -> None:
    beside = make_engine(round_ticks=2000)
    beside.fighter("two").x = beside.fighter("one").x + 20
    beside.fighter("two").y = beside.fighter("one").y + 120
    beside.step({"one": command(1, action=punch(PunchClass.STRAIGHT))})
    assert advance_until(beside, {"whiff"}) == "whiff"

    behind = make_engine(round_ticks=2000)
    behind.step({"one": command(1, action=punch(PunchClass.STRAIGHT))})
    assert behind.fighter("one").facing == 1
    behind.fighter("two").x = behind.fighter("one").x - 70
    assert advance_until(behind, {"whiff"}) == "whiff"


def test_suppressed_held_intent_does_not_award_ring_control() -> None:
    engine = make_engine(round_ticks=2000)
    engine.step(
        {
            "one": command(
                1,
                action=punch(PunchClass.STRAIGHT),
                move_x=1000,
            )
        }
    )
    assert engine.fighter("one").velocity_x == 0
    assert engine.fighter("one").performance.control == 0


def test_completed_close_round_applies_live_foul_deduction() -> None:
    engine = make_engine(round_ticks=30, rounds=1, rest_ticks=0)
    engine.step({"one": command(1, action=FoulAction(Foul.LOW_BLOW))})
    while engine.phase is MatchPhase.FOUL_RECOVERY:
        engine.step()
    engine.fighter("one").x, engine.fighter("two").x = -45, 45
    engine.step({"one": command(2, action=FoulAction(Foul.HEADBUTT))})
    while engine.phase is MatchPhase.FOUL_RECOVERY:
        engine.step()
    while engine.result is None:
        engine.step()

    assert engine.result.finish_method is FinishMethod.DECISION
    assert engine.result.winner_id == "two"
    assert all(
        card.player_one == (9,) and card.player_two == (10,) for card in engine.result.scorecards
    )


def test_sustained_movement_is_free_but_punches_still_spend_resources() -> None:
    mover = make_engine(round_ticks=2000)
    initial_stamina = mover.fighter("one").stamina
    initial_conditioning = mover.fighter("one").conditioning
    mover.step({"one": command(1, move_x=1000, move_y=1000)})
    for _ in range(30):
        mover.step()

    assert mover.fighter("one").stamina == initial_stamina
    assert mover.fighter("one").conditioning == initial_conditioning

    attacker = make_engine(round_ticks=2000)
    attacker.fighter("one").x = -400
    attacker.fighter("two").x = 400
    initial_stamina = attacker.fighter("one").stamina
    initial_conditioning = attacker.fighter("one").conditioning
    attacker.step(
        {
            "one": command(
                1,
                action=punch(PunchClass.UPPERCUT, power=Power.POWER),
            )
        }
    )
    advance_until(attacker, {"whiff"})

    assert attacker.fighter("one").stamina < initial_stamina
    assert attacker.fighter("one").conditioning < initial_conditioning


def test_swelling_bleeding_same_tick_trades_and_snapshot_payloads_follow_behavior() -> None:
    swelling = make_engine(
        round_ticks=2000,
        doctor_cut_threshold=5000,
        doctor_swelling_threshold=20,
    )
    swelling.step({"one": command(1, action=punch(PunchClass.HOOK, power=Power.POWER))})
    advance_until(swelling, {"result"}, limit=30)
    assert swelling.result is not None
    assert swelling.result.finish_method is FinishMethod.DOCTOR_STOPPAGE
    assert swelling.fighter("two").trauma.swelling >= 20

    bleeding = make_engine(round_ticks=2000, doctor_cut_threshold=5000)
    bleeding.fighter("two").trauma.bleeding = 300
    before_head = bleeding.fighter("two").trauma.head
    for _ in range(30):
        bleeding.step()
    assert bleeding.fighter("two").trauma.head > before_head
    assert any(event.kind == "bleed" and event.blood > 0 for event in bleeding.events)

    trade = make_engine(round_ticks=2000)
    straight = punch(PunchClass.STRAIGHT)
    trade.step({"one": command(1, action=straight), "two": command(1, action=straight)})
    for _ in range(20):
        snapshot = trade.step()
        same_tick_hits = [
            event for event in snapshot.events if event.kind in {"hit", "counter_hit"}
        ]
        if len(same_tick_hits) == 2:
            break
    else:
        raise AssertionError("expected a same-tick trade")
    assert trade.fighter("one").damage_dealt > 0
    assert trade.fighter("two").damage_dealt > 0
    payload = encode_snapshot(snapshot, viewer_id="one")
    assert '"queued_actions":0' in payload
    assert '"get_up_window_start_tick":0' in payload


def test_completed_engine_rejects_and_does_not_submit_late_input() -> None:
    engine = make_engine(round_ticks=1, rounds=1)
    completed = engine.step()
    fighter = engine.fighter("one")
    before = (fighter.last_sequence, fighter.held_input, tuple(fighter.pending_actions))

    late = command(
        99,
        action=punch(PunchClass.HOOK, power=Power.POWER),
        defense=DefensivePose.GUARD_HIGH,
        move_x=1000,
    )
    assert engine.submit_input("one", late) is False
    after_submit = engine.step({"one": late})

    assert (fighter.last_sequence, fighter.held_input, tuple(fighter.pending_actions)) == before
    assert after_submit == completed
    assert after_submit.checksum == completed.checksum


def test_simultaneous_clinch_attempts_resolve_once() -> None:
    engine = make_engine(round_ticks=2000)
    engine.step(
        {
            "one": command(1, action=MovementAction(ActionKind.CLINCH)),
            "two": command(1, action=MovementAction(ActionKind.CLINCH)),
        }
    )
    for _ in range(20):
        engine.step()
        if engine.fighter("one").clinch_ticks:
            break

    assert engine.fighter("one").clinch_ticks == engine.fighter("two").clinch_ticks
    assert engine.fighter("one").clinch_startup_ticks == 0
    assert engine.fighter("two").clinch_startup_ticks == 0
    assert engine.fighter("one").stamina == engine.fighter("two").stamina == 964
    assert len([event for event in engine.events if event.kind == "clinch"]) == 1

    for _ in range(60):
        engine.step()
    assert len([event for event in engine.events if event.kind == "clinch"]) == 1


def test_newest_input_replaces_buffer_and_coalesces_held_controls_and_sequence() -> None:
    engine = make_engine(round_ticks=2000)
    queued = tuple(MovementAction(ActionKind.SWITCH_STANCE) for _ in range(MAX_PENDING_ACTIONS))
    assert engine.submit_input("one", InputCommand(1, 1, actions=queued)) is True
    latest = MovementAction(ActionKind.CLINCH)
    overflow = InputCommand(
        sequence=2,
        client_tick=2,
        move_x=-800,
        move_y=600,
        defense=DefensivePose.GUARD_LOW,
        actions=(latest,),
    )

    assert engine.submit_input("one", overflow) is True
    fighter = engine.fighter("one")
    assert fighter.last_sequence == 2
    assert fighter.held_input.move_x == -800
    assert fighter.held_input.move_y == 600
    assert fighter.held_input.defense is DefensivePose.GUARD_LOW
    assert tuple(fighter.pending_actions) == (latest,)
    assert engine.submit_input("one", overflow) is False


def test_zero_rest_transitions_directly_to_positive_next_round_clock() -> None:
    engine = make_engine(round_ticks=1, rounds=2, rest_ticks=0)

    snapshot = engine.step()

    assert snapshot.phase is MatchPhase.FIGHT
    assert snapshot.round_number == 2
    assert snapshot.phase_ticks_remaining == 1
    assert [event.detail for event in snapshot.events if event.kind == "bell"] == [
        "round_end",
        "round_start",
    ]


def test_snapshot_exposes_authoritative_visual_state_from_count_zero() -> None:
    attack = make_engine(round_ticks=2000)
    action = punch(
        PunchClass.HOOK,
        hand=Hand.LEFT,
        target=Target.BODY,
        power=Power.POWER,
    )
    attack.step({"one": command(1, action=action)})
    attacker = next(item for item in attack.snapshot().fighters if item.player_id == "one")
    assert attacker.action is PunchClass.HOOK
    assert attacker.action_hand is Hand.LEFT
    assert attacker.action_target is Target.BODY
    assert attacker.action_power is Power.POWER

    down = make_engine(round_ticks=2000)
    down.fighter("two").poise = 1
    down.step({"one": command(1, action=punch(PunchClass.UPPERCUT, power=Power.POWER))})
    advance_until(down, {"knockdown"})
    downed = next(item for item in down.snapshot().fighters if item.player_id == "two")
    standing = next(item for item in down.snapshot().fighters if item.player_id == "one")
    assert downed.is_downed is True
    assert downed.get_up_count == 0
    assert standing.is_downed is False

    clinch = make_engine(round_ticks=2000)
    clinch.step({"one": command(1, action=MovementAction(ActionKind.CLINCH))})
    startup = next(item for item in clinch.snapshot().fighters if item.player_id == "one")
    assert startup.clinch_startup_ticks > 0
    advance_until(clinch, {"clinch"}, limit=12)
    assert all(item.clinch_ticks > 0 for item in clinch.snapshot().fighters)

    foul = make_engine(round_ticks=2000)
    foul.step({"one": command(1, action=FoulAction(Foul.LOW_BLOW))})
    victim = next(item for item in foul.snapshot().fighters if item.player_id == "two")
    offender = next(item for item in foul.snapshot().fighters if item.player_id == "one")
    assert victim.is_foul_recovery_target is True
    assert offender.is_foul_recovery_target is False


def test_event_digest_preserves_history_without_rescanning_event_list() -> None:
    equivalent_one = make_engine(round_ticks=2000)
    equivalent_two = make_engine(round_ticks=2000)
    for engine in (equivalent_one, equivalent_two):
        engine._emit("audit", "one", "two", amount=3, detail="same")
        engine._tick_events.clear()
    assert equivalent_one.snapshot().checksum == equivalent_two.snapshot().checksum

    divergent = make_engine(round_ticks=2000)
    divergent._emit("audit", "one", "two", amount=4, detail="different")
    divergent._tick_events.clear()
    assert divergent.snapshot().checksum != equivalent_one.snapshot().checksum

    class UnscannableHistory(list):
        def __iter__(self):
            raise AssertionError("checksum rescanned historical event ledger")

        def __len__(self):
            raise AssertionError("checksum measured historical event ledger")

        def __getitem__(self, _index):
            raise AssertionError("checksum indexed historical event ledger")

    history = make_engine(round_ticks=2000)
    for index in range(500):
        history._emit("audit", amount=index)
    history._tick_events.clear()
    history._events = UnscannableHistory(history._events)

    assert len(history.snapshot().checksum) == 64


def test_taunt_locks_actions_and_appears_in_snapshot() -> None:
    engine = make_engine(seed=120, round_ticks=2000)
    fighter = engine.fighter("one")
    start_x = fighter.x
    snapshot = engine.step(
        {"one": command(1, action=MovementAction(ActionKind.TAUNT), move_x=1000)}
    )

    assert any(event.kind == "taunt" and event.actor_id == "one" for event in engine.events)
    assert snapshot.fighters[0].taunt_ticks == 60
    for _ in range(20):
        snapshot = engine.step(
            {
                "one": command(
                    2, move_x=1000, action=PunchAction(Hand.LEFT, PunchClass.JAB, Target.HEAD)
                )
            }
        )
    assert fighter.x == start_x
    assert fighter.attack is None
    assert snapshot.fighters[0].taunt_ticks == 40
    while fighter.taunt_ticks > 0:
        engine.step()
    snapshot = engine.step({"one": command(3, move_x=1000)})
    assert fighter.x > start_x
    assert snapshot.fighters[0].taunt_ticks == 0


def test_taunt_is_cancelled_by_knockdown_and_guard_break_stun() -> None:
    engine = make_engine(seed=121, round_ticks=2000)
    taunter = engine.fighter("one")
    engine.step({"one": command(1, action=MovementAction(ActionKind.TAUNT))})
    assert taunter.taunt_ticks > 0
    taunter.poise = 1
    for _ in range(12):
        if engine.phase is MatchPhase.KNOCKDOWN:
            break
        engine.step(
            {"two": command(2, action=PunchAction(Hand.RIGHT, PunchClass.STRAIGHT, Target.HEAD))}
        )
    assert engine.phase is MatchPhase.KNOCKDOWN
    assert taunter.taunt_ticks == 0

    broken = make_engine(seed=122, round_ticks=2000)
    defender = broken.fighter("one")
    broken.step({"one": command(1, action=MovementAction(ActionKind.TAUNT))})
    assert defender.taunt_ticks > 0
    defender.guard = 1
    for _ in range(30):
        if defender.taunt_ticks == 0 and defender.stunned_ticks > 0:
            break
        broken.step(
            {
                "one": command(2, defense=DefensivePose.GUARD_HIGH),
                "two": command(
                    3, action=PunchAction(Hand.RIGHT, PunchClass.STRAIGHT, Target.HEAD, Power.POWER)
                ),
            }
        )
    assert defender.taunt_ticks == 0
    assert defender.stunned_ticks > 0


def test_taunter_cannot_hold_a_guard() -> None:
    engine = make_engine(seed=123, round_ticks=2000)
    fighter = engine.fighter("one")
    engine.step(
        {
            "one": command(
                1, action=MovementAction(ActionKind.TAUNT), defense=DefensivePose.GUARD_HIGH
            )
        }
    )
    engine.step({"one": command(2, defense=DefensivePose.GUARD_HIGH)})
    assert fighter.taunt_ticks > 0
    assert fighter.defense is DefensivePose.NONE


def test_get_up_window_boundary_scores_timed_and_late() -> None:
    timed_engine = make_engine(seed=124, round_ticks=2000)
    timed_downed = timed_engine.fighter("one")
    timed_engine._knock_down(timed_downed, timed_engine.fighter("two"))
    prompt = timed_downed.get_up_prompt
    assert prompt is not None
    while timed_engine.tick < timed_downed.get_up_window_start_tick - 1:
        timed_engine.step()
    timed_engine.step({"one": command(1, action=MovementAction(prompt))})
    timed = [event for event in timed_engine.events if event.kind == "get_up_input"]
    assert timed and timed[-1].detail == "timed"
    assert timed_downed.get_up_meter > 0

    late_engine = make_engine(seed=125, round_ticks=2000)
    late_downed = late_engine.fighter("one")
    late_engine._knock_down(late_downed, late_engine.fighter("two"))
    late_prompt = late_downed.get_up_prompt
    assert late_prompt is not None
    while late_engine.tick < late_downed.get_up_window_end_tick:
        late_engine.step()
    late_engine.step({"one": command(1, action=MovementAction(late_prompt))})
    late = [event for event in late_engine.events if event.kind == "get_up_input"]
    assert late and late[-1].detail == "late"
    assert late_downed.get_up_meter == 0


def test_action_instances_echo_ids_and_retain_after_clearing() -> None:
    engine = make_engine(seed=130, round_ticks=2000)
    one = engine.fighter("one")
    snapshot = engine.step(
        {
            "one": command(
                1, action=PunchAction(Hand.LEFT, PunchClass.JAB, Target.HEAD, client_action_id="c1")
            )
        }
    )
    assert snapshot.fighters[0].action_id == "c1"
    assert snapshot.fighters[0].action_key == "jab:left:head:normal"
    assert snapshot.fighters[0].action_start_tick == snapshot.tick
    assert snapshot.fighters[0].action_startup_ticks >= 2
    punch_start = [event for event in engine.events if event.kind == "punch_start"]
    assert punch_start and punch_start[-1].action_id == "c1"
    contact_tick = None
    while one.attack is not None:
        snapshot = engine.step()
        hit_events = [event for event in snapshot.events if event.kind in ("hit", "block", "whiff")]
        if hit_events:
            contact_tick = snapshot.tick
            assert hit_events[-1].action_id == "c1"
    assert contact_tick is not None
    retained = snapshot
    for _ in range(3):
        retained = engine.step()
    assert retained.fighters[0].action_id == "c1"
    assert retained.fighters[0].action_contact_tick == contact_tick
    for _ in range(20):
        retained = engine.step()
    assert retained.fighters[0].action_id is None


def test_identical_class_actions_get_distinct_fallback_ids() -> None:
    engine = make_engine(seed=131, round_ticks=2000)
    engine.step({"one": command(1, action=PunchAction(Hand.LEFT, PunchClass.JAB, Target.HEAD))})
    first = engine.snapshot().fighters[0].action_id
    one = engine.fighter("one")
    while one.attack is not None:
        engine.step()
    engine.step({"one": command(2, action=PunchAction(Hand.LEFT, PunchClass.JAB, Target.HEAD))})
    second = engine.snapshot().fighters[0].action_id
    assert first is not None and second is not None
    assert first != second


def rest_engine(**trauma: int) -> BoxingEngine:
    """An engine one tick into the rest after round one, with fighter one carrying `trauma`."""
    engine = make_engine(round_ticks=20, rounds=2, rest_ticks=90)
    one = engine.fighter("one")
    for name, value in trauma.items():
        setattr(one.trauma, name, value)
    while engine.phase is not MatchPhase.REST:
        engine.step()
    return engine


def corner(sequence: int, kind: ActionKind) -> InputCommand:
    return command(sequence, action=MovementAction(kind))


def test_corner_closes_the_worse_cut_once_per_rest() -> None:
    engine = rest_engine(left_cut=600, right_cut=200, bleeding=300)
    one = engine.fighter("one")
    assert one.corner_choice is None
    snapshot = engine.step({"one": corner(1, ActionKind.CORNER_CUT)})

    treatment = CORNER_TREATMENTS[CornerChoice.CUT]
    assert [(event.kind, event.detail) for event in snapshot.events] == [("corner", "cut")]
    assert one.trauma.left_cut == 600 - treatment.worse_cut
    assert one.trauma.right_cut == 200 - treatment.other_cut
    assert one.trauma.bleeding <= 300 * treatment.bleeding_kept_percent // 100
    assert snapshot.fighters[0].corner_choice is CornerChoice.CUT

    cut_after = (one.trauma.left_cut, one.trauma.right_cut)
    snapshot = engine.step({"one": corner(2, ActionKind.CORNER_BREATH)})
    assert not [event for event in snapshot.events if event.kind == "corner"]
    assert one.corner_choice is CornerChoice.CUT
    while engine.phase is MatchPhase.REST:
        engine.step()
    assert (one.trauma.left_cut, one.trauma.right_cut) == cut_after
    assert one.corner_choice is CornerChoice.CUT


def test_corner_treats_the_right_cut_when_it_is_the_worse() -> None:
    engine = rest_engine(left_cut=100, right_cut=500)
    engine.step({"one": corner(1, ActionKind.CORNER_CUT)})
    one = engine.fighter("one")
    treatment = CORNER_TREATMENTS[CornerChoice.CUT]
    assert one.trauma.right_cut == 500 - treatment.worse_cut
    assert one.trauma.left_cut == max(0, 100 - treatment.other_cut)


def test_corner_brings_down_the_swelling_and_can_open_a_shut_eye() -> None:
    engine = rest_engine(right_eye=BLIND_SIDE_EYE_THRESHOLD + 50, left_eye=120, swelling=500)
    engine.step({"one": corner(1, ActionKind.CORNER_SWELLING)})
    one = engine.fighter("one")
    treatment = CORNER_TREATMENTS[CornerChoice.SWELLING]
    assert one.trauma.right_eye == BLIND_SIDE_EYE_THRESHOLD + 50 - treatment.eyes
    assert one.trauma.right_eye < BLIND_SIDE_EYE_THRESHOLD
    assert one.trauma.left_eye == max(0, 120 - treatment.eyes)
    assert one.trauma.swelling == 500 - treatment.swelling


def test_corner_catches_the_breath() -> None:
    engine = rest_engine(body=600)
    one = engine.fighter("one")
    one.conditioning = 500
    one.stamina = 100
    one.poise = 50
    engine.step({"one": corner(1, ActionKind.CORNER_BREATH)})
    treatment = CORNER_TREATMENTS[CornerChoice.BREATH]
    assert one.conditioning == 500 + treatment.conditioning
    assert one.trauma.body == 600 - treatment.body
    assert one.stamina == one.maximum_stamina
    assert one.poise == 600


def test_no_corner_instruction_gets_the_balanced_treatment_at_the_bell() -> None:
    engine = rest_engine(left_cut=400, swelling=300, right_eye=500)
    one = engine.fighter("one")
    one.conditioning = 700
    while engine.phase is MatchPhase.REST:
        snapshot = engine.step()
    treatment = CORNER_TREATMENTS[CornerChoice.BALANCED]
    assert ("corner", "balanced") in [(event.kind, event.detail) for event in snapshot.events]
    assert one.corner_choice is CornerChoice.BALANCED
    assert one.trauma.left_cut == 400 - treatment.worse_cut
    assert one.trauma.swelling == 300 - treatment.swelling
    assert one.trauma.right_eye == 500 - treatment.eyes
    assert one.conditioning == 700


def test_corner_choice_resets_for_each_rest() -> None:
    engine = make_engine(round_ticks=20, rounds=3, rest_ticks=40)
    while engine.phase is not MatchPhase.REST:
        engine.step()
    engine.step({"one": corner(1, ActionKind.CORNER_CUT)})
    while engine.phase is MatchPhase.REST:
        engine.step()
    while engine.phase is not MatchPhase.REST:
        engine.step()
    assert engine.fighter("one").corner_choice is None
    assert engine.snapshot().fighters[0].corner_choice is None


def test_corner_instructions_outside_the_rest_do_nothing() -> None:
    engine = make_engine(round_ticks=200)
    one = engine.fighter("one")
    one.trauma.left_cut = 500
    for sequence, kind in enumerate(
        (ActionKind.CORNER_CUT, ActionKind.CORNER_SWELLING, ActionKind.CORNER_BREATH), start=1
    ):
        engine.step({"one": corner(sequence, kind)})
        for _ in range(8):
            engine.step()
    assert not [event for event in engine.events if event.kind == "corner"]
    assert one.trauma.left_cut == 500
    assert one.corner_choice is None


def test_a_bout_without_a_rest_has_no_corner() -> None:
    engine = make_engine(round_ticks=20, rounds=2, rest_ticks=0)
    while engine.round_number == 1:
        engine.step()
    assert not [event for event in engine.events if event.kind == "corner"]


def blind_engine(right_eye: int) -> BoxingEngine:
    engine = make_engine(round_ticks=2000)
    engine.fighter("two").trauma.right_eye = right_eye
    return engine


def test_a_shut_eye_cannot_see_the_punch_coming() -> None:
    lead_straight = punch(PunchClass.STRAIGHT, hand=Hand.LEFT)
    slip = MovementAction(ActionKind.SLIP_RIGHT)

    seeing = blind_engine(BLIND_SIDE_EYE_THRESHOLD - 1)
    seeing.step({"one": command(1, action=lead_straight), "two": command(1, action=slip)})
    assert advance_until(seeing, {"evade", "hit"}) == "evade"

    blind = blind_engine(BLIND_SIDE_EYE_THRESHOLD)
    blind.step({"one": command(1, action=lead_straight), "two": command(1, action=slip)})
    assert advance_until(blind, {"evade", "hit"}) == "hit"
    landed = [event for event in blind.events if event.kind == "blind_side"]
    assert [(event.actor_id, event.target_id, event.detail) for event in landed] == [
        ("one", "two", "right")
    ]


def test_a_punch_on_the_blind_side_lands_harder() -> None:
    seeing = blind_engine(0)
    blind = blind_engine(BLIND_SIDE_EYE_THRESHOLD)
    for engine in (seeing, blind):
        engine.step({"one": command(1, action=punch(PunchClass.STRAIGHT, hand=Hand.LEFT))})
        advance_until(engine, {"hit"})
    seen = next(event for event in seeing.events if event.kind == "hit")
    unseen = next(event for event in blind.events if event.kind == "hit")
    assert unseen.amount == seen.amount * 120 // 100
    assert unseen.amount > seen.amount


def test_the_open_side_is_still_seen() -> None:
    engine = blind_engine(1000)
    engine.step(
        {
            "one": command(1, action=punch(PunchClass.STRAIGHT, hand=Hand.RIGHT)),
            "two": command(1, action=MovementAction(ActionKind.SLIP_LEFT)),
        }
    )
    assert advance_until(engine, {"evade", "hit"}) == "evade"
    assert not [event for event in engine.events if event.kind == "blind_side"]


def perfect_guard_engine(power: Power, right_eye: int = 0) -> BoxingEngine:
    """Fighter two raises the high guard two ticks before fighter one's left straight lands."""
    engine = make_engine(round_ticks=2000)
    engine.fighter("two").trauma.right_eye = right_eye
    engine.step({"one": command(1, action=punch(PunchClass.STRAIGHT, hand=Hand.LEFT, power=power))})
    attack = engine.fighter("one").attack
    assert attack is not None
    while attack.age < attack.rule.startup - 2:
        engine.step()
    engine.step({"two": command(1, defense=DefensivePose.GUARD_HIGH)})
    return engine


def test_no_perfect_block_on_the_blind_side() -> None:
    assert advance_until(perfect_guard_engine(Power.NORMAL), {"block", "perfect_block"}) == (
        "perfect_block"
    )
    blind = perfect_guard_engine(Power.NORMAL, right_eye=BLIND_SIDE_EYE_THRESHOLD)
    assert advance_until(blind, {"block", "perfect_block"}) == "block"


def test_an_eye_swelling_shut_is_announced_once() -> None:
    engine = blind_engine(BLIND_SIDE_EYE_THRESHOLD - 60)
    engine.step({"one": command(1, action=punch(PunchClass.HOOK, hand=Hand.LEFT))})
    advance_until(engine, {"hit"})
    shut = [event for event in engine.events if event.kind == "eye_shut"]
    assert [(event.target_id, event.detail) for event in shut] == [("two", "right")]
    while engine.fighter("one").attack is not None:
        engine.step()
    for _ in range(30):
        engine.step()
    engine.step({"one": command(2, action=punch(PunchClass.HOOK, hand=Hand.LEFT))})
    advance_until(engine, {"hit"})
    assert len([event for event in engine.events if event.kind == "eye_shut"]) == 1


def test_parrying_a_power_punch_staggers_the_puncher() -> None:
    engine = perfect_guard_engine(Power.POWER)
    assert advance_until(engine, {"block", "perfect_block"}) == "perfect_block"
    parries = [event for event in engine.events if event.kind == "parry"]
    assert [(event.actor_id, event.target_id) for event in parries] == [("two", "one")]
    one = engine.fighter("one")
    assert one.stunned_ticks == PARRY_STAGGER_TICKS
    assert one.attack is None

    engine.step({"two": command(2, action=punch(PunchClass.JAB, hand=Hand.LEFT))})
    assert advance_until(engine, {"counter_hit", "hit", "block", "perfect_block"}) == "counter_hit"


def test_parrying_an_ordinary_punch_does_not_stagger() -> None:
    engine = perfect_guard_engine(Power.NORMAL)
    assert advance_until(engine, {"block", "perfect_block"}) == "perfect_block"
    assert not [event for event in engine.events if event.kind == "parry"]
    assert engine.fighter("one").stunned_ticks == 0


def body_shot_engine(
    *, body: int, stamina: int, guard: DefensivePose = DefensivePose.NONE, guard_meter: int = 700
) -> BoxingEngine:
    engine = make_engine(round_ticks=2000)
    two = engine.fighter("two")
    two.trauma.body = body
    two.stamina = stamina
    two.guard = guard_meter
    engine.step(
        {
            "one": command(
                1,
                action=PunchAction(
                    Hand.LEFT, PunchClass.HOOK, Target.BODY, client_action_id="liver"
                ),
            ),
            "two": command(1, defense=guard),
        }
    )
    return engine


def test_a_broken_body_goes_down_after_a_moment() -> None:
    engine = body_shot_engine(body=700, stamina=300)
    advance_until(engine, {"hit"})
    collapse = [event for event in engine.events if event.kind == "body_collapse"]
    assert [(event.actor_id, event.target_id, event.action_id) for event in collapse] == [
        ("one", "two", "liver")
    ]
    two = engine.fighter("two")
    assert engine.phase is MatchPhase.FIGHT
    assert two.stunned_ticks > 0
    for _ in range(BODY_COLLAPSE_DELAY_TICKS - 1):
        snapshot = engine.step()
        assert engine.phase is MatchPhase.FIGHT
        assert not [event for event in snapshot.events if event.kind == "knockdown"]
    snapshot = engine.step()
    knockdowns = [event for event in snapshot.events if event.kind == "knockdown"]
    assert [(event.target_id, event.detail, event.action_id) for event in knockdowns] == [
        ("two", "body", "liver")
    ]
    assert engine.phase is MatchPhase.KNOCKDOWN
    assert two.knockdowns == 1


@pytest.mark.parametrize(
    ("body", "stamina", "guard", "guard_meter"),
    [
        (500, 300, DefensivePose.NONE, 700),
        (700, 900, DefensivePose.NONE, 700),
        # A worn guard leaks most of the shot, but a blocked shot still never drops him.
        (700, 300, DefensivePose.GUARD_LOW, 100),
    ],
)
def test_a_body_shot_only_drops_a_tired_broken_unguarded_fighter(
    body: int, stamina: int, guard: DefensivePose, guard_meter: int
) -> None:
    engine = body_shot_engine(body=body, stamina=stamina, guard=guard, guard_meter=guard_meter)
    contact = advance_until(engine, {"hit", "block", "perfect_block"})
    if guard is not DefensivePose.NONE:
        assert contact == "block"
        blocked = next(event for event in engine.events if event.kind == "hit")
        assert blocked.amount >= 40
    for _ in range(BODY_COLLAPSE_DELAY_TICKS + 5):
        engine.step()
    assert not [event for event in engine.events if event.kind in ("body_collapse", "knockdown")]


def test_the_bell_saves_a_fighter_who_is_going_down_from_a_body_shot() -> None:
    engine = body_shot_engine(body=700, stamina=300)
    advance_until(engine, {"hit"})
    assert engine.fighter("two").body_collapse_ticks > 0
    engine.phase_ticks_remaining = 2
    while engine.phase is MatchPhase.FIGHT:
        engine.step()
    assert engine.phase is MatchPhase.REST
    for _ in range(BODY_COLLAPSE_DELAY_TICKS + 5):
        engine.step()
    assert not [event for event in engine.events if event.kind == "knockdown"]
    assert engine.fighter("two").body_collapse_ticks == 0


def test_a_knockdown_from_a_body_shot_says_so() -> None:
    engine = make_engine(round_ticks=2000)
    engine.fighter("two").poise = 1
    engine.step(
        {
            "one": command(
                1,
                action=PunchAction(
                    Hand.RIGHT, PunchClass.UPPERCUT, Target.BODY, client_action_id="dig"
                ),
            )
        }
    )
    advance_until(engine, {"knockdown"})
    knockdown = next(event for event in engine.events if event.kind == "knockdown")
    assert (knockdown.detail, knockdown.action_id) == ("body", "dig")

    head = make_engine(round_ticks=2000)
    head.fighter("two").poise = 1
    head.step({"one": command(1, action=punch(PunchClass.UPPERCUT))})
    advance_until(head, {"knockdown"})
    knockdown = next(event for event in head.events if event.kind == "knockdown")
    assert (knockdown.detail, knockdown.action_id) == ("", None)


def test_a_clean_body_shot_takes_the_wind_and_a_blocked_one_does_not() -> None:
    for guard, winded in ((DefensivePose.NONE, True), (DefensivePose.GUARD_LOW, False)):
        engine = body_shot_engine(body=0, stamina=500, guard=guard)
        attack = engine.fighter("one").attack
        assert attack is not None
        while attack.age + 1 < attack.rule.startup:
            engine.step()
        before = engine.fighter("two").stamina
        snapshot = engine.step()
        contact = next(event for event in snapshot.events if event.kind in ("hit", "block"))
        lost = before - engine.fighter("two").stamina
        if winded:
            assert contact.kind == "hit"
            assert lost >= contact.amount * BODY_WIND_PERCENT // 100 - 4
        else:
            assert contact.kind == "block"
            assert lost <= 0


def test_recovery_is_only_cut_short_for_a_follow_up_the_fighter_can_afford() -> None:
    engine = make_engine(round_ticks=2000)
    one = engine.fighter("one")
    jab = punch(PunchClass.JAB, hand=Hand.LEFT)
    straight = punch(PunchClass.STRAIGHT)
    straight_cost = PUNCH_RULES[(PunchClass.STRAIGHT, Target.HEAD, Power.NORMAL)].stamina_cost
    jab_cost = PUNCH_RULES[(PunchClass.JAB, Target.HEAD, Power.NORMAL)].stamina_cost
    one.stamina = jab_cost + straight_cost - 25
    engine.step({"one": command(1, action=jab)})
    attack = one.attack
    assert attack is not None
    engine.step({"one": command(2, action=straight)})
    kinds: set[str] = set()
    while engine.tick <= attack.start_tick + attack.cancel_age:
        kinds.update(event.kind for event in engine.step().events)
    assert "hit" in kinds
    assert one.stamina < straight_cost
    assert one.attack is attack


def test_a_parried_punch_cannot_be_cut_short_into_a_combo_but_a_blocked_one_can() -> None:
    def cut_short(*, parried: bool) -> tuple[bool, set[str]]:
        engine = make_engine(round_ticks=2000)
        one = engine.fighter("one")
        jab = punch(PunchClass.JAB, hand=Hand.LEFT)
        if not parried:
            engine.step({"two": command(1, defense=DefensivePose.GUARD_HIGH)})
            for _ in range(10):
                engine.step()
        engine.step(
            {
                "one": command(1, action=jab),
                "two": command(2, defense=DefensivePose.GUARD_HIGH),
            }
        )
        attack = one.attack
        assert attack is not None
        engine.step({"one": command(2, action=punch(PunchClass.STRAIGHT))})
        kinds: set[str] = set()
        while engine.tick <= attack.start_tick + attack.cancel_age:
            kinds.update(event.kind for event in engine.step().events)
        return one.attack is not attack, kinds

    parried, parried_events = cut_short(parried=True)
    assert "perfect_block" in parried_events
    assert not parried
    blocked, blocked_events = cut_short(parried=False)
    assert "block" in blocked_events and "perfect_block" not in blocked_events
    assert blocked


@pytest.mark.parametrize("mashes_weave", [False, True])
def test_an_early_buffered_hook_uppercut_chain_cannot_hold_a_stunned_fighter(
    mashes_weave: bool,
) -> None:
    engine = make_engine(round_ticks=2000)
    one = engine.fighter("one")
    two = engine.fighter("two")
    follow_ups = {
        PunchClass.STRAIGHT: punch(PunchClass.HOOK, hand=Hand.LEFT),
        PunchClass.HOOK: punch(PunchClass.UPPERCUT),
        PunchClass.UPPERCUT: punch(PunchClass.HOOK, hand=Hand.LEFT),
    }
    engine.step({"one": command(1, action=punch(PunchClass.STRAIGHT))})
    pressed_during = None
    sequence = 1
    stunned = False
    free_ticks = 0
    while engine.phase is MatchPhase.FIGHT and engine.tick < 300:
        inputs = {}
        attack = one.attack
        if attack is not None and attack is not pressed_during:
            # One press early in every punch: the buffer keeps it until the punch gives way.
            sequence += 1
            inputs["one"] = command(sequence, action=follow_ups[attack.action.punch_class])
            pressed_during = attack
        if mashes_weave:
            inputs["two"] = command(engine.tick, action=MovementAction(ActionKind.WEAVE))
        running_stun = two.stunned_ticks
        before = one.attack
        engine.step(inputs)
        cut_short = before is not None and one.attack is not None and one.attack is not before
        if running_stun > 1:
            assert two.stunned_ticks < running_stun, "a punch started a running stun again"
            assert not cut_short, "a punch was cut short into a stunned fighter"
        stunned = stunned or two.stunned_ticks > 0
        if stunned and engine.phase is MatchPhase.FIGHT and two.stunned_ticks == 0:
            free_ticks += 1

    assert stunned
    assert free_ticks > 0


@dataclasses.dataclass
class _ChainAgainstAStillDefender:
    stuns: list[int] = dataclasses.field(default_factory=list)
    longest_chain: int = 0
    free_ticks: int = 0
    hits_on_a_running_stun: int = 0
    flinching_hits_in_the_clear_moment: int = 0
    rocked_in_the_clear_moment: int = 0


def _chain_into_a_still_defender(poise: int | None, power: Power) -> _ChainAgainstAStillDefender:
    """A straight, then a hook and uppercut chain with one early press per punch, into a defender
    who stands still until poise puts him down. Asserts the stun rules on every tick."""
    engine = make_engine(round_ticks=2000)
    one = engine.fighter("one")
    two = engine.fighter("two")
    if poise is not None:
        two.poise = poise
    follow_ups = {
        PunchClass.STRAIGHT: punch(PunchClass.HOOK, hand=Hand.LEFT, power=power),
        PunchClass.HOOK: punch(PunchClass.UPPERCUT, power=power),
        PunchClass.UPPERCUT: punch(PunchClass.HOOK, hand=Hand.LEFT, power=power),
    }
    engine.step({"one": command(1, action=punch(PunchClass.STRAIGHT, power=power))})
    seen = _ChainAgainstAStillDefender()
    pressed_during = None
    sequence = 1
    worn_off_at: int | None = None
    while engine.phase is MatchPhase.FIGHT and engine.tick < 600:
        inputs = {}
        attack = one.attack
        if attack is not None and attack is not pressed_during:
            sequence += 1
            inputs["one"] = command(sequence, action=follow_ups[attack.action.punch_class])
            pressed_during = attack
        running = two.stunned_ticks
        before = one.attack
        snapshot = engine.step(inputs)
        if engine.phase is not MatchPhase.FIGHT:
            break
        events = snapshot.events
        flinching_hit = any(
            event.kind in ("hit", "counter_hit") and event.amount >= FLINCH_MINIMUM_DAMAGE
            for event in events
        )
        rocked = any(event.kind == "stun" and event.target_id == "two" for event in events)
        assert two.stun_chain_ticks <= STUN_CHAIN_MAX_TICKS
        seen.longest_chain = max(seen.longest_chain, two.stun_chain_ticks)
        if running > 1:
            assert two.stunned_ticks == running - 1, "a punch started a running stun again"
            cut_short = before is not None and one.attack is not None and one.attack is not before
            assert not cut_short, "a punch was cut short into a stunned fighter"
            seen.hits_on_a_running_stun += flinching_hit
            continue
        # A stun that wears off this tick opens the clear moment, whichever fighter moved first.
        clear_moment = running == 1 or (
            worn_off_at is not None and engine.tick - worn_off_at < STUN_IMMUNITY_TICKS
        )
        if running == 1:
            worn_off_at = engine.tick
        if two.stunned_ticks > 0:
            seen.stuns.append(two.stunned_ticks)
            assert two.stunned_ticks <= STUN_CHAIN_MAX_TICKS
            assert worn_off_at is None or engine.tick - worn_off_at >= ROCKED_IMMUNITY_TICKS, (
                "a stun started again before he could raise a guard"
            )
            if clear_moment:
                assert rocked, "a flinch landed in the clear moment after a stun"
                seen.rocked_in_the_clear_moment += 1
        else:
            seen.free_ticks += bool(seen.stuns)
            if running == 0 and clear_moment:
                seen.flinching_hits_in_the_clear_moment += flinching_hit
    return seen


def test_a_still_defender_gets_free_ticks_from_a_chain_of_combinations_inside_the_stun_cap() -> (
    None
):
    # Fresh, he flinches. A shot hard enough to flinch him does not stop him again in the clear
    # moment after a stun, and a punch that lands on a running stun does not start it again.
    fresh = _chain_into_a_still_defender(None, Power.NORMAL)
    assert len(fresh.stuns) >= 3
    assert fresh.free_ticks > 0
    assert fresh.flinching_hits_in_the_clear_moment > 0
    assert fresh.hits_on_a_running_stun > 0

    # Hurt, every clean shot rocks him, and still the chain cannot hold him.
    hurt = _chain_into_a_still_defender(ROCKED_HURT_POISE - 1, Power.NORMAL)
    assert hurt.stuns and hurt.hits_on_a_running_stun > 0
    assert hurt.free_ticks > 0

    # Power shots rock him even in the clear moment, but never past the chain cap.
    power = _chain_into_a_still_defender(None, Power.POWER)
    assert power.rocked_in_the_clear_moment > 0
    assert power.hits_on_a_running_stun > 0
    assert power.free_ticks > 0

    for seen in (fresh, hurt, power):
        assert max(seen.stuns) <= STUN_CHAIN_MAX_TICKS
        assert seen.longest_chain <= STUN_CHAIN_MAX_TICKS


def test_fighters_walking_to_their_corners_go_round_each_other() -> None:
    engine = make_engine(round_ticks=3, rounds=2, rest_ticks=300)
    one = engine.fighter("one")
    two = engine.fighter("two")
    one.x, one.y = 60, 60
    two.x, two.y = -60, -60
    while engine.phase is not MatchPhase.REST:
        engine.step()
    closest = hypot(one.x - two.x, one.y - two.y)
    while engine.phase is MatchPhase.REST:
        engine.step()
        closest = min(closest, hypot(one.x - two.x, one.y - two.y))
    assert closest >= MINIMUM_SEPARATION - 3
    assert (one.x, one.y) == (-REST_CORNER_OFFSET, -REST_CORNER_OFFSET)
    assert (two.x, two.y) == (REST_CORNER_OFFSET, REST_CORNER_OFFSET)


@pytest.mark.parametrize("rest_ticks", [5, 0])
def test_the_bell_clears_evasion_counter_and_combo_windows(rest_ticks: int) -> None:
    engine = make_engine(round_ticks=20, rounds=2, rest_ticks=rest_ticks)
    one = engine.fighter("one")
    while engine.tick < 18:
        engine.step()
    engine.step({"one": command(1, action=MovementAction(ActionKind.SLIP_LEFT))})
    assert one.evasion_ticks > 0
    one.counter_ticks = 17
    one.combo_ticks = 12
    while engine.round_number == 1:
        engine.step()
    assert (one.evasion_ticks, one.counter_ticks, one.combo_ticks) == (0, 0, 0)


@pytest.mark.parametrize("rest_ticks", [150, 0])
def test_the_bell_ends_a_stun_and_its_clear_moment_along_with_the_held_input(
    rest_ticks: int,
) -> None:
    engine = make_engine(round_ticks=30, rounds=2, rest_ticks=rest_ticks)
    two = engine.fighter("two")
    engine.step({"two": command(1, move_x=-1000, defense=DefensivePose.GUARD_HIGH)})
    while engine.phase_ticks_remaining > 2:
        engine.step()
    # Stunned as the bell goes, still inside the clear moment of an earlier stun.
    two.stunned_ticks = 20
    two.stun_chain_ticks = 5
    two.stun_immune_until_tick = engine.tick + STUN_IMMUNITY_TICKS
    while engine.round_number == 1:
        engine.step()

    assert (two.stunned_ticks, two.stun_chain_ticks, two.stun_immune_until_tick) == (0, 0, -1)
    held = two.held_input
    assert (held.move_x, held.move_y, held.defense) == (0, 0, DefensivePose.NONE)


@pytest.mark.parametrize("rest_ticks", [150, 0])
def test_a_walk_and_guard_held_at_the_bell_do_not_carry_into_the_next_round(
    rest_ticks: int,
) -> None:
    engine = make_engine(round_ticks=30, rounds=2, rest_ticks=rest_ticks)
    one = engine.fighter("one")
    engine.fighter("two").x = 300
    # Walking in behind a high guard at the bell, then no more frames: clients stop sending
    # between rounds.
    engine.step({"one": command(1, move_x=1000, defense=DefensivePose.GUARD_HIGH)})
    while engine.round_number == 1:
        engine.step()
    snapshots = [engine.step() for _ in range(7)]

    assert [snapshot.fighters[0].defense for snapshot in snapshots] == [DefensivePose.NONE] * 7
    assert (one.velocity_x, one.velocity_y) == (0, 0)


def test_the_facing_blends_toward_the_opponent_before_and_after_footwork_each_fight_tick() -> None:
    engine = make_engine(round_ticks=2000)
    one = engine.fighter("one")
    two = engine.fighter("two")
    one.x = one.y = 0
    two.x, two.y = 0, 300
    engine.step()
    turned = math.degrees(math.atan2(one.facing_y, one.facing_x))
    single_blend = math.degrees(math.atan2(350, 650))
    assert turned > single_blend + 15
    assert 46 < turned < 52


def _manifest() -> dict[str, dict[str, int]]:
    resource = resources.files("intelstream.hands").joinpath("combat-manifest.json")
    return json.loads(resource.read_text())  # type: ignore[no-any-return]


def test_the_most_get_up_presses_asked_for_is_the_bound_the_client_derives() -> None:
    # web/hands/src/manifest.ts derives GET_UP_REQUIRED_MAX from the manifest with this formula:
    # three knockdowns on a head beaten to the cap. A different engine formula must change both.
    engine = make_engine()
    two = engine.fighter("two")
    two.knockdowns = 3
    two.trauma.head = 1400
    knockdown = _manifest()["knockdown"]
    assert engine._get_up_required(two) == (
        knockdown["get_up_base"]
        + 3 * knockdown["get_up_per_knockdown"]
        + 1400 // knockdown["get_up_trauma_divisor"]
    )


def test_a_clean_hit_through_a_guard_too_worn_to_block_lands_and_can_flash() -> None:
    engine = make_engine(seed=11, flash=True)
    one, two = engine.fighter("one"), engine.fighter("two")
    two.guard = GUARD_BLOCK_MINIMUM - 1
    two.trauma.head = 300
    one.counter_ticks = 30
    engine.step({"one": command(1, action=punch(PunchClass.HOOK, power=Power.POWER))})
    attack = one.attack
    assert attack is not None
    while attack.age < attack.rule.startup - 2:
        two.guard = GUARD_BLOCK_MINIMUM - 1
        engine.step()
    kinds: list[str] = []
    two.guard = GUARD_BLOCK_MINIMUM - 1
    snapshot = engine.step({"two": command(1, defense=DefensivePose.GUARD_HIGH)})
    kinds.extend(event.kind for event in snapshot.events)
    while not attack.resolved:
        two.guard = GUARD_BLOCK_MINIMUM - 1
        kinds.extend(event.kind for event in engine.step().events)
    assert "block" not in kinds and "perfect_block" not in kinds
    assert "hit" in kinds or "counter_hit" in kinds
    assert attack.landed is True
    assert "flash_roll" in kinds


def test_checksum_covers_every_number_a_fighter_carries() -> None:
    base = make_engine(seed=303).snapshot().checksum
    for state_field in dataclasses.fields(FighterState):
        changed = make_engine(seed=303)
        fighter = changed.fighter("one")
        value = getattr(fighter, state_field.name)
        # An expiry with nothing pending decides nothing, so the checksum leaves it out on purpose.
        if state_field.name == "pending_action_expires_tick":
            continue
        if isinstance(value, bool) or not isinstance(value, int):
            continue
        setattr(fighter, state_field.name, value + 1)
        assert changed.snapshot().checksum != base, state_field.name


def test_checksum_covers_every_choice_a_fighter_carries() -> None:
    base = make_engine(seed=303).snapshot().checksum
    checked = []
    for state_field in dataclasses.fields(FighterState):
        changed = make_engine(seed=303)
        fighter = changed.fighter("one")
        value = getattr(fighter, state_field.name)
        if isinstance(value, bool):
            setattr(fighter, state_field.name, not value)
        elif isinstance(value, Enum):
            other = next(member for member in type(value) if member is not value)
            setattr(fighter, state_field.name, other)
        else:
            continue
        checked.append(state_field.name)
        assert changed.snapshot().checksum != base, state_field.name
    assert {"stance", "style", "defense"} <= set(checked)


def test_engines_that_differ_only_in_the_styles_never_share_a_checksum() -> None:
    def checksums(styles: tuple[FighterStyle, FighterStyle]) -> list[str]:
        engine = BoxingEngine(
            match_id="styles",
            activity_instance_id="instance-1",
            guild_id="guild-1",
            player_one_id="one",
            player_two_id="two",
            seed=5,
            styles=styles,
        )
        return [engine.step().checksum for _ in range(20)]

    balanced = checksums((FighterStyle.BALANCED, FighterStyle.BALANCED))
    styled = checksums((FighterStyle.COUNTER_PUNCHER, FighterStyle.SLUGGER))
    assert all(one != two for one, two in zip(balanced, styled, strict=True))


def test_a_bout_ended_on_the_punch_leaves_no_poise_below_zero() -> None:
    engine = make_engine(seed=7, flash=True)
    engine.fighter("two").poise = 40
    engine.fighter("two").trauma.head = 300
    engine.fighter("one").counter_ticks = 30
    engine._flash_chance = lambda *_args: 10_000  # type: ignore[method-assign]
    snapshot = engine.step({"one": command(1, action=punch(PunchClass.HOOK, power=Power.POWER))})
    while engine.result is None:
        snapshot = engine.step()
    assert engine.result.finish_method is FinishMethod.FLASH_KO
    assert all(fighter.poise >= 0 for fighter in snapshot.fighters)


def test_bleeding_never_leaves_more_stamina_than_the_fighter_can_hold() -> None:
    engine = make_engine(seed=3, doctor_cut_threshold=10_000, doctor_swelling_threshold=10_000)
    engine.fighter("one").x, engine.fighter("two").x = -300, 300
    engine.fighter("two").trauma.bleeding = 1000
    engine.fighter("two").conditioning = 900
    for _ in range(300):
        for fighter in engine.step().fighters:
            assert fighter.stamina <= fighter.maximum_stamina


def test_a_stunned_fighter_stumbles_at_a_share_of_his_footwork() -> None:
    engine = make_engine(seed=13)
    one = engine.fighter("one")
    engine.fighter("two").x = 400
    one.stunned_ticks = 30
    engine.step({"one": command(1, move_x=-1000)})
    for _ in range(8):
        engine.step()
    speed = hypot(one.velocity_x, one.velocity_y)
    assert 0 < speed <= max(2, 7 * STUNNED_SPEED_PERCENT // 100)
    one.stunned_ticks = 0
    for _ in range(8):
        engine.step()
    assert hypot(one.velocity_x, one.velocity_y) == 7


def test_a_stun_ends_the_weave_it_lands_on_so_he_stumbles_instead_of_standing_frozen() -> None:
    engine = make_engine(seed=13)
    two = engine.fighter("two")
    # A weave does not take a straight: it lands mid-weave, walking away.
    engine.step(
        {
            "one": command(1, action=punch(PunchClass.STRAIGHT)),
            "two": command(1, action=MovementAction(ActionKind.WEAVE), move_x=1000),
        }
    )
    assert two.evasion_ticks > 0
    advance_until(engine, {"hit"})
    stunned = two.stunned_ticks
    assert stunned > 0 and two.evasion_ticks > 0
    engine.step()
    assert (two.evasion_ticks, two.defense) == (0, DefensivePose.NONE)
    start = two.x
    while two.stunned_ticks > 0:
        engine.step()
    assert two.x - start >= (stunned - 2) * 2
    engine.step()
    assert two.defense is DefensivePose.NONE and two.evasion_ticks == 0


def test_a_fighter_folding_over_a_body_shot_stands_frozen_until_he_drops() -> None:
    engine = make_engine(seed=7)
    two = engine.fighter("two")
    two.trauma.body = 800
    two.stamina = 300
    engine.step(
        {
            "one": command(
                1,
                action=punch(
                    PunchClass.HOOK, hand=Hand.LEFT, target=Target.BODY, power=Power.POWER
                ),
            )
        }
    )
    collapsed_at = None
    for _ in range(30):
        if any(event.kind == "body_collapse" for event in engine.step().events):
            collapsed_at = (two.x, two.y)
            break
    assert collapsed_at is not None
    sequence = 1
    while engine.phase is MatchPhase.FIGHT:
        engine.step({"two": command(sequence, move_x=1000)})
        sequence += 1
    assert engine.phase is MatchPhase.KNOCKDOWN
    assert (two.x, two.y) == collapsed_at


@pytest.mark.parametrize(("ticks_before", "first_down"), [(0, "two"), (1, "one")])
def test_two_body_collapses_on_one_tick_favour_neither_seat(
    ticks_before: int, first_down: str
) -> None:
    engine = make_engine(seed=17)
    for _ in range(ticks_before):
        engine.step()
    for fighter in (engine.fighter("one"), engine.fighter("two")):
        fighter.body_collapse_ticks = 1
        fighter.body_collapse_action_id = "trade"
    knockdowns = [event for event in engine.step().events if event.kind == "knockdown"]
    assert [event.target_id for event in knockdowns] == [first_down]


def _down_two(engine: BoxingEngine) -> None:
    engine.fighter("two").poise = 1
    engine.step({"one": command(1, action=punch(PunchClass.UPPERCUT, power=Power.POWER))})
    advance_until(engine, {"knockdown"})
    assert engine.phase is MatchPhase.KNOCKDOWN


def _rise_at(engine: BoxingEngine, count: int) -> list[CombatEvent]:
    """Let the referee reach `count`, then fill the get-up meter: two rises on the next tick."""
    while engine._knockdown_count_ticks < count * COUNT_TICK_INTERVAL:
        engine.step()
    two = engine.fighter("two")
    two.get_up_meter = engine._get_up_required(two)
    return list(engine.step().events)


def test_a_fighter_who_beats_the_count_takes_the_mandatory_eight_before_they_box() -> None:
    engine = make_engine(round_ticks=2000)
    _down_two(engine)
    clock = engine._paused_fight_ticks
    two = engine.fighter("two")
    risen_at = (two.x, two.y)
    events = _rise_at(engine, 2)
    assert [event.amount for event in events if event.kind == "get_up"] == [2]

    counts: list[int] = []
    shown: list[int] = []
    sequence = 1
    box_tick = engine.tick - engine._knockdown_count_ticks + MANDATORY_COUNT * COUNT_TICK_INTERVAL
    box_tick += BOX_PAUSE_TICKS
    while engine.phase is MatchPhase.KNOCKDOWN:
        view = next(item for item in engine.snapshot().fighters if item.player_id == "two")
        assert not view.is_downed and view.get_up_prompt is None
        assert engine.phase_ticks_remaining == box_tick - engine.tick
        shown.append(view.get_up_count)
        # Nothing he presses counts until the referee waves them on.
        snapshot = engine.step({"two": command(sequence, action=punch(), move_x=1000)})
        sequence += 1
        counts += [event.amount for event in snapshot.events if event.kind == "count"]
        assert (two.x, two.y) == risen_at
    assert engine.tick == box_tick
    assert counts == [3, 4, 5, 6, 7, 8]
    assert shown == sorted(shown) and shown[0] == 2 and shown[-1] == MANDATORY_COUNT
    assert [event.target_id for event in engine.events if event.kind == "box"] == ["two"]
    assert engine.phase is MatchPhase.FIGHT
    assert engine.phase_ticks_remaining == clock
    assert two.stunned_ticks == GET_UP_STUN_TICKS
    assert {view.get_up_count for view in engine.snapshot().fighters} == {MANDATORY_COUNT}


def test_a_late_get_up_still_gets_the_referee_s_look_before_the_box() -> None:
    engine = make_engine(round_ticks=2000)
    _down_two(engine)
    events = _rise_at(engine, 9)
    assert [event.amount for event in events if event.kind == "get_up"] == [9]
    for _ in range(BOX_PAUSE_TICKS - 1):
        snapshot = engine.step()
        assert engine.phase is MatchPhase.KNOCKDOWN and engine.result is None
        assert not [event for event in snapshot.events if event.kind in {"count", "box"}]
        assert {view.get_up_count for view in snapshot.fighters} == {9}
    assert [event.kind for event in engine.step().events if event.kind == "box"] == ["box"]
    assert engine.phase is MatchPhase.FIGHT
    # The count the referee reached stays on the snapshot, inside what the client accepts.
    for _ in range(3 * COUNT_TICK_INTERVAL):
        assert {view.get_up_count for view in engine.step().fighters} == {9}


def test_a_meter_filled_as_the_count_reaches_ten_is_too_late() -> None:
    engine = make_engine(round_ticks=2000)
    _down_two(engine)
    two = engine.fighter("two")
    while engine._knockdown_count_ticks < 10 * COUNT_TICK_INTERVAL - 1:
        engine.step()
    two.get_up_meter = engine._get_up_required(two)
    events = engine.step().events
    assert "get_up" not in [event.kind for event in events]
    assert engine.result is not None
    assert engine.result.finish_method is FinishMethod.KO
    assert engine.phase is MatchPhase.COMPLETE

    # A tick earlier, at nine and a bit, he still beats it.
    engine = make_engine(round_ticks=2000)
    _down_two(engine)
    while engine._knockdown_count_ticks < 10 * COUNT_TICK_INTERVAL - 2:
        engine.step()
    engine.fighter("two").get_up_meter = engine._get_up_required(engine.fighter("two"))
    assert [event.amount for event in engine.step().events if event.kind == "get_up"] == [9]
    assert engine.result is None


def test_round_one_opens_with_the_introductions_and_later_rounds_with_the_bell() -> None:
    opening = _manifest()["countdown"]["opening_ticks"]
    assert opening >= 8 * COUNT_TICK_INTERVAL
    config = dataclasses.replace(EngineConfig(), rounds=2, round_ticks=30, rest_ticks=10)
    assert config.countdown_ticks == opening
    engine = BoxingEngine(
        match_id="intro",
        activity_instance_id="instance-1",
        guild_id="guild-1",
        player_one_id="one",
        player_two_id="two",
        seed=3,
        config=config,
    )
    phases = []
    while engine.result is None:
        phases.append(engine.phase)
        engine.step()
    assert phases[:opening] == [MatchPhase.COUNTDOWN] * opening
    assert MatchPhase.COUNTDOWN not in phases[opening:]
    assert [event.detail for event in engine.events if event.kind == "bell"] == [
        "round_start",
        "round_end",
        "round_start",
        "round_end",
    ]


def test_the_referee_sends_both_fighters_back_after_a_foul() -> None:
    engine = make_engine(round_ticks=2000)
    one, two = engine.fighter("one"), engine.fighter("two")
    apart = hypot(two.x - one.x, two.y - one.y)
    engine.step({"one": command(1, action=FoulAction(Foul.LOW_BLOW))})
    assert engine.phase is MatchPhase.FOUL_RECOVERY
    assert hypot(two.x - one.x, two.y - one.y) >= apart + 2 * FOUL_SEPARATION - 2
    assert (one.velocity_x, one.velocity_y, two.velocity_x, two.velocity_y) == (0, 0, 0, 0)
    while engine.phase is MatchPhase.FOUL_RECOVERY:
        engine.step()
    # The two seconds were the fouled man's recovery: both box on clear-headed.
    assert (one.stunned_ticks, two.stunned_ticks) == (0, 0)
    # A second foul straight after the restart is thrown from too far to land.
    events = engine.step({"one": command(2, action=FoulAction(Foul.HEADBUTT))}).events
    assert [event.kind for event in events if event.kind.startswith("foul")] == ["foul_miss"]


def test_the_fouler_gets_no_free_shot_at_the_restart() -> None:
    engine = make_engine(round_ticks=2000)
    one, two = engine.fighter("one"), engine.fighter("two")
    # Fouled in the middle of his own jab, which the referee's break ends.
    engine.step({"two": command(1, action=punch(PunchClass.JAB, hand=Hand.LEFT))})
    engine.step({"one": command(1, action=FoulAction(Foul.LOW_BLOW))})
    assert engine.phase is MatchPhase.FOUL_RECOVERY
    assert two.attack is None
    engine.step({"two": command(2, defense=DefensivePose.GUARD_HIGH)})
    while engine.phase is MatchPhase.FOUL_RECOVERY:
        engine.step()
    sequence = 2
    # The fouler walks straight in and throws a power straight at the man he fouled.
    while hypot(two.x - one.x, two.y - one.y) > 150:
        engine.step({"one": command(sequence, move_x=1000)})
        sequence += 1
    engine.step({"one": command(sequence, action=punch(PunchClass.STRAIGHT, power=Power.POWER))})
    assert advance_until(engine, {"hit", "block", "perfect_block", "whiff"}) == "block"
    assert two.stunned_ticks == 0


def _straight_from(stamina: int) -> tuple[BoxingEngine, int, list[CombatEvent]]:
    engine = make_engine(round_ticks=2000)
    one = engine.fighter("one")
    one.stamina = stamina
    events = list(engine.step({"one": command(1, action=punch(PunchClass.STRAIGHT))}).events)
    left = one.stamina
    attack = one.attack
    assert attack is not None
    while not attack.resolved:
        events.extend(engine.step().events)
    return engine, left, events


def test_a_fighter_out_of_breath_still_throws_a_slow_weak_arm_punch() -> None:
    cost = PUNCH_RULES[(PunchClass.STRAIGHT, Target.HEAD, Power.NORMAL)].stamina_cost
    fresh, fresh_left, fresh_events = _straight_from(cost)
    tired, tired_left, tired_events = _straight_from(cost - 1)
    assert "exhausted" not in [event.kind for event in fresh_events]
    assert "exhausted" in [event.kind for event in tired_events]
    # He pays with what breath he has left.
    assert tired_left == fresh_left
    fresh_attack, tired_attack = fresh.fighter("one").attack, tired.fighter("one").attack
    assert fresh_attack is not None and tired_attack is not None
    assert tired_attack.rule.startup == fresh_attack.rule.startup + TIRED_STARTUP_TICKS
    assert tired_attack.rule.recovery == fresh_attack.rule.recovery + TIRED_RECOVERY_TICKS
    assert tired_attack.rule.impact == fresh_attack.rule.impact * TIRED_IMPACT_PERCENT // 100
    assert tired_attack.landed and fresh_attack.landed
    fresh_two, tired_two = fresh.fighter("two"), tired.fighter("two")
    assert 0 < tired_two.trauma.head < fresh_two.trauma.head
    assert fresh_two.poise < tired_two.poise < 600


def _hook_after_a_jab(stamina: int) -> tuple[AttackState, int]:
    engine = make_engine(round_ticks=2000)
    one = engine.fighter("one")
    engine.step({"one": command(1, action=punch(PunchClass.JAB, hand=Hand.LEFT))})
    jab = one.attack
    assert jab is not None
    while not jab.resolved:
        engine.step()
    assert jab.landed
    one.stamina = stamina
    hook = punch(PunchClass.HOOK, hand=Hand.LEFT)
    engine.step({"one": command(2, action=hook)})
    for _ in range(40):
        if one.attack is not None and one.attack.action == hook:
            return one.attack, one.attack.start_tick - jab.start_tick
        engine.step()
    raise AssertionError("the hook was never thrown")


def test_a_tired_punch_is_no_combination() -> None:
    fresh, fresh_gap = _hook_after_a_jab(1000)
    tired, tired_gap = _hook_after_a_jab(10)
    assert fresh.combo_bonus > 0 and tired.combo_bonus == 0
    # It cannot cut the jab's recovery short either: it waits for the jab to finish.
    assert tired_gap > fresh_gap


def _counter_hook(stamina: int) -> list[str]:
    engine = make_engine(seed=11, flash=True)
    one, two = engine.fighter("one"), engine.fighter("two")
    two.trauma.head = 300
    one.counter_ticks = 30
    one.stamina = stamina
    kinds = [
        event.kind
        for event in engine.step(
            {"one": command(1, action=punch(PunchClass.HOOK, power=Power.POWER))}
        ).events
    ]
    attack = one.attack
    assert attack is not None
    # His breath back by the time it lands, so only the punch itself decides.
    one.stamina = 1000
    while not attack.resolved:
        kinds.extend(event.kind for event in engine.step().events)
    assert attack.landed
    return kinds


def test_a_tired_punch_never_carries_a_flash_knockout() -> None:
    assert "flash_roll" in _counter_hook(1000)
    tired = _counter_hook(10)
    assert "exhausted" in tired and "flash_roll" not in tired
