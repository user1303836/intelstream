import { punchStaminaCost } from "./manifest";
import { attackTicksRemaining, canAffordPunch, constrainPrediction, fatigueFactor, MINIMUM_SEPARATION, movementLocked, predictMovement, predictedPunchTiming } from "./prediction";
import { fighter } from "./test/fixtures";
import timingTable from "./test/punch-timing-table.json";
import type { FighterSnapshot, PunchClass } from "./types";

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
  it("slows while guarding and stops entirely while punching, slipping, or down", () => {
    const still = { ...fighter("one"), conditioning: 1000 };
    const guarded = predictMovement(still, { moveX: 1000, moveY: 0, defense: "guard_high" }, 4);
    const open = predictMovement(still, { moveX: 1000, moveY: 0, defense: "none" }, 4);
    expect(guarded.dx).toBeLessThan(open.dx);
    expect(guarded.dx).toBeGreaterThan(0);
    for (const locked of [
      { ...still, action: "jab" as const },
      { ...still, is_downed: true },
      { ...still, defense: "weave" as const },
    ]) {
      expect(movementLocked(locked)).toBe(true);
      expect(predictMovement(locked, { moveX: 1000, moveY: 0, defense: "none" }, 4)).toEqual({ dx: 0, dy: 0 });
    }
    expect(movementLocked(still)).toBe(false);
  });
  it("lets a stunned fighter stumble at the engine's share of his speed, with his guard down", () => {
    const still = { ...fighter("one"), conditioning: 1000, velocity_x: 0, velocity_y: 0 };
    const held = { moveX: 1000, moveY: 0, defense: "none" as const };
    const free = predictMovement(still, held, 6);
    const stunned = { ...still, stunned_ticks: 20 };
    const stumbling = predictMovement(stunned, held, 6);
    expect(movementLocked(stunned)).toBe(false);
    expect(stumbling.dx).toBeGreaterThan(0);
    expect(stumbling.dx).toBeLessThan(free.dx * 0.75);
    // Engine order: the stun counts down before the footwork, and a stunned fighter's guard is down.
    const lastStunnedTick = predictMovement({ ...still, stunned_ticks: 1 }, held, 1);
    expect(lastStunnedTick.dx).toBeCloseTo(free.dx === 0 ? 0 : predictMovement(still, held, 1).dx, 9);
    const guardDropped = predictMovement(stunned, { ...held, defense: "guard_high" }, 6);
    expect(guardDropped.dx).toBeCloseTo(stumbling.dx, 9);
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
    const stumbling = predictMovement({ ...hook, stunned_ticks: 5 }, held, 4, 130);
    expect(stumbling.dx).toBeGreaterThan(0);
    expect(stumbling.dx).toBeLessThan(predictMovement(still, held, 4).dx);
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
    expect(canAffordPunch({ ...fresh, stamina: 42 }, jab)).toBe(true);
    expect(canAffordPunch({ ...fresh, stamina: 41 }, jab)).toBe(false);
  });

  it("predicts the startup and recovery the engine gives every punch, its own cost taken off the conditioning first", () => {
    const classes: Record<string, PunchClass> = { j: "jab", s: "straight", h: "hook", u: "uppercut" };
    const mismatches: string[] = [];
    for (const row of timingTable as string[]) {
      const [key, conditioning, body, startup, recovery] = row.split(",") as [string, string, string, string, string];
      const base = fighter("one");
      const state: FighterSnapshot = { ...base, stance: "orthodox", conditioning: Number(conditioning), trauma: { ...base.trauma, body: Number(body) } };
      const timing = predictedPunchTiming(state, { class: classes[key[0]!]!, target: key[1] === "h" ? "head" : "body", power: key[2] === "p" ? "power" : "normal", hand: key[3] === "l" ? "left" : "right" });
      if (timing.startup !== Number(startup) || timing.recovery !== Number(recovery)) mismatches.push(`${row} -> ${timing.startup},${timing.recovery}`);
    }
    expect(timingTable.length).toBeGreaterThan(1000);
    expect(mismatches).toEqual([]);
  });

  it("charges a punch thrown inside the combination window at the engine's discount", () => {
    const afterJab = { ...fighter("one"), stance: "orthodox" as const, conditioning: 108, action: "jab" as const, action_start_tick: 100, action_startup_ticks: 3, action_active_ticks: 2, action_recovery_ticks: 7 };
    const straight = { class: "straight" as const, hand: "right" as const, target: "head" as const, power: "power" as const };
    expect(predictedPunchTiming(afterJab, straight, 110)).toMatchObject({ startup: 15, recovery: 25 });
    expect(predictedPunchTiming(afterJab, straight, 125)).toMatchObject({ startup: 16, recovery: 26 });
    expect(predictedPunchTiming(afterJab, { ...straight, class: "uppercut" }, 110)).toEqual(predictedPunchTiming(afterJab, { ...straight, class: "uppercut" }, 125));
  });

  it("keeps the predicted fighter inside the ropes and corner pads and clear of the opponent", () => {
    const held = { moveX: 1000, moveY: 0, defense: "none" as const };
    const onRope = { ...fighter("one", 462), conditioning: 1000 };
    const pressing = predictMovement(onRope, held, 4);
    expect(pressing.dx).toBeGreaterThan(10);
    expect(constrainPrediction(onRope, pressing, null).dx).toBeCloseTo(0, 9);
    const corner = { ...fighter("one", 400), y: 330 };
    const intoCorner = constrainPrediction(corner, { dx: 30, dy: 30 }, null);
    expect(Math.abs(corner.x + intoCorner.dx) + Math.abs(corner.y + intoCorner.dy)).toBeLessThanOrEqual(733 + 1e-9);
    const facing = { ...fighter("one", 0), conditioning: 1000 };
    const opponent = fighter("two", MINIMUM_SEPARATION);
    const closer = constrainPrediction(facing, predictMovement(facing, held, 4), opponent);
    expect(Math.hypot(facing.x + closer.dx - opponent.x, facing.y + closer.dy - opponent.y)).toBeGreaterThanOrEqual(MINIMUM_SEPARATION - 1e-9);
    const clinched = fighter("two", 60);
    expect(constrainPrediction(facing, { dx: 0, dy: 0 }, clinched)).toEqual({ dx: 0, dy: 0 });
    const away = constrainPrediction(facing, { dx: -12, dy: 0 }, opponent);
    expect(away.dx).toBeCloseTo(-12, 9);
  });

  it("carries existing velocity forward when the stick is released", () => {
    const moving = { ...fighter("one"), conditioning: 1000, velocity_x: 6 };
    const coast = predictMovement(moving, { moveX: 0, moveY: 0, defense: "none" }, 3);
    expect(coast.dx).toBeCloseTo(3 + 1.5 + 0.75, 5);
  });
});
