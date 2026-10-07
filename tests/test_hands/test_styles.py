from __future__ import annotations

import random
from math import isqrt

import pytest

from intelstream.hands.engine import BoxingEngine, EngineConfig
from intelstream.hands.protocol import encode_snapshot
from intelstream.hands.rules import PUNCH_RULES, STYLE_RULES, StyleRule, style_punch_rule
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
        (BOXER, PunchClass.JAB, 0, -1),
        (BOXER, PunchClass.STRAIGHT, 0, 0),
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


def test_a_boxer_reaches_further() -> None:
    def reach(style: FighterStyle) -> int:
        engine = styled_engine(style)
        engine.step({"one": command(1, action=punch(PunchClass.JAB, hand=Hand.LEFT))})
        attack = engine.fighter("one").attack
        assert attack is not None
        return attack.rule.reach

    base = PUNCH_RULES[(PunchClass.JAB, Target.HEAD, Power.NORMAL)].reach
    assert reach(BALANCED) == base
    assert reach(BOXER) == base * 102 // 100
    assert reach(SWARMER) == base

    # A jab that falls just short of a balanced fighter's reach still lands for a boxer.
    gap = base + 2
    for style, expected in ((BALANCED, "whiff"), (BOXER, "hit")):
        engine = styled_engine(style, gap=gap)
        engine.step({"one": command(1, action=punch(PunchClass.JAB, hand=Hand.LEFT))})
        assert first_event(engine, {"hit", "whiff"}).kind == expected


def test_a_slugger_hits_harder_and_the_others_softer() -> None:
    straight = punch(PunchClass.STRAIGHT)
    balanced = landed(BALANCED, straight)
    assert landed(SLUGGER, straight) > balanced
    assert landed(SWARMER, straight) == landed(COUNTER, straight) < landed(BOXER, straight)
    assert landed(BOXER, straight) < balanced


def test_a_swarmer_works_the_body_harder_than_the_head() -> None:
    body = punch(PunchClass.HOOK, target=Target.BODY)
    head = punch(PunchClass.HOOK)
    assert landed(SWARMER, body) > landed(BALANCED, body)
    assert landed(SWARMER, head) < landed(BALANCED, head)


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
    price = STYLE_RULES[SLUGGER].stamina_cost_percent
    assert price > 100
    assert slugger_stamina - balanced_stamina == base_cost * price // 100 - base_cost
    assert swarmer_conditioning < balanced_conditioning


def test_a_miss_costs_a_slugger_more_and_tires_a_swarmer_less() -> None:
    def whiffed(style: FighterStyle) -> tuple[int, int]:
        engine = styled_engine(style, gap=400)
        fighter = engine.fighter("one")
        engine.step({"one": command(1, action=punch(PunchClass.HOOK, power=Power.POWER))})
        for _ in range(60):
            conditioning = fighter.conditioning
            for event in engine.step().events:
                if event.kind == "whiff":
                    return event.amount, conditioning - fighter.conditioning
        raise AssertionError("the hook never missed")

    base_whiff = PUNCH_RULES[(PunchClass.HOOK, Target.HEAD, Power.POWER)].whiff_cost
    balanced_cost, balanced_conditioning = whiffed(BALANCED)
    slugger_cost, _ = whiffed(SLUGGER)
    _, swarmer_conditioning = whiffed(SWARMER)
    assert balanced_cost == base_whiff
    assert slugger_cost == base_whiff * STYLE_RULES[SLUGGER].stamina_cost_percent // 100
    assert swarmer_conditioning < balanced_conditioning


def _conditioning_spent(style: FighterStyle, jabs: int, *, stamina: int, gap: int) -> int:
    """Conditioning a fighter of `style` spends on `jabs` lead jabs, each thrown with `stamina`."""
    engine = styled_engine(style, gap=gap)
    fighter = engine.fighter("one")
    before = fighter.conditioning
    for sequence in range(1, jabs + 1):
        fighter.stamina = stamina
        engine.fighter("two").poise = 600
        engine.step({"one": command(sequence, action=punch(PunchClass.JAB, hand=Hand.LEFT))})
        while fighter.attack is not None:
            engine.step()
    return before - fighter.conditioning


def test_a_swarmer_keeps_its_whole_conditioning_saving_however_little_each_punch_costs() -> None:
    saving = STYLE_RULES[SWARMER].conditioning_loss_percent
    assert saving < 100
    # Sixty whiffed jabs: three points to throw each and two for the miss, for a balanced fighter.
    balanced = _conditioning_spent(BALANCED, 60, stamina=1000, gap=400)
    assert balanced == 60 * (3 + 2)
    assert (
        abs(_conditioning_spent(SWARMER, 60, stamina=1000, gap=400) - balanced * saving // 100) <= 1
    )
    # Arm punches out of breath cost a point each, and the swarmer his share of it, not nothing.
    tired = _conditioning_spent(BALANCED, 30, stamina=10, gap=90)
    assert tired == 30
    assert abs(_conditioning_spent(SWARMER, 30, stamina=10, gap=90) - tired * saving // 100) <= 1


def test_a_combination_waits_out_a_punch_the_style_cannot_yet_pay_for() -> None:
    straight = (PunchClass.STRAIGHT, Target.HEAD, Power.NORMAL)
    base_cost = PUNCH_RULES[straight].stamina_cost
    slugger_cost = style_punch_rule(PUNCH_RULES[straight], STYLE_RULES[SLUGGER]).stamina_cost
    assert base_cost < slugger_cost - 3

    def jab_ran_its_course(style: FighterStyle) -> bool:
        engine = styled_engine(style)
        fighter = engine.fighter("one")
        engine.step({"one": command(1, action=punch(PunchClass.JAB, hand=Hand.LEFT))})
        engine.step({"one": command(2, action=punch(PunchClass.STRAIGHT))})
        jab = fighter.attack
        assert jab is not None and fighter.pending_actions
        while fighter.attack is jab:
            # Enough for a balanced fighter's straight, not for a slugger's.
            fighter.stamina = base_cost
            engine.step()
        assert jab.landed
        return jab.age >= jab.total_ticks

    assert not jab_ran_its_course(BALANCED)
    assert jab_ran_its_course(SLUGGER)


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


def poise_and_damage(attacker: FighterStyle, *, counter: bool = False) -> tuple[int, int]:
    """Poise and damage a straight from `attacker` takes off a balanced fighter."""
    engine = styled_engine(attacker, BALANCED)
    if counter:
        engine.fighter("one").counter_ticks = 30
    before = engine.fighter("two").poise
    engine.step({"one": command(1, action=punch(PunchClass.STRAIGHT))})
    damage = first_event(engine, {"hit", "counter_hit"}).amount
    return before - engine.fighter("two").poise, damage


@pytest.mark.parametrize("style", [BOXER, SLUGGER, SWARMER, COUNTER])
def test_a_style_hits_as_hard_into_a_mans_legs_as_into_his_face(style: FighterStyle) -> None:
    """A style's power is one number: the poise its punches take is scaled like their damage."""
    rule = STYLE_RULES[style]
    assert rule.poise_damage_percent == rule.impact_percent
    balanced_poise, balanced_damage = poise_and_damage(BALANCED)
    poise, damage = poise_and_damage(style)
    assert abs(poise * 100 // balanced_poise - damage * 100 // balanced_damage) <= 2


def test_a_counter_punchers_counters_land_a_little_harder_but_not_into_the_legs_of_a_stronger_man() -> (
    None
):
    balanced_poise, balanced_damage = poise_and_damage(BALANCED, counter=True)
    poise, damage = poise_and_damage(COUNTER, counter=True)
    assert balanced_damage < damage <= balanced_damage * 104 // 100
    assert balanced_poise <= poise <= balanced_poise * 104 // 100


def test_a_swarmer_is_quicker_on_the_feet_and_a_slugger_slower() -> None:
    def travelled(style: FighterStyle) -> int:
        engine = styled_engine(style, gap=600)
        start = engine.fighter("one").x
        for sequence in range(1, 31):
            engine.step({"one": command(sequence, move_x=1000)})
        return engine.fighter("one").x - start

    balanced = travelled(BALANCED)
    quicker = STYLE_RULES[SWARMER].move_speed_percent
    assert 100 < quicker <= 105
    assert balanced * (quicker - 1) // 100 <= travelled(SWARMER) <= balanced * (quicker + 1) // 100
    assert travelled(SLUGGER) < balanced * 98 // 100
    assert travelled(BOXER) == balanced


def test_a_quick_fighter_still_reports_a_velocity_clients_accept() -> None:
    engine = styled_engine(SWARMER, gap=600)
    for sequence in range(1, 31):
        snapshot = engine.step({"one": command(sequence, move_x=1000)})
        fighter = snapshot.fighters[0]
        assert -7 <= fighter.velocity_x <= 7
        assert -7 <= fighter.velocity_y <= 7


def test_a_quick_fighter_pushed_onto_a_corner_pad_still_reports_a_velocity_clients_accept() -> None:
    # The pad keeps the speed along it, which for a fresh swarmer is 7.7 units a tick.
    pad = styled_engine(SWARMER, SWARMER).fighter("one")
    pad.x, pad.y = 400, 340
    pad.velocity_fixed_x, pad.velocity_fixed_y = -7700, 0
    BoxingEngine._clamp_to_ring(pad)
    assert (pad.velocity_x, pad.velocity_y) == (-7, 0)
    assert pad.velocity_fixed_x == -7700

    # Walking out of a corner while the other swarmer walks him back onto the pad.
    engine = styled_engine(SWARMER, SWARMER)
    one, two = engine.fighter("one"), engine.fighter("two")
    one.x, one.y, two.x, two.y = -369, 364, -300, 330
    velocities = set()
    for sequence in range(1, 80):
        dx, dy = one.x - two.x, one.y - two.y
        distance = max(1, isqrt(dx * dx + dy * dy))
        snapshot = engine.step(
            {
                "one": InputCommand(sequence, sequence, 1000, 0),
                "two": InputCommand(
                    sequence, sequence, dx * 1000 // distance, dy * 1000 // distance
                ),
            }
        )
        velocities.update((f.velocity_x, f.velocity_y) for f in snapshot.fighters)
    assert max(max(abs(x), abs(y)) for x, y in velocities) == 7

    # Random scrambles in every corner, both fighters fresh swarmers.
    rng = random.Random(4205227423)
    for _ in range(40):
        engine = styled_engine(SWARMER, SWARMER)
        one, two = engine.fighter("one"), engine.fighter("two")
        sign_x, sign_y = rng.choice((-1, 1)), rng.choice((-1, 1))
        one.x, one.y = sign_x * rng.randrange(300, 420), sign_y * rng.randrange(300, 420)
        two.x, two.y = (
            one.x - sign_x * rng.randrange(60, 120),
            one.y - sign_y * rng.randrange(0, 80),
        )
        for sequence in range(1, 45):
            moves = [(rng.randrange(-1000, 1001), rng.randrange(-1000, 1001)) for _ in range(2)]
            snapshot = engine.step(
                {
                    "one": InputCommand(sequence, sequence, *moves[0]),
                    "two": InputCommand(sequence, sequence, *moves[1]),
                }
            )
            for fighter in snapshot.fighters:
                assert -7 <= fighter.velocity_x <= 7
                assert -7 <= fighter.velocity_y <= 7


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
    assert counter_slip == balanced_slip + 1
    assert counter_window == balanced_window + 3
    assert counter_counter > balanced_counter
    swarmer_slip, swarmer_window, _ = counter_after_a_slip(SWARMER)
    assert swarmer_slip == balanced_slip + 1
    assert swarmer_window == balanced_window


def test_a_counter_puncher_has_longer_to_counter_after_a_parry() -> None:
    def window_after_parry(style: FighterStyle) -> int:
        engine = styled_engine(BALANCED, style)
        engine.step({"one": command(1, action=punch(PunchClass.STRAIGHT, power=Power.POWER))})
        attack = engine.fighter("one").attack
        assert attack is not None
        while attack.age < attack.rule.startup - 2:
            engine.step()
        engine.step({"two": command(1, defense=DefensivePose.GUARD_HIGH)})
        assert first_event(engine, {"block", "perfect_block", "hit"}).kind == "perfect_block"
        return engine.fighter("two").counter_ticks

    assert window_after_parry(COUNTER) == window_after_parry(BALANCED) + 3


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
