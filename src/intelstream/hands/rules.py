import json
import math
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
ROUND_TICKS = 60 * TICKS_PER_SECOND
REST_TICKS = 6 * TICKS_PER_SECOND
COUNTDOWN_TICKS: int = _MANIFEST["countdown"]["opening_ticks"]
DEFAULT_ROUNDS = 3
MAX_STAMINA = 1000
MAX_CONDITIONING = 1000
MAX_GUARD = 700
MAX_POISE = 600
FACING_SCALE: int = _MANIFEST["facing"]["scale"]
# How fast a fighter turns to follow the other man's footwork. His own footwork turns him with it,
# so a man who circles keeps the other in front of him while the other has to turn to follow: fast
# enough, and close enough, circling takes an angle on him.
FACING_TURN_DEGREES_PER_SECOND: int = _MANIFEST["facing"]["turn_degrees_per_second"]
_FACING_TURN_RADIANS = math.radians(FACING_TURN_DEGREES_PER_SECOND / TICKS_PER_SECOND)
# The most a fighter turns in a tick, as the cosine and sine of the angle in millionths.
FACING_TURN_COS: int = round(math.cos(_FACING_TURN_RADIANS) * 1_000_000)
FACING_TURN_SIN: int = round(math.sin(_FACING_TURN_RADIANS) * 1_000_000)
ACTION_BUFFER_TICKS: int = _MANIFEST["action_buffer_ticks"]
# A fresh fighter's walking speed in units a tick, and the fastest velocity a snapshot reports.
MAX_SPEED: int = _MANIFEST["movement"]["max_speed"]
# The share of the way from his velocity to the one his input asks for that a fighter covers in a tick.
MOVE_BLEND_PERCENT: int = _MANIFEST["movement"]["blend_percent"]
# His footspeed while a punch recovers: he steps out behind it instead of standing rooted.
RECOVERY_SPEED_PERCENT: int = _MANIFEST["movement"]["recovery_speed_percent"]
EVASION_TICKS: int = _MANIFEST["evasion"]["ticks"]
EVASION_STAMINA: int = _MANIFEST["evasion"]["stamina"]
RECOVERY_CANCEL_PERCENT: int = _MANIFEST["combos"]["recovery_cancel_percent"]
REFEREE_WALK_SPEED: int = _MANIFEST["knockdown"]["referee_walk_speed"]
MANDATORY_COUNT: int = _MANIFEST["knockdown"]["mandatory_count"]
# The referee counts quicker than the clock: two thirds of a second a number.
COUNT_TICK_INTERVAL: int = _MANIFEST["knockdown"]["count_ticks"]
BOX_PAUSE_TICKS: int = _MANIFEST["knockdown"]["box_pause_ticks"]
TIRED_STARTUP_TICKS: int = _MANIFEST["tired"]["startup_ticks"]
TIRED_RECOVERY_TICKS: int = _MANIFEST["tired"]["recovery_ticks"]
TIRED_IMPACT_PERCENT: int = _MANIFEST["tired"]["impact_percent"]
FOUL_SEPARATION: int = _MANIFEST["foul"]["separation"]
RING_CORNER_REACH: int = _MANIFEST["corners"]["reach"]
REST_CORNER_OFFSET: int = _MANIFEST["rest"]["corner_offset"]
CLINCH_HOLD_DISTANCE: int = _MANIFEST["clinch"]["hold_distance"]
CLINCH_DRAW_SPEED: int = _MANIFEST["clinch"]["draw_speed"]
_REFEREE = _MANIFEST["referee"]
REFEREE_RADIUS: int = _REFEREE["radius"]
# How much beating the referee takes before he goes down for good. Nobody is shown it.
REFEREE_HEALTH: int = _REFEREE["health"]
REFEREE_SPEED: int = _REFEREE["walk_speed"]
# How far to the side of the fighters he keeps, close enough that a wild punch can find him, and how
# far from a man on the canvas he counts.
REFEREE_STANDOFF: int = _REFEREE["standoff"]
REFEREE_COUNT_STANDOFF: int = _REFEREE["count_standoff"]
REFEREE_STAGGER_BASE_TICKS: int = _REFEREE["stagger_base_ticks"]
REFEREE_STAGGER_DAMAGE_DIVISOR: int = _REFEREE["stagger_damage_divisor"]
REFEREE_STAGGER_MAX_TICKS: int = _REFEREE["stagger_max_ticks"]
# The bout stops this long when he goes down, for the replay.
REFEREE_DOWN_TICKS: int = _REFEREE["down_ticks"]
# A bleeding referee loses his bleeding over this in health every second.
REFEREE_BLEED_HEALTH_DIVISOR: int = _REFEREE["bleed_health_divisor"]
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
# Even a rocking shot cannot stop a fighter again this soon after a stun wears off: long enough to
# raise a guard through a round trip of latency.
ROCKED_IMMUNITY_TICKS: int = _STUN["rocked_immunity_ticks"]
STUNNED_SPEED_PERCENT: int = _STUN["moving_speed_percent"]
BLOCK_POISE_PERCENT: int = _MANIFEST["guard"]["block_poise_percent"]
PERFECT_BLOCK_POISE_PERCENT: int = _MANIFEST["guard"]["perfect_block_poise_percent"]
GUARD_LEAK_BASE_PERCENT: int = _MANIFEST["guard"]["leak_base_percent"]
GUARD_LEAK_MINIMUM_PERCENT: int = _MANIFEST["guard"]["leak_minimum_percent"]
GUARD_BLOCK_MINIMUM: int = _MANIFEST["guard"]["block_minimum"]
# A raised guard only perfect-blocks once the guard has been let down for this many ticks: a guard
# flicked down and straight back up blocks, but keeps no parry window open.
PERFECT_BLOCK_REARM_TICKS: int = _MANIFEST["guard"]["perfect_rearm_ticks"]
# A held guard tires the arms: it wears down every tick it is up and only comes back once lowered.
GUARD_HELD_DRAIN: int = _MANIFEST["guard"]["held_drain"]
GUARD_BREAK_STUN_TICKS: int = _MANIFEST["guard"]["break_stun_ticks"]
# A broken guard stops nothing until it has come back this far.
GUARD_REARM: int = _MANIFEST["guard"]["rearm"]
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
# The skin over an eye splits once the eye has swollen this far.
CUT_OPENS_EYE: int = _MANIFEST["trauma"]["cut_opens_eye"]
# Every clean head shot opens the bleeding by the fighter's cuts over this.
BLEEDING_CUT_DIVISOR: int = _MANIFEST["trauma"]["bleeding_cut_divisor"]
# A jab is a light punch: it seldom splits the skin and swells the face less than a hook.
JAB_CUT_PERCENT: int = _MANIFEST["trauma"]["jab_cut_percent"]
JAB_SWELLING_PERCENT: int = _MANIFEST["trauma"]["jab_swelling_percent"]
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
    # Not a tunable: the engine's fixed-point movement and compass, which the knockdown and rest
    # walks feed facing vectors into, and the client's snapshot checks all count a unit as 1000.
    if FACING_SCALE != 1000:
        raise RuntimeError("combat-manifest.json facing.scale must stay 1000")
    # A turn of a right angle or more in one tick could carry the facing past the opponent.
    if not 0 < FACING_TURN_DEGREES_PER_SECOND < 90 * TICKS_PER_SECOND:
        raise RuntimeError("combat-manifest.json facing.turn_degrees_per_second is out of range")
    if REST_CORNER_OFFSET * 2 > RING_CORNER_REACH:
        raise RuntimeError("combat-manifest.json rest.corner_offset is past the corner pads")
    if not 0 < MOVE_BLEND_PERCENT <= 100 or not 0 <= RECOVERY_SPEED_PERCENT <= 100:
        raise RuntimeError("combat-manifest.json movement percentages are out of range")


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
    conditioning_penalty = (MAX_CONDITIONING - conditioning) * 30 // 100
    body_penalty = min(200, body_trauma // 4)
    return max(450, MAX_STAMINA - conditioning_penalty - body_penalty)


def poise_ceiling(head_trauma: int) -> int:
    """The most poise a fighter gets back: a beating to the head wears it down for the bout."""
    return max(POISE_CEILING_FLOOR, MAX_POISE - head_trauma * POISE_CEILING_PER_HEAD_PERCENT // 100)


def fatigue_factor(conditioning: int, body_trauma: int) -> int:
    return max(65, 100 - (MAX_CONDITIONING - conditioning) // 30 - body_trauma // 50)
