#!/usr/bin/env python3
"""Measure how Hands bouts play out, with computer boxers on both sides.

Runs whole bouts in-process through the authoritative engine under the default rules (three
rounds of two minutes, fifteen-second rests) between computer levels, or between a scripted
human strategy and a computer level, and prints how the bouts end, how long they last, the
knockdowns, the punch output and how much of the fight is spent stunned. Every bout is
deterministic for its seed. With --style-matrix it plays every pair of fighting styles against
each other at one computer level, from both corners, and prints how often each style wins.

    uv run python scripts/hands_balance.py --seeds 12
    uv run python scripts/hands_balance.py --humans jabs,hooks,turtle,brawler,counter --seeds 8
    uv run python scripts/hands_balance.py --style-matrix contender,champion --seeds 12
"""

from __future__ import annotations

import argparse
import time
from collections import Counter
from dataclasses import dataclass, field
from math import hypot
from typing import ClassVar, Protocol

from intelstream.hands.cpu import CpuBrain, CpuLevel
from intelstream.hands.engine import BoxingEngine, EngineConfig, FighterState
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
HUMAN_STRATEGIES = ("jabs", "hooks", "turtle", "brawler", "counter", "skilled")
HUMAN_REACTION_TICKS = 7


class Player(Protocol):
    def decide(self, engine: BoxingEngine) -> InputCommand | None: ...


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

    def __init__(self, player_id: str, opponent_id: str) -> None:
        self.player_id = player_id
        self.opponent_id = opponent_id
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
        side = 1 if (tick // 75) % 2 == 0 else -1
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
            and tick - attack.start_tick >= HUMAN_REACTION_TICKS
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
            and tick - attack.start_tick >= HUMAN_REACTION_TICKS
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
            self._next_jab = tick + 24 + (tick * 7919) % 18
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
    - counter: holds a guard at range and answers each punch once a human could have seen it.
    """

    WANTED_DISTANCE: ClassVar[dict[str, int]] = {
        "jabs": 135,
        "hooks": 100,
        "turtle": 120,
        "brawler": 112,
        "counter": 150,
    }

    def __init__(self, kind: str, player_id: str, opponent_id: str) -> None:
        if kind not in self.WANTED_DISTANCE:
            raise ValueError(f"unknown strategy {kind!r}")
        self.kind = kind
        self.player_id = player_id
        self.opponent_id = opponent_id
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
        if engine.phase is not MatchPhase.FIGHT:
            return self._command(tick)
        dx, dy = them.x - me.x, them.y - me.y
        distance = max(1.0, hypot(dx, dy))
        wanted = self.WANTED_DISTANCE[self.kind]
        toward = (round(dx / distance * 1000), round(dy / distance * 1000))
        move = toward if distance > wanted else (0, 0)
        guarded = self.kind in ("turtle", "brawler", "counter")
        defense = DefensivePose.GUARD_HIGH if guarded else DefensivePose.NONE
        roll = (tick * 2654435761 + self._sequence) % 1000
        free = me.attack is None and not me.pending_actions
        if self.kind == "counter":
            if distance < wanted - 10:
                move = (-toward[0], -toward[1])
            attack = them.attack
            seen = attack is not None and tick - attack.start_tick >= HUMAN_REACTION_TICKS
            if seen and attack is not None and attack.resolved and free and distance <= 160:
                punch = PunchClass.STRAIGHT if distance > 120 else PunchClass.HOOK
                return self._command(tick, actions=(PunchAction(Hand.RIGHT, punch, Target.HEAD),))
            if tick >= self._next_tick and free and distance <= 150 and roll < 300:
                self._next_tick = tick + 20
                jab = PunchAction(Hand.LEFT, PunchClass.JAB, Target.HEAD)
                return self._command(tick, move, actions=(jab,))
            return self._command(tick, move, defense)
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


def make_player(
    spec: str,
    player_id: str,
    opponent_id: str,
    seed: int,
    style: FighterStyle = FighterStyle.BALANCED,
) -> Player:
    if spec == "skilled":
        return SkilledHuman(player_id, opponent_id)
    if spec in HUMAN_STRATEGIES:
        return ScriptedHuman(spec, player_id, opponent_id)
    return CpuBrain(player_id, opponent_id, CpuLevel(spec), seed, style)


def play(
    one: str,
    two: str,
    seed: int,
    config: EngineConfig,
    styles: tuple[FighterStyle, FighterStyle] = (FighterStyle.BALANCED, FighterStyle.BALANCED),
) -> BoutStats:
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
    players = (
        ("one", make_player(one, "one", "two", seed * 2 + 1, styles[0])),
        ("two", make_player(two, "two", "one", seed * 2 + 2, styles[1])),
    )
    ids = ("one", "two")
    thrown = [0, 0]
    landed = [0, 0]
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
    )


def summarise(one: str, two: str, bouts: list[BoutStats], elapsed: float) -> str:
    count = len(bouts)
    methods = Counter(bout.method for bout in bouts)
    wins = Counter(bout.winner_seat for bout in bouts)
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
        f" (draws {wins[None]}) | {finishes}",
        f"  rounds {rounds / count:.2f} | fight time {fight_seconds / count:.0f}s"
        f" | knockdowns {knockdowns / count:.2f}/bout ({stunned_knockdowns} while stunned)"
        f" | stunned {100 * stunned / (2 * fight_ticks):.1f}% of fighter-time"
        f" | stuns {stuns / count:.1f}/bout, {100 * chained / max(1, stuns):.0f}% re-stunned",
        f"  per round thrown/landed clean: one {per_round[0][0]:.0f}/{per_round[0][1]:.0f}"
        f", two {per_round[1][0]:.0f}/{per_round[1][1]:.0f}"
        + (f" | corner picks {dict(picks)}" if picks else ""),
    ]
    return "\n".join(lines)


def style_matrix(level: str, styles: list[FighterStyle], seeds: range, config: EngineConfig) -> str:
    """Every pair of styles at one level, each seed from both corners; a draw counts as half."""
    share: dict[tuple[FighterStyle, FighterStyle], float] = {}
    lines = []
    for index, first in enumerate(styles):
        for second in styles[index + 1 :]:
            started = time.perf_counter()
            points = 0.0
            methods: Counter[str] = Counter()
            for seed in seeds:
                for corners in ((first, second), (second, first)):
                    bout = play(level, level, seed, config, corners)
                    methods[bout.method] += 1
                    if bout.winner_seat is None:
                        points += 0.5
                    elif corners[bout.winner_seat] is first:
                        points += 1
            share[first, second] = 100 * points / (2 * len(seeds))
            share[second, first] = 100 - share[first, second]
            finishes = ", ".join(f"{method} {methods[method]}" for method in sorted(methods))
            lines.append(
                f"  {first.value} v {second.value}: {share[first, second]:.0f}%"
                f" | {finishes} | {time.perf_counter() - started:.0f}s"
            )
    width = max(len(style.value) for style in styles) + 2
    table = [
        f"{level}: win % of the row's style against the column's, {2 * len(seeds)} bouts a pair",
        " " * width + "".join(f"{style.value[:8]:>9}" for style in styles),
    ]
    for row in styles:
        cells = "".join(
            f"{'-':>9}" if row is column else f"{share[row, column]:>9.0f}" for column in styles
        )
        table.append(f"{row.value:<{width}}{cells}")
    worst = max(share, key=lambda pair: share[pair])
    table.append(f"widest: {worst[0].value} beats {worst[1].value} {share[worst]:.0f}%")
    return "\n".join(table + lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--matchups", default=",".join(DEFAULT_MATCHUPS))
    parser.add_argument("--humans", default="", help="scripted strategies to play every level")
    parser.add_argument("--levels", default=",".join(level.value for level in CpuLevel))
    parser.add_argument("--seeds", type=int, default=12)
    parser.add_argument("--first-seed", type=int, default=1)
    parser.add_argument("--style-matrix", default="", help="levels to play every style pair at")
    parser.add_argument("--styles", default=",".join(style.value for style in FighterStyle))
    args = parser.parse_args()
    config = EngineConfig()
    if args.style_matrix:
        styles = [FighterStyle(style) for style in args.styles.split(",")]
        seeds = range(args.first_seed, args.first_seed + args.seeds)
        for level in args.style_matrix.split(","):
            print(style_matrix(level, styles, seeds, config), flush=True)
        return
    if args.humans:
        pairs = [
            (human, level) for human in args.humans.split(",") for level in args.levels.split(",")
        ]
    else:
        pairs = [tuple(matchup.split(":", 1)) for matchup in args.matchups.split(",")]  # type: ignore[misc]
    for one, two in pairs:
        started = time.perf_counter()
        bouts = [
            play(one, two, seed, config)
            for seed in range(args.first_seed, args.first_seed + args.seeds)
        ]
        print(summarise(one, two, bouts, time.perf_counter() - started), flush=True)


if __name__ == "__main__":
    main()
