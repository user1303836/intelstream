from __future__ import annotations

import hashlib
import json
import random
from dataclasses import asdict, dataclass, field, is_dataclass
from enum import Enum
from math import isqrt
from typing import Final

from intelstream.hands.rules import (
    BLIND_SIDE_EYE_THRESHOLD,
    BLIND_SIDE_IMPACT_PERCENT,
    BLOCK_POISE_PERCENT,
    BODY_COLLAPSE_COOLDOWN_TICKS,
    BODY_COLLAPSE_DELAY_TICKS,
    BODY_COLLAPSE_MINIMUM_DAMAGE,
    BODY_COLLAPSE_STAMINA,
    BODY_COLLAPSE_TRAUMA,
    BODY_TRAUMA_PER_DAMAGE_PERCENT,
    BODY_WIND_PERCENT,
    BOX_PAUSE_TICKS,
    CLINCH_DRAW_SPEED,
    CLINCH_HOLD_DISTANCE,
    COMPATIBLE_COMBO_CHAINS,
    CORNER_TREATMENTS,
    COUNTDOWN_TICKS,
    CUT_PER_DAMAGE_PERCENT,
    DEFAULT_ROUNDS,
    EYE_TRAUMA_PER_DAMAGE_PERCENT,
    FACING_SCALE,
    FACING_TURN_PERCENT,
    FIGHTER_RADIUS,
    FLINCH_BASE_TICKS,
    FLINCH_DAMAGE_DIVISOR,
    FLINCH_MINIMUM_DAMAGE,
    FOUL_SEPARATION,
    GET_UP_BASE,
    GET_UP_PER_KNOCKDOWN,
    GET_UP_STAMINA,
    GET_UP_STUN_TICKS,
    GET_UP_TRAUMA_DIVISOR,
    GUARD_BLOCK_MINIMUM,
    GUARD_DAMAGE_PERCENT,
    GUARD_HELD_REGEN_EVERY_TICKS,
    GUARD_LEAK_BASE_PERCENT,
    GUARD_LEAK_MINIMUM_PERCENT,
    GUARD_STAMINA_REGEN_PERCENT,
    HEAD_TRAUMA_PER_DAMAGE_PERCENT,
    JAB_CUT_PERCENT,
    JAB_SWELLING_PERCENT,
    JUDGE_PROFILES,
    MANDATORY_COUNT,
    MAX_CONDITIONING,
    MAX_GUARD,
    MAX_POISE,
    MAX_STAMINA,
    MINIMUM_SEPARATION,
    PARRY_STAGGER_TICKS,
    PERFECT_BLOCK_POISE_PERCENT,
    PERFECT_BLOCK_REARM_TICKS,
    POISE_DAMAGE_PERCENT,
    POISE_REGEN_EVERY_TICKS,
    PUNCH_RULES,
    RECOVERY_CANCEL_PERCENT,
    REFEREE_WALK_SPEED,
    REST_CORNER_OFFSET,
    REST_TICKS,
    REST_WALK_SPEED,
    RING_CORNER_REACH,
    RING_HALF_HEIGHT,
    RING_HALF_WIDTH,
    ROCKED_BASE_TICKS,
    ROCKED_COUNTER_DAMAGE,
    ROCKED_DAMAGE_DIVISOR,
    ROCKED_HURT_POISE,
    ROCKED_IMMUNITY_TICKS,
    ROCKED_MAX_TICKS,
    ROCKED_POWER_DAMAGE,
    ROUND_TICKS,
    STUN_CHAIN_MAX_TICKS,
    STUN_IMMUNITY_TICKS,
    STUNNED_SPEED_PERCENT,
    STYLE_RULES,
    SWELLING_PER_DAMAGE_PERCENT,
    TICKS_PER_SECOND,
    TIRED_IMPACT_PERCENT,
    TIRED_RECOVERY_TICKS,
    TIRED_STARTUP_TICKS,
    JudgeProfile,
    PunchRule,
    StyleRule,
    fatigue_factor,
    fatigue_max_stamina,
    poise_ceiling,
    style_punch_rule,
)
from intelstream.hands.types import (
    ActionKind,
    CombatEvent,
    CornerChoice,
    DefensivePose,
    EngineSnapshot,
    FighterSnapshot,
    FighterStyle,
    FinishMethod,
    FoulAction,
    Hand,
    InputCommand,
    JudgeCard,
    MatchPhase,
    MatchResult,
    MovementAction,
    Power,
    PunchAction,
    PunchClass,
    SemanticAction,
    Stance,
    Target,
    TraumaSnapshot,
)

PERFECT_BLOCK_TICKS: Final = 4
EVASION_TICKS: Final = 10
COUNTER_WINDOW_TICKS: Final = 18
ROPE_OVERLAP_PASSES: Final = 8
ROPE_OVERLAP_STEP: Final = 8
CLINCH_STARTUP_TICKS: Final = 8
CLINCH_TICKS: Final = 45
FOUL_RECOVERY_TICKS: Final = 60
COUNT_TICK_INTERVAL: Final = TICKS_PER_SECOND
MAX_PENDING_ACTIONS: Final = 1
ACTION_BUFFER_TICKS: Final = 6
GET_UP_WINDOW_START_OFFSET: Final = 3
GET_UP_WINDOW_END_OFFSET: Final = 13
TAUNT_TICKS: Final = 60
MOVEMENT_FIXED_SCALE: Final = 1000
# A fresh fighter's walking speed in units a tick, and the fastest velocity a snapshot reports.
MAX_SPEED: Final = 7
CORNER_INSTRUCTIONS: Final = {
    ActionKind.CORNER_CUT: CornerChoice.CUT,
    ActionKind.CORNER_SWELLING: CornerChoice.SWELLING,
    ActionKind.CORNER_BREATH: CornerChoice.BREATH,
}


@dataclass(frozen=True, slots=True)
class EngineConfig:
    rounds: int = DEFAULT_ROUNDS
    round_ticks: int = ROUND_TICKS
    rest_ticks: int = REST_TICKS
    countdown_ticks: int = COUNTDOWN_TICKS
    doctor_cut_threshold: int = 800
    doctor_swelling_threshold: int = 900
    flash_ko_enabled: bool = True

    def __post_init__(self) -> None:
        if not 1 <= self.rounds <= 15:
            raise ValueError("rounds must be between 1 and 15")
        if self.round_ticks < 1 or self.rest_ticks < 0 or self.countdown_ticks < 0:
            raise ValueError("phase durations must be non-negative and rounds must have time")
        if self.doctor_cut_threshold < 1 or self.doctor_swelling_threshold < 1:
            raise ValueError("doctor stoppage thresholds must be positive")


@dataclass(slots=True)
class Trauma:
    head: int = 0
    body: int = 0
    left_eye: int = 0
    right_eye: int = 0
    left_cut: int = 0
    right_cut: int = 0
    swelling: int = 0
    bleeding: int = 0


@dataclass(slots=True)
class AttackState:
    action: PunchAction
    rule: PunchRule
    age: int = 0
    resolved: bool = False
    landed: bool = False
    combo_bonus: int = 0
    start_tick: int = 0
    contact_tick: int = 0

    @property
    def total_ticks(self) -> int:
        return self.rule.startup + self.rule.active + self.rule.recovery

    @property
    def cancel_age(self) -> int:
        return (
            self.rule.startup
            + self.rule.active
            + self.rule.recovery * RECOVERY_CANCEL_PERCENT // 100
        )


@dataclass(slots=True)
class RoundPerformance:
    damage: int = 0
    clean_hits: int = 0
    blocked_hits: int = 0
    evasions: int = 0
    control: int = 0
    knockdowns: int = 0
    deductions: int = 0


@dataclass(slots=True)
class FighterState:
    player_id: str
    x: int
    y: int
    facing: int
    stance: Stance
    style: FighterStyle = FighterStyle.BALANCED
    facing_x: int = 0
    facing_y: int = 0
    velocity_x: int = 0
    velocity_y: int = 0
    velocity_fixed_x: int = 0
    velocity_fixed_y: int = 0
    position_remainder_x: int = 0
    position_remainder_y: int = 0
    stamina: int = MAX_STAMINA
    conditioning: int = MAX_CONDITIONING
    guard: int = MAX_GUARD
    poise: int = MAX_POISE
    trauma: Trauma = field(default_factory=Trauma)
    defense: DefensivePose = DefensivePose.NONE
    defense_started_tick: int = -1000
    guard_held_tick: int = -1000
    """The last tick the fighter was holding a guard (his input, whatever the stun or slip did)."""
    guard_raised_tick: int = -1000
    """When the guard he has up was raised, if it can perfect-block: after being let down a while."""
    evasion_ticks: int = 0
    stunned_ticks: int = 0
    stunned_at_tick: int = -1
    stun_chain_ticks: int = 0
    stun_immune_until_tick: int = -1
    rocked_immune_until_tick: int = -1
    counter_ticks: int = 0
    clinch_startup_ticks: int = 0
    clinch_ticks: int = 0
    taunt_ticks: int = 0
    attack: AttackState | None = None
    last_punch: PunchAction | None = None
    combo_ticks: int = 0
    knockdowns: int = 0
    warnings: int = 0
    deductions: int = 0
    get_up_meter: int = 0
    get_up_prompt: ActionKind | None = None
    get_up_window_start_tick: int = 0
    get_up_window_end_tick: int = 0
    get_up_prompt_resolved: bool = False
    last_sequence: int = -1
    held_input: InputCommand = field(default_factory=lambda: InputCommand(0, 0))
    pending_actions: list[SemanticAction] = field(default_factory=list)
    pending_action_expires_tick: int = 0
    last_action_id: str = ""
    last_action_key: str = ""
    last_action_start_tick: int = -1
    last_action_startup_ticks: int = 0
    last_action_active_ticks: int = 0
    last_action_recovery_ticks: int = 0
    last_action_contact_tick: int = 0
    last_action_until_tick: int = -1
    performance: RoundPerformance = field(default_factory=RoundPerformance)
    damage_dealt: int = 0
    movement_load: int = 0
    corner_choice: CornerChoice | None = None
    body_collapse_ticks: int = 0
    body_collapse_at_tick: int = -100_000
    body_collapse_action_id: str | None = None

    def __post_init__(self) -> None:
        if self.facing_x == 0 and self.facing_y == 0:
            self.facing_x = FACING_SCALE if self.facing >= 0 else -FACING_SCALE

    @property
    def maximum_stamina(self) -> int:
        return fatigue_max_stamina(self.conditioning, self.trauma.body)

    @property
    def style_rule(self) -> StyleRule:
        return STYLE_RULES[self.style]

    @property
    def fatigue(self) -> int:
        return fatigue_factor(self.conditioning, self.trauma.body)


@dataclass(frozen=True, slots=True)
class RoundScores:
    player_one: int
    player_two: int


def score_round(
    player_one: RoundPerformance,
    player_two: RoundPerformance,
    profile: JudgeProfile,
) -> RoundScores:
    one_value = (
        player_one.damage * profile.damage_weight
        + player_one.clean_hits * 18 * profile.clean_weight
        + (player_one.blocked_hits + player_one.evasions * 2) * 7 * profile.defense_weight
        + player_one.control * profile.control_weight
    )
    two_value = (
        player_two.damage * profile.damage_weight
        + player_two.clean_hits * 18 * profile.clean_weight
        + (player_two.blocked_hits + player_two.evasions * 2) * 7 * profile.defense_weight
        + player_two.control * profile.control_weight
    )
    margin = one_value - two_value
    if player_one.knockdowns != player_two.knockdowns:
        one, two = (10, 9) if player_one.knockdowns > player_two.knockdowns else (9, 10)
    elif abs(margin) <= max(30, (one_value + two_value) // 50):
        one, two = 10, 10
    elif margin > 0:
        one, two = 10, 9
    else:
        one, two = 9, 10

    one -= player_two.knockdowns
    two -= player_one.knockdowns
    one -= player_one.deductions
    two -= player_two.deductions
    return RoundScores(max(6, one), max(6, two))


def _symmetric_divide(numerator: int, denominator: int) -> int:
    magnitude = abs(numerator) // denominator
    return magnitude if numerator >= 0 else -magnitude


def _separation_along_axis(across: int) -> int:
    """Distance to open along one axis so two fighters `across` apart on the other just clear.

    Opening the full separation on one axis regardless of the other threw fighters who met at an
    angle well apart, so they closed and were thrown apart again for as long as they pressed.
    """
    needed = MINIMUM_SEPARATION * MINIMUM_SEPARATION - across * across
    if needed <= 0:
        return 0
    root = isqrt(needed)
    return root if root * root == needed else root + 1


def _away_divide(numerator: int, denominator: int) -> int:
    magnitude = -(-abs(numerator) // denominator)
    return magnitude if numerator >= 0 else -magnitude


def _normalize_move_vector(move_x: int, move_y: int) -> tuple[int, int]:
    squared_magnitude = move_x * move_x + move_y * move_y
    if squared_magnitude <= 1_000_000:
        return move_x, move_y

    magnitude = isqrt(squared_magnitude)

    def scaled(value: int) -> int:
        rounded = (abs(value) * 1000 + magnitude // 2) // magnitude
        return rounded if value >= 0 else -rounded

    normalized_x, normalized_y = scaled(move_x), scaled(move_y)
    while normalized_x * normalized_x + normalized_y * normalized_y > 1_000_000:
        if abs(normalized_x) >= abs(normalized_y):
            normalized_x -= 1 if normalized_x > 0 else -1
        else:
            normalized_y -= 1 if normalized_y > 0 else -1
    return normalized_x, normalized_y


def _blend_velocity(current: int, desired: int) -> int:
    return _symmetric_divide(current + desired, 2)


def _rounded_fixed_velocity(velocity: int) -> int:
    rounded = (abs(velocity) + MOVEMENT_FIXED_SCALE // 2) // MOVEMENT_FIXED_SCALE
    return rounded if velocity >= 0 else -rounded


def _report_velocity(fighter: FighterState, limit: int) -> None:
    """Rounds the fixed-point velocity to the whole units a snapshot reports, within `limit`.

    The footwork stays in fixed point, so a style's few percent of footspeed survive, but the
    velocity a snapshot reports keeps within the walking speed: a quick fighter's 7.7 would round
    to 8, past what clients accept.
    """
    fighter.velocity_x = _rounded_fixed_velocity(fighter.velocity_fixed_x)
    fighter.velocity_y = _rounded_fixed_velocity(fighter.velocity_fixed_y)
    while (
        fighter.velocity_x * fighter.velocity_x + fighter.velocity_y * fighter.velocity_y
        > limit * limit
    ):
        if abs(fighter.velocity_x) >= abs(fighter.velocity_y):
            fighter.velocity_x -= 1 if fighter.velocity_x > 0 else -1
        else:
            fighter.velocity_y -= 1 if fighter.velocity_y > 0 else -1


def _consume_fixed_position(velocity: int, remainder: int) -> tuple[int, int]:
    total = velocity + remainder
    delta = _symmetric_divide(total, MOVEMENT_FIXED_SCALE)
    return delta, total - delta * MOVEMENT_FIXED_SCALE


def _ring_point(x: int, y: int) -> tuple[int, int, bool, bool, bool]:
    """Nearest point inside the ropes and corner pads.

    Also reports which of the x rope, the y rope and the corner cut stopped the point. At the end
    of a cut, where it meets a rope, both are reported.
    """
    limit_x = RING_HALF_WIDTH - FIGHTER_RADIUS
    limit_y = RING_HALF_HEIGHT - FIGHTER_RADIUS
    sign_x = -1 if x < 0 else 1
    sign_y = -1 if y < 0 else 1
    reach_x, reach_y = abs(x), abs(y)
    inside_x, inside_y = min(reach_x, limit_x), min(reach_y, limit_y)
    if inside_x + inside_y <= RING_CORNER_REACH:
        return sign_x * inside_x, sign_y * inside_y, reach_x > limit_x, reach_y > limit_y, False
    excess = reach_x + reach_y - RING_CORNER_REACH
    if reach_x >= reach_y:
        cut_x, cut_y = reach_x - (excess + 1) // 2, reach_y - excess // 2
    else:
        cut_x, cut_y = reach_x - excess // 2, reach_y - (excess + 1) // 2
    if cut_y > limit_y:
        return sign_x * (RING_CORNER_REACH - limit_y), sign_y * limit_y, False, True, True
    if cut_x > limit_x:
        return sign_x * limit_x, sign_y * (RING_CORNER_REACH - limit_x), True, False, True
    return sign_x * cut_x, sign_y * cut_y, False, False, True


def _canonical(value: object) -> object:
    if isinstance(value, Enum):
        return value.value
    if is_dataclass(value) and not isinstance(value, type):
        return _canonical(asdict(value))
    if isinstance(value, dict):
        return {str(key): _canonical(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_canonical(item) for item in value]
    return value


class BoxingEngine:
    def __init__(
        self,
        *,
        match_id: str,
        activity_instance_id: str,
        guild_id: str,
        player_one_id: str,
        player_two_id: str,
        seed: int,
        config: EngineConfig | None = None,
        styles: tuple[FighterStyle, FighterStyle] = (FighterStyle.BALANCED, FighterStyle.BALANCED),
    ) -> None:
        if player_one_id == player_two_id:
            raise ValueError("a match requires two distinct players")
        self.match_id = match_id
        self.activity_instance_id = activity_instance_id
        self.guild_id = guild_id
        self.seed = seed
        self.config = config or EngineConfig()
        self.tick = 0
        self.round_number = 1
        self.phase = MatchPhase.COUNTDOWN if self.config.countdown_ticks else MatchPhase.FIGHT
        self.phase_ticks_remaining = (
            self.config.countdown_ticks if self.config.countdown_ticks else self.config.round_ticks
        )
        self.result: MatchResult | None = None
        self._rng = random.Random(seed)  # nosec B311
        self._player_ids = (player_one_id, player_two_id)
        self._fighters = {
            player_one_id: FighterState(player_one_id, -180, 0, 1, Stance.ORTHODOX, styles[0]),
            player_two_id: FighterState(player_two_id, 180, 0, -1, Stance.ORTHODOX, styles[1]),
        }
        self._events: list[CombatEvent] = []
        self._tick_events: list[CombatEvent] = []
        self._event_id = 0
        self._event_history_digest = bytes(32)
        self._round_cards: dict[str, tuple[list[int], list[int]]] = {
            profile.name: ([], []) for profile in JUDGE_PROFILES
        }
        self._downed_id: str | None = None
        self._knockdown_count_ticks = 0
        self._foul_recovery_target: str | None = None
        self._paused_fight_ticks = 0
        self._neutral_corner: tuple[int, int] | None = None
        self._box_tick: int | None = None
        self._count_at_rise = 0

    @property
    def players(self) -> tuple[str, str]:
        return self._player_ids

    @property
    def events(self) -> tuple[CombatEvent, ...]:
        return tuple(self._events)

    def fighter(self, player_id: str) -> FighterState:
        try:
            return self._fighters[player_id]
        except KeyError as exc:
            raise ValueError("unknown player") from exc

    def clear_action_buffers(self) -> None:
        for fighter in self._fighters.values():
            fighter.pending_actions.clear()
            fighter.pending_action_expires_tick = 0

    def clear_held_input(self) -> None:
        for fighter in self._fighters.values():
            fighter.held_input = InputCommand(0, 0)

    def submit_input(self, player_id: str, command: InputCommand) -> bool:
        fighter = self.fighter(player_id)
        if self.result is not None or self.phase is MatchPhase.COMPLETE:
            return False
        if command.sequence <= fighter.last_sequence:
            return False
        fighter.last_sequence = command.sequence
        guard_started = (
            command.defense
            in (
                DefensivePose.GUARD_HIGH,
                DefensivePose.GUARD_LOW,
            )
            and command.defense is not fighter.held_input.defense
        )
        fighter.held_input = InputCommand(
            sequence=command.sequence,
            client_tick=command.client_tick,
            move_x=command.move_x,
            move_y=command.move_y,
            defense=command.defense,
        )
        if command.actions:
            recent_actions: list[SemanticAction] = []
            for action in command.actions:
                if not recent_actions or action != recent_actions[-1]:
                    recent_actions.append(action)
            fighter.pending_actions[:] = recent_actions[-MAX_PENDING_ACTIONS:]
            fighter.pending_action_expires_tick = self.tick + ACTION_BUFFER_TICKS
        elif guard_started:
            fighter.pending_actions.clear()
            fighter.pending_action_expires_tick = 0
        return True

    def step(self, inputs: dict[str, InputCommand] | None = None) -> EngineSnapshot:
        if self.result is not None:
            return self.snapshot()
        self._tick_events = []
        if inputs:
            for player_id in self._player_ids:
                command = inputs.get(player_id)
                if command is not None:
                    self.submit_input(player_id, command)

        self.tick += 1
        if self.phase is MatchPhase.COUNTDOWN:
            self._advance_countdown()
        elif self.phase is MatchPhase.FIGHT:
            self._advance_fight()
        elif self.phase is MatchPhase.KNOCKDOWN:
            self._advance_knockdown()
        elif self.phase is MatchPhase.FOUL_RECOVERY:
            self._advance_foul_recovery()
        elif self.phase is MatchPhase.REST:
            self._advance_rest()
        return self.snapshot()

    def _advance_countdown(self) -> None:
        self.phase_ticks_remaining -= 1
        if self.phase_ticks_remaining <= 0:
            self.phase = MatchPhase.FIGHT
            self.phase_ticks_remaining = self.config.round_ticks
            self._emit("bell", detail="round_start")

    def _advance_fight(self) -> None:
        self.phase_ticks_remaining -= 1
        one = self._fighters[self._player_ids[0]]
        two = self._fighters[self._player_ids[1]]
        one.movement_load = 0
        two.movement_load = 0
        # The facing blends toward the opponent here and again after each fighter's footwork
        # (`_move_fighter`), so in the fight phase it turns about 58% of the way per tick.
        self._update_facing(one, two)
        self._update_facing(two, one)

        # Seat order alternates by tick, as for punches, so a trade of body shots favours nobody.
        for fighter, opponent in ((one, two), (two, one))[:: 1 if self.tick % 2 == 0 else -1]:
            if fighter.body_collapse_ticks > 0:
                fighter.body_collapse_ticks -= 1
                if fighter.body_collapse_ticks == 0:
                    self._knock_down(
                        fighter,
                        opponent,
                        detail="body",
                        action_id=fighter.body_collapse_action_id,
                    )
                    return

        if one.clinch_ticks or two.clinch_ticks:
            self._advance_clinch(one, two)
        else:
            first, second = ((one, two), (two, one))[self.tick % 2]
            self._process_fighter(first, second)
            clinched = bool(one.clinch_ticks or two.clinch_ticks)
            if self.result is None and self.phase is MatchPhase.FIGHT and not clinched:
                self._process_fighter(second, first)
                clinched = bool(one.clinch_ticks or two.clinch_ticks)
            if self.result is None and self.phase is MatchPhase.FIGHT and not clinched:
                self._move_fighter(one, two)
                self._move_fighter(two, one)
                self._separate_fighters(one, two)

        for fighter, opponent in ((one, two), (two, one)):
            self._recover_resources(fighter)
            fighter.performance.control += self._ring_control(fighter, opponent)
            self._advance_bleeding(fighter)
            if self.result is not None:
                return

        if self.phase_ticks_remaining <= 0:
            self._finish_round()

    def _process_fighter(self, fighter: FighterState, opponent: FighterState) -> None:
        if fighter.counter_ticks > 0:
            fighter.counter_ticks -= 1
        if fighter.combo_ticks > 0:
            fighter.combo_ticks -= 1

        held_guard = fighter.held_input.defense in (
            DefensivePose.GUARD_HIGH,
            DefensivePose.GUARD_LOW,
        )
        # A perfect block needs a real raise: a guard let down for a moment first, not one flicked
        # down and back up, switched from high to low, or coming back up after a stun.
        guard_rested = self.tick - fighter.guard_held_tick > PERFECT_BLOCK_REARM_TICKS
        if held_guard:
            fighter.guard_held_tick = self.tick

        attack = fighter.attack
        imminent_trade = (
            fighter.stunned_at_tick == self.tick
            and attack is not None
            and self._attack_lands_next_tick(attack)
        )
        if fighter.stunned_ticks > 0:
            fighter.stunned_ticks -= 1
            fighter.stun_chain_ticks += 1
            if fighter.stunned_ticks == 0:
                self._clear_head(fighter)
            fighter.defense = DefensivePose.NONE
            # A stun ends the slip, weave or pull it caught him in: he stumbles rather than standing
            # frozen through the evasion's leftover ticks.
            fighter.evasion_ticks = 0
            fighter.clinch_startup_ticks = 0
            fighter.pending_actions.clear()
            if not imminent_trade:
                self._retain_action(fighter)
                return

        if fighter.evasion_ticks > 0:
            fighter.evasion_ticks -= 1
            if fighter.evasion_ticks == 0:
                fighter.defense = fighter.held_input.defense
        elif fighter.taunt_ticks > 0:
            if fighter.defense is not DefensivePose.NONE:
                fighter.defense = DefensivePose.NONE
                fighter.defense_started_tick = self.tick
        else:
            if fighter.defense is not fighter.held_input.defense:
                fighter.defense_started_tick = self.tick
                fighter.guard_raised_tick = self.tick if held_guard and guard_rested else -1000
            fighter.defense = fighter.held_input.defense

        if (
            fighter.pending_actions
            and fighter.attack is None
            and self.tick > fighter.pending_action_expires_tick
        ):
            fighter.pending_actions.clear()
            fighter.pending_action_expires_tick = 0

        attack = fighter.attack
        if attack is not None:
            attack.age += 1
            active_start = attack.rule.startup
            active_end = active_start + attack.rule.active
            if active_start <= attack.age < active_end and not attack.resolved:
                attack.resolved = True
                attack.contact_tick = self.tick
                self._resolve_punch(fighter, opponent, attack)
            if fighter.stunned_ticks > 0 or attack.age >= attack.total_ticks:
                self._retain_action(fighter)
                return
            if not self._can_cancel_recovery(fighter, opponent, attack):
                return
            self._retain_action(fighter)

        if fighter.taunt_ticks > 0:
            fighter.taunt_ticks -= 1
            return

        if fighter.clinch_startup_ticks > 0:
            self._advance_clinch_attempt(fighter, opponent)
            return
        if not fighter.pending_actions:
            return

        action = fighter.pending_actions.pop(0)
        if isinstance(action, PunchAction):
            self._start_punch(fighter, action)
        elif isinstance(action, FoulAction):
            self._resolve_foul(fighter, opponent, action)
        elif isinstance(action, MovementAction):
            self._resolve_movement_action(fighter, opponent, action)

    @staticmethod
    def _attack_lands_next_tick(attack: AttackState) -> bool:
        next_age = attack.age + 1
        return (
            not attack.resolved
            and attack.rule.startup <= next_age < attack.rule.startup + attack.rule.active
        )

    @staticmethod
    def _can_cancel_recovery(
        fighter: FighterState, opponent: FighterState, attack: AttackState
    ) -> bool:
        if not attack.landed or attack.age < attack.cancel_age or not fighter.pending_actions:
            return False
        if opponent.stunned_ticks > 0:
            # A stunned man is already open. Cutting the recovery short would only chain stun
            # into stun before he has a tick to answer.
            return False
        follow_up = fighter.pending_actions[0]
        return (
            isinstance(follow_up, PunchAction)
            and (attack.action.punch_class, follow_up.punch_class) in COMPATIBLE_COMBO_CHAINS
            # A punch the fighter cannot pay for in full is a tired one, and no combination.
            and fighter.stamina
            >= style_punch_rule(
                PUNCH_RULES[(follow_up.punch_class, follow_up.target, follow_up.power)],
                fighter.style_rule,
            ).stamina_cost
        )

    def _start_punch(self, fighter: FighterState, action: PunchAction) -> None:
        style = fighter.style_rule
        base_rule = style_punch_rule(
            PUNCH_RULES[(action.punch_class, action.target, action.power)], style
        )
        cost = base_rule.stamina_cost
        lead_hand = "left" if fighter.stance is Stance.ORTHODOX else "right"
        hand_speed_bonus = (
            1 if action.hand.value == lead_hand and action.punch_class is PunchClass.JAB else 0
        )
        rear_power_bonus = (
            8 if action.hand.value != lead_hand and action.punch_class is PunchClass.STRAIGHT else 0
        )
        # Arms too heavy for the punch still throw it: a slow, weak arm punch on what breath is left.
        tired = fighter.stamina < cost
        combo_bonus = 0
        if tired:
            self._emit("exhausted", fighter.player_id)
            cost = fighter.stamina
        elif (
            fighter.combo_ticks > 0
            and fighter.last_punch is not None
            and (fighter.last_punch.punch_class, action.punch_class) in COMPATIBLE_COMBO_CHAINS
        ):
            combo_bonus = 10
            cost = max(1, cost * 90 // 100)
        fighter.stamina -= cost
        fighter.conditioning = max(
            0, fighter.conditioning - max(1, cost // 12) * style.conditioning_loss_percent // 100
        )
        speed = fighter.fatigue
        startup = max(
            2,
            base_rule.startup * 100 // speed
            - hand_speed_bonus
            + style.startup_ticks.get(action.punch_class, 0),
        )
        recovery = max(
            4,
            base_rule.recovery * 100 // speed + style.recovery_ticks.get(action.punch_class, 0),
        )
        strength = TIRED_IMPACT_PERCENT if tired else 100
        if tired:
            startup += TIRED_STARTUP_TICKS
            recovery += TIRED_RECOVERY_TICKS
        rule = PunchRule(
            startup=startup,
            active=base_rule.active,
            recovery=recovery,
            reach=base_rule.reach,
            lateral_arc=base_rule.lateral_arc,
            impact=((base_rule.impact + rear_power_bonus) * strength // 100)
            * style.impact_percent
            // 100,
            stamina_cost=base_rule.stamina_cost,
            whiff_cost=base_rule.whiff_cost,
            guard_damage=base_rule.guard_damage * strength // 100,
            poise_damage=base_rule.poise_damage * strength // 100,
            combo_window=base_rule.combo_window,
            startup_vulnerability=base_rule.startup_vulnerability,
            recovery_vulnerability=base_rule.recovery_vulnerability,
        )
        fighter.attack = AttackState(action, rule, combo_bonus=combo_bonus, start_tick=self.tick)
        fighter.last_punch = action
        fighter.combo_ticks = rule.startup + rule.active + rule.recovery + rule.combo_window
        self._emit(
            "punch_start",
            fighter.player_id,
            detail=f"{action.hand.value}:{action.punch_class.value}:{action.target.value}",
            action_id=self._action_id(fighter, fighter.attack),
        )

    @staticmethod
    def _action_key(action: PunchAction) -> str:
        return f"{action.punch_class.value}:{action.hand.value}:{action.target.value}:{action.power.value}"

    def _action_id(self, fighter: FighterState, attack: AttackState) -> str:
        return attack.action.client_action_id or f"{fighter.player_id}@{attack.start_tick}"

    def _retain_action(self, fighter: FighterState) -> None:
        attack = fighter.attack
        if attack is None:
            return
        fighter.last_action_id = self._action_id(fighter, attack)
        fighter.last_action_key = self._action_key(attack.action)
        fighter.last_action_start_tick = attack.start_tick
        fighter.last_action_startup_ticks = attack.rule.startup
        fighter.last_action_active_ticks = attack.rule.active
        fighter.last_action_recovery_ticks = attack.rule.recovery
        fighter.last_action_contact_tick = attack.contact_tick if attack.resolved else 0
        fighter.last_action_until_tick = self.tick + 15
        fighter.attack = None
        if fighter.pending_actions:
            fighter.pending_action_expires_tick = self.tick + ACTION_BUFFER_TICKS

    def _resolve_punch(
        self, attacker: FighterState, defender: FighterState, attack: AttackState
    ) -> None:
        action = attack.action
        rule = attack.rule
        dx = defender.x - attacker.x
        dy = defender.y - attacker.y
        distance_squared = dx * dx + dy * dy
        vision_penalty = min(
            30,
            (attacker.trauma.left_eye + attacker.trauma.right_eye + attacker.trauma.swelling) // 70,
        )
        effective_reach = rule.reach * (100 - vision_penalty) // 100
        effective_arc = rule.lateral_arc * (100 - vision_penalty) // 100
        forward_distance, lateral_distance = self._facing_components(attacker, dx, dy)
        in_front = forward_distance > FIGHTER_RADIUS // 3
        if (
            not in_front
            or forward_distance > effective_reach
            or distance_squared > effective_reach**2
            or lateral_distance > effective_arc
        ):
            attacker.stamina = max(0, attacker.stamina - rule.whiff_cost)
            attacker.conditioning = max(
                0,
                attacker.conditioning
                - max(2, rule.whiff_cost // 10)
                * attacker.style_rule.conditioning_loss_percent
                // 100,
            )
            self._emit(
                "whiff",
                attacker.player_id,
                defender.player_id,
                amount=rule.whiff_cost,
                action_id=self._action_id(attacker, attack),
            )
            return

        blind = self._blind_side(defender, action)
        # The facing holds still through a punch, so `lateral_distance` is how far the defender is
        # off the line the punch was thrown along. Only off that line can he weave a body hook or
        # slip a body uppercut.
        if not blind and self._evades(
            defender, action, distance_squared, rule.reach, lateral_distance
        ):
            defender.performance.evasions += 1
            defender.counter_ticks = COUNTER_WINDOW_TICKS + defender.style_rule.counter_window_ticks
            self._emit(
                "evade", defender.player_id, attacker.player_id, detail=defender.defense.value
            )
            return

        guarding = (
            action.target is Target.HEAD and defender.defense is DefensivePose.GUARD_HIGH
        ) or (action.target is Target.BODY and defender.defense is DefensivePose.GUARD_LOW)
        # Arms too tired to hold a real guard stop nothing, and cannot be broken again.
        blocked = guarding and defender.guard >= GUARD_BLOCK_MINIMUM
        perfect = (
            blocked
            and not blind
            and self.tick - defender.guard_raised_tick
            <= PERFECT_BLOCK_TICKS + defender.style_rule.perfect_block_ticks
        )
        counter = attacker.counter_ticks > 0 or self._counter_vulnerable(defender.attack)
        # A combination flows through a blocked punch but not a parried one.
        attack.landed = not perfect
        fatigue = attacker.fatigue
        counter_multiplier = 100 + attacker.style_rule.counter_bonus_percent if counter else 100
        impact = (
            rule.impact * counter_multiplier * fatigue * (100 + attack.combo_bonus) // 1_000_000
        )
        if action.target is Target.BODY:
            impact = impact * attacker.style_rule.body_damage_percent // 100
        if blind:
            impact = impact * BLIND_SIDE_IMPACT_PERCENT // 100
        impact = max(1, impact)

        if blocked:
            guard_damage = rule.guard_damage * GUARD_DAMAGE_PERCENT // 100
            if perfect:
                guard_damage //= 3
                impact //= 8
                defender.counter_ticks = (
                    COUNTER_WINDOW_TICKS + defender.style_rule.counter_window_ticks
                )
                self._emit(
                    "perfect_block",
                    defender.player_id,
                    attacker.player_id,
                    action_id=self._action_id(attacker, attack),
                )
                if action.power is Power.POWER:
                    attacker.stunned_ticks = max(attacker.stunned_ticks, PARRY_STAGGER_TICKS)
                    attacker.stunned_at_tick = self.tick
                    attacker.taunt_ticks = 0
                    self._emit(
                        "parry",
                        defender.player_id,
                        attacker.player_id,
                        amount=PARRY_STAGGER_TICKS,
                        action_id=self._action_id(attacker, attack),
                    )
            else:
                guard_leak = max(
                    GUARD_LEAK_MINIMUM_PERCENT,
                    GUARD_LEAK_BASE_PERCENT - defender.guard // 12 + (100 - defender.fatigue) // 2,
                )
                impact = impact * guard_leak // 100
                self._emit(
                    "block",
                    defender.player_id,
                    attacker.player_id,
                    amount=guard_damage,
                    action_id=self._action_id(attacker, attack),
                )
            defender.guard = max(0, defender.guard - guard_damage)
            defender.performance.blocked_hits += 1
            if defender.guard < GUARD_BLOCK_MINIMUM:
                # Worn too thin to stop the next one: the guard is broken, and he is told so.
                defender.stunned_ticks = max(defender.stunned_ticks, 8)
                defender.stunned_at_tick = self.tick
                defender.taunt_ticks = 0
                self._emit(
                    "guard_break",
                    attacker.player_id,
                    defender.player_id,
                    action_id=self._action_id(attacker, attack),
                )
        else:
            attacker.performance.clean_hits += 1

        damage = max(1, impact)
        poise_damage = rule.poise_damage * counter_multiplier * POISE_DAMAGE_PERCENT // 10_000
        if blocked:
            poise_damage = (
                poise_damage
                * (PERFECT_BLOCK_POISE_PERCENT if perfect else BLOCK_POISE_PERCENT)
                // 100
            )
        poise_damage = poise_damage * defender.style_rule.poise_taken_percent // 100
        shut_eye: str | None = None
        if action.target is Target.HEAD:
            shut_eye = self._apply_head_damage(defender, action, damage, clean=not blocked)
        else:
            defender.trauma.body = min(
                1200, defender.trauma.body + damage * BODY_TRAUMA_PER_DAMAGE_PERCENT // 100
            )
            defender.conditioning = max(0, defender.conditioning - damage)
            if not blocked:
                # A clean shot to the body takes the wind out of a fighter as well as the legs.
                defender.stamina = max(0, defender.stamina - damage * BODY_WIND_PERCENT // 100)
        defender.poise -= poise_damage
        attacker.performance.damage += damage
        attacker.damage_dealt += damage
        if defender.clinch_startup_ticks > 0:
            defender.clinch_startup_ticks = 0
            self._emit("clinch_interrupted", attacker.player_id, defender.player_id)
        blood = min(100, defender.trauma.bleeding // 8 + damage // 4)
        self._emit(
            "counter_hit" if counter else "hit",
            attacker.player_id,
            defender.player_id,
            amount=damage,
            detail=f"{action.punch_class.value}:{action.target.value}",
            blood=blood,
            direction=attacker.facing,
            action_id=self._action_id(attacker, attack),
        )
        if blind and not blocked:
            self._emit(
                "blind_side",
                attacker.player_id,
                defender.player_id,
                detail="right" if action.hand is Hand.LEFT else "left",
                action_id=self._action_id(attacker, attack),
            )
        if shut_eye is not None:
            self._emit("eye_shut", attacker.player_id, defender.player_id, detail=shut_eye)

        if self._qualifies_for_flash(attacker, defender, action, rule, counter, blocked):
            chance = self._flash_chance(attacker, defender, damage)
            roll = self._rng.randrange(10_000)
            self._emit(
                "flash_roll",
                attacker.player_id,
                defender.player_id,
                amount=roll,
                detail=f"chance={chance}",
            )
            if roll < chance:
                self._complete(attacker.player_id, FinishMethod.FLASH_KO)
                return

        if self._needs_doctor_stoppage(defender):
            self._complete(attacker.player_id, FinishMethod.DOCTOR_STOPPAGE)
            return
        clean_head = action.target is Target.HEAD and not blocked
        if defender.poise <= 0:
            if action.target is Target.BODY:
                self._knock_down(
                    defender,
                    attacker,
                    detail="body",
                    action_id=self._action_id(attacker, attack),
                )
            else:
                self._knock_down(defender, attacker)
        elif clean_head and damage >= FLINCH_MINIMUM_DAMAGE:
            rocked = (
                (counter and damage >= ROCKED_COUNTER_DAMAGE)
                or (action.power is Power.POWER and damage >= ROCKED_POWER_DAMAGE)
                or defender.poise < ROCKED_HURT_POISE
            )
            if rocked:
                ticks = min(ROCKED_MAX_TICKS, ROCKED_BASE_TICKS + damage // ROCKED_DAMAGE_DIVISOR)
                if self._stun(defender, ticks, rocked=True):
                    self._emit("stun", attacker.player_id, defender.player_id, amount=damage)
            else:
                self._stun(
                    defender, FLINCH_BASE_TICKS + damage // FLINCH_DAMAGE_DIVISOR, rocked=False
                )
        elif (
            action.target is Target.BODY
            and not blocked
            and damage >= BODY_COLLAPSE_MINIMUM_DAMAGE
            and defender.trauma.body >= BODY_COLLAPSE_TRAUMA
            and defender.stamina <= BODY_COLLAPSE_STAMINA
            and defender.body_collapse_ticks == 0
            and self.tick - defender.body_collapse_at_tick >= BODY_COLLAPSE_COOLDOWN_TICKS
        ):
            # The delayed body knockdown: the fighter stands frozen for a moment, then goes to a knee.
            defender.body_collapse_ticks = BODY_COLLAPSE_DELAY_TICKS
            defender.body_collapse_at_tick = self.tick
            defender.body_collapse_action_id = self._action_id(attacker, attack)
            defender.stunned_ticks = max(defender.stunned_ticks, BODY_COLLAPSE_DELAY_TICKS + 1)
            defender.stunned_at_tick = self.tick
            defender.taunt_ticks = 0
            self._emit(
                "body_collapse",
                attacker.player_id,
                defender.player_id,
                amount=BODY_COLLAPSE_DELAY_TICKS,
                action_id=self._action_id(attacker, attack),
            )

    def _stun(self, fighter: FighterState, ticks: int, *, rocked: bool) -> bool:
        """Stops a fighter for `ticks`, and says whether it took.

        A clean shot makes a fresh fighter flinch; only a big counter, a big power shot or a hurt
        fighter is rocked. A punch on a fighter who is still stunned does not start his stun again,
        however hard it lands, and the attacker cannot cut his recovery short into him either, so a
        run of punches cannot hold him past the stun the first one started. A flinch cannot land
        again in the moment after a stun wears off, and even a rocking shot cannot in the first
        few ticks of it, and no stun runs past the chain limit: one clean punch cannot be strung
        into a knockdown with the defender unable to answer.
        """
        if fighter.stunned_ticks > 0:
            return False
        if self.tick < (
            fighter.rocked_immune_until_tick if rocked else fighter.stun_immune_until_tick
        ):
            return False
        fighter.stun_chain_ticks = 0
        fighter.stunned_ticks = min(ticks, STUN_CHAIN_MAX_TICKS)
        fighter.stunned_at_tick = self.tick
        fighter.taunt_ticks = 0
        return True

    def _clear_head(self, fighter: FighterState) -> None:
        """Ends a fighter's stun. A clean shot has to wait a moment before it can stop him again,
        and a mere flinch longer, so he always gets a chance to raise his guard or move."""
        fighter.stunned_ticks = 0
        fighter.stun_chain_ticks = 0
        fighter.stun_immune_until_tick = self.tick + STUN_IMMUNITY_TICKS
        fighter.rocked_immune_until_tick = self.tick + ROCKED_IMMUNITY_TICKS

    def _apply_head_damage(
        self, defender: FighterState, action: PunchAction, damage: int, *, clean: bool
    ) -> str | None:
        """Applies a head shot and returns the side of an eye it has just swollen shut, if any.

        Whatever gets through a guard still shakes the head, but only a clean punch marks the face.
        """
        eyes_before = (defender.trauma.left_eye, defender.trauma.right_eye)
        defender.trauma.head = min(
            1400, defender.trauma.head + damage * HEAD_TRAUMA_PER_DAMAGE_PERCENT // 100
        )
        if not clean:
            return None
        eye_damage = (
            damage
            * (2 if action.punch_class is PunchClass.HOOK else 1)
            * EYE_TRAUMA_PER_DAMAGE_PERCENT
            // 100
        )
        cut = damage * CUT_PER_DAMAGE_PERCENT // 100
        if action.punch_class is PunchClass.JAB:
            cut = cut * JAB_CUT_PERCENT // 100
        if action.hand.value == "left":
            defender.trauma.right_eye = min(1000, defender.trauma.right_eye + eye_damage)
            if defender.trauma.right_eye > 260:
                defender.trauma.right_cut = min(1000, defender.trauma.right_cut + cut)
        else:
            defender.trauma.left_eye = min(1000, defender.trauma.left_eye + eye_damage)
            if defender.trauma.left_eye > 260:
                defender.trauma.left_cut = min(1000, defender.trauma.left_cut + cut)
        swelling = damage * SWELLING_PER_DAMAGE_PERCENT // 100
        if action.punch_class is PunchClass.JAB:
            swelling = swelling * JAB_SWELLING_PERCENT // 100
        defender.trauma.swelling = min(1000, defender.trauma.swelling + swelling)
        defender.trauma.bleeding = min(
            1000,
            defender.trauma.bleeding
            + (defender.trauma.left_cut + defender.trauma.right_cut + 49) // 50,
        )
        eyes_after = (defender.trauma.left_eye, defender.trauma.right_eye)
        for side, before, after in zip(("left", "right"), eyes_before, eyes_after, strict=True):
            if before < BLIND_SIDE_EYE_THRESHOLD <= after:
                return side
        return None

    @staticmethod
    def _blind_side(defender: FighterState, action: PunchAction) -> bool:
        """A punch from this hand arrives on the side of an eye that is swollen shut."""
        eye = defender.trauma.right_eye if action.hand is Hand.LEFT else defender.trauma.left_eye
        return eye >= BLIND_SIDE_EYE_THRESHOLD

    @staticmethod
    def _counter_vulnerable(attack: AttackState | None) -> bool:
        if attack is None:
            return False
        recovery_start = attack.rule.startup + attack.rule.active
        recovery_window_start = attack.total_ticks - attack.rule.recovery_vulnerability
        return (
            attack.age < attack.rule.startup_vulnerability
            or recovery_window_start <= attack.age < attack.total_ticks
        ) and attack.age not in range(recovery_start, recovery_window_start)

    def _evades(
        self,
        defender: FighterState,
        action: PunchAction,
        distance_squared: int,
        reach: int,
        lateral_distance: int,
    ) -> bool:
        if defender.evasion_ticks <= 0:
            return False
        if defender.defense in (DefensivePose.SLIP_LEFT, DefensivePose.SLIP_RIGHT):
            required_pose = (
                DefensivePose.SLIP_LEFT
                if action.hand.value == "right"
                else DefensivePose.SLIP_RIGHT
            )
            if defender.defense is not required_pose:
                return False
            return action.punch_class in (PunchClass.JAB, PunchClass.STRAIGHT) or (
                action.punch_class is PunchClass.UPPERCUT
                and (action.target is Target.HEAD or lateral_distance >= 18)
            )
        if defender.defense is DefensivePose.WEAVE:
            return action.punch_class is PunchClass.HOOK and (
                action.target is Target.HEAD or lateral_distance >= 14
            )
        if defender.defense is DefensivePose.PULL:
            return (
                action.target is Target.HEAD
                and action.punch_class in (PunchClass.JAB, PunchClass.STRAIGHT)
                and distance_squared > (reach * 65 // 100) ** 2
            )
        return False

    def _resolve_movement_action(
        self, fighter: FighterState, opponent: FighterState, action: MovementAction
    ) -> bool:
        pose_by_action = {
            ActionKind.SLIP_LEFT: DefensivePose.SLIP_LEFT,
            ActionKind.SLIP_RIGHT: DefensivePose.SLIP_RIGHT,
            ActionKind.WEAVE: DefensivePose.WEAVE,
            ActionKind.PULL: DefensivePose.PULL,
        }
        if action.kind in pose_by_action:
            if fighter.stamina < 25:
                return False
            fighter.stamina -= 25
            fighter.conditioning = max(0, fighter.conditioning - 1)
            fighter.defense = pose_by_action[action.kind]
            fighter.defense_started_tick = self.tick
            fighter.evasion_ticks = EVASION_TICKS + fighter.style_rule.evasion_ticks
            self._emit("defense", fighter.player_id, detail=fighter.defense.value)
            return True
        if action.kind is ActionKind.SWITCH_STANCE:
            fighter.stance = (
                Stance.SOUTHPAW if fighter.stance is Stance.ORTHODOX else Stance.ORTHODOX
            )
            fighter.stamina = max(0, fighter.stamina - 12)
            self._emit("stance", fighter.player_id, detail=fighter.stance.value)
            return True
        if action.kind is ActionKind.TAUNT:
            fighter.taunt_ticks = TAUNT_TICKS
            fighter.defense = DefensivePose.NONE
            self._emit("taunt", fighter.player_id)
            return True
        if action.kind is ActionKind.CLINCH:
            distance_squared = (fighter.x - opponent.x) ** 2 + (fighter.y - opponent.y) ** 2
            if distance_squared <= 125**2 and fighter.stamina >= 45:
                fighter.stamina -= 25
                fighter.clinch_startup_ticks = CLINCH_STARTUP_TICKS
                self._emit("clinch_start", fighter.player_id, opponent.player_id)
                return True
            fighter.stamina = max(0, fighter.stamina - 20)
            self._emit("clinch_denied", fighter.player_id, opponent.player_id, detail="range")
            return True
        return False

    def _advance_clinch_attempt(self, fighter: FighterState, opponent: FighterState) -> None:
        fighter.clinch_startup_ticks -= 1
        if fighter.clinch_startup_ticks > 0:
            return
        distance_squared = (fighter.x - opponent.x) ** 2 + (fighter.y - opponent.y) ** 2
        if distance_squared > 105**2 or opponent.attack is not None or opponent.stunned_ticks > 0:
            self._emit("clinch_denied", fighter.player_id, opponent.player_id, detail="escaped")
            return
        fighter.stamina = max(0, fighter.stamina - 20)
        opponent.stamina = max(0, opponent.stamina - 20)
        fighter.clinch_startup_ticks = 0
        opponent.clinch_startup_ticks = 0
        fighter.clinch_ticks = CLINCH_TICKS
        opponent.clinch_ticks = CLINCH_TICKS
        for held in (fighter, opponent):
            # Tied up, neither walks on. Only the draw moves them now, and the speed they came in
            # with must not count as pressure or carry their feet through the hold.
            held.velocity_x = held.velocity_y = 0
            held.velocity_fixed_x = held.velocity_fixed_y = 0
            held.position_remainder_x = held.position_remainder_y = 0
        self._retain_action(fighter)
        self._retain_action(opponent)
        fighter.pending_actions.clear()
        opponent.pending_actions.clear()
        self._emit("clinch", fighter.player_id, opponent.player_id)

    def _resolve_foul(
        self, fighter: FighterState, opponent: FighterState, action: FoulAction
    ) -> None:
        distance_squared = (fighter.x - opponent.x) ** 2 + (fighter.y - opponent.y) ** 2
        if distance_squared > 100**2:
            fighter.stamina = max(0, fighter.stamina - 60)
            fighter.conditioning = max(0, fighter.conditioning - 8)
            self._emit("foul_miss", fighter.player_id, opponent.player_id, detail=action.foul.value)
            return
        fighter.stamina = max(0, fighter.stamina - 120)
        fighter.conditioning = max(0, fighter.conditioning - 20)
        fighter.warnings += 1
        fighter.performance.deductions = fighter.deductions
        opponent.stunned_ticks = 30
        opponent.stunned_at_tick = self.tick
        opponent.taunt_ticks = 0
        # The referee stops the action: a punch the fouled man was throwing goes no further.
        self._retain_action(opponent)
        self._emit("foul", fighter.player_id, opponent.player_id, detail=action.foul.value)
        if fighter.warnings == 2:
            fighter.deductions += 1
            fighter.performance.deductions = fighter.deductions
            self._emit("point_deduction", fighter.player_id, amount=1)
        elif fighter.warnings >= 3:
            self._complete(opponent.player_id, FinishMethod.DISQUALIFICATION)
            return
        # The referee steps between them: each is sent back from the other for the recovery.
        for mover in (fighter, opponent):
            mover.x -= _symmetric_divide(mover.facing_x * FOUL_SEPARATION, FACING_SCALE)
            mover.y -= _symmetric_divide(mover.facing_y * FOUL_SEPARATION, FACING_SCALE)
            mover.velocity_x = mover.velocity_y = 0
            mover.velocity_fixed_x = mover.velocity_fixed_y = 0
        self._clamp_to_ring(fighter)
        self._clamp_to_ring(opponent)
        self._separate_fighters(fighter, opponent)
        self._paused_fight_ticks = self.phase_ticks_remaining
        self.phase = MatchPhase.FOUL_RECOVERY
        self.phase_ticks_remaining = FOUL_RECOVERY_TICKS
        self._foul_recovery_target = opponent.player_id

    def _advance_foul_recovery(self) -> None:
        self.phase_ticks_remaining -= 1
        target = self._fighters[self._foul_recovery_target] if self._foul_recovery_target else None
        if target is not None:
            target.stamina = min(target.maximum_stamina, target.stamina + 4)
        if self.phase_ticks_remaining <= 0:
            for fighter in self._fighters.values():
                # The two seconds were the fouled man's recovery: both box on clear-headed, so
                # the fouler gets no free shot at a man with his guard still forced down.
                if fighter.stunned_ticks > 0:
                    self._clear_head(fighter)
                fighter.evasion_ticks = 0
            self.phase = MatchPhase.FIGHT
            self.phase_ticks_remaining = max(1, self._paused_fight_ticks)
            self._foul_recovery_target = None
            self._emit("resume", detail="foul_recovery_complete")

    def _advance_clinch(self, one: FighterState, two: FighterState) -> None:
        one.attack = None
        two.attack = None
        remaining = max(one.clinch_ticks, two.clinch_ticks) - 1
        one.clinch_ticks = max(0, remaining)
        two.clinch_ticks = max(0, remaining)
        one.stamina = min(one.maximum_stamina, one.stamina + 1)
        two.stamina = min(two.maximum_stamina, two.stamina + 1)
        one.conditioning = max(0, one.conditioning - (1 if self.tick % 10 == 0 else 0))
        two.conditioning = max(0, two.conditioning - (1 if self.tick % 10 == 0 else 0))
        if remaining > 0:
            self._draw_clinch_together(one, two)
        if remaining == 0:
            for fighter in (one, two):
                fighter.x -= _symmetric_divide(fighter.facing_x * 45, FACING_SCALE)
                fighter.y -= _symmetric_divide(fighter.facing_y * 45, FACING_SCALE)
            self._clamp_to_ring(one)
            self._clamp_to_ring(two)
            self._separate_fighters(one, two)
            self._emit("referee_break", one.player_id, two.player_id)

    def _draw_clinch_together(self, one: FighterState, two: FighterState) -> None:
        dx = two.x - one.x
        dy = two.y - one.y
        distance = isqrt(dx * dx + dy * dy)
        if distance <= CLINCH_HOLD_DISTANCE:
            return
        step = min(CLINCH_DRAW_SPEED, (distance - CLINCH_HOLD_DISTANCE) // 2)
        if step == 0:
            return
        move_x = _symmetric_divide(dx * step, distance)
        move_y = _symmetric_divide(dy * step, distance)
        one.x += move_x
        one.y += move_y
        two.x -= move_x
        two.y -= move_y
        self._clamp_to_ring(one)
        self._clamp_to_ring(two)

    def _move_fighter(self, fighter: FighterState, opponent: FighterState) -> None:
        move_x = fighter.held_input.move_x
        move_y = fighter.held_input.move_y
        speed = max(2, MAX_SPEED * fighter.fatigue // 100)
        if fighter.defense in (DefensivePose.GUARD_HIGH, DefensivePose.GUARD_LOW):
            speed = max(2, speed * 70 // 100)
        if fighter.stunned_ticks > 0:
            # A stunned fighter stumbles: still on his feet, at a fraction of his footwork.
            speed = max(2, speed * STUNNED_SPEED_PERCENT // 100)
        # In thousandths of a unit, so a style's few percent of footspeed survive the rounding.
        fixed_speed = speed * MOVEMENT_FIXED_SCALE * fighter.style_rule.move_speed_percent // 100
        if (
            fighter.attack is not None
            or fighter.evasion_ticks > 0
            or fighter.clinch_startup_ticks > 0
            or fighter.taunt_ticks > 0
            or fighter.body_collapse_ticks > 0
        ):
            move_x = 0
            move_y = 0
        move_x, move_y = _normalize_move_vector(move_x, move_y)
        desired_fixed_x = _symmetric_divide(move_x * fixed_speed, MOVEMENT_FIXED_SCALE)
        desired_fixed_y = _symmetric_divide(move_y * fixed_speed, MOVEMENT_FIXED_SCALE)
        fighter.velocity_fixed_x = _blend_velocity(fighter.velocity_fixed_x, desired_fixed_x)
        fighter.velocity_fixed_y = _blend_velocity(fighter.velocity_fixed_y, desired_fixed_y)
        fixed_cap = fixed_speed
        fixed_magnitude_squared = (
            fighter.velocity_fixed_x * fighter.velocity_fixed_x
            + fighter.velocity_fixed_y * fighter.velocity_fixed_y
        )
        if fixed_magnitude_squared > fixed_cap * fixed_cap:
            fixed_magnitude = isqrt(fixed_magnitude_squared)
            fighter.velocity_fixed_x = _symmetric_divide(
                fighter.velocity_fixed_x * fixed_cap, fixed_magnitude
            )
            fighter.velocity_fixed_y = _symmetric_divide(
                fighter.velocity_fixed_y * fixed_cap, fixed_magnitude
            )
            while (
                fighter.velocity_fixed_x * fighter.velocity_fixed_x
                + fighter.velocity_fixed_y * fighter.velocity_fixed_y
                > fixed_cap * fixed_cap
            ):
                if abs(fighter.velocity_fixed_x) >= abs(fighter.velocity_fixed_y):
                    fighter.velocity_fixed_x -= 1 if fighter.velocity_fixed_x > 0 else -1
                else:
                    fighter.velocity_fixed_y -= 1 if fighter.velocity_fixed_y > 0 else -1
        # The velocity a snapshot reports stays within the base speed; the footwork is in fixed point.
        _report_velocity(fighter, speed)
        delta_x, fighter.position_remainder_x = _consume_fixed_position(
            fighter.velocity_fixed_x, fighter.position_remainder_x
        )
        delta_y, fighter.position_remainder_y = _consume_fixed_position(
            fighter.velocity_fixed_y, fighter.position_remainder_y
        )
        fighter.x += delta_x
        fighter.y += delta_y
        self._clamp_to_ring(fighter)
        input_magnitude_squared = move_x * move_x + move_y * move_y
        velocity_magnitude_squared = (
            fighter.velocity_fixed_x * fighter.velocity_fixed_x
            + fighter.velocity_fixed_y * fighter.velocity_fixed_y
        )
        moving = bool(input_magnitude_squared or velocity_magnitude_squared)
        # Squared comparisons preserve exact deterministic ceil-bucket boundaries.
        above_half_speed = (
            input_magnitude_squared > 500**2 or velocity_magnitude_squared > (fixed_speed // 2) ** 2
        )
        movement_load = 2 if above_half_speed else int(moving)
        fighter.movement_load = movement_load
        self._update_facing(fighter, opponent)

    @staticmethod
    def _clamp_to_ring(fighter: FighterState) -> None:
        x, y, rope_x, rope_y, corner = _ring_point(fighter.x, fighter.y)
        if corner and (rope_x or rope_y):
            # Wedged where the corner pad meets a rope: nowhere left to slide.
            fighter.velocity_x = fighter.velocity_y = 0
            fighter.velocity_fixed_x = fighter.velocity_fixed_y = 0
            fighter.position_remainder_x = fighter.position_remainder_y = 0
        elif corner:
            # Against the corner pad: lose the speed into it, keep the speed along it.
            sign_x = -1 if x < 0 else 1
            sign_y = -1 if y < 0 else 1
            outward = sign_x * fighter.velocity_fixed_x + sign_y * fighter.velocity_fixed_y
            if outward > 0:
                half = (outward + 1) // 2
                fighter.velocity_fixed_x -= sign_x * half
                fighter.velocity_fixed_y -= sign_y * half
            _report_velocity(fighter, MAX_SPEED)
            fighter.position_remainder_x = fighter.position_remainder_y = 0
        else:
            if rope_x:
                fighter.velocity_x = 0
                fighter.velocity_fixed_x = 0
                fighter.position_remainder_x = 0
            if rope_y:
                fighter.velocity_y = 0
                fighter.velocity_fixed_y = 0
                fighter.position_remainder_y = 0
        fighter.x = x
        fighter.y = y

    def _separate_fighters(self, one: FighterState, two: FighterState) -> None:
        dx = two.x - one.x
        dy = two.y - one.y
        if dx * dx + dy * dy >= MINIMUM_SEPARATION**2:
            return
        before = (one.x, one.y, two.x, two.y)
        if abs(dx) >= abs(dy):
            direction = 1 if dx > 0 or (dx == 0 and one.player_id < two.player_id) else -1
            center = (one.x + two.x) // 2
            apart = _separation_along_axis(dy)
            one.x = center - direction * (apart // 2)
            two.x = center + direction * (apart - apart // 2)
            minimum = -RING_HALF_WIDTH + FIGHTER_RADIUS
            maximum = RING_HALF_WIDTH - FIGHTER_RADIUS
            shift = max(0, minimum - min(one.x, two.x)) - max(0, max(one.x, two.x) - maximum)
            one.x += shift
            two.x += shift
        else:
            direction = 1 if dy > 0 or (dy == 0 and one.player_id < two.player_id) else -1
            center = (one.y + two.y) // 2
            apart = _separation_along_axis(dx)
            one.y = center - direction * (apart // 2)
            two.y = center + direction * (apart - apart // 2)
            minimum = -RING_HALF_HEIGHT + FIGHTER_RADIUS
            maximum = RING_HALF_HEIGHT - FIGHTER_RADIUS
            shift = max(0, minimum - min(one.y, two.y)) - max(0, max(one.y, two.y) - maximum)
            one.y += shift
            two.y += shift
        pushed = (one.x, one.y, two.x, two.y)
        self._clamp_to_ring(one)
        self._clamp_to_ring(two)
        if (one.x, one.y, two.x, two.y) != pushed:
            # A corner pad refused part of the push. Start again from where they met, so the
            # same fighter gives way by the same amount every tick they keep pressing.
            one.x, one.y, two.x, two.y = before
            self._clamp_to_ring(one)
            self._clamp_to_ring(two)
        self._resolve_rope_overlap(one, two)

    def _resolve_rope_overlap(self, one: FighterState, two: FighterState) -> None:
        """Parts two fighters the ropes pushed back together.

        The fighter nearer the ring centre has room, so he gives way along the line between them
        by exactly the distance that is missing.
        """
        for _ in range(ROPE_OVERLAP_PASSES):
            dx = two.x - one.x
            dy = two.y - one.y
            squared = dx * dx + dy * dy
            if squared >= MINIMUM_SEPARATION**2:
                return
            if squared == 0:
                dx, dy, squared = (1 if one.player_id < two.player_id else -1), 0, 1
            distance = isqrt(squared)
            missing = MINIMUM_SEPARATION - distance
            push_x = _away_divide(dx * missing, distance)
            push_y = _away_divide(dy * missing, distance)
            if abs(one.x) + abs(one.y) <= abs(two.x) + abs(two.y):
                one.x -= push_x
                one.y -= push_y
            else:
                two.x += push_x
                two.y += push_y
            self._clamp_to_ring(one)
            self._clamp_to_ring(two)
        for _ in range(ROPE_OVERLAP_PASSES):
            dx = two.x - one.x
            dy = two.y - one.y
            if dx * dx + dy * dy >= MINIMUM_SEPARATION**2:
                return
            inner = one if abs(one.x) + abs(one.y) <= abs(two.x) + abs(two.y) else two
            inner.x -= ROPE_OVERLAP_STEP if inner.x > 0 else -ROPE_OVERLAP_STEP
            inner.y -= ROPE_OVERLAP_STEP if inner.y > 0 else -ROPE_OVERLAP_STEP
            self._clamp_to_ring(one)
            self._clamp_to_ring(two)

    def _update_facing(self, fighter: FighterState, opponent: FighterState) -> None:
        if fighter.attack is not None or fighter.clinch_startup_ticks:
            return
        dx = opponent.x - fighter.x
        dy = opponent.y - fighter.y
        distance = isqrt(dx * dx + dy * dy)
        if distance == 0:
            return
        desired_x = _symmetric_divide(dx * FACING_SCALE, distance)
        desired_y = _symmetric_divide(dy * FACING_SCALE, distance)
        if fighter.facing_x * desired_x + fighter.facing_y * desired_y < -(
            FACING_SCALE * FACING_SCALE * 9 // 10
        ):
            # Anti-parallel facings would blend through the origin; turn via the perpendicular.
            fighter.facing_x, fighter.facing_y = (
                fighter.facing_x - _symmetric_divide(fighter.facing_y * FACING_TURN_PERCENT, 100),
                fighter.facing_y + _symmetric_divide(fighter.facing_x * FACING_TURN_PERCENT, 100),
            )
        fighter.facing_x += _symmetric_divide(
            (desired_x - fighter.facing_x) * FACING_TURN_PERCENT, 100
        )
        fighter.facing_y += _symmetric_divide(
            (desired_y - fighter.facing_y) * FACING_TURN_PERCENT, 100
        )
        length = isqrt(fighter.facing_x**2 + fighter.facing_y**2)
        if length == 0:
            fighter.facing_x, fighter.facing_y = desired_x, desired_y
        else:
            fighter.facing_x = _symmetric_divide(fighter.facing_x * FACING_SCALE, length)
            fighter.facing_y = _symmetric_divide(fighter.facing_y * FACING_SCALE, length)
        fighter.facing = 1 if fighter.facing_x >= 0 else -1

    @staticmethod
    def _facing_components(fighter: FighterState, dx: int, dy: int) -> tuple[int, int]:
        forward = _symmetric_divide(dx * fighter.facing_x + dy * fighter.facing_y, FACING_SCALE)
        lateral = abs(dx * fighter.facing_y - dy * fighter.facing_x) // FACING_SCALE
        return forward, lateral

    def _recover_resources(self, fighter: FighterState) -> None:
        active = (
            fighter.attack is not None
            or fighter.clinch_ticks > 0
            or fighter.clinch_startup_ticks > 0
            or fighter.stunned_ticks > 0
            or fighter.taunt_ticks > 0
        )
        base = 1 if active else max(1, fighter.fatigue // 25)
        regen = max(1, base * 3 // 4) if fighter.movement_load else base
        if fighter.defense in (DefensivePose.GUARD_HIGH, DefensivePose.GUARD_LOW):
            regen = regen * GUARD_STAMINA_REGEN_PERCENT // 100
        fighter.stamina = min(fighter.maximum_stamina, fighter.stamina + regen)
        guard_regen = max(1, fighter.fatigue // 30)
        if not active and fighter.defense is DefensivePose.NONE and self.tick % 2 == 0:
            fighter.guard = min(MAX_GUARD, fighter.guard + guard_regen)
        elif not active and self.tick % GUARD_HELD_REGEN_EVERY_TICKS == 0:
            # A held guard still comes back, slowly, between the punches it takes.
            fighter.guard = min(MAX_GUARD, fighter.guard + guard_regen)
        recovering = not active and self.tick % POISE_REGEN_EVERY_TICKS == 0
        fighter.poise = min(poise_ceiling(fighter.trauma.head), fighter.poise + int(recovering))

    @staticmethod
    def _ring_control(fighter: FighterState, opponent: FighterState) -> int:
        fighter_center = abs(fighter.x) + abs(fighter.y)
        opponent_center = abs(opponent.x) + abs(opponent.y)
        position = 1 if fighter_center + 30 < opponent_center else 0
        forward_motion = _symmetric_divide(
            fighter.velocity_x * fighter.facing_x + fighter.velocity_y * fighter.facing_y,
            FACING_SCALE,
        )
        effective_pressure = 1 if forward_motion > 1 and fighter.attack is None else 0
        return position + effective_pressure

    def _advance_bleeding(self, fighter: FighterState) -> None:
        if fighter.trauma.bleeding <= 0 or self.tick % TICKS_PER_SECOND:
            return
        fighter.trauma.head = min(1400, fighter.trauma.head + fighter.trauma.bleeding // 100)
        fighter.conditioning = max(0, fighter.conditioning - fighter.trauma.bleeding // 250)
        fighter.stamina = min(fighter.stamina, fighter.maximum_stamina)
        self._emit("bleed", fighter.player_id, amount=fighter.trauma.bleeding // 10, blood=25)
        opponent = self._other(fighter.player_id)
        if self._needs_doctor_stoppage(fighter):
            self._complete(opponent.player_id, FinishMethod.DOCTOR_STOPPAGE)

    def _needs_doctor_stoppage(self, fighter: FighterState) -> bool:
        return (
            max(fighter.trauma.left_cut, fighter.trauma.right_cut)
            >= self.config.doctor_cut_threshold
            or fighter.trauma.swelling >= self.config.doctor_swelling_threshold
        )

    def _qualifies_for_flash(
        self,
        attacker: FighterState,
        defender: FighterState,
        action: PunchAction,
        rule: PunchRule,
        counter: bool,
        blocked: bool,
    ) -> bool:
        return (
            self.config.flash_ko_enabled
            and action.target is Target.HEAD
            and action.power is Power.POWER
            and action.punch_class is not PunchClass.JAB
            and rule.impact >= 50
            and counter
            and not blocked
            and attacker.stamina >= 100
            and (defender.trauma.head >= 180 or defender.conditioning <= 760)
        )

    def _flash_chance(self, attacker: FighterState, defender: FighterState, damage: int) -> int:
        return min(
            180,
            8
            + damage
            + defender.trauma.head // 18
            + (MAX_CONDITIONING - defender.conditioning) // 8
            + max(0, attacker.stamina - 500) // 25,
        )

    def _knock_down(
        self,
        defender: FighterState,
        attacker: FighterState,
        *,
        detail: str = "",
        action_id: str | None = None,
    ) -> None:
        for fighter in (defender, attacker):
            fighter.body_collapse_ticks = 0
            fighter.body_collapse_action_id = None
        defender.knockdowns += 1
        attacker.performance.knockdowns += 1
        defender.poise = 0
        self._retain_action(defender)
        self._retain_action(attacker)
        defender.pending_actions.clear()
        attacker.pending_actions.clear()
        defender.clinch_startup_ticks = 0
        attacker.clinch_startup_ticks = 0
        defender.taunt_ticks = 0
        attacker.taunt_ticks = 0
        defender.defense = DefensivePose.NONE
        defender.get_up_meter = 0
        self._downed_id = defender.player_id
        self._knockdown_count_ticks = 0
        self._box_tick = None
        self._count_at_rise = 0
        self._neutral_corner = self._choose_neutral_corner(defender)
        self._paused_fight_ticks = self.phase_ticks_remaining
        self.phase = MatchPhase.KNOCKDOWN
        self.phase_ticks_remaining = 10 * COUNT_TICK_INTERVAL
        self._schedule_get_up_prompt(defender)
        self._emit(
            "knockdown",
            attacker.player_id,
            defender.player_id,
            amount=defender.knockdowns,
            detail=detail,
            action_id=action_id,
        )
        if defender.knockdowns >= 3:
            self._complete(attacker.player_id, FinishMethod.TKO)

    def _get_up_count(self) -> int:
        """The referee's count: on past the rise to the mandatory eight, then held there."""
        count = self._knockdown_count_ticks // COUNT_TICK_INTERVAL
        if self._box_tick is None:
            return count
        return max(self._count_at_rise, min(count, MANDATORY_COUNT))

    def _get_up_required(self, fighter: FighterState) -> int:
        return (
            GET_UP_BASE
            + fighter.knockdowns * GET_UP_PER_KNOCKDOWN
            + fighter.trauma.head // GET_UP_TRAUMA_DIVISOR
        )

    def _schedule_get_up_prompt(self, fighter: FighterState) -> None:
        fighter.get_up_prompt = (
            ActionKind.GET_UP_LEFT if self._rng.randrange(2) == 0 else ActionKind.GET_UP_RIGHT
        )
        fighter.get_up_window_start_tick = self.tick + GET_UP_WINDOW_START_OFFSET
        fighter.get_up_window_end_tick = self.tick + GET_UP_WINDOW_END_OFFSET
        fighter.get_up_prompt_resolved = False

    def _score_get_up_action(self, fighter: FighterState, action: MovementAction) -> None:
        if action.kind not in (ActionKind.GET_UP_LEFT, ActionKind.GET_UP_RIGHT):
            return
        if fighter.get_up_prompt_resolved:
            fighter.get_up_meter = max(0, fighter.get_up_meter - 1)
            self._emit("get_up_input", fighter.player_id, detail="spam")
            return
        fighter.get_up_prompt_resolved = True
        if action.kind is not fighter.get_up_prompt:
            fighter.get_up_meter = max(0, fighter.get_up_meter - 4)
            self._emit("get_up_input", fighter.player_id, detail="wrong")
            return
        if self.tick < fighter.get_up_window_start_tick:
            fighter.get_up_meter = max(0, fighter.get_up_meter - 3)
            self._emit("get_up_input", fighter.player_id, detail="early")
            return
        if self.tick > fighter.get_up_window_end_tick:
            fighter.get_up_meter = max(0, fighter.get_up_meter - 3)
            self._emit("get_up_input", fighter.player_id, detail="late")
            return
        center = (fighter.get_up_window_start_tick + fighter.get_up_window_end_tick) // 2
        timing_bonus = max(0, 4 - abs(self.tick - center))
        gain = max(8, 20 - fighter.knockdowns * 2) + timing_bonus
        fighter.get_up_meter += gain
        self._emit("get_up_input", fighter.player_id, amount=gain, detail="timed")

    def _advance_knockdown(self) -> None:
        if self._downed_id is None:
            raise RuntimeError("knockdown phase without a downed fighter")
        downed = self._fighters[self._downed_id]
        winner = self._other(self._downed_id)
        winner.pending_actions.clear()
        self._knockdown_count_ticks += 1
        self._walk_to_neutral_corner(winner, downed)
        count = self._knockdown_count_ticks // COUNT_TICK_INTERVAL
        new_second = self._knockdown_count_ticks % COUNT_TICK_INTERVAL == 0
        if self._box_tick is not None:
            # Up, and taking the mandatory count: the referee counts on to eight, looks him over
            # and only then tells them to box.
            downed.pending_actions.clear()
            if self.tick >= self._box_tick:
                self._box(downed, winner)
                return
            self.phase_ticks_remaining = self._box_tick - self.tick
            if new_second and self._count_at_rise < count <= MANDATORY_COUNT:
                self._emit("count", target_id=downed.player_id, amount=count)
            return
        self.phase_ticks_remaining -= 1
        while downed.pending_actions:
            action = downed.pending_actions.pop(0)
            if isinstance(action, MovementAction):
                self._score_get_up_action(downed, action)
        if self.tick > downed.get_up_window_end_tick:
            self._schedule_get_up_prompt(downed)
        required = self._get_up_required(downed)
        if self.phase_ticks_remaining <= 0:
            # Ten: the count is over, however full the meter got on its last tick.
            self._complete(winner.player_id, FinishMethod.KO)
        elif downed.get_up_meter >= required and count >= 1:
            downed.poise = min(poise_ceiling(downed.trauma.head), MAX_POISE // 2)
            downed.stamina = max(downed.stamina, min(downed.maximum_stamina, GET_UP_STAMINA))
            downed.get_up_prompt = None
            eight = self.tick + MANDATORY_COUNT * COUNT_TICK_INTERVAL - self._knockdown_count_ticks
            self._box_tick = max(eight, self.tick) + BOX_PAUSE_TICKS
            self._count_at_rise = count
            self.phase_ticks_remaining = self._box_tick - self.tick
            self._emit("get_up", downed.player_id, amount=count)
        elif new_second:
            self._emit("count", target_id=downed.player_id, amount=count)

    def _box(self, risen: FighterState, standing: FighterState) -> None:
        """The referee waves them on after the count: the bout resumes where the clock stopped."""
        risen.stunned_ticks = GET_UP_STUN_TICKS
        risen.stun_chain_ticks = 0
        self._separate_fighters(risen, standing)
        self.phase = MatchPhase.FIGHT
        self.phase_ticks_remaining = max(1, self._paused_fight_ticks)
        self._downed_id = None
        # The count stops where the referee left it rather than running on past ten.
        self._knockdown_count_ticks = self._get_up_count() * COUNT_TICK_INTERVAL
        self._box_tick = None
        self._count_at_rise = 0
        self._neutral_corner = None
        self._emit("box", target_id=risen.player_id)

    @staticmethod
    def _choose_neutral_corner(downed: FighterState) -> tuple[int, int]:
        """The neutral corner the referee sends the standing fighter to: of the two corners that are
        neither fighter's rest corner, the one farther from the man on the canvas."""
        return max(
            ((-REST_CORNER_OFFSET, REST_CORNER_OFFSET), (REST_CORNER_OFFSET, -REST_CORNER_OFFSET)),
            key=lambda corner: (corner[0] - downed.x) ** 2 + (corner[1] - downed.y) ** 2,
        )

    @staticmethod
    def _passes_clear(walker: FighterState, target: tuple[int, int], downed: FighterState) -> bool:
        """Whether the straight walk from `walker` to `target` keeps clear of the downed fighter."""
        path_x, path_y = target[0] - walker.x, target[1] - walker.y
        length_squared = path_x * path_x + path_y * path_y
        along = (downed.x - walker.x) * path_x + (downed.y - walker.y) * path_y
        if length_squared == 0 or along <= 0:
            return True
        along = min(along, length_squared)
        nearest_x = walker.x + _symmetric_divide(path_x * along, length_squared)
        nearest_y = walker.y + _symmetric_divide(path_y * along, length_squared)
        gap = (nearest_x - downed.x) ** 2 + (nearest_y - downed.y) ** 2
        return gap >= MINIMUM_SEPARATION * MINIMUM_SEPARATION

    def _walk_to_neutral_corner(self, winner: FighterState, downed: FighterState) -> None:
        if self._neutral_corner is None:
            self._neutral_corner = self._choose_neutral_corner(downed)
        target_x, target_y = self._neutral_corner
        dx = target_x - winner.x
        dy = target_y - winner.y
        distance = isqrt(dx * dx + dy * dy)
        if distance <= REFEREE_WALK_SPEED:
            winner.velocity_x = winner.velocity_y = 0
            winner.velocity_fixed_x = winner.velocity_fixed_y = 0
            winner.position_remainder_x = winner.position_remainder_y = 0
            self._update_facing(winner, downed)
            return
        if self._passes_clear(winner, self._neutral_corner, downed):
            step_x = _symmetric_divide(dx * FACING_SCALE, distance)
            step_y = _symmetric_divide(dy * FACING_SCALE, distance)
        else:
            # He is in the way: walk round him on the corner's side, easing out if too close.
            away_x, away_y = winner.x - downed.x, winner.y - downed.y
            gap = max(1, isqrt(away_x * away_x + away_y * away_y))
            round_x, round_y = -away_y, away_x
            if round_x * dx + round_y * dy < 0:
                round_x, round_y = away_y, -away_x
            if gap < MINIMUM_SEPARATION:
                round_x, round_y = round_x + away_x, round_y + away_y
            length = max(1, isqrt(round_x * round_x + round_y * round_y))
            step_x = _symmetric_divide(round_x * FACING_SCALE, length)
            step_y = _symmetric_divide(round_y * FACING_SCALE, length)
        winner.velocity_fixed_x = step_x * REFEREE_WALK_SPEED
        winner.velocity_fixed_y = step_y * REFEREE_WALK_SPEED
        winner.velocity_x = _rounded_fixed_velocity(winner.velocity_fixed_x)
        winner.velocity_y = _rounded_fixed_velocity(winner.velocity_fixed_y)
        delta_x, winner.position_remainder_x = _consume_fixed_position(
            winner.velocity_fixed_x, winner.position_remainder_x
        )
        delta_y, winner.position_remainder_y = _consume_fixed_position(
            winner.velocity_fixed_y, winner.position_remainder_y
        )
        winner.x += delta_x
        winner.y += delta_y
        self._clamp_to_ring(winner)
        self._update_facing(winner, downed)

    def _finish_round(self) -> None:
        one = self._fighters[self._player_ids[0]]
        two = self._fighters[self._player_ids[1]]
        for fighter in (one, two):
            # Saved by the bell: a body shot that has not yet put him down never will.
            fighter.body_collapse_ticks = 0
            fighter.body_collapse_action_id = None
        for profile in JUDGE_PROFILES:
            scores = score_round(one.performance, two.performance, profile)
            one_card, two_card = self._round_cards[profile.name]
            one_card.append(scores.player_one)
            two_card.append(scores.player_two)
        self._emit("bell", detail="round_end")
        if self.round_number >= self.config.rounds:
            self._finish_decision()
            return
        for fighter in self._fighters.values():
            # The bell ends whatever was held. Clients stop sending between rounds, so a walk or a
            # guard held at the bell would otherwise carry the fighter into the next round.
            fighter.held_input = InputCommand(0, 0)
        if self.config.rest_ticks == 0:
            self._start_next_round()
        else:
            self.phase = MatchPhase.REST
            self.phase_ticks_remaining = self.config.rest_ticks
            for fighter in self._fighters.values():
                fighter.attack = None
                fighter.pending_actions.clear()
                fighter.clinch_startup_ticks = 0
                fighter.clinch_ticks = 0
                fighter.stunned_ticks = 0
                fighter.stun_chain_ticks = 0
                fighter.stun_immune_until_tick = -1
                fighter.rocked_immune_until_tick = -1
                fighter.taunt_ticks = 0
                fighter.defense = DefensivePose.NONE
                fighter.corner_choice = None

    def _advance_rest(self) -> None:
        self.phase_ticks_remaining -= 1
        one = self._fighters[self._player_ids[0]]
        two = self._fighters[self._player_ids[1]]
        for fighter in (one, two):
            self._take_corner_instruction(fighter)
        self._walk_to_corner(one, -REST_CORNER_OFFSET, -REST_CORNER_OFFSET, two)
        self._walk_to_corner(two, REST_CORNER_OFFSET, REST_CORNER_OFFSET, one)
        self._separate_fighters(one, two)
        for fighter in self._fighters.values():
            fighter.stamina = min(fighter.maximum_stamina, fighter.stamina + 3)
            fighter.guard = min(MAX_GUARD, fighter.guard + 2)
            fighter.poise = min(poise_ceiling(fighter.trauma.head), fighter.poise + 2)
            if self.tick % TICKS_PER_SECOND == 0:
                fighter.trauma.bleeding = max(0, fighter.trauma.bleeding - 2)
        if self.phase_ticks_remaining <= 0:
            for fighter in (one, two):
                if fighter.corner_choice is None:
                    self._treat(fighter, CornerChoice.BALANCED)
            self._start_next_round()

    def _take_corner_instruction(self, fighter: FighterState) -> None:
        """The corner takes one instruction per rest; anything else pressed between rounds is dropped."""
        if not fighter.pending_actions:
            return
        actions = tuple(fighter.pending_actions)
        fighter.pending_actions.clear()
        fighter.pending_action_expires_tick = 0
        if fighter.corner_choice is not None:
            return
        for action in actions:
            choice = CORNER_INSTRUCTIONS.get(action.kind)
            if choice is not None:
                self._treat(fighter, choice)
                return

    def _treat(self, fighter: FighterState, choice: CornerChoice) -> None:
        treatment = CORNER_TREATMENTS[choice]
        trauma = fighter.trauma
        if trauma.left_cut >= trauma.right_cut:
            trauma.left_cut = max(0, trauma.left_cut - treatment.worse_cut)
            trauma.right_cut = max(0, trauma.right_cut - treatment.other_cut)
        else:
            trauma.right_cut = max(0, trauma.right_cut - treatment.worse_cut)
            trauma.left_cut = max(0, trauma.left_cut - treatment.other_cut)
        trauma.bleeding = trauma.bleeding * treatment.bleeding_kept_percent // 100
        trauma.swelling = max(0, trauma.swelling - treatment.swelling)
        trauma.left_eye = max(0, trauma.left_eye - treatment.eyes)
        trauma.right_eye = max(0, trauma.right_eye - treatment.eyes)
        fighter.conditioning = min(MAX_CONDITIONING, fighter.conditioning + treatment.conditioning)
        trauma.body = max(0, trauma.body - treatment.body)
        if treatment.refresh:
            fighter.stamina = fighter.maximum_stamina
            fighter.poise = poise_ceiling(fighter.trauma.head)
        fighter.corner_choice = choice
        self._emit("corner", fighter.player_id, detail=choice.value)

    def _walk_to_corner(
        self, fighter: FighterState, corner_x: int, corner_y: int, opponent: FighterState
    ) -> None:
        dx = corner_x - fighter.x
        dy = corner_y - fighter.y
        distance = isqrt(dx * dx + dy * dy)
        if distance <= REST_WALK_SPEED:
            fighter.x, fighter.y = corner_x, corner_y
            fighter.velocity_x = fighter.velocity_y = 0
            fighter.velocity_fixed_x = fighter.velocity_fixed_y = 0
            fighter.position_remainder_x = fighter.position_remainder_y = 0
            self._update_facing(fighter, opponent)
            return
        step_x = _symmetric_divide(dx * FACING_SCALE, distance)
        step_y = _symmetric_divide(dy * FACING_SCALE, distance)
        fighter.velocity_fixed_x = step_x * REST_WALK_SPEED
        fighter.velocity_fixed_y = step_y * REST_WALK_SPEED
        fighter.velocity_x = _rounded_fixed_velocity(fighter.velocity_fixed_x)
        fighter.velocity_y = _rounded_fixed_velocity(fighter.velocity_fixed_y)
        delta_x, fighter.position_remainder_x = _consume_fixed_position(
            fighter.velocity_fixed_x, fighter.position_remainder_x
        )
        delta_y, fighter.position_remainder_y = _consume_fixed_position(
            fighter.velocity_fixed_y, fighter.position_remainder_y
        )
        fighter.x += delta_x
        fighter.y += delta_y
        self._clamp_to_ring(fighter)
        fighter.facing_x, fighter.facing_y = step_x, step_y
        fighter.facing = 1 if fighter.facing_x >= 0 else -1

    def _start_next_round(self) -> None:
        self.round_number += 1
        for fighter in self._fighters.values():
            fighter.performance = RoundPerformance()
            fighter.attack = None
            fighter.pending_actions.clear()
            fighter.clinch_startup_ticks = 0
            fighter.stunned_ticks = 0
            fighter.stun_chain_ticks = 0
            fighter.stun_immune_until_tick = -1
            fighter.rocked_immune_until_tick = -1
            fighter.taunt_ticks = 0
            fighter.evasion_ticks = 0
            fighter.counter_ticks = 0
            fighter.combo_ticks = 0
            fighter.last_action_until_tick = -1
        self.phase = MatchPhase.FIGHT
        self.phase_ticks_remaining = self.config.round_ticks
        self._emit("bell", detail="round_start")

    def _finish_decision(self) -> None:
        cards = self._judge_cards()
        one_votes = sum(card.player_one_total > card.player_two_total for card in cards)
        two_votes = sum(card.player_two_total > card.player_one_total for card in cards)
        if one_votes > two_votes:
            self._complete(self._player_ids[0], FinishMethod.DECISION)
        elif two_votes > one_votes:
            self._complete(self._player_ids[1], FinishMethod.DECISION)
        else:
            self._complete(None, FinishMethod.DRAW)

    def build_forfeit_result(self, winner_id: str) -> MatchResult:
        if winner_id not in self._player_ids:
            raise ValueError("forfeit winner must be a player")
        return self._build_result(winner_id, FinishMethod.FORFEIT)

    def complete_forfeit(self, winner_id: str) -> MatchResult:
        if winner_id not in self._player_ids:
            raise ValueError("forfeit winner must be a player")
        self._complete(winner_id, FinishMethod.FORFEIT)
        assert self.result is not None
        return self.result

    def _complete(self, winner_id: str | None, method: FinishMethod) -> None:
        if self.result is not None:
            return
        self.phase = MatchPhase.COMPLETE
        self.phase_ticks_remaining = 0
        for fighter in self._fighters.values():
            fighter.poise = max(0, fighter.poise)
            fighter.stamina = min(fighter.stamina, fighter.maximum_stamina)
        self.result = self._build_result(winner_id, method)
        self._emit("result", winner_id, detail=method.value)

    def _build_result(self, winner_id: str | None, method: FinishMethod) -> MatchResult:
        one = self._fighters[self._player_ids[0]]
        two = self._fighters[self._player_ids[1]]
        return MatchResult(
            match_id=self.match_id,
            activity_instance_id=self.activity_instance_id,
            guild_id=self.guild_id,
            player_one_id=one.player_id,
            player_two_id=two.player_id,
            winner_id=winner_id,
            finish_method=method,
            round_number=self.round_number,
            tick=self.tick,
            scorecards=self._judge_cards(),
            player_one_knockdowns=one.knockdowns,
            player_two_knockdowns=two.knockdowns,
            player_one_damage=one.damage_dealt,
            player_two_damage=two.damage_dealt,
        )

    def _judge_cards(self) -> tuple[JudgeCard, ...]:
        return tuple(
            JudgeCard(
                profile.name,
                tuple(self._round_cards[profile.name][0]),
                tuple(self._round_cards[profile.name][1]),
            )
            for profile in JUDGE_PROFILES
        )

    def _other(self, player_id: str) -> FighterState:
        other_id = self._player_ids[1] if player_id == self._player_ids[0] else self._player_ids[0]
        return self._fighters[other_id]

    def _emit(
        self,
        kind: str,
        actor_id: str | None = None,
        target_id: str | None = None,
        amount: int = 0,
        detail: str = "",
        blood: int = 0,
        direction: int = 0,
        action_id: str | None = None,
    ) -> None:
        self._event_id += 1
        event = CombatEvent(
            event_id=self._event_id,
            tick=self.tick,
            kind=kind[:32],
            actor_id=actor_id,
            target_id=target_id,
            amount=max(-10_000, min(10_000, amount)),
            detail=detail[:96],
            blood=max(0, min(100, blood)),
            direction=max(-1, min(1, direction)),
            action_id=None if action_id is None else action_id[:32],
        )
        event_payload = json.dumps(
            _canonical(event), separators=(",", ":"), sort_keys=True
        ).encode()
        self._event_history_digest = hashlib.sha256(
            self._event_history_digest + event_payload
        ).digest()
        self._events.append(event)
        self._tick_events.append(event)

    def snapshot(self) -> EngineSnapshot:
        fighters = tuple(
            self._fighter_snapshot(self._fighters[player]) for player in self._player_ids
        )
        assert len(fighters) == 2
        typed_fighters = (fighters[0], fighters[1])
        checksum = self._checksum(typed_fighters)
        return EngineSnapshot(
            tick=self.tick,
            phase=self.phase,
            round_number=self.round_number,
            phase_ticks_remaining=self.phase_ticks_remaining,
            fighters=typed_fighters,
            events=tuple(self._tick_events),
            result=self.result,
            checksum=checksum,
        )

    def _fighter_snapshot(self, fighter: FighterState) -> FighterSnapshot:
        trauma = fighter.trauma
        attack = fighter.attack
        retained = attack is None and self.tick <= fighter.last_action_until_tick
        if attack is not None:
            action_id: str | None = self._action_id(fighter, attack)
            action_key: str | None = self._action_key(attack.action)
            action_start_tick = attack.start_tick
            action_startup_ticks = attack.rule.startup
            action_active_ticks = attack.rule.active
            action_recovery_ticks = attack.rule.recovery
            action_contact_tick: int | None = attack.contact_tick if attack.resolved else None
            action_class: PunchClass | None = attack.action.punch_class
            action_hand: Hand | None = attack.action.hand
            action_target: Target | None = attack.action.target
            action_power: Power | None = attack.action.power
        elif retained:
            action_id = fighter.last_action_id
            action_key = fighter.last_action_key
            action_start_tick = fighter.last_action_start_tick
            action_startup_ticks = fighter.last_action_startup_ticks
            action_active_ticks = fighter.last_action_active_ticks
            action_recovery_ticks = fighter.last_action_recovery_ticks
            action_contact_tick = fighter.last_action_contact_tick or None
            parts = fighter.last_action_key.split(":")
            action_class = PunchClass(parts[0]) if len(parts) == 4 else None
            action_hand = Hand(parts[1]) if len(parts) == 4 else None
            action_target = Target(parts[2]) if len(parts) == 4 else None
            action_power = Power(parts[3]) if len(parts) == 4 else None
        else:
            action_id = None
            action_key = None
            action_start_tick = 0
            action_startup_ticks = 0
            action_active_ticks = 0
            action_recovery_ticks = 0
            action_contact_tick = None
            action_class = None
            action_hand = None
            action_target = None
            action_power = None
        return FighterSnapshot(
            player_id=fighter.player_id,
            x=fighter.x,
            y=fighter.y,
            facing=fighter.facing,
            facing_x=fighter.facing_x,
            facing_y=fighter.facing_y,
            velocity_x=fighter.velocity_x,
            velocity_y=fighter.velocity_y,
            stance=fighter.stance,
            style=fighter.style,
            defense=fighter.defense,
            stamina=fighter.stamina,
            maximum_stamina=fighter.maximum_stamina,
            conditioning=fighter.conditioning,
            guard=fighter.guard,
            poise=fighter.poise,
            trauma=TraumaSnapshot(
                head=trauma.head,
                body=trauma.body,
                left_eye=trauma.left_eye,
                right_eye=trauma.right_eye,
                left_cut=trauma.left_cut,
                right_cut=trauma.right_cut,
                swelling=trauma.swelling,
                bleeding=trauma.bleeding,
            ),
            knockdowns=fighter.knockdowns,
            warnings=fighter.warnings,
            deductions=fighter.deductions,
            stunned_ticks=fighter.stunned_ticks,
            is_downed=fighter.player_id == self._downed_id and self._box_tick is None,
            action=action_class,
            action_hand=action_hand,
            action_target=action_target,
            action_power=action_power,
            action_id=action_id,
            action_key=action_key,
            action_start_tick=action_start_tick,
            action_startup_ticks=action_startup_ticks,
            action_active_ticks=action_active_ticks,
            action_recovery_ticks=action_recovery_ticks,
            action_contact_tick=action_contact_tick,
            queued_actions=len(fighter.pending_actions),
            clinch_startup_ticks=fighter.clinch_startup_ticks,
            clinch_ticks=fighter.clinch_ticks,
            is_foul_recovery_target=fighter.player_id == self._foul_recovery_target,
            taunt_ticks=fighter.taunt_ticks,
            corner_choice=fighter.corner_choice,
            get_up_prompt=fighter.get_up_prompt,
            get_up_meter=fighter.get_up_meter,
            get_up_required=self._get_up_required(fighter),
            get_up_count=self._get_up_count(),
            get_up_window_start_tick=fighter.get_up_window_start_tick,
            get_up_window_end_tick=fighter.get_up_window_end_tick,
            last_input_sequence=fighter.last_sequence,
        )

    def _checksum(self, _fighters: tuple[FighterSnapshot, FighterSnapshot]) -> str:
        fighter_states = []
        for player_id in self._player_ids:
            fighter = self._fighters[player_id]
            fighter_states.append(
                {
                    "player_id": fighter.player_id,
                    "position": [fighter.x, fighter.y],
                    "facing": [fighter.facing, fighter.facing_x, fighter.facing_y],
                    "velocity": [fighter.velocity_x, fighter.velocity_y],
                    "movement_fixed": [
                        fighter.velocity_fixed_x,
                        fighter.velocity_fixed_y,
                        fighter.position_remainder_x,
                        fighter.position_remainder_y,
                    ],
                    "stance": fighter.stance,
                    "style": fighter.style,
                    "resources": [
                        fighter.stamina,
                        fighter.conditioning,
                        fighter.guard,
                        fighter.poise,
                    ],
                    "trauma": fighter.trauma,
                    "defense": fighter.defense,
                    "defense_started_tick": fighter.defense_started_tick,
                    "guard_timing": [fighter.guard_held_tick, fighter.guard_raised_tick],
                    "timers": [
                        fighter.evasion_ticks,
                        fighter.stunned_ticks,
                        fighter.stunned_at_tick,
                        fighter.counter_ticks,
                        fighter.clinch_startup_ticks,
                        fighter.clinch_ticks,
                        fighter.combo_ticks,
                        fighter.taunt_ticks,
                        fighter.last_action_until_tick,
                        fighter.stun_chain_ticks,
                        fighter.stun_immune_until_tick,
                        fighter.rocked_immune_until_tick,
                    ],
                    "attack": fighter.attack,
                    "last_punch": fighter.last_punch,
                    "knockdowns": fighter.knockdowns,
                    "warnings": fighter.warnings,
                    "deductions": fighter.deductions,
                    "get_up": [
                        fighter.get_up_meter,
                        fighter.get_up_prompt,
                        fighter.get_up_window_start_tick,
                        fighter.get_up_window_end_tick,
                        fighter.get_up_prompt_resolved,
                    ],
                    "last_action": [
                        fighter.last_action_id,
                        fighter.last_action_key,
                        fighter.last_action_start_tick,
                        fighter.last_action_startup_ticks,
                        fighter.last_action_active_ticks,
                        fighter.last_action_recovery_ticks,
                        fighter.last_action_contact_tick,
                    ],
                    "last_sequence": fighter.last_sequence,
                    "held_input": fighter.held_input,
                    "pending_actions": fighter.pending_actions,
                    "pending_action_expires_tick": (
                        fighter.pending_action_expires_tick if fighter.pending_actions else 0
                    ),
                    "performance": fighter.performance,
                    "damage_dealt": fighter.damage_dealt,
                    "movement_load": fighter.movement_load,
                    "corner": fighter.corner_choice,
                    "body_collapse": [
                        fighter.body_collapse_ticks,
                        fighter.body_collapse_action_id,
                        fighter.body_collapse_at_tick,
                    ],
                }
            )
        state = _canonical(
            {
                "match": [
                    self.match_id,
                    self.activity_instance_id,
                    self.guild_id,
                    self.seed,
                    self.config,
                ],
                "tick": self.tick,
                "phase": self.phase,
                "round": self.round_number,
                "remaining": self.phase_ticks_remaining,
                "fighters": fighter_states,
                "round_cards": self._round_cards,
                "downed_id": self._downed_id,
                "knockdown_count_ticks": self._knockdown_count_ticks,
                "neutral_corner": self._neutral_corner,
                "box_tick": self._box_tick,
                "count_at_rise": self._count_at_rise,
                "foul_recovery_target": self._foul_recovery_target,
                "paused_fight_ticks": self._paused_fight_ticks,
                "event_id": self._event_id,
                "event_history_digest": self._event_history_digest.hex(),
                "tick_events": self._tick_events,
                "result": self.result,
                "rng_state": self._rng.getstate(),
            }
        )
        return hashlib.sha256(
            json.dumps(state, separators=(",", ":"), sort_keys=True).encode()
        ).hexdigest()
