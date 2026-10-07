import { describe, expect, it } from "vitest";
import { snapshot } from "../test/fixtures";
import type { CombatEvent, EngineSnapshot } from "../types";
import { planKnockoutReplay, REPLAY_AFTER_TICKS, REPLAY_BEFORE_TICKS, REPLAY_SPEED, REPLAY_TAIL_SECONDS, replayTick } from "./replay";

const history = (from: number, to: number): EngineSnapshot[] => {
  const base = snapshot();
  const result: EngineSnapshot[] = [];
  for (let tick = from; tick <= to; tick += 1) result.push({ ...base, tick });
  return result;
};
const knockdown = (tick: number): CombatEvent => ({ event_id: 9, tick, kind: "knockdown", actor_id: "one", target_id: "two", amount: 1, detail: "", blood: 0, direction: 1, action_id: null });

describe("knockout replay plan", () => {
  it("covers the ticks before and after the knockdown at replay speed", () => {
    const plan = planKnockoutReplay(history(0, 200), knockdown(100));
    expect(plan).not.toBeNull();
    expect(plan!.fromTick).toBe(100 - REPLAY_BEFORE_TICKS);
    expect(plan!.toTick).toBe(100 + REPLAY_AFTER_TICKS);
    expect(plan!.snapshots[0]!.tick).toBeLessThanOrEqual(plan!.fromTick);
    expect(plan!.snapshots.at(-1)!.tick).toBeGreaterThanOrEqual(plan!.toTick);
    expect(plan!.durationSeconds).toBeCloseTo((REPLAY_BEFORE_TICKS + REPLAY_AFTER_TICKS) / 30 / REPLAY_SPEED + REPLAY_TAIL_SECONDS);
    expect(replayTick(plan!, 0)).toBe(plan!.fromTick);
    expect(replayTick(plan!, 1)).toBeCloseTo(plan!.fromTick + 30 * REPLAY_SPEED);
    expect(replayTick(plan!, 100)).toBe(plan!.toTick);
  });

  it("trims to the recording when it starts or ends inside the window", () => {
    const plan = planKnockoutReplay(history(80, 120), knockdown(100));
    expect(plan).not.toBeNull();
    expect(plan!.fromTick).toBe(80);
    expect(plan!.toTick).toBe(120);
  });

  it("declines when the recording does not reach the knockdown", () => {
    expect(planKnockoutReplay(history(0, 200), knockdown(5))).toBeNull();
    expect(planKnockoutReplay(history(0, 200), knockdown(195))).toBeNull();
    expect(planKnockoutReplay([], knockdown(100))).toBeNull();
    expect(planKnockoutReplay(history(0, 200).filter((item) => item.tick % 40 === 0), knockdown(100))).toBeNull();
  });
});
