import { cancelsRecovery, punchStaminaCost, punchTiming, recoveryCancelAge } from "./manifest";
import { SnapshotBuffer } from "./interpolation";
import { attackTicksRemaining, canAffordPunch, constrainPrediction, fatigueFactor, MINIMUM_SEPARATION, MovementPrediction, movementLocked, predictMovement, predictedPunchTiming, type HeldInput } from "./prediction";
import { fighter, snapshot } from "./test/fixtures";
import timingTable from "./test/punch-timing-table.json";
import type { EngineSnapshot, FighterSnapshot, PunchClass } from "./types";

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

  it("mirrors the engine's recovery cancel: a landed, chained, affordable follow-up on a defender who is not stunned", () => {
    expect(recoveryCancelAge(punchTiming("straight", "head", "normal"))).toBe(6 + 2 + 5);
    expect(recoveryCancelAge(punchTiming("hook", "head", "normal"))).toBe(7 + 3 + 6);
    expect(recoveryCancelAge({ startup: 4, active: 2, recovery: 9 })).toBe(4 + 2 + 4);
    const hook = { class: "hook" as const, target: "head" as const, power: "normal" as const };
    expect(cancelsRecovery("straight", true, hook, 900, false)).toBe(true);
    expect(cancelsRecovery("straight", false, hook, 900, false)).toBe(false);
    expect(cancelsRecovery("straight", true, hook, 900, true)).toBe(false);
    expect(cancelsRecovery("straight", true, hook, punchStaminaCost("hook", "head", "normal") - 1, false)).toBe(false);
    expect(cancelsRecovery("straight", true, { ...hook, class: "jab" }, 900, false)).toBe(false);
    expect(cancelsRecovery("hook", true, { ...hook, class: "uppercut" }, 900, false)).toBe(true);
  });
});

describe("walking behind a round trip", () => {
  const PRESS_MS = 500;
  const RELEASE_MS = 1500;
  const TICK_MS = 1000 / 30;

  /**
   * Walks right from PRESS_MS to RELEASE_MS behind a round trip of `rtt` ms. The engine's integrator
   * steps at 30 Hz on inputs flushed at 30 Hz, `phase` ms out of step with its ticks; its snapshots go
   * into the client's real buffer, the client measures the input latency as the network does, and
   * 60 fps frames draw the fighter where the prediction puts him.
   */
  function walk(rtt: number, phase: number): { t: number; drawn: number; server: number }[] {
    const buffer = new SnapshotBuffer(8, 30);
    const prediction = new MovementPrediction();
    const heldAt = (t: number): HeldInput => ({ moveX: t >= PRESS_MS && t < RELEASE_MS ? 1000 : 0, moveY: 0, defense: "none" });
    const inputs: { arrives: number; held: HeldInput; sequence: number }[] = [];
    const snapshots: { arrives: number; snapshot: EngineSnapshot; acknowledged: number }[] = [];
    const sentAt = new Map<number, number>();
    let x = -200;
    let velocity = 0;
    let tick = 0;
    let applied = heldAt(0);
    let acknowledged = -1;
    let sequence = 0;
    let latency: number | null = null;
    let nextFlush = phase;
    let nextTick = 0;
    let lastFrame = -1;
    const drawn: { t: number; drawn: number; server: number }[] = [];
    for (let t = 0; t < 2600; t += 1) {
      if (t >= nextFlush) {
        sentAt.set(sequence, t);
        inputs.push({ arrives: t + rtt / 2, held: heldAt(t), sequence });
        sequence += 1;
        nextFlush += TICK_MS;
      }
      while (inputs.length > 0 && inputs[0]!.arrives <= t) {
        const frame = inputs.shift()!;
        applied = frame.held;
        acknowledged = frame.sequence;
      }
      if (t >= nextTick) {
        tick += 1;
        velocity = Math.max(-7, Math.min(7, (velocity + (applied.moveX * 7) / 1000) / 2));
        x += velocity;
        const base = snapshot(tick);
        const self = { ...fighter("one", x), conditioning: 1000, velocity_x: velocity };
        snapshots.push({ arrives: t + rtt / 2, snapshot: { ...base, fighters: [self, { ...base.fighters[1], x: 400 }] }, acknowledged });
        nextTick += TICK_MS;
      }
      while (snapshots.length > 0 && snapshots[0]!.arrives <= t) {
        const arrived = snapshots.shift()!;
        buffer.push(arrived.snapshot, t);
        const sent = sentAt.get(arrived.acknowledged);
        if (sent !== undefined) latency = latency === null ? t - sent : latency * 0.8 + (t - sent) * 0.2;
      }
      const frame = Math.floor((t * 60) / 1000);
      if (frame === lastFrame || buffer.latest() === null) continue;
      lastFrame = frame;
      const shown = buffer.sample(buffer.renderTick(t))!;
      const self = shown.fighters[0];
      const lead = ((latency ?? rtt) / 1000) * 30 + buffer.interpolationDelayTicks;
      const offset = constrainPrediction(self, prediction.update(self, heldAt(t), false, t, lead, shown.tick, 1 / 60, 30), shown.fighters[1]);
      drawn.push({ t, drawn: self.x + offset.dx, server: x });
    }
    return drawn;
  }

  for (const rtt of [120, 220]) {
    for (const phase of [0, 17]) {
      it(`sets off on the press and stops on the release at ${rtt} ms round trip (flush ${phase} ms off the tick)`, () => {
        const frames = walk(rtt, phase);
        const at = (ms: number): number => frames.find((frame) => frame.t >= ms)!.drawn;
        // Walking speed is 7 units a tick, 210 a second.
        expect(at(PRESS_MS + 150) - at(PRESS_MS)).toBeGreaterThan(20);
        const stallEnd = PRESS_MS + rtt + 100;
        expect(((at(stallEnd) - at(PRESS_MS + 150)) / (stallEnd - PRESS_MS - 150)) * 1000).toBeGreaterThan(0.75 * 210);
        const afterRelease = frames.filter((frame) => frame.t >= RELEASE_MS).map((frame) => frame.drawn);
        expect(Math.max(...afterRelease) - at(RELEASE_MS)).toBeLessThan(8);
        for (let index = 1; index < frames.length; index += 1) expect(frames[index - 1]!.drawn - frames[index]!.drawn).toBeLessThan(2.5);
        expect(Math.abs(frames.at(-1)!.drawn - frames.at(-1)!.server)).toBeLessThan(0.5);
      });
    }
  }
});
