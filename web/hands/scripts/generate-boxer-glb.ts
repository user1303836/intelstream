/**
 * Generates the skinned GLB humanoid for the Hands 3D presentation.
 *
 * The skeleton and bind pose mirror the procedural rig; clips are authored by
 * driving the procedural animator through scripted states and baking per-bone
 * keyframes at 30 Hz. Outputs:
 *   web/hands/src/assets/boxer-glb.ts       (base64 GLB, embedded in the bundle)
 *   web/hands/src/assets/boxer-markers.json (glove trajectories per punch clip)
 *
 * Run: npm run generate:glb   (from web/hands)
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { BoxerAnimator } from "../src/render/animation";
import { buildBoxer } from "../src/render/boxer";
import { PALETTES, worldMapping } from "../src/render/world";
import { punchTiming, totalTicks } from "../src/manifest";
import type { FighterSnapshot } from "../src/types";

class FileReaderPolyfill {
  result: unknown = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob: Blob): void {
    void blob.arrayBuffer().then((buffer) => {
      this.result = `data:application/octet-stream;base64,${Buffer.from(buffer).toString("base64")}`;
      this.onloadend?.();
    });
  }
}
(globalThis as Record<string, unknown>).FileReader = FileReaderPolyfill;
(globalThis as Record<string, unknown>).document = {
  createElement: (tag: string) =>
    tag === "canvas" ? { width: 0, height: 0, getContext: () => null } : {},
  createElementNS: () => ({}),
};

const OUT_DIR = fileURLToPath(new URL("./src/assets/", `file://${process.cwd()}/`));
const MAPPING = worldMapping({ tick_rate: 30, ring_half_width: 500, ring_half_height: 330 });

interface BoneSpec {
  readonly name: string;
  readonly parent: string | null;
  readonly position: readonly [number, number, number];
}

const BONES: readonly BoneSpec[] = [
  { name: "hips", parent: null, position: [0, 0.98, 0] },
  { name: "spine", parent: "hips", position: [0, 0.1, 0] },
  { name: "chest", parent: "spine", position: [0, 0, 0] },
  { name: "head", parent: "chest", position: [0, 0.44, 0] },
  { name: "shoulderL", parent: "chest", position: [0.215, 0.315, 0] },
  { name: "elbowL", parent: "shoulderL", position: [0, -0.3, 0] },
  { name: "gloveL", parent: "elbowL", position: [0, -0.3, 0] },
  { name: "shoulderR", parent: "chest", position: [-0.215, 0.315, 0] },
  { name: "elbowR", parent: "shoulderR", position: [0, -0.3, 0] },
  { name: "gloveR", parent: "elbowR", position: [0, -0.3, 0] },
  { name: "hipL", parent: "hips", position: [0.105, -0.02, 0] },
  { name: "kneeL", parent: "hipL", position: [0, -0.44, 0] },
  { name: "ankleL", parent: "kneeL", position: [0, -0.44, 0] },
  { name: "hipR", parent: "hips", position: [-0.105, -0.02, 0] },
  { name: "kneeR", parent: "hipR", position: [0, -0.44, 0] },
  { name: "ankleR", parent: "kneeR", position: [0, -0.44, 0] },
];

const BONE_INDEX = new Map(BONES.map((bone, index) => [bone.name, index]));
const CHILD_BONE = new Map<string, string>([
  ["chest", "head"],
  ["spine", "chest"],
  ["shoulderL", "elbowL"],
  ["elbowL", "gloveL"],
  ["shoulderR", "elbowR"],
  ["elbowR", "gloveR"],
  ["hipL", "kneeL"],
  ["kneeL", "ankleL"],
  ["hipR", "kneeR"],
  ["kneeR", "ankleR"],
]);

const baseFighter = (): FighterSnapshot => ({
  player_id: "one", x: 0, y: 0, facing: 1, velocity_x: 0, velocity_y: 0,
  stance: "orthodox", defense: "none", stamina: 1000, maximum_stamina: 1000,
  conditioning: 1000, guard: 700, poise: 600,
  trauma: { head: 0, body: 0, left_eye: 0, right_eye: 0, left_cut: 0, right_cut: 0, swelling: 0, bleeding: 0 },
  knockdowns: 0, warnings: 0, deductions: 0, stunned_ticks: 0, is_downed: false,
  action: null, action_hand: null, action_target: null, action_power: null,
  action_id: null, action_key: null, action_start_tick: 0,
  action_startup_ticks: 0, action_active_ticks: 0, action_recovery_ticks: 0, action_contact_tick: null,
  queued_actions: 0, clinch_startup_ticks: 0, clinch_ticks: 0, is_foul_recovery_target: false,
  taunt_ticks: 0, get_up_prompt: null, get_up_meter: 0, get_up_required: 0, get_up_count: 0,
  get_up_window_start_tick: 0, get_up_window_end_tick: 0,
});
const OPPONENT: FighterSnapshot = { ...baseFighter(), player_id: "two", x: 107, facing: -1 };

interface BakedClip {
  readonly name: string;
  readonly frames: number;
  readonly tracks: Map<string, number[][]>;
  readonly hipsPositions: number[][];
  readonly gloveMarkers: { left: number[][]; right: number[][] };
}

function bakeClip(
  name: string,
  frames: number,
  drive: (fighter: FighterSnapshot, frame: number) => FighterSnapshot,
  onFrame?: (animator: BoxerAnimator, frame: number) => void,
): BakedClip {
  const rig = buildBoxer(PALETTES[0]);
  const animator = new BoxerAnimator(rig, MAPPING);
  const tracks = new Map<string, number[][]>(BONES.map((bone) => [bone.name, []]));
  const hipsPositions: number[][] = [];
  const gloveMarkers = { left: [] as number[][], right: [] as number[][] };
  for (let frame = -12; frame < frames; frame += 1) {
    const active = Math.max(0, frame);
    const fighter = drive(baseFighter(), active);
    if (onFrame !== undefined && frame >= 0) onFrame(animator, frame);
    animator.update(fighter, OPPONENT, 1 / 30, frame / 30, false, "full", active);
    if (frame < 0) continue;
    rig.root.updateMatrixWorld(true);
    for (const bone of BONES) {
      const joint = rig.root.getObjectByName(bone.name);
      if (joint === undefined) throw new Error(`rig missing joint ${bone.name}`);
      const q = joint.quaternion;
      tracks.get(bone.name)!.push([q.x, q.y, q.z, q.w]);
    }
    hipsPositions.push([rig.hips.position.x, rig.hips.position.y, rig.hips.position.z]);
    const left = rig.gloveL.getWorldPosition(new THREE.Vector3());
    const right = rig.gloveR.getWorldPosition(new THREE.Vector3());
    gloveMarkers.left.push([Number(left.x.toFixed(4)), Number(left.y.toFixed(4)), Number(left.z.toFixed(4))]);
    gloveMarkers.right.push([Number(right.x.toFixed(4)), Number(right.y.toFixed(4)), Number(right.z.toFixed(4))]);
  }
  return { name, frames, tracks, hipsPositions, gloveMarkers };
}

function withPunch(
  fighter: FighterSnapshot,
  punchClass: "jab" | "straight" | "hook" | "uppercut",
  hand: "left" | "right",
): FighterSnapshot {
  const timing = punchTiming(punchClass, "head", "normal");
  return {
    ...fighter,
    action: punchClass,
    action_hand: hand,
    action_target: "head",
    action_power: "normal",
    action_id: `${punchClass}:${hand}`,
    action_key: `${punchClass}:${hand}:head:normal`,
    action_start_tick: 0,
    action_startup_ticks: timing.startup,
    action_active_ticks: timing.active,
    action_recovery_ticks: timing.recovery,
  };
}

function assignSkin(
  geometry: THREE.BufferGeometry,
  bone: string,
  parentBone: string | null,
  from: THREE.Vector3,
  to: THREE.Vector3,
): void {
  const position = geometry.getAttribute("position");
  const skinIndex = new Uint16Array(position.count * 4);
  const skinWeight = new Float32Array(position.count * 4);
  const direction = to.clone().sub(from);
  const length = Math.max(0.001, direction.length());
  direction.normalize();
  const boneIndex = BONE_INDEX.get(bone)!;
  const parentIndex = parentBone === null ? boneIndex : BONE_INDEX.get(parentBone)!;
  const childName = CHILD_BONE.get(bone);
  const childIndex = childName === undefined ? boneIndex : BONE_INDEX.get(childName)!;
  const point = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    point.set(position.getX(i), position.getY(i), position.getZ(i));
    const t = THREE.MathUtils.clamp(point.clone().sub(from).dot(direction) / length, 0, 1);
    let primary = 1;
    let secondary = 0;
    let secondaryIndex = boneIndex;
    if (t < 0.18 && parentBone !== null) {
      secondary = 0.5 * (1 - t / 0.18);
      secondaryIndex = parentIndex;
    } else if (t > 0.82 && childName !== undefined) {
      secondary = 0.5 * ((t - 0.82) / 0.18);
      secondaryIndex = childIndex;
    }
    primary = 1 - secondary;
    skinIndex[i * 4] = boneIndex;
    skinIndex[i * 4 + 1] = secondaryIndex;
    skinWeight[i * 4] = primary;
    skinWeight[i * 4 + 1] = secondary;
  }
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeight, 4));
}

function buildSkinnedGeometry(): { geometry: THREE.BufferGeometry; materialCount: number } {
  const geometries: THREE.BufferGeometry[] = [];
  const tags: number[] = [];

  const jointWorld = (name: string): THREE.Vector3 => {
    const spec = BONES.find((bone) => bone.name === name)!;
    const position = new THREE.Vector3(...spec.position);
    let parent = spec.parent;
    while (parent !== null) {
      const parentSpec = BONES.find((bone) => bone.name === parent)!;
      position.add(new THREE.Vector3(...parentSpec.position));
      parent = parentSpec.parent;
    }
    return position;
  };

  const addSegment = (
    from: THREE.Vector3,
    to: THREE.Vector3,
    radius: number,
    bone: string,
    parentBone: string | null,
    tag: number,
    flatten = 1,
  ): void => {
    const direction = to.clone().sub(from);
    const length = direction.length();
    const unit = direction.clone().normalize();
    const fromExtended = from.clone().addScaledVector(unit, -length * 0.06);
    const toExtended = to.clone().addScaledVector(unit, length * 0.06);
    const extendedDirection = toExtended.clone().sub(fromExtended);
    const extendedLength = extendedDirection.length();
    const geometry = new THREE.CapsuleGeometry(radius, extendedLength, 5, 12);
    geometry.scale(1, 1, flatten);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), extendedDirection.clone().normalize());
    const midpoint = fromExtended.clone().add(toExtended).multiplyScalar(0.5);
    geometry.applyMatrix4(new THREE.Matrix4().compose(midpoint, quaternion, new THREE.Vector3(1, 1, 1)));
    assignSkin(geometry, bone, parentBone, fromExtended, toExtended);
    tags.push(tag);
    geometries.push(geometry);
  };

  const hips = jointWorld("hips");
  const chest = jointWorld("chest");
  const head = jointWorld("head");
  addSegment(hips.clone().add(new THREE.Vector3(0, -0.08, 0)), chest.clone().add(new THREE.Vector3(0, 0.16, 0)), 0.16, "chest", "spine", 0, 0.82);
  addSegment(chest.clone().add(new THREE.Vector3(0, 0.12, 0)), chest.clone().add(new THREE.Vector3(0, 0.36, 0)), 0.175, "chest", "spine", 0, 0.85);
  addSegment(head.clone().add(new THREE.Vector3(0, -0.02, 0)), head.clone().add(new THREE.Vector3(0, 0.14, 0)), 0.1, "head", "chest", 0, 0.95);
  addSegment(head.clone().add(new THREE.Vector3(0, 0.1, 0)), head.clone().add(new THREE.Vector3(0, 0.26, 0)), 0.085, "head", "chest", 0, 0.98);
  for (const side of ["L", "R"] as const) {
    addSegment(jointWorld(`shoulder${side}`), jointWorld(`elbow${side}`), 0.06, `shoulder${side}`, "chest", 0);
    addSegment(jointWorld(`elbow${side}`), jointWorld(`glove${side}`), 0.05, `elbow${side}`, `shoulder${side}`, 0);
    addSegment(jointWorld(`glove${side}`), jointWorld(`glove${side}`).add(new THREE.Vector3(0, -0.12, 0.06)), 0.084, `glove${side}`, `elbow${side}`, 1);
    addSegment(jointWorld(`hip${side}`), jointWorld(`knee${side}`), 0.08, `hip${side}`, "hips", 0);
    addSegment(jointWorld(`knee${side}`), jointWorld(`ankle${side}`), 0.06, `knee${side}`, `hip${side}`, 0);
    addSegment(jointWorld(`ankle${side}`), jointWorld(`ankle${side}`).add(new THREE.Vector3(0, -0.1, 0.08)), 0.05, `ankle${side}`, `knee${side}`, 1);
  }
  const trunks = new THREE.CylinderGeometry(0.185, 0.155, 0.42, 16);
  trunks.translate(0, hips.y - 0.08, 0);
  assignSkin(trunks, "hips", null, hips, hips.clone().add(new THREE.Vector3(0, 0.2, 0)));
  tags.push(1);
  geometries.push(trunks);

  let totalVertices = 0;
  let totalIndices = 0;
  const ordered = geometries.map((geometry, index) => ({ geometry, tag: tags[index]! })).sort((a, b) => a.tag - b.tag);
  for (const { geometry } of ordered) {
    totalVertices += geometry.getAttribute("position").count;
    totalIndices += geometry.getIndex()!.count;
  }
  const positions = new Float32Array(totalVertices * 3);
  const normals = new Float32Array(totalVertices * 3);
  const skinIndex = new Uint16Array(totalVertices * 4);
  const skinWeight = new Float32Array(totalVertices * 4);
  const indices = new Uint32Array(totalIndices);
  const merged = new THREE.BufferGeometry();
  let vertexOffset = 0;
  let indexOffset = 0;
  let groupStart = 0;
  let groupLength = 0;
  let currentTag = -1;
  ordered.forEach(({ geometry, tag }) => {
    if (tag !== currentTag) {
      if (currentTag !== -1) merged.addGroup(groupStart, groupLength, currentTag);
      currentTag = tag;
      groupStart = indexOffset;
      groupLength = 0;
    }
    const position = geometry.getAttribute("position");
    positions.set(position.array as Float32Array, vertexOffset * 3);
    normals.set(geometry.getAttribute("normal").array as Float32Array, vertexOffset * 3);
    skinIndex.set(geometry.getAttribute("skinIndex").array as Uint16Array, vertexOffset * 4);
    skinWeight.set(geometry.getAttribute("skinWeight").array as Float32Array, vertexOffset * 4);
    const index = geometry.getIndex()!;
    for (let i = 0; i < index.count; i += 1) indices[indexOffset + i] = index.getX(i) + vertexOffset;
    vertexOffset += position.count;
    indexOffset += index.count;
    groupLength += index.count;
  });
  if (currentTag !== -1) merged.addGroup(groupStart, groupLength, currentTag);
  merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  merged.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndex, 4));
  merged.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeight, 4));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  return { geometry: merged, materialCount: 2 };
}

async function main(): Promise<void> {
  const clips: BakedClip[] = [];
  clips.push(bakeClip("idle", 60, (fighter) => fighter));
  clips.push(bakeClip("move_forward", 24, (fighter) => ({ ...fighter, velocity_x: 6 })));
  clips.push(bakeClip("move_backward", 24, (fighter) => ({ ...fighter, velocity_x: -6 })));
  clips.push(bakeClip("move_lateral", 24, (fighter) => ({ ...fighter, velocity_y: 6 })));
  clips.push(bakeClip("guard_high", 30, (fighter) => ({ ...fighter, defense: "guard_high" })));
  clips.push(bakeClip("guard_low", 30, (fighter) => ({ ...fighter, defense: "guard_low" })));

  const markerTrajectories: Record<string, { frames: number; left: number[][]; right: number[][] }> = {};
  for (const punchClass of ["jab", "straight", "hook", "uppercut"] as const) {
    for (const hand of ["left", "right"] as const) {
      const total = totalTicks(punchTiming(punchClass, "head", "normal"));
      const clip = bakeClip(`${punchClass}_${hand}`, total + 4, (fighter) => withPunch(fighter, punchClass, hand));
      clips.push(clip);
      markerTrajectories[`${punchClass}:${hand}`] = {
        frames: clip.frames,
        left: clip.gloveMarkers.left,
        right: clip.gloveMarkers.right,
      };
    }
  }
  clips.push(
    bakeClip("block_head", 14, (fighter) => fighter, (animator, frame) => {
      if (frame === 0) animator.impact({ direction: 1, amount: 120, blocked: true });
    }),
  );
  clips.push(
    bakeClip("hit_head", 16, (fighter) => fighter, (animator, frame) => {
      if (frame === 0) animator.impact({ direction: 1, amount: 320, blocked: false });
    }),
  );
  clips.push(bakeClip("knockdown", 42, (fighter) => ({ ...fighter, is_downed: true })));
  clips.push(bakeClip("getup", 30, (fighter, frame) => ({ ...fighter, is_downed: frame < 10 })));

  const { geometry } = buildSkinnedGeometry();
  const bones = BONES.map((spec) => {
    const bone = new THREE.Bone();
    bone.name = spec.name;
    bone.position.set(...spec.position);
    return bone;
  });
  BONES.forEach((spec, index) => {
    if (spec.parent !== null) bones[BONE_INDEX.get(spec.parent)!]!.add(bones[index]!);
  });
  const skinMaterial = new THREE.MeshStandardMaterial({ color: 0xa9744f, roughness: 0.6 });
  skinMaterial.name = "skin";
  const gearMaterial = new THREE.MeshStandardMaterial({ color: 0x14406b, roughness: 0.4 });
  gearMaterial.name = "gear";
  const mesh = new THREE.SkinnedMesh(geometry, [skinMaterial, gearMaterial]);
  mesh.name = "boxer";
  mesh.add(bones[0]!);
  bones[0]!.updateMatrixWorld(true);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));

  const animationClips = clips.map((clip) => {
    const tracks: THREE.KeyframeTrack[] = [];
    const times = Array.from({ length: clip.frames }, (_unused, index) => index / 30);
    for (const bone of BONES) {
      tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, clip.tracks.get(bone.name)!.flat()));
    }
    tracks.push(new THREE.VectorKeyframeTrack("hips.position", times, clip.hipsPositions.flat()));
    return new THREE.AnimationClip(clip.name, clip.frames / 30, tracks);
  });

  const scene = new THREE.Scene();
  scene.add(mesh);

  const glb = await new Promise<ArrayBuffer>((resolve, reject) => {
    new GLTFExporter().parse(
      scene,
      (result) => resolve(result as ArrayBuffer),
      (error: unknown) => reject(error instanceof Error ? error : new Error(String(error))),
      { binary: true, animations: animationClips },
    );
  });

  mkdirSync(OUT_DIR, { recursive: true });
  const base64 = Buffer.from(glb).toString("base64");
  const sha = createHash("sha256").update(base64).digest("hex");
  writeFileSync(
    `${OUT_DIR}/boxer-glb.ts`,
    `// Generated by scripts/generate-boxer-glb.ts — do not edit by hand.\nexport const BOXER_GLB_BASE64 = "${base64}";\nexport const BOXER_GLB_SHA256 = "${sha}";\n`,
  );
  writeFileSync(`${OUT_DIR}/boxer-markers.json`, JSON.stringify({ format: 1, trajectories: markerTrajectories }, null, 1) + "\n");
  console.log(`GLB: ${glb.byteLength} bytes, ${animationClips.length} clips, base64 ${base64.length} chars, sha256 ${sha}`);
}

await main();
