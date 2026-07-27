from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


class Hand(StrEnum):
    LEFT = "left"
    RIGHT = "right"


class PunchClass(StrEnum):
    JAB = "jab"
    STRAIGHT = "straight"
    HOOK = "hook"
    UPPERCUT = "uppercut"


class Target(StrEnum):
    HEAD = "head"
    BODY = "body"


class Power(StrEnum):
    NORMAL = "normal"
    POWER = "power"


class Stance(StrEnum):
    ORTHODOX = "orthodox"
    SOUTHPAW = "southpaw"


class DefensivePose(StrEnum):
    NONE = "none"
    GUARD_HIGH = "guard_high"
    GUARD_LOW = "guard_low"
    SLIP_LEFT = "slip_left"
    SLIP_RIGHT = "slip_right"
    WEAVE = "weave"
    PULL = "pull"


class Foul(StrEnum):
    LOW_BLOW = "low_blow"
    HEADBUTT = "headbutt"


class ActionKind(StrEnum):
    PUNCH = "punch"
    SLIP_LEFT = "slip_left"
    SLIP_RIGHT = "slip_right"
    WEAVE = "weave"
    PULL = "pull"
    CLINCH = "clinch"
    SWITCH_STANCE = "switch_stance"
    FOUL = "foul"
    GET_UP_LEFT = "get_up_left"
    GET_UP_RIGHT = "get_up_right"


class MatchPhase(StrEnum):
    COUNTDOWN = "countdown"
    FIGHT = "fight"
    KNOCKDOWN = "knockdown"
    FOUL_RECOVERY = "foul_recovery"
    REST = "rest"
    COMPLETE = "complete"


class FinishMethod(StrEnum):
    KO = "ko"
    FLASH_KO = "flash_ko"
    TKO = "tko"
    DOCTOR_STOPPAGE = "doctor_stoppage"
    DISQUALIFICATION = "disqualification"
    DECISION = "decision"
    DRAW = "draw"
    FORFEIT = "forfeit"


@dataclass(frozen=True, slots=True)
class PunchAction:
    hand: Hand
    punch_class: PunchClass
    target: Target
    power: Power = Power.NORMAL
    kind: ActionKind = field(default=ActionKind.PUNCH, init=False)


@dataclass(frozen=True, slots=True)
class MovementAction:
    kind: ActionKind

    def __post_init__(self) -> None:
        if self.kind in (ActionKind.PUNCH, ActionKind.FOUL):
            raise ValueError(f"{self.kind.value} requires a specialized action")


@dataclass(frozen=True, slots=True)
class FoulAction:
    foul: Foul
    kind: ActionKind = field(default=ActionKind.FOUL, init=False)


type SemanticAction = PunchAction | MovementAction | FoulAction


@dataclass(frozen=True, slots=True)
class InputCommand:
    sequence: int
    client_tick: int
    move_x: int = 0
    move_y: int = 0
    defense: DefensivePose = DefensivePose.NONE
    actions: tuple[SemanticAction, ...] = ()


@dataclass(frozen=True, slots=True)
class TraumaSnapshot:
    head: int
    body: int
    left_eye: int
    right_eye: int
    left_cut: int
    right_cut: int
    swelling: int
    bleeding: int


@dataclass(frozen=True, slots=True)
class FighterSnapshot:
    player_id: str
    x: int
    y: int
    facing: int
    velocity_x: int
    velocity_y: int
    stance: Stance
    defense: DefensivePose
    stamina: int
    maximum_stamina: int
    conditioning: int
    guard: int
    poise: int
    trauma: TraumaSnapshot
    knockdowns: int
    warnings: int
    deductions: int
    stunned_ticks: int
    is_downed: bool
    action: PunchClass | None
    action_hand: Hand | None
    action_target: Target | None
    action_power: Power | None
    queued_actions: int
    clinch_startup_ticks: int
    clinch_ticks: int
    is_foul_recovery_target: bool
    get_up_prompt: ActionKind | None
    get_up_meter: int
    get_up_required: int
    get_up_count: int
    get_up_window_start_tick: int
    get_up_window_end_tick: int


@dataclass(frozen=True, slots=True)
class CombatEvent:
    event_id: int
    tick: int
    kind: str
    actor_id: str | None = None
    target_id: str | None = None
    amount: int = 0
    detail: str = ""
    blood: int = 0
    direction: int = 0


@dataclass(frozen=True, slots=True)
class JudgeCard:
    judge: str
    player_one: tuple[int, ...]
    player_two: tuple[int, ...]

    @property
    def player_one_total(self) -> int:
        return sum(self.player_one)

    @property
    def player_two_total(self) -> int:
        return sum(self.player_two)


@dataclass(frozen=True, slots=True)
class MatchResult:
    match_id: str
    activity_instance_id: str
    guild_id: str
    player_one_id: str
    player_two_id: str
    winner_id: str | None
    finish_method: FinishMethod
    round_number: int
    tick: int
    scorecards: tuple[JudgeCard, ...] = ()
    player_one_knockdowns: int = 0
    player_two_knockdowns: int = 0
    player_one_damage: int = 0
    player_two_damage: int = 0


@dataclass(frozen=True, slots=True)
class EngineSnapshot:
    tick: int
    phase: MatchPhase
    round_number: int
    phase_ticks_remaining: int
    fighters: tuple[FighterSnapshot, FighterSnapshot]
    events: tuple[CombatEvent, ...]
    result: MatchResult | None
    checksum: str
