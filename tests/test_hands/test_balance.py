from __future__ import annotations

from typing import TYPE_CHECKING

from intelstream.hands.engine import EngineConfig
from intelstream.hands.rules import (
    BLOCK_POISE_PERCENT,
    BODY_COLLAPSE_COOLDOWN_TICKS,
    BODY_COLLAPSE_STAMINA,
    BODY_COLLAPSE_TRAUMA,
    BODY_TRAUMA_PER_DAMAGE_PERCENT,
    CUT_PER_DAMAGE_PERCENT,
    EYE_TRAUMA_PER_DAMAGE_PERCENT,
    FLINCH_BASE_TICKS,
    FLINCH_DAMAGE_DIVISOR,
    GET_UP_BASE,
    GET_UP_PER_KNOCKDOWN,
    GET_UP_STAMINA,
    GET_UP_TRAUMA_DIVISOR,
    GUARD_BLOCK_MINIMUM,
    GUARD_DAMAGE_PERCENT,
    HEAD_TRAUMA_PER_DAMAGE_PERCENT,
    JAB_CUT_PERCENT,
    JAB_SWELLING_PERCENT,
    MAX_POISE,
    POISE_CEILING_FLOOR,
    POISE_DAMAGE_PERCENT,
    POISE_REGEN_EVERY_TICKS,
    PUNCH_RULES,
    ROCKED_BASE_TICKS,
    ROCKED_HURT_POISE,
    STUN_CHAIN_MAX_TICKS,
    STUN_IMMUNITY_TICKS,
    SWELLING_PER_DAMAGE_PERCENT,
    poise_ceiling,
)
from intelstream.hands.types import (
    CombatEvent,
    DefensivePose,
    Hand,
    MatchPhase,
    Power,
    PunchAction,
    PunchClass,
    Target,
)
from tests.test_hands.test_engine import command, make_engine, punch

if TYPE_CHECKING:
    from intelstream.hands.engine import BoxingEngine


def land(
    engine: BoxingEngine,
    action: PunchAction,
    *,
    defense: DefensivePose = DefensivePose.NONE,
) -> list[CombatEvent]:
    """Throws `action` from one at two, two holding `defense`, and returns the contact tick's events."""
    engine.step(
        {
            "one": command(engine.fighter("one").last_sequence + 1, action=action),
            "two": command(engine.fighter("two").last_sequence + 1, defense=defense),
        }
    )
    for _ in range(40):
        events = list(engine.step().events)
        if any(event.kind in ("hit", "counter_hit", "block", "perfect_block") for event in events):
            return events
    raise AssertionError("the punch never arrived")


def kinds(events: list[CombatEvent]) -> list[str]:
    return [event.kind for event in events]


def hit_amount(events: list[CombatEvent]) -> int:
    return next(event.amount for event in events if event.kind in ("hit", "counter_hit"))


def settled_guard(engine: BoxingEngine, pose: DefensivePose) -> None:
    """Two raises a guard and holds it long enough that it is no longer a perfect block."""
    engine.step({"two": command(engine.fighter("two").last_sequence + 1, defense=pose)})
    for _ in range(10):
        engine.step()


def test_a_clean_shot_makes_a_fresh_fighter_flinch_without_being_rocked() -> None:
    engine = make_engine()
    events = land(engine, punch(PunchClass.STRAIGHT))
    damage = hit_amount(events)
    assert damage >= 36
    assert "stun" not in kinds(events)
    assert (
        engine.fighter("two").stunned_ticks == FLINCH_BASE_TICKS + damage // FLINCH_DAMAGE_DIVISOR
    )
    assert engine.fighter("two").stunned_ticks < ROCKED_BASE_TICKS


def test_a_big_counter_rocks_a_fighter_and_says_so() -> None:
    engine = make_engine()
    engine.fighter("one").counter_ticks = 30
    events = land(engine, punch(PunchClass.STRAIGHT))
    assert "counter_hit" in kinds(events)
    assert "stun" in kinds(events)
    assert engine.fighter("two").stunned_ticks >= ROCKED_BASE_TICKS


def test_a_big_power_shot_rocks_a_fresh_fighter() -> None:
    engine = make_engine()
    events = land(engine, punch(PunchClass.STRAIGHT, power=Power.POWER))
    assert "counter_hit" not in kinds(events)
    assert "stun" in kinds(events)


def test_a_hurt_fighter_is_rocked_by_an_ordinary_shot() -> None:
    engine = make_engine()
    engine.fighter("two").poise = ROCKED_HURT_POISE + 20
    events = land(engine, punch(PunchClass.STRAIGHT))
    assert "stun" in kinds(events)
    assert engine.fighter("two").stunned_ticks >= ROCKED_BASE_TICKS


def test_a_running_stun_is_not_started_again_and_no_stun_passes_the_chain_limit() -> None:
    engine = make_engine()
    fighter = engine.fighter("two")
    fighter.stunned_ticks = 10
    fighter.stun_chain_ticks = STUN_CHAIN_MAX_TICKS - 25
    # However hard it lands, a punch on a man who is still stunned does not start his stun again.
    assert not engine._stun(fighter, 8, rocked=False)
    assert not engine._stun(fighter, 30, rocked=True)
    assert (fighter.stunned_ticks, fighter.stun_chain_ticks) == (10, STUN_CHAIN_MAX_TICKS - 25)
    fighter.stunned_ticks = 0
    fighter.stun_chain_ticks = 0
    assert engine._stun(fighter, STUN_CHAIN_MAX_TICKS + 20, rocked=True)
    assert fighter.stunned_ticks == STUN_CHAIN_MAX_TICKS


def test_a_stun_keeps_counting_toward_the_chain_and_then_leaves_a_moment_of_clear_head() -> None:
    engine = make_engine()
    fighter = engine.fighter("two")
    assert engine._stun(fighter, 6, rocked=True)
    for _ in range(6):
        engine.step()
    assert fighter.stunned_ticks == 0
    assert fighter.stun_chain_ticks == 0
    assert not engine._stun(fighter, 8, rocked=False)
    assert engine._stun(fighter, 20, rocked=True)
    fighter.stunned_ticks = 0
    for _ in range(STUN_IMMUNITY_TICKS + 1):
        engine.step()
    assert engine._stun(fighter, 8, rocked=False)


def test_a_guarded_punch_never_stuns_and_takes_a_quarter_of_its_poise() -> None:
    open_engine = make_engine()
    land(open_engine, punch(PunchClass.STRAIGHT))
    open_loss = MAX_POISE - open_engine.fighter("two").poise

    guarded = make_engine()
    settled_guard(guarded, DefensivePose.GUARD_HIGH)
    before = guarded.fighter("two").poise
    events = land(guarded, punch(PunchClass.STRAIGHT), defense=DefensivePose.GUARD_HIGH)
    assert "block" in kinds(events)
    assert guarded.fighter("two").stunned_ticks == 0
    loss = before - guarded.fighter("two").poise
    assert 0 < loss <= open_loss * BLOCK_POISE_PERCENT // 100 + 1


def test_a_perfect_block_costs_no_poise() -> None:
    engine = make_engine()
    engine.step({"one": command(1, action=punch(PunchClass.STRAIGHT))})
    attack = engine.fighter("one").attack
    assert attack is not None
    while attack.age < attack.rule.startup - 2:
        engine.step()
    before = engine.fighter("two").poise
    engine.step({"two": command(1, defense=DefensivePose.GUARD_HIGH)})
    for _ in range(10):
        events = kinds(list(engine.step().events))
        if "perfect_block" in events:
            break
    else:
        raise AssertionError("no perfect block")
    defender = engine.fighter("two")
    # A perfect block still lets a little through, which only lowers the ceiling poise returns to.
    assert defender.poise >= min(before, poise_ceiling(defender.trauma.head))


def test_a_worn_out_guard_stops_nothing_and_is_not_broken_again() -> None:
    engine = make_engine()
    settled_guard(engine, DefensivePose.GUARD_HIGH)
    engine.fighter("two").guard = GUARD_BLOCK_MINIMUM - 20
    events = land(engine, punch(PunchClass.JAB, hand=Hand.LEFT), defense=DefensivePose.GUARD_HIGH)
    assert "block" not in kinds(events)
    assert "guard_break" not in kinds(events)
    assert "hit" in kinds(events)


def test_a_blocked_punch_wears_the_guard_by_its_share() -> None:
    engine = make_engine()
    settled_guard(engine, DefensivePose.GUARD_HIGH)
    before = engine.fighter("two").guard
    land(engine, punch(PunchClass.STRAIGHT), defense=DefensivePose.GUARD_HIGH)
    rule = PUNCH_RULES[(PunchClass.STRAIGHT, Target.HEAD, Power.NORMAL)]
    worn = rule.guard_damage * GUARD_DAMAGE_PERCENT // 100
    assert before - engine.fighter("two").guard in range(worn - 3, worn + 1)


def test_a_held_guard_comes_back_but_slower_than_a_rested_one() -> None:
    held = make_engine()
    held.fighter("two").guard = 300
    held.step({"two": command(1, defense=DefensivePose.GUARD_HIGH)})
    rested = make_engine()
    rested.fighter("two").guard = 300
    for _ in range(24):
        held.step()
        rested.step()
    assert 300 < held.fighter("two").guard < rested.fighter("two").guard


def test_a_beating_lowers_the_poise_a_fighter_comes_back_to() -> None:
    assert poise_ceiling(0) == MAX_POISE
    assert poise_ceiling(1000) < poise_ceiling(400) < MAX_POISE
    assert poise_ceiling(1400) == POISE_CEILING_FLOOR
    engine = make_engine()
    fighter = engine.fighter("two")
    fighter.trauma.head = 1000
    fighter.poise = 100
    for _ in range(MAX_POISE * POISE_REGEN_EVERY_TICKS):
        engine.step()
    assert fighter.poise == poise_ceiling(1000)


def test_poise_comes_back_one_point_every_few_ticks() -> None:
    engine = make_engine()
    fighter = engine.fighter("two")
    fighter.poise = 300
    for _ in range(POISE_REGEN_EVERY_TICKS * 10):
        engine.step()
    assert fighter.poise == 310


def test_a_punch_takes_its_share_of_poise() -> None:
    engine = make_engine()
    land(engine, punch(PunchClass.JAB, hand=Hand.LEFT))
    rule = PUNCH_RULES[(PunchClass.JAB, Target.HEAD, Power.NORMAL)]
    taken = MAX_POISE - engine.fighter("two").poise
    share = rule.poise_damage * POISE_DAMAGE_PERCENT // 100
    assert share - 1 <= taken <= share


def test_only_a_clean_punch_marks_the_face() -> None:
    clean = make_engine()
    events = land(clean, punch(PunchClass.STRAIGHT))
    damage = hit_amount(events)
    trauma = clean.fighter("two").trauma
    assert trauma.head == damage * HEAD_TRAUMA_PER_DAMAGE_PERCENT // 100
    assert trauma.left_eye == damage * EYE_TRAUMA_PER_DAMAGE_PERCENT // 100
    assert trauma.swelling == damage * SWELLING_PER_DAMAGE_PERCENT // 100

    guarded = make_engine()
    settled_guard(guarded, DefensivePose.GUARD_HIGH)
    events = land(guarded, punch(PunchClass.STRAIGHT), defense=DefensivePose.GUARD_HIGH)
    assert "block" in kinds(events)
    trauma = guarded.fighter("two").trauma
    assert trauma.head > 0
    assert (trauma.left_eye, trauma.right_eye, trauma.swelling, trauma.left_cut) == (0, 0, 0, 0)


def test_a_cut_opens_by_half_the_damage_once_the_eye_is_marked() -> None:
    engine = make_engine()
    engine.fighter("two").trauma.left_eye = 300
    damage = hit_amount(land(engine, punch(PunchClass.STRAIGHT)))
    assert engine.fighter("two").trauma.left_cut == damage * CUT_PER_DAMAGE_PERCENT // 100


def test_a_jab_seldom_splits_the_skin_and_swells_the_face_less() -> None:
    engine = make_engine()
    engine.fighter("two").trauma.right_eye = 300
    damage = hit_amount(land(engine, punch(PunchClass.JAB, hand=Hand.LEFT)))
    trauma = engine.fighter("two").trauma
    cut = damage * CUT_PER_DAMAGE_PERCENT // 100 * JAB_CUT_PERCENT // 100
    swelling = damage * SWELLING_PER_DAMAGE_PERCENT // 100 * JAB_SWELLING_PERCENT // 100
    assert trauma.right_cut == cut < damage * CUT_PER_DAMAGE_PERCENT // 100
    assert trauma.swelling == swelling < damage * SWELLING_PER_DAMAGE_PERCENT // 100


def test_by_default_the_doctor_lets_a_bad_cut_and_a_swollen_face_box_on() -> None:
    defaults = EngineConfig()
    engine = make_engine(
        doctor_cut_threshold=defaults.doctor_cut_threshold,
        doctor_swelling_threshold=defaults.doctor_swelling_threshold,
    )
    trauma = engine.fighter("two").trauma
    trauma.left_eye, trauma.left_cut, trauma.swelling = 500, 740, 850
    land(engine, punch(PunchClass.STRAIGHT))
    assert trauma.left_cut > 740 and trauma.swelling > 850
    assert engine.result is None


def test_body_trauma_counts_the_damage_once() -> None:
    engine = make_engine()
    damage = hit_amount(land(engine, punch(PunchClass.HOOK, hand=Hand.LEFT, target=Target.BODY)))
    assert engine.fighter("two").trauma.body == damage * BODY_TRAUMA_PER_DAMAGE_PERCENT // 100


def broken_body(engine: BoxingEngine) -> None:
    fighter = engine.fighter("two")
    fighter.trauma.body = BODY_COLLAPSE_TRAUMA + 100
    fighter.stamina = BODY_COLLAPSE_STAMINA - 100
    fighter.conditioning = 500


def test_a_body_collapse_cannot_follow_another_inside_its_cooldown() -> None:
    body_hook = punch(PunchClass.HOOK, hand=Hand.LEFT, target=Target.BODY, power=Power.POWER)
    fresh = make_engine()
    broken_body(fresh)
    assert "body_collapse" in kinds(land(fresh, body_hook))

    recent = make_engine()
    broken_body(recent)
    recent.fighter("two").body_collapse_at_tick = recent.tick - BODY_COLLAPSE_COOLDOWN_TICKS // 2
    assert "body_collapse" not in kinds(land(recent, body_hook))


def test_getting_up_leaves_enough_stamina_to_stand_and_is_harder_for_a_battered_man() -> None:
    engine = make_engine()
    downed = engine.fighter("two")
    downed.stamina = 0
    engine._knock_down(downed, engine.fighter("one"))
    assert engine._get_up_required(downed) == GET_UP_BASE + GET_UP_PER_KNOCKDOWN
    downed.trauma.head = 900
    assert engine._get_up_required(downed) == (
        GET_UP_BASE + GET_UP_PER_KNOCKDOWN + 900 // GET_UP_TRAUMA_DIVISOR
    )
    downed.get_up_meter = 1_000
    while engine.phase is MatchPhase.KNOCKDOWN:
        engine.step()
    assert downed.stamina >= min(downed.maximum_stamina, GET_UP_STAMINA)
    assert downed.stamina > BODY_COLLAPSE_STAMINA
