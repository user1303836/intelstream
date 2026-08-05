#!/usr/bin/env python3
"""Generate the deterministic golden Hands replay for the /hands/lab harness.

Runs the authoritative BoxingEngine with a fixed seed and a scripted command
schedule, recording every tick's protocol-encoded snapshot plus attack
internals. The output feeds the browser lab (pause/step/slow-mo/overlay) and
the latency/timing report. Re-running must produce byte-identical JSON.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from intelstream.hands.engine import BoxingEngine, EngineConfig
from intelstream.hands.protocol import encode_snapshot
from intelstream.hands.types import (
    DefensivePose,
    Hand,
    InputCommand,
    MatchPhase,
    Power,
    PunchAction,
    PunchClass,
    Target,
)

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "web" / "hands" / "replays" / "golden.json"


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
            rest_ticks=10,
            countdown_ticks=0,
            flash_ko_enabled=False,
            doctor_cut_threshold=700,
            doctor_swelling_threshold=820,
        ),
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


def jab(sequence: int, defense: DefensivePose = DefensivePose.NONE) -> InputCommand:
    return command(
        sequence,
        defense=defense,
        actions=(PunchAction(Hand.LEFT, PunchClass.JAB, Target.HEAD, Power.NORMAL),),
    )


def straight(sequence: int) -> InputCommand:
    return command(
        sequence,
        actions=(PunchAction(Hand.RIGHT, PunchClass.STRAIGHT, Target.HEAD, Power.NORMAL),),
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

    engine = lab_engine(20260805)
    two = engine.fighter("two")

    schedule: dict[int, dict[str, InputCommand]] = {}
    one_sequence = 0
    two_sequence = 0

    def schedule_at(
        tick: int, *, one: InputCommand | None = None, two_cmd: InputCommand | None = None
    ) -> None:
        frame: dict[str, InputCommand] = {}
        if one is not None:
            frame["one"] = one
        if two_cmd is not None:
            frame["two"] = two_cmd
        schedule.setdefault(tick, {}).update(frame)

    # Fight-phase command schedule (planned against absolute ticks after the
    # countdown is observed; the schedule is built dynamically below).
    ticks: list[dict] = []
    timeline: list[dict] = []
    stage = "countdown"
    jab_count = 0
    guard_engaged = False
    straight_thrown = False
    knockdown_tick: int | None = None
    max_ticks = 4000

    for _ in range(max_ticks):
        tick = engine.tick
        inputs = schedule.get(tick, {})

        if stage == "countdown":
            if engine.phase is MatchPhase.FIGHT:
                stage = "approach"
        elif stage == "approach":
            one = engine.fighter("one")
            distance = abs(two.x - one.x)
            if distance > 140:
                one_sequence += 1
                inputs["one"] = command(one_sequence, move_x=1000)
            else:
                stage = "guard"
        elif stage == "guard":
            if not guard_engaged:
                two_sequence += 1
                inputs["two"] = command(two_sequence, defense=DefensivePose.GUARD_HIGH)
                guard_engaged = True
            else:
                stage = "jab_one"
        elif stage == "jab_one":
            if jab_count == 0:
                one_sequence += 1
                two_sequence += 1
                inputs["one"] = jab(one_sequence)
                inputs["two"] = command(two_sequence, defense=DefensivePose.GUARD_HIGH)
                jab_count = 1
                timeline.append({"marker": "jab_1_submit", "tick": tick})
            elif engine.fighter("one").attack is None and tick > timeline[-1]["tick"] + 12:
                stage = "reset"
        elif stage == "reset":
            one_sequence += 1
            two_sequence += 1
            inputs["one"] = command(one_sequence)
            inputs["two"] = command(two_sequence, defense=DefensivePose.GUARD_HIGH)
            if tick > timeline[-1]["tick"] + 26:
                stage = "jab_two"
        elif stage == "jab_two":
            one_sequence += 1
            two_sequence += 1
            inputs["one"] = jab(one_sequence)
            inputs["two"] = command(two_sequence, defense=DefensivePose.GUARD_HIGH)
            jab_count = 2
            timeline.append({"marker": "jab_2_submit", "tick": tick})
            stage = "straight_wait"
        elif stage == "straight_wait":
            if engine.fighter("one").attack is None and tick > timeline[-1]["tick"] + 12:
                stage = "straight"
        elif stage == "straight" and not straight_thrown:
            two.poise = 1
            one_sequence += 1
            two_sequence += 1
            inputs["one"] = straight(one_sequence)
            inputs["two"] = command(two_sequence)
            straight_thrown = True
            timeline.append({"marker": "straight_submit", "tick": tick})
        if knockdown_tick is None and engine.phase is MatchPhase.KNOCKDOWN:
            knockdown_tick = tick
            timeline.append({"marker": "knockdown", "tick": tick})
        if knockdown_tick is not None and tick > knockdown_tick + 40:
            break

        snapshot = engine.step(inputs if inputs else None)
        ticks.append(
            {
                "tick": snapshot.tick,
                "snapshot": json.loads(encode_snapshot(snapshot, viewer_id="one")),
                "attack_one": attack_internals(engine, "one"),
                "attack_two": attack_internals(engine, "two"),
            }
        )
    else:
        raise SystemExit("golden replay did not reach knockdown within the tick budget")

    if knockdown_tick is None:
        raise SystemExit("golden replay ended without a knockdown")

    document = {
        "format": 1,
        "seed": 20260805,
        "tick_rate": 30,
        "setup": {"two_poise_set_before_straight": 1},
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
    OUTPUT.write_text(encoded)
    print(f"wrote {OUTPUT} ({len(ticks)} ticks, sha256 {digest})")
    for marker in timeline:
        print(f"  {marker['marker']}: tick {marker['tick']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
