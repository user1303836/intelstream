from __future__ import annotations

import hashlib
import json
import random
from dataclasses import asdict, dataclass, field, is_dataclass
from enum import Enum
from math import isqrt
from typing import Final

from intelstream.hands.rules import (
    COMPATIBLE_COMBO_CHAINS,
    COUNTDOWN_TICKS,
    DEFAULT_ROUNDS,
    FIGHTER_RADIUS,
    JUDGE_PROFILES,
    MAX_CONDITIONING,
    MAX_GUARD,
    MAX_POISE,
    MAX_STAMINA,
    MINIMUM_SEPARATION,
    PUNCH_RULES,
    REST_TICKS,
    RING_HALF_HEIGHT,
    RING_HALF_WIDTH,
    ROUND_TICKS,
    TICKS_PER_SECOND,
    JudgeProfile,
    PunchRule,
    fatigue_factor,
    fatigue_max_stamina,
)
from intelstream.hands.types import (
    ActionKind,
    CombatEvent,
    DefensivePose,
    EngineSnapshot,
    FighterSnapshot,
    FinishMethod,
    FoulAction,
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


@dataclass(frozen=True, slots=True)
class EngineConfig:
    rounds: int = DEFAULT_ROUNDS
    round_ticks: int = ROUND_TICKS
    rest_ticks: int = REST_TICKS
    countdown_ticks: int = COUNTDOWN_TICKS
    doctor_cut_threshold: int = 700
    doctor_swelling_threshold: int = 820
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
    combo_bonus: int = 0

    @property
    def total_ticks(self) -> int:
        return self.rule.startup + self.rule.active + self.rule.recovery


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
    evasion_ticks: int = 0
    stunned_ticks: int = 0
    stunned_at_tick: int = -1
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
    performance: RoundPerformance = field(default_factory=RoundPerformance)
    damage_dealt: int = 0
    movement_load: int = 0

    @property
    def maximum_stamina(self) -> int:
        return fatigue_max_stamina(self.conditioning, self.trauma.body)

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


def _consume_fixed_position(velocity: int, remainder: int) -> tuple[int, int]:
    total = velocity + remainder
    delta = _symmetric_divide(total, MOVEMENT_FIXED_SCALE)
    return delta, total - delta * MOVEMENT_FIXED_SCALE


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
            player_one_id: FighterState(player_one_id, -180, 0, 1, Stance.ORTHODOX),
            player_two_id: FighterState(player_two_id, 180, 0, -1, Stance.ORTHODOX),
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
        self._update_facing(one, two)
        self._update_facing(two, one)

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

        attack = fighter.attack
        imminent_trade = (
            fighter.stunned_at_tick == self.tick
            and attack is not None
            and self._attack_lands_next_tick(attack)
        )
        if fighter.stunned_ticks > 0:
            fighter.stunned_ticks -= 1
            fighter.defense = DefensivePose.NONE
            fighter.clinch_startup_ticks = 0
            fighter.pending_actions.clear()
            if not imminent_trade:
                fighter.attack = None
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
            fighter.defense = fighter.held_input.defense

        if fighter.pending_actions and self.tick > fighter.pending_action_expires_tick:
            fighter.pending_actions.clear()
            fighter.pending_action_expires_tick = 0

        attack = fighter.attack
        if attack is not None:
            attack.age += 1
            active_start = attack.rule.startup
            active_end = active_start + attack.rule.active
            if active_start <= attack.age < active_end and not attack.resolved:
                attack.resolved = True
                self._resolve_punch(fighter, opponent, attack)
            if fighter.stunned_ticks > 0 or attack.age >= attack.total_ticks:
                fighter.attack = None
            return

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

    def _start_punch(self, fighter: FighterState, action: PunchAction) -> bool:
        base_rule = PUNCH_RULES[(action.punch_class, action.target, action.power)]
        cost = base_rule.stamina_cost
        lead_hand = "left" if fighter.stance is Stance.ORTHODOX else "right"
        hand_speed_bonus = (
            1 if action.hand.value == lead_hand and action.punch_class is PunchClass.JAB else 0
        )
        rear_power_bonus = (
            8 if action.hand.value != lead_hand and action.punch_class is PunchClass.STRAIGHT else 0
        )
        if fighter.stamina < cost:
            self._emit("exhausted", fighter.player_id)
            return False
        combo_bonus = 0
        if (
            fighter.combo_ticks > 0
            and fighter.last_punch is not None
            and (fighter.last_punch.punch_class, action.punch_class) in COMPATIBLE_COMBO_CHAINS
        ):
            combo_bonus = 10
            cost = max(1, cost * 90 // 100)
        fighter.stamina -= cost
        fighter.conditioning = max(0, fighter.conditioning - max(1, cost // 12))
        speed = fighter.fatigue
        startup = max(2, base_rule.startup * 100 // speed - hand_speed_bonus)
        recovery = max(4, base_rule.recovery * 100 // speed)
        rule = PunchRule(
            startup=startup,
            active=base_rule.active,
            recovery=recovery,
            reach=base_rule.reach,
            lateral_arc=base_rule.lateral_arc,
            impact=base_rule.impact + rear_power_bonus,
            stamina_cost=base_rule.stamina_cost,
            whiff_cost=base_rule.whiff_cost,
            guard_damage=base_rule.guard_damage,
            poise_damage=base_rule.poise_damage,
            combo_window=base_rule.combo_window,
            startup_vulnerability=base_rule.startup_vulnerability,
            recovery_vulnerability=base_rule.recovery_vulnerability,
        )
        fighter.attack = AttackState(action, rule, combo_bonus=combo_bonus)
        fighter.last_punch = action
        fighter.combo_ticks = rule.startup + rule.active + rule.recovery + rule.combo_window
        self._emit(
            "punch_start",
            fighter.player_id,
            detail=f"{action.hand.value}:{action.punch_class.value}:{action.target.value}",
        )
        return True

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
        forward_distance = dx * attacker.facing
        in_front = forward_distance > FIGHTER_RADIUS // 3
        if (
            not in_front
            or forward_distance > effective_reach
            or distance_squared > effective_reach**2
            or abs(dy) > effective_arc
        ):
            attacker.stamina = max(0, attacker.stamina - rule.whiff_cost)
            attacker.conditioning = max(0, attacker.conditioning - max(2, rule.whiff_cost // 10))
            self._emit("whiff", attacker.player_id, defender.player_id, amount=rule.whiff_cost)
            return

        if self._evades(defender, action, distance_squared, rule.reach, abs(dy)):
            defender.performance.evasions += 1
            defender.counter_ticks = COUNTER_WINDOW_TICKS
            self._emit(
                "evade", defender.player_id, attacker.player_id, detail=defender.defense.value
            )
            return

        guarding = (
            action.target is Target.HEAD and defender.defense is DefensivePose.GUARD_HIGH
        ) or (action.target is Target.BODY and defender.defense is DefensivePose.GUARD_LOW)
        perfect = guarding and self.tick - defender.defense_started_tick <= PERFECT_BLOCK_TICKS
        counter = attacker.counter_ticks > 0 or self._counter_vulnerable(defender.attack)
        fatigue = attacker.fatigue
        counter_multiplier = 128 if counter else 100
        impact = (
            rule.impact * counter_multiplier * fatigue * (100 + attack.combo_bonus) // 1_000_000
        )
        impact = max(1, impact)

        if guarding and defender.guard > 0:
            guard_damage = rule.guard_damage
            if perfect:
                guard_damage //= 3
                impact //= 8
                defender.counter_ticks = COUNTER_WINDOW_TICKS
                self._emit("perfect_block", defender.player_id, attacker.player_id)
            else:
                guard_leak = max(
                    18,
                    100 - defender.guard // 12 + (100 - defender.fatigue) // 2,
                )
                impact = impact * guard_leak // 100
                self._emit("block", defender.player_id, attacker.player_id, amount=guard_damage)
            defender.guard = max(0, defender.guard - guard_damage)
            defender.performance.blocked_hits += 1
            if defender.guard == 0:
                defender.stunned_ticks = max(defender.stunned_ticks, 8)
                defender.stunned_at_tick = self.tick
                defender.taunt_ticks = 0
                self._emit("guard_break", attacker.player_id, defender.player_id)
        else:
            attacker.performance.clean_hits += 1

        damage = max(1, impact)
        poise_damage = rule.poise_damage * counter_multiplier // 100
        if action.target is Target.HEAD:
            self._apply_head_damage(defender, action, damage)
        else:
            defender.trauma.body = min(1200, defender.trauma.body + damage * 2)
            defender.conditioning = max(0, defender.conditioning - damage)
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
        )

        if self._qualifies_for_flash(attacker, defender, action, rule, counter, guarding):
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
        if defender.poise <= 0 or (
            action.target is Target.HEAD and defender.trauma.head > 850 and damage >= 40
        ):
            self._knock_down(defender, attacker)
        elif action.target is Target.HEAD and damage >= 36:
            defender.stunned_ticks = min(90, 8 + damage // 2)
            defender.stunned_at_tick = self.tick
            defender.taunt_ticks = 0
            self._emit("stun", attacker.player_id, defender.player_id, amount=damage)

    def _apply_head_damage(self, defender: FighterState, action: PunchAction, damage: int) -> None:
        defender.trauma.head = min(1400, defender.trauma.head + damage * 2)
        eye_damage = damage * (2 if action.punch_class is PunchClass.HOOK else 1)
        if action.hand.value == "left":
            defender.trauma.right_eye = min(1000, defender.trauma.right_eye + eye_damage)
            if defender.trauma.right_eye > 260:
                defender.trauma.right_cut = min(1000, defender.trauma.right_cut + damage)
        else:
            defender.trauma.left_eye = min(1000, defender.trauma.left_eye + eye_damage)
            if defender.trauma.left_eye > 260:
                defender.trauma.left_cut = min(1000, defender.trauma.left_cut + damage)
        defender.trauma.swelling = min(1000, defender.trauma.swelling + damage // 2)
        defender.trauma.bleeding = min(
            1000,
            defender.trauma.bleeding
            + (defender.trauma.left_cut + defender.trauma.right_cut + 49) // 50,
        )

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
            fighter.evasion_ticks = EVASION_TICKS
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
        fighter.attack = None
        opponent.attack = None
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
        self._emit("foul", fighter.player_id, opponent.player_id, detail=action.foul.value)
        if fighter.warnings == 2:
            fighter.deductions += 1
            fighter.performance.deductions = fighter.deductions
            self._emit("point_deduction", fighter.player_id, amount=1)
        elif fighter.warnings >= 3:
            self._complete(opponent.player_id, FinishMethod.DISQUALIFICATION)
            return
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
        if remaining == 0:
            one.x -= one.facing * 45
            two.x -= two.facing * 45
            self._clamp_to_ring(one)
            self._clamp_to_ring(two)
            self._separate_fighters(one, two)
            self._emit("referee_break", one.player_id, two.player_id)

    def _move_fighter(self, fighter: FighterState, opponent: FighterState) -> None:
        move_x = fighter.held_input.move_x
        move_y = fighter.held_input.move_y
        speed = max(2, 7 * fighter.fatigue // 100)
        if fighter.defense in (DefensivePose.GUARD_HIGH, DefensivePose.GUARD_LOW):
            speed = max(2, speed * 70 // 100)
        if (
            fighter.attack is not None
            or fighter.evasion_ticks > 0
            or fighter.clinch_startup_ticks > 0
            or fighter.taunt_ticks > 0
        ):
            move_x = 0
            move_y = 0
        move_x, move_y = _normalize_move_vector(move_x, move_y)
        desired_fixed_x = move_x * speed
        desired_fixed_y = move_y * speed
        fighter.velocity_fixed_x = _blend_velocity(fighter.velocity_fixed_x, desired_fixed_x)
        fighter.velocity_fixed_y = _blend_velocity(fighter.velocity_fixed_y, desired_fixed_y)
        fixed_cap = speed * MOVEMENT_FIXED_SCALE
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
        fighter.velocity_x = _rounded_fixed_velocity(fighter.velocity_fixed_x)
        fighter.velocity_y = _rounded_fixed_velocity(fighter.velocity_fixed_y)
        while (
            fighter.velocity_x * fighter.velocity_x + fighter.velocity_y * fighter.velocity_y
            > speed * speed
        ):
            if abs(fighter.velocity_x) >= abs(fighter.velocity_y):
                fighter.velocity_x -= 1 if fighter.velocity_x > 0 else -1
            else:
                fighter.velocity_y -= 1 if fighter.velocity_y > 0 else -1
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
            input_magnitude_squared > 500**2 or velocity_magnitude_squared > (500 * speed) ** 2
        )
        movement_load = 2 if above_half_speed else int(moving)
        fighter.movement_load = movement_load
        self._update_facing(fighter, opponent)

    @staticmethod
    def _clamp_to_ring(fighter: FighterState) -> None:
        minimum_x = -RING_HALF_WIDTH + FIGHTER_RADIUS
        maximum_x = RING_HALF_WIDTH - FIGHTER_RADIUS
        minimum_y = -RING_HALF_HEIGHT + FIGHTER_RADIUS
        maximum_y = RING_HALF_HEIGHT - FIGHTER_RADIUS
        clamped_x = min(maximum_x, max(minimum_x, fighter.x))
        clamped_y = min(maximum_y, max(minimum_y, fighter.y))
        if clamped_x != fighter.x:
            fighter.velocity_x = 0
            fighter.velocity_fixed_x = 0
            fighter.position_remainder_x = 0
        if clamped_y != fighter.y:
            fighter.velocity_y = 0
            fighter.velocity_fixed_y = 0
            fighter.position_remainder_y = 0
        fighter.x = clamped_x
        fighter.y = clamped_y

    def _separate_fighters(self, one: FighterState, two: FighterState) -> None:
        dx = two.x - one.x
        dy = two.y - one.y
        if dx * dx + dy * dy >= MINIMUM_SEPARATION**2:
            return
        if abs(dx) >= abs(dy):
            direction = 1 if dx > 0 or (dx == 0 and one.player_id < two.player_id) else -1
            center = (one.x + two.x) // 2
            one.x = center - direction * (MINIMUM_SEPARATION // 2)
            two.x = center + direction * (MINIMUM_SEPARATION // 2)
            minimum = -RING_HALF_WIDTH + FIGHTER_RADIUS
            maximum = RING_HALF_WIDTH - FIGHTER_RADIUS
            shift = max(0, minimum - min(one.x, two.x)) - max(0, max(one.x, two.x) - maximum)
            one.x += shift
            two.x += shift
        else:
            direction = 1 if dy > 0 or (dy == 0 and one.player_id < two.player_id) else -1
            center = (one.y + two.y) // 2
            one.y = center - direction * (MINIMUM_SEPARATION // 2)
            two.y = center + direction * (MINIMUM_SEPARATION // 2)
            minimum = -RING_HALF_HEIGHT + FIGHTER_RADIUS
            maximum = RING_HALF_HEIGHT - FIGHTER_RADIUS
            shift = max(0, minimum - min(one.y, two.y)) - max(0, max(one.y, two.y) - maximum)
            one.y += shift
            two.y += shift
        self._clamp_to_ring(one)
        self._clamp_to_ring(two)

    def _update_facing(self, fighter: FighterState, opponent: FighterState) -> None:
        if fighter.attack is None and fighter.clinch_startup_ticks == 0:
            fighter.facing = 1 if opponent.x >= fighter.x else -1

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
            regen //= 2
        fighter.stamina = min(fighter.maximum_stamina, fighter.stamina + regen)
        if not active and fighter.defense is DefensivePose.NONE and self.tick % 2 == 0:
            guard_regen = max(1, fighter.fatigue // 30)
            fighter.guard = min(MAX_GUARD, fighter.guard + guard_regen)
        fighter.poise = min(MAX_POISE, fighter.poise + (1 if not active else 0))

    @staticmethod
    def _ring_control(fighter: FighterState, opponent: FighterState) -> int:
        fighter_center = abs(fighter.x) + abs(fighter.y)
        opponent_center = abs(opponent.x) + abs(opponent.y)
        position = 1 if fighter_center + 30 < opponent_center else 0
        forward_motion = fighter.velocity_x * fighter.facing
        effective_pressure = 1 if forward_motion > 1 and fighter.attack is None else 0
        return position + effective_pressure

    def _advance_bleeding(self, fighter: FighterState) -> None:
        if fighter.trauma.bleeding <= 0 or self.tick % TICKS_PER_SECOND:
            return
        fighter.trauma.head = min(1400, fighter.trauma.head + fighter.trauma.bleeding // 100)
        fighter.conditioning = max(0, fighter.conditioning - fighter.trauma.bleeding // 250)
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
        guarding: bool,
    ) -> bool:
        return (
            self.config.flash_ko_enabled
            and action.target is Target.HEAD
            and action.power is Power.POWER
            and action.punch_class is not PunchClass.JAB
            and rule.impact >= 50
            and counter
            and not guarding
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

    def _knock_down(self, defender: FighterState, attacker: FighterState) -> None:
        defender.knockdowns += 1
        attacker.performance.knockdowns += 1
        defender.poise = 0
        defender.attack = None
        attacker.attack = None
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
        self._paused_fight_ticks = self.phase_ticks_remaining
        self.phase = MatchPhase.KNOCKDOWN
        self.phase_ticks_remaining = 10 * COUNT_TICK_INTERVAL
        self._schedule_get_up_prompt(defender)
        self._emit("knockdown", attacker.player_id, defender.player_id, amount=defender.knockdowns)
        if defender.knockdowns >= 3:
            self._complete(attacker.player_id, FinishMethod.TKO)

    def _get_up_required(self, fighter: FighterState) -> int:
        return 34 + fighter.knockdowns * 16 + fighter.trauma.head // 28

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
        self.phase_ticks_remaining -= 1
        self._knockdown_count_ticks += 1
        while downed.pending_actions:
            action = downed.pending_actions.pop(0)
            if isinstance(action, MovementAction):
                self._score_get_up_action(downed, action)
        if self.tick > downed.get_up_window_end_tick:
            self._schedule_get_up_prompt(downed)
        required = self._get_up_required(downed)
        count = self._knockdown_count_ticks // COUNT_TICK_INTERVAL
        if downed.get_up_meter >= required and count >= 1:
            downed.poise = MAX_POISE // 2
            downed.stamina = min(downed.maximum_stamina, 350)
            downed.stunned_ticks = 20
            downed.x = -140 if downed.facing == 1 else 140
            self._clamp_to_ring(downed)
            self.phase = MatchPhase.FIGHT
            self.phase_ticks_remaining = max(1, self._paused_fight_ticks)
            self._downed_id = None
            downed.get_up_prompt = None
            self._emit("get_up", downed.player_id, amount=count)
        elif self.phase_ticks_remaining <= 0:
            self._complete(winner.player_id, FinishMethod.KO)
        elif self._knockdown_count_ticks % COUNT_TICK_INTERVAL == 0:
            self._emit("count", target_id=downed.player_id, amount=count)

    def _finish_round(self) -> None:
        one = self._fighters[self._player_ids[0]]
        two = self._fighters[self._player_ids[1]]
        for profile in JUDGE_PROFILES:
            scores = score_round(one.performance, two.performance, profile)
            one_card, two_card = self._round_cards[profile.name]
            one_card.append(scores.player_one)
            two_card.append(scores.player_two)
        self._emit("bell", detail="round_end")
        if self.round_number >= self.config.rounds:
            self._finish_decision()
            return
        if self.config.rest_ticks == 0:
            self._start_next_round()
        else:
            self.phase = MatchPhase.REST
            self.phase_ticks_remaining = self.config.rest_ticks

    def _advance_rest(self) -> None:
        self.phase_ticks_remaining -= 1
        for fighter in self._fighters.values():
            fighter.stamina = min(fighter.maximum_stamina, fighter.stamina + 3)
            fighter.guard = min(MAX_GUARD, fighter.guard + 2)
            fighter.poise = min(MAX_POISE, fighter.poise + 2)
            if self.tick % TICKS_PER_SECOND == 0:
                fighter.trauma.bleeding = max(0, fighter.trauma.bleeding - 2)
        if self.phase_ticks_remaining <= 0:
            self._start_next_round()

    def _start_next_round(self) -> None:
        self.round_number += 1
        for fighter in self._fighters.values():
            fighter.performance = RoundPerformance()
            fighter.attack = None
            fighter.pending_actions.clear()
            fighter.clinch_startup_ticks = 0
            fighter.stunned_ticks = 0
            fighter.taunt_ticks = 0
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
        return FighterSnapshot(
            player_id=fighter.player_id,
            x=fighter.x,
            y=fighter.y,
            facing=fighter.facing,
            velocity_x=fighter.velocity_x,
            velocity_y=fighter.velocity_y,
            stance=fighter.stance,
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
            is_downed=fighter.player_id == self._downed_id,
            action=fighter.attack.action.punch_class if fighter.attack else None,
            action_hand=fighter.attack.action.hand if fighter.attack else None,
            action_target=fighter.attack.action.target if fighter.attack else None,
            action_power=fighter.attack.action.power if fighter.attack else None,
            queued_actions=len(fighter.pending_actions),
            clinch_startup_ticks=fighter.clinch_startup_ticks,
            clinch_ticks=fighter.clinch_ticks,
            is_foul_recovery_target=fighter.player_id == self._foul_recovery_target,
            taunt_ticks=fighter.taunt_ticks,
            get_up_prompt=fighter.get_up_prompt,
            get_up_meter=fighter.get_up_meter,
            get_up_required=self._get_up_required(fighter),
            get_up_count=self._knockdown_count_ticks // COUNT_TICK_INTERVAL,
            get_up_window_start_tick=fighter.get_up_window_start_tick,
            get_up_window_end_tick=fighter.get_up_window_end_tick,
        )

    def _checksum(self, _fighters: tuple[FighterSnapshot, FighterSnapshot]) -> str:
        fighter_states = []
        for player_id in self._player_ids:
            fighter = self._fighters[player_id]
            fighter_states.append(
                {
                    "player_id": fighter.player_id,
                    "position": [fighter.x, fighter.y],
                    "facing": fighter.facing,
                    "velocity": [fighter.velocity_x, fighter.velocity_y],
                    "movement_fixed": [
                        fighter.velocity_fixed_x,
                        fighter.velocity_fixed_y,
                        fighter.position_remainder_x,
                        fighter.position_remainder_y,
                    ],
                    "stance": fighter.stance,
                    "resources": [
                        fighter.stamina,
                        fighter.conditioning,
                        fighter.guard,
                        fighter.poise,
                    ],
                    "trauma": fighter.trauma,
                    "defense": fighter.defense,
                    "defense_started_tick": fighter.defense_started_tick,
                    "timers": [
                        fighter.evasion_ticks,
                        fighter.stunned_ticks,
                        fighter.stunned_at_tick,
                        fighter.counter_ticks,
                        fighter.clinch_startup_ticks,
                        fighter.clinch_ticks,
                        fighter.combo_ticks,
                        fighter.taunt_ticks,
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
                    "last_sequence": fighter.last_sequence,
                    "held_input": fighter.held_input,
                    "pending_actions": fighter.pending_actions,
                    "pending_action_expires_tick": (
                        fighter.pending_action_expires_tick if fighter.pending_actions else 0
                    ),
                    "performance": fighter.performance,
                    "damage_dealt": fighter.damage_dealt,
                    "movement_load": fighter.movement_load,
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
