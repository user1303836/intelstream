import * as THREE from "three";
import { GLOVE_HITBOX_RADIUS, HURTBOXES, punchTiming } from "../manifest";
import { fighter as baseFighter } from "../test/fixtures";
import type { FighterSnapshot, Hand, PunchClass, Target } from "../types";
import { BoxingGraph, SkinnedBoxer, loadBoxerGlb } from "./graph";
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
