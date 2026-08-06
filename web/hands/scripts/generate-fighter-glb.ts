/**
 * Generates the skinned fighter GLB for the Hands 3D presentation by
 * retargeting the tuned procedural boxing motion onto the CC0 KayKit
 * Barbarian armature (assets-src/Barbarian.glb).
 *
 * Method: per canonical bone, the world-space rotation delta from the
 * procedural rig's rest pose is applied to the model's rest pose
 * (rest-pose-offset retarget), then converted to model-local keyframes.
 * Hips translation is retargeted scaled by the rest hip-height ratio.
 *
 * Outputs:
 *   web/hands/src/assets/fighter-glb.ts        (base64 GLB with 18 clips)
 *   web/hands/src/assets/fighter-texture.ts    (base64 palette PNG)
 *   web/hands/src/assets/fighter-markers.json  (glove trajectories per punch)
 *
 * Run: npm run generate:fighter   (from web/hands)
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BoxerAnimator } from "../src/render/animation";
import { BONE_ADAPTER } from "../src/render/skeleton";
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
const globals = globalThis as Record<string, unknown>;
globals.FileReader = FileReaderPolyfill;
globals.self = globalThis;
globals.window = globalThis;
globals.createImageBitmap = async () => ({ width: 2, height: 2, close() {} });
globals.document = {
  createElement: (tag: string) => (tag === "canvas" ? { width: 0, height: 0, getContext: () => null } : {}),
  createElementNS: () => ({}),
};

const OUT_DIR = `${process.cwd()}/src/assets`;
const MAPPING = worldMapping({ tick_rate: 30, ring_half_width: 500, ring_half_height: 330 });


const CANONICAL_ORDER = [
  "hips", "spine", "chest", "head",
  "shoulderL", "elbowL", "gloveL",
  "shoulderR", "elbowR", "gloveR",
  "hipL", "kneeL", "ankleL",
  "hipR", "kneeR", "ankleR",
] as const;

/** Limb bones retarget by child-aim direction (convention-free). */
const AIM_BONES: Record<string, string> = {
  shoulderL: "elbowL",
  elbowL: "gloveL",
  shoulderR: "elbowR",
  elbowR: "gloveR",
  hipL: "kneeL",
  kneeL: "ankleL",
  hipR: "kneeR",
  kneeR: "ankleR",
};

const MODEL_PARENT: Record<string, string | null> = {
  hips: "root",
  spine: "hips",
  chest: "spine",
  head: "chest",
  upperarml: "chest",
  lowerarml: "upperarml",
  wristl: "lowerarml",
  upperarmr: "chest",
  lowerarmr: "upperarmr",
  wristr: "lowerarmr",
  upperlegl: "hips",
  lowerlegl: "upperlegl",
  footl: "lowerlegl",
  upperlegr: "hips",
  lowerlegr: "upperlegr",
  footr: "lowerlegr",
};

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
const OPPONENT: FighterSnapshot = { ...baseFighter(), player_id: "two", x: 0, y: -107, facing: -1 };

async function loadModel(path: string): Promise<GLTF> {
  const buffer = readFileSync(path);
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      "",
      resolve,
      (error: unknown) => reject(error instanceof Error ? error : new Error(String(error))),
    );
  });
}

interface RetargetContext {
  readonly scene: THREE.Group;
  readonly modelBones: Map<string, THREE.Bone>;
  readonly modelRestWorld: Map<string, THREE.Quaternion>;
  readonly modelRestDirections: Map<string, THREE.Vector3>;
  readonly oursRestWorld: Map<string, THREE.Quaternion>;
  readonly modelHipsRest: THREE.Vector3;
  readonly hipsScale: number;
}

function buildRetargetContext(model: GLTF): RetargetContext {
  const scene = model.scene;
  scene.updateMatrixWorld(true);
  const modelBones = new Map<string, THREE.Bone>();
  scene.traverse((object) => {
    if (object instanceof THREE.Bone) modelBones.set(object.name, object);
  });
  const available = [...modelBones.keys()].sort();
  const missing = Object.entries(BONE_ADAPTER).filter(([, target]) => !modelBones.has(target));
  if (missing.length > 0) {
    throw new Error(
      `Barbarian.glb is missing required bones: ${missing.map(([from, to]) => `${from}→${to}`).join(", ")}\navailable: ${available.join(", ")}`,
    );
  }
  const ours = buildBoxer(PALETTES[0]);
  ours.root.updateMatrixWorld(true);
  const oursRestWorld = new Map<string, THREE.Quaternion>();
  for (const name of CANONICAL_ORDER) {
    const joint = ours.root.getObjectByName(name);
    if (joint === undefined) throw new Error(`procedural rig missing joint ${name}`);
    oursRestWorld.set(name, joint.getWorldQuaternion(new THREE.Quaternion()));
  }
  const modelRestWorld = new Map<string, THREE.Quaternion>();
  for (const target of Object.values(BONE_ADAPTER)) {
    modelRestWorld.set(target, modelBones.get(target)!.getWorldQuaternion(new THREE.Quaternion()));
  }
  const modelRestDirections = new Map<string, THREE.Vector3>();
  for (const [name, childName] of Object.entries(AIM_BONES)) {
    const bonePosition = modelBones.get(BONE_ADAPTER[name]!)!.getWorldPosition(new THREE.Vector3());
    const childPosition = modelBones.get(BONE_ADAPTER[childName]!)!.getWorldPosition(new THREE.Vector3());
    modelRestDirections.set(BONE_ADAPTER[name]!, childPosition.sub(bonePosition).normalize());
  }
  const modelHipsRest = modelBones.get("hips")!.getWorldPosition(new THREE.Vector3());
  const oursHipsRest = ours.hips.getWorldPosition(new THREE.Vector3());
  return {
    scene,
    modelBones,
    modelRestWorld,
    modelRestDirections,
    oursRestWorld,
    modelHipsRest,
    hipsScale: modelHipsRest.y / oursHipsRest.y,
  };
}

interface BakedClip {
  readonly name: string;
  readonly frames: number;
  readonly tracks: Map<string, number[][]>;
  readonly hipsPositions: number[][];
  readonly gloveMarkers: { left: number[][]; right: number[][] };
}

function bakeRetargetedClip(
  context: RetargetContext,
  name: string,
  frames: number,
  drive: (fighter: FighterSnapshot, frame: number) => FighterSnapshot,
  onFrame?: (animator: BoxerAnimator, frame: number) => void,
): BakedClip {
  const rig = buildBoxer(PALETTES[0]);
  const animator = new BoxerAnimator(rig, MAPPING);
  const oursJoints = new Map<string, THREE.Object3D>();
  for (const name of CANONICAL_ORDER) {
    oursJoints.set(name, rig.root.getObjectByName(name)!);
  }
  const tracks = new Map<string, number[][]>(CANONICAL_ORDER.map((name) => [name, []]));
  const hipsPositions: number[][] = [];
  const gloveMarkers = { left: [] as number[][], right: [] as number[][] };

  const oursWorld = new THREE.Quaternion();
  const delta = new THREE.Quaternion();
  const deltaQ = new THREE.Quaternion();
  const targetWorld = new THREE.Quaternion();
  const parentWorldInverse = new THREE.Quaternion();
  const modelWorld = new Map<string, THREE.Quaternion>();
  const scratchBonePos = new THREE.Vector3();
  const scratchChildPos = new THREE.Vector3();

  const oursHipsRestLocal = new THREE.Vector3(0, 0.98, 0);

  for (let frame = -12; frame < frames; frame += 1) {
    const active = Math.max(0, frame);
    const fighter = drive(baseFighter(), active);
    if (onFrame !== undefined && frame >= 0) onFrame(animator, frame);
    animator.update(fighter, OPPONENT, 1 / 30, frame / 30, false, "full", active);
    if (frame < 0) continue;
    rig.root.updateMatrixWorld(true);

    modelWorld.clear();
    for (const name of CANONICAL_ORDER) {
      const modelName = BONE_ADAPTER[name]!;
      const parentModelName = MODEL_PARENT[modelName] ?? null;
      const parentWorld = parentModelName !== null && modelWorld.has(parentModelName)
        ? modelWorld.get(parentModelName)!
        : context.modelRestWorld.get(parentModelName ?? "root") ?? new THREE.Quaternion();
      const aimChild = AIM_BONES[name];
      if (aimChild !== undefined) {
        const boneWorld = oursJoints.get(name)!.getWorldPosition(scratchBonePos);
        const childWorld = oursJoints.get(aimChild)!.getWorldPosition(scratchChildPos);
        const direction = childWorld.sub(boneWorld).normalize();
        const restDirection = context.modelRestDirections.get(modelName)!;
        deltaQ.setFromUnitVectors(restDirection, direction);
        targetWorld.copy(deltaQ).multiply(context.modelRestWorld.get(modelName)!);
      } else {
        oursJoints.get(name)!.getWorldQuaternion(oursWorld);
        delta.copy(oursWorld).multiply(context.oursRestWorld.get(name)!.clone().invert());
        targetWorld.copy(delta).multiply(context.modelRestWorld.get(modelName)!);
      }
      modelWorld.set(modelName, targetWorld.clone());
      parentWorldInverse.copy(parentWorld).invert();
      const local = parentWorldInverse.clone().multiply(targetWorld);
      tracks.get(name)!.push([local.x, local.y, local.z, local.w]);
    }

    const hipsDelta = rig.hips.position.clone().sub(oursHipsRestLocal).multiplyScalar(context.hipsScale);
    const modelHipsLocal = context.modelBones.get("hips")!.position.clone().add(hipsDelta);
    hipsPositions.push([modelHipsLocal.x, modelHipsLocal.y, modelHipsLocal.z]);

    // Marker positions: model-space wrist world positions under this pose.
    const wristL = computeModelWorldPosition(context, modelWorld, "wristl");
    const wristR = computeModelWorldPosition(context, modelWorld, "wristr");
    gloveMarkers.left.push([Number(wristL.x.toFixed(4)), Number(wristL.y.toFixed(4)), Number(wristL.z.toFixed(4))]);
    gloveMarkers.right.push([Number(wristR.x.toFixed(4)), Number(wristR.y.toFixed(4)), Number(wristR.z.toFixed(4))]);
  }
  return { name, frames, tracks, hipsPositions, gloveMarkers };
}

const MODEL_REST_LOCAL = new Map<string, THREE.Vector3>();

function computeModelWorldPosition(
  context: RetargetContext,
  modelWorld: Map<string, THREE.Quaternion>,
  boneName: string,
): THREE.Vector3 {
  const chain: string[] = [];
  let current: string | null = boneName;
  while (current !== null) {
    chain.unshift(current);
    current = MODEL_PARENT[current] ?? null;
  }
  const position = new THREE.Vector3();
  const orientation = new THREE.Quaternion();
  for (const link of chain) {
    const rest = MODEL_REST_LOCAL.get(link) ?? context.modelBones.get(link)!.position;
    const offset = rest.clone().applyQuaternion(orientation);
    position.add(offset);
    const world = modelWorld.get(link);
    if (world !== undefined) orientation.copy(world);
    else orientation.copy(context.modelRestWorld.get(link) ?? new THREE.Quaternion());
  }
  return position;
}

function captureRestLocals(context: RetargetContext): void {
  MODEL_REST_LOCAL.clear();
  for (const [name, bone] of context.modelBones) MODEL_REST_LOCAL.set(name, bone.position.clone());
}

async function main(): Promise<void> {
  const model = await loadModel("assets-src/Barbarian.glb");
  const props: THREE.Object3D[] = [];
  model.scene.traverse((object) => {
    if (object instanceof THREE.Mesh && !(object instanceof THREE.SkinnedMesh)) props.push(object);
  });
  console.log(`stripping ${props.length} prop meshes: ${props.map((prop) => prop.name).join(", ")}`);
  for (const prop of props) prop.removeFromParent();
  model.scene.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        const standard = material as THREE.MeshStandardMaterial;
        standard.map = null;
        standard.color = new THREE.Color(0xffffff);
      }
    }
  });
  const context = buildRetargetContext(model);
  captureRestLocals(context);

  const clips: BakedClip[] = [];
  clips.push(bakeRetargetedClip(context, "idle", 60, (fighter) => fighter));
  clips.push(bakeRetargetedClip(context, "move_forward", 24, (fighter) => ({ ...fighter, velocity_x: 6 })));
  clips.push(bakeRetargetedClip(context, "move_backward", 24, (fighter) => ({ ...fighter, velocity_x: -6 })));
  clips.push(bakeRetargetedClip(context, "move_lateral", 24, (fighter) => ({ ...fighter, velocity_y: 6 })));
  clips.push(bakeRetargetedClip(context, "guard_high", 30, (fighter) => ({ ...fighter, defense: "guard_high" })));
  clips.push(bakeRetargetedClip(context, "guard_low", 30, (fighter) => ({ ...fighter, defense: "guard_low" })));

  const markerTrajectories: Record<string, { frames: number; left: number[][]; right: number[][] }> = {};
  for (const punchClass of ["jab", "straight", "hook", "uppercut"] as const) {
    for (const hand of ["left", "right"] as const) {
      const timing = punchTiming(punchClass, "head", "normal");
      const total = totalTicks(timing);
      const clip = bakeRetargetedClip(context, `${punchClass}_${hand}`, total + 4, (fighter) => ({
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
      }));
      clips.push(clip);
      markerTrajectories[`${punchClass}:${hand}`] = {
        frames: clip.frames,
        left: clip.gloveMarkers.left,
        right: clip.gloveMarkers.right,
      };
    }
  }
  clips.push(bakeRetargetedClip(context, "block_head", 14, (fighter) => fighter, (animator, frame) => {
    if (frame === 0) animator.impact({ direction: 1, amount: 120, blocked: true });
  }));
  clips.push(bakeRetargetedClip(context, "hit_head", 16, (fighter) => fighter, (animator, frame) => {
    if (frame === 0) animator.impact({ direction: 1, amount: 320, blocked: false });
  }));
  clips.push(bakeRetargetedClip(context, "knockdown", 42, (fighter) => ({ ...fighter, is_downed: true })));
  clips.push(bakeRetargetedClip(context, "getup", 30, (fighter, frame) => ({ ...fighter, is_downed: frame < 10 })));

  const animationClips = clips.map((clip) => {
    const tracks: THREE.KeyframeTrack[] = [];
    const times = Array.from({ length: clip.frames }, (_unused, index) => index / 30);
    for (const name of CANONICAL_ORDER) {
      tracks.push(new THREE.QuaternionKeyframeTrack(`${BONE_ADAPTER[name]}.quaternion`, times, clip.tracks.get(name)!.flat()));
    }
    tracks.push(new THREE.VectorKeyframeTrack(`${BONE_ADAPTER.hips}.position`, times, clip.hipsPositions.flat()));
    return new THREE.AnimationClip(clip.name, clip.frames / 30, tracks);
  });

  const glb = await new Promise<ArrayBuffer>((resolve, reject) => {
    new GLTFExporter().parse(
      model.scene,
      (result) => resolve(result as ArrayBuffer),
      (error: unknown) => reject(error instanceof Error ? error : new Error(String(error))),
      { binary: true, animations: animationClips },
    );
  });

  mkdirSync(OUT_DIR, { recursive: true });
  const base64 = Buffer.from(glb).toString("base64");
  const sha = createHash("sha256").update(base64).digest("hex");
  writeFileSync(
    `${OUT_DIR}/fighter-glb.ts`,
    `// Generated by scripts/generate-fighter-glb.ts from assets-src/Barbarian.glb (CC0, Kay Lousberg).\nexport const FIGHTER_GLB_BASE64 = "${base64}";\nexport const FIGHTER_GLB_SHA256 = "${sha}";\n`,
  );
  const texture = readFileSync("assets-src/barbarian_texture.png");
  writeFileSync(
    `${OUT_DIR}/fighter-texture.ts`,
    `// Generated from assets-src/barbarian_texture.png (CC0, Kay Lousberg).\nexport const FIGHTER_TEXTURE_BASE64 = "${texture.toString("base64")}";\n`,
  );
  writeFileSync(`${OUT_DIR}/fighter-markers.json`, JSON.stringify({ format: 1, trajectories: markerTrajectories }, null, 1) + "\n");
  console.log(`fighter GLB: ${glb.byteLength} bytes, ${animationClips.length} clips, base64 ${base64.length} chars, sha256 ${sha}`);
}

await main();
