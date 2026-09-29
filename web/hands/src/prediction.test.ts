import { punchStaminaCost } from "./manifest";
import { attackTicksRemaining, canAffordPunch, fatigueFactor, movementLocked, predictMovement, predictedPunchTiming } from "./prediction";
import { fighter } from "./test/fixtures";

describe("local movement prediction", () => {
  it("mirrors the authoritative fatigue factor", () => {
    expect(fatigueFactor(1000, 0)).toBe(100);
    expect(fatigueFactor(0, 0)).toBe(48);
    expect(fatigueFactor(820, 350)).toBe(100 - 10 - 10);
  });
  it("accelerates toward the held direction and never exceeds the speed cap", () => {
    const still = { ...fighter("one"), conditioning: 1000 };
    const one = predictMovement(still, { moveX: 1000, moveY: 0, defense: "none" }, 1);
    const four = predictMovement(still, { moveX: 1000, moveY: 0, defense: "none" }, 4);
    expect(one.dx).toBeCloseTo(3.5, 5);
    expect(one.dy).toBe(0);
    expect(four.dx).toBeGreaterThan(one.dx);
    expect(four.dx).toBeLessThanOrEqual(7 * 4);
    const diagonal = predictMovement(still, { moveX: 1000, moveY: 1000, defense: "none" }, 4);
    expect(Math.hypot(diagonal.dx, diagonal.dy)).toBeLessThanOrEqual(7 * 4 + 1e-9);
    expect(diagonal.dx).toBeCloseTo(diagonal.dy, 9);
  });
  it("slows while guarding and stops entirely while punching, stunned, or down", () => {
    const still = { ...fighter("one"), conditioning: 1000 };
    const guarded = predictMovement(still, { moveX: 1000, moveY: 0, defense: "guard_high" }, 4);
    const open = predictMovement(still, { moveX: 1000, moveY: 0, defense: "none" }, 4);
    expect(guarded.dx).toBeLessThan(open.dx);
    expect(guarded.dx).toBeGreaterThan(0);
    for (const locked of [
      { ...still, action: "jab" as const },
      { ...still, stunned_ticks: 5 },
      { ...still, is_downed: true },
      { ...still, defense: "weave" as const },
    ]) {
      expect(movementLocked(locked)).toBe(true);
      expect(predictMovement(locked, { moveX: 1000, moveY: 0, defense: "none" }, 4)).toEqual({ dx: 0, dy: 0 });
    }
    expect(movementLocked(still)).toBe(false);
  });
  it("frees the fighter when the punch ends even though the snapshot still presents it", () => {
    const still = { ...fighter("one"), conditioning: 1000 };
    const hook = { ...still, action: "hook" as const, action_start_tick: 100, action_startup_ticks: 7, action_active_ticks: 3, action_recovery_ticks: 12 };
    const held = { moveX: 1000, moveY: 0, defense: "none" as const };
    expect(attackTicksRemaining(hook, 110)).toBe(12);
    expect(attackTicksRemaining(hook, 122)).toBe(0);
    expect(attackTicksRemaining(hook, 130)).toBe(0);
    expect(movementLocked(hook, 110)).toBe(true);
    expect(movementLocked(hook, 122)).toBe(false);
    expect(predictMovement(hook, held, 4, 110)).toEqual({ dx: 0, dy: 0 });
    expect(predictMovement(hook, held, 4, 130)).toEqual(predictMovement(still, held, 4));
    const leaving = predictMovement(hook, held, 4, 120);
    expect(leaving.dx).toBeGreaterThan(0);
    expect(leaving.dx).toBeCloseTo(predictMovement(still, held, 2).dx);
    expect(predictMovement({ ...hook, stunned_ticks: 5 }, held, 4, 130)).toEqual({ dx: 0, dy: 0 });
    expect(predictMovement({ ...hook, queued_actions: 1 }, held, 4, 130)).toEqual({ dx: 0, dy: 0 });
    expect(movementLocked({ ...still, queued_actions: 1 }, 130)).toBe(true);
  });

  it("predicts the timing and cost the engine will use", () => {
    const fresh = { ...fighter("one"), conditioning: 1000, stance: "orthodox" as const };
    const jab = { class: "jab" as const, hand: "left" as const, target: "head" as const, power: "normal" as const };
    expect(predictedPunchTiming(fresh, jab)).toMatchObject({ startup: 3, active: 2, recovery: 7 });
    expect(predictedPunchTiming(fresh, { ...jab, hand: "right" })).toMatchObject({ startup: 4, recovery: 7 });
    expect(predictedPunchTiming({ ...fresh, stance: "southpaw" }, { ...jab, hand: "right" })).toMatchObject({ startup: 3 });
    const tired = { ...fresh, conditioning: 640 };
    expect(fatigueFactor(tired.conditioning, 0)).toBe(80);
    expect(predictedPunchTiming(tired, jab)).toMatchObject({ startup: 4, recovery: 8 });
    expect(predictedPunchTiming(tired, { ...jab, class: "hook", power: "power" })).toMatchObject({ startup: 11, active: 4, recovery: 18 });
    expect(punchStaminaCost("jab", "head", "normal")).toBe(42);
    expect(punchStaminaCost("jab", "body", "normal")).toBe(46);
    expect(punchStaminaCost("jab", "head", "power")).toBe(65);
    expect(punchStaminaCost("jab", "body", "power")).toBe(71);
    expect(canAffordPunch({ ...fresh, stamina: 38 }, jab)).toBe(true);
    expect(canAffordPunch({ ...fresh, stamina: 36 }, jab)).toBe(false);
  });

  it("carries existing velocity forward when the stick is released", () => {
    const moving = { ...fighter("one"), conditioning: 1000, velocity_x: 6 };
    const coast = predictMovement(moving, { moveX: 0, moveY: 0, defense: "none" }, 3);
    expect(coast.dx).toBeCloseTo(3 + 1.5 + 0.75, 5);
  });
});
