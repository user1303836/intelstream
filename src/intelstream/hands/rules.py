from dataclasses import dataclass, replace

from intelstream.hands.types import Power, PunchClass, Target

TICKS_PER_SECOND = 30
RING_HALF_WIDTH = 500
RING_HALF_HEIGHT = 330
FIGHTER_RADIUS = 38
MINIMUM_SEPARATION = FIGHTER_RADIUS * 2
ROUND_TICKS = 120 * TICKS_PER_SECOND
REST_TICKS = 15 * TICKS_PER_SECOND
COUNTDOWN_TICKS = 3 * TICKS_PER_SECOND
DEFAULT_ROUNDS = 3
MAX_STAMINA = 1000
MAX_CONDITIONING = 1000
MAX_GUARD = 700
MAX_POISE = 600


@dataclass(frozen=True, slots=True)
class PunchRule:
    startup: int
    active: int
    recovery: int
    reach: int
    lateral_arc: int
    impact: int
    stamina_cost: int
    whiff_cost: int
    guard_damage: int
    poise_damage: int
    combo_window: int
    startup_vulnerability: int
    recovery_vulnerability: int


_BASE_PUNCH_RULES: dict[PunchClass, PunchRule] = {
    PunchClass.JAB: PunchRule(4, 2, 7, 150, 42, 34, 42, 18, 44, 35, 7, 2, 3),
    PunchClass.STRAIGHT: PunchRule(6, 2, 10, 168, 38, 52, 65, 28, 66, 58, 8, 4, 5),
    PunchClass.HOOK: PunchRule(7, 3, 12, 126, 92, 64, 78, 36, 82, 72, 9, 5, 7),
    PunchClass.UPPERCUT: PunchRule(8, 2, 13, 108, 54, 72, 88, 44, 88, 84, 10, 6, 8),
}


def _punch_variant(base: PunchRule, target: Target, power: Power) -> PunchRule:
    rule = base
    if target is Target.BODY:
        rule = replace(
            rule,
            startup=rule.startup + 1,
            reach=max(80, rule.reach - 14),
            lateral_arc=rule.lateral_arc + 8,
            impact=rule.impact * 92 // 100,
            stamina_cost=rule.stamina_cost + 4,
            whiff_cost=rule.whiff_cost + 3,
            poise_damage=rule.poise_damage * 72 // 100,
        )
    if power is Power.POWER:
        rule = replace(
            rule,
            startup=rule.startup + 2,
            active=rule.active + 1,
            recovery=rule.recovery + 3,
            reach=rule.reach + 5,
            impact=rule.impact * 152 // 100,
            stamina_cost=rule.stamina_cost * 155 // 100,
            whiff_cost=rule.whiff_cost * 175 // 100,
            guard_damage=rule.guard_damage * 145 // 100,
            poise_damage=rule.poise_damage * 145 // 100,
            startup_vulnerability=rule.startup_vulnerability + 2,
            recovery_vulnerability=rule.recovery_vulnerability + 2,
        )
    return rule


PUNCH_RULES: dict[tuple[PunchClass, Target, Power], PunchRule] = {
    (punch_class, target, power): _punch_variant(base, target, power)
    for punch_class, base in _BASE_PUNCH_RULES.items()
    for target in Target
    for power in Power
}

COMPATIBLE_COMBO_CHAINS: frozenset[tuple[PunchClass, PunchClass]] = frozenset(
    {
        (PunchClass.JAB, PunchClass.STRAIGHT),
        (PunchClass.JAB, PunchClass.HOOK),
        (PunchClass.STRAIGHT, PunchClass.HOOK),
        (PunchClass.HOOK, PunchClass.UPPERCUT),
        (PunchClass.UPPERCUT, PunchClass.HOOK),
    }
)


@dataclass(frozen=True, slots=True)
class JudgeProfile:
    name: str
    damage_weight: int
    clean_weight: int
    defense_weight: int
    control_weight: int


JUDGE_PROFILES: tuple[JudgeProfile, ...] = (
    JudgeProfile("Impact", 5, 3, 1, 1),
    JudgeProfile("Craft", 3, 4, 2, 1),
    JudgeProfile("Generalship", 3, 3, 1, 3),
)


def fatigue_max_stamina(conditioning: int, body_trauma: int) -> int:
    conditioning_penalty = (MAX_CONDITIONING - conditioning) * 45 // 100
    body_penalty = min(280, body_trauma // 3)
    return max(330, MAX_STAMINA - conditioning_penalty - body_penalty)


def fatigue_factor(conditioning: int, body_trauma: int) -> int:
    return max(48, 100 - (MAX_CONDITIONING - conditioning) // 18 - body_trauma // 35)
