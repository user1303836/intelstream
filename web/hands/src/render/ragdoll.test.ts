import { readFileSync } from "node:fs";
import * as THREE from "three";
import { fighter as baseFighter } from "../test/fixtures";
import type { DefensivePose, FighterSnapshot } from "../types";
import { BoxingGraph, SkinnedBoxer, loadBoxerGlb } from "./graph";
import { NECK_CUT_DEPTH, NECK_CUT_HEIGHT, NECK_CUT_SLOPE } from "./injury";
import { KnockoutRagdoll, P, PARTICLES, RADIUS, RagdollBody, blowImpulse, fallStyleFor, type ImpulseRecord } from "./ragdoll";
import { closeUpAngle } from "./renderer";
import { worldPosition, worldQuaternion } from "./rig";
import { ROPE_LINE, RING_FIGHT_HALF, worldMapping } from "./world";

const mapping = worldMapping({ tick_rate: 30, ring_half_width: 500, ring_half_height: 500 });
const gltf = await loadBoxerGlb();

const facing = (fighter: FighterSnapshot, x = 0, y = 0): FighterSnapshot => ({ ...fighter, facing_x: 0, facing_y: -1000, x, y });
const opponentAt = (x = 0, y = -150): FighterSnapshot => ({ ...baseFighter("two"), x, y, facing_x: 0, facing_y: 1000 });

function standing(x = 0, y = 0, defense?: DefensivePose): { boxer: SkinnedBoxer; graph: BoxingGraph; fighter: FighterSnapshot; opponent: FighterSnapshot; time: number } {
  const boxer = new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8 });
  const graph = new BoxingGraph(boxer, mapping);
  const fighter = { ...facing(baseFighter("one"), x, y), ...(defense === undefined ? {} : { defense }) };
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

  it("doubles him over a body shot onto his knees, where a crumple drops him in a heap", () => {
    // fold had crumple's stiffness, so a body shot that dropped him played the same fall as any other.
    const knees = (style: "fold" | "crumple"): number => {
      const { body, start } = bodyFromStance();
      body.start(start, new Float64Array(PARTICLES * 3), style);
      const shot = blowImpulse({ target: "body", punchClass: "hook", hand: "left", lateral: 1, amount: 120 });
      // The fighter faces -z: his left is -x, the puncher is toward -z.
      body.impulse({ step: 0, x: -shot.x, y: shot.y, z: -shot.z, driveX: -shot.driveX, driveY: shot.driveY, driveZ: -shot.driveZ, target: "body", twist: 0 });
      for (let step = 0; step < 36; step += 1) body.step();
      return Math.max(body.position[P.kneeL * 3 + 1]!, body.position[P.kneeR * 3 + 1]!);
    };
    // A third of a second in, the folded fighter is down on one knee with the other still up under him, while the
    // crumpled one's legs have gone from under him.
    expect(knees("fold")).toBeGreaterThan(knees("crumple") + 0.08);
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
    const hot = ["step", "carryHinges", "solveRigid", "solveRanges", "solveKnees", "solveTwist", "spinInertia", "solveElbows", "solveNeck", "solveFeet", "footNormal", "cone", "rotateAbout", "hinge", "satisfy", "hingeAxis", "solveArmsAgainstTorso", "closestOnSegment", "solveEnvironment", "applyFriction", "limitSpeed", "interpolate", "drive", "tiltHips", "prepareFrames", "segment", "frameFor", "blend", "elbowAxis", "kneeAxis"];
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
    expect(head.distanceTo(particle)).toBeLessThan(0.06);
  });

  it("turns the body into the fall from its first frame instead of holding the pose and then snapping", () => {
    // The blend-in from the standing pose used to slerp each bone into itself, so the bones held that pose for the
    // whole blend and then snapped: the chest turned 15 degrees and the head jumped 21 cm in one frame.
    for (const punchClass of ["straight", "hook"] as const) {
      const { boxer, graph, fighter, opponent, time } = standing();
      const bones = boxer.rig.bones;
      graph.react("hit", "head", 1, punchClass, "right", 120);
      let now = time;
      let chest = worldQuaternion(bones.chest, new THREE.Quaternion());
      let head = worldPosition(bones.head, new THREE.Vector3());
      let early = 0;
      let turn = 0;
      let move = 0;
      for (let frame = 1; frame <= 12; frame += 1) {
        now = frames(graph, { ...fighter, is_downed: true }, opponent, 1, now);
        const turned = worldQuaternion(bones.chest, new THREE.Quaternion());
        const moved = worldPosition(bones.head, new THREE.Vector3());
        const angle = THREE.MathUtils.radToDeg(turned.angleTo(chest));
        if (frame <= 5) early += angle;
        turn = Math.max(turn, angle);
        move = Math.max(move, moved.distanceTo(head));
        chest = turned;
        head = moved;
      }
      expect(early, punchClass).toBeGreaterThan(2);
      expect(turn, punchClass).toBeLessThan(8);
      expect(move, punchClass).toBeLessThan(0.12);
    }
  });

  it("brings the head back onto the neck when the fall starts with it thrown off by a slip or a blow", () => {
    const boxer = new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8 });
    const ragdoll = new KnockoutRagdoll(boxer.rig, boxer.root);
    boxer.rig.resetToRest();
    boxer.root.updateMatrixWorld(true);
    const bones = boxer.rig.bones;
    const onTheNeck = bones.head.position.clone();
    // The poser moves the head itself for slips and big blows; the fall takes over from that frame.
    bones.head.position.add(new THREE.Vector3(-4.2, -0.9, -7.4));
    boxer.root.updateMatrixWorld(true);
    expect(ragdoll.start("crumple")).toBe(true);
    for (let frame = 0; frame < 150; frame += 1) ragdoll.update(1 / 60, null);
    const where = bones.neck.localToWorld(onTheNeck.clone());
    expect(worldPosition(bones.head, new THREE.Vector3()).distanceTo(where)).toBeLessThan(0.001);
  });

  it("keeps the head on the neck, the belly its length and the skull on the canvas however the fall starts", () => {
    // Falls that start mid-slip or mid-weave, where the poser has moved the head off the neck. The physics' neck used to
    // keep that stretched length (15-21 cm against 10.7) and the skull ended up to 14.5 cm under the canvas, the head
    // bone up to 16 cm off its particle; pinning the chest to its particle then stretched the belly by up to 16 cm.
    const aboveNeckCut = (bind: THREE.Vector3): boolean => bind.y > NECK_CUT_HEIGHT - NECK_CUT_SLOPE * (bind.z - NECK_CUT_DEPTH) - 0.3;
    const vertex = new THREE.Vector3();
    const rest = new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8 });
    rest.rig.resetToRest();
    rest.root.updateMatrixWorld(true);
    const neck = worldPosition(rest.rig.bones.neck, new THREE.Vector3()).distanceTo(worldPosition(rest.rig.bones.head, vertex));
    const spine = worldPosition(rest.rig.bones.spine, new THREE.Vector3()).distanceTo(worldPosition(rest.rig.bones.chest, vertex));
    for (const defense of ["slip_left", "slip_right", "weave"] as const) {
      for (const punchClass of ["jab", "hook"] as const) {
        const { boxer, graph, fighter, opponent, time } = standing(0, 0, defense);
        const bones = boxer.rig.bones;
        graph.react("hit", "head", 1, punchClass, "right", 110);
        frames(graph, { ...fighter, is_downed: true, defense: "none" }, opponent, 300, time);
        const body = graph.fallBody!.body;
        const label = `${defense} ${punchClass}`;
        expect(at(body.position, P.neck).distanceTo(at(body.position, P.head)), label).toBeCloseTo(neck, 2);
        expect(worldPosition(bones.head, vertex).distanceTo(at(body.position, P.head)), label).toBeLessThan(0.01);
        expect(worldPosition(bones.spine, new THREE.Vector3()).distanceTo(worldPosition(bones.chest, vertex)), label).toBeCloseTo(spine, 2);
        const mesh = boxer.headMesh;
        mesh.updateMatrixWorld(true);
        const position = mesh.geometry.getAttribute("position");
        let lowest = Infinity;
        for (let index = 0; index < position.count; index += 1) {
          if (!aboveNeckCut(vertex.fromBufferAttribute(position, index))) continue;
          lowest = Math.min(lowest, mesh.getVertexPosition(index, vertex).applyMatrix4(mesh.matrixWorld).y);
        }
        expect(lowest, label).toBeGreaterThan(-0.035);
      }
    }
  });

  it("rolls the feet only as far as an ankle goes and never flicks them, in the air or on the canvas", () => {
    // Nothing bounded a foot's roll onto its edge: feet lay 60-90 degrees on their sides against the shin in 20 of
    // 21 falls, and the turn about the shin measured from a nearly degenerate projection (and only off the canvas)
    // flicked toes 39 cm in a 1/120 s step and toe bones 47 cm in a frame.
    let tilt = 0;
    let rest = 0;
    let stepMove = 0;
    let frameMove = 0;
    const tip = new THREE.Vector3();
    for (const punchClass of ["jab", "straight", "hook", "uppercut"] as const) {
      for (const hand of ["left", "right"] as const) {
        for (const amount of [60, 150]) {
          const { boxer, graph, fighter, opponent, time } = standing();
          graph.react("hit", "head", 1, punchClass, hand, amount);
          let now = frames(graph, { ...fighter, is_downed: true }, opponent, 12, time);
          const body = graph.fallBody!.body;
          const before = new Float64Array(PARTICLES * 3);
          const step = body.step.bind(body);
          const feet = (into: (value: number) => void): void => {
            for (const [toe, heel, ankle, knee] of [[P.toeL, P.heelL, P.ankleL, P.kneeL], [P.toeR, P.heelR, P.ankleR, P.kneeR]] as const) {
              const side = at(body.position, toe).sub(at(body.position, heel)).cross(at(body.position, ankle).sub(at(body.position, heel))).normalize();
              const shin = at(body.position, ankle).sub(at(body.position, knee)).normalize();
              into(THREE.MathUtils.radToDeg(Math.asin(Math.min(1, Math.abs(side.dot(shin))))));
            }
          };
          body.step = (replay) => {
            before.set(body.position);
            step(replay);
            feet((value) => { tilt = Math.max(tilt, value); });
            for (const toe of [P.toeL, P.toeR]) stepMove = Math.max(stepMove, at(body.position, toe).distanceTo(at(before, toe)));
          };
          const toes = [boxer.rig.bones.toeL, boxer.rig.bones.toeR];
          const last = toes.map((bone) => worldPosition(bone, new THREE.Vector3()));
          for (let frame = 0; frame < 228; frame += 1) {
            now = frames(graph, { ...fighter, is_downed: true }, opponent, 1, now);
            for (const [index, bone] of toes.entries()) {
              frameMove = Math.max(frameMove, worldPosition(bone, tip).distanceTo(last[index]!));
              last[index]!.copy(tip);
            }
          }
          feet((value) => { rest = Math.max(rest, value); });
        }
      }
    }
    // A foot pinned under a falling leg can be held past its range for a few frames, but it lies within it.
    expect(tilt).toBeLessThan(80);
    expect(rest).toBeLessThan(40);
    expect(stepMove).toBeLessThan(0.1);
    expect(frameMove).toBeLessThan(0.2);
  });

  it("lands the head on the canvas without the skull flipping or skidding across it", () => {
    // The skull's lean on the neck was corrected by turning only the skull, into the canvas when the head lay on it;
    // the canvas lifted it back out and the head skidded 11-30 cm a step, the head bone turning up to 95 degrees in a frame.
    let crownStep = 0;
    let headTurn = 0;
    let skullRest = 0;
    const turned = new THREE.Quaternion();
    for (const punchClass of ["jab", "straight", "hook", "uppercut"] as const) {
      for (const hand of ["left", "right"] as const) {
        for (const amount of [60, 105, 150]) {
          const { boxer, graph, fighter, opponent, time } = standing();
          graph.react("hit", "head", 1, punchClass, hand, amount);
          let now = frames(graph, { ...fighter, is_downed: true }, opponent, 12, time);
          const body = graph.fallBody!.body;
          const before = new Float64Array(PARTICLES * 3);
          const step = body.step.bind(body);
          body.step = (replay) => {
            before.set(body.position);
            step(replay);
            crownStep = Math.max(crownStep, at(body.position, P.crown).distanceTo(at(before, P.crown)));
          };
          let head = worldQuaternion(boxer.rig.bones.head, new THREE.Quaternion());
          for (let frame = 0; frame < 228; frame += 1) {
            now = frames(graph, { ...fighter, is_downed: true }, opponent, 1, now);
            worldQuaternion(boxer.rig.bones.head, turned);
            headTurn = Math.max(headTurn, THREE.MathUtils.radToDeg(turned.angleTo(head)));
            head.copy(turned);
          }
          const neck = at(body.position, P.head).sub(at(body.position, P.neck)).normalize();
          const skull = at(body.position, P.crown).sub(at(body.position, P.head)).normalize();
          skullRest = Math.max(skullRest, THREE.MathUtils.radToDeg(neck.angleTo(skull)));
        }
      }
    }
    expect(crownStep).toBeLessThan(0.1);
    expect(headTurn).toBeLessThan(60);
    // The skull leans on the neck no further than its 32 degrees, give or take a pass.
    expect(skullRest).toBeLessThan(36);
  });

  it("lies with his shoulders turned on his hips no further than a spine turns, however he went down", () => {
    let worst = 0;
    for (const punch of ["jab", "hook"] as const) {
      for (const target of ["head", "body"] as const) {
        const { graph, fighter, opponent, time } = standing();
        graph.react("hit", target, 1, punch, "left", 300);
        frames(graph, { ...fighter, is_downed: true }, opponent, 240, time);
        const p = graph.fallBody!.body.position;
        const spine = at(p, P.upper).sub(at(p, P.pelvis)).normalize();
        const hips = at(p, P.hipL).sub(at(p, P.hipR));
        hips.addScaledVector(spine, -hips.dot(spine));
        const shoulders = at(p, P.shoulderL).sub(at(p, P.shoulderR));
        shoulders.addScaledVector(spine, -shoulders.dot(spine));
        worst = Math.max(worst, Math.abs(Math.atan2(new THREE.Vector3().crossVectors(hips, shoulders).dot(spine), hips.dot(shoulders))));
      }
    }
    expect(THREE.MathUtils.radToDeg(worst)).toBeLessThan(45);
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

  it("comes to rest within two and a half seconds of the punch, with or without the opponent over him", () => {
    for (const obstacle of [false, true]) {
      for (const punch of ["jab", "straight", "hook", "uppercut"] as const) {
        for (const hand of ["left", "right"] as const) {
          for (const target of ["head", "body"] as const) {
            for (const amount of [140, 420]) {
              const { graph, fighter, opponent, time } = standing();
              if (obstacle) graph.setObstacle(0, mapping.z(-100));
              graph.react("hit", target, 1, punch, hand, amount);
              frames(graph, { ...fighter, is_downed: true }, opponent, 150, time);
              expect(graph.fallBody?.body.asleep, `${punch} ${hand} ${target} ${amount}${obstacle ? " with the opponent over him" : ""}`).toBe(true);
            }
          }
        }
      }
    }
  });

  it("replays the fall exactly when the opponent walks off another way", () => {
    const fallWith = (graph: BoxingGraph, fighter: FighterSnapshot, opponent: FighterSnapshot, from: number, walk: (frame: number) => number): number => {
      let time = from;
      for (let frame = 0; frame < 240; frame += 1) {
        graph.setObstacle(0, mapping.z(-100) + walk(frame));
        time += 1 / 60;
        graph.update({ ...fighter, is_downed: true }, opponent, 1 / 60, time, false, "full", time * 30);
      }
      return time;
    };
    const { graph, fighter, opponent, time } = standing();
    graph.react("hit", "body", 1, "hook", "right", 140);
    let now = fallWith(graph, fighter, opponent, time, (frame) => -frame * 0.012);
    const live = Float64Array.from(graph.fallBody!.body.position);
    graph.resetTransient(false);
    graph.primeReplayFall();
    now = frames(graph, fighter, opponent, 20, now);
    graph.react("hit", "body", 1, "hook", "right", 140);
    fallWith(graph, fighter, opponent, now, () => 0);
    expect(Float64Array.from(graph.fallBody!.body.position)).toEqual(live);
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
