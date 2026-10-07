import json
from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from importlib import resources
from typing import Any

from intelstream.hands.types import CornerChoice, FighterStyle, Power, PunchClass, Target


def _load_manifest() -> dict[str, Any]:
    resource = resources.files("intelstream.hands").joinpath("combat-manifest.json")
    return json.loads(resource.read_text())  # type: ignore[no-any-return]


_MANIFEST = _load_manifest()

TICKS_PER_SECOND = 30
RING_HALF_WIDTH = 500
RING_HALF_HEIGHT = 500
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
FACING_SCALE: int = _MANIFEST["facing"]["scale"]
# Share of the remaining turn toward the opponent taken per facing update. A fight tick makes two
# updates (before the exchange and after footwork), about 58% per tick; knockdown and rest walks
# make one.
FACING_TURN_PERCENT: int = _MANIFEST["facing"]["turn_percent_per_tick"]
RECOVERY_CANCEL_PERCENT: int = _MANIFEST["combos"]["recovery_cancel_percent"]
KNOCKDOWN_NEUTRAL_SEPARATION: int = _MANIFEST["knockdown"]["neutral_separation"]
REFEREE_WALK_SPEED: int = _MANIFEST["knockdown"]["referee_walk_speed"]
RING_CORNER_REACH: int = _MANIFEST["corners"]["reach"]
REST_CORNER_OFFSET: int = _MANIFEST["rest"]["corner_offset"]
CLINCH_HOLD_DISTANCE: int = _MANIFEST["clinch"]["hold_distance"]
CLINCH_DRAW_SPEED: int = _MANIFEST["clinch"]["draw_speed"]
REST_WALK_SPEED: int = _MANIFEST["rest"]["walk_speed"]
BLIND_SIDE_EYE_THRESHOLD: int = _MANIFEST["blind_side"]["eye_threshold"]
BLIND_SIDE_IMPACT_PERCENT: int = _MANIFEST["blind_side"]["impact_percent"]
PARRY_STAGGER_TICKS: int = _MANIFEST["parry"]["stagger_ticks"]
BODY_WIND_PERCENT: int = _MANIFEST["body"]["wind_percent"]
BODY_COLLAPSE_TRAUMA: int = _MANIFEST["body"]["collapse_body_trauma"]
BODY_COLLAPSE_STAMINA: int = _MANIFEST["body"]["collapse_stamina"]
BODY_COLLAPSE_MINIMUM_DAMAGE: int = _MANIFEST["body"]["collapse_minimum_damage"]
BODY_COLLAPSE_DELAY_TICKS: int = _MANIFEST["body"]["collapse_delay_ticks"]
GET_UP_STUN_TICKS: int = _MANIFEST["knockdown"]["get_up_stun_ticks"]
_STUN = _MANIFEST["stun"]
FLINCH_MINIMUM_DAMAGE: int = _STUN["flinch_minimum_damage"]
FLINCH_BASE_TICKS: int = _STUN["flinch_base_ticks"]
FLINCH_DAMAGE_DIVISOR: int = _STUN["flinch_damage_divisor"]
ROCKED_COUNTER_DAMAGE: int = _STUN["rocked_counter_damage"]
ROCKED_POWER_DAMAGE: int = _STUN["rocked_power_damage"]
ROCKED_HURT_POISE: int = _STUN["rocked_hurt_poise"]
ROCKED_BASE_TICKS: int = _STUN["rocked_base_ticks"]
ROCKED_DAMAGE_DIVISOR: int = _STUN["rocked_damage_divisor"]
ROCKED_MAX_TICKS: int = _STUN["rocked_max_ticks"]
STUN_CHAIN_MAX_TICKS: int = _STUN["chain_max_ticks"]
STUN_IMMUNITY_TICKS: int = _STUN["immunity_ticks"]
BLOCK_POISE_PERCENT: int = _MANIFEST["guard"]["block_poise_percent"]
PERFECT_BLOCK_POISE_PERCENT: int = _MANIFEST["guard"]["perfect_block_poise_percent"]
GUARD_LEAK_BASE_PERCENT: int = _MANIFEST["guard"]["leak_base_percent"]
GUARD_LEAK_MINIMUM_PERCENT: int = _MANIFEST["guard"]["leak_minimum_percent"]
GUARD_BLOCK_MINIMUM: int = _MANIFEST["guard"]["block_minimum"]
GUARD_HELD_REGEN_EVERY_TICKS: int = _MANIFEST["guard"]["held_regen_every_ticks"]
GUARD_DAMAGE_PERCENT: int = _MANIFEST["guard"]["damage_percent"]
GUARD_STAMINA_REGEN_PERCENT: int = _MANIFEST["guard"]["stamina_regen_percent"]
BODY_COLLAPSE_COOLDOWN_TICKS: int = _MANIFEST["body"]["collapse_cooldown_ticks"]
GET_UP_STAMINA: int = _MANIFEST["knockdown"]["get_up_stamina"]
GET_UP_BASE: int = _MANIFEST["knockdown"]["get_up_base"]
GET_UP_PER_KNOCKDOWN: int = _MANIFEST["knockdown"]["get_up_per_knockdown"]
GET_UP_TRAUMA_DIVISOR: int = _MANIFEST["knockdown"]["get_up_trauma_divisor"]
HEAD_TRAUMA_PER_DAMAGE_PERCENT: int = _MANIFEST["trauma"]["head_per_damage_percent"]
BODY_TRAUMA_PER_DAMAGE_PERCENT: int = _MANIFEST["trauma"]["body_per_damage_percent"]
EYE_TRAUMA_PER_DAMAGE_PERCENT: int = _MANIFEST["trauma"]["eye_per_damage_percent"]
CUT_PER_DAMAGE_PERCENT: int = _MANIFEST["trauma"]["cut_per_damage_percent"]
SWELLING_PER_DAMAGE_PERCENT: int = _MANIFEST["trauma"]["swelling_per_damage_percent"]
POISE_CEILING_PER_HEAD_PERCENT: int = _MANIFEST["trauma"]["poise_ceiling_per_head_percent"]
POISE_CEILING_FLOOR: int = _MANIFEST["trauma"]["poise_ceiling_floor"]
POISE_REGEN_EVERY_TICKS: int = _MANIFEST["trauma"]["poise_regen_every_ticks"]
POISE_DAMAGE_PERCENT: int = _MANIFEST["trauma"]["poise_damage_percent"]


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
    (PunchClass(first), PunchClass(second)) for first, second in _MANIFEST["combos"]["chains"]
)


@dataclass(frozen=True, slots=True)
class StyleRule:
    """How a style of boxer differs from the balanced fighter. Every number is neutral by default."""

    startup_ticks: Mapping[PunchClass, int] = field(default_factory=dict)
    recovery_ticks: Mapping[PunchClass, int] = field(default_factory=dict)
    reach_percent: int = 100
    impact_percent: int = 100
    poise_damage_percent: int = 100
    """Poise damage this fighter's punches do."""
    poise_taken_percent: int = 100
    """Poise damage this fighter takes: the chin."""
    stamina_cost_percent: int = 100
    conditioning_loss_percent: int = 100
    move_speed_percent: int = 100
    body_damage_percent: int = 100
    counter_bonus_percent: int = 28
    """A counter lands this much harder than the same punch thrown into nothing."""
    counter_window_ticks: int = 0
    evasion_ticks: int = 0
    perfect_block_ticks: int = 0


def _style_rule(raw: dict[str, Any]) -> StyleRule:
    fields = dict(raw)
    for key in ("startup_ticks", "recovery_ticks"):
        if key in fields:
            fields[key] = {PunchClass(name): ticks for name, ticks in fields[key].items()}
    return StyleRule(**fields)


STYLE_RULES: dict[FighterStyle, StyleRule] = {
    FighterStyle(name): _style_rule(raw) for name, raw in _MANIFEST["styles"].items()
}
if set(STYLE_RULES) != set(FighterStyle):
    raise RuntimeError("combat-manifest.json styles must list every fighter style")


def style_punch_rule(rule: PunchRule, style: StyleRule) -> PunchRule:
    """The punch as a fighter of `style` throws it, before fatigue: reach, cost and poise damage."""
    return replace(
        rule,
        reach=rule.reach * style.reach_percent // 100,
        stamina_cost=rule.stamina_cost * style.stamina_cost_percent // 100,
        whiff_cost=rule.whiff_cost * style.stamina_cost_percent // 100,
        poise_damage=rule.poise_damage * style.poise_damage_percent // 100,
    )


@dataclass(frozen=True, slots=True)
class CornerTreatment:
    worse_cut: int = 0
    other_cut: int = 0
    bleeding_kept_percent: int = 100
    swelling: int = 0
    eyes: int = 0
    conditioning: int = 0
    body: int = 0
    refresh: bool = False


CORNER_TREATMENTS: dict[CornerChoice, CornerTreatment] = {
    CornerChoice.CUT: CornerTreatment(**_MANIFEST["corner"]["cut"]),
    CornerChoice.SWELLING: CornerTreatment(**_MANIFEST["corner"]["swelling"]),
    CornerChoice.BREATH: CornerTreatment(**_MANIFEST["corner"]["breath"], refresh=True),
    CornerChoice.BALANCED: CornerTreatment(**_MANIFEST["corner"]["balanced"]),
}


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


def poise_ceiling(head_trauma: int) -> int:
    """The most poise a fighter gets back: a beating to the head wears it down for the bout."""
    return max(POISE_CEILING_FLOOR, MAX_POISE - head_trauma * POISE_CEILING_PER_HEAD_PERCENT // 100)


def fatigue_factor(conditioning: int, body_trauma: int) -> int:
    return max(48, 100 - (MAX_CONDITIONING - conditioning) // 18 - body_trauma // 35)
