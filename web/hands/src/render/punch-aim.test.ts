import * as THREE from "three";
import { GLOVE_HITBOX_RADIUS, HURTBOXES, punchTiming } from "../manifest";
import { fighter as baseFighter } from "../test/fixtures";
import type { DefensivePose, FighterSnapshot, Hand, PunchClass, Target } from "../types";
import { BoxingGraph, SkinnedBoxer, loadBoxerGlb } from "./graph";
import { worldPosition } from "./rig";
import { worldMapping } from "./world";

const mapping = worldMapping({ tick_rate: 30, ring_half_width: 500, ring_half_height: 500 });
const gltf = await loadBoxerGlb();

/** Where the glove's centre stops short of the aimed point: the head and glove hurtboxes, overlapped for visible contact. */
const STAND_OFF = HURTBOXES.head.radius + GLOVE_HITBOX_RADIUS - 0.06;

const facingOpponent = (fighter: FighterSnapshot): FighterSnapshot => ({ ...fighter, facing_x: 0, facing_y: -1000, x: 0, y: 0 });
const opponentAt = (units: number): FighterSnapshot => ({ ...baseFighter("two"), x: 0, y: -units, facing_x: 0, facing_y: 1000 });
/** The fighter stands at the origin facing world +z, so character space and world space coincide. */
const handTarget = (graph: BoxingGraph, hand: Hand): THREE.Vector3 =>
  (graph as unknown as { hand: Record<"L" | "R", { position: THREE.Vector3 }> }).hand[hand === "left" ? "L" : "R"].position;

/**
 * Plays a server punch of `punchClass` at an opponent `units` away and returns the punching hand's IK
 * target at every frame through the startup, ending on the contact age, and through the active phase
 * after it, with the point it aims at.
 */
function throwPunch(punchClass: PunchClass, hand: Hand, target: Target, units: number): { path: THREE.Vector3[]; active: THREE.Vector3[]; aim: THREE.Vector3 } {
  const graph = new BoxingGraph(new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8 }), mapping);
  const opponent = opponentAt(units);
  const head = new THREE.Vector3(0, 1.5, mapping.z(-units));
  const idle = facingOpponent(baseFighter("one"));
  for (let frame = 0; frame < 20; frame += 1) graph.update(idle, opponent, 1 / 60, frame / 60, false, "full", frame / 2, head);
  const timing = punchTiming(punchClass, target, "normal");
  const punch: FighterSnapshot = {
    ...idle, action: punchClass, action_hand: hand, action_target: target, action_power: "normal", action_id: "p1", action_key: `${punchClass}:${hand}:${target}:normal`,
    action_start_tick: 100, action_startup_ticks: timing.startup, action_active_ticks: timing.active, action_recovery_ticks: timing.recovery,
  };
  const path: THREE.Vector3[] = [];
  const active: THREE.Vector3[] = [];
  // Each frame advances the punch half a tick from the authoritative age, so frame 2 * startup - 1 sits on the contact age.
  for (let frame = 0; frame < (timing.startup + timing.active) * 2; frame += 1) {
    graph.update(punch, opponent, 1 / 60, 1 + frame / 60, false, "full", 100 + (frame - 1) / 2, head);
    (frame < timing.startup * 2 ? path : active).push(handTarget(graph, hand).clone());
  }
  return { path, active, aim: head.clone().setY(head.y - (target === "body" ? 0.42 : 0.04)) };
}

describe("hook sweep", () => {
  it("ends the sweep on its own contact point instead of a fixed wider radius", () => {
    for (const [hand, target, units] of [["left", "head", 124], ["left", "body", 110], ["right", "head", 124]] as const) {
      const { path, aim } = throwPunch("hook", hand, target, units);
      expect(path.at(-1)!.distanceTo(aim), `${hand} hook to the ${target} at ${units}`).toBeCloseTo(STAND_OFF, 2);
    }
  });
});

describe("close range punches", () => {
  it("shorten instead of driving the glove past the contact point into the face", () => {
    for (const [punchClass, hand, units] of [["jab", "left", 76], ["jab", "left", 100], ["straight", "right", 76], ["straight", "right", 100]] as const) {
      const { path, active, aim } = throwPunch(punchClass, hand, "head", units);
      const label = `${punchClass} at ${units}`;
      expect(path.at(-1)!.distanceTo(aim), label).toBeCloseTo(STAND_OFF, 2);
      for (const glove of active) expect(glove.distanceTo(aim), label).toBeGreaterThan(STAND_OFF - 0.005);
    }
  });
});

describe("punch pose allocations", () => {
  it("clones no vectors per frame for any punch beyond what an idle frame does", () => {
    const graph = new BoxingGraph(new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8 }), mapping);
    const opponent = opponentAt(120);
    const head = new THREE.Vector3(0, 1.5, mapping.z(-120));
    const idle = facingOpponent(baseFighter("one"));
    let tick = 0;
    const frames = (fighter: FighterSnapshot, count: number): number => {
      const clones = vi.spyOn(THREE.Vector3.prototype, "clone");
      for (let frame = 0; frame < count; frame += 1) {
        tick += 0.5;
        graph.update(fighter, opponent, 1 / 60, tick / 30, false, "full", tick, head);
      }
      const calls = clones.mock.calls.length;
      clones.mockRestore();
      return calls;
    };
    frames(idle, 20);
    const perIdleFrame = frames(idle, 30) / 30;
    for (const punchClass of ["jab", "straight", "hook", "uppercut"] as const) {
      const timing = punchTiming(punchClass, "head", "normal");
      const punch: FighterSnapshot = {
        ...idle, action: punchClass, action_hand: "left", action_target: "head", action_power: "normal", action_id: `a-${punchClass}`, action_key: `${punchClass}:left:head:normal`,
        action_start_tick: tick, action_startup_ticks: timing.startup, action_active_ticks: timing.active, action_recovery_ticks: timing.recovery,
      };
      const count = (timing.startup + timing.active + timing.recovery) * 2 - 2;
      expect(frames(punch, count) / count, punchClass).toBe(perIdleFrame);
    }
  });
});

describe("punches at an evading head", () => {
  /**
   * Throws a left `punchClass` at a defender `units` away who goes into `defense` the tick after it
   * starts, with two graphs handing each other their heads a frame late as the renderer does. Returns
   * the glove and the defender's head at the contact tick. `connects` reports a hit for the punch, as
   * the server does when the evasion was the wrong one.
   */
  function throwAt(punchClass: PunchClass, defense: DefensivePose, units: number, connects: boolean): { glove: THREE.Vector3; head: THREE.Vector3 } {
    const attacker = new BoxingGraph(new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8 }), mapping);
    const defender = new BoxingGraph(new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0xb91c1c }), mapping);
    const attackerIdle = facingOpponent(baseFighter("one"));
    const defenderIdle = opponentAt(units);
    const timing = punchTiming(punchClass, "head", "normal");
    const start = 100;
    const punch: FighterSnapshot = {
      ...attackerIdle, action: punchClass, action_hand: "left", action_target: "head", action_power: "normal", action_id: "p1", action_key: `${punchClass}:left:head:normal`,
      action_start_tick: start, action_startup_ticks: timing.startup, action_active_ticks: timing.active, action_recovery_ticks: timing.recovery,
    };
    const hit = { event_id: 3, tick: start + timing.startup, kind: "hit", actor_id: "one", target_id: "two", amount: 30, detail: `${punchClass}:head`, blood: 0, direction: 1, action_id: "p1" };
    const attackerHead = new THREE.Vector3();
    const defenderHead = new THREE.Vector3();
    const glove = new THREE.Vector3();
    for (let tick = start - 10; tick <= start + timing.startup; tick += 0.5) {
      const shownAttacker = tick >= start ? punch : attackerIdle;
      const shownDefender = tick >= start + 1 && tick < start + 11 ? { ...defenderIdle, defense } : defenderIdle;
      // The newest snapshot reaches the client a couple of ticks before the contact is shown.
      if (connects && tick === start + timing.startup - 2) attacker.acknowledge(punch, true, [hit]);
      attacker.update(shownAttacker, shownDefender, 1 / 60, tick / 30, false, "full", tick, tick > start - 10 ? defenderHead : undefined);
      defender.update(shownDefender, shownAttacker, 1 / 60, tick / 30, false, "full", tick, tick > start - 10 ? attackerHead : undefined);
      attacker.boxer.root.updateMatrixWorld(true);
      defender.boxer.root.updateMatrixWorld(true);
      worldPosition(attacker.boxer.rig.bones.head, attackerHead);
      worldPosition(defender.boxer.rig.bones.head, defenderHead);
      worldPosition(attacker.boxer.rig.bones.gloveL, glove);
    }
    return { glove, head: defenderHead };
  }

  it("sends the glove where the head was when a slip or weave worked, and after the head when the punch still connected", () => {
    const cleanJab = throwAt("jab", "none", 150, true);
    const cleanReach = cleanJab.glove.distanceTo(cleanJab.head);
    // A left jab is slipped to the defender's right: the glove goes where it would have met him and misses.
    const slipped = throwAt("jab", "slip_right", 150, false);
    expect(slipped.glove.distanceTo(cleanJab.glove)).toBeLessThan(0.02);
    expect(slipped.glove.distanceTo(slipped.head)).toBeGreaterThan(cleanReach + 0.08);
    // Slipping left does not get away from it: the server reports the hit and the glove follows the head.
    const caught = throwAt("jab", "slip_left", 150, true);
    expect(Math.abs(caught.glove.distanceTo(caught.head) - cleanReach)).toBeLessThan(0.05);
    // A weave ducks a hook: the glove ends where it would on a defender standing still, never deeper.
    const cleanHook = throwAt("hook", "none", 110, true);
    const weaved = throwAt("hook", "weave", 110, false);
    expect(weaved.glove.distanceTo(cleanHook.glove)).toBeLessThan(0.02);
    expect(weaved.glove.distanceTo(weaved.head)).toBeGreaterThan(cleanHook.glove.distanceTo(cleanHook.head));
  });
});
