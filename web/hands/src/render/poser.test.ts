import * as THREE from "three";
import { punchTiming } from "../manifest";
import { fighter as baseFighter } from "../test/fixtures";
import type { FighterSnapshot } from "../types";
import { BoxingGraph, SkinnedBoxer, loadBoxerGlb } from "./graph";
import { applyHeadTrauma } from "./injury";
import { STANCE } from "./poser";
import { worldPosition, worldQuaternion, type CanonicalBone } from "./rig";
import { worldMapping } from "./world";

const mapping = worldMapping({ tick_rate: 30, ring_half_width: 500, ring_half_height: 500 });
const gltf = await loadBoxerGlb();

const facingOpponent = (fighter: FighterSnapshot): FighterSnapshot => ({ ...fighter, facing_x: 0, facing_y: -1000, x: 0, y: 0 });
const opponentFor = (id: string): FighterSnapshot => ({ ...baseFighter(id), x: 0, y: -150, facing_x: 0, facing_y: 1000 });
const bone = (boxer: SkinnedBoxer, name: CanonicalBone | string, out = new THREE.Vector3()): THREE.Vector3 => {
  const found = boxer.rig.bones[name as CanonicalBone] ?? boxer.bone(name);
  if (found === null || found === undefined) throw new Error(`missing bone ${name}`);
  boxer.root.updateMatrixWorld(true);
  return worldPosition(found, out);
};

function makeGraph(palette = { skin: 0xb0703f, gear: 0x1d4ed8 }): { boxer: SkinnedBoxer; graph: BoxingGraph } {
  const boxer = new SkinnedBoxer(gltf, palette);
  return { boxer, graph: new BoxingGraph(boxer, mapping) };
}

function run(graph: BoxingGraph, fighter: FighterSnapshot, opponent: FighterSnapshot, frames: number, head: THREE.Vector3 | undefined, startTick = 0, startTime = 0): number {
  let tick = startTick;
  for (let frame = 0; frame < frames; frame += 1) {
    tick += 0.5;
    graph.update(fighter, opponent, 1 / 60, startTime + frame / 60, false, "full", tick, head);
  }
  return tick;
}

describe("rest corner", () => {
  it("sits on the stool once still during rest and stands back up when the round starts", () => {
    const { boxer, graph } = makeGraph();
    const fighter = { ...facingOpponent(baseFighter("one")), x: -420, y: -420 };
    const opponent = opponentFor("two");
    graph.setResting(true);
    run(graph, fighter, opponent, 150, undefined);
    expect(graph.stoolVisible).toBe(true);
    expect(bone(boxer, "hips").y).toBeLessThan(0.62);
    expect(bone(boxer, "ankleL").y).toBeLessThan(0.2);
    expect(bone(boxer, "ankleR").y).toBeLessThan(0.2);
    graph.setResting(false);
    run(graph, fighter, opponent, 120, undefined, 75, 2.5);
    expect(graph.stoolVisible).toBe(false);
    expect(bone(boxer, "hips").y).toBeGreaterThan(0.72);
  });
});

describe("celebration", () => {
  it("raises both gloves overhead for a stoppage win and settles back afterwards", () => {
    const { boxer, graph } = makeGraph();
    const fighter = facingOpponent(baseFighter("one"));
    const opponent = opponentFor("two");
    graph.celebrate(1.5);
    run(graph, fighter, opponent, 60, undefined);
    expect(bone(boxer, "gloveL").y).toBeGreaterThan(1.7);
    expect(bone(boxer, "gloveR").y).toBeGreaterThan(1.7);
    run(graph, fighter, opponent, 180, undefined, 30, 1);
    expect(bone(boxer, "gloveL").y).toBeLessThan(1.55);
    expect(bone(boxer, "gloveR").y).toBeLessThan(1.55);
  });
});

describe("fall direction", () => {
  it("drops face down after a hook and onto the back after an uppercut", () => {
    for (const [punchClass, faceDown] of [["hook", true], ["uppercut", false]] as const) {
      const { boxer, graph } = makeGraph();
      const fighter = facingOpponent(baseFighter("one"));
      const opponent = opponentFor("two");
      run(graph, fighter, opponent, 10, undefined);
      graph.react("hit", "head", 1, punchClass, "left", 420);
      run(graph, { ...fighter, is_downed: true }, opponent, 70, undefined, 5, 10 / 60);
      const head = bone(boxer, "head");
      const hips = bone(boxer, "hips");
      expect(head.y).toBeLessThan(0.45);
      expect(head.z > hips.z).toBe(faceDown);
    }
  });
});

describe("broken nose", () => {
  it("shifts the nose sideways only under heavy head trauma, toward the less damaged side", () => {
    const { boxer } = makeGraph();
    const base = baseFighter("one").trauma;
    applyHeadTrauma(boxer.headInjury, { ...base, head: 300, left_eye: 200, right_eye: 50 }, "full");
    expect(boxer.headInjury.uniforms.uInjuryNose.value.w).toBe(0);
    applyHeadTrauma(boxer.headInjury, { ...base, head: 900, left_eye: 600, right_eye: 100 }, "full");
    expect(boxer.headInjury.uniforms.uInjuryNose.value.w).toBeLessThan(-0.7);
    expect(boxer.headInjury.uniforms.uInjuryNose.value.y).toBeCloseTo(117, 0);
    applyHeadTrauma(boxer.headInjury, { ...base, head: 900, left_eye: 100, right_eye: 600 }, "full");
    expect(boxer.headInjury.uniforms.uInjuryNose.value.w).toBeGreaterThan(0.7);
  });
});

describe("impact dent", () => {
  it("dents the struck cheek on a hook and releases within a second", () => {
    const { boxer, graph } = makeGraph();
    graph.react("hit", "head", 1, "hook", "left", 300);
    expect(boxer.headInjury.uniforms.uInjuryImpact.value.x).toBeLessThan(0);
    expect(boxer.headInjury.uniforms.uInjuryImpactPush.value.x).toBeGreaterThan(1);
    expect(boxer.headInjury.impactDepth).toBeGreaterThan(1);
    run(graph, facingOpponent(baseFighter("one")), opponentFor("two"), 60, undefined);
    expect(boxer.headInjury.impactDepth).toBeLessThan(0.2);
    graph.react("hit", "body", 1, "straight", "right", 260);
    expect(boxer.bodyInjury.uniforms.uInjuryImpact.value.y).toBeCloseTo(96.5, 1);
    expect(boxer.bodyInjury.uniforms.uInjuryImpactPush.value.z).toBeLessThan(-1);
  });
});

describe("transient reset", () => {
  it("snaps back to standing after a fall and can seed the lying pose directly", () => {
    const { boxer, graph } = makeGraph();
    const fighter = facingOpponent(baseFighter("one"));
    const opponent = opponentFor("two");
    run(graph, fighter, opponent, 10, undefined);
    graph.react("hit", "head", 1, "uppercut", "right", 420);
    run(graph, { ...fighter, is_downed: true }, opponent, 70, undefined, 5, 10 / 60);
    expect(bone(boxer, "head").y).toBeLessThan(0.45);
    graph.resetTransient(false);
    run(graph, fighter, opponent, 3, undefined, 40, 80 / 60);
    expect(bone(boxer, "hips").y).toBeGreaterThan(0.72);
    graph.resetTransient(true);
    run(graph, { ...fighter, is_downed: true }, opponent, 3, undefined, 42, 83 / 60);
    expect(bone(boxer, "head").y).toBeLessThan(0.45);
  });
});

describe("glove touch", () => {
  it("extends both gloves toward the opponent late in the countdown and returns to guard", () => {
    const { boxer, graph } = makeGraph();
    const fighter = facingOpponent(baseFighter("one"));
    const opponent = opponentFor("two");
    run(graph, fighter, opponent, 30, undefined);
    const guardLeadZ = bone(boxer, "gloveL").z;
    const guardRearZ = bone(boxer, "gloveR").z;
    graph.setCountdown(30);
    run(graph, fighter, opponent, 60, undefined, 15, 0.5);
    expect(bone(boxer, "gloveL").z).toBeGreaterThan(guardLeadZ + 0.08);
    expect(bone(boxer, "gloveR").z).toBeGreaterThan(guardRearZ + 0.28);
    expect(Math.abs(bone(boxer, "gloveL").x - bone(boxer, "gloveR").x)).toBeLessThan(0.3);
    graph.setCountdown(5);
    run(graph, fighter, opponent, 60, undefined, 45, 1.5);
    expect(bone(boxer, "gloveR").z).toBeLessThan(guardRearZ + 0.1);
  });
});

describe("cornerman", () => {
  it("leans in over the rope with both hands forward while attending", () => {
    const boxer = new SkinnedBoxer(gltf, { skin: 0xc79b76, gear: 0x2b4c9e });
    const graph = new BoxingGraph(boxer, mapping, { referee: true });
    const fighter = facingOpponent(baseFighter("one"));
    const opponent = opponentFor("two");
    run(graph, fighter, opponent, 30, undefined);
    const idleHead = bone(boxer, "head").clone();
    graph.attend(true);
    run(graph, fighter, opponent, 120, undefined, 15, 0.5);
    const head = bone(boxer, "head");
    const left = bone(boxer, "gloveL");
    expect(head.z).toBeGreaterThan(idleHead.z + 0.12);
    expect(head.y).toBeLessThan(idleHead.y - 0.08);
    expect(left.z).toBeGreaterThan(0.45);
    expect(left.y).toBeGreaterThan(1.1);
  });
});

describe("clinch break", () => {
  it("pushes both gloves out and apart at chest height", () => {
    const { boxer, graph } = makeGraph();
    graph.breakClinch(2);
    run(graph, facingOpponent(baseFighter("one")), opponentFor("two"), 45, undefined);
    const left = bone(boxer, "gloveL");
    const right = bone(boxer, "gloveR");
    expect(Math.abs(left.x - right.x)).toBeGreaterThan(0.7);
    expect(left.y).toBeGreaterThan(1.05);
    expect(left.y).toBeLessThan(1.45);
    expect(left.z).toBeGreaterThan(0.3);
  });
});

describe("clinch hold", () => {
  it("ties up over the arms for the first-sorted fighter and under them for the other, heads to the right", () => {
    const clinched = (id: string): FighterSnapshot => ({ ...facingOpponent(baseFighter(id)), clinch_ticks: 30 });
    const held = (id: string): FighterSnapshot => ({ ...opponentFor(id), y: -100, clinch_ticks: 30 });
    const idle = makeGraph();
    run(idle.graph, facingOpponent(baseFighter("one")), held("two"), 60, undefined);
    const over = makeGraph();
    run(over.graph, clinched("one"), held("two"), 60, undefined);
    const under = makeGraph();
    run(under.graph, clinched("two"), held("one"), 60, undefined);
    for (const { boxer } of [over, under]) {
      const left = bone(boxer, "gloveL");
      const right = bone(boxer, "gloveR");
      expect(left.z).toBeGreaterThan(0.35);
      expect(right.z).toBeGreaterThan(0.35);
      expect(left.x - right.x).toBeGreaterThan(0.25);
      expect(bone(idle.boxer, "head").x - bone(boxer, "head").x).toBeGreaterThan(0.08);
    }
    expect(bone(over.boxer, "gloveL").y).toBeGreaterThan(1.2);
    expect(bone(over.boxer, "gloveR").y).toBeGreaterThan(1.15);
    expect(bone(under.boxer, "gloveL").y).toBeLessThan(1.1);
    expect(bone(under.boxer, "gloveR").y).toBeLessThan(1.1);
    expect(bone(over.boxer, "head").y).toBeGreaterThan(bone(under.boxer, "head").y);
  });
});

describe("wave-off", () => {
  it("sweeps both gloves across overhead while waving the fight off", () => {
    const { boxer, graph } = makeGraph();
    const fighter = facingOpponent(baseFighter("one"));
    const opponent = opponentFor("two");
    graph.waveOff(4);
    run(graph, fighter, opponent, 60, undefined);
    const first = bone(boxer, "gloveL").clone();
    expect(first.y).toBeGreaterThan(1.45);
    run(graph, fighter, opponent, 12, undefined, 30, 1);
    const later = bone(boxer, "gloveL");
    expect(later.y).toBeGreaterThan(1.45);
    expect(Math.abs(later.x - first.x)).toBeGreaterThan(0.15);
  });
});

describe("skinned rig solver", () => {
  it("reproduces the rest limb frames when solving onto rest targets", () => {
    const { boxer } = makeGraph();
    const rig = boxer.rig;
    boxer.root.updateMatrixWorld(true);
    const limbs = [
      { upper: "shoulderL", lower: "elbowL", end: "gloveL", lengths: rig.metrics.armL, axis: "z" as const, sign: 1 as const },
      { upper: "shoulderR", lower: "elbowR", end: "gloveR", lengths: rig.metrics.armR, axis: "z" as const, sign: -1 as const },
      { upper: "hipL", lower: "kneeL", end: "ankleL", lengths: rig.metrics.legL, axis: "x" as const, sign: -1 as const },
      { upper: "hipR", lower: "kneeR", end: "ankleR", lengths: rig.metrics.legR, axis: "x" as const, sign: -1 as const },
    ] as const;
    for (const limb of limbs) {
      rig.resetToRest();
      boxer.root.updateMatrixWorld(true);
      const root = rig.position(limb.upper, new THREE.Vector3());
      const joint = rig.position(limb.lower, new THREE.Vector3());
      const end = rig.position(limb.end, new THREE.Vector3());
      const restUpper = worldQuaternion(rig.bones[limb.upper], new THREE.Quaternion());
      const restLower = worldQuaternion(rig.bones[limb.lower], new THREE.Quaternion());
      const direction = end.clone().sub(root).normalize();
      const pole = joint.clone().sub(root);
      pole.addScaledVector(direction, -pole.dot(direction)).normalize();
      const result = rig.solveLimb(rig.bones[limb.upper], rig.bones[limb.lower], limb.lengths, end, pole, limb.axis, limb.sign);
      rig.bones[limb.end].updateWorldMatrix(false, false);
      expect(result.reached).toBe(true);
      expect(rig.position(limb.end, new THREE.Vector3()).distanceTo(end)).toBeLessThan(0.002);
      expect(result.joint.distanceTo(joint)).toBeLessThan(0.002);
      expect(Math.abs(worldQuaternion(rig.bones[limb.upper], new THREE.Quaternion()).dot(restUpper))).toBeGreaterThan(0.99);
      expect(Math.abs(worldQuaternion(rig.bones[limb.lower], new THREE.Quaternion()).dot(restLower))).toBeGreaterThan(0.99);
    }
  });
});

describe("runtime boxing graph", () => {
  it("plants both feet on the authored stance and never slides them while idle", () => {
    const { boxer, graph } = makeGraph();
    const fighter = facingOpponent(baseFighter("one"));
    const opponent = opponentFor("two");
    run(graph, fighter, opponent, 30, undefined);
    const left = bone(boxer, "ankleL").clone();
    const right = bone(boxer, "ankleR").clone();
    expect(left.x).toBeCloseTo(STANCE.leadFoot.x, 2);
    expect(left.z).toBeCloseTo(STANCE.leadFoot.z, 2);
    expect(right.x).toBeCloseTo(STANCE.rearFoot.x, 2);
    expect(right.z).toBeCloseTo(STANCE.rearFoot.z, 2);
    expect(left.y).toBeCloseTo(boxer.rig.metrics.ankleHeight, 2);
    run(graph, fighter, opponent, 120, undefined, 15, 0.5);
    expect(bone(boxer, "ankleL").distanceTo(left)).toBeLessThan(1e-4);
    expect(bone(boxer, "ankleR").distanceTo(right)).toBeLessThan(1e-4);
    expect(bone(boxer, "head").y).toBeGreaterThan(1.45);
  });

  it("steps instead of sliding when the authoritative root moves", () => {
    const { boxer, graph } = makeGraph();
    const opponent = opponentFor("two");
    let fighter = facingOpponent({ ...baseFighter("one"), velocity_y: -6 });
    graph.update(fighter, opponent, 1 / 60, 0, false, "full", 0);
    const stationary = bone(boxer, "ankleL").clone();
    let lifted = false;
    let moved = 0;
    for (let frame = 1; frame <= 90; frame += 1) {
      fighter = { ...fighter, y: -Math.round(frame * 3) };
      graph.update(fighter, opponent, 1 / 60, frame / 60, false, "full", frame / 2);
      const ankle = bone(boxer, "ankleL");
      if (ankle.y > boxer.rig.metrics.ankleHeight + 0.02) lifted = true;
      moved = Math.max(moved, ankle.distanceTo(stationary));
    }
    expect(lifted).toBe(true);
    expect(moved).toBeGreaterThan(0.3);
  });

  it("lands the punching glove on the opponent's head hurtbox at the contact tick", () => {
    const { boxer, graph } = makeGraph();
    const opponent = opponentFor("two");
    const head = new THREE.Vector3(0, 1.5, mapping.z(-150));
    const timing = punchTiming("jab", "head", "normal");
    let fighter = facingOpponent(baseFighter("one"));
    run(graph, fighter, opponent, 20, head);
    fighter = {
      ...fighter,
      action: "jab", action_hand: "left", action_target: "head", action_power: "normal", action_id: "c1", action_key: "jab:left:head:normal",
      action_start_tick: 10, action_startup_ticks: timing.startup, action_active_ticks: timing.active, action_recovery_ticks: timing.recovery,
    };
    let contactDistance = Infinity;
    let tick = 10;
    for (let frame = 0; frame < 40; frame += 1) {
      tick += 0.5;
      graph.update(fighter, opponent, 1 / 60, 1 + frame / 60, false, "full", tick, head);
      if (Math.abs(tick - (10 + timing.startup)) < 0.26) contactDistance = Math.min(contactDistance, bone(boxer, "gloveL").distanceTo(head));
    }
    expect(contactDistance).toBeLessThan(0.13 + 0.11 + 0.02);
    expect(contactDistance).toBeGreaterThan(0.08);
  });

  it("retracts a hook straight back to the guard instead of swinging back out wide", () => {
    const { boxer, graph } = makeGraph();
    const opponent = opponentFor("two");
    const head = new THREE.Vector3(0, 1.5, mapping.z(-150));
    const timing = punchTiming("hook", "head", "normal");
    const idle = facingOpponent(baseFighter("one"));
    run(graph, idle, opponent, 30, head);
    const guard = bone(boxer, "gloveL").clone();
    const fighter = {
      ...idle,
      action: "hook" as const, action_hand: "left" as const, action_target: "head" as const, action_power: "normal" as const, action_id: "h1", action_key: "hook:left:head:normal",
      action_start_tick: 15, action_startup_ticks: timing.startup, action_active_ticks: timing.active, action_recovery_ticks: timing.recovery,
    };
    let contact = new THREE.Vector3();
    let midRecovery = new THREE.Vector3();
    let widest = 0;
    let tick = 15;
    const contactTick = 15 + timing.startup + timing.active / 2;
    const midTick = 15 + timing.startup + timing.active + timing.recovery / 2;
    for (let frame = 0; frame < 60; frame += 1) {
      tick += 0.5;
      graph.update(fighter, opponent, 1 / 60, 2 + frame / 60, false, "full", tick, head);
      const glove = bone(boxer, "gloveL");
      if (Math.abs(tick - contactTick) < 0.26) contact = glove.clone();
      if (Math.abs(tick - midTick) < 0.26) midRecovery = glove.clone();
      if (tick > 15 + timing.startup + timing.active) widest = Math.max(widest, glove.x);
    }
    expect(contact.z).toBeGreaterThan(guard.z + 0.2);
    expect(midRecovery.distanceTo(guard)).toBeLessThan(midRecovery.distanceTo(contact));
    expect(widest).toBeLessThan(guard.x + 0.12);
  });

  it("mirrors the southpaw stance across the character's centre line", () => {
    const orthodox = makeGraph();
    const southpaw = makeGraph();
    const opponent = opponentFor("two");
    run(orthodox.graph, facingOpponent(baseFighter("one")), opponent, 40, undefined);
    run(southpaw.graph, facingOpponent({ ...baseFighter("one"), stance: "southpaw" }), opponent, 40, undefined);
    const pairs: [CanonicalBone, CanonicalBone][] = [["ankleL", "ankleR"], ["gloveL", "gloveR"], ["elbowL", "elbowR"]];
    for (const [left, right] of pairs) {
      const a = bone(orthodox.boxer, left);
      const b = bone(southpaw.boxer, right);
      expect(Math.abs(a.x + b.x)).toBeLessThan(0.02);
      expect(Math.abs(a.y - b.y)).toBeLessThan(0.02);
      expect(Math.abs(a.z - b.z)).toBeLessThan(0.02);
    }
  });

  it("falls to the canvas when downed and stands back up on recovery", () => {
    const { boxer, graph } = makeGraph();
    const opponent = opponentFor("two");
    const standing = facingOpponent(baseFighter("one"));
    run(graph, standing, opponent, 30, undefined);
    run(graph, { ...standing, is_downed: true }, opponent, 90, undefined, 15, 0.5);
    expect(bone(boxer, "head").y).toBeLessThan(0.55);
    expect(bone(boxer, "hips").y).toBeLessThan(0.3);
    expect(graph.isDown).toBe(true);
    run(graph, standing, opponent, 150, undefined, 60, 2);
    expect(graph.isDown).toBe(false);
    expect(bone(boxer, "head").y).toBeGreaterThan(1.45);
  });

  it("snaps the head along the impact line on a hit reaction and settles afterwards", () => {
    const { boxer, graph } = makeGraph();
    const opponent = opponentFor("two");
    const fighter = facingOpponent(baseFighter("one"));
    run(graph, fighter, opponent, 30, undefined);
    const rest = bone(boxer, "head").clone();
    graph.react("hit", "head", 1, "hook", "left", 320);
    let peak = 0;
    for (let frame = 0; frame < 12; frame += 1) {
      graph.update(fighter, opponent, 1 / 60, 0.5 + frame / 60, false, "full", 15 + frame / 2);
      peak = Math.max(peak, bone(boxer, "head").x - rest.x);
    }
    expect(peak).toBeGreaterThan(0.05);
    run(graph, fighter, opponent, 120, undefined, 21, 0.7);
    expect(Math.abs(bone(boxer, "head").x - rest.x)).toBeLessThan(0.02);
  });

  it("restarts identical actions on new instance ids and follows the authoritative start tick", () => {
    const { boxer, graph } = makeGraph();
    const opponent = opponentFor("two");
    const head = new THREE.Vector3(0, 1.5, mapping.z(-150));
    const timing = punchTiming("jab", "head", "normal");
    const base = facingOpponent(baseFighter("one"));
    const punch = (id: string, start: number): FighterSnapshot => ({
      ...base,
      action: "jab", action_hand: "left", action_target: "head", action_power: "normal", action_id: id, action_key: "jab:left:head:normal",
      action_start_tick: start, action_startup_ticks: timing.startup, action_active_ticks: timing.active, action_recovery_ticks: timing.recovery,
    });
    run(graph, base, opponent, 10, head);
    const guard = bone(boxer, "gloveL").z;
    let tick = 5;
    let firstContact = -Infinity;
    const total = timing.startup + timing.active + timing.recovery;
    for (let frame = 0; frame < total * 2; frame += 1) {
      tick += 0.5;
      graph.update(punch("c1", 5), opponent, 1 / 60, 0.2 + frame / 60, false, "full", tick, head);
      if (Math.abs(tick - (5 + timing.startup)) < 0.26) firstContact = bone(boxer, "gloveL").z;
    }
    const retracted = bone(boxer, "gloveL").z;
    expect(firstContact).toBeGreaterThan(guard + 0.25);
    expect(retracted).toBeLessThan(guard + 0.08);
    graph.update(punch("c2", 30), opponent, 1 / 60, 1, false, "full", 30, head);
    expect(bone(boxer, "gloveL").z).toBeLessThan(guard + 0.1);
    graph.update(punch("c2", 30), opponent, 1 / 60, 1.5, false, "full", 30 + timing.startup, head);
    expect(bone(boxer, "gloveL").z).toBeGreaterThan(guard + 0.25);
  });

  it("produces identical poses for identical input sequences", () => {
    const a = makeGraph();
    const b = makeGraph();
    const opponent = opponentFor("two");
    const fighter = facingOpponent({ ...baseFighter("one"), defense: "guard_high", velocity_x: 3 });
    for (let frame = 0; frame < 60; frame += 1) {
      const moving = { ...fighter, x: frame * 2 };
      a.graph.update(moving, opponent, 1 / 60, frame / 60, false, "full", frame / 2);
      b.graph.update(moving, opponent, 1 / 60, frame / 60, false, "full", frame / 2);
    }
    for (const name of ["head", "gloveL", "gloveR", "ankleL", "ankleR", "kneeL"] as const) {
      expect(bone(a.boxer, name).distanceTo(bone(b.boxer, name))).toBeLessThan(1e-9);
    }
  });
});
