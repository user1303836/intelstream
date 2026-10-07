import * as THREE from "three";
import { FIGHTER_RADIUS, RING_HALF_WIDTH, punchTiming } from "../manifest";
import { fighter as baseFighter } from "../test/fixtures";
import type { FighterSnapshot } from "../types";
import { BoxingGraph, SkinnedBoxer, loadBoxerGlb, remapPunchAge } from "./graph";
import { applyHeadTrauma } from "./injury";
import { STANCE } from "./poser";
import { worldPosition, worldQuaternion, type CanonicalBone } from "./rig";
import { aboveNeckCut } from "./renderer";
import { ROPE_BACK, ROPE_MAX_GIVE } from "./ring";
import { ROPE_HEIGHTS, ROPE_LINE, worldMapping } from "./world";

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

  it("rests the seated fighter's feet on the canvas and keeps them there as he stands up", () => {
    const { boxer, graph } = makeGraph();
    const fighter = { ...facingOpponent(baseFighter("one")), x: -420, y: -420 };
    const opponent = opponentFor("two");
    graph.setResting(true);
    run(graph, fighter, opponent, 150, undefined);
    const seated = lowestVertex(boxer, "ShoesMat0");
    expect(seated).toBeGreaterThan(-0.02);
    expect(seated).toBeLessThan(0.02);
    graph.setResting(false);
    let lowest = Infinity;
    for (let frame = 0; frame < 60; frame += 2) {
      run(graph, fighter, opponent, 2, undefined, 75 + frame / 2, 2.5 + frame / 60);
      lowest = Math.min(lowest, lowestVertex(boxer, "ShoesMat0"));
    }
    expect(lowest).toBeGreaterThan(-0.02);
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
  it("goes down the way the blow drove him: a hook to the side, an uppercut or a straight onto his back", () => {
    for (const [punchClass, hand] of [["hook", "left"], ["hook", "right"], ["uppercut", "left"], ["straight", "right"]] as const) {
      const { boxer, graph } = makeGraph();
      const fighter = facingOpponent(baseFighter("one"));
      const opponent = opponentFor("two");
      run(graph, fighter, opponent, 10, undefined);
      graph.react("hit", "head", 1, punchClass, hand, 420);
      run(graph, { ...fighter, is_downed: true }, opponent, 70, undefined, 5, 10 / 60);
      const head = bone(boxer, "head");
      const hips = bone(boxer, "hips");
      expect(head.y).toBeLessThan(0.45);
      // The fighter faces +z; a left hook drives the head toward his own left (+x), a right hook toward -x.
      if (punchClass === "hook") expect(Math.sign(head.x - hips.x)).toBe(hand === "left" ? 1 : -1);
      else expect(head.z).toBeLessThan(hips.z);
    }
  });

  // The engine's hardest hit does about 153 damage, and the knockdown event that follows the hit carries
  // the knockdown count (1-3) as its amount, so the fall must not depend on the amount at all. Live, the
  // knockout physics plays the fall (above); these are the animated falls that reduced motion plays.
  const fall = (punchClass: "hook" | "uppercut" | "straight", target: "head" | "body", hand: "left" | "right", damage: number): { head: THREE.Vector3; hips: THREE.Vector3 } => {
    const { boxer, graph } = makeGraph();
    const fighter = facingOpponent(baseFighter("one"));
    const opponent = opponentFor("two");
    run(graph, fighter, opponent, 10, undefined);
    graph.useAuthoredFall();
    graph.react("hit", target, 1, punchClass, hand, damage);
    graph.react("hit", target, 1, punchClass, hand, 1);
    run(graph, { ...fighter, is_downed: true }, opponent, 70, undefined, 5, 10 / 60);
    return { head: bone(boxer, "head"), hips: bone(boxer, "hips") };
  };

  it("animates a face-down fall after a hook or a body shot and onto the back after an uppercut, whatever the damage", () => {
    for (const [punchClass, target, faceDown] of [["hook", "head", true], ["uppercut", "head", false], ["straight", "body", true]] as const) {
      for (const damage of [40, 153]) {
        const { head, hips } = fall(punchClass, target, "left", damage);
        expect(head.y).toBeLessThan(0.45);
        expect(head.z > hips.z).toBe(faceDown);
      }
    }
  });

  it("falls away from the side the punch came from", () => {
    expect(fall("hook", "head", "left", 90).head.x).toBeGreaterThan(fall("hook", "head", "right", 90).head.x + 0.2);
    expect(fall("uppercut", "head", "left", 90).head.x).toBeGreaterThan(fall("uppercut", "head", "right", 90).head.x + 0.2);
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

  it("presses its deepest for the hardest hit the engine deals", () => {
    const { boxer, graph } = makeGraph();
    graph.react("hit", "head", 1, "straight", "right", 153);
    expect(boxer.headInjury.impactDepth).toBeCloseTo(3.2, 1);
    graph.react("hit", "head", 1, "straight", "right", 34);
    expect(boxer.headInjury.impactDepth).toBeLessThan(1.8);
  });
});

/** How far a knee bends along the pelvis' forward axis (1: straight ahead of it), or null when the leg is nearly straight. */
function kneeBend(boxer: SkinnedBoxer, side: "L" | "R"): number | null {
  const hip = bone(boxer, side === "L" ? "hipL" : "hipR");
  const ankle = bone(boxer, side === "L" ? "ankleL" : "ankleR");
  const bend = bone(boxer, side === "L" ? "kneeL" : "kneeR").sub(hip);
  const along = ankle.sub(hip).normalize();
  bend.addScaledVector(along, -bend.dot(along));
  if (bend.length() < 0.02) return null;
  return bend.normalize().dot(new THREE.Vector3(0, 0, 1).applyQuaternion(worldQuaternion(boxer.rig.bones.hips, new THREE.Quaternion())));
}

describe("down and get-up poses", () => {
  /**
   * Knocks a fighter down with `punchClass`, fills his get-up meter in two good presses while he is down,
   * then lets him up, sampling every frame. These are the animated falls (reduced motion, and a body shot to
   * one knee); the knockout physics' falls hand over to the same get-up (see "hand-over to the get-up").
   */
  const knockdown = (punchClass: "hook" | "uppercut", stance: "orthodox" | "southpaw", sample: (boxer: SkinnedBoxer, frame: number) => void): void => {
    const { boxer, graph } = makeGraph();
    const fighter = facingOpponent({ ...baseFighter("one"), stance, get_up_required: 60 });
    const opponent = opponentFor("two");
    run(graph, fighter, opponent, 20, undefined);
    graph.useAuthoredFall();
    graph.react("hit", "head", 1, punchClass, "left", 120);
    let tick = 10;
    for (let frame = 0; frame < 240; frame += 1) {
      tick += 0.5;
      const meter = frame < 60 ? 0 : frame < 100 ? 30 : 60;
      graph.update(frame < 140 ? { ...fighter, is_downed: true, get_up_meter: meter } : { ...fighter, get_up_meter: 60, stunned_ticks: 20 }, opponent, 1 / 60, 1 + frame / 60, false, "full", tick);
      sample(boxer, frame);
    }
  };

  it("bends the knees the way the pelvis faces, on the back, face down, on all fours and on one knee", () => {
    for (const punchClass of ["hook", "uppercut"] as const) {
      for (const stance of ["orthodox", "southpaw"] as const) {
        let worst = Infinity;
        knockdown(punchClass, stance, (boxer) => {
          for (const side of ["L", "R"] as const) worst = Math.min(worst, kneeBend(boxer, side) ?? Infinity);
        });
        expect(worst).toBeGreaterThan(0.3);
      }
    }
  });

  it("keeps the shoes out of the canvas and puts the gloves and knees on it to get up", () => {
    for (const punchClass of ["hook", "uppercut"] as const) {
      let lowest = Infinity;
      let gloves = Infinity;
      let knees = Infinity;
      knockdown(punchClass, "orthodox", (boxer, frame) => {
        if (frame % 3 !== 0) return;
        lowest = Math.min(lowest, lowestVertex(boxer));
        if (frame < 60) return;
        // Up off the canvas (the hips are high) the gloves and then the trunks' knees must still reach it.
        if (bone(boxer, "hips").y > 0.42) gloves = Math.min(gloves, lowestVertex(boxer, "GlovesMat0"));
        if (bone(boxer, "head").y > 0.9) knees = Math.min(knees, lowestVertex(boxer, "PantsMat0"));
      });
      expect(lowest).toBeGreaterThan(-0.02);
      expect(gloves).toBeLessThan(0.03);
      expect(knees).toBeLessThan(0.03);
    }
  });
});

describe("get-up", () => {
  // The engine puts a fighter straight back in the fight when he beats the count: he can walk at once and
  // act once a 20-tick (0.67 s) stun runs out.
  const knockedDown = (): { boxer: SkinnedBoxer; graph: BoxingGraph; step: (fighter: FighterSnapshot, frames: number) => number; standing: FighterSnapshot; downed: FighterSnapshot; guardZ: number } => {
    const { boxer, graph } = makeGraph();
    const opponent = opponentFor("two");
    const head = new THREE.Vector3(0, 1.5, mapping.z(-150));
    const standing = facingOpponent({ ...baseFighter("one"), get_up_required: 66 });
    let tick = 0;
    const step = (fighter: FighterSnapshot, frames: number): number => {
      for (let frame = 0; frame < frames; frame += 1) {
        tick += 0.5;
        graph.update(fighter, opponent, 1 / 60, tick / 30, false, "full", tick, head);
      }
      return tick;
    };
    step(standing, 20);
    // Measured from where he stands: after the physics' fall he gets up where his body lies and walks back.
    const guardZ = bone(boxer, "gloveL").z - boxer.root.position.z;
    graph.react("hit", "head", 1, "uppercut", "right", 120);
    const downed = { ...standing, is_downed: true };
    step(downed, 60);
    return { boxer, graph, step, standing, downed, guardZ };
  };

  it("rises with the get-up meter while down, then stands inside the stun and throws at full reach", () => {
    const { boxer, step, standing, downed, guardZ } = knockedDown();
    const lying = bone(boxer, "head").y;
    step({ ...downed, get_up_meter: 22 }, 30);
    step({ ...downed, get_up_meter: 44 }, 30);
    expect(bone(boxer, "head").y).toBeGreaterThan(lying + 0.3);
    const released = { ...standing, get_up_meter: 66, stunned_ticks: 20 };
    step(released, 33);
    expect(bone(boxer, "head").y).toBeGreaterThan(1.4);
    const startTick = step(released, 9);
    const timing = punchTiming("jab", "head", "normal");
    const jab = {
      ...standing,
      action: "jab" as const, action_hand: "left" as const, action_target: "head" as const, action_power: "normal" as const, action_id: "after-get-up", action_key: "jab:left:head:normal",
      action_start_tick: startTick, action_startup_ticks: timing.startup, action_active_ticks: timing.active, action_recovery_ticks: timing.recovery,
    };
    let reach = -Infinity;
    for (let frame = 0; frame < (timing.startup + timing.active) * 2; frame += 1) {
      step(jab, 1);
      reach = Math.max(reach, bone(boxer, "gloveL").z - boxer.root.position.z);
    }
    expect(reach).toBeGreaterThan(guardZ + 0.25);
  });

  it("falls again from where the get-up had him when he is knocked down mid-rise", () => {
    const { boxer, graph, step, standing, downed } = knockedDown();
    step({ ...downed, get_up_meter: 22 }, 30);
    step({ ...downed, get_up_meter: 44 }, 30);
    step({ ...standing, get_up_meter: 66, stunned_ticks: 20 }, 8);
    // The animated fall (reduced motion); the knockout physics starts its fall from the pose on screen too.
    graph.useAuthoredFall();
    const names = Object.keys(boxer.rig.bones) as CanonicalBone[];
    let previous = names.map((name) => bone(boxer, name));
    expect(previous[names.indexOf("head")]!.y).toBeLessThan(1.3);
    let jump = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      step(downed, 1);
      const now = names.map((name) => bone(boxer, name));
      for (const [index, position] of now.entries()) jump = Math.max(jump, position.distanceTo(previous[index]!));
      previous = now;
    }
    expect(jump).toBeLessThan(0.12);
    expect(bone(boxer, "head").y).toBeLessThan(0.5);
  });

  it("plants the feet under him as he gets up, so they do not jump when the get-up ends", () => {
    const { boxer, step, standing, downed } = knockedDown();
    step({ ...downed, get_up_meter: 22 }, 30);
    step({ ...downed, get_up_meter: 44 }, 30);
    // The engine turns him to face the opponent, who walked away during the count.
    const turned = { ...standing, facing_x: 1000, facing_y: 0, get_up_meter: 66, stunned_ticks: 20 };
    let previous = [bone(boxer, "ankleL"), bone(boxer, "ankleR")];
    let jump = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      step(turned, 1);
      const now = [bone(boxer, "ankleL"), bone(boxer, "ankleR")];
      for (const [index, ankle] of now.entries()) jump = Math.max(jump, ankle.distanceTo(previous[index]!));
      previous = now;
    }
    expect(jump).toBeLessThan(0.12);
  });

  it("finishes the get-up at once when he walks off", () => {
    const { boxer, step, standing, downed } = knockedDown();
    step({ ...downed, get_up_meter: 22 }, 30);
    step({ ...downed, get_up_meter: 44 }, 30);
    let walking = { ...standing, get_up_meter: 66, stunned_ticks: 20, velocity_y: 6 };
    for (let frame = 0; frame < 15; frame += 1) {
      walking = { ...walking, y: walking.y + 3 };
      step(walking, 1);
    }
    expect(bone(boxer, "head").y).toBeGreaterThan(1.4);
  });
});

describe("falls near the ropes", () => {
  // The rope line runs between the corner posts at 2.46 m from the centre; the engine lets a fighter's
  // centre reach 2.82 m (pressing the ropes out).
  const ropeLine = 2.46;
  const skinned = new THREE.Vector3();
  const furthest = (boxer: SkinnedBoxer): number => {
    boxer.root.updateMatrixWorld(true);
    let reach = 0;
    boxer.root.traverse((object) => {
      if (!(object instanceof THREE.SkinnedMesh)) return;
      const count = object.geometry.getAttribute("position").count;
      for (let index = 0; index < count; index += 2) {
        object.getVertexPosition(index, skinned).applyMatrix4(object.matrixWorld);
        reach = Math.max(reach, Math.abs(skinned.x), Math.abs(skinned.z));
      }
    });
    return reach;
  };
  /** Knocks the fighter down; `reach` is where he lands, `overshoot` how far past the ropes (or his start, if out there) the fall went. */
  const fall = (fighter: FighterSnapshot, punchClass: "hook" | "uppercut"): { boxer: SkinnedBoxer; reach: number; overshoot: number } => {
    const { boxer, graph } = makeGraph();
    const opponent = { ...baseFighter("two"), x: 0, y: 0 };
    run(graph, fighter, opponent, 20, undefined);
    const start = furthest(boxer);
    // The animated landing (reduced motion): the knockout physics has the ropes and posts in its own world.
    graph.useAuthoredFall();
    graph.react("hit", "head", 1, punchClass, "left", 120);
    let widest = 0;
    for (let frame = 0; frame < 70; frame += 5) {
      run(graph, { ...fighter, is_downed: true }, opponent, 5, undefined, 10 + frame / 2, 1 + frame / 60);
      widest = Math.max(widest, furthest(boxer));
    }
    return { boxer, reach: furthest(boxer), overshoot: widest - Math.max(start, ropeLine) };
  };

  it("keeps a fighter knocked down against the ropes inside them", () => {
    // Back to the ropes and facing the centre, an uppercut would lay him under the ropes or off the apron.
    for (const x of [300, 400, 462]) {
      const pinned = { ...baseFighter("one"), x, y: 0, facing_x: -1000, facing_y: 0 };
      const { boxer, reach, overshoot } = fall(pinned, "uppercut");
      expect(reach).toBeLessThan(ropeLine);
      expect(overshoot).toBeLessThan(0.01);
      expect(bone(boxer, "head").x).toBeLessThan(bone(boxer, "hips").x);
    }
    // Facing the ropes, a hook would put his head through them.
    expect(fall({ ...baseFighter("one"), x: 400, y: 0, facing_x: 1000, facing_y: 0 }, "hook").reach).toBeLessThan(ropeLine);
    // Wedged in a corner, neither fall fits as it is.
    expect(fall({ ...baseFighter("one"), x: 380, y: 380, facing_x: 1000, facing_y: -1000 }, "uppercut").reach).toBeLessThan(ropeLine);
  });
});

describe("body shots", () => {
  // Two fighters in lockstep, one hit and one not (or hit differently), so the idle sway cancels out.
  const pair = (react: (graph: BoxingGraph) => void, other: (graph: BoxingGraph) => void, sample: (boxer: SkinnedBoxer) => number[]): number[][] => {
    const hit = makeGraph();
    const reference = makeGraph();
    const fighter = facingOpponent(baseFighter("one"));
    const opponent = opponentFor("two");
    run(hit.graph, fighter, opponent, 30, undefined);
    run(reference.graph, fighter, opponent, 30, undefined);
    react(hit.graph);
    other(reference.graph);
    const frames: number[][] = [];
    for (let frame = 0; frame < 30; frame += 1) {
      for (const { graph } of [hit, reference]) graph.update(fighter, opponent, 1 / 60, 0.5 + frame / 60, false, "full", 15 + frame / 2);
      const a = sample(hit.boxer);
      const b = sample(reference.boxer);
      frames.push(a.map((value, index) => value - b[index]!));
    }
    return frames;
  };
  const hipsAxis = (boxer: SkinnedBoxer, x: number, z: number): THREE.Vector3 =>
    new THREE.Vector3(x, 0, z).applyQuaternion(worldQuaternion(boxer.rig.bones.hips, new THREE.Quaternion()));
  const fromHips = (boxer: SkinnedBoxer, name: CanonicalBone): THREE.Vector3 => bone(boxer, name).sub(bone(boxer, "hips"));

  it("bend the fighter toward the ribs a hook lands on and drop the elbow on that side", () => {
    // A left hook lands on the right ribs, the fighter's -x side; a straight to the solar plexus does not lean him.
    const frames = pair(
      (graph) => graph.react("hit", "body", 1, "hook", "left", 120),
      (graph) => graph.react("hit", "body", 1, "straight", "left", 120),
      (boxer) => [fromHips(boxer, "neck").dot(hipsAxis(boxer, 1, 0)), bone(boxer, "elbowR").y, bone(boxer, "elbowL").y, bone(boxer, "hips").x],
    );
    expect(Math.min(...frames.map(([lean]) => lean!))).toBeLessThan(-0.03);
    expect(Math.min(...frames.map(([, right]) => right!))).toBeLessThan(-0.04);
    expect(Math.min(...frames.map(([, , left]) => left!))).toBeGreaterThan(-0.02);
    expect(Math.max(...frames.map(([, , , hips]) => hips!))).toBeGreaterThan(0.02);
  });

  it("lift the fighter onto his toes on an uppercut before he folds over it", () => {
    const frames = pair(
      (graph) => graph.react("hit", "body", 1, "uppercut", "right", 120),
      () => undefined,
      (boxer) => [bone(boxer, "hips").y, fromHips(boxer, "head").dot(hipsAxis(boxer, 0, 1))],
    );
    const lifts = frames.map(([lift]) => lift!);
    const folds = frames.map(([, fold]) => fold!);
    expect(Math.max(...lifts)).toBeGreaterThan(0.04);
    expect(Math.min(...folds.slice(0, 6))).toBeLessThan(-0.02);
    expect(Math.max(...folds)).toBeGreaterThan(0.06);
    expect(folds.indexOf(Math.max(...folds))).toBeGreaterThan(lifts.indexOf(Math.max(...lifts)));
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

describe("a spent guard", () => {
  it("drops the gloves toward the chest once the guard is worn under what stops a punch, held up or not", async () => {
    const { GUARD_BLOCK_MINIMUM } = await import("../manifest");
    const gloves = (guard: number, defense: FighterSnapshot["defense"]) => {
      const { boxer, graph } = makeGraph();
      run(graph, { ...facingOpponent(baseFighter("one")), guard, defense }, opponentFor("two"), 45, undefined);
      return { left: bone(boxer, "gloveL"), right: bone(boxer, "gloveR"), head: bone(boxer, "head") };
    };
    for (const defense of ["guard_high", "none"] as const) {
      const fresh = gloves(80, defense);
      const spent = gloves(40, defense);
      expect(fresh.left.y - spent.left.y, defense).toBeGreaterThan(0.1);
      expect(fresh.right.y - spent.right.y, defense).toBeGreaterThan(0.1);
    }
    // Held up but spent, the gloves sit under the chin: the opening shows.
    const opening = gloves(40, "guard_high");
    expect(Math.max(opening.left.y, opening.right.y)).toBeLessThan(gloves(80, "guard_high").head.y - 0.15);
    // At the line itself the guard still stops punches, and stays up.
    expect(gloves(GUARD_BLOCK_MINIMUM, "guard_high").left.y).toBeCloseTo(gloves(80, "guard_high").left.y, 3);
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
    graph.predict({ ...jab, id: "own-2", class: "straight" }, 3 / 60, 30, 4);
    expect(state(graph).punchClass).toBe("jab");
    expect(state(graph).ownActionId).toBe("own-1");
    expect(age(graph)).toBe(before);
    const ages: number[] = [];
    for (let frame = 0; frame < 6; frame += 1) { step(serverPunch(idle, "own-1", "jab", tick)); ages.push(age(graph)); }
    for (let index = 1; index < ages.length; index += 1) expect(ages[index]!).toBeGreaterThanOrEqual(ages[index - 1]!);
    expect(state(graph).punchClass).toBe("jab");
  });

  it("cuts a follow-up in at the cancel age of a landed combination without the first punch coming back", () => {
    const { graph } = makeGraph();
    const idle = facingOpponent(baseFighter("one"));
    run(graph, idle, opponentFor("two"), 10, undefined);
    let tick = 300;
    const hook = serverPunch(idle, "theirs-hook", "hook", tick);
    const step = (fighter: FighterSnapshot): void => { tick += 0.5; graph.update(fighter, opponentFor("two"), 1 / 60, tick / 30, false, "full", tick, undefined); };
    graph.acknowledge(hook, true, [{ event_id: 1, tick: 307, kind: "hit", actor_id: "one", target_id: "two", amount: 30, detail: "hook:head", blood: 0, direction: 1, action_id: "theirs-hook" }]);
    // The engine lets a chained follow-up cut a landed hook's recovery short from 7 + 3 + 12 / 2 ticks.
    while (age(graph) < 16) step(hook);
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

  it("shows an opponent's punch as soon as the newest snapshot carries it and still lands it on the server's contact tick", () => {
    const { graph } = makeGraph();
    const idle = facingOpponent(baseFighter("one"));
    const timing = punchTiming("hook", "head", "normal");
    run(graph, idle, opponentFor("two"), 10, undefined);
    let tick = 1000;
    const startTick = tick + 2;
    const thrown = serverPunch(idle, "theirs-early", "hook", startTick);
    const ages: number[] = [];
    let contactAt: number | null = null;
    for (let frame = 0; frame < 80; frame += 1) {
      tick += 0.5;
      graph.anticipate(thrown, startTick - tick);
      graph.update(tick >= startTick ? thrown : idle, opponentFor("two"), 1 / 60, tick / 30, false, "full", tick, undefined);
      if (frame === 0) expect(active(graph)).toBe(true);
      if (!active(graph)) break;
      ages.push(age(graph));
      if (contactAt === null && age(graph) >= timing.startup) contactAt = tick;
    }
    for (let index = 1; index < ages.length; index += 1) expect(ages[index]!).toBeGreaterThanOrEqual(ages[index - 1]!);
    expect(contactAt).not.toBeNull();
    expect(Math.abs(contactAt! - (startTick + timing.startup))).toBeLessThanOrEqual(1);
  });

  it("holds back a punch that is too far ahead until it can be shown at half speed or faster", () => {
    const { graph } = makeGraph();
    const idle = facingOpponent(baseFighter("one"));
    const timing = punchTiming("jab", "head", "normal");
    run(graph, idle, opponentFor("two"), 10, undefined);
    let tick = 3000;
    const startTick = tick + 6;
    const thrown = serverPunch(idle, "theirs-far", "jab", startTick);
    let startedAt: number | null = null;
    let contactAt: number | null = null;
    let previous = 0;
    for (let frame = 0; frame < 80; frame += 1) {
      tick += 0.5;
      graph.anticipate(thrown, startTick - tick);
      graph.update(tick >= startTick ? thrown : idle, opponentFor("two"), 1 / 60, tick / 30, false, "full", tick, undefined);
      if (!active(graph)) {
        if (startedAt !== null) break;
        continue;
      }
      startedAt ??= tick;
      if (age(graph) < timing.startup) expect(age(graph) - previous).toBeGreaterThanOrEqual(0.5 * 0.5 - 1e-6);
      previous = age(graph);
      if (contactAt === null && age(graph) >= timing.startup) contactAt = tick;
    }
    expect(startedAt).not.toBeNull();
    expect(startTick - startedAt!).toBeLessThanOrEqual(timing.startup);
    expect(startTick - startedAt!).toBeGreaterThan(timing.startup - 1);
    expect(Math.abs(contactAt! - (startTick + timing.startup))).toBeLessThanOrEqual(1);
  });

  it("starts an early punch once even when the delayed clock never reaches it", () => {
    const { graph } = makeGraph();
    const idle = facingOpponent(baseFighter("one"));
    run(graph, idle, opponentFor("two"), 10, undefined);
    const thrown = serverPunch(idle, "theirs-stalled", "hook", 4002);
    let starts = 0;
    let wasActive = false;
    for (let frame = 0; frame < 400; frame += 1) {
      graph.anticipate(thrown, 2);
      graph.update(idle, opponentFor("two"), 1 / 60, frame / 60, false, "full", 4000, undefined);
      if (active(graph) && !wasActive) starts += 1;
      wasActive = active(graph);
    }
    expect(starts).toBe(1);
    expect(active(graph)).toBe(false);
  });

  it("does not start a punch early twice or bring back one that has finished", () => {
    const { graph } = makeGraph();
    const idle = facingOpponent(baseFighter("one"));
    run(graph, idle, opponentFor("two"), 10, undefined);
    let tick = 2000;
    const thrown = serverPunch(idle, "theirs-once", "jab", tick + 2);
    let starts = 0;
    let wasActive = false;
    for (let frame = 0; frame < 120; frame += 1) {
      tick += 0.5;
      graph.anticipate(thrown, thrown.action_start_tick - tick);
      const retained = tick < thrown.action_start_tick + 28;
      graph.update(tick >= thrown.action_start_tick && retained ? thrown : idle, opponentFor("two"), 1 / 60, tick / 30, false, "full", tick, undefined);
      if (active(graph) && !wasActive) starts += 1;
      wasActive = active(graph);
    }
    expect(starts).toBe(1);
  });

  it("leaves the viewer's own punch alone when the newest snapshot brings the server's copy of it", () => {
    const { graph } = makeGraph();
    const idle = facingOpponent(baseFighter("one"));
    const timing = punchTiming("hook", "head", "normal");
    run(graph, idle, opponentFor("two"), 10, undefined);
    graph.predict({ kind: "punch", id: "own-early", class: "hook", hand: "left", target: "head", power: "normal" }, 0, 30, 4);
    let tick = 100;
    const startTick = 103;
    const confirmed = serverPunch(idle, "own-early", "hook", startTick);
    const ages: number[] = [];
    let contactAt: number | null = null;
    let starts = 0;
    let wasActive = true;
    for (let frame = 0; frame < 80; frame += 1) {
      tick += 0.5;
      if (tick + 2 >= startTick) graph.anticipate(confirmed, startTick - tick);
      graph.update(tick > startTick - 1 ? confirmed : idle, opponentFor("two"), 1 / 60, tick / 30, false, "full", tick, undefined);
      if (active(graph) && !wasActive) starts += 1;
      wasActive = active(graph);
      if (!active(graph)) break;
      ages.push(age(graph));
      if (contactAt === null && age(graph) >= timing.startup) contactAt = tick;
    }
    for (let index = 1; index < ages.length; index += 1) expect(ages[index]!).toBeGreaterThanOrEqual(ages[index - 1]!);
    expect(starts).toBe(0);
    expect(Math.abs(contactAt! - (startTick + timing.startup))).toBeLessThanOrEqual(1);
  });

  const followUp = (startTick: number, lead: number): { startedAt: number; progress: number; starts: number } => {
    const { graph } = makeGraph();
    const idle = facingOpponent(baseFighter("one"));
    const jab = punchTiming("jab", "head", "normal");
    const total = jab.startup + jab.active + jab.recovery;
    run(graph, idle, opponentFor("two"), 10, undefined);
    const first = serverPunch(idle, "theirs-first", "jab", 201);
    const second = serverPunch(idle, "theirs-second", "hook", startTick);
    let tick = 200;
    let startedAt = Infinity;
    let progress = 0;
    let starts = 0;
    let previous = "";
    let wasActive = false;
    for (let frame = 0; frame < 120; frame += 1) {
      tick += 0.5;
      const newest = tick + lead >= startTick ? second : tick + lead >= 201 ? first : idle;
      const before = age(graph) / total;
      if (newest !== idle) graph.anticipate(newest, newest.action_start_tick - tick);
      graph.update(tick > startTick - 1 ? second : tick > 200 ? first : idle, opponentFor("two"), 1 / 60, tick / 30, false, "full", tick, undefined);
      const shown = active(graph) ? state(graph).punchClass : "";
      if (shown === "hook" && (previous !== "hook" || !wasActive)) {
        starts += 1;
        if (starts === 1) {
          startedAt = tick;
          progress = before;
        }
      }
      previous = shown;
      wasActive = active(graph);
    }
    return { startedAt, progress, starts };
  };

  it("starts a follow-up early once the punch in flight is past half way, and only once", () => {
    const late = followUp(211, 3);
    expect(late.startedAt).toBeLessThan(210);
    expect(late.progress).toBeGreaterThan(0.55);
    expect(late.starts).toBe(1);
  });

  it("leaves a follow-up to the server's clock when the punch in flight is not yet half way", () => {
    // The server cancels the jab's recovery into a hook, and the news of it is five ticks ahead of the screen.
    const soon = followUp(208, 5);
    expect(soon.startedAt).toBeGreaterThanOrEqual(207);
    expect(soon.startedAt).toBeLessThanOrEqual(208.5);
    expect(soon.starts).toBe(1);
  });

  it("does not throw the viewer's own punch again when the server's copy arrives after it has finished", () => {
    const { graph } = makeGraph();
    const idle = facingOpponent(baseFighter("one"));
    run(graph, idle, opponentFor("two"), 10, undefined);
    graph.predict({ kind: "punch", id: "own-late", class: "jab", hand: "left", target: "head", power: "normal" }, 0, 30, 4);
    let tick = 500;
    for (let frame = 0; frame < 80 && active(graph); frame += 1) {
      tick += 0.5;
      graph.update(idle, opponentFor("two"), 1 / 60, tick / 30, false, "full", tick, undefined);
    }
    expect(active(graph)).toBe(false);
    graph.anticipate(serverPunch(idle, "own-late", "jab", tick + 2), 2);
    expect(active(graph)).toBe(false);
  });

  it("finishes an early punch at full speed when the server stops reporting it", () => {
    const timing = punchTiming("hook", "head", "normal");
    const total = timing.startup + timing.active + timing.recovery;
    const endsAt = (early: boolean): number => {
      const { graph } = makeGraph();
      const idle = facingOpponent(baseFighter("one"));
      run(graph, idle, opponentFor("two"), 10, undefined);
      const startTick = 303;
      const thrown = serverPunch(idle, "theirs-cleared", "hook", startTick);
      let tick = 300;
      for (let frame = 0; frame < 200; frame += 1) {
        tick += 0.5;
        if (early && tick + 3 >= startTick && tick < startTick + 4) graph.anticipate(thrown, startTick - tick);
        graph.update(tick >= startTick && tick < startTick + 4 ? thrown : idle, opponentFor("two"), 1 / 60, tick / 30, false, "full", tick, undefined);
        if (tick > startTick && !active(graph)) return tick - startTick;
      }
      return Infinity;
    };
    expect(endsAt(false)).toBeLessThanOrEqual(total);
    expect(endsAt(true)).toBeLessThanOrEqual(total + 1);
  });

  it("forgets a punch it started early when the fighter is reset", () => {
    const { graph } = makeGraph();
    const idle = facingOpponent(baseFighter("one"));
    run(graph, idle, opponentFor("two"), 10, undefined);
    const thrown = serverPunch(idle, "theirs-again", "hook", 403);
    graph.anticipate(thrown, 2);
    expect(active(graph)).toBe(true);
    graph.resetTransient();
    expect(active(graph)).toBe(false);
    graph.anticipate(thrown, 2);
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

describe("decision ceremony", () => {
  const square = (id: string): FighterSnapshot => ({ ...baseFighter(id), x: 0, y: 0, facing_x: 0, facing_y: -1000 });
  const beside = (): FighterSnapshot => ({ ...baseFighter("other"), x: 204, y: 0, facing_x: 0, facing_y: -1000 });
  const settle = (prepare: (graph: BoxingGraph) => void, frames = 150): { boxer: SkinnedBoxer; graph: BoxingGraph } => {
    const made = makeGraph();
    prepare(made.graph);
    run(made.graph, square("one"), beside(), frames, undefined);
    return made;
  };

  it("stands the fighter square to the camera with the gloves down while the cards are read", () => {
    const { boxer } = settle((graph) => graph.awaitVerdict(1));
    const left = bone(boxer, "gloveL");
    const right = bone(boxer, "gloveR");
    expect(left.y).toBeLessThan(1.05);
    expect(right.y).toBeLessThan(1.05);
    expect(Math.abs(left.y - right.y)).toBeLessThan(0.05);
    expect(Math.abs(left.z - right.z)).toBeLessThan(0.06);
    expect(left.x).toBeGreaterThan(0.15);
    expect(right.x).toBeLessThan(-0.15);
    expect(Math.abs(bone(boxer, "ankleL").z - bone(boxer, "ankleR").z)).toBeLessThan(0.1);
  });

  it("raises the winner's arm on the referee's side and leaves the other down", () => {
    for (const side of [1, -1] as const) {
      const { boxer } = settle((graph) => {
        graph.awaitVerdict(side);
        graph.announce("winner");
      });
      const raised = bone(boxer, side === 1 ? "gloveL" : "gloveR");
      const lowered = bone(boxer, side === 1 ? "gloveR" : "gloveL");
      expect(raised.y).toBeGreaterThan(bone(boxer, "head").y + 0.2);
      expect(Math.sign(raised.x)).toBe(side);
      expect(lowered.y).toBeLessThan(1.05);
    }
  });

  it("raises both fighters' arms after a draw and bows the loser's head", () => {
    const level = settle((graph) => {
      graph.awaitVerdict(-1);
      graph.announce("level");
    });
    expect(bone(level.boxer, "gloveR").y).toBeGreaterThan(bone(level.boxer, "head").y + 0.2);
    const waiting = settle((graph) => graph.awaitVerdict(1));
    const loser = settle((graph) => {
      graph.awaitVerdict(1);
      graph.announce("loser");
    });
    expect(bone(loser.boxer, "gloveL").y).toBeLessThan(1.05);
    expect(bone(loser.boxer, "gloveR").y).toBeLessThan(1.05);
    const chin = (boxer: SkinnedBoxer): number => new THREE.Vector3(0, 0, 1).applyQuaternion(boxer.rig.bones.head.getWorldQuaternion(new THREE.Quaternion())).y;
    expect(chin(loser.boxer)).toBeLessThan(chin(waiting.boxer) - 0.2);
  });

  it("puts the referee's hand around the wrist it is given, on that side", () => {
    const made = new SkinnedBoxer(gltf, { skin: 0xc79b76, gear: 0x1b2230 });
    const referee = new BoxingGraph(made, mapping, { referee: true });
    const wrist = new THREE.Vector3(-0.3, 1.9, 0.3);
    referee.raise(null, wrist);
    run(referee, square("referee"), { ...square("focus"), y: -300 }, 150, undefined);
    const hand = bone(made, "gloveR");
    expect(hand.distanceTo(new THREE.Vector3(-0.3, 1.73, 0.3))).toBeLessThan(0.04);
    expect(bone(made, "gloveL").y).toBeLessThan(1.05);
    referee.raise(null, null);
    run(referee, square("referee"), { ...square("focus"), y: -300 }, 150, undefined);
    expect(bone(made, "gloveR").y).toBeLessThan(1.05);
  });

  it("ends with the bout", () => {
    const { boxer, graph } = settle((made) => {
      made.awaitVerdict(1);
      made.announce("winner");
    });
    expect(bone(boxer, "gloveL").y).toBeGreaterThan(1.8);
    graph.awaitVerdict(null);
    run(graph, facingOpponent(baseFighter("one")), opponentFor("two"), 150, undefined);
    expect(bone(boxer, "gloveL").y).toBeLessThan(1.7);
    graph.awaitVerdict(1);
    graph.announce("winner");
    graph.resetTransient();
    run(graph, facingOpponent(baseFighter("one")), opponentFor("two"), 5, undefined);
    expect(bone(boxer, "gloveL").y).toBeLessThan(1.7);
  });
});

describe("infighting", () => {
  const settle = (gapUnits: number): { glove: number; head: THREE.Vector3 } => {
    const { boxer, graph } = makeGraph();
    const fighter = { ...facingOpponent(baseFighter("one")), defense: "guard_high" as const };
    const opponent = { ...opponentFor("two"), y: -gapUnits };
    run(graph, fighter, opponent, 90, undefined);
    return { glove: bone(boxer, "gloveL").z - boxer.root.position.z, head: bone(boxer, "head").sub(boxer.root.position) };
  };

  it("tucks the guard in and takes the head off the centre line when the opponent is on top of the fighter", () => {
    const open = settle(300);
    const inside = settle(76);
    const toward = Math.sign(open.glove);
    expect(toward * (open.glove - inside.glove)).toBeGreaterThan(0.08);
    expect(Math.abs(inside.head.x - open.head.x)).toBeGreaterThan(0.04);
    expect(toward * (open.head.z - inside.head.z)).toBeGreaterThan(0.03);
  });

  it("stands in the open stance at punching range", () => {
    const open = settle(300);
    const ranged = settle(170);
    expect(Math.abs(open.glove - ranged.glove)).toBeLessThan(0.005);
    expect(open.head.distanceTo(ranged.head)).toBeLessThan(0.005);
  });
});

describe("clinch hold", () => {
  it("ties up over the arms for the first-sorted fighter and under them for the other, heads to the right", () => {
    const clinched = (id: string): FighterSnapshot => ({ ...facingOpponent(baseFighter(id)), clinch_ticks: 30 });
    const held = (id: string): FighterSnapshot => ({ ...opponentFor(id), y: -100, clinch_ticks: 30 });
    const idle = makeGraph();
    run(idle.graph, facingOpponent(baseFighter("one")), { ...opponentFor("two"), y: -300 }, 60, undefined);
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

  /** The skinned skull above the neck cut, sampled, and the ellipsoid its bounding box holds in the head bone's frame. */
  const skull = (boxer: SkinnedBoxer): { inverse: THREE.Matrix4; centre: THREE.Vector3; radii: THREE.Vector3; points: THREE.Vector3[] } => {
    boxer.root.updateMatrixWorld(true);
    const mesh = boxer.headMesh;
    const inverse = boxer.bone("head")!.matrixWorld.clone().invert();
    const position = mesh.geometry.getAttribute("position");
    const points: THREE.Vector3[] = [];
    const box = new THREE.Box3();
    for (let index = 0; index < position.count; index += 7) {
      if (!aboveNeckCut(skinnedVertex.fromBufferAttribute(position, index))) continue;
      const point = mesh.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
      points.push(point);
      box.expandByPoint(point.clone().applyMatrix4(inverse));
    }
    return { inverse, centre: box.getCenter(new THREE.Vector3()), radii: box.getSize(new THREE.Vector3()).multiplyScalar(0.5), points };
  };
  /** How many sampled points of one skull are inside the other's. */
  const inside = (one: SkinnedBoxer, other: SkinnedBoxer): number => {
    const from = skull(one);
    const into = skull(other);
    const local = new THREE.Vector3();
    return from.points.filter((point) => {
      local.copy(point).applyMatrix4(into.inverse).sub(into.centre);
      return Math.hypot(local.x / into.radii.x, local.y / into.radii.y, local.z / into.radii.z) < 1;
    }).length;
  };

  it("rests the two heads on opposite shoulders whatever the stances, clear of each other through the struggle", () => {
    for (const [first, second] of [["orthodox", "orthodox"], ["orthodox", "southpaw"], ["southpaw", "orthodox"], ["southpaw", "southpaw"]] as const) {
      const one = makeGraph();
      const two = makeGraph();
      // Held at the engine's clinch distance, 60 units, as the hold draws them in.
      const a: FighterSnapshot = { ...facingOpponent(baseFighter("one")), stance: first, clinch_ticks: 30 };
      const b: FighterSnapshot = { ...opponentFor("two"), stance: second, y: -60, clinch_ticks: 30 };
      const headA = new THREE.Vector3();
      const headB = new THREE.Vector3();
      let closest = Infinity;
      let overlapping = 0;
      for (let frame = 0; frame < 150; frame += 1) {
        const time = 1 + frame / 60;
        one.graph.update(a, b, 1 / 60, time, false, "full", 10 + frame * 0.5, frame > 0 ? headB : undefined);
        two.graph.update(b, a, 1 / 60, time, false, "full", 10 + frame * 0.5, frame > 0 ? headA : undefined);
        bone(one.boxer, "head", headA);
        bone(two.boxer, "head", headB);
        if (frame < 30) continue;
        closest = Math.min(closest, headA.distanceTo(headB));
        if (frame % 15 === 0) overlapping += inside(one.boxer, two.boxer) + inside(two.boxer, one.boxer);
      }
      expect(closest, `${first} v ${second}`).toBeGreaterThan(0.3);
      expect(overlapping, `${first} v ${second}`).toBe(0);
      // Each to his own right: one faces -z here, so his right is -x, and two's is +x.
      expect(headA.x).toBeLessThan(-0.1);
      expect(headB.x).toBeGreaterThan(0.1);
      one.boxer.dispose();
      two.boxer.dispose();
    }
  });
});

describe("on the ropes", () => {
  /** Fighter one with his back to the +x ropes, facing the middle, and two on top of him: `units` is one's engine x. */
  const pinned = (units: number): [FighterSnapshot, FighterSnapshot] => [
    { ...baseFighter("one"), x: units, y: 0, facing_x: -1000, facing_y: 0, defense: "guard_high" },
    { ...baseFighter("two"), x: units - 115, y: 0, facing_x: 1000, facing_y: 0 },
  ];
  const fight = (one: { boxer: SkinnedBoxer; graph: BoxingGraph }, two: { boxer: SkinnedBoxer; graph: BoxingGraph }, [a, b]: [FighterSnapshot, FighterSnapshot], frames: number, from = 0): void => {
    const headA = new THREE.Vector3();
    const headB = new THREE.Vector3();
    for (let frame = 0; frame < frames; frame += 1) {
      const time = 1 + (from + frame) / 60;
      one.graph.update(a, b, 1 / 60, time, false, "full", 10 + (from + frame) * 0.5, from + frame > 0 ? headB : undefined);
      two.graph.update(b, a, 1 / 60, time, false, "full", 10 + (from + frame) * 0.5, from + frame > 0 ? headA : undefined);
      bone(one.boxer, "head", headA);
      bone(two.boxer, "head", headB);
    }
  };
  /** How far past the line `ropeX` the skin reaches, near each rope's height and across the fighter's back. */
  const pastTheRope = (boxer: SkinnedBoxer, height: number, ropeX: number): number => {
    boxer.root.updateMatrixWorld(true);
    let furthest = -Infinity;
    boxer.root.traverse((object) => {
      if (!(object instanceof THREE.SkinnedMesh)) return;
      const count = object.geometry.getAttribute("position").count;
      for (let index = 0; index < count; index += 2) {
        object.getVertexPosition(index, skinnedVertex).applyMatrix4(object.matrixWorld);
        if (Math.abs(skinnedVertex.y - (height - 0.02)) < 0.03 && Math.abs(skinnedVertex.z) < 0.35) furthest = Math.max(furthest, skinnedVertex.x - ropeX);
      }
    });
    return furthest;
  };
  const lean = (boxer: SkinnedBoxer): number => bone(boxer, "upperChest").x - bone(boxer, "hips").x;

  it("draws a fighter the engine has past the ropes' give in, his back resting on the top rope, leaning back on it", () => {
    const limit = RING_HALF_WIDTH - FIGHTER_RADIUS;
    const open = [makeGraph(), makeGraph()] as const;
    fight(open[0], open[1], pinned(300), 90);
    const one = makeGraph();
    const two = makeGraph();
    fight(one, two, pinned(limit), 90);
    // Drawn in so that his back is no further out than the ropes give.
    expect(one.boxer.root.position.x + ROPE_BACK).toBeLessThanOrEqual(ROPE_LINE + ROPE_MAX_GIVE + 1e-6);
    // The man on top of him comes in with him: the gap between them is the engine's.
    expect(one.boxer.root.position.x - two.boxer.root.position.x).toBeCloseTo(mapping.x(115), 2);
    // No rope passes through him, and his back rests against the top one rather than standing off it.
    const rope = ROPE_LINE + ROPE_MAX_GIVE;
    const ropeRadius = 0.028;
    for (const height of [ROPE_HEIGHTS[1], ROPE_HEIGHTS[2]]) expect(pastTheRope(one.boxer, height, rope)).toBeLessThan(ropeRadius);
    expect(pastTheRope(one.boxer, ROPE_HEIGHTS[2], rope)).toBeGreaterThan(-0.06);
    // Leaning back toward the ropes from the hips.
    expect(lean(one.boxer) - lean(open[0].boxer)).toBeGreaterThan(0.05);
    // He eases back upright once he comes off the ropes.
    fight(one, two, pinned(300), 90, 90);
    expect(Math.abs(lean(one.boxer) - lean(open[0].boxer))).toBeLessThan(0.01);
    expect(one.boxer.root.position.x).toBeCloseTo(mapping.x(300), 2);
    for (const made of [...open, one, two]) made.boxer.dispose();
  });

  it("leaves the ropes alone short of their furthest give, where they bow behind him", () => {
    const one = makeGraph();
    const two = makeGraph();
    fight(one, two, pinned(380), 90);
    expect(one.boxer.root.position.x).toBeCloseTo(mapping.x(380), 3);
    expect(Math.abs(lean(one.boxer))).toBeLessThan(0.1);
    for (const made of [one, two]) made.boxer.dispose();
  });
});

describe("two heads at close range", () => {
  it("leans the head away from the other's rather than through it", () => {
    const { boxer, graph } = makeGraph();
    const fighter = facingOpponent(baseFighter("one"));
    const opponent = opponentFor("two");
    run(graph, fighter, opponent, 40, undefined);
    const own = bone(boxer, "head").clone();
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(boxer.root.getWorldQuaternion(new THREE.Quaternion()));
    forward.y = 0;
    const other = own.clone().addScaledVector(forward.normalize(), 0.06);
    for (let frame = 0; frame < 60; frame += 1) run(graph, fighter, opponent, 1, other, 20 + frame * 0.5, (40 + frame) / 60);
    expect(bone(boxer, "head").distanceTo(other)).toBeGreaterThan(0.15);
    // Clear of it, he stands as he did.
    for (let frame = 0; frame < 60; frame += 1) run(graph, fighter, opponent, 1, other.clone().addScaledVector(forward, 1), 50 + frame * 0.5, (100 + frame) / 60);
    expect(bone(boxer, "head").distanceTo(own)).toBeLessThan(0.03);
  });
});

describe("wave-off", () => {
  it("sweeps both gloves wide across the chest, below the face, while waving the fight off", () => {
    const { boxer, graph } = makeGraph();
    const fighter = facingOpponent(baseFighter("one"));
    const opponent = opponentFor("two");
    graph.waveOff(4);
    const xs: number[] = [];
    for (let frame = 0; frame < 120; frame += 1) {
      run(graph, fighter, opponent, 1, undefined, frame * 0.5, frame / 60);
      if (frame < 40) continue;
      const glove = bone(boxer, "gloveL");
      const head = bone(boxer, "head");
      xs.push(glove.x);
      expect(glove.y).toBeGreaterThan(0.95);
      expect(glove.y).toBeLessThan(head.y - 0.05);
    }
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.6);
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

describe("body-shot knockdown", () => {
  const kneelAfterBodyShot = (): { boxer: SkinnedBoxer; graph: BoxingGraph; fighter: FighterSnapshot; opponent: FighterSnapshot } => {
    const { boxer, graph } = makeGraph();
    const fighter = facingOpponent(baseFighter("one"));
    const opponent = opponentFor("two");
    run(graph, fighter, opponent, 10, undefined);
    graph.windedFor(0.35, -1);
    run(graph, { ...fighter, stunned_ticks: 10 }, opponent, 20, undefined, 5, 10 / 60);
    graph.fallToKnee(true);
    run(graph, { ...fighter, is_downed: true }, opponent, 90, undefined, 15, 30 / 60);
    return { boxer, graph, fighter, opponent };
  };

  it("takes a knee: the rear knee on the canvas, the glove on the struck side clamped on the ribs, the other on the front knee", () => {
    const { boxer } = kneelAfterBodyShot();
    const rearKnee = bone(boxer, "kneeR");
    const frontKnee = bone(boxer, "kneeL");
    const hips = bone(boxer, "hips");
    expect(rearKnee.y).toBeLessThan(0.16);
    expect(frontKnee.y).toBeGreaterThan(0.4);
    expect(bone(boxer, "ankleL").y).toBeLessThan(0.2);
    expect(hips.y).toBeGreaterThan(0.4);
    expect(hips.y).toBeLessThan(0.65);
    const head = bone(boxer, "head");
    expect(head.y).toBeGreaterThan(0.75);
    expect(head.y).toBeLessThan(1.25);
    expect(bone(boxer, "gloveL").distanceTo(frontKnee)).toBeLessThan(0.25);
    const clutch = bone(boxer, "gloveR");
    expect(clutch.x).toBeLessThan(hips.x);
    expect(clutch.y).toBeGreaterThan(0.5);
    expect(clutch.y).toBeLessThan(0.85);
  });

  it("gets up off the knee, and the next knockdown that is not a body shot is a fall again", () => {
    const { boxer, graph, fighter, opponent } = kneelAfterBodyShot();
    run(graph, fighter, opponent, 140, undefined, 60, 2);
    expect(bone(boxer, "hips").y).toBeGreaterThan(0.72);
    graph.react("hit", "head", 1, "uppercut", "right", 420);
    run(graph, { ...fighter, is_downed: true }, opponent, 70, undefined, 140, 5);
    expect(bone(boxer, "head").y).toBeLessThan(0.45);
  });

  it("folds over the shot before he goes down", () => {
    const { boxer, graph } = makeGraph();
    const fighter = facingOpponent(baseFighter("one"));
    const opponent = opponentFor("two");
    run(graph, fighter, opponent, 30, undefined);
    const upright = bone(boxer, "head").clone();
    graph.windedFor(1, 1);
    run(graph, { ...fighter, stunned_ticks: 20 }, opponent, 20, undefined, 15, 0.5);
    const folded = bone(boxer, "head");
    expect(folded.y).toBeLessThan(upright.y - 0.12);
    const clutch = bone(boxer, "gloveL");
    expect(clutch.y).toBeLessThan(1.1);
    expect(clutch.x).toBeGreaterThan(bone(boxer, "hips").x);
  });
});

describe("parry", () => {
  it("knocks the puncher back with his guard thrown off", () => {
    const { boxer, graph } = makeGraph();
    const fighter = facingOpponent(baseFighter("one"));
    const opponent = opponentFor("two");
    run(graph, fighter, opponent, 40, undefined);
    const head = bone(boxer, "head").clone();
    const lean = head.z - bone(boxer, "hips").z;
    const glove = bone(boxer, "gloveL").clone();
    graph.stagger();
    run(graph, fighter, opponent, 6, undefined, 20, 40 / 60);
    expect(bone(boxer, "head").z).toBeLessThan(head.z - 0.03);
    expect(bone(boxer, "head").z - bone(boxer, "hips").z).toBeLessThan(lean - 0.02);
    expect(bone(boxer, "gloveL").y).toBeLessThan(glove.y - 0.02);
  });
});

describe("cutman's bottle", () => {
  it("holds a bottle at the mouth for the breath and the enswell for a cut", () => {
    const { boxer, graph } = makeGraph();
    const mouth = new THREE.Vector3(0.03, 1.1, 0.5);
    graph.treat(mouth, new THREE.Vector3(0, 0, -1), 1, "bottle");
    run(graph, facingOpponent(baseFighter("one")), opponentFor("two"), 90, undefined);
    const glove = boxer.rig.bones.gloveL;
    expect(glove.getObjectByName("bottle")?.visible).toBe(true);
    expect(glove.getObjectByName("enswell")?.visible).toBe(false);
    expect(bone(boxer, "gloveL").distanceTo(new THREE.Vector3(mouth.x, mouth.y + 0.02, mouth.z - 0.3))).toBeLessThan(0.12);
    graph.treat(mouth, new THREE.Vector3(0, 0, -1), 1, "enswell");
    run(graph, facingOpponent(baseFighter("one")), opponentFor("two"), 30, undefined, 45, 1.5);
    expect(glove.getObjectByName("bottle")?.visible).toBe(false);
    expect(glove.getObjectByName("enswell")?.visible).toBe(true);
  });
});

describe("per-frame allocations", () => {
  /** Counts the vectors, quaternions and Euler angles built (clones included) while `body` runs. */
  const constructions = (body: () => void): number => {
    let count = 0;
    const counted = [[THREE.Vector3.prototype, "x"], [THREE.Quaternion.prototype, "_x"], [THREE.Euler.prototype, "_x"]] as const;
    for (const [prototype, key] of counted) {
      // Each constructor assigns this field first: count it, then make it the instance's own plain field.
      Object.defineProperty(prototype, key, {
        configurable: true,
        set(this: object, value: number) {
          count += 1;
          Object.defineProperty(this, key, { value, writable: true, enumerable: true, configurable: true });
        },
      });
    }
    try {
      body();
    } finally {
      for (const [prototype, key] of counted) Reflect.deleteProperty(prototype, key);
    }
    return count;
  };

  it("builds no vectors while idle, falling, down or getting up, or with a dislocated jaw", () => {
    const { graph } = makeGraph();
    const fighter = facingOpponent(baseFighter("one"));
    const opponent = opponentFor("two");
    const downed = { ...fighter, is_downed: true };
    run(graph, fighter, opponent, 30, undefined);
    expect(constructions(() => run(graph, fighter, opponent, 10, undefined, 15, 0.5))).toBe(0);
    graph.react("hit", "head", 1, "uppercut", "left", 120);
    expect(constructions(() => run(graph, downed, opponent, 20, undefined, 20, 0.7))).toBe(0);
    run(graph, downed, opponent, 60, undefined, 30, 1);
    expect(constructions(() => run(graph, downed, opponent, 10, undefined, 60, 2))).toBe(0);
    expect(constructions(() => run(graph, fighter, opponent, 60, undefined, 65, 2.2))).toBe(0);
    graph.setArcadeDislocation("jaw");
    expect(constructions(() => run(graph, fighter, opponent, 10, undefined, 100, 3.5))).toBe(0);
  });
});

describe("transition sweep", () => {
  const PUNCHES = ["jab", "straight", "hook", "uppercut"] as const;
  // 9.6 m/s: a straight's glove peaks near 7 m/s and a hook's elbow from the crowded guard of fighters this close
  // near 9.2 m/s, while the snaps this guards against moved bones 0.5 m in a frame.
  const MAX_STEP = 0.16;

  it("moves every bone smoothly, keeps the skin above the canvas and bends the knees forward from idle through punches, falls, get-ups, the corner stool and a taunt", () => {
    const { boxer, graph } = makeGraph();
    const opponent = opponentFor("two");
    const head = new THREE.Vector3(0, 1.5, mapping.z(-150));
    const idle = facingOpponent({ ...baseFighter("one"), get_up_required: 66 });
    const downed = { ...idle, is_downed: true };
    const released = { ...idle, get_up_meter: 66, stunned_ticks: 20 };
    const bones = Object.entries(boxer.rig.bones);
    const previous = bones.map(() => new THREE.Vector3());
    const position = new THREE.Vector3();
    const vertex = new THREE.Vector3();
    const meshes: THREE.SkinnedMesh[] = [];
    boxer.root.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh) meshes.push(object);
    });
    let tick = 0;
    let frames = 0;
    let jump = { distance: 0, at: "" };
    let lowest = { height: Infinity, at: "" };
    let knee = { along: Infinity, at: "" };
    const step = (label: string, fighter: FighterSnapshot | ((frame: number) => FighterSnapshot), count: number): void => {
      for (let frame = 0; frame < count; frame += 1) {
        tick += 0.5;
        graph.update(typeof fighter === "function" ? fighter(frame) : fighter, opponent, 1 / 60, tick / 30, false, "full", tick, head);
        boxer.root.updateMatrixWorld(true);
        for (const [index, [name, joint]] of bones.entries()) {
          const distance = frames === 0 ? 0 : worldPosition(joint, position).distanceTo(previous[index]!);
          if (distance > jump.distance) jump = { distance, at: `${label} frame ${frame} ${name}` };
          worldPosition(joint, previous[index]!);
        }
        if (frames % 3 === 0) {
          for (const mesh of meshes) {
            const count = mesh.geometry.getAttribute("position").count;
            for (let index = 0; index < count; index += 2) {
              const height = mesh.getVertexPosition(index, vertex).applyMatrix4(mesh.matrixWorld).y;
              if (height < lowest.height) lowest = { height, at: `${label} frame ${frame} ${mesh.name}` };
            }
          }
        }
        for (const side of ["L", "R"] as const) {
          const along = kneeBend(boxer, side);
          if (along !== null && along < knee.along) knee = { along, at: `${label} frame ${frame} knee${side}` };
        }
        frames += 1;
      }
    };
    const punch = (punchClass: (typeof PUNCHES)[number], hand: "left" | "right"): FighterSnapshot => {
      const timing = punchTiming(punchClass, "head", "normal");
      return {
        ...idle,
        action: punchClass, action_hand: hand, action_target: "head", action_power: "normal", action_id: `${punchClass}-${tick}`, action_key: `${punchClass}:${hand}:head:normal`,
        action_start_tick: tick + 0.5, action_startup_ticks: timing.startup, action_active_ticks: timing.active, action_recovery_ticks: timing.recovery,
      };
    };
    const getUp = (label: string): void => {
      step(`${label} get-up meter`, (frame) => ({ ...downed, get_up_meter: frame < 30 ? 22 : 44 }), 60);
      step(`${label} get-up`, released, 45);
    };

    step("idle", idle, 30);
    for (const punchClass of PUNCHES) step(punchClass, punch(punchClass, punchClass === "jab" || punchClass === "hook" ? "left" : "right"), 40);
    // The animated falls (reduced motion); "hand-over to the get-up" sweeps the knockout physics' ones.
    graph.useAuthoredFall();
    graph.react("hit", "head", 1, "hook", "left", 140);
    step("fall face down", downed, 70);
    getUp("first");
    step("stand", idle, 30);
    graph.useAuthoredFall();
    graph.react("hit", "head", 1, "uppercut", "right", 120);
    step("fall on the back", downed, 70);
    step("get-up meter", (frame) => ({ ...downed, get_up_meter: frame < 30 ? 22 : 44 }), 60);
    step("get-up", released, 8);
    graph.useAuthoredFall();
    step("knocked down rising", downed, 70);
    getUp("second");
    step("fight on", idle, 30);
    graph.setResting(true);
    step("rest", idle, 150);
    graph.setResting(false);
    step("round starts", idle, 90);
    // The count steps once per engine tick, every second frame.
    step("taunt", (frame) => ({ ...idle, taunt_ticks: Math.max(0, 60 - Math.floor(frame / 2)) }), 140);

    expect(jump.distance, jump.at).toBeLessThan(MAX_STEP);
    expect(lowest.height, lowest.at).toBeGreaterThan(-0.02);
    expect(knee.along, knee.at).toBeGreaterThan(0.25);
  });
});

describe("hand-over to the get-up", () => {
  // Live, the knockout physics plays the fall. As the fighter starts to get up it hands the body to the animated
  // get-up, which begins from the pose the fall left (hips, spine, gloves, ankles and the way each joint bends)
  // and follows the meter from there.
  const knockedDown = (punchClass: "hook" | "uppercut", hand: "left" | "right") => {
    const { boxer, graph } = makeGraph();
    const opponent = opponentFor("two");
    const head = new THREE.Vector3(0, 1.5, mapping.z(-150));
    const standing = facingOpponent({ ...baseFighter("one"), get_up_required: 66 });
    const downed = { ...standing, is_downed: true };
    const names = Object.keys(boxer.rig.bones) as CanonicalBone[];
    let previous: THREE.Vector3[] = [];
    let tick = 0;
    let jump = { distance: 0, at: "" };
    const step = (label: string, fighter: FighterSnapshot, frames: number, measure = true): void => {
      for (let frame = 0; frame < frames; frame += 1) {
        tick += 0.5;
        graph.update(fighter, opponent, 1 / 60, tick / 30, false, "full", tick, head);
        const now = names.map((name) => bone(boxer, name));
        if (measure) {
          for (const [index, position] of now.entries()) {
            const distance = position.distanceTo(previous[index]!);
            if (distance > jump.distance) jump = { distance, at: `${label} frame ${frame} ${names[index]}` };
          }
        }
        previous = now;
      }
    };
    step("guard", standing, 20, false);
    graph.react("hit", "head", 1, punchClass, hand, 120);
    step("fall", downed, 70, false);
    return { boxer, graph, step, standing, downed, jump: () => jump };
  };

  it.each([["hook", "left"], ["uppercut", "right"]] as const)("takes the body a %s left on the canvas into the get-up with no snap", (punchClass, hand) => {
    const { boxer, graph, step, standing, downed, jump } = knockedDown(punchClass, hand);
    expect(graph.fallBody).not.toBeNull();
    step("first press", { ...downed, get_up_meter: 22 }, 30);
    expect(graph.fallBody).toBeNull();
    step("second press", { ...downed, get_up_meter: 44 }, 30);
    step("up", { ...standing, get_up_meter: 66, stunned_ticks: 20 }, 40);
    // The whole body used to freeze where the physics left it and then snap 1.3 m into the get-up. The blend in
    // the body's frame is not yet seamless (a limb can still swing about 0.3 m in a frame), so this guards the snap.
    expect(jump().distance, jump().at).toBeLessThan(0.45);
    expect(bone(boxer, "head").y).toBeGreaterThan(1.4);
  });

  it("leaves a fighter the bout is over for where the physics left him, whatever his meter says", () => {
    const { graph, step, downed } = knockedDown("hook", "left");
    graph.stayDown(true);
    step("counted out", { ...downed, get_up_meter: 44 }, 30, false);
    expect(graph.fallBody).not.toBeNull();
    graph.stayDown(false);
    step("pressing", { ...downed, get_up_meter: 44 }, 2, false);
    expect(graph.fallBody).toBeNull();
  });
});
