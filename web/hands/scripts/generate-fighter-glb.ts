/**
 * Generates the skinned HANDS fighter by retargeting the tuned procedural
 * boxing motion onto the Texel Boxer armature (assets-src/Boxer.glb).
 *
 * Outputs:
 *   web/hands/src/assets/fighter-glb.ts        (base64 GLB with 18 clips)
 *   web/hands/src/assets/fighter-textures.ts   (embedded source textures)
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
  readonly modelRestLocal: Map<THREE.Object3D, THREE.Quaternion>;
  readonly modelRestWorld: Map<string, THREE.Quaternion>;
  readonly modelRestDirections: Map<string, THREE.Vector3>;
  readonly oursRestWorld: Map<string, THREE.Quaternion>;
  readonly modelHipsRestLocal: THREE.Vector3;
  readonly modelHipsRestWorld: THREE.Vector3;
  readonly modelHipsParentInverse: THREE.Matrix4;
  readonly hipsScale: number;
}

function buildRetargetContext(model: GLTF): RetargetContext {
  const scene = model.scene;
  scene.updateMatrixWorld(true);
  const modelBones = new Map<string, THREE.Bone>();
  const modelRestLocal = new Map<THREE.Object3D, THREE.Quaternion>();
  scene.traverse((object) => {
    modelRestLocal.set(object, object.quaternion.clone());
    if (object instanceof THREE.Bone) modelBones.set(object.name, object);
  });
  const available = [...modelBones.keys()].sort();
  const missing = Object.entries(BONE_ADAPTER).filter(([, target]) => !modelBones.has(target));
  if (missing.length > 0) {
    throw new Error(
      `Boxer.glb is missing required bones: ${missing.map(([from, to]) => `${from}→${to}`).join(", ")}
available: ${available.join(", ")}`,
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
  for (const [name, bone] of modelBones) {
    modelRestWorld.set(name, bone.getWorldQuaternion(new THREE.Quaternion()));
  }
  const modelRestDirections = new Map<string, THREE.Vector3>();
  for (const [name, childName] of Object.entries(AIM_BONES)) {
    const bonePosition = modelBones.get(BONE_ADAPTER[name]!)!.getWorldPosition(new THREE.Vector3());
    const childPosition = modelBones.get(BONE_ADAPTER[childName]!)!.getWorldPosition(new THREE.Vector3());
    modelRestDirections.set(BONE_ADAPTER[name]!, childPosition.sub(bonePosition).normalize());
  }
  const modelHips = modelBones.get(BONE_ADAPTER.hips)!;
  const modelHipsRestWorld = modelHips.getWorldPosition(new THREE.Vector3());
  const oursHipsRest = ours.hips.getWorldPosition(new THREE.Vector3());
  if (modelHips.parent === null) throw new Error("Boxer.glb hips bone has no parent");
  return {
    scene,
    modelBones,
    modelRestLocal,
    modelRestWorld,
    modelRestDirections,
    oursRestWorld,
    modelHipsRestLocal: modelHips.position.clone(),
    modelHipsRestWorld,
    modelHipsParentInverse: modelHips.parent.matrixWorld.clone().invert(),
    hipsScale: modelHipsRestWorld.y / oursHipsRest.y,
  };
}

interface BakedClip {
  readonly name: string;
  readonly frames: number;
  readonly tracks: Map<string, number[][]>;
  readonly hipsPositions: number[][];
  readonly gloveMarkers: { left: number[][]; right: number[][] };
}

function currentModelWorldQuaternion(
  context: RetargetContext,
  object: THREE.Object3D | null,
  modelWorld: Map<string, THREE.Quaternion>,
): THREE.Quaternion {
  if (object === null) return new THREE.Quaternion();
  if (object instanceof THREE.Bone) {
    const animated = modelWorld.get(object.name);
    if (animated !== undefined) return animated.clone();
  }
  return currentModelWorldQuaternion(context, object.parent, modelWorld).multiply(
    context.modelRestLocal.get(object) ?? object.quaternion,
  );
}

function restoreModelPose(context: RetargetContext): void {
  for (const name of CANONICAL_ORDER) {
    const bone = context.modelBones.get(BONE_ADAPTER[name]!)!;
    bone.quaternion.copy(context.modelRestLocal.get(bone)!);
  }
  context.modelBones.get(BONE_ADAPTER.hips)!.position.copy(context.modelHipsRestLocal);
  context.scene.updateMatrixWorld(true);
}

function bakeRetargetedClip(
  context: RetargetContext,
  name: string,
  frames: number,
  drive: (fighter: FighterSnapshot, frame: number) => FighterSnapshot,
  onFrame?: (animator: BoxerAnimator, frame: number) => void,
  driveWarmup = true,
  warmupFrames = 12,
  dtScale = 1,
): BakedClip {
  const rig = buildBoxer(PALETTES[0]);
  const animator = new BoxerAnimator(rig, MAPPING);
  const oursJoints = new Map<string, THREE.Object3D>();
  for (const jointName of CANONICAL_ORDER) {
    oursJoints.set(jointName, rig.root.getObjectByName(jointName)!);
  }
  const tracks = new Map<string, number[][]>(CANONICAL_ORDER.map((jointName) => [jointName, []]));
  const hipsPositions: number[][] = [];
  const gloveMarkers = { left: [] as number[][], right: [] as number[][] };

  const oursWorld = new THREE.Quaternion();
  const delta = new THREE.Quaternion();
  const deltaQ = new THREE.Quaternion();
  const targetWorld = new THREE.Quaternion();
  const modelWorld = new Map<string, THREE.Quaternion>();
  const scratchBonePos = new THREE.Vector3();
  const scratchChildPos = new THREE.Vector3();
  const oursHipsRestLocal = new THREE.Vector3(0, 0.98, 0);

  for (let frame = -warmupFrames; frame < frames; frame += 1) {
    const active = Math.max(0, frame);
    const fighter = frame < 0 && !driveWarmup ? baseFighter() : drive(baseFighter(), active);
    if (onFrame !== undefined && frame >= 0) onFrame(animator, frame);
    animator.update(fighter, OPPONENT, dtScale / 30, (frame * dtScale) / 30, false, "full", active);
    if (frame < 0) continue;
    // Runtime owns facing and stance yaw; clips contain joint-local motion only.
    rig.root.quaternion.identity();
    rig.root.updateMatrixWorld(true);

    modelWorld.clear();
    for (const jointName of CANONICAL_ORDER) {
      const modelName = BONE_ADAPTER[jointName]!;
      const modelBone = context.modelBones.get(modelName)!;
      const parentWorld = currentModelWorldQuaternion(context, modelBone.parent, modelWorld);
      const aimChild = AIM_BONES[jointName];
      if (aimChild !== undefined) {
        const boneWorld = oursJoints.get(jointName)!.getWorldPosition(scratchBonePos);
        const childWorld = oursJoints.get(aimChild)!.getWorldPosition(scratchChildPos);
        const direction = childWorld.sub(boneWorld).normalize();
        const restDirection = context.modelRestDirections.get(modelName)!;
        deltaQ.setFromUnitVectors(restDirection, direction);
        targetWorld.copy(deltaQ).multiply(context.modelRestWorld.get(modelName)!);
      } else {
        oursJoints.get(jointName)!.getWorldQuaternion(oursWorld);
        delta.copy(oursWorld).multiply(context.oursRestWorld.get(jointName)!.clone().invert());
        targetWorld.copy(delta).multiply(context.modelRestWorld.get(modelName)!);
      }
      modelWorld.set(modelName, targetWorld.clone());
      const local = parentWorld.invert().multiply(targetWorld).normalize();
      tracks.get(jointName)!.push([local.x, local.y, local.z, local.w]);
      modelBone.quaternion.copy(local);
    }

    const hipsDelta = rig.hips.position.clone().sub(oursHipsRestLocal).multiplyScalar(context.hipsScale);
    const modelHips = context.modelBones.get(BONE_ADAPTER.hips)!;
    const modelHipsLocal = context.modelHipsRestWorld.clone().add(hipsDelta).applyMatrix4(context.modelHipsParentInverse);
    modelHips.position.copy(modelHipsLocal);
    context.scene.updateMatrixWorld(true);
    for (let pass = 0; pass < 2; pass += 1) {
      const floor = new THREE.Box3().setFromObject(context.scene, true).min.y;
      if (!Number.isFinite(floor)) throw new Error(`${name} frame ${frame} has non-finite skinned bounds`);
      if (Math.abs(floor) < 0.0001) break;
      const hipsWorld = modelHips.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -floor, 0));
      modelHips.parent!.worldToLocal(hipsWorld);
      modelHips.position.copy(hipsWorld);
      context.scene.updateMatrixWorld(true);
    }
    hipsPositions.push([modelHips.position.x, modelHips.position.y, modelHips.position.z]);

    const wristL = context.modelBones.get(BONE_ADAPTER.gloveL)!.getWorldPosition(new THREE.Vector3());
    const wristR = context.modelBones.get(BONE_ADAPTER.gloveR)!.getWorldPosition(new THREE.Vector3());
    gloveMarkers.left.push([Number(wristL.x.toFixed(4)), Number(wristL.y.toFixed(4)), Number(wristL.z.toFixed(4))]);
    gloveMarkers.right.push([Number(wristR.x.toFixed(4)), Number(wristR.y.toFixed(4)), Number(wristR.z.toFixed(4))]);
  }
  restoreModelPose(context);
  return { name, frames, tracks, hipsPositions, gloveMarkers };
}

interface SourceGltf {
  readonly bufferViews?: readonly { readonly buffer?: number; readonly byteOffset?: number; readonly byteLength: number }[];
  readonly images?: readonly { readonly bufferView?: number; readonly mimeType?: string }[];
  readonly textures?: readonly { readonly source?: number }[];
  readonly materials?: readonly {
    readonly name?: string;
    readonly pbrMetallicRoughness?: { readonly baseColorTexture?: { readonly index: number } };
  }[];
}

const TEXTURE_SPECS = [
  { key: "head", material: "MHeadMat0" },
  { key: "gloves", material: "GlovesMat0" },
  { key: "body", material: "MBodyMat0" },
  { key: "shoes", material: "ShoesMat0" },
  { key: "pants", material: "PantsMat0" },
] as const;

function embeddedTextureDataUrls(path: string): Record<(typeof TEXTURE_SPECS)[number]["key"], string> {
  const source = readFileSync(path);
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    throw new Error(`${path} is not a glTF 2 GLB`);
  }
  let offset = 12;
  let jsonBytes: Buffer | null = null;
  let binaryBytes: Buffer | null = null;
  while (offset < source.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    offset += 8;
    const chunk = source.subarray(offset, offset + length);
    if (type === 0x4e4f534a) jsonBytes = chunk;
    if (type === 0x004e4942) binaryBytes = chunk;
    offset += length;
  }
  if (jsonBytes === null || binaryBytes === null) throw new Error(`${path} has no embedded JSON or binary chunk`);
  const sourceGltf = JSON.parse(jsonBytes.toString("utf8")) as SourceGltf;
  const result = {} as Record<(typeof TEXTURE_SPECS)[number]["key"], string>;
  for (const spec of TEXTURE_SPECS) {
    const material = sourceGltf.materials?.find((candidate) => candidate.name === spec.material);
    const textureIndex = material?.pbrMetallicRoughness?.baseColorTexture?.index;
    const imageIndex = textureIndex === undefined ? undefined : sourceGltf.textures?.[textureIndex]?.source;
    const image = imageIndex === undefined ? undefined : sourceGltf.images?.[imageIndex];
    const bufferView = image?.bufferView === undefined ? undefined : sourceGltf.bufferViews?.[image.bufferView];
    if (image?.mimeType === undefined || bufferView === undefined || (bufferView.buffer ?? 0) !== 0) {
      throw new Error(`${path} has no embedded base-color image for ${spec.material}`);
    }
    const imageBytes = binaryBytes.subarray(
      bufferView.byteOffset ?? 0,
      (bufferView.byteOffset ?? 0) + bufferView.byteLength,
    );
    result[spec.key] = `data:${image.mimeType};base64,${imageBytes.toString("base64")}`;
  }
  return result;
}

function cleanSkinWeights(scene: THREE.Object3D): void {
  scene.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    const joints = object.geometry.getAttribute("skinIndex");
    const weights = object.geometry.getAttribute("skinWeight");
    if (joints === undefined || weights === undefined) throw new Error(`${object.name} has no skin weights`);
    for (let index = 0; index < weights.count; index += 1) {
      const jointValues = [joints.getX(index), joints.getY(index), joints.getZ(index), joints.getW(index)];
      const weightValues = [weights.getX(index), weights.getY(index), weights.getZ(index), weights.getW(index)];
      const combined = new Map<number, number>();
      for (let component = 0; component < 4; component += 1) {
        const weight = weightValues[component]!;
        if (weight > 0) combined.set(jointValues[component]!, (combined.get(jointValues[component]!) ?? 0) + weight);
      }
      const influences = [...combined].sort((left, right) => right[1] - left[1]).slice(0, 4);
      const total = influences.reduce((sum, influence) => sum + influence[1], 0);
      if (total <= 0) throw new Error(`${object.name} vertex ${index} has no positive skin weights`);
      while (influences.length < 4) influences.push([0, 0]);
      joints.setXYZW(index, influences[0]![0], influences[1]![0], influences[2]![0], influences[3]![0]);
      weights.setXYZW(
        index,
        influences[0]![1] / total,
        influences[1]![1] / total,
        influences[2]![1] / total,
        influences[3]![1] / total,
      );
    }
    joints.needsUpdate = true;
    weights.needsUpdate = true;
  });
}

async function main(): Promise<void> {
  const sourcePath = "assets-src/Boxer.glb";
  const textureDataUrls = embeddedTextureDataUrls(sourcePath);
  const model = await loadModel(sourcePath);
  const props: THREE.Object3D[] = [];
  const meshNames = new Map([
    ["MHeadMat0", "BoxerHead"],
    ["GlovesMat0", "BoxerGloves"],
    ["MBodyMat0", "BoxerBody"],
    ["ShoesMat0", "BoxerShoes"],
    ["PantsMat0", "BoxerPants"],
  ]);
  model.scene.traverse((object) => {
    if (object instanceof THREE.Mesh && !(object instanceof THREE.SkinnedMesh)) props.push(object);
    if (object instanceof THREE.SkinnedMesh && !Array.isArray(object.material)) {
      object.name = meshNames.get(object.material.name) ?? object.name;
    }
  });
  console.log(`stripping ${props.length} prop meshes: ${props.map((prop) => prop.name).join(", ")}`);
  for (const prop of props) prop.removeFromParent();
  model.scene.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        const standard = material as THREE.MeshStandardMaterial;
        standard.map = null;
        standard.color.setHex(0xffffff);
      }
    }
  });
  cleanSkinWeights(model.scene);
  model.scene.userData.attribution = '"Boxer" by Texel, Inc., CC BY 4.0';
  model.scene.userData.source = "https://sketchfab.com/3d-models/boxer-84767168720948b38728ff78ee6f6090";
  const context = buildRetargetContext(model);

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
  clips.push(bakeRetargetedClip(context, "knockdown", 42, (fighter) => ({ ...fighter, is_downed: true }), undefined, false));
  clips.push(bakeRetargetedClip(context, "getup", 30, (fighter, frame) => ({ ...fighter, is_downed: frame < 1 }), undefined, true, 21, 2));

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
  const sha = createHash("sha256").update(Buffer.from(glb)).digest("hex");
  writeFileSync(
    `${OUT_DIR}/fighter-glb.ts`,
    `// Generated from assets-src/Boxer.glb (Texel, Inc., CC BY 4.0).\nexport const FIGHTER_GLB_BASE64 = "${base64}";\nexport const FIGHTER_GLB_SHA256 = "${sha}";\n`,
  );
  writeFileSync(
    `${OUT_DIR}/fighter-textures.ts`,
    `// Generated from assets-src/Boxer.glb (Texel, Inc., CC BY 4.0).\nexport const FIGHTER_TEXTURE_DATA_URLS = ${JSON.stringify(textureDataUrls)} as const;\n`,
  );
  writeFileSync(`${OUT_DIR}/fighter-markers.json`, JSON.stringify({ format: 1, trajectories: markerTrajectories }, null, 1) + "\n");
  console.log(`fighter GLB: ${glb.byteLength} bytes, ${animationClips.length} clips, base64 ${base64.length} chars, sha256 ${sha}`);
}

await main();
