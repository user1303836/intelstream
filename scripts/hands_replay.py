#!/usr/bin/env python3
"""Generate the deterministic golden Hands replay for the /hands/lab harness.

Runs the authoritative BoxingEngine with a fixed seed and a scripted command
schedule, recording every tick's protocol-encoded snapshot plus attack
internals. The output feeds the browser lab (pause/step/slow-mo/overlay) and
the latency/timing report. Re-running must produce byte-identical JSON.

A boxer fights a slugger through the rules the snapshot checksum is there to
lock in: two jabs into the guard and a straight that drops the man behind it,
who beats the count and takes the standing eight; off the x axis, a circle that
takes an angle on the man who stands, so his straight goes past, and a jab whose
recovery the straight behind it cuts short; a power straight that rocks a hurt
man and a punch landing inside the stun it started; a clinch the referee breaks;
a low blow, the warning and the referee sending them apart; a clinch broken by
the bell; the rest, the walk to the corners and the corners' work; and in round
two a body shot that drops a man with his body broken down a moment later. The
script stops with an error if any of them stops happening.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from math import isqrt
from pathlib import Path

from intelstream.hands.engine import BoxingEngine, EngineConfig, FighterState
from intelstream.hands.protocol import encode_snapshot
from intelstream.hands.types import (
    ActionKind,
    DefensivePose,
    FighterStyle,
    Foul,
    FoulAction,
    Hand,
    InputCommand,
    MatchPhase,
    MovementAction,
    Power,
    PunchAction,
    PunchClass,
    Target,
)

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "web" / "hands" / "replays" / "golden.json"
SEED = 20260805
STYLES = (FighterStyle.BOXER, FighterStyle.SLUGGER)
# Long enough for both to walk to their corners and turn round to sit facing the ring.
REST_TICKS = 240
MAX_TICKS = 4000
JAB = PunchAction(Hand.LEFT, PunchClass.JAB, Target.HEAD, Power.NORMAL)
STRAIGHT = PunchAction(Hand.RIGHT, PunchClass.STRAIGHT, Target.HEAD, Power.NORMAL)
# Events marked on the timeline, by the stage of the schedule they come in.
MARKED_EVENTS = {
    ("get_up", "get_up"): "get_up",
    ("get_up", "box"): "box",
    ("outflanked", "whiff"): "outflanked_whiff",
    ("rocked", "stun"): "rocked",
    ("rocked", "hit"): "hit_inside_the_stun",
    ("clinch", "clinch"): "clinch",
    ("clinch", "referee_break"): "referee_break",
    ("foul", "foul"): "foul",
    ("foul", "resume"): "resume",
    ("bell_clinch", "clinch"): "clinch_before_the_bell",
    ("bell_clinch", "bell"): "round_end",
    ("rest", "corner"): "corner",
    ("rest", "bell"): "round_start",
    ("round_two", "body_collapse"): "body_collapse",
    ("round_two", "knockdown"): "body_knockdown",
}
REQUIRED_MARKERS = (
    "knockdown",
    "get_up",
    "box",
    "outflanked_whiff",
    "recovery_cancel",
    "rocked",
    "hit_inside_the_stun",
    "clinch",
    "referee_break",
    "foul",
    "resume",
    "clinch_before_the_bell",
    "round_end",
    "bell_breaks_the_clinch",
    "corner",
    "round_start",
    "body_collapse",
    "body_knockdown",
)


def lab_engine(seed: int) -> BoxingEngine:
    engine = BoxingEngine(
        match_id=f"match-{seed}",
        activity_instance_id="instance-1",
        guild_id="guild-1",
        player_one_id="one",
        player_two_id="two",
        seed=seed,
        config=EngineConfig(
            rounds=3,
            round_ticks=1_000_000,
            rest_ticks=REST_TICKS,
            countdown_ticks=0,
            flash_ko_enabled=False,
            doctor_cut_threshold=700,
            doctor_swelling_threshold=820,
        ),
        styles=STYLES,
    )
    engine.fighter("one").x = -300
    engine.fighter("two").x = 300
    return engine


def command(
    sequence: int,
    *,
    move_x: int = 0,
    move_y: int = 0,
    defense: DefensivePose = DefensivePose.NONE,
    actions: tuple = (),
) -> InputCommand:
    return InputCommand(
        sequence=sequence,
        client_tick=sequence,
        move_x=move_x,
        move_y=move_y,
        defense=defense,
        actions=actions,
    )


def _part(value: int, scale: int, distance: int) -> int:
    magnitude = abs(value) * scale // distance
    return magnitude if value >= 0 else -magnitude


def gap(mover: FighterState, other: FighterState) -> int:
    return isqrt((other.x - mover.x) ** 2 + (other.y - mover.y) ** 2)


def heading(mover: FighterState, other: FighterState) -> tuple[int, int]:
    """A full-speed walk straight at the other man."""
    distance = max(1, gap(mover, other))
    return (
        _part(other.x - mover.x, 1000, distance),
        _part(other.y - mover.y, 1000, distance),
    )


def circling(mover: FighterState, other: FighterState, *, keep: int) -> tuple[int, int]:
    """A full-speed walk anticlockwise round the other man, closing or opening to `keep`."""
    dx, dy = other.x - mover.x, other.y - mover.y
    distance = max(1, gap(mover, other))
    radial = max(-1000, min(1000, (distance - keep) * 50))
    return (
        _part(-dy, 1000, distance) + _part(dx * radial, 1, distance),
        _part(dx, 1000, distance) + _part(dy * radial, 1, distance),
    )


def attack_internals(engine: BoxingEngine, player_id: str) -> dict | None:
    attack = engine.fighter(player_id).attack
    if attack is None:
        return None
    return {
        "class": attack.action.punch_class.value,
        "hand": attack.action.hand.value,
        "target": attack.action.target.value,
        "power": attack.action.power.value,
        "age": attack.age,
        "startup": attack.rule.startup,
        "active": attack.rule.active,
        "recovery": attack.rule.recovery,
        "resolved": attack.resolved,
        "combo_bonus": attack.combo_bonus,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check", action="store_true", help="verify the committed replay matches a fresh run"
    )
    args = parser.parse_args()

    engine = lab_engine(SEED)
    one = engine.fighter("one")
    two = engine.fighter("two")
    sequences = {"one": 0, "two": 0}

    def send(
        player_id: str,
        *,
        move: tuple[int, int] = (0, 0),
        defense: DefensivePose = DefensivePose.NONE,
        actions: tuple = (),
    ) -> InputCommand:
        sequences[player_id] += 1
        return command(
            sequences[player_id], move_x=move[0], move_y=move[1], defense=defense, actions=actions
        )

    ticks: list[dict] = []
    timeline: list[dict] = []
    setup: dict[str, object] = {"two_poise_set_before_straight": 1}

    def mark(name: str, tick: int) -> None:
        timeline.append({"marker": name, "tick": tick})

    stage = "countdown"
    stage_tick = 0
    seen: set[str] = set()
    submitted = 0
    guard_engaged = False
    straight_thrown = False
    knockdown_tick: int | None = None
    sent: dict[str, int] = {}
    end_tick: int | None = None

    for _ in range(MAX_TICKS):
        tick = engine.tick
        inputs: dict[str, InputCommand] = {}
        next_stage = stage

        # The opening exchange on the x axis: a jab into the guard twice, then a straight.
        if stage == "countdown":
            if engine.phase is MatchPhase.FIGHT:
                next_stage = "approach"
        elif stage == "approach":
            if abs(two.x - one.x) > 140:
                inputs["one"] = send("one", move=(1000, 0))
            else:
                next_stage = "guard"
        elif stage == "guard":
            if not guard_engaged:
                inputs["two"] = send("two", defense=DefensivePose.GUARD_HIGH)
                guard_engaged = True
            else:
                next_stage = "jab_one"
        elif stage == "jab_one":
            if "jab_one" not in sent:
                inputs["one"] = send("one", actions=(JAB,))
                inputs["two"] = send("two", defense=DefensivePose.GUARD_HIGH)
                sent["jab_one"] = submitted = tick
                mark("jab_1_submit", tick)
            elif one.attack is None and tick > submitted + 12:
                next_stage = "reset"
        elif stage == "reset":
            inputs["one"] = send("one")
            inputs["two"] = send("two", defense=DefensivePose.GUARD_HIGH)
            if tick > submitted + 26:
                next_stage = "jab_two"
        elif stage == "jab_two":
            inputs["one"] = send("one", actions=(JAB,))
            inputs["two"] = send("two", defense=DefensivePose.GUARD_HIGH)
            submitted = tick
            mark("jab_2_submit", tick)
            next_stage = "straight_wait"
        elif stage == "straight_wait":
            if one.attack is None and tick > submitted + 12:
                next_stage = "straight"
        elif stage == "straight" and not straight_thrown:
            two.poise = 1
            inputs["one"] = send("one", actions=(STRAIGHT,))
            inputs["two"] = send("two")
            straight_thrown = True
            mark("straight_submit", tick)

        # Two beats the count and takes the standing eight.
        elif stage == "get_up":
            prompt = two.get_up_prompt
            middle = (two.get_up_window_start_tick + two.get_up_window_end_tick) // 2
            if prompt is not None and not two.get_up_prompt_resolved and tick + 1 >= middle:
                inputs["two"] = send("two", actions=(MovementAction(prompt),))
            if engine.phase is MatchPhase.FIGHT:
                next_stage = "close_in"

        # Off the x axis: one circles the man who stands, takes an angle and lets his hands go.
        elif stage == "close_in":
            if gap(one, two) > 150:
                inputs["one"] = send("one", move=heading(one, two))
                inputs["two"] = send("two", move=heading(two, one))
            else:
                inputs["two"] = send("two")
                next_stage = "circle"
        elif stage == "circle":
            inputs["one"] = send("one", move=circling(one, two, keep=120))
            if tick - stage_tick >= 30:
                inputs["two"] = send("two", actions=(STRAIGHT,))
                mark("outflanked_straight_submit", tick)
                next_stage = "outflanked"
        elif stage == "outflanked":
            inputs["one"] = send("one", move=circling(one, two, keep=120))
            if two.attack is None and "whiff" in seen:
                next_stage = "combination"
        elif stage == "combination":
            # A jab, and the straight that cuts its recovery short.
            if "jab" not in sent:
                inputs["one"] = send("one", actions=(JAB,))
                sent["jab"] = tick
            elif "straight" not in sent:
                inputs["one"] = send("one", actions=(STRAIGHT,))
                sent["straight"] = tick
            elif one.attack is None:
                next_stage = "rocked"

        # A hurt man rocked by a power straight, and hit again inside the stun it started.
        elif stage == "rocked":
            if "power" not in sent:
                if two.stunned_ticks == 0 and tick >= two.rocked_immune_until_tick:
                    two.poise = 170
                    setup["two_poise_set_before_power_straight"] = 170
                    power = PunchAction(Hand.RIGHT, PunchClass.STRAIGHT, Target.HEAD, Power.POWER)
                    inputs["one"] = send("one", actions=(power,))
                    sent["power"] = tick
            elif "inside" not in sent:
                if one.attack is None and two.stunned_ticks > 0:
                    inputs["one"] = send("one", actions=(STRAIGHT,))
                    sent["inside"] = tick
            elif one.attack is None and two.stunned_ticks == 0:
                next_stage = "clinch"

        # Two ties him up until the referee breaks them, then fouls him and is warned.
        elif stage == "clinch":
            if "clinch" not in sent:
                if gap(one, two) > 95:
                    inputs["two"] = send("two", move=heading(two, one))
                else:
                    inputs["two"] = send("two", actions=(MovementAction(ActionKind.CLINCH),))
                    sent["clinch"] = tick
            elif "referee_break" in seen:
                next_stage = "foul"
        elif stage == "foul":
            if "foul" not in sent:
                if gap(one, two) > 95:
                    inputs["two"] = send("two", move=heading(two, one))
                else:
                    inputs["two"] = send("two", actions=(FoulAction(Foul.LOW_BLOW),))
                    sent["foul"] = tick
            elif "resume" in seen:
                next_stage = "bell_clinch"

        # One ties him up in turn as the round ends: the bell breaks them, and they rest.
        elif stage == "bell_clinch":
            if "bell_clinch" not in sent:
                if gap(one, two) > 95:
                    inputs["one"] = send("one", move=heading(one, two))
                else:
                    inputs["one"] = send("one", actions=(MovementAction(ActionKind.CLINCH),))
                    sent["bell_clinch"] = tick
            elif "clinch" in seen and "bell" not in sent:
                engine.phase_ticks_remaining = 10
                setup["round_one_ends_ten_ticks_into_the_second_clinch"] = True
                sent["bell"] = tick
            elif engine.phase is MatchPhase.REST:
                next_stage = "rest"
        elif stage == "rest":
            if "corners" not in sent:
                inputs["one"] = send("one", actions=(MovementAction(ActionKind.CORNER_CUT),))
                inputs["two"] = send("two", actions=(MovementAction(ActionKind.CORNER_SWELLING),))
                sent["corners"] = tick
            elif engine.phase is MatchPhase.FIGHT:
                next_stage = "round_two"

        # Round two: a body shot on a man with his body broken down drops him a moment later.
        elif stage == "round_two":
            if "body" not in sent:
                if gap(one, two) > 105:
                    inputs["one"] = send("one", move=heading(one, two))
                    inputs["two"] = send("two", move=heading(two, one))
                else:
                    two.trauma.body = 700
                    two.stamina = 300
                    setup["two_body_and_stamina_set_before_the_body_hook"] = [700, 300]
                    body_hook = PunchAction(Hand.LEFT, PunchClass.HOOK, Target.BODY, Power.POWER)
                    inputs["one"] = send("one", actions=(body_hook,))
                    inputs["two"] = send("two")
                    sent["body"] = tick
            elif engine.phase is MatchPhase.KNOCKDOWN and end_tick is None:
                end_tick = tick + 40

        if knockdown_tick is None and engine.phase is MatchPhase.KNOCKDOWN:
            knockdown_tick = tick
            mark("knockdown", tick)
            next_stage = "get_up"
        if end_tick is not None and tick > end_tick:
            break
        if next_stage != stage:
            stage, stage_tick, seen = next_stage, tick, set()

        attack_before = one.attack
        stunned_before = two.stunned_ticks
        snapshot = engine.step(inputs if inputs else None)
        ticks.append(
            {
                "tick": snapshot.tick,
                "snapshot": json.loads(encode_snapshot(snapshot, viewer_id="one")),
                "attack_one": attack_internals(engine, "one"),
                "attack_two": attack_internals(engine, "two"),
            }
        )
        kinds = {event.kind for event in snapshot.events}
        seen |= kinds
        if attack_before is not None and one.attack not in (None, attack_before):
            # The follow-up started while the punch before it was still on: a recovery cancel.
            mark("recovery_cancel", snapshot.tick)
        for event in snapshot.events:
            name = MARKED_EVENTS.get((stage, event.kind))
            if name == "hit_inside_the_stun" and not stunned_before:
                continue
            if name is not None:
                mark(name, snapshot.tick)
        if stage == "bell_clinch" and {"bell", "referee_break"} <= kinds:
            mark("bell_breaks_the_clinch", snapshot.tick)
    else:
        raise SystemExit("golden replay did not finish its schedule within the tick budget")

    reached = {marker["marker"] for marker in timeline}
    missing = [name for name in REQUIRED_MARKERS if name not in reached]
    if missing:
        raise SystemExit(f"golden replay never reached: {', '.join(missing)}")

    document = {
        "format": 1,
        "seed": SEED,
        "tick_rate": 30,
        "styles": {"one": STYLES[0].value, "two": STYLES[1].value},
        "setup": setup,
        "markers": timeline,
        "ticks": ticks,
    }
    encoded = json.dumps(document, indent=1, sort_keys=True) + "\n"
    digest = hashlib.sha256(encoded.encode()).hexdigest()

    if args.check:
        existing = OUTPUT.read_text() if OUTPUT.exists() else ""
        if existing != encoded:
            raise SystemExit(f"golden replay mismatch: stored hash differs (fresh sha256 {digest})")
        print(f"golden replay deterministic: sha256 {digest}")
        return 0

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(encoded, newline="\n")
    print(f"wrote {OUTPUT} ({len(ticks)} ticks, sha256 {digest})")
    for marker in timeline:
        print(f"  {marker['marker']}: tick {marker['tick']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
