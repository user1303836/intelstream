import { readFileSync } from "node:fs";
import * as THREE from "three";
import { fighter as baseFighter } from "../test/fixtures";
import type { FighterSnapshot } from "../types";
import { BoxingGraph, SkinnedBoxer, loadBoxerGlb } from "./graph";
import { KnockoutRagdoll, P, PARTICLES, RADIUS, RagdollBody, blowImpulse, fallStyleFor, type ImpulseRecord } from "./ragdoll";
import { closeUpAngle } from "./renderer";
import { worldPosition } from "./rig";
import { ROPE_LINE, RING_FIGHT_HALF, worldMapping } from "./world";

const mapping = worldMapping({ tick_rate: 30, ring_half_width: 500, ring_half_height: 500 });
const gltf = await loadBoxerGlb();

const facing = (fighter: FighterSnapshot, x = 0, y = 0): FighterSnapshot => ({ ...fighter, facing_x: 0, facing_y: -1000, x, y });
const opponentAt = (x = 0, y = -150): FighterSnapshot => ({ ...baseFighter("two"), x, y, facing_x: 0, facing_y: 1000 });

function standing(x = 0, y = 0): { boxer: SkinnedBoxer; graph: BoxingGraph; fighter: FighterSnapshot; opponent: FighterSnapshot; time: number } {
  const boxer = new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8 });
  const graph = new BoxingGraph(boxer, mapping);
  const fighter = facing(baseFighter("one"), x, y);
  const opponent = opponentAt(x, y - 150);
  for (let frame = 0; frame < 12; frame += 1) graph.update(fighter, opponent, 1 / 60, frame / 60, false, "full", frame / 2);
  return { boxer, graph, fighter, opponent, time: 12 / 60 };
}

function frames(graph: BoxingGraph, fighter: FighterSnapshot, opponent: FighterSnapshot, count: number, from: number, reducedMotion = false): number {
  let time = from;
  for (let frame = 0; frame < count; frame += 1) {
    time += 1 / 60;
    graph.update(fighter, opponent, 1 / 60, time, reducedMotion, "full", time * 30);
  }
  return time;
}

/** A particle body started from a fighter standing in guard, with the stance's own particle positions. */
function bodyFromStance(): { body: RagdollBody; start: Float64Array; ragdoll: KnockoutRagdoll } {
  const boxer = new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8 });
  const ragdoll = new KnockoutRagdoll(boxer.rig, boxer.root);
  const graph = new BoxingGraph(boxer, mapping);
  frames(graph, facing(baseFighter("one")), opponentAt(), 12, 0);
  const start = new Float64Array(PARTICLES * 3);
  (ragdoll as unknown as { read(out: Float64Array): void }).read(start);
  return { body: ragdoll.body, start, ragdoll };
}

const at = (positions: Float64Array, index: number): THREE.Vector3 => new THREE.Vector3(positions[index * 3]!, positions[index * 3 + 1]!, positions[index * 3 + 2]!);
const blow = (x: number, y: number, z: number, target: "head" | "body" = "head", drive: [number, number, number] = [0, 0, 0]): ImpulseRecord => ({ step: 0, x, y, z, driveX: drive[0], driveY: drive[1], driveZ: drive[2], target, twist: 0.3 });

describe("knockout physics", () => {
  it("keeps every bone its length through a fall", () => {
    const { body, start } = bodyFromStance();
    body.start(start, new Float64Array(PARTICLES * 3), "timber");
    body.impulse(blow(0, 2.6, -2.1, "head", [0, 0.3, -1]));
    const bones: [number, number][] = [[P.hipL, P.kneeL], [P.kneeL, P.ankleL], [P.hipR, P.kneeR], [P.kneeR, P.ankleR], [P.shoulderL, P.elbowL], [P.elbowL, P.wristL], [P.shoulderR, P.elbowR], [P.elbowR, P.wristR], [P.neck, P.head], [P.pelvis, P.chest], [P.chest, P.upper]];
    const lengths = bones.map(([i, j]) => at(start, i).distanceTo(at(start, j)));
    let worst = 0;
    for (let step = 0; step < 360; step += 1) {
      body.step();
      for (const [index, [i, j]] of bones.entries()) worst = Math.max(worst, Math.abs(at(body.position, i).distanceTo(at(body.position, j)) / lengths[index]! - 1));
    }
    expect(worst).toBeLessThan(0.03);
  });

  it("bends knees and elbows only the way they bend", () => {
    const { body, start } = bodyFromStance();
    body.start(start, new Float64Array(PARTICLES * 3), "crumple");
    body.impulse(blow(2.2, 0.2, -0.8, "head", [0.5, 0, 0.6]));
    const axis = new THREE.Vector3();
    let least = Infinity;
    let most = -Infinity;
    for (let step = 0; step < 360; step += 1) {
      body.step();
      for (const side of [0, 1] as const) {
        for (const [root, joint, end, hinge] of [
          [side === 0 ? P.hipL : P.hipR, side === 0 ? P.kneeL : P.kneeR, side === 0 ? P.ankleL : P.ankleR, body.kneeAxis(side, body.position, axis).clone()],
          [side === 0 ? P.shoulderL : P.shoulderR, side === 0 ? P.elbowL : P.elbowR, side === 0 ? P.wristL : P.wristR, body.elbowAxis(side, body.position, axis).clone()],
        ] as const) {
          const upper = at(body.position, joint).sub(at(body.position, root)).normalize();
          const lower = at(body.position, end).sub(at(body.position, joint)).normalize();
          const inPlane = lower.clone().addScaledVector(hinge, -lower.dot(hinge));
          if (inPlane.length() < 0.2) continue;
          inPlane.normalize();
          const flex = Math.atan2(new THREE.Vector3().crossVectors(upper, inPlane).dot(hinge), upper.dot(inPlane));
          least = Math.min(least, flex);
          most = Math.max(most, flex);
        }
      }
    }
    // A little past straight is allowed, and the joint softly corrects; never bent backwards.
    expect(least).toBeGreaterThan(-0.35);
    expect(most).toBeLessThan(2.7);
  });

  it("comes to rest on the canvas inside the ring", () => {
    const { body, start } = bodyFromStance();
    body.start(start, new Float64Array(PARTICLES * 3), "crumple");
    body.impulse(blow(0, 0.3, -2.8, "head", [0, 0, -1.2]));
    body.settle(8);
    expect(body.asleep).toBe(true);
    for (let i = 0; i < PARTICLES; i += 1) {
      expect(body.position[i * 3 + 1]!).toBeGreaterThanOrEqual(RADIUS[i]! - 0.001);
      expect(Math.abs(body.position[i * 3]!)).toBeLessThan(RING_FIGHT_HALF + 0.5);
      expect(Math.abs(body.position[i * 3 + 2]!)).toBeLessThan(RING_FIGHT_HALF + 0.5);
    }
    // Lying down: the pelvis and the chest are on the canvas, not propped up.
    expect(body.position[P.pelvis * 3 + 1]!).toBeLessThan(0.25);
    expect(body.position[P.upper * 3 + 1]!).toBeLessThan(0.3);
  });

  it("comes to rest whatever the style and the blow", () => {
    for (const style of ["timber", "crumple", "sag", "fold"] as const) {
      for (const [x, y, z, target] of [[0, 0, 0, "head"], [0, 2.4, -2, "head"], [2.6, 0.2, -0.8, "head"], [0.4, 0, -1.8, "body"]] as const) {
        const { body, start } = bodyFromStance();
        body.start(start, new Float64Array(PARTICLES * 3), style);
        body.impulse(blow(x, y, z, target, [x * 0.2, 0, z * 0.3]));
        body.settle(8);
        expect(body.asleep, `${style} ${x},${y},${z} ${target}`).toBe(true);
        expect(body.position[P.pelvis * 3 + 1]!).toBeLessThan(0.45);
      }
    }
  });

  it("stops a fighter against the ropes instead of letting him fall out of the ring", () => {
    const { body, start } = bodyFromStance();
    // Move the whole stance next to the ropes on the +x side and drive him into them.
    const shifted = Float64Array.from(start);
    for (let i = 0; i < PARTICLES; i += 1) shifted[i * 3] = shifted[i * 3]! + ROPE_LINE - 0.45;
    body.start(shifted, new Float64Array(PARTICLES * 3), "timber");
    body.impulse(blow(3, 0.2, 0, "head", [1.4, 0, 0]));
    body.settle(8);
    for (const i of [P.pelvis, P.hipL, P.hipR, P.belly, P.chest, P.upper]) expect(body.position[i * 3]!).toBeLessThan(ROPE_LINE);
  });

  it("falls the same way every time from the same start", () => {
    const run = (): Float64Array => {
      const { body, start } = bodyFromStance();
      body.start(start, new Float64Array(PARTICLES * 3), "sag");
      body.impulse(blow(-1.8, 0.4, -1.4, "head", [-0.4, 0, 0.3]));
      for (let step = 0; step < 240; step += 1) body.step();
      return Float64Array.from(body.position);
    };
    expect(run()).toEqual(run());
  });

  it("takes a blow at the step it was recorded when the fall is run again", () => {
    const { body, start } = bodyFromStance();
    body.start(start, new Float64Array(PARTICLES * 3), "crumple");
    for (let step = 0; step < 3; step += 1) body.step();
    const recorded = body.impulse(blow(0, 1.5, -2, "head", [0, 0, -0.8]));
    expect(recorded.step).toBe(3);
    for (let step = 0; step < 200; step += 1) body.step();
    const live = Float64Array.from(body.position);
    body.start(start, new Float64Array(PARTICLES * 3), "crumple");
    for (let step = 0; step < 203; step += 1) body.step([recorded]);
    expect(Float64Array.from(body.position)).toEqual(live);
  });

  it("drives the body the way the blow lands", () => {
    const straight = blowImpulse({ target: "head", punchClass: "straight", hand: "right", lateral: -1, amount: 120 });
    expect(straight.z).toBeLessThan(0);
    expect(straight.driveZ).toBeLessThan(0);
    const uppercut = blowImpulse({ target: "head", punchClass: "uppercut", hand: "right", lateral: -1, amount: 120 });
    expect(uppercut.y).toBeGreaterThan(Math.abs(uppercut.x));
    expect(uppercut.driveZ).toBeLessThan(0);
    for (const lateral of [1, -1]) {
      const hook = blowImpulse({ target: "head", punchClass: "hook", hand: lateral > 0 ? "left" : "right", lateral, amount: 120 });
      expect(Math.sign(hook.x)).toBe(lateral);
      expect(Math.sign(hook.driveX)).toBe(lateral);
    }
    const body = blowImpulse({ target: "body", punchClass: "hook", hand: "left", lateral: 1, amount: 120 });
    // A body shot drives the belly back and the rest of him forward over it: he folds.
    expect(body.z).toBeLessThan(0);
    expect(body.driveZ).toBeGreaterThan(0);
    // Harder blows hit harder, up to a limit.
    const soft = blowImpulse({ target: "head", punchClass: "straight", hand: "right", lateral: -1, amount: 40 });
    expect(Math.abs(soft.z)).toBeLessThan(Math.abs(straight.z));
    expect(Math.abs(blowImpulse({ target: "head", punchClass: "straight", hand: "right", lateral: -1, amount: 5000 }).z)).toBeLessThan(3.5);
  });

  it("chooses how he goes down from the blow", () => {
    expect(fallStyleFor("hook", "body", 200, 1)).toBe("fold");
    expect(fallStyleFor("straight", "head", 60, 1)).toBe("sag");
    for (let seed = 0; seed < 6; seed += 1) {
      expect(["timber", "crumple"]).toContain(fallStyleFor("uppercut", "head", 200, seed));
      expect(fallStyleFor("hook", "head", 200, seed)).toBe(fallStyleFor("hook", "head", 200, seed));
    }
  });

  it("builds nothing while it steps or draws", () => {
    const source = readFileSync("src/render/ragdoll.ts", "utf8");
    const hot = ["step", "carryHinges", "solveRigid", "solveRanges", "solveKnees", "solveElbows", "solveNeck", "solveFeet", "footNormal", "cone", "rotateAbout", "hinge", "satisfy", "hingeAxis", "solveArmsAgainstTorso", "closestOnSegment", "solveEnvironment", "applyFriction", "limitSpeed", "interpolate", "drive", "prepareFrames", "segment", "frameFor", "blend", "elbowAxis", "kneeAxis"];
    for (const name of hot) {
      const start = source.search(new RegExp(`\\n  (private )?(get )?${name}\\(`));
      expect(start, name).toBeGreaterThan(0);
      const end = source.indexOf("\n  }\n", start);
      const body = source.slice(start, end);
      // Constructors, iterator helpers, spreads, closures and array literals all allocate.
      expect(body, name).not.toMatch(/new |\.entries\(\)|\.map\(|\.slice\(|\.\.\.|of \[|=> |[=(,:]\s*\[\s*P\./);
    }
  });
});

describe("knockouts on the fighter", () => {
  it("falls under physics from the blow and lies where the fall ends", () => {
    const { boxer, graph, fighter, opponent, time } = standing();
    graph.react("hit", "head", 1, "uppercut", "right", 420);
    frames(graph, { ...fighter, is_downed: true }, opponent, 6, time);
    expect(graph.fallBody).not.toBeNull();
    frames(graph, { ...fighter, is_downed: true }, opponent, 240, time + 0.1);
    const head = worldPosition(boxer.rig.bones.head, new THREE.Vector3());
    const hips = worldPosition(boxer.rig.bones.hips, new THREE.Vector3());
    expect(head.y).toBeLessThan(0.4);
    expect(hips.y).toBeLessThan(0.3);
    // The skeleton follows the particles: the head bone sits on the head particle.
    const particle = graph.fallBody!.bodyPoint(0, new THREE.Vector3());
    expect(head.distanceTo(particle)).toBeLessThan(0.05);
  });

  it("keeps the authored fall under reduced motion", () => {
    const { boxer, graph, fighter, opponent, time } = standing();
    graph.react("hit", "head", 1, "straight", "right", 420);
    frames(graph, { ...fighter, is_downed: true }, opponent, 70, time, true);
    expect(graph.fallBody).toBeNull();
    expect(worldPosition(boxer.rig.bones.head, new THREE.Vector3()).y).toBeLessThan(0.45);
  });

  it("gets up from where the fall left him", () => {
    const { boxer, graph, fighter, opponent, time } = standing();
    graph.react("hit", "head", 1, "hook", "left", 420);
    let now = frames(graph, { ...fighter, is_downed: true }, opponent, 150, time);
    const pelvis = graph.fallBody!.pelvis(new THREE.Vector3());
    now = frames(graph, fighter, opponent, 1, now);
    expect(graph.fallBody).toBeNull();
    // The first frame of the get-up starts from the body on the canvas, not from the authored lying pose.
    expect(worldPosition(boxer.rig.bones.hips, new THREE.Vector3()).distanceTo(pelvis)).toBeLessThan(0.08);
    frames(graph, fighter, opponent, 130, now);
    expect(graph.isDown).toBe(false);
    expect(worldPosition(boxer.rig.bones.head, new THREE.Vector3()).y).toBeGreaterThan(1.45);
  });

  it("starts the get-up where the body lies, and only then walks back to his spot", () => {
    const { boxer, graph, fighter, opponent, time } = standing();
    graph.react("hit", "head", 1, "straight", "right", 420);
    let now = frames(graph, { ...fighter, is_downed: true }, opponent, 200, time);
    const pelvis = graph.fallBody!.pelvis(new THREE.Vector3());
    // The fighter's spot moves well away from where his body lies (the rendered root follows it).
    const moved = { ...fighter, x: fighter.x + 200 };
    now = frames(graph, { ...moved, is_downed: true }, opponent, 30, now);
    expect(Math.hypot(boxer.root.position.x - pelvis.x, boxer.root.position.z - pelvis.z)).toBeGreaterThan(0.9);
    // A third of the way into the get-up he is still rising where he fell, not at his spot.
    now = frames(graph, moved, opponent, 30, now);
    const hips = worldPosition(boxer.rig.bones.hips, new THREE.Vector3());
    expect(Math.hypot(hips.x - pelvis.x, hips.z - pelvis.z)).toBeLessThan(0.5);
    frames(graph, moved, opponent, 120, now);
    const standingHips = worldPosition(boxer.rig.bones.hips, new THREE.Vector3());
    expect(Math.hypot(standingHips.x - boxer.root.position.x, standingHips.z - boxer.root.position.z)).toBeLessThan(0.2);
  });

  it("runs the recorded fall again for the replay and ends where the live fall ended", () => {
    const { graph, fighter, opponent, time } = standing();
    graph.react("hit", "head", 1, "straight", "right", 420);
    let now = frames(graph, { ...fighter, is_downed: true }, opponent, 400, time);
    const live = Float64Array.from(graph.fallBody!.body.position);
    graph.resetTransient(false);
    graph.primeReplayFall();
    now = frames(graph, fighter, opponent, 20, now);
    expect(graph.fallBody).toBeNull();
    // The replayed blow arrives as the live one did; the recorded fall already holds it.
    graph.react("hit", "head", 1, "straight", "right", 420);
    frames(graph, { ...fighter, is_downed: true }, opponent, 400, now);
    expect(Float64Array.from(graph.fallBody!.body.position)).toEqual(live);
  });

  it("settles the recorded fall at once when the replay cuts back to live", () => {
    const { graph, fighter, opponent, time } = standing();
    graph.react("hit", "head", 1, "uppercut", "left", 420);
    const now = frames(graph, { ...fighter, is_downed: true }, opponent, 400, time);
    const live = Float64Array.from(graph.fallBody!.body.position);
    graph.resetTransient(false);
    graph.resetTransient(true);
    expect(graph.fallBody).not.toBeNull();
    expect(Float64Array.from(graph.fallBody!.body.position)).toEqual(live);
    frames(graph, { ...fighter, is_downed: true }, opponent, 2, now);
    expect(graph.fallBody!.body.position[P.pelvis * 3 + 1]!).toBeLessThan(0.3);
  });

  it("leaves a body shot that takes him to one knee to the animation, with nothing for the replay to run again", () => {
    const { graph, fighter, opponent, time } = standing();
    // An earlier knockdown under physics leaves a recorded fall behind.
    graph.react("hit", "head", 1, "straight", "right", 420);
    let now = frames(graph, { ...fighter, is_downed: true }, opponent, 120, time);
    now = frames(graph, fighter, opponent, 120, now);
    expect(graph.isDown).toBe(false);
    graph.useAuthoredFall();
    graph.react("hit", "body", 1, "hook", "left", 420);
    now = frames(graph, { ...fighter, is_downed: true }, opponent, 60, now);
    expect(graph.isDown).toBe(true);
    expect(graph.fallBody).toBeNull();
    // The replay cuts back to him lying where the animation put him, not to the earlier fall.
    graph.resetTransient(false);
    graph.primeReplayFall();
    graph.useAuthoredFall();
    now = frames(graph, { ...fighter, is_downed: true }, opponent, 30, now);
    expect(graph.fallBody).toBeNull();
    graph.resetTransient(true);
    expect(graph.fallBody).toBeNull();
    // The next knockdown is physics again.
    now = frames(graph, fighter, opponent, 130, now);
    frames(graph, { ...fighter, is_downed: true }, opponent, 3, now);
    expect(graph.fallBody).not.toBeNull();
  });

  it("frames the close-up of a fallen head from beyond the head, not across the body", () => {
    // Head at the origin, the body stretched out toward +x; with no blockers the shot would come from +x.
    const fallback = Math.PI / 2;
    expect(closeUpAngle(0, 0, null, 1.05, 2.2, fallback)).toBe(fallback);
    const body = [0.45, 0.8, 1.2].map((x) => ({ x, z: 0, radius: 0.28 }));
    const side = closeUpAngle(0, 0, null, 1.05, 2.2, fallback, body);
    expect(Math.sin(side)).toBeLessThan(0.5);
  });

  it("goes down for a flash knockout although the engine never counts him", () => {
    const { boxer, graph, fighter, opponent, time } = standing();
    graph.react("hit", "head", 1, "hook", "right", 420);
    graph.knockOut();
    frames(graph, fighter, opponent, 150, time);
    expect(graph.isDown).toBe(true);
    expect(worldPosition(boxer.rig.bones.head, new THREE.Vector3()).y).toBeLessThan(0.45);
    graph.resetTransient(false);
    frames(graph, fighter, opponent, 3, time + 3);
    expect(graph.isDown).toBe(false);
  });

  it("takes a blow presented just after the fall began, but not one long after", () => {
    const { graph, fighter, opponent, time } = standing();
    let now = frames(graph, { ...fighter, is_downed: true }, opponent, 2, time);
    const before = Float64Array.from(graph.fallBody!.body.position);
    graph.react("hit", "head", 1, "straight", "right", 420);
    now = frames(graph, { ...fighter, is_downed: true }, opponent, 20, now);
    const record = graph.fallBody!.record!;
    expect(record.impulses).toHaveLength(1);
    void before;
    frames(graph, { ...fighter, is_downed: true }, opponent, 30, now);
    graph.react("hit", "head", 1, "straight", "right", 420);
    expect(graph.fallBody!.record!.impulses).toHaveLength(1);
  });

  it("does not fall through the opponent standing over him", () => {
    const { graph, fighter, opponent, time } = standing();
    // The opponent stands right in front; a body shot folds him forward toward that spot.
    const ahead = new THREE.Vector3(0, 0, mapping.z(-150));
    graph.setObstacle(ahead.x, ahead.z);
    graph.react("hit", "body", 1, "hook", "left", 420);
    frames(graph, { ...fighter, is_downed: true }, opponent, 300, time);
    const body = graph.fallBody!.body;
    for (let i = 0; i < PARTICLES; i += 1) {
      if (body.position[i * 3 + 1]! > 1.75) continue;
      const distance = Math.hypot(body.position[i * 3]! - ahead.x, body.position[i * 3 + 2]! - ahead.z);
      expect(distance).toBeGreaterThan(0.24 + RADIUS[i]! - 0.02);
    }
  });
});
