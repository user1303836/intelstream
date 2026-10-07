from __future__ import annotations

import pytest

from intelstream.hands.engine import BoxingEngine, EngineConfig
from intelstream.hands.protocol import encode_snapshot
from intelstream.hands.rules import PUNCH_RULES, STYLE_RULES, StyleRule
from intelstream.hands.types import (
    ActionKind,
    CombatEvent,
    DefensivePose,
    FighterStyle,
    Hand,
    InputCommand,
    MovementAction,
    Power,
    PunchAction,
    PunchClass,
    Target,
)

BALANCED = FighterStyle.BALANCED
BOXER = FighterStyle.BOXER
SLUGGER = FighterStyle.SLUGGER
SWARMER = FighterStyle.SWARMER
COUNTER = FighterStyle.COUNTER_PUNCHER


def styled_engine(
    one: FighterStyle = BALANCED, two: FighterStyle = BALANCED, *, gap: int = 90
) -> BoxingEngine:
    engine = BoxingEngine(
        match_id="match-styles",
        activity_instance_id="instance-1",
        guild_id="guild-1",
        player_one_id="one",
        player_two_id="two",
        seed=7,
        config=EngineConfig(
            rounds=1, round_ticks=3000, rest_ticks=0, countdown_ticks=0, flash_ko_enabled=False
        ),
        styles=(one, two),
    )
    engine.fighter("one").x = -gap // 2
    engine.fighter("two").x = gap // 2
    return engine


def command(
    sequence: int,
    *,
    action: PunchAction | MovementAction | None = None,
    defense: DefensivePose = DefensivePose.NONE,
    move_x: int = 0,
) -> InputCommand:
    return InputCommand(
        sequence=sequence,
        client_tick=sequence,
        move_x=move_x,
        defense=defense,
        actions=(action,) if action is not None else (),
    )


def punch(
    punch_class: PunchClass = PunchClass.STRAIGHT,
    *,
    hand: Hand = Hand.RIGHT,
    target: Target = Target.HEAD,
    power: Power = Power.NORMAL,
) -> PunchAction:
    return PunchAction(hand, punch_class, target, power)


def first_event(engine: BoxingEngine, kinds: set[str], limit: int = 120) -> CombatEvent:
    for _ in range(limit):
        for event in engine.step().events:
            if event.kind in kinds:
                return event
    raise AssertionError(f"none of {kinds} emitted")


def landed(attacker: FighterStyle, action: PunchAction, defender: FighterStyle = BALANCED) -> int:
    engine = styled_engine(attacker, defender)
    engine.step({"one": command(1, action=action)})
    return first_event(engine, {"hit", "counter_hit"}).amount


def test_every_style_is_in_the_manifest_and_balanced_changes_nothing() -> None:
    assert set(STYLE_RULES) == set(FighterStyle)
    assert STYLE_RULES[BALANCED] == StyleRule()
    engine = BoxingEngine(
        match_id="m",
        activity_instance_id="i",
        guild_id="g",
        player_one_id="one",
        player_two_id="two",
        seed=1,
    )
    assert engine.fighter("one").style is BALANCED
    assert engine.fighter("two").style is BALANCED


@pytest.mark.parametrize(
    ("style", "punch_class", "startup_delta", "recovery_delta"),
    [
        (BOXER, PunchClass.JAB, -1, 0),
        (BOXER, PunchClass.STRAIGHT, -1, 0),
        (BOXER, PunchClass.HOOK, 0, 0),
        (SLUGGER, PunchClass.HOOK, 0, 1),
        (SLUGGER, PunchClass.UPPERCUT, 0, 1),
        (SLUGGER, PunchClass.JAB, 0, 0),
        (SWARMER, PunchClass.HOOK, -1, 0),
        (SWARMER, PunchClass.UPPERCUT, -1, 0),
        (SWARMER, PunchClass.STRAIGHT, 0, 0),
        (COUNTER, PunchClass.STRAIGHT, 0, 0),
    ],
)
def test_a_style_changes_the_timing_of_its_own_punches(
    style: FighterStyle, punch_class: PunchClass, startup_delta: int, recovery_delta: int
) -> None:
    def timing(fighter_style: FighterStyle) -> tuple[int, int]:
        engine = styled_engine(fighter_style)
        engine.step({"one": command(1, action=punch(punch_class))})
        attack = engine.fighter("one").attack
        assert attack is not None
        return attack.rule.startup, attack.rule.recovery

    base_startup, base_recovery = timing(BALANCED)
    startup, recovery = timing(style)
    assert startup - base_startup == startup_delta
    assert recovery - base_recovery == recovery_delta


def test_a_boxer_reaches_further_and_a_swarmer_less_far() -> None:
    def reach(style: FighterStyle) -> int:
        engine = styled_engine(style)
        engine.step({"one": command(1, action=punch(PunchClass.JAB, hand=Hand.LEFT))})
        attack = engine.fighter("one").attack
        assert attack is not None
        return attack.rule.reach

    base = PUNCH_RULES[(PunchClass.JAB, Target.HEAD, Power.NORMAL)].reach
    assert reach(BALANCED) == base
    assert reach(BOXER) == base * 104 // 100
    assert reach(SWARMER) == base * 96 // 100

    # A jab that falls just short of a balanced fighter's reach still lands for a boxer.
    gap = base + 3
    for style, expected in ((BALANCED, "whiff"), (BOXER, "hit")):
        engine = styled_engine(style, gap=gap)
        engine.step({"one": command(1, action=punch(PunchClass.JAB, hand=Hand.LEFT))})
        assert first_event(engine, {"hit", "whiff"}).kind == expected


def test_a_slugger_hits_harder_and_a_boxer_and_counter_puncher_softer() -> None:
    straight = punch(PunchClass.STRAIGHT)
    balanced = landed(BALANCED, straight)
    assert landed(SLUGGER, straight) > balanced
    assert landed(BOXER, straight) < balanced
    assert landed(COUNTER, straight) < balanced
    assert landed(SWARMER, straight) == balanced


def test_a_swarmer_works_the_body_harder() -> None:
    body = punch(PunchClass.HOOK, target=Target.BODY)
    balanced = landed(BALANCED, body)
    swarmer = landed(SWARMER, body)
    assert swarmer == balanced * 115 // 100
    assert landed(SWARMER, punch(PunchClass.HOOK)) == landed(BALANCED, punch(PunchClass.HOOK))


def test_a_slugger_pays_more_for_a_punch_and_a_swarmer_tires_less() -> None:
    def spent(style: FighterStyle) -> tuple[int, int]:
        engine = styled_engine(style)
        fighter = engine.fighter("one")
        stamina, conditioning = fighter.stamina, fighter.conditioning
        engine.step({"one": command(1, action=punch(PunchClass.UPPERCUT, power=Power.POWER))})
        return stamina - fighter.stamina, conditioning - fighter.conditioning

    base_cost = PUNCH_RULES[(PunchClass.UPPERCUT, Target.HEAD, Power.POWER)].stamina_cost
    balanced_stamina, balanced_conditioning = spent(BALANCED)
    slugger_stamina, _ = spent(SLUGGER)
    _, swarmer_conditioning = spent(SWARMER)
    # One tick of recovery is folded into each figure; it is the same for all three.
    assert slugger_stamina - balanced_stamina == base_cost * 110 // 100 - base_cost
    assert swarmer_conditioning < balanced_conditioning


def test_a_slugger_breaks_a_man_down_faster_and_takes_it_better() -> None:
    def poise_lost(attacker: FighterStyle, defender: FighterStyle) -> int:
        engine = styled_engine(attacker, defender)
        engine.step({"one": command(1, action=punch(PunchClass.HOOK))})
        before = engine.fighter("two").poise
        first_event(engine, {"hit"})
        return before - engine.fighter("two").poise

    balanced = poise_lost(BALANCED, BALANCED)
    assert poise_lost(SLUGGER, BALANCED) > balanced
    assert poise_lost(BALANCED, SLUGGER) < balanced


def test_a_swarmer_is_quicker_on_the_feet() -> None:
    def travelled(style: FighterStyle) -> int:
        engine = styled_engine(style, gap=600)
        start = engine.fighter("one").x
        for sequence in range(1, 31):
            engine.step({"one": command(sequence, move_x=1000)})
        return engine.fighter("one").x - start

    balanced = travelled(BALANCED)
    assert travelled(SWARMER) > balanced * 105 // 100
    assert travelled(BOXER) == balanced


def test_a_boxer_gets_his_wind_back_sooner() -> None:
    def recovered(style: FighterStyle) -> int:
        engine = styled_engine(style, gap=400)
        fighter = engine.fighter("one")
        fighter.stamina = 400
        for _ in range(30):
            engine.step()
        return fighter.stamina - 400

    assert recovered(BOXER) > recovered(BALANCED)


def test_a_counter_puncher_makes_a_miss_cost_more() -> None:
    def counter_after_a_slip(style: FighterStyle) -> tuple[int, int, int]:
        engine = styled_engine(BALANCED, style)
        engine.step(
            {
                "one": command(1, action=punch(PunchClass.STRAIGHT)),
                "two": command(1, action=MovementAction(ActionKind.SLIP_LEFT)),
            }
        )
        slipping = engine.fighter("two").evasion_ticks
        first_event(engine, {"evade"})
        window = engine.fighter("two").counter_ticks
        engine.step({"two": command(2, action=punch(PunchClass.HOOK, hand=Hand.LEFT))})
        return slipping, window, first_event(engine, {"counter_hit"}).amount

    balanced_slip, balanced_window, balanced_counter = counter_after_a_slip(BALANCED)
    counter_slip, counter_window, counter_counter = counter_after_a_slip(COUNTER)
    assert counter_slip == balanced_slip + 2
    assert counter_window == balanced_window + 6
    assert counter_counter > balanced_counter


def test_a_counter_puncher_has_a_wider_perfect_block() -> None:
    def blocked(style: FighterStyle, lead: int) -> str:
        engine = styled_engine(BALANCED, style)
        engine.step({"one": command(1, action=punch(PunchClass.STRAIGHT, power=Power.POWER))})
        attack = engine.fighter("one").attack
        assert attack is not None
        while attack.age < attack.rule.startup - lead:
            engine.step()
        engine.step({"two": command(1, defense=DefensivePose.GUARD_HIGH)})
        return first_event(engine, {"block", "perfect_block", "hit"}).kind

    def earliest_perfect(style: FighterStyle) -> int:
        return max(lead for lead in range(2, 12) if blocked(style, lead) == "perfect_block")

    assert earliest_perfect(COUNTER) == earliest_perfect(BALANCED) + 1


def test_the_snapshot_says_how_each_fighter_boxes() -> None:
    engine = styled_engine(SLUGGER, COUNTER)
    snapshot = engine.step()
    assert [fighter.style for fighter in snapshot.fighters] == [SLUGGER, COUNTER]
    assert '"style":"slugger"' in encode_snapshot(snapshot, viewer_id=None)
