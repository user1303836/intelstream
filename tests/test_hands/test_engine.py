from __future__ import annotations

from math import hypot

import pytest

from intelstream.hands.engine import (
    ACTION_BUFFER_TICKS,
    MAX_PENDING_ACTIONS,
    BoxingEngine,
    EngineConfig,
)
from intelstream.hands.protocol import encode_snapshot
from intelstream.hands.rules import (
    FIGHTER_RADIUS,
    PUNCH_RULES,
    RING_HALF_HEIGHT,
    RING_HALF_WIDTH,
)
from intelstream.hands.types import (
    ActionKind,
    DefensivePose,
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
    defender.guard = 20
    engine.step({"one": command(1, action=punch(target=Target.HEAD, power=Power.POWER))})
    attack = engine.fighter("one").attack
    assert attack is not None
    while attack.age < attack.rule.startup - 2:
        engine.step()
    engine.step({"two": command(1, defense=DefensivePose.GUARD_HIGH)})

    assert advance_until(engine, {"perfect_block"}) == "perfect_block"
    assert defender.guard < 20
    assert any(event.kind == "guard_break" for event in engine.events)

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
    while engine.phase is MatchPhase.KNOCKDOWN and engine.tick < 240:
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
    assert any(event.kind == "get_up" for event in engine.events)

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
    engine.step(
        {
            "one": command(
                1,
                action=punch(PunchClass.UPPERCUT, power=Power.POWER),
            )
        }
    )
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
    assert [event.kind for event in engine.events].count("punch_start") == 1


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

    body = make_engine(round_ticks=2000)
    body.fighter("one").y = -20
    body.fighter("two").y = 20
    body.step(
        {
            "one": command(1, action=punch(PunchClass.HOOK, target=Target.BODY)),
            "two": command(1, action=MovementAction(ActionKind.WEAVE)),
        }
    )
    assert advance_until(body, {"evade"}) == "evade"

    body_uppercut = make_engine(round_ticks=2000)
    body_uppercut.fighter("one").y = -10
    body_uppercut.fighter("two").y = 10
    body_uppercut.step(
        {
            "one": command(
                1,
                action=punch(PunchClass.UPPERCUT, hand=Hand.RIGHT, target=Target.BODY),
            ),
            "two": command(1, action=MovementAction(ActionKind.SLIP_LEFT)),
        }
    )
    assert advance_until(body_uppercut, {"evade"}) == "evade"


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


def test_taunt_is_cancelled_by_stun_and_knockdown() -> None:
    engine = make_engine(seed=121, round_ticks=2000)
    fighter = engine.fighter("one")
    engine.step({"one": command(1, action=MovementAction(ActionKind.TAUNT))})
    assert fighter.taunt_ticks > 0
    fighter.taunt_ticks = 0
    assert fighter.taunt_ticks == 0
