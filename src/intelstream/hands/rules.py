import json
from dataclasses import dataclass, replace
from importlib import resources
from typing import Any

from intelstream.hands.types import Power, PunchClass, Target


def _load_manifest() -> dict[str, Any]:
    resource = resources.files("intelstream.hands").joinpath("combat-manifest.json")
    return json.loads(resource.read_text())  # type: ignore[no-any-return]


_MANIFEST = _load_manifest()

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


def _manifest_check() -> None:
    ring = _MANIFEST["ring"]
    limits = _MANIFEST["limits"]
    expected = {
        "half_width": RING_HALF_WIDTH,
        "half_height": RING_HALF_HEIGHT,
        "fighter_radius": FIGHTER_RADIUS,
    }
    if dict(ring) != expected or _MANIFEST["tick_rate"] != TICKS_PER_SECOND:
        raise RuntimeError("combat-manifest.json ring/tick_rate mismatch with rules.py")
    if limits["max_stamina"] != MAX_STAMINA or limits["max_conditioning"] != MAX_CONDITIONING:
        raise RuntimeError("combat-manifest.json limits mismatch with rules.py")
    if limits["max_guard"] != MAX_GUARD or limits["max_poise"] != MAX_POISE:
        raise RuntimeError("combat-manifest.json limits mismatch with rules.py")


_manifest_check()


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
    PunchClass.JAB: PunchRule(**_MANIFEST["punches"]["jab"]),
    PunchClass.STRAIGHT: PunchRule(**_MANIFEST["punches"]["straight"]),
    PunchClass.HOOK: PunchRule(**_MANIFEST["punches"]["hook"]),
    PunchClass.UPPERCUT: PunchRule(**_MANIFEST["punches"]["uppercut"]),
}

_VARIANTS = _MANIFEST["variants"]


def _punch_variant(base: PunchRule, target: Target, power: Power) -> PunchRule:
    rule = base
    if target is Target.BODY:
        variant = _VARIANTS["body"]
        rule = replace(
            rule,
            startup=rule.startup + variant["startup_add"],
            reach=max(variant["reach_min"], rule.reach - variant["reach_sub"]),
            lateral_arc=rule.lateral_arc + variant["lateral_arc_add"],
            impact=rule.impact * variant["impact_mul_num"] // variant["impact_mul_den"],
            stamina_cost=rule.stamina_cost + variant["stamina_cost_add"],
            whiff_cost=rule.whiff_cost + variant["whiff_cost_add"],
            poise_damage=rule.poise_damage
            * variant["poise_damage_mul_num"]
            // variant["poise_damage_mul_den"],
        )
    if power is Power.POWER:
        variant = _VARIANTS["power"]
        rule = replace(
            rule,
            startup=rule.startup + variant["startup_add"],
            active=rule.active + variant["active_add"],
            recovery=rule.recovery + variant["recovery_add"],
            reach=rule.reach + variant["reach_add"],
            impact=rule.impact * variant["impact_mul_num"] // variant["impact_mul_den"],
            stamina_cost=rule.stamina_cost
            * variant["stamina_cost_mul_num"]
            // variant["stamina_cost_mul_den"],
            whiff_cost=rule.whiff_cost
            * variant["whiff_cost_mul_num"]
            // variant["whiff_cost_mul_den"],
            guard_damage=rule.guard_damage
            * variant["guard_damage_mul_num"]
            // variant["guard_damage_mul_den"],
            poise_damage=rule.poise_damage
            * variant["poise_damage_mul_num"]
            // variant["poise_damage_mul_den"],
            startup_vulnerability=rule.startup_vulnerability + variant["startup_vulnerability_add"],
            recovery_vulnerability=rule.recovery_vulnerability
            + variant["recovery_vulnerability_add"],
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
