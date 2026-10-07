import { cancelsRecovery, punchStaminaCost, punchTiming, recoveryCancelAge, styledStaminaCost, styleTiming } from "./manifest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SnapshotBuffer } from "./interpolation";
import { attackTicksRemaining, constrainPrediction, EVASION_STAMINA, EVASION_TICKS, EvasionPrediction, fatigueFactor, MINIMUM_SEPARATION, MovementPrediction, movementLocked, parryRootedUntil, predictedDefense, predictMovement, predictedPunchTiming, type HeldInput } from "./prediction";
import { decodeServerFrame, ProtocolError } from "./protocol";
import { fighter, snapshot } from "./test/fixtures";
import movementTraces from "./test/movement-traces.json";
import timingTable from "./test/punch-timing-table.json";
import styleTimingTable from "./test/style-timing-table.json";
import { PROTOCOL_VERSION, type EngineSnapshot, type FighterSnapshot, type FighterStyle, type PunchClass } from "./types";

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
  });

  it("predicts the slow arm punch the engine throws for a fighter who cannot pay in full", () => {
    const fresh = { ...fighter("one"), conditioning: 1000, stance: "orthodox" as const };
    const jab = { class: "jab" as const, hand: "left" as const, target: "head" as const, power: "normal" as const };
    expect(predictedPunchTiming({ ...fresh, stamina: 42 }, jab)).toMatchObject({ startup: 3, recovery: 7 });
    expect(predictedPunchTiming({ ...fresh, stamina: 10 }, jab)).toMatchObject({ startup: 6, recovery: 12 });
    expect(predictedPunchTiming({ ...fresh, conditioning: 640, stamina: 41 }, jab)).toMatchObject({ startup: 7, recovery: 13 });
    expect(predictedPunchTiming({ ...fresh, conditioning: 640, stamina: 119 }, { ...jab, class: "hook", power: "power" })).toMatchObject({ startup: 14, recovery: 23 });
    expect(predictedPunchTiming({ ...fresh, conditioning: 820, stamina: 0, trauma: { ...fresh.trauma, body: 350 } }, { class: "uppercut", hand: "right", target: "body", power: "normal" })).toMatchObject({ startup: 14, recovery: 21 });
    // No combination discount for a tired punch, inside the window or out of it.
    const afterJab = { ...fresh, conditioning: 108, stamina: 50, action: "jab" as const, action_start_tick: 100, action_startup_ticks: 3, action_active_ticks: 2, action_recovery_ticks: 7 };
    const straight = { class: "straight" as const, hand: "right" as const, target: "head" as const, power: "power" as const };
    expect(predictedPunchTiming(afterJab, straight, 110)).toMatchObject({ startup: 18, recovery: 30 });
    expect(predictedPunchTiming(afterJab, straight, 125)).toMatchObject({ startup: 18, recovery: 30 });
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

  it("predicts each style's timing and price for every punch exactly as the engine gives them", () => {
    const classes: Record<string, PunchClass> = { j: "jab", s: "straight", h: "hook", u: "uppercut" };
    const mismatches: string[] = [];
    for (const row of styleTimingTable as string[]) {
      const [style, key, conditioning, body, startup, recovery, cost] = row.split(",") as [FighterStyle, string, string, string, string, string, string];
      const base = fighter("one");
      const state: FighterSnapshot = { ...base, style, stance: "orthodox", conditioning: Number(conditioning), trauma: { ...base.trauma, body: Number(body) } };
      const punch = { class: classes[key[0]!]!, target: key[1] === "h" ? "head" as const : "body" as const, power: key[2] === "p" ? "power" as const : "normal" as const, hand: key[3] === "l" ? "left" as const : "right" as const };
      const timing = predictedPunchTiming(state, punch);
      if (timing.startup !== Number(startup) || timing.recovery !== Number(recovery)) mismatches.push(`${row} -> ${timing.startup},${timing.recovery}`);
      if (styledStaminaCost(style, punch.class, punch.target, punch.power) !== Number(cost)) mismatches.push(`${row} cost`);
    }
    expect(styleTimingTable.length).toBe(1280);
    expect(mismatches).toEqual([]);
  });

  it("moves a swarmer as much quicker, and a slugger as much slower, as the engine does", () => {
    const held = { moveX: 1000, moveY: 0, defense: "none" as const };
    const balanced = predictMovement({ ...fighter("one"), conditioning: 1000 }, held, 20);
    const swarmer = predictMovement({ ...fighter("one"), conditioning: 1000, style: "swarmer" }, held, 20);
    const slugger = predictMovement({ ...fighter("one"), conditioning: 1000, style: "slugger" }, held, 20);
    expect(swarmer.dx / balanced.dx).toBeCloseTo(1.1, 2);
    expect(slugger.dx / balanced.dx).toBeCloseTo(0.96, 2);
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

  it("takes a velocity past the walking speed clamped to it rather than ending the bout, and seeds the step from that", () => {
    const base = snapshot();
    const decode = (one: FighterSnapshot): FighterSnapshot => {
      const message = decodeServerFrame(JSON.stringify({ version: PROTOCOL_VERSION, type: "snapshot", payload: { ...base, fighters: [one, base.fighters[1]] } }));
      if (message.type !== "snapshot") throw new Error(message.type);
      return message.payload.fighters[0];
    };
    // A fresh swarmer pushed back onto a corner pad keeps 7.7 units a tick along it.
    const swarmer = decode({ ...base.fighters[0], style: "swarmer", conditioning: 1000, velocity_x: 8, velocity_y: -9 });
    expect([swarmer.velocity_x, swarmer.velocity_y]).toEqual([7, -7]);
    const coast = predictMovement(swarmer, { moveX: 0, moveY: 0, defense: "none" }, 1);
    expect(Math.hypot(coast.dx, coast.dy)).toBeLessThanOrEqual(7 * 1.1);
    expect(() => decode({ ...base.fighters[0], velocity_x: 7.5 })).toThrow(ProtocolError);
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
    // The engine charges the style's price: a slugger short of it throws a tired follow-up, and no combination.
    const sluggerCost = styledStaminaCost("slugger", "hook", "head", "normal");
    expect(sluggerCost).toBeGreaterThan(punchStaminaCost("hook", "head", "normal"));
    expect(cancelsRecovery("straight", true, hook, sluggerCost - 1, false, "slugger")).toBe(false);
    expect(cancelsRecovery("straight", true, hook, sluggerCost - 1, false)).toBe(true);
  });
});

describe("footwork predicted against what the engine did", () => {
  interface TraceRecord { readonly tick: number; readonly fighter: unknown; readonly events: unknown[]; readonly held: HeldInput }
  const LOOKAHEAD = 4;

  /** Each tick's snapshot as the client decodes it, with the parries it has seen so far. */
  function replay(records: readonly TraceRecord[]): { fighter: FighterSnapshot; rootedUntil: number; held: HeldInput }[] {
    let rootedUntil = 0;
    return records.map((record) => {
      const payload = { ...snapshot(record.tick), fighters: [record.fighter, fighter("two", 400)], events: record.events };
      const message = decodeServerFrame(JSON.stringify({ version: PROTOCOL_VERSION, type: "snapshot", payload }));
      if (message.type !== "snapshot") throw new Error(message.type);
      for (const event of message.payload.events) rootedUntil = parryRootedUntil(event, "one", rootedUntil);
      return { fighter: message.payload.fighters[0], rootedUntil, held: record.held };
    });
  }

  for (const [name, records] of Object.entries(movementTraces as Record<string, TraceRecord[]>)) {
    it(`${name}: every tick's ${LOOKAHEAD}-tick step is the engine's to within 2 units`, () => {
      const decoded = replay(records);
      const misses: string[] = [];
      for (let index = 0; index + LOOKAHEAD < decoded.length; index += 1) {
        const { fighter: now, rootedUntil, held } = decoded[index]!;
        const later = decoded[index + LOOKAHEAD]!.fighter;
        const step = predictMovement(now, held, LOOKAHEAD, records[index]!.tick, rootedUntil);
        const miss = Math.hypot(step.dx - (later.x - now.x), step.dy - (later.y - now.y));
        if (miss > 2) misses.push(`tick ${records[index]!.tick}: predicted ${step.dx.toFixed(1)}, engine ${later.x - now.x}`);
      }
      expect(misses).toEqual([]);
    });
  }
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

describe("the player's own defence", () => {
  const guarding: HeldInput = { moveX: 0, moveY: 0, defense: "guard_high" };
  const open = fighter("one");

  it("shows the guard held now instead of the one in the delayed snapshot, unless the server overrides it", () => {
    expect(predictedDefense(open, guarding, null)).toBe("guard_high");
    expect(predictedDefense({ ...open, defense: "guard_low" }, { ...guarding, defense: "none" }, null)).toBe("none");
    // A stun drops the guard, a taunt has none and a clinch keeps what it had.
    expect(predictedDefense({ ...open, stunned_ticks: 12 }, guarding, "weave")).toBe("none");
    expect(predictedDefense({ ...open, taunt_ticks: 30 }, guarding, null)).toBe("none");
    expect(predictedDefense({ ...open, clinch_ticks: 30, defense: "guard_low" }, guarding, null)).toBe("guard_low");
    // An evasion the server is playing stands; one just pressed shows at once.
    expect(predictedDefense({ ...open, defense: "slip_left" }, guarding, null)).toBe("slip_left");
    expect(predictedDefense(open, guarding, "weave")).toBe("weave");
  });

  it("plays a slip from the press until the server's copy has played on screen, and keeps the feet still while the server does", () => {
    const evasion = new EvasionPrediction();
    const tick = 1000 / 30;
    evasion.press("slip_left", "c7", 1000, 6, 30);
    expect(evasion.pose(1000)).toBe("slip_left");
    expect(evasion.holdsFeet(1000 + (EVASION_TICKS - 1) * tick, 30)).toBe(true);
    expect(evasion.holdsFeet(1000 + EVASION_TICKS * tick, 30)).toBe(false);
    // The server starts it and plays it out; the frame that carried it is long acknowledged by then.
    evasion.acknowledge({ ...open, defense: "slip_left", last_input_sequence: 30 }, true, (id) => (id === "c7" ? 30 : null));
    evasion.acknowledge({ ...open, last_input_sequence: 34 }, true, (id) => (id === "c7" ? 30 : null));
    expect(evasion.pose(1000 + (6 + EVASION_TICKS - 1) * tick)).toBe("slip_left");
    expect(evasion.pose(1000 + (6 + EVASION_TICKS) * tick)).toBeNull();
  });

  it("holds a style's longer evasion as long as the engine plays it", () => {
    const tick = 1000 / 30;
    const ticks = EVASION_TICKS + styleTiming("swarmer").evasionTicks;
    expect(ticks).toBe(EVASION_TICKS + 1);
    expect(styleTiming("balanced").evasionTicks).toBe(0);
    const evasion = new EvasionPrediction();
    evasion.press("weave", "c3", 0, 6, 30, ticks);
    expect(evasion.holdsFeet((ticks - 1) * tick, 30)).toBe(true);
    expect(evasion.holdsFeet(ticks * tick, 30)).toBe(false);
    expect(evasion.pose((6 + ticks - 1) * tick)).toBe("weave");
    expect(evasion.pose((6 + ticks) * tick)).toBeNull();
  });

  it("drops a slip the server turned down or a stun cut short", () => {
    const sequenceOf = (id: string): number | null => (id === "c8" ? 41 : null);
    const refused = new EvasionPrediction();
    refused.press("pull", "c8", 0, 4, 30);
    // Snapshots before the frame went out say nothing about it.
    refused.acknowledge({ ...open, last_input_sequence: 40 }, true, sequenceOf);
    expect(refused.pose(10)).toBe("pull");
    // Not enough stamina there, or a punch pressed in the same tick took its place.
    refused.acknowledge({ ...open, last_input_sequence: 41 }, true, sequenceOf);
    expect(refused.pose(20)).toBeNull();
    const waiting = new EvasionPrediction();
    waiting.press("pull", "c8", 0, 4, 30);
    waiting.acknowledge({ ...open, last_input_sequence: 41, queued_actions: 1 }, true, sequenceOf);
    expect(waiting.pose(20)).toBe("pull");
    const stunned = new EvasionPrediction();
    stunned.press("weave", "c9", 0, 4, 30);
    stunned.acknowledge({ ...open, defense: "weave" }, true, null);
    stunned.acknowledge({ ...open, stunned_ticks: 20 }, true, null);
    expect(stunned.pose(20)).toBeNull();
    const bell = new EvasionPrediction();
    bell.press("weave", "c9", 0, 4, 30);
    bell.acknowledge(open, false, null);
    expect(bell.pose(20)).toBeNull();
  });

  it("matches the engine's evasion length and stamina gate", () => {
    // Tests run from the client's package root, two levels below the repository's.
    const engine = readFileSync(resolve(process.cwd(), "../../src/intelstream/hands/engine.py"), "utf8");
    expect(engine).toContain(`EVASION_TICKS: Final = ${EVASION_TICKS}`);
    expect(engine).toContain(`if fighter.stamina < ${EVASION_STAMINA}:`);
    expect(engine).toContain("fighter.evasion_ticks = EVASION_TICKS + fighter.style_rule.evasion_ticks");
  });
});
