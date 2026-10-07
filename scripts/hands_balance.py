#!/usr/bin/env python3
"""Measure how Hands bouts play out, with computer boxers on both sides.

Runs whole bouts in-process through the authoritative engine under the default rules (three
rounds of two minutes, fifteen-second rests) between computer levels, or between a scripted
human strategy and a computer level, and prints how the bouts end, how long they last, the
knockdowns, the punch output and how much of the fight is spent stunned. Every bout is
deterministic for its seed. With --style-matrix it plays every pair of fighting styles against
each other, from both corners, and prints how often each style wins with the standard error of
that share: between two computers of one level, two copies of a scripted strategy, or two
strategies ("skilled:brawler"), each style taking each side. A matrix plays held-out seeds, from
101, unless --first-seed says otherwise.

A scripted human answers a punch 7 ticks after it starts and is heard at once, as if he sat in
the server. --reaction draws his reaction to each punch from a range, and a connection makes him
later still: he sees a punch --latency-ticks late (a client shows the opponent's punch when its
snapshot arrives) and his input reaches the server --uplink-ticks after he sends it. --rtt-ms
sets both from a round trip.

    uv run python scripts/hands_balance.py --seeds 12
    uv run python scripts/hands_balance.py --humans jabs,hooks,turtle,brawler,counter,mash --seeds 8
    uv run python scripts/hands_balance.py --humans skilled,counter --reaction 6-9 --rtt-ms 50
    uv run python scripts/hands_balance.py --style-matrix contender,champion --seeds 24
    uv run python scripts/hands_balance.py --style-matrix skilled:brawler --reaction 6-9 --rtt-ms 50
"""

from __future__ import annotations

import argparse
import random
import time
from collections import Counter, deque
from dataclasses import dataclass, field
from math import hypot, sqrt
from typing import ClassVar, Protocol

from intelstream.hands.cpu import CpuBrain, CpuLevel, cpu_style
from intelstream.hands.engine import AttackState, BoxingEngine, EngineConfig, FighterState
from intelstream.hands.rules import TICKS_PER_SECOND
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
    Target,
)

DEFAULT_MATCHUPS = (
    "champion:champion",
    "contender:contender",
    "rookie:rookie",
    "champion:rookie",
    "contender:rookie",
)
HUMAN_STRATEGIES = ("jabs", "hooks", "turtle", "brawler", "counter", "mash", "skilled")
HUMAN_REACTION_TICKS = 7
HELD_OUT_FIRST_SEED = 101


class Player(Protocol):
    def decide(self, engine: BoxingEngine) -> InputCommand | None: ...


@dataclass(frozen=True, slots=True)
class Lag:
    """How late a scripted human answers: a reaction drawn for each punch from `reaction`, a punch
    seen `latency_ticks` late and input heard `uplink_ticks` after he sends it. A lagged human's
    other scripted choices start from a seeded offset, so each seed plays a different bout."""

    reaction: tuple[int, int] = (HUMAN_REACTION_TICKS, HUMAN_REACTION_TICKS)
    latency_ticks: int = 0
    uplink_ticks: int = 0

    @classmethod
    def over(cls, rtt_ms: float, reaction: tuple[int, int]) -> Lag:
        """A connection with this round trip: half of it each way, in whole ticks."""
        one_way = round(rtt_ms / 2 * TICKS_PER_SECOND / 1000)
        return cls(reaction, one_way, one_way)


class _Eyes:
    """Whether a scripted human has seen a punch yet: his reaction to it, drawn once per punch,
    plus the ticks his connection shows it late."""

    def __init__(self, lag: Lag | None, rng: random.Random) -> None:
        self._lag = lag
        self._rng = rng
        self._punch = -1
        self._delay = HUMAN_REACTION_TICKS

    def see(self, attack: AttackState, tick: int) -> bool:
        if self._lag is not None and attack.start_tick != self._punch:
            self._punch = attack.start_tick
            low, high = self._lag.reaction
            self._delay = self._rng.randint(low, high) + self._lag.latency_ticks
        return tick - attack.start_tick >= self._delay


class LaggedPlayer:
    """A scripted human on a connection: he sees and answers each punch as his `Lag` says, and
    every command he sends reaches the server `uplink_ticks` later."""

    def __init__(self, human: Player, uplink_ticks: int) -> None:
        self.human = human
        self._in_flight: deque[InputCommand | None] = deque([None] * uplink_ticks)

    def decide(self, engine: BoxingEngine) -> InputCommand | None:
        self._in_flight.append(self.human.decide(engine))
        return self._in_flight.popleft()


def _corner_pick(fighter: FighterState) -> tuple[SemanticAction, ...]:
    if fighter.corner_choice is not None:
        return ()
    trauma = fighter.trauma
    if max(trauma.left_cut, trauma.right_cut) >= 400 or trauma.bleeding >= 200:
        return (MovementAction(ActionKind.CORNER_CUT),)
    if max(trauma.left_eye, trauma.right_eye) >= 500 or trauma.swelling >= 450:
        return (MovementAction(ActionKind.CORNER_SWELLING),)
    return (MovementAction(ActionKind.CORNER_BREATH),)


class SkilledHuman:
    """A capable player who only sees a punch after a human's reaction time.

    Keeps his range and circles, raises the guard high or low for the punch he sees coming,
    answers a punch that has missed or been blocked, jabs to keep the other man honest, saves his
    stamina, drops his arms out of range to rest them, ties up when hurt, and sends his corner an
    instruction between rounds.
    """

    def __init__(
        self, player_id: str, opponent_id: str, lag: Lag | None = None, seed: int = 0
    ) -> None:
        self.player_id = player_id
        self.opponent_id = opponent_id
        rng = random.Random(seed)  # nosec B311
        self._eyes = _Eyes(lag, rng)
        self._start = 0 if lag is None else rng.randrange(1000)
        self._sequence = 0
        self._seen = -1
        self._answered = -1
        self._guard = DefensivePose.NONE
        self._guard_until = -1
        self._next_jab = 0

    def decide(self, engine: BoxingEngine) -> InputCommand | None:
        self._sequence += 1
        me = engine.fighter(self.player_id)
        them = engine.fighter(self.opponent_id)
        tick = engine.tick
        if engine.phase is MatchPhase.KNOCKDOWN:
            window_middle = (me.get_up_window_start_tick + me.get_up_window_end_tick) // 2
            prompt = me.get_up_prompt
            if prompt is not None and not me.get_up_prompt_resolved and tick + 1 >= window_middle:
                return InputCommand(self._sequence, tick, actions=(MovementAction(prompt),))
            return InputCommand(self._sequence, tick)
        if engine.phase is MatchPhase.REST:
            return InputCommand(self._sequence, tick, actions=_corner_pick(me))
        if engine.phase is not MatchPhase.FIGHT:
            return InputCommand(self._sequence, tick)
        dx, dy = them.x - me.x, them.y - me.y
        distance = max(1.0, hypot(dx, dy))
        ux, uy = dx / distance, dy / distance
        hurt = me.stunned_ticks > 12 or me.poise < 200
        wanted = 210.0 if hurt else 150.0
        radial = max(-1.0, min(1.0, (distance - wanted) / 30))
        side = 1 if ((tick + self._start) // 75) % 2 == 0 else -1
        if abs(me.x) + abs(me.y) > 520:
            # Off the ropes: circle the way that leads back to the middle.
            side = 1 if -(me.x * -uy + me.y * ux) >= 0 else -1
        move_x = ux * radial - uy * 0.6 * side
        move_y = uy * radial + ux * 0.6 * side
        size = max(1.0, hypot(move_x, move_y))
        move = (round(move_x / size * 1000), round(move_y / size * 1000))
        attack = them.attack
        free = me.attack is None and not me.pending_actions
        if hurt and distance <= 110 and me.stamina >= 45 and free:
            return InputCommand(self._sequence, tick, actions=(MovementAction(ActionKind.CLINCH),))
        if (
            attack is not None
            and not attack.resolved
            and attack.start_tick != self._seen
            and self._eyes.see(attack, tick)
        ):
            self._seen = attack.start_tick
            head = attack.action.target is Target.HEAD
            self._guard = DefensivePose.GUARD_HIGH if head else DefensivePose.GUARD_LOW
            self._guard_until = attack.start_tick + attack.rule.startup + attack.rule.active + 1
        if tick < self._guard_until:
            return InputCommand(self._sequence, tick, move[0], move[1], self._guard)
        if (
            attack is not None
            and attack.resolved
            and attack.start_tick != self._answered
            and self._eyes.see(attack, tick)
            and free
            and distance <= 165
            and me.stamina >= 120
        ):
            self._answered = attack.start_tick
            punch = PunchClass.STRAIGHT if distance > 120 else PunchClass.HOOK
            power = Power.POWER if me.counter_ticks > 0 and me.stamina >= 300 else Power.NORMAL
            action = PunchAction(Hand.RIGHT, punch, Target.HEAD, power)
            return InputCommand(self._sequence, tick, actions=(action,))
        if tick >= self._next_jab and free and distance <= 150 and me.stamina >= 300:
            self._next_jab = tick + 24 + (tick * 7919 + self._start) % 18
            jab = PunchAction(Hand.LEFT, PunchClass.JAB, Target.HEAD)
            return InputCommand(self._sequence, tick, move[0], move[1], actions=(jab,))
        rest_arms = distance > 175
        defense = DefensivePose.NONE if rest_arms else DefensivePose.GUARD_HIGH
        return InputCommand(self._sequence, tick, move[0], move[1], defense)


class ScriptedHuman:
    """A player who repeats one plan without reading the opponent, except the counter-puncher.

    - jabs: walks to jab range and pecks with the lead hand.
    - hooks: walks inside and swings power hooks from alternate hands.
    - turtle: walks in behind a high guard and jabs now and then.
    - brawler: straights, hooks, uppercuts and the odd body shot from behind a high guard.
    - counter: holds a guard at range, high or low for the punch he sees coming, and answers each
      punch once a human could have seen it; like the skilled player he keeps stamina back and
      sends his corner an instruction between rounds.
    - mash: a newcomer pressing every punch button as fast as he can, never guarding.
    """

    WANTED_DISTANCE: ClassVar[dict[str, int]] = {
        "jabs": 135,
        "hooks": 100,
        "turtle": 120,
        "brawler": 112,
        "counter": 150,
        "mash": 110,
    }

    def __init__(
        self, kind: str, player_id: str, opponent_id: str, lag: Lag | None = None, seed: int = 0
    ) -> None:
        if kind not in self.WANTED_DISTANCE:
            raise ValueError(f"unknown strategy {kind!r}")
        self.kind = kind
        self.player_id = player_id
        self.opponent_id = opponent_id
        rng = random.Random(seed)  # nosec B311
        self._eyes = _Eyes(lag, rng)
        self._start = 0 if lag is None else rng.randrange(1000)
        self._sequence = 0
        self._next_tick = 0
        self._flip = False

    def _command(
        self,
        tick: int,
        move: tuple[int, int] = (0, 0),
        defense: DefensivePose = DefensivePose.NONE,
        actions: tuple[SemanticAction, ...] = (),
    ) -> InputCommand:
        return InputCommand(self._sequence, tick, move[0], move[1], defense, actions)

    def decide(self, engine: BoxingEngine) -> InputCommand | None:
        self._sequence += 1
        me = engine.fighter(self.player_id)
        them = engine.fighter(self.opponent_id)
        tick = engine.tick
        if engine.phase is MatchPhase.KNOCKDOWN:
            window_middle = (me.get_up_window_start_tick + me.get_up_window_end_tick) // 2
            prompt = me.get_up_prompt
            if prompt is not None and not me.get_up_prompt_resolved and tick + 1 >= window_middle:
                return self._command(tick, actions=(MovementAction(prompt),))
            return self._command(tick)
        if engine.phase is MatchPhase.REST and self.kind == "counter":
            return self._command(tick, actions=_corner_pick(me))
        if engine.phase is not MatchPhase.FIGHT:
            return self._command(tick)
        dx, dy = them.x - me.x, them.y - me.y
        distance = max(1.0, hypot(dx, dy))
        wanted = self.WANTED_DISTANCE[self.kind]
        toward = (round(dx / distance * 1000), round(dy / distance * 1000))
        move = toward if distance > wanted else (0, 0)
        guarded = self.kind in ("turtle", "brawler", "counter")
        defense = DefensivePose.GUARD_HIGH if guarded else DefensivePose.NONE
        roll = (tick * 2654435761 + self._sequence + self._start) % 1000
        free = me.attack is None and not me.pending_actions
        if self.kind == "counter":
            if distance < wanted - 10:
                move = (-toward[0], -toward[1])
            attack = them.attack
            seen = attack is not None and self._eyes.see(attack, tick)
            answer = seen and attack is not None and attack.resolved and me.stamina >= 120
            if answer and free and distance <= 160:
                punch = PunchClass.STRAIGHT if distance > 120 else PunchClass.HOOK
                return self._command(tick, actions=(PunchAction(Hand.RIGHT, punch, Target.HEAD),))
            jab_ready = tick >= self._next_tick and me.stamina >= 300
            if jab_ready and free and distance <= 150 and roll < 300:
                self._next_tick = tick + 20
                jab = PunchAction(Hand.LEFT, PunchClass.JAB, Target.HEAD)
                return self._command(tick, move, actions=(jab,))
            if seen and attack is not None and not attack.resolved:
                body = attack.action.target is Target.BODY
                defense = DefensivePose.GUARD_LOW if body else DefensivePose.GUARD_HIGH
            return self._command(tick, move, defense)
        if self.kind == "mash":
            if tick < self._next_tick or distance > 150:
                return self._command(tick, move)
            hand, punch = (
                (Hand.LEFT, PunchClass.JAB),
                (Hand.RIGHT, PunchClass.STRAIGHT),
                (Hand.LEFT, PunchClass.HOOK),
                (Hand.RIGHT, PunchClass.HOOK),
                (Hand.RIGHT, PunchClass.UPPERCUT),
            )[roll % 5]
            power = Power.POWER if roll % 3 == 0 else Power.NORMAL
            self._next_tick = tick + 4
            return self._command(
                tick, move, actions=(PunchAction(hand, punch, Target.HEAD, power),)
            )
        if tick < self._next_tick or not free:
            return self._command(tick, move, defense)
        if self.kind == "brawler" and distance <= 125:
            hand, punch = (
                (Hand.RIGHT, PunchClass.STRAIGHT),
                (Hand.LEFT, PunchClass.HOOK),
                (Hand.RIGHT, PunchClass.HOOK),
                (Hand.RIGHT, PunchClass.UPPERCUT),
                (Hand.LEFT, PunchClass.JAB),
            )[roll % 5]
            self._next_tick = tick + 12 + roll % 7
            target = Target.BODY if roll % 4 == 0 else Target.HEAD
            return self._command(tick, move, actions=(PunchAction(hand, punch, target),))
        if self.kind == "jabs" and distance <= 150:
            self._next_tick = tick + 9
            jab = PunchAction(Hand.LEFT, PunchClass.JAB, Target.HEAD)
            return self._command(tick, move, actions=(jab,))
        if self.kind == "hooks" and distance <= 126:
            self._flip = not self._flip
            hand = Hand.LEFT if self._flip else Hand.RIGHT
            self._next_tick = tick + 14
            hook = PunchAction(hand, PunchClass.HOOK, Target.HEAD, Power.POWER)
            return self._command(tick, move, actions=(hook,))
        if self.kind == "turtle" and distance <= 150:
            self._next_tick = tick + 45
            jab = PunchAction(Hand.LEFT, PunchClass.JAB, Target.HEAD)
            return self._command(tick, move, defense, (jab,))
        return self._command(tick, move, defense)


@dataclass(slots=True)
class BoutStats:
    winner_seat: int | None
    method: str
    rounds: int
    fight_seconds: float
    knockdowns: int
    thrown: list[int]
    landed: list[int]
    stunned_ticks: int
    fight_ticks: int
    stuns: int
    chained_stuns: int
    stunned_knockdowns: int
    corner_picks: Counter[str] = field(default_factory=Counter)
    landed_by_round: list[list[int]] = field(default_factory=list)
    """Each seat's clean punches in each round fought."""


def make_player(
    spec: str,
    player_id: str,
    opponent_id: str,
    seed: int,
    style: FighterStyle = FighterStyle.BALANCED,
    lag: Lag | None = None,
) -> Player:
    human: Player
    if spec == "skilled":
        human = SkilledHuman(player_id, opponent_id, lag, seed)
    elif spec in HUMAN_STRATEGIES:
        human = ScriptedHuman(spec, player_id, opponent_id, lag, seed)
    else:
        return CpuBrain(player_id, opponent_id, CpuLevel(spec), seed, style)
    if lag is None or lag.uplink_ticks == 0:
        return human
    return LaggedPlayer(human, lag.uplink_ticks)


def play(
    one: str,
    two: str,
    seed: int,
    config: EngineConfig,
    styles: tuple[FighterStyle, FighterStyle] = (FighterStyle.BALANCED, FighterStyle.BALANCED),
    lag: Lag | None = None,
) -> BoutStats:
    """One bout; `lag` puts any scripted human on a connection."""
    engine = BoxingEngine(
        match_id=f"balance-{seed}",
        activity_instance_id="balance",
        guild_id="balance",
        player_one_id="one",
        player_two_id="two",
        seed=seed,
        config=config,
        styles=styles,
    )
    # Nothing here reads a checksum, and hashing each tick's state is most of what a bout costs.
    engine.checksums = False
    players = (
        ("one", make_player(one, "one", "two", seed * 2 + 1, styles[0], lag)),
        ("two", make_player(two, "two", "one", seed * 2 + 2, styles[1], lag)),
    )
    ids = ("one", "two")
    thrown = [0, 0]
    landed = [0, 0]
    landed_by_round = [[0] * config.rounds, [0] * config.rounds]
    stunned_ticks = fight_ticks = stuns = chained = stunned_knockdowns = 0
    corner_picks: Counter[str] = Counter()
    while engine.result is None:
        for player_id, player in players:
            command = player.decide(engine)
            if command is not None:
                engine.submit_input(player_id, command)
        before = {player_id: engine.fighter(player_id).stunned_ticks for player_id in ids}
        fighting = engine.phase is MatchPhase.FIGHT
        snapshot = engine.step()
        if fighting:
            fight_ticks += 1
            stunned_ticks += sum(1 for player_id in ids if engine.fighter(player_id).stunned_ticks)
        blocked_punches = {
            event.action_id
            for event in snapshot.events
            if event.kind in ("block", "perfect_block") and event.action_id is not None
        }
        for event in snapshot.events:
            seat = ids.index(event.actor_id) if event.actor_id in ids else None
            if event.kind == "punch_start" and seat is not None:
                thrown[seat] += 1
            elif event.kind in ("hit", "counter_hit") and seat is not None:
                if event.action_id not in blocked_punches:
                    landed[seat] += 1
                    landed_by_round[seat][snapshot.round_number - 1] += 1
            elif event.kind == "stun" and event.target_id in ids:
                stuns += 1
                if before[event.target_id] > 0:
                    chained += 1
            elif event.kind == "knockdown" and event.target_id in ids:
                if before[event.target_id] > 0:
                    stunned_knockdowns += 1
            elif event.kind == "corner" and event.detail:
                corner_picks[event.detail] += 1
    result = engine.result
    winner = None if result.winner_id is None else ids.index(result.winner_id)
    return BoutStats(
        winner_seat=winner,
        method=result.finish_method.value,
        rounds=result.round_number,
        fight_seconds=fight_ticks / TICKS_PER_SECOND,
        knockdowns=result.player_one_knockdowns + result.player_two_knockdowns,
        thrown=thrown,
        landed=landed,
        stunned_ticks=stunned_ticks,
        fight_ticks=fight_ticks,
        stuns=stuns,
        chained_stuns=chained,
        stunned_knockdowns=stunned_knockdowns,
        corner_picks=corner_picks,
        landed_by_round=[seat[: result.round_number] for seat in landed_by_round],
    )


def bout_styles(one: str, two: str, seed: int) -> tuple[FighterStyle, FighterStyle]:
    """Against a scripted player the computer fights in the style the room would give it for
    this match seed; between two computer levels both box balanced, as the style matrix varies."""
    if one in HUMAN_STRATEGIES and two not in HUMAN_STRATEGIES:
        return FighterStyle.BALANCED, cpu_style(CpuLevel(two), seed)
    return FighterStyle.BALANCED, FighterStyle.BALANCED


def standard_error(share: float, count: int) -> float:
    """The standard error of a share measured over `count` bouts."""
    return sqrt(share * (1 - share) / max(1, count))


def summarise(one: str, two: str, bouts: list[BoutStats], elapsed: float) -> str:
    count = len(bouts)
    methods = Counter(bout.method for bout in bouts)
    wins = Counter(bout.winner_seat for bout in bouts)
    share = (wins[0] + wins[None] / 2) / max(1, count)
    rounds = sum(bout.rounds for bout in bouts)
    fight_seconds = sum(bout.fight_seconds for bout in bouts)
    knockdowns = sum(bout.knockdowns for bout in bouts)
    stunned = sum(bout.stunned_ticks for bout in bouts)
    fight_ticks = sum(bout.fight_ticks for bout in bouts) or 1
    stuns = sum(bout.stuns for bout in bouts)
    chained = sum(bout.chained_stuns for bout in bouts)
    stunned_knockdowns = sum(bout.stunned_knockdowns for bout in bouts)
    picks: Counter[str] = Counter()
    for bout in bouts:
        picks.update(bout.corner_picks)
    blank = [
        sum(punches == 0 for bout in bouts for punches in bout.landed_by_round[seat])
        for seat in (0, 1)
    ]
    per_round = [
        (
            sum(bout.thrown[seat] for bout in bouts) / max(1, rounds),
            sum(bout.landed[seat] for bout in bouts) / max(1, rounds),
        )
        for seat in (0, 1)
    ]
    finishes = ", ".join(f"{method} {methods[method]}" for method in sorted(methods))
    lines = [
        f"{one} v {two}: {count} bouts in {elapsed:.0f}s | wins {wins[0]}-{wins[1]}"
        f" (draws {wins[None]}), {one} {100 * share:.0f}% +-{100 * standard_error(share, count):.0f}"
        f" | {finishes}",
        f"  rounds {rounds / count:.2f} | fight time {fight_seconds / count:.0f}s"
        f" | knockdowns {knockdowns / count:.2f}/bout ({stunned_knockdowns} while stunned)"
        f" | stunned {100 * stunned / (2 * fight_ticks):.1f}% of fighter-time"
        f" | stuns {stuns / count:.1f}/bout, {100 * chained / max(1, stuns):.0f}% re-stunned",
        f"  per round thrown/landed clean: one {per_round[0][0]:.0f}/{per_round[0][1]:.0f}"
        f", two {per_round[1][0]:.0f}/{per_round[1][1]:.0f}"
        f" | rounds landing nothing: one {blank[0]}/{rounds}, two {blank[1]}/{rounds}"
        + (f" | corner picks {dict(picks)}" if picks else ""),
    ]
    return "\n".join(lines)


def matrix_sides(spec: str) -> tuple[str, str]:
    """The players a matrix spec names: one level or strategy on both sides, or "one:two"."""
    one, _, two = spec.partition(":")
    return one, two or one


def style_matrix(
    spec: str,
    styles: list[FighterStyle],
    seeds: range,
    config: EngineConfig,
    lag: Lag | None = None,
) -> str:
    """Every pair of styles between the players `spec` names, each seed with each style on each
    side, so neither style gains from the stronger side; a draw counts as half."""
    one, two = matrix_sides(spec)
    count = 2 * len(seeds)
    share: dict[tuple[FighterStyle, FighterStyle], float] = {}
    lines = []
    for index, first in enumerate(styles):
        for second in styles[index + 1 :]:
            started = time.perf_counter()
            points = 0.0
            methods: Counter[str] = Counter()
            for seed in seeds:
                for corners in ((first, second), (second, first)):
                    bout = play(one, two, seed, config, corners, lag)
                    methods[bout.method] += 1
                    if bout.winner_seat is None:
                        points += 0.5
                    elif corners[bout.winner_seat] is first:
                        points += 1
            share[first, second] = points / count
            share[second, first] = 1 - share[first, second]
            finishes = ", ".join(f"{method} {methods[method]}" for method in sorted(methods))
            lines.append(
                f"  {first.value} v {second.value}: {cell(share[first, second], count)}"
                f" | {finishes} | {time.perf_counter() - started:.0f}s"
            )
    width = max(len(style.value) for style in styles) + 2
    table = [
        f"{spec}: win % of the row's style against the column's, +- one standard error,"
        f" {count} bouts a pair, seeds {seeds.start}-{seeds.stop - 1}",
        " " * width + "".join(f"{style.value[:8]:>9}" for style in styles),
    ]
    for row in styles:
        cells = "".join(
            f"{'-' if row is column else cell(share[row, column], count):>9}" for column in styles
        )
        table.append(f"{row.value:<{width}}{cells}")
    worst = max(share, key=lambda pair: share[pair])
    table.append(f"widest: {worst[0].value} beats {worst[1].value} {cell(share[worst], count)}")
    return "\n".join(table + lines)


def cell(share: float, count: int) -> str:
    return f"{100 * share:.0f}+-{100 * standard_error(share, count):.0f}"


def parse_lag(args: argparse.Namespace) -> Lag | None:
    """The connection the scripted humans play on, or None for none at all."""
    if not (args.reaction or args.latency_ticks or args.uplink_ticks or args.rtt_ms is not None):
        return None
    low, _, high = (args.reaction or str(HUMAN_REACTION_TICKS)).partition("-")
    reaction = (int(low), int(high or low))
    if args.rtt_ms is not None:
        return Lag.over(args.rtt_ms, reaction)
    return Lag(reaction, args.latency_ticks, args.uplink_ticks)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--matchups", default=",".join(DEFAULT_MATCHUPS))
    parser.add_argument("--humans", default="", help="scripted strategies to play every level")
    parser.add_argument("--levels", default=",".join(level.value for level in CpuLevel))
    parser.add_argument("--seeds", type=int, default=12)
    parser.add_argument("--first-seed", type=int, default=None, help="1, or 101 for a matrix")
    parser.add_argument(
        "--style-matrix",
        default="",
        help="levels, strategies or strategy pairs (skilled:brawler) to play every style pair at",
    )
    parser.add_argument("--styles", default=",".join(style.value for style in FighterStyle))
    parser.add_argument("--reaction", default="", help="a human's reaction to a punch, e.g. 6-9")
    parser.add_argument("--latency-ticks", type=int, default=0, help="ticks late he sees a punch")
    parser.add_argument("--uplink-ticks", type=int, default=0, help="ticks before he is heard")
    parser.add_argument("--rtt-ms", type=float, default=None, help="a round trip, half each way")
    args = parser.parse_args()
    config = EngineConfig()
    lag = parse_lag(args)
    if lag is not None:
        print(
            f"scripted humans react in {lag.reaction[0]}-{lag.reaction[1]} ticks, see a punch"
            f" {lag.latency_ticks} late and are heard {lag.uplink_ticks} late",
            flush=True,
        )
    if args.style_matrix:
        styles = [FighterStyle(style) for style in args.styles.split(",")]
        first = HELD_OUT_FIRST_SEED if args.first_seed is None else args.first_seed
        seeds = range(first, first + args.seeds)
        for spec in args.style_matrix.split(","):
            print(style_matrix(spec, styles, seeds, config, lag), flush=True)
        return
    if args.humans:
        pairs = [
            (human, level) for human in args.humans.split(",") for level in args.levels.split(",")
        ]
    else:
        pairs = [tuple(matchup.split(":", 1)) for matchup in args.matchups.split(",")]  # type: ignore[misc]
    for one, two in pairs:
        started = time.perf_counter()
        first = 1 if args.first_seed is None else args.first_seed
        bouts = [
            play(one, two, seed, config, bout_styles(one, two, seed), lag)
            for seed in range(first, first + args.seeds)
        ]
        print(summarise(one, two, bouts, time.perf_counter() - started), flush=True)


if __name__ == "__main__":
    main()
