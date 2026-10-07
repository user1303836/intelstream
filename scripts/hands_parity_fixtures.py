#!/usr/bin/env python3
"""Write the tables the client's prediction tests check against, taken from the real engine.

The client predicts a punch's timing and its fighter's footwork the way the engine will work them
out, so a press shows at once. Its tests check that against these files, and
tests/test_hands/test_parity_fixtures.py checks that the files still match the engine, so a rule
change that the client does not follow fails on one side or the other:

- punch-timing-table.json: startup and recovery of every punch for a balanced fighter, across
  conditioning and body trauma near the fatigue steps;
- style-timing-table.json: the same, with the stamina price, for every other style;
- movement-traces.json: what the engine sent, tick by tick, while a fighter holding a direction
  was parried, flinched mid-punch or finished a punch.

    uv run python scripts/hands_parity_fixtures.py          # rewrite the files
    uv run python scripts/hands_parity_fixtures.py --check  # fail if they are out of date
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

from intelstream.hands.engine import BoxingEngine, EngineConfig
from intelstream.hands.protocol import encode_snapshot
from intelstream.hands.rules import PUNCH_RULES, STYLE_RULES, style_punch_rule
from intelstream.hands.types import (
    DefensivePose,
    FighterStyle,
    Hand,
    InputCommand,
    Power,
    PunchAction,
    PunchClass,
    Stance,
    Target,
)

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "web" / "hands" / "src" / "test"
# Conditioning either side of the fatigue steps a punch's own cost can cross, and the extremes.
PUNCH_CONDITIONING = (0, 101, 260, 445, 553, 640, 695, 697, 699, 733, 820)
PUNCH_CONDITIONING += (839, 841, 843, 901, 947, 949, 951, 955, 983, 1000)
STYLE_CONDITIONING = (0, 260, 553, 820, 1000)
BODY_TRAUMA = (0, 900)


def _engine(styles: tuple[FighterStyle, FighterStyle], gap: int) -> BoxingEngine:
    engine = BoxingEngine(
        match_id="parity",
        activity_instance_id="parity",
        guild_id="parity",
        player_one_id="one",
        player_two_id="two",
        seed=1,
        config=EngineConfig(countdown_ticks=0, flash_ko_enabled=False),
        styles=styles,
    )
    engine.fighter("one").x = -(gap // 2)
    engine.fighter("two").x = gap - gap // 2
    return engine


def _punches() -> Iterator[tuple[str, PunchAction]]:
    for punch_class in PunchClass:
        for target in Target:
            for power in Power:
                for hand in Hand:
                    key = punch_class.value[0] + target.value[0] + power.value[0] + hand.value[0]
                    yield key, PunchAction(hand, punch_class, target, power)


def _timing(style: FighterStyle, action: PunchAction, conditioning: int, body: int) -> str:
    engine = _engine((style, FighterStyle.BALANCED), 360)
    fighter = engine.fighter("one")
    fighter.stance = Stance.ORTHODOX
    fighter.conditioning = conditioning
    fighter.trauma.body = body
    engine.step({"one": InputCommand(1, 1, actions=(action,))})
    attack = fighter.attack
    assert attack is not None
    return f"{attack.rule.startup},{attack.rule.recovery}"


def punch_timing_rows() -> list[str]:
    return [
        f"{key},{conditioning},{body},{_timing(FighterStyle.BALANCED, action, conditioning, body)}"
        for key, action in _punches()
        for conditioning in PUNCH_CONDITIONING
        for body in BODY_TRAUMA
    ]


def style_timing_rows() -> list[str]:
    rows = []
    for style in FighterStyle:
        if style is FighterStyle.BALANCED:
            continue
        for key, action in _punches():
            rule = PUNCH_RULES[(action.punch_class, action.target, action.power)]
            cost = style_punch_rule(rule, STYLE_RULES[style]).stamina_cost
            for conditioning in STYLE_CONDITIONING:
                for body in BODY_TRAUMA:
                    timing = _timing(style, action, conditioning, body)
                    rows.append(f"{style.value},{key},{conditioning},{body},{timing},{cost}")
    return rows


def _trace(
    engine: BoxingEngine, held: InputCommand, script: Callable[[int], dict[str, InputCommand]]
) -> list[dict[str, Any]]:
    """Steps `engine` for 45 ticks, fighter one holding `held` and `script(tick)` adding inputs,
    and records what the engine sends fighter one every tick, with the input he holds."""
    records = []
    for sequence in range(1, 46):
        inputs = script(engine.tick + 1)
        inputs.setdefault("one", InputCommand(sequence, sequence, held.move_x, held.move_y))
        snapshot = engine.step(inputs)
        payload = json.loads(encode_snapshot(snapshot, viewer_id="one"))["payload"]
        records.append(
            {
                "tick": snapshot.tick,
                "fighter": payload["fighters"][0],
                "events": payload["events"],
                "held": {"moveX": held.move_x, "moveY": held.move_y, "defense": "none"},
            }
        )
    return records


def movement_traces() -> dict[str, list[dict[str, Any]]]:
    back = InputCommand(0, 0, -1000, 0)
    straight = PunchAction(Hand.RIGHT, PunchClass.STRAIGHT, Target.HEAD, Power.POWER)
    parried = _engine((FighterStyle.BALANCED, FighterStyle.BALANCED), 130)
    contact = 1 + PUNCH_RULES[(PunchClass.STRAIGHT, Target.HEAD, Power.POWER)].startup

    def parry(tick: int) -> dict[str, InputCommand]:
        inputs = {}
        if tick == 1:
            inputs["one"] = InputCommand(tick, tick, back.move_x, back.move_y, actions=(straight,))
        if tick == contact - 2:
            inputs["two"] = InputCommand(tick, tick, defense=DefensivePose.GUARD_HIGH)
        return inputs

    return {"parried while holding back": _trace(parried, back, parry)}


def documents() -> dict[Path, str]:
    return {
        FIXTURES / "punch-timing-table.json": json.dumps(punch_timing_rows(), separators=(",", ":"))
        + "\n",
        FIXTURES / "style-timing-table.json": json.dumps(style_timing_rows()),
        FIXTURES / "movement-traces.json": json.dumps(
            movement_traces(), separators=(",", ":"), sort_keys=True
        )
        + "\n",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="fail if a file is out of date")
    args = parser.parse_args()
    stale = []
    for path, text in documents().items():
        current = path.read_text(encoding="utf-8") if path.exists() else None
        if current == text:
            continue
        stale.append(path.name)
        if not args.check:
            path.write_text(text, encoding="utf-8", newline="\n")
            print(f"wrote {path.relative_to(ROOT)}")
    if args.check and stale:
        raise SystemExit(f"out of date, run scripts/hands_parity_fixtures.py: {', '.join(stale)}")
    if not stale:
        print("client parity fixtures match the engine")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
