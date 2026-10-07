"""Computer opponent for Hands: a boxer that plays through the same inputs a person sends.

The brain reads both fighters from the authoritative engine once per tick and answers with one
`InputCommand`. It only reacts to the opponent's punch after a human-like delay, so the fast lead
jab can only be met with a guard that is already up, while a champion slips, weaves or times a
perfect block against anything slower. Everything it does goes through `BoxingEngine.submit_input`
under the same rules as a player's input.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, replace
from enum import StrEnum
from math import hypot

from intelstream.hands.engine import (
    EVASION_TICKS,
    PERFECT_BLOCK_TICKS,
    BoxingEngine,
    FighterState,
)
from intelstream.hands.rules import (
    BLIND_SIDE_EYE_THRESHOLD,
    BODY_COLLAPSE_STAMINA,
    BODY_COLLAPSE_TRAUMA,
    COMPATIBLE_COMBO_CHAINS,
    FIGHTER_RADIUS,
    GUARD_BLOCK_MINIMUM,
    PUNCH_RULES,
    RING_CORNER_REACH,
    RING_HALF_HEIGHT,
    RING_HALF_WIDTH,
    STYLE_RULES,
    PunchRule,
    style_punch_rule,
)
from intelstream.hands.types import (
    ActionKind,
    DefensivePose,
    FighterStyle,
    Hand,
    InputCommand,
    MatchPhase,
    MovementAction,
    Power,
    PunchAction,
    PunchClass,
    SemanticAction,
    Stance,
    Target,
)

CPU_ID_PREFIX = "cpu:"
MOVE_SCALE = 1000
EVASION_STAMINA = 25
CLINCH_RANGE = 115
CLINCH_STAMINA = 45
THREAT_RANGE = 190
TAUNT_RANGE = 230
ROCKED_TICKS = 12
HURT_POISE = 160
OPPONENT_HURT_POISE = 200
GUARD_SETTLED_TICKS = 8
CORNER_CUT_AT = 400
CORNER_BLEEDING_AT = 200
CORNER_EYE_AT = 500
CORNER_SWELLING_AT = 450
GET_UP_ACCURACY_TRAUMA_DIVISOR = 45
GET_UP_KNOCKDOWN_PENALTY = 14
_LIMIT_X = RING_HALF_WIDTH - FIGHTER_RADIUS
_LIMIT_Y = RING_HALF_HEIGHT - FIGHTER_RADIUS


class CpuLevel(StrEnum):
    ROOKIE = "rookie"
    CONTENDER = "contender"
    CHAMPION = "champion"


@dataclass(frozen=True, slots=True)
class CpuProfile:
    name: str
    rating: int
    reaction_ticks: int
    """Ticks before the opponent's punch is noticed."""
    read_percent: int
    """Chance to answer a noticed punch with a defence that works against it."""
    perfect_percent: int
    """Chance a guard answer is held back and raised late enough to be a perfect block."""
    guard_percent: int
    """Chance to keep a high guard while in range and not punching."""
    aggression_percent: int
    attack_interval: int
    combo_length: int
    combo_percent: int
    reach_margin: int
    """Units inside full reach before it throws; below zero it throws from too far."""
    leads_target: bool
    """Aims where a moving opponent will be when the punch arrives."""
    stamina_reserve: int
    footwork_percent: int
    outside_distance: int
    jab_bias: int
    """Extra weight on the jab, which seldom stuns: a weak boxer pecks rather than hurts."""
    counter_percent: int
    power_percent: int
    body_percent: int
    finish_percent: int
    """Extra aggression against a hurt opponent."""
    admire_ticks: int
    """Pause after landing before the next attack, so a weaker boxer lets a hurt man off."""
    head_movement_percent: int
    """Chance per look to slip or duck ahead of a busy opponent's punches."""
    get_up_percent: int
    get_up_jitter: int
    clinch_percent: int
    taunt_percent: int
    exploit_percent: int
    """Chance to aim a hook or uppercut at the side of the opponent's shut eye."""
    corner_percent: int
    """Chance to give the corner the instruction the fighter needs rather than none."""


PROFILES: dict[CpuLevel, CpuProfile] = {
    CpuLevel.ROOKIE: CpuProfile(
        name="Kid Cole",
        rating=850,
        reaction_ticks=10,
        read_percent=35,
        perfect_percent=0,
        guard_percent=30,
        aggression_percent=24,
        attack_interval=20,
        combo_length=2,
        combo_percent=35,
        reach_margin=-8,
        leads_target=False,
        stamina_reserve=60,
        footwork_percent=25,
        outside_distance=130,
        jab_bias=60,
        counter_percent=8,
        power_percent=6,
        body_percent=15,
        finish_percent=0,
        admire_ticks=30,
        head_movement_percent=4,
        get_up_percent=70,
        get_up_jitter=6,
        clinch_percent=15,
        taunt_percent=3,
        exploit_percent=0,
        corner_percent=60,
    ),
    CpuLevel.CONTENDER: CpuProfile(
        name="Marcus 'Hammer' Reed",
        rating=1100,
        reaction_ticks=6,
        read_percent=70,
        perfect_percent=35,
        guard_percent=60,
        aggression_percent=55,
        attack_interval=7,
        combo_length=3,
        combo_percent=70,
        reach_margin=4,
        leads_target=True,
        stamina_reserve=180,
        footwork_percent=70,
        outside_distance=160,
        jab_bias=10,
        counter_percent=65,
        power_percent=40,
        body_percent=45,
        finish_percent=20,
        admire_ticks=6,
        head_movement_percent=12,
        get_up_percent=85,
        get_up_jitter=3,
        clinch_percent=40,
        taunt_percent=2,
        exploit_percent=50,
        corner_percent=90,
    ),
    CpuLevel.CHAMPION: CpuProfile(
        name="Viktor 'Iron' Volkov",
        rating=1400,
        reaction_ticks=4,
        read_percent=78,
        perfect_percent=45,
        guard_percent=65,
        aggression_percent=60,
        attack_interval=5,
        combo_length=4,
        combo_percent=80,
        reach_margin=10,
        leads_target=True,
        stamina_reserve=260,
        footwork_percent=85,
        outside_distance=166,
        jab_bias=0,
        counter_percent=80,
        power_percent=50,
        body_percent=55,
        finish_percent=30,
        admire_ticks=0,
        head_movement_percent=14,
        get_up_percent=95,
        get_up_jitter=1,
        clinch_percent=65,
        taunt_percent=1,
        exploit_percent=80,
        corner_percent=100,
    ),
}

# The styles each of the computer's boxers fights in, one picked per bout from the match seed.
CPU_STYLES: dict[CpuLevel, tuple[FighterStyle, ...]] = {
    CpuLevel.ROOKIE: (FighterStyle.BALANCED, FighterStyle.SLUGGER, FighterStyle.SWARMER),
    CpuLevel.CONTENDER: (
        FighterStyle.BOXER,
        FighterStyle.SLUGGER,
        FighterStyle.SWARMER,
        FighterStyle.COUNTER_PUNCHER,
    ),
    CpuLevel.CHAMPION: (
        FighterStyle.BOXER,
        FighterStyle.SLUGGER,
        FighterStyle.SWARMER,
        FighterStyle.COUNTER_PUNCHER,
    ),
}
CPU_STYLE_SALT = 0x2545F491


def cpu_style(level: CpuLevel, seed: int) -> FighterStyle:
    """The style the computer's boxer fights in for the bout with this match seed."""
    pool = CPU_STYLES[level]
    return pool[random.Random(seed ^ CPU_STYLE_SALT).randrange(len(pool))]  # nosec B311


def _percent(value: int) -> int:
    return max(0, min(100, value))


def styled_profile(profile: CpuProfile, style: FighterStyle) -> CpuProfile:
    """How the computer boxes in a style: a boxer keeps range and jabs, a slugger loads up, a
    swarmer presses and goes to the body, a counter-puncher waits and makes him pay."""
    if style is FighterStyle.BOXER:
        return replace(
            profile,
            outside_distance=profile.outside_distance + 10,
            jab_bias=profile.jab_bias + 25,
            aggression_percent=_percent(profile.aggression_percent - 6),
            power_percent=_percent(profile.power_percent - 10),
            body_percent=_percent(profile.body_percent - 10),
        )
    if style is FighterStyle.SLUGGER:
        return replace(
            profile,
            outside_distance=profile.outside_distance - 12,
            jab_bias=max(0, profile.jab_bias - 10),
            power_percent=_percent(profile.power_percent + 20),
            combo_percent=_percent(profile.combo_percent - 10),
            aggression_percent=_percent(profile.aggression_percent + 5),
            footwork_percent=_percent(profile.footwork_percent - 15),
        )
    if style is FighterStyle.SWARMER:
        return replace(
            profile,
            outside_distance=profile.outside_distance - 20,
            aggression_percent=_percent(profile.aggression_percent + 4),
            body_percent=_percent(profile.body_percent + 20),
            head_movement_percent=_percent(profile.head_movement_percent + 10),
            clinch_percent=_percent(profile.clinch_percent - 10),
        )
    if style is FighterStyle.COUNTER_PUNCHER:
        return replace(
            profile,
            outside_distance=profile.outside_distance + 6,
            aggression_percent=_percent(profile.aggression_percent - 10),
            counter_percent=_percent(profile.counter_percent + 6),
            read_percent=_percent(profile.read_percent + 3),
            perfect_percent=_percent(profile.perfect_percent + 4),
        )
    return profile


_FOLLOW_UPS: dict[PunchClass, tuple[PunchClass, ...]] = {
    first: tuple(second for start, second in sorted(COMPATIBLE_COMBO_CHAINS) if start is first)
    for first in PunchClass
}


def cpu_player_id(level: CpuLevel) -> str:
    return f"{CPU_ID_PREFIX}{level.value}"


def _lead_hand(fighter: FighterState) -> Hand:
    return Hand.LEFT if fighter.stance is Stance.ORTHODOX else Hand.RIGHT


def _other_hand(hand: Hand) -> Hand:
    return Hand.RIGHT if hand is Hand.LEFT else Hand.LEFT


def _vision_penalty(fighter: FighterState) -> int:
    trauma = fighter.trauma
    return min(30, (trauma.left_eye + trauma.right_eye + trauma.swelling) // 70)


def _blind_to(fighter: FighterState, hand: Hand) -> bool:
    """A punch from `hand` arrives on the side of this fighter's eye that is swollen shut."""
    eye = fighter.trauma.right_eye if hand is Hand.LEFT else fighter.trauma.left_eye
    return eye >= BLIND_SIDE_EYE_THRESHOLD


def _rope_room(x: int, y: int) -> float:
    """Distance from a fighter's centre to the nearest rope or corner pad."""
    corner = (RING_CORNER_REACH - abs(x) - abs(y)) / 1.4142
    return min(_LIMIT_X - abs(x), _LIMIT_Y - abs(y), corner)


def _evades(
    action: PunchAction, rule: PunchRule, distance: float, lateral: float
) -> DefensivePose | None:
    """The evasion that `BoxingEngine._evades` accepts against this punch, if there is one."""
    slip = DefensivePose.SLIP_LEFT if action.hand is Hand.RIGHT else DefensivePose.SLIP_RIGHT
    if action.punch_class is PunchClass.HOOK:
        if action.target is Target.HEAD or lateral >= 14:
            return DefensivePose.WEAVE
        return None
    if action.punch_class is PunchClass.UPPERCUT:
        if action.target is Target.HEAD or lateral >= 18:
            return slip
        return None
    if action.target is Target.HEAD and distance > rule.reach * 65 // 100:
        return slip if distance < rule.reach * 80 // 100 else DefensivePose.PULL
    return slip


_EVASION_ACTIONS: dict[DefensivePose, ActionKind] = {
    DefensivePose.SLIP_LEFT: ActionKind.SLIP_LEFT,
    DefensivePose.SLIP_RIGHT: ActionKind.SLIP_RIGHT,
    DefensivePose.WEAVE: ActionKind.WEAVE,
    DefensivePose.PULL: ActionKind.PULL,
}


class CpuBrain:
    def __init__(
        self,
        player_id: str,
        opponent_id: str,
        level: CpuLevel,
        seed: int,
        style: FighterStyle = FighterStyle.BALANCED,
    ) -> None:
        self.player_id = player_id
        self.opponent_id = opponent_id
        self.level = level
        self.style = style
        self.style_rule = STYLE_RULES[style]
        self.profile = styled_profile(PROFILES[level], style)
        self._rng = random.Random(seed)  # nosec B311
        self._sequence = 0
        self._read_attack: tuple[int, str] | None = None
        self._guard_pose = DefensivePose.NONE
        self._guard_from = 0
        self._guard_until = -1
        self._hold_guard = False
        self._guard_window_until = 0
        self._next_attack_tick = 0
        self._combo_left = 0
        self._followed_start = -1
        self._step_in: PunchAction | None = None
        self._step_in_until = -1
        self._strafe = 1
        self._strafe_until = 0
        self._punish_start = -1
        self._next_clinch_tick = 0
        self._next_taunt_tick = 0
        self._get_up_window = -1
        self._get_up_press_tick = -1
        self._get_up_key: ActionKind | None = None
        self._opponent_punches: list[int] = []
        self._last_opponent_start = -1
        self._admire_until = 0
        self._grab_until = -1
        self._next_look_tick = 0
        self._landed_start = -1
        self._corner_round = -1
        self._tick = 0

    def decide(self, engine: BoxingEngine) -> InputCommand | None:
        if engine.result is not None or engine.phase is MatchPhase.COMPLETE:
            return None
        me = engine.fighter(self.player_id)
        them = engine.fighter(self.opponent_id)
        tick = engine.tick
        self._tick = tick
        self._sequence += 1
        if engine.phase is MatchPhase.KNOCKDOWN:
            self._reset_exchange()
            return self._command(tick, actions=self._get_up(tick, me))
        if engine.phase is MatchPhase.REST:
            self._reset_exchange()
            return self._command(tick, actions=self._corner(me, engine.round_number))
        if engine.phase is not MatchPhase.FIGHT or me.clinch_ticks or them.clinch_ticks:
            self._reset_exchange()
            return self._command(tick)
        return self._fight(tick, me, them)

    def _corner(self, me: FighterState, round_number: int) -> tuple[SemanticAction, ...]:
        """One instruction to the corner each rest, for the worst of what is wrong."""
        if me.corner_choice is not None or self._corner_round == round_number:
            return ()
        self._corner_round = round_number
        if not self._roll(self.profile.corner_percent):
            return ()
        trauma = me.trauma
        if (
            max(trauma.left_cut, trauma.right_cut) >= CORNER_CUT_AT
            or trauma.bleeding >= CORNER_BLEEDING_AT
        ):
            kind = ActionKind.CORNER_CUT
        elif (
            max(trauma.left_eye, trauma.right_eye) >= CORNER_EYE_AT
            or trauma.swelling >= CORNER_SWELLING_AT
        ):
            kind = ActionKind.CORNER_SWELLING
        else:
            kind = ActionKind.CORNER_BREATH
        return (MovementAction(kind),)

    def _command(
        self,
        tick: int,
        move: tuple[int, int] = (0, 0),
        defense: DefensivePose = DefensivePose.NONE,
        actions: tuple[SemanticAction, ...] = (),
    ) -> InputCommand:
        return InputCommand(
            sequence=self._sequence,
            client_tick=tick,
            move_x=move[0],
            move_y=move[1],
            defense=defense,
            actions=actions,
        )

    def _roll(self, percent: int) -> bool:
        return self._rng.randrange(100) < percent

    def _reset_exchange(self) -> None:
        self._guard_until = -1
        self._combo_left = 0
        self._step_in = None
        self._punish_start = -1

    def _fight(self, tick: int, me: FighterState, them: FighterState) -> InputCommand:
        profile = self.profile
        distance = max(1.0, hypot(them.x - me.x, them.y - me.y))
        self._note_opponent(tick, them)
        # A flinch is over in a few ticks; only a real stun, or a man nearly out of poise, is hurt.
        hurt = (
            me.stunned_ticks > ROCKED_TICKS
            or me.poise < HURT_POISE
            or (me.trauma.head >= 900 and me.poise < 280)
        )
        tired = me.stamina < self._reserve(me)
        opponent_hurt = (
            them.stunned_ticks > ROCKED_TICKS
            or them.poise < OPPONENT_HURT_POISE
            or them.guard < GUARD_BLOCK_MINIMUM
        )

        evasion = self._read(tick, me, them)
        held = me.held_input.defense
        if evasion is not None:
            return self._command(tick, defense=held, actions=(MovementAction(evasion),))

        reacting = self._guard_from <= tick < self._guard_until
        if me.attack is not None:
            if me.attack.landed and me.attack.start_tick != self._landed_start:
                self._landed_start = me.attack.start_tick
                if profile.admire_ticks:
                    pause = profile.admire_ticks + self._rng.randrange(profile.admire_ticks + 1)
                    self._admire_until = tick + pause
            follow_up = self._follow_up(me, them, distance, opponent_hurt)
            move = self._movement(tick, me, them, distance, hurt, tired, opponent_hurt)
            if follow_up is not None:
                return self._command(tick, move, held, (follow_up,))
            # Hands are busy with the punch: the guard only comes up for a punch it has read.
            if reacting:
                defense = self._guard_pose
            elif me.pending_actions:
                defense = held
            else:
                defense = DefensivePose.NONE
            return self._command(tick, move, defense, ())

        if me.pending_actions:
            # A queued punch is cleared if a guard goes up, so the guard stays as it is.
            move = self._movement(tick, me, them, distance, hurt, tired, opponent_hurt)
            return self._command(tick, move, held, ())

        if hurt and distance <= 170 and tick >= self._next_clinch_tick:
            # Hurt: tie him up rather than run, some of the time.
            self._next_clinch_tick = tick + 20
            if me.stamina >= CLINCH_STAMINA and self._roll(profile.clinch_percent):
                self._grab_until = tick + 25
        if tick < self._grab_until and distance <= CLINCH_RANGE and me.stamina >= CLINCH_STAMINA:
            self._grab_until = -1
            return self._command(tick, actions=(MovementAction(ActionKind.CLINCH),))

        look = self._head_movement(tick, me, distance)
        if look is not None:
            return self._command(tick, defense=held, actions=(MovementAction(look),))

        if me.stunned_ticks == 0 and tick >= self._guard_until and tick >= self._admire_until:
            punch = self._attack(tick, me, them, distance, hurt, tired, opponent_hurt)
            if punch is not None:
                move = self._movement(tick, me, them, distance, hurt, tired, opponent_hurt)
                return self._command(tick, move, DefensivePose.NONE, (punch,))

        if self._taunts(tick, me, them, distance):
            return self._command(tick, actions=(MovementAction(ActionKind.TAUNT),))

        move = self._movement(tick, me, them, distance, hurt, tired, opponent_hurt)
        return self._command(tick, move, self._defense(tick, me, distance, hurt), ())

    def _reserve(self, me: FighterState) -> int:
        """Stamina kept back: more once the body is broken down, where an empty tank means a knee."""
        reserve = self.profile.stamina_reserve
        if me.trauma.body >= BODY_COLLAPSE_TRAUMA:
            reserve = max(reserve, BODY_COLLAPSE_STAMINA + 50)
        return reserve

    def _note_opponent(self, tick: int, them: FighterState) -> None:
        attack = them.attack
        if attack is not None and attack.start_tick != self._last_opponent_start:
            self._last_opponent_start = attack.start_tick
            self._opponent_punches.append(attack.start_tick)
        while self._opponent_punches and self._opponent_punches[0] < tick - 60:
            self._opponent_punches.pop(0)

    def _read(self, tick: int, me: FighterState, them: FighterState) -> ActionKind | None:
        """Notices the opponent's punch after the reaction delay and picks an answer.

        Returns an evasion to send now; a guard answer is remembered and held by `_defense`.
        """
        attack = them.attack
        if attack is None or attack.resolved:
            return None
        key = (attack.start_tick, attack.action.punch_class.value)
        if key == self._read_attack or tick - attack.start_tick < self.profile.reaction_ticks:
            return None
        self._read_attack = key
        if _blind_to(me, attack.action.hand):
            # Thrown on the side of a shut eye: there is nothing to see it with.
            return None
        contact = attack.start_tick + attack.rule.startup
        lead = contact - tick
        if lead < 2:
            return None
        forward, lateral = self._incoming(me, them, lead)
        reach = attack.rule.reach * (100 - _vision_penalty(them)) // 100
        arc = attack.rule.lateral_arc * (100 - _vision_penalty(them)) // 100
        threat = (
            FIGHTER_RADIUS // 3 < forward <= reach
            and hypot(forward, lateral) <= reach
            and lateral <= arc
        )
        if not threat:
            if self._roll(self.profile.counter_percent):
                self._punish_start = attack.start_tick
            return None
        if not self._roll(self.profile.read_percent):
            return None
        guard = (
            DefensivePose.GUARD_HIGH
            if attack.action.target is Target.HEAD
            else DefensivePose.GUARD_LOW
        )
        evasion = _evades(attack.action, attack.rule, hypot(forward, lateral), lateral)
        can_evade = (
            evasion is not None
            and me.attack is None
            and me.stunned_ticks == 0
            and me.stamina >= EVASION_STAMINA
            and lead - 1 < EVASION_TICKS + self.style_rule.evasion_ticks
        )
        if can_evade and (me.defense is guard or self._roll(55)):
            assert evasion is not None
            self._punish_start = attack.start_tick
            return _EVASION_ACTIONS[evasion]
        self._guard_pose = guard
        self._guard_until = contact + attack.rule.active
        perfect = me.defense is not guard and self._roll(self.profile.perfect_percent)
        window = PERFECT_BLOCK_TICKS + self.style_rule.perfect_block_ticks
        self._guard_from = contact - window - 1 if perfect else tick
        if self._roll(self.profile.counter_percent):
            # Blocked, he is still in his recovery when the guard comes down.
            self._punish_start = attack.start_tick
        return None

    @staticmethod
    def _incoming(me: FighterState, them: FighterState, lead: int) -> tuple[float, float]:
        """Where this fighter will stand, along and across the punch, when it arrives."""
        x = me.x + me.velocity_x * lead
        y = me.y + me.velocity_y * lead
        dx, dy = x - them.x, y - them.y
        fx, fy = them.facing_x / 1000, them.facing_y / 1000
        return dx * fx + dy * fy, abs(dx * fy - dy * fx)

    def _head_movement(self, tick: int, me: FighterState, distance: float) -> ActionKind | None:
        """Slips and ducks ahead of a busy opponent's punches, which a read cannot always catch."""
        if distance > 160 or tick < self._next_look_tick or len(self._opponent_punches) < 2:
            return None
        self._next_look_tick = tick + 18 + self._rng.randrange(12)
        if me.stamina < self.profile.stamina_reserve + EVASION_STAMINA or me.stunned_ticks:
            return None
        if not self._roll(self.profile.head_movement_percent):
            return None
        return (ActionKind.SLIP_LEFT, ActionKind.SLIP_RIGHT, ActionKind.WEAVE)[
            self._rng.randrange(3)
        ]

    def _defense(self, tick: int, me: FighterState, distance: float, hurt: bool) -> DefensivePose:
        if self._guard_from <= tick < self._guard_until:
            return self._guard_pose
        if tick < self._guard_until:
            return DefensivePose.NONE
        if distance > THREAT_RANGE:
            self._hold_guard = False
            return DefensivePose.NONE
        if tick >= self._guard_window_until:
            self._guard_window_until = tick + 15 + self._rng.randrange(16)
            busy = len(self._opponent_punches) >= 3
            blind = _blind_to(me, Hand.LEFT) or _blind_to(me, Hand.RIGHT)
            chance = (
                self.profile.guard_percent
                + (30 if hurt else 0)
                + (15 if busy else 0)
                + (25 if blind else 0)
            )
            self._hold_guard = self._roll(chance)
        if hurt and me.stunned_ticks == 0:
            return DefensivePose.GUARD_HIGH
        return DefensivePose.GUARD_HIGH if self._hold_guard else DefensivePose.NONE

    def _rule(self, action: PunchAction) -> PunchRule:
        """The punch as this boxer's style throws it: its reach and its cost."""
        return style_punch_rule(
            PUNCH_RULES[(action.punch_class, action.target, action.power)], self.style_rule
        )

    def _timing(self, me: FighterState, action: PunchAction) -> tuple[int, PunchRule]:
        rule = self._rule(action)
        lead_jab = action.punch_class is PunchClass.JAB and action.hand is _lead_hand(me)
        startup = max(
            2,
            rule.startup * 100 // me.fatigue
            - (1 if lead_jab else 0)
            + self.style_rule.startup_ticks.get(action.punch_class, 0),
        )
        return startup, rule

    def _reaches(self, me: FighterState, them: FighterState, action: PunchAction) -> bool:
        startup, rule = self._timing(me, action)
        vision = _vision_penalty(me)
        reach = rule.reach * (100 - vision) // 100 - self.profile.reach_margin
        arc = rule.lateral_arc * (100 - vision) // 100 - max(0, self.profile.reach_margin)
        tx, ty = float(them.x), float(them.y)
        if self.profile.leads_target:
            tx += them.velocity_x * (startup + 1)
            ty += them.velocity_y * (startup + 1)
        aim_x, aim_y = them.x - me.x, them.y - me.y
        aim = max(1.0, hypot(aim_x, aim_y))
        fx, fy = aim_x / aim, aim_y / aim
        dx, dy = tx - me.x, ty - me.y
        forward = dx * fx + dy * fy
        lateral = abs(dx * fy - dy * fx)
        return FIGHTER_RADIUS // 3 < forward <= reach and hypot(dx, dy) <= reach and lateral <= arc

    def _affordable(self, me: FighterState, action: PunchAction, reserve: int) -> bool:
        return me.stamina >= self._rule(action).stamina_cost + reserve

    def _choose(
        self,
        me: FighterState,
        them: FighterState,
        distance: float,
        power_percent: int,
    ) -> PunchAction:
        lead = _lead_hand(me)
        rear = _other_hand(lead)
        weights: tuple[tuple[PunchClass, int], ...]
        if distance >= 130:
            weights = ((PunchClass.JAB, 60), (PunchClass.STRAIGHT, 35), (PunchClass.HOOK, 5))
        elif distance >= 105:
            weights = (
                (PunchClass.JAB, 25),
                (PunchClass.STRAIGHT, 30),
                (PunchClass.HOOK, 35),
                (PunchClass.UPPERCUT, 10),
            )
        else:
            weights = (
                (PunchClass.JAB, 10),
                (PunchClass.STRAIGHT, 15),
                (PunchClass.HOOK, 45),
                (PunchClass.UPPERCUT, 30),
            )
        weights = ((PunchClass.JAB, self.profile.jab_bias), *weights)
        pick = self._rng.randrange(sum(weight for _, weight in weights))
        punch_class = weights[-1][0]
        for candidate, weight in weights:
            if pick < weight:
                punch_class = candidate
                break
            pick -= weight
        if punch_class is PunchClass.JAB:
            hand = lead if self._roll(85) else rear
        elif punch_class is PunchClass.STRAIGHT:
            hand = rear if self._roll(90) else lead
        elif punch_class is PunchClass.HOOK:
            hand = lead if self._roll(60) else rear
        else:
            hand = rear if self._roll(60) else lead
        if punch_class in (PunchClass.HOOK, PunchClass.UPPERCUT):
            for side in (Hand.LEFT, Hand.RIGHT):
                shut = _blind_to(them, side) and not _blind_to(them, _other_hand(side))
                if shut and self._roll(self.profile.exploit_percent):
                    # Work the side he cannot see: a left hand lands on his right eye.
                    hand = side
        return self._shaped(PunchAction(hand, punch_class, Target.HEAD), them, power_percent)

    def _shaped(self, action: PunchAction, them: FighterState, power_percent: int) -> PunchAction:
        body_percent = self.profile.body_percent
        if them.defense is DefensivePose.GUARD_HIGH:
            body = self._roll(body_percent)
        elif them.defense is DefensivePose.GUARD_LOW:
            body = False
        else:
            body = self._roll(body_percent // 3)
        power = action.punch_class is not PunchClass.JAB and self._roll(power_percent)
        if power and self._parry_risk(them) and self._roll(self.profile.exploit_percent):
            power = False
        return PunchAction(
            action.hand,
            action.punch_class,
            Target.BODY if body else Target.HEAD,
            Power.POWER if power else Power.NORMAL,
        )

    def _parry_risk(self, them: FighterState) -> bool:
        """A power punch at a guard that is down, or only just up, can be parried by a late raise.

        A guard that has been up a while only blocks it, and a man punching or stunned cannot raise
        one in time.
        """
        if them.stunned_ticks > 0 or them.attack is not None:
            return False
        guarded = them.defense in (DefensivePose.GUARD_HIGH, DefensivePose.GUARD_LOW)
        return not (guarded and self._tick - them.defense_started_tick >= GUARD_SETTLED_TICKS)

    def _attack(
        self,
        tick: int,
        me: FighterState,
        them: FighterState,
        distance: float,
        hurt: bool,
        tired: bool,
        opponent_hurt: bool,
    ) -> PunchAction | None:
        profile = self.profile
        countering = me.counter_ticks > 0
        punishing = (
            self._punish_start >= 0
            and them.attack is not None
            and them.attack.start_tick == self._punish_start
            and them.attack.resolved
        )
        reserve = self._reserve(me) // 2 if countering or opponent_hurt else self._reserve(me)
        if self._step_in is not None:
            if tick > self._step_in_until or hurt:
                self._step_in = None
            elif self._reaches(me, them, self._step_in):
                action = self._step_in
                self._step_in = None
                if self._affordable(me, action, 0):
                    return self._launch(tick, action)
                return None
        if countering or punishing:
            power = profile.power_percent if countering else profile.power_percent // 2
            for _ in range(3):
                action = self._choose(me, them, distance, power)
                if self._reaches(me, them, action) and self._affordable(me, action, 0):
                    self._punish_start = -1
                    return self._launch(tick, action)
        if tick < self._next_attack_tick or (tired and not opponent_hurt):
            return None
        if hurt and not countering:
            return None
        self._next_attack_tick = tick + 2 + self._rng.randrange(2)
        aggression = profile.aggression_percent + (profile.finish_percent if opponent_hurt else 0)
        if not self._roll(aggression):
            return None
        power = profile.power_percent if opponent_hurt else profile.power_percent // 4
        action = self._choose(me, them, distance, power)
        if not self._affordable(me, action, reserve):
            return None
        if self._reaches(me, them, action):
            return self._launch(tick, action)
        startup, rule = self._timing(me, action)
        if distance - (rule.reach - profile.reach_margin) <= 45:
            self._step_in = action
            self._step_in_until = tick + 10 + startup
        return None

    def _launch(self, tick: int, action: PunchAction) -> PunchAction:
        profile = self.profile
        self._combo_left = 0
        while self._combo_left < profile.combo_length - 1 and self._roll(profile.combo_percent):
            self._combo_left += 1
        self._next_attack_tick = (
            tick + profile.attack_interval + self._rng.randrange(profile.attack_interval + 1)
        )
        return action

    def _follow_up(
        self, me: FighterState, them: FighterState, distance: float, opponent_hurt: bool
    ) -> PunchAction | None:
        attack = me.attack
        assert attack is not None
        if not attack.resolved or attack.start_tick == self._followed_start:
            return None
        self._followed_start = attack.start_tick
        if self._combo_left <= 0 or not attack.landed:
            self._combo_left = 0
            return None
        options = _FOLLOW_UPS[attack.action.punch_class]
        if not options:
            self._combo_left = 0
            return None
        self._combo_left -= 1
        punch_class = options[self._rng.randrange(len(options))]
        power = self.profile.power_percent if opponent_hurt else self.profile.power_percent // 3
        action = self._shaped(
            PunchAction(_other_hand(attack.action.hand), punch_class, Target.HEAD), them, power
        )
        rule = self._rule(action)
        discounted = max(1, rule.stamina_cost * 90 // 100)
        if distance > rule.reach - self.profile.reach_margin or me.stamina < discounted:
            self._combo_left = 0
            return None
        return action

    def _taunts(self, tick: int, me: FighterState, them: FighterState, distance: float) -> bool:
        if distance < TAUNT_RANGE or tick < self._next_taunt_tick:
            return False
        self._next_taunt_tick = tick + 30
        ahead = (
            me.knockdowns < them.knockdowns or me.conditioning > them.conditioning + 250
        ) and me.stamina > me.maximum_stamina * 3 // 4
        return ahead and self._roll(self.profile.taunt_percent)

    def _movement(
        self,
        tick: int,
        me: FighterState,
        them: FighterState,
        distance: float,
        hurt: bool,
        tired: bool,
        opponent_hurt: bool,
    ) -> tuple[int, int]:
        profile = self.profile
        if tick < self._grab_until:
            wanted = 90.0
        elif hurt or (tired and not opponent_hurt):
            wanted = 240.0
        elif self._step_in is not None:
            _startup, rule = self._timing(me, self._step_in)
            wanted = rule.reach - profile.reach_margin - 10
        elif opponent_hurt and profile.finish_percent:
            wanted = 105.0
        else:
            wanted = float(profile.outside_distance)
        target_x, target_y = float(them.x), float(them.y)
        if profile.leads_target and wanted < profile.outside_distance:
            # Cutting off the ring: head for where the opponent is going, not where he is.
            target_x += them.velocity_x * 8
            target_y += them.velocity_y * 8
        dx, dy = target_x - me.x, target_y - me.y
        span = max(1.0, hypot(dx, dy))
        ux, uy = dx / span, dy / span
        error = distance - wanted
        radial = 0.0 if abs(error) < 6 else max(-1.0, min(1.0, error / 30))
        # A flat-footed boxer is slow to take or give ground.
        radial *= 0.5 + 0.5 * profile.footwork_percent / 100

        if tick >= self._strafe_until:
            self._strafe = 1 if self._roll(50) else -1
            self._strafe_until = tick + 30 + self._rng.randrange(60)
        px, py = -uy, ux
        footwork = profile.footwork_percent / 100
        lateral = footwork * (0.9 if hurt or tired else 0.55)
        room = _rope_room(me.x, me.y)
        if room < 90 and self._roll(profile.footwork_percent):
            # Off the ropes: circle toward the open ring rather than along the ropes.
            toward_centre = -(me.x * px + me.y * py)
            self._strafe = 1 if toward_centre >= 0 else -1
            lateral = max(lateral, footwork)
        move_x = ux * radial + px * lateral * self._strafe
        move_y = uy * radial + py * lateral * self._strafe
        if room < 40 and radial < 0:
            # Backing straight into the ropes gains nothing; slide along them instead.
            outward = (me.x * move_x + me.y * move_y) / max(1.0, hypot(me.x, me.y))
            if outward > 0:
                norm = max(1.0, hypot(me.x, me.y))
                move_x -= me.x / norm * outward
                move_y -= me.y / norm * outward
        size = hypot(move_x, move_y)
        if size < 0.05:
            return 0, 0
        scale = MOVE_SCALE / max(1.0, size) if size > 1 else MOVE_SCALE
        return round(move_x * scale), round(move_y * scale)

    def _get_up(self, tick: int, me: FighterState) -> tuple[SemanticAction, ...]:
        prompt = me.get_up_prompt
        if prompt is None or me.get_up_prompt_resolved:
            return ()
        if me.get_up_window_start_tick != self._get_up_window:
            self._get_up_window = me.get_up_window_start_tick
            centre = (me.get_up_window_start_tick + me.get_up_window_end_tick) // 2
            jitter = self.profile.get_up_jitter
            self._get_up_press_tick = centre + self._rng.randint(-jitter, jitter)
            accuracy = (
                self.profile.get_up_percent
                - me.trauma.head // GET_UP_ACCURACY_TRAUMA_DIVISOR
                - GET_UP_KNOCKDOWN_PENALTY * max(0, me.knockdowns - 1)
            )
            wrong = (
                ActionKind.GET_UP_RIGHT
                if prompt is ActionKind.GET_UP_LEFT
                else ActionKind.GET_UP_LEFT
            )
            self._get_up_key = prompt if self._roll(max(10, accuracy)) else wrong
        if tick + 1 < self._get_up_press_tick or self._get_up_key is None:
            return ()
        key = self._get_up_key
        self._get_up_key = None
        return (MovementAction(key),)
