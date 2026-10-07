import * as THREE from "three";
import { punchTiming } from "../manifest";
import { fighter as baseFighter } from "../test/fixtures";
import type { FighterSnapshot } from "../types";
import { BoxingGraph, SkinnedBoxer, loadBoxerGlb, remapPunchAge } from "./graph";
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

const skinnedVertex = new THREE.Vector3();
/** Height of the lowest skinned vertex, of every mesh or only those with the given material. */
function lowestVertex(boxer: SkinnedBoxer, material?: string): number {
  boxer.root.updateMatrixWorld(true);
  let lowest = Infinity;
  boxer.root.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh) || (material !== undefined && (object.material as THREE.Material).name !== material)) return;
    const count = object.geometry.getAttribute("position").count;
    for (let index = 0; index < count; index += 1) {
      lowest = Math.min(lowest, object.getVertexPosition(index, skinnedVertex).applyMatrix4(object.matrixWorld).y);
    }
  });
  return lowest;
}

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

describe("root follow", () => {
  it("catches a teleport at the same speed whatever the frame rate", () => {
    const fast = makeGraph();
    const slow = makeGraph();
    const start = facingOpponent(baseFighter("one"));
    run(fast.graph, start, opponentFor("two"), 5, undefined);
    run(slow.graph, start, opponentFor("two"), 5, undefined);
    const moved = { ...start, x: 300 };
    for (let frame = 0; frame < 30; frame += 1) fast.graph.update(moved, opponentFor("two"), 1 / 60, frame / 60, false, "full", frame, undefined);
    for (let frame = 0; frame < 3; frame += 1) slow.graph.update(moved, opponentFor("two"), 1 / 6, frame / 6, false, "full", frame * 5, undefined);
    const target = mapping.x(300);
    expect(Math.abs(fast.boxer.root.position.x - target)).toBeLessThan(0.01);
    expect(Math.abs(slow.boxer.root.position.x - target)).toBeLessThan(0.01);
  });
});

describe("taunt", () => {
  it("drops the rear glove to the hip and beckons with the lead glove out front", () => {
    const { boxer, graph } = makeGraph();
    const taunting = { ...facingOpponent(baseFighter("one")), taunt_ticks: 45 };
    run(graph, taunting, opponentFor("two"), 45, undefined);
    const left = bone(boxer, "gloveL");
    const right = bone(boxer, "gloveR");
    expect(right.y).toBeLessThan(1.05);
    expect(right.z).toBeLessThan(0.2);
    expect(left.y).toBeGreaterThan(right.y + 0.15);
    expect(left.z).toBeGreaterThan(0.3);
  });
});

describe("cutman", () => {
  it("crouches before the seated fighter, presses the enswell on the eye, and stands back up when done", () => {
    const { boxer, graph } = makeGraph();
    const eye = new THREE.Vector3(0.03, 1.18, 0.5);
    graph.treat(eye, new THREE.Vector3(0, 0, -1), 1);
    run(graph, facingOpponent(baseFighter("one")), opponentFor("two"), 90, undefined);
    const glove = bone(boxer, "gloveL");
    expect(glove.distanceTo(new THREE.Vector3(eye.x, eye.y - 0.07, eye.z - 0.08))).toBeLessThan(0.1);
    expect(bone(boxer, "hips").y).toBeLessThan(0.7);
    expect(boxer.rig.bones.gloveL.getObjectByName("enswell")?.visible).toBe(true);
    graph.treat(null);
    run(graph, facingOpponent(baseFighter("one")), opponentFor("two"), 90, undefined, 45, 1.5);
    expect(bone(boxer, "hips").y).toBeGreaterThan(0.75);
    expect(boxer.rig.bones.gloveL.getObjectByName("enswell")?.visible).toBe(false);
  });
});

describe("own punch prediction", () => {
  const jab = { kind: "punch" as const, id: "own-1", class: "jab" as const, hand: "left" as const, target: "head" as const, power: "normal" as const };
  const age = (graph: BoxingGraph): number => (graph as unknown as { punchAgeTicks: number }).punchAgeTicks;
  const active = (graph: BoxingGraph): boolean => (graph as unknown as { punchActive: boolean }).punchActive;

  it("starts on the key press, never jumps back when the server confirms late, and lands on the server's contact tick", () => {
    const { graph } = makeGraph();
    const idle = facingOpponent(baseFighter("one"));
    const timing = punchTiming("jab", "head", "normal");
    run(graph, idle, opponentFor("two"), 10, undefined);
    graph.predict(jab, 0, 30, 6);
    expect(active(graph)).toBe(true);
    const ages: number[] = [];
    let tick = 100;
    const step = (fighter: FighterSnapshot): void => {
      tick += 0.5;
      graph.update(fighter, opponentFor("two"), 1 / 60, tick / 30, false, "full", tick, undefined);
      if (active(graph)) ages.push(age(graph));
    };
    for (let frame = 0; frame < 12; frame += 1) step(idle);
    expect(age(graph)).toBeGreaterThan(1.5);
    expect(age(graph)).toBeLessThan(timing.startup);
    const startTick = tick;
    const confirmed = { ...idle, action: "jab" as const, action_hand: "left" as const, action_target: "head" as const, action_power: "normal" as const, action_id: "own-1", action_key: "jab:left:head:normal", action_start_tick: startTick, action_startup_ticks: timing.startup, action_active_ticks: timing.active, action_recovery_ticks: timing.recovery };
    let contactAt: number | null = null;
    for (let frame = 0; frame < 40 && active(graph); frame += 1) {
      step(confirmed);
      if (contactAt === null && age(graph) >= timing.startup) contactAt = tick;
    }
    for (let index = 1; index < ages.length; index += 1) expect(ages[index]!).toBeGreaterThanOrEqual(ages[index - 1]!);
    expect(contactAt).not.toBeNull();
    expect(Math.abs(contactAt! - (startTick + timing.startup))).toBeLessThanOrEqual(1);
  });

  const state = (graph: BoxingGraph): { punchClass: string; ownActionId: string | null; actionId: string | null } =>
    graph as unknown as { punchClass: string; ownActionId: string | null; actionId: string | null };
  const serverPunch = (base: FighterSnapshot, id: string, punchClass: "jab" | "straight" | "hook" | "uppercut", startTick: number, scale = 1): FighterSnapshot => {
    const timing = punchTiming(punchClass, "head", "normal");
    return { ...base, action: punchClass, action_hand: "left", action_target: "head", action_power: "normal", action_id: id, action_key: `${punchClass}:left:head:normal`, action_start_tick: startTick, action_startup_ticks: Math.round(timing.startup * scale), action_active_ticks: timing.active, action_recovery_ticks: Math.round(timing.recovery * scale) };
  };

  it("keeps the punch in flight when a second punch is pressed before the server confirms the first", () => {
    const { graph } = makeGraph();
    const idle = facingOpponent(baseFighter("one"));
    run(graph, idle, opponentFor("two"), 10, undefined);
    graph.predict(jab, 0, 30, 4);
    let tick = 100;
    const step = (fighter: FighterSnapshot): void => { tick += 0.5; graph.update(fighter, opponentFor("two"), 1 / 60, tick / 30, false, "full", tick, undefined); };
    for (let frame = 0; frame < 3; frame += 1) step(idle);
    const before = age(graph);
    graph.predict({ ...jab, id: "own-2", class: "straight" }, 0, 30, 4);
    expect(state(graph).punchClass).toBe("jab");
    expect(state(graph).ownActionId).toBe("own-1");
    expect(age(graph)).toBe(before);
    const ages: number[] = [];
    for (let frame = 0; frame < 6; frame += 1) { step(serverPunch(idle, "own-1", "jab", tick)); ages.push(age(graph)); }
    for (let index = 1; index < ages.length; index += 1) expect(ages[index]!).toBeGreaterThanOrEqual(ages[index - 1]!);
    expect(state(graph).punchClass).toBe("jab");
  });

  it("cuts a follow-up in late in the recovery without the first punch coming back", () => {
    const { graph } = makeGraph();
    const idle = facingOpponent(baseFighter("one"));
    run(graph, idle, opponentFor("two"), 10, undefined);
    let tick = 300;
    const hook = serverPunch(idle, "theirs-hook", "hook", tick);
    const step = (fighter: FighterSnapshot): void => { tick += 0.5; graph.update(fighter, opponentFor("two"), 1 / 60, tick / 30, false, "full", tick, undefined); };
    while (age(graph) / punchTiming("hook", "head", "normal").startup < 1 || age(graph) < 14) step(hook);
    expect(state(graph).punchClass).toBe("hook");
    graph.predict({ ...jab, id: "own-3", class: "uppercut" }, 0, 30, 3);
    expect(state(graph).punchClass).toBe("uppercut");
    for (let frame = 0; frame < 6; frame += 1) {
      step(hook);
      expect(state(graph).punchClass).toBe("uppercut");
      expect(state(graph).ownActionId).toBe("own-3");
    }
  });

  it("does not replay a punch the server confirms after it has finished here", () => {
    const { graph } = makeGraph();
    const idle = facingOpponent(baseFighter("one"));
    run(graph, idle, opponentFor("two"), 10, undefined);
    graph.predict(jab, 0, 30, 2);
    let tick = 500;
    const step = (fighter: FighterSnapshot): void => { tick += 0.5; graph.update(fighter, opponentFor("two"), 1 / 60, tick / 30, false, "full", tick, undefined); };
    let frames = 0;
    while (active(graph) && frames < 200) { step(idle); frames += 1; }
    expect(active(graph)).toBe(false);
    step(serverPunch(idle, "own-1", "jab", tick - 3));
    expect(active(graph)).toBe(false);
  });

  it("brings the glove back the way it went when the server never starts the punch", () => {
    const { graph } = makeGraph();
    const idle = facingOpponent(baseFighter("one"));
    const timing = punchTiming("hook", "head", "normal");
    run(graph, idle, opponentFor("two"), 10, undefined);
    graph.predict({ ...jab, id: "own-hook", class: "hook" }, 0, 30, 2);
    let tick = 600;
    const step = (fighter: FighterSnapshot): void => { tick += 0.5; graph.update(fighter, opponentFor("two"), 1 / 60, tick / 30, false, "full", tick, undefined); };
    const ages: number[] = [];
    let frames = 0;
    while (active(graph) && frames < 200) { step(idle); frames += 1; if (active(graph)) ages.push(age(graph)); }
    expect(active(graph)).toBe(false);
    expect(frames / 2).toBeLessThan(timing.startup + timing.active + timing.recovery - 4);
    const peak = ages.indexOf(Math.max(...ages));
    expect(Math.max(...ages)).toBeLessThan(timing.startup);
    for (let index = peak + 1; index < ages.length; index += 1) expect(ages[index]!).toBeLessThan(ages[index - 1]!);
    step(serverPunch(idle, "own-hook", "hook", tick));
    expect(active(graph)).toBe(true);
  });

  it("keeps the glove where it is when the server's timing is slower than predicted", () => {
    const from = punchTiming("jab", "head", "normal");
    const to = { ...from, startup: from.startup + 2, recovery: from.recovery + 3 };
    expect(remapPunchAge(from.startup / 2, from, to)).toBeCloseTo(to.startup / 2);
    expect(remapPunchAge(from.startup + from.active / 2, from, to)).toBeCloseTo(to.startup + to.active / 2);
    expect(remapPunchAge(from.startup + from.active + from.recovery, from, to)).toBeCloseTo(to.startup + to.active + to.recovery);
    const { graph } = makeGraph();
    const idle = facingOpponent(baseFighter("one"));
    run(graph, idle, opponentFor("two"), 10, undefined);
    graph.predict(jab, 0, 30, 4);
    let tick = 700;
    const step = (fighter: FighterSnapshot): void => { tick += 0.5; graph.update(fighter, opponentFor("two"), 1 / 60, tick / 30, false, "full", tick, undefined); };
    for (let frame = 0; frame < 6; frame += 1) step(idle);
    const progress = age(graph) / from.startup;
    step(serverPunch(idle, "own-1", "jab", tick, 1.5));
    const slower = Math.round(from.startup * 1.5);
    expect(age(graph) / slower).toBeGreaterThanOrEqual(progress - 0.01);
  });

  it("forgets the punch when the fighter is reset for the replay", () => {
    const { graph } = makeGraph();
    const idle = facingOpponent(baseFighter("one"));
    run(graph, idle, opponentFor("two"), 10, undefined);
    graph.predict(jab, 0, 30, 4);
    expect(graph.ownPunchActive).toBe(true);
    graph.resetTransient(false);
    expect(active(graph)).toBe(false);
    expect(graph.ownPunchActive).toBe(false);
    graph.update(serverPunch(idle, "own-1", "jab", 900), opponentFor("two"), 1 / 60, 30, false, "full", 902, undefined);
    expect(active(graph)).toBe(true);
  });

  it("plays an opponent's punch on the server's timeline", () => {
    const { graph } = makeGraph();
    const idle = facingOpponent(baseFighter("one"));
    const timing = punchTiming("jab", "head", "normal");
    run(graph, idle, opponentFor("two"), 10, undefined);
    const thrown = { ...idle, action: "jab" as const, action_hand: "left" as const, action_target: "head" as const, action_power: "normal" as const, action_id: "theirs-1", action_key: "jab:left:head:normal", action_start_tick: 200, action_startup_ticks: timing.startup, action_active_ticks: timing.active, action_recovery_ticks: timing.recovery };
    graph.update(thrown, opponentFor("two"), 1 / 60, 0, false, "full", 203, undefined);
    expect(age(graph)).toBeCloseTo(3 + 0.5, 1);
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
    const sway: number[] = [];
    for (let frame = 0; frame < 40; frame += 1) {
      over.graph.update(clinched("one"), held("two"), 1 / 60, 1 + frame / 60, false, "full", 60 + frame, undefined);
      sway.push(bone(over.boxer, "hips").x);
    }
    expect(Math.max(...sway) - Math.min(...sway)).toBeGreaterThan(0.008);
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

  it("keeps the toes flat on the canvas when the heel lifts", () => {
    const { boxer, graph } = makeGraph();
    const opponent = opponentFor("two");
    const head = new THREE.Vector3(0, 1.5, mapping.z(-150));
    const timing = punchTiming("straight", "head", "power");
    const idle = facingOpponent(baseFighter("one"));
    run(graph, idle, opponent, 20, head);
    expect(lowestVertex(boxer, "ShoesMat0")).toBeGreaterThan(-0.02);
    const straight = {
      ...idle,
      action: "straight" as const, action_hand: "right" as const, action_target: "head" as const, action_power: "power" as const, action_id: "p1", action_key: "straight:right:head:power",
      action_start_tick: 10, action_startup_ticks: timing.startup, action_active_ticks: timing.active, action_recovery_ticks: timing.recovery,
    };
    let lowest = Infinity;
    let tick = 10;
    for (let frame = 0; frame < (timing.startup + timing.active) * 2; frame += 1) {
      tick += 0.5;
      graph.update(straight, opponent, 1 / 60, 1 + frame / 60, false, "full", tick, head);
      if (tick >= 10 + timing.startup) lowest = Math.min(lowest, lowestVertex(boxer, "ShoesMat0"));
    }
    expect(lowest).toBeGreaterThan(-0.02);
    graph.celebrate(2);
    run(graph, idle, opponent, 60, undefined, 40, 2);
    expect(lowestVertex(boxer, "ShoesMat0")).toBeGreaterThan(-0.02);
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
