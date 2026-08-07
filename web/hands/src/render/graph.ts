import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { GLOVE_HITBOX_RADIUS, HURTBOXES, punchTiming, totalTicks, type PunchTiming } from "../manifest";
import type { BloodLevel } from "../settings";
import type { FighterSnapshot, Hand, Power, PunchClass, SemanticAction, Target } from "../types";
import { FIGHTER_GLB_GZIP_BASE64 } from "../assets/fighter-glb";
import { BONE_ADAPTER } from "./skeleton";
export { BONE_ADAPTER };
import { FIGHTER_TEXTURE_DATA_URLS } from "../assets/fighter-textures";
import type { WorldMapping } from "./world";

export const FIGHTER_MODEL_SCALE = 0.96;

type FighterTexture = keyof typeof FIGHTER_TEXTURE_DATA_URLS;

const MATERIAL_TEXTURE: Readonly<Record<string, FighterTexture>> = {
  MHeadMat0: "head",
  GlovesMat0: "gloves",
  MBodyMat0: "body",
  ShoesMat0: "shoes",
  PantsMat0: "pants",
};
const cachedTextures = new Map<FighterTexture, THREE.Texture>();
const cachedTextureLoads = new Map<FighterTexture, Promise<THREE.Texture>>();
let cachedGltf: Promise<GLTF> | null = null;

function configureFighterTexture(texture: THREE.Texture): THREE.Texture {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  return texture;
}

function loadFighterTexture(name: FighterTexture): Promise<THREE.Texture> {
  const existing = cachedTextures.get(name);
  if (existing !== undefined) return Promise.resolve(existing);
  const pending = cachedTextureLoads.get(name);
  if (pending !== undefined) return pending;
  const load = new THREE.TextureLoader().loadAsync(FIGHTER_TEXTURE_DATA_URLS[name]).then((texture) => {
    cachedTextures.set(name, configureFighterTexture(texture));
    return texture;
  });
  cachedTextureLoads.set(name, load);
  return load;
}

function preloadFighterTextures(): Promise<readonly THREE.Texture[]> {
  return Promise.all((Object.keys(FIGHTER_TEXTURE_DATA_URLS) as FighterTexture[]).map(loadFighterTexture));
}

export async function decompressFighterGlb(): Promise<ArrayBuffer> {
  const compressed = Uint8Array.from(atob(FIGHTER_GLB_GZIP_BASE64), (char) => char.charCodeAt(0));
  const source = new Response(compressed).body;
  if (source === null) throw new Error("fighter_glb_stream_unavailable");
  return new Response(source.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
}

export function loadBoxerGlb(): Promise<GLTF> {
  if (cachedGltf === null) {
    const gltf = decompressFighterGlb().then((bytes) => new Promise<GLTF>((resolve, reject) => {
      new GLTFLoader().parse(bytes, "", resolve, (error: unknown) => reject(error instanceof Error ? error : new Error(String(error))));
    }));
    cachedGltf = Promise.all([gltf, preloadFighterTextures()]).then(([loaded]) => loaded);
  }
  return cachedGltf;
}

function fighterTexture(name: FighterTexture): THREE.Texture {
  const existing = cachedTextures.get(name);
  if (existing !== undefined) return existing;
  const texture = configureFighterTexture(new THREE.TextureLoader().load(FIGHTER_TEXTURE_DATA_URLS[name]));
  cachedTextures.set(name, texture);
  return texture;
}

interface AppliedFighterMaterials {
  readonly skin: readonly THREE.MeshPhysicalMaterial[];
  readonly gloves: THREE.MeshStandardMaterial;
  readonly owned: readonly THREE.Material[];
}

export function applyFighterSkin(target: THREE.Object3D, palette: BoxerPaletteColors): AppliedFighterMaterials {
  const skin: THREE.MeshPhysicalMaterial[] = [];
  const owned: THREE.Material[] = [];
  const bySource = new Map<string, THREE.MeshStandardMaterial>();
  let gloves: THREE.MeshStandardMaterial | null = null;
  target.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh) || Array.isArray(object.material)) return;
    const sourceName = object.material.name;
    const textureName = MATERIAL_TEXTURE[sourceName];
    if (textureName === undefined) throw new Error(`fighter GLB has unsupported material ${sourceName}`);
    let material = bySource.get(sourceName);
    if (material === undefined) {
      const isSkin = sourceName === "MHeadMat0" || sourceName === "MBodyMat0";
      const color = sourceName === "GlovesMat0" || sourceName === "PantsMat0" ? palette.gear : 0xffffff;
      material = isSkin
        ? new THREE.MeshPhysicalMaterial({ map: fighterTexture(textureName), color, roughness: 0.58, metalness: 0.02, clearcoat: 0.25, clearcoatRoughness: 0.6 })
        : new THREE.MeshStandardMaterial({ map: fighterTexture(textureName), color, roughness: 0.4, metalness: 0.03 });
      material.name = sourceName;
      bySource.set(sourceName, material);
      owned.push(material);
      if (material instanceof THREE.MeshPhysicalMaterial) skin.push(material);
      if (sourceName === "GlovesMat0") gloves = material;
    }
    object.material = material;
    object.castShadow = true;
    object.receiveShadow = true;
    object.frustumCulled = false;
  });
  if (skin.length !== 2 || gloves === null || owned.length !== 5) {
    throw new Error(`fighter GLB material contract failed: ${skin.length} skin, ${owned.length} total`);
  }
  return { skin, gloves, owned };
}

export const CLIP_NAMES = [
  "idle", "move_forward", "move_backward", "move_lateral_left", "move_lateral_right",
  "guard_high", "guard_low", "slip_left", "slip_right", "weave", "pull",
  "jab_left", "jab_right", "straight_left", "straight_right", "hook_left", "hook_right",
  "uppercut_left", "uppercut_right",
  "block_head_left", "block_head_right", "block_body_left", "block_body_right",
  "hit_head_left", "hit_head_right", "hit_body_left", "hit_body_right",
  "knockdown", "getup", "clinch", "foul_recovery", "stunned", "exhausted", "taunt",
] as const;

export type ClipName = (typeof CLIP_NAMES)[number];

export interface BoxerPaletteColors {
  readonly skin: number;
  readonly gear: number;
}

export type ArcadeDislocation = "jaw" | "shoulder_left" | "shoulder_right";

const smooth = (current: number, target: number, rate: number, dt: number): number => current + (target - current) * (1 - Math.exp(-rate * dt));
const smoothAngle = (current: number, target: number, rate: number, dt: number): number => {
  const delta = ((target - current + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return current + delta * (1 - Math.exp(-rate * dt));
};
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export class SkinnedBoxer {
  readonly root = new THREE.Group();
  readonly mixer: THREE.AnimationMixer;
  readonly actions = new Map<ClipName, THREE.AnimationAction>();
  readonly bones = new Map<string, THREE.Bone>();
  /** Bone-derived measurements in world units (after MODEL_SCALE). */
  readonly metrics: { armUpper: number; armFore: number; legThigh: number; legShin: number; headRestY: number; chestRestY: number; ankleRestY: number };
  private readonly skinMaterials: readonly THREE.MeshPhysicalMaterial[];
  private readonly ownedMaterials: readonly THREE.Material[];
  private readonly gearMaterial: THREE.MeshStandardMaterial;
  private readonly headMeshes: THREE.SkinnedMesh[] = [];
  private readonly handMeshes: Record<Hand, THREE.SkinnedMesh[]> = { left: [], right: [] };
  private decapitated = false;
  private readonly dismemberedHands: Record<Hand, boolean> = { left: false, right: false };
  readonly gearBaseColor: THREE.Color;
  readonly skinBaseColor: THREE.Color;
  private readonly overlays: TraumaOverlays;

  constructor(gltf: GLTF, palette: BoxerPaletteColors) {
    const instance = cloneSkeleton(gltf.scene);
    instance.scale.setScalar(FIGHTER_MODEL_SCALE);
    this.root.add(instance);
    const materials = applyFighterSkin(instance, palette);
    this.skinMaterials = materials.skin;
    this.ownedMaterials = materials.owned;
    this.gearMaterial = materials.gloves;
    this.gearBaseColor = new THREE.Color(palette.gear);
    this.skinBaseColor = new THREE.Color(palette.skin);
    instance.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh && object.name === "BoxerHead") this.headMeshes.push(object);
      if (object instanceof THREE.SkinnedMesh && object.name === "BoxerGloveLeft") this.handMeshes.left.push(object);
      if (object instanceof THREE.SkinnedMesh && object.name === "BoxerGloveRight") this.handMeshes.right.push(object);
      if (object instanceof THREE.Bone) this.bones.set(object.name, object);
    });
    const missing = Object.values(BONE_ADAPTER).filter((name) => !this.bones.has(name));
    if (missing.length > 0) throw new Error(`fighter GLB missing required bones: ${missing.join(", ")}`);
    if (this.headMeshes.length !== 1) throw new Error(`fighter GLB requires one BoxerHead mesh, found ${this.headMeshes.length}`);
    for (const side of ["left", "right"] as const) {
      if (this.handMeshes[side].length !== 1) {
        throw new Error(`fighter GLB requires one ${side} glove mesh, found ${this.handMeshes[side].length}`);
      }
    }
    this.mixer = new THREE.AnimationMixer(instance);
    for (const clip of gltf.animations) {
      const action = this.mixer.clipAction(clip);
      this.actions.set(clip.name as ClipName, action);
      if (
        /^(jab|straight|hook|uppercut|block_|hit_)/.test(clip.name)
        || clip.name === "knockdown"
        || clip.name === "getup"
        || clip.name === "taunt"
      ) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
    }
    const missingClips = CLIP_NAMES.filter((name) => !this.actions.has(name));
    if (missingClips.length > 0) throw new Error(`fighter GLB missing clips: ${missingClips.join(", ")}`);
    instance.updateMatrixWorld(true);
    const jointDistance = (from: string, to: string): number =>
      this.bone(from)!.getWorldPosition(new THREE.Vector3()).distanceTo(this.bone(to)!.getWorldPosition(new THREE.Vector3()));
    this.metrics = {
      armUpper: jointDistance("shoulderL", "elbowL"),
      armFore: jointDistance("elbowL", "gloveL"),
      legThigh: jointDistance("hipL", "kneeL"),
      legShin: jointDistance("kneeL", "ankleL"),
      headRestY: this.bone("head")!.getWorldPosition(new THREE.Vector3()).y,
      chestRestY: this.bone("chest")!.getWorldPosition(new THREE.Vector3()).y,
      ankleRestY: this.bone("ankleL")!.getWorldPosition(new THREE.Vector3()).y,
    };
    this.overlays = buildTraumaOverlays(this.bone("head")!, this.bone("chest")!, palette.skin);
  }

  bone(name: string): THREE.Bone | null {
    return this.bones.get(BONE_ADAPTER[name] ?? name) ?? null;
  }

  get trauma(): TraumaOverlays {
    return this.overlays;
  }

  get gloveGear(): THREE.MeshStandardMaterial {
    return this.gearMaterial;
  }

  get skin(): THREE.MeshPhysicalMaterial {
    return this.skinMaterials[0]!;
  }

  get isDecapitated(): boolean {
    return this.decapitated;
  }

  setDecapitated(value: boolean): void {
    this.decapitated = value;
    for (const mesh of this.headMeshes) mesh.visible = !value;
    this.bone("head")!.visible = !value;
  }

  isHandDismembered(side: Hand): boolean {
    return this.dismemberedHands[side];
  }

  setHandDismembered(side: Hand, value: boolean): void {
    this.dismemberedHands[side] = value;
    for (const mesh of this.handMeshes[side]) mesh.visible = !value;
  }

  setSkinClearcoat(value: number): void {
    for (const material of this.skinMaterials) material.clearcoat = value;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    for (const material of this.ownedMaterials) material.dispose();
    this.overlays.dispose();
  }
}

export interface TraumaOverlays {
  readonly bruiseL: THREE.Mesh;
  readonly bruiseR: THREE.Mesh;
  readonly swellL: THREE.Mesh;
  readonly swellR: THREE.Mesh;
  readonly cutL: THREE.Mesh;
  readonly cutR: THREE.Mesh;
  readonly streakL: THREE.Mesh;
  readonly streakR: THREE.Mesh;
  readonly noseStreak: THREE.Mesh;
  readonly mouthBlood: THREE.Mesh;
  readonly cheekL: THREE.Mesh;
  readonly cheekR: THREE.Mesh;
  readonly ribL: THREE.Mesh;
  readonly ribR: THREE.Mesh;
  readonly bodyBruise: THREE.Mesh;
  readonly bodyStreak: THREE.Mesh;
  readonly jaw: THREE.Mesh;
  dispose(): void;
}

function overlayMesh(geometry: THREE.BufferGeometry, color: number, emissive = 0x000000): THREE.Mesh {
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color, roughness: 0.7, transparent: true, opacity: 0, emissive }),
  );
  mesh.castShadow = false;
  return mesh;
}

function buildTraumaOverlays(head: THREE.Bone, chest: THREE.Bone, skinColor: number): TraumaOverlays {
  const overlays: THREE.Mesh[] = [];
  const add = (mesh: THREE.Mesh, parent: THREE.Bone, position: [number, number, number], scale: [number, number, number] = [1, 1, 1]): THREE.Mesh => {
    const parentScale = parent.getWorldScale(new THREE.Vector3());
    const compensation = 1 / Math.max(0.0001, parentScale.x);
    mesh.position.set(
      position[0] * 1.3 * compensation,
      position[1] * 1.25 * compensation,
      (position[2] * 1.35 + 0.045) * compensation,
    );
    mesh.scale.set(scale[0] * compensation, scale[1] * compensation, scale[2] * compensation);
    mesh.userData.baseScale = compensation;
    parent.add(mesh);
    overlays.push(mesh);
    return mesh;
  };
  const bruiseL = add(overlayMesh(new THREE.SphereGeometry(0.042, 12, 10), 0x4a1c56), head, [0.05, 0.15, 0.085], [1, 0.72, 0.5]);
  const bruiseR = add(overlayMesh(new THREE.SphereGeometry(0.042, 12, 10), 0x4a1c56), head, [-0.05, 0.15, 0.085], [1, 0.72, 0.5]);
  const swellL = add(overlayMesh(new THREE.SphereGeometry(0.035, 12, 10), 0x6b3572), head, [0.052, 0.155, 0.088]);
  const swellR = add(overlayMesh(new THREE.SphereGeometry(0.035, 12, 10), 0x6b3572), head, [-0.052, 0.155, 0.088]);
  const cutL = add(overlayMesh(new THREE.BoxGeometry(0.05, 0.008, 0.01), 0x7f0d14, 0x2a0306), head, [0.05, 0.178, 0.104]);
  const cutR = add(overlayMesh(new THREE.BoxGeometry(0.05, 0.008, 0.01), 0x7f0d14, 0x2a0306), head, [-0.05, 0.178, 0.104]);
  const streakL = add(overlayMesh(new THREE.BoxGeometry(0.014, 0.1, 0.006), 0x8a0f16, 0x30040a), head, [0.052, 0.115, 0.106]);
  const streakR = add(overlayMesh(new THREE.BoxGeometry(0.014, 0.1, 0.006), 0x8a0f16, 0x30040a), head, [-0.052, 0.115, 0.106]);
  const noseStreak = add(overlayMesh(new THREE.BoxGeometry(0.011, 0.07, 0.006), 0x8a0f16, 0x30040a), head, [0.008, 0.075, 0.118]);
  const mouthBlood = add(overlayMesh(new THREE.BoxGeometry(0.03, 0.012, 0.006), 0x8a0f16, 0x30040a), head, [0.02, 0.052, 0.104]);
  const cheekL = add(overlayMesh(new THREE.SphereGeometry(0.028, 10, 8), 0x6b3572), head, [0.068, 0.095, 0.075]);
  const cheekR = add(overlayMesh(new THREE.SphereGeometry(0.028, 10, 8), 0x6b3572), head, [-0.068, 0.095, 0.075]);
  const ribL = add(overlayMesh(new THREE.SphereGeometry(0.09, 12, 10), 0x5c2450), chest, [0.16, 0.08, 0.02], [0.5, 1.2, 0.7]);
  const ribR = add(overlayMesh(new THREE.SphereGeometry(0.09, 12, 10), 0x5c2450), chest, [-0.16, 0.08, 0.02], [0.5, 1.2, 0.7]);
  const bodyBruise = add(overlayMesh(new THREE.SphereGeometry(0.1, 12, 10), 0x4a1c56), chest, [0.02, 0.05, 0.1], [1.05, 1.35, 0.55]);
  const bodyStreak = add(overlayMesh(new THREE.BoxGeometry(0.05, 0.24, 0.008), 0x8a0f16, 0x30040a), chest, [0.03, 0.08, 0.155]);
  bodyStreak.rotation.z = 0.12;
  const jaw = add(overlayMesh(new THREE.SphereGeometry(0.06, 12, 10), skinColor), head, [0, -0.005, 0.07], [1.3, 0.48, 0.82]);
  jaw.userData.restPosition = jaw.position.clone();
  return {
    bruiseL, bruiseR, swellL, swellR, cutL, cutR, streakL, streakR, noseStreak, mouthBlood,
    cheekL, cheekR, ribL, ribR, bodyBruise, bodyStreak, jaw,
    dispose() {
      for (const mesh of overlays) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        mesh.removeFromParent();
      }
    },
  };
}

export function applyTraumaToOverlays(overlays: TraumaOverlays, fighter: FighterSnapshot, opponentBlood: number, blood: BloodLevel): void {
  const trauma = fighter.trauma;
  const cutScale = blood === "off" ? 0 : blood === "reduced" ? 0.35 : 1;
  const graphicScale = blood === "full" ? 1.8 : 1;
  const mat = (mesh: THREE.Mesh): THREE.MeshStandardMaterial => mesh.material as THREE.MeshStandardMaterial;
  const scale = (mesh: THREE.Mesh, x: number, y: number, z: number): void => {
    const base = typeof mesh.userData.baseScale === "number" ? mesh.userData.baseScale : 1;
    mesh.scale.set(x * base, y * base, z * base);
  };
  const bruise = (value: number): number => Math.min(0.85, value / 170 + trauma.swelling / 420);
  mat(overlays.bruiseL).opacity = bruise(trauma.left_eye);
  mat(overlays.bruiseR).opacity = bruise(trauma.right_eye);
  const cutL = Math.min(1, trauma.left_cut / 150 + trauma.bleeding / 450);
  const cutR = Math.min(1, trauma.right_cut / 150 + trauma.bleeding / 450);
  mat(overlays.cutL).opacity = cutL * cutScale;
  mat(overlays.cutR).opacity = cutR * cutScale;
  scale(overlays.cutL, 1 + cutL * 0.55 * graphicScale, 1 + cutL * 0.7, 1);
  scale(overlays.cutR, 1 + cutR * 0.55 * graphicScale, 1 + cutR * 0.7, 1);
  const swellL = Math.min(1.35, trauma.left_eye / 260 + trauma.swelling / 560);
  const swellR = Math.min(1.35, trauma.right_eye / 260 + trauma.swelling / 560);
  scale(overlays.swellL, 0.25 + swellL * 1.15, 0.25 + swellL * 1.15, 0.25 + swellL * 1.15);
  scale(overlays.swellR, 0.25 + swellR * 1.15, 0.25 + swellR * 1.15, 0.25 + swellR * 1.15);
  mat(overlays.swellL).opacity = Math.min(0.92, swellL * 1.1);
  mat(overlays.swellR).opacity = Math.min(0.92, swellR * 1.1);
  const cheek = Math.min(1, trauma.head / 900 + trauma.swelling / 800);
  scale(overlays.cheekL, 0.2 + cheek * 1.05, 0.2 + cheek * 1.05, 0.2 + cheek * 1.05);
  scale(overlays.cheekR, 0.2 + cheek * 0.95, 0.2 + cheek * 0.95, 0.2 + cheek * 0.95);
  mat(overlays.cheekL).opacity = cheek * 0.8;
  mat(overlays.cheekR).opacity = cheek * 0.75;
  const dripL = Math.min(1.9, (trauma.left_cut + trauma.bleeding) / 220);
  const dripR = Math.min(1.9, (trauma.right_cut + trauma.bleeding) / 220);
  scale(overlays.streakL, graphicScale, 0.15 + dripL * graphicScale, 1);
  scale(overlays.streakR, graphicScale, 0.15 + dripR * graphicScale, 1);
  mat(overlays.streakL).opacity = Math.min(1, dripL) * cutScale;
  mat(overlays.streakR).opacity = Math.min(1, dripR) * cutScale;
  const nose = Math.min(1.6, trauma.head / 600 + trauma.bleeding / 340);
  scale(overlays.noseStreak, graphicScale, 0.2 + nose * graphicScale, 1);
  mat(overlays.noseStreak).opacity = Math.min(1, nose) * cutScale;
  const mouth = Math.min(1, trauma.head / 650 + trauma.bleeding / 360);
  scale(overlays.mouthBlood, 1 + mouth * graphicScale, 1 + mouth * 0.8, 1);
  mat(overlays.mouthBlood).opacity = mouth * cutScale;
  const rib = Math.min(1, trauma.body / 750);
  scale(overlays.ribL, 0.5 + rib * 0.35, 1.2 + rib * 0.5, 0.7 + rib * 0.2);
  scale(overlays.ribR, 0.5 + rib * 0.3, 1.2 + rib * 0.4, 0.7 + rib * 0.2);
  mat(overlays.ribL).opacity = rib * 0.85;
  mat(overlays.ribR).opacity = rib * 0.8;
  mat(overlays.bodyBruise).opacity = Math.min(0.7, trauma.body / 950);
  const smear = Math.min(1.5, trauma.body / 450 + trauma.bleeding / 340);
  scale(overlays.bodyStreak, 1 + smear * 0.55 * graphicScale, 0.3 + smear * graphicScale, 1);
  mat(overlays.bodyStreak).opacity = Math.min(1, smear) * cutScale;
  void opponentBlood;
}

const BLOODED_GLOVE_COLOR = new THREE.Color(0x5c0a0e);
const LOCOMOTION = [
  "idle", "move_forward", "move_backward", "move_lateral_left", "move_lateral_right",
] as const satisfies readonly ClipName[];
const ONE_SHOTS: readonly ClipName[] = [
  "jab_left", "jab_right", "straight_left", "straight_right", "hook_left", "hook_right",
  "uppercut_left", "uppercut_right",
  "block_head_left", "block_head_right", "block_body_left", "block_body_right",
  "hit_head_left", "hit_head_right", "hit_body_left", "hit_body_right",
  "knockdown", "getup", "clinch", "foul_recovery", "stunned", "exhausted", "taunt",
];
const PUNCH_CLIP = (punchClass: PunchClass, hand: Hand): ClipName => `${punchClass}_${hand}` as ClipName;

export class BoxingGraph {
  readonly boxer: SkinnedBoxer;
  private yaw = 0;
  private rootX: number | null = null;
  private rootZ = 0;
  private activePunch: THREE.AnimationAction | null = null;
  private punchAgeTicks = 0;
  private punchTotalTicks = 1;
  private punchClass: PunchClass = "jab";
  private punchHand: Hand = "left";
  private punchTarget: Target = "head";
  private punchPower: Power = "normal";
  private punchTiming: PunchTiming = punchTiming("jab", "head", "normal");
  private actionId: string | null = null;
  private completedActionId: string | null = null;
  private predictedId: string | null = null;
  private predictedAtSeconds = -1;
  private predictionAgeTicks = 0;
  private predictedClip: ClipName = "jab_left";
  private predictedTotalTicks = 13;
  private hitstop = 0;
  private reactionAction: THREE.AnimationAction | null = null;
  private stateAction: THREE.AnimationAction | null = null;
  private stateWeight = 0;
  private stateRequested = false;
  private downState: "up" | "falling" | "down" | "rising" = "up";
  private fallAge = 0;
  private riseAge = 0;
  private opponentDrop = 0;
  private readonly liveOpponentHead = new THREE.Vector3(0, 0.97, 0);
  private hasLiveHead = false;
  private defenseWeight = 0;
  private defenseClip: "guard_high" | "guard_low" | "slip_left" | "slip_right" | "weave" | "pull" = "guard_high";
  private hitstopScale = 1;
  private plantedL: THREE.Vector3 | null = null;
  private plantedR: THREE.Vector3 | null = null;
  private readonly locomotionWeights: Record<string, number> = {
    idle: 1,
    move_forward: 0,
    move_backward: 0,
    move_lateral_left: 0,
    move_lateral_right: 0,
  };
  private readonly scratchA = new THREE.Vector3();
  private readonly scratchB = new THREE.Vector3();
  private readonly scratchC = new THREE.Vector3();
  private readonly scratchQ = new THREE.Quaternion();
  private readonly aimTarget = new THREE.Vector3();
  private readonly aimShoulder = new THREE.Vector3();
  private readonly aimTo = new THREE.Vector3();
  private readonly aimPole = new THREE.Vector3();
  private readonly aimBend = new THREE.Vector3();
  private readonly aimElbow = new THREE.Vector3();
  private readonly lockAnkle = new THREE.Vector3();
  private readonly lockPinned = new THREE.Vector3();
  private readonly lockHip = new THREE.Vector3();
  private readonly lockTo = new THREE.Vector3();
  private readonly lockPole = new THREE.Vector3();
  private readonly lockBend = new THREE.Vector3();
  private readonly lockKnee = new THREE.Vector3();
  private dislocation: ArcadeDislocation | null = null;

  constructor(boxer: SkinnedBoxer, private readonly mapping: WorldMapping) {
    this.boxer = boxer;
    for (const name of LOCOMOTION) {
      const action = boxer.actions.get(name)!;
      action.setEffectiveWeight(name === "idle" ? 1 : 0);
      action.play();
    }
  }

  get currentRoot(): { x: number; z: number } {
    return { x: this.rootX ?? 0, z: this.rootZ };
  }

  predict(action: SemanticAction, timeSeconds: number, tickRate: number): void {
    if (action.kind !== "punch" || action.id === undefined) return;
    this.predictedId = action.id;
    this.predictedAtSeconds = timeSeconds;
    this.predictionAgeTicks = 0;
    this.predictedClip = PUNCH_CLIP(action.class, action.hand);
    const timing = punchTiming(action.class, action.target, action.power);
    this.punchClass = action.class;
    this.punchHand = action.hand;
    this.punchTarget = action.target;
    this.punchPower = action.power;
    this.punchTiming = timing;
    this.predictedTotalTicks = totalTicks(timing);
    const inRecovery = this.actionId !== null && this.punchAgeTicks / this.punchTotalTicks > 0.55;
    if (this.actionId === null || inRecovery) {
      this.actionId = null;
      this.beginPunch(this.boxer.actions.get(this.predictedClip)!, this.predictedTotalTicks);
      this.punchAgeTicks = 0;
    }
    void tickRate;
  }

  landedHit(blocked: boolean): void {
    this.hitstop = Math.max(this.hitstop, blocked ? 0.045 : 0.078);
  }

  setArcadeDislocation(dislocation: ArcadeDislocation | null): void {
    this.dislocation = dislocation;
    const jaw = this.boxer.trauma.jaw;
    const rest = jaw.userData.restPosition as THREE.Vector3;
    jaw.position.copy(rest);
    jaw.rotation.set(0, 0, 0);
    (jaw.material as THREE.MeshStandardMaterial).opacity = dislocation === "jaw" ? 1 : 0;
  }

  react(kind: "block" | "hit", target: Target = "head", direction = 1): void {
    const side = direction < 0 ? "left" : "right";
    const clip = this.boxer.actions.get(`${kind}_${target}_${side}` as ClipName);
    if (clip === undefined) return;
    if (this.reactionAction !== null && this.reactionAction !== clip) this.reactionAction.stop();
    this.reactionAction = clip;
    clip.reset().setLoop(THREE.LoopOnce, 1);
    clip.setEffectiveWeight(0).play();
  }

  private setPunch(action: THREE.AnimationAction, ageTicks: number): void {
    const clip = action.getClip();
    const source = punchTiming(this.punchClass, "head", "normal");
    const sourceRecovery = Math.max(1, clip.duration * 30 - source.startup - source.active);
    const target = this.punchTiming;
    const age = THREE.MathUtils.clamp(ageTicks, 0, totalTicks(target));
    let clipTicks: number;
    if (age <= target.startup) {
      clipTicks = target.startup > 0 ? (age / target.startup) * source.startup : source.startup;
    } else if (age <= target.startup + target.active) {
      const activeAge = age - target.startup;
      clipTicks = source.startup + (target.active > 0 ? (activeAge / target.active) * source.active : source.active);
    } else {
      const recoveryAge = age - target.startup - target.active;
      clipTicks = source.startup + source.active
        + (target.recovery > 0 ? (recoveryAge / target.recovery) * sourceRecovery : sourceRecovery);
    }
    action.time = THREE.MathUtils.clamp(clipTicks / 30, 0, Math.max(0.001, clip.duration - 0.001));
  }

  private beginPunch(action: THREE.AnimationAction, totalTicksValue: number): void {
    if (this.activePunch !== null && this.activePunch !== action) this.activePunch.stop();
    this.activePunch = action;
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.setEffectiveWeight(0).play();
    action.paused = true;
    this.punchTotalTicks = Math.max(1, totalTicksValue);
  }

  update(
    fighter: FighterSnapshot,
    opponent: FighterSnapshot,
    dt: number,
    time: number,
    reducedMotion: boolean,
    blood: BloodLevel,
    sampledTick: number,
    opponentHeadWorld?: THREE.Vector3,
  ): void {
    const boxer = this.boxer;
    const mirror = fighter.stance === "orthodox" ? 1 : -1;

    const worldX = this.mapping.x(fighter.x);
    const worldZ = this.mapping.z(fighter.y);
    if (this.rootX === null) {
      this.rootX = worldX;
      this.rootZ = worldZ;
    }
    const maxStep = 0.05;
    this.rootX += THREE.MathUtils.clamp(worldX - this.rootX, -maxStep, maxStep);
    this.rootZ += THREE.MathUtils.clamp(worldZ - this.rootZ, -maxStep, maxStep);
    const targetYaw = Math.atan2(this.mapping.x(opponent.x) - worldX, (this.mapping.z(opponent.y) - worldZ) * 0.45);
    this.yaw = smoothAngle(this.yaw, targetYaw, 7, dt);
    boxer.root.position.set(this.rootX, 0, this.rootZ);
    boxer.root.rotation.set(0, this.yaw + 0.5 * mirror, 0);

    const fatigueScale = 0.82 + (fighter.stamina / Math.max(1, fighter.maximum_stamina)) * 0.18;
    this.hitstop = Math.max(0, this.hitstop - dt);
    this.hitstopScale = this.hitstop > 0 ? 0.12 : 1;

    if (fighter.action_id !== null && fighter.action_id !== this.actionId && fighter.action_id !== this.completedActionId) {
      const punchClass = fighter.action;
      const hand = fighter.action_hand ?? (fighter.stance === "orthodox" ? "left" : "right");
      if (punchClass !== null) {
        this.actionId = fighter.action_id;
        this.punchClass = punchClass;
        this.punchHand = hand;
        this.punchTarget = fighter.action_target ?? "head";
        this.punchPower = fighter.action_power ?? "normal";
        this.punchTiming = {
          ...punchTiming(this.punchClass, this.punchTarget, this.punchPower),
          startup: fighter.action_startup_ticks,
          active: fighter.action_active_ticks,
          recovery: fighter.action_recovery_ticks,
        };
        const total = Math.max(1, fighter.action_startup_ticks + fighter.action_active_ticks + fighter.action_recovery_ticks);
        this.beginPunch(boxer.actions.get(PUNCH_CLIP(punchClass, hand))!, total);
        this.punchAgeTicks = Math.max(0, sampledTick - fighter.action_start_tick);
        if (this.predictedId === fighter.action_id) {
          const predictedAge = this.predictionAgeTicks;
          const authoritativeAge = sampledTick - fighter.action_start_tick;
          if (Math.abs(predictedAge - authoritativeAge) > 1) this.punchAgeTicks = authoritativeAge;
          this.predictedId = null;
        } else {
          this.punchAgeTicks = Math.max(0, sampledTick - fighter.action_start_tick);
        }
      }
    }
    if (fighter.action_id === null) {
      this.actionId = null;
      this.completedActionId = null;
    }

    if (this.predictedId !== null) {
      this.predictionAgeTicks += dt * 30 * this.hitstopScale;
      if (this.predictionAgeTicks > 10) {
        this.predictedId = null;
      }
    }

    if (this.activePunch !== null) {
      this.punchAgeTicks += dt * 30 * this.hitstopScale;
      const total = this.punchTotalTicks;
      this.setPunch(this.activePunch, this.punchAgeTicks);
      if (this.punchAgeTicks >= total) {
        this.completedActionId = this.actionId;
        this.actionId = null;
        this.activePunch.stop();
        this.activePunch = null;
      }
    }
    if (this.reactionAction !== null && !this.reactionAction.isRunning()) {
      this.reactionAction.stop();
      this.reactionAction = null;
    }

    const worldVelocityX = this.mapping.x(fighter.velocity_x) * 30;
    const worldVelocityZ = this.mapping.z(fighter.velocity_y) * 30;
    const worldSpeed = Math.hypot(worldVelocityX, worldVelocityZ);
    const moving = worldSpeed > 0.05;
    const moveWeight = THREE.MathUtils.clamp(worldSpeed / 1.1, 0, 1);
    const forward = worldVelocityX * fighter.facing;
    const lateral = Math.sign(fighter.velocity_y) * Math.abs(worldVelocityZ);
    const directionTotal = Math.abs(forward) + Math.abs(lateral);
    const targets = {
      idle: 1 - moveWeight,
      move_forward: directionTotal > 0 ? Math.max(0, forward) / directionTotal * moveWeight : 0,
      move_backward: directionTotal > 0 ? Math.max(0, -forward) / directionTotal * moveWeight : 0,
      move_lateral_left: directionTotal > 0 ? Math.max(0, -lateral) / directionTotal * moveWeight : 0,
      move_lateral_right: directionTotal > 0 ? Math.max(0, lateral) / directionTotal * moveWeight : 0,
    };
    const gaitCadence = THREE.MathUtils.clamp(0.35 + worldSpeed / 1.1 * 0.65, 0.35, 1.5);
    const gaitTimeScale = fatigueScale * gaitCadence;
    for (const name of LOCOMOTION) {
      this.locomotionWeights[name] = smooth(this.locomotionWeights[name] ?? 0, targets[name], 10, dt);
      const action = boxer.actions.get(name)!;
      action.setEffectiveWeight(this.locomotionWeights[name]!);
      const playbackRate = name === "idle" ? fatigueScale : gaitTimeScale;
      action.setEffectiveTimeScale(reducedMotion ? Math.min(0.4, playbackRate) : playbackRate);
    }

    const defending = fighter.defense !== "none";
    if (defending) this.defenseClip = fighter.defense;
    this.defenseWeight = smooth(this.defenseWeight, defending ? 1 : 0, 12, dt);
    const defenseAction = boxer.actions.get(this.defenseClip)!;
    if (this.defenseWeight > 0.001 && !defenseAction.isRunning()) defenseAction.reset().play();

    const stateClip: ClipName | null = fighter.is_foul_recovery_target
      ? "foul_recovery"
      : fighter.clinch_ticks > 0 || fighter.clinch_startup_ticks > 0
        ? "clinch"
        : fighter.stunned_ticks > 0
          ? "stunned"
          : fighter.taunt_ticks > 0
            ? "taunt"
            : fighter.stamina / Math.max(1, fighter.maximum_stamina) < 0.16 && !moving && !defending
              ? "exhausted"
              : null;
    const nextStateAction = stateClip === null ? null : boxer.actions.get(stateClip)!;
    if (nextStateAction !== null && nextStateAction !== this.stateAction) {
      this.stateAction?.stop();
      this.stateAction = nextStateAction;
      this.stateWeight = 0;
      this.stateAction.reset().play();
    }
    this.stateRequested = nextStateAction !== null;
    this.stateWeight = smooth(this.stateWeight, this.stateRequested ? 1 : 0, 14, dt);
    if (!this.stateRequested && this.stateWeight < 0.001) {
      this.stateAction?.stop();
      this.stateAction = null;
      this.stateWeight = 0;
    }

    const dropTarget = opponent.is_downed ? -(this.boxer.metrics.headRestY * 0.88) : opponent.defense === "weave" ? -0.24 : -0.03;
    this.opponentDrop = smooth(this.opponentDrop, dropTarget, 4, dt);
    if (opponentHeadWorld !== undefined) {
      this.liveOpponentHead.copy(opponentHeadWorld);
      this.hasLiveHead = true;
    }

    if (fighter.is_downed) {
      if (this.activePunch !== null) {
        this.activePunch.stop();
        this.activePunch = null;
      }
      this.actionId = null;
      this.predictedId = null;
      if (this.downState === "up") {
        this.downState = "falling";
        this.fallAge = 0;
        const knockdown = boxer.actions.get("knockdown")!;
        knockdown.reset().setLoop(THREE.LoopOnce, 1);
        knockdown.setEffectiveWeight(0).play();
      } else if (this.downState === "falling") {
        this.fallAge += dt;
      }
    } else if (this.downState !== "up") {
      if (this.downState === "down" || this.downState === "falling") {
        this.downState = "rising";
        this.riseAge = 0;
        const getup = boxer.actions.get("getup")!;
        getup.reset().setLoop(THREE.LoopOnce, 1);
        getup.setEffectiveWeight(0).play();
      } else {
        this.riseAge += dt;
        if (this.riseAge > this.boxer.actions.get("getup")!.getClip().duration) {
          this.downState = "up";
          this.boxer.actions.get("knockdown")!.stop();
          this.boxer.actions.get("getup")!.stop();
        }
      }
    }
    if (this.downState === "falling" && this.fallAge > 1.3) this.downState = "down";

    this.applyActionWeights();
    boxer.mixer.update(dt * this.hitstopScale);

    this.applyAimCorrection(fighter, opponent);
    this.lockFeet(fighter, moving);
    this.applyDislocation();

    const opponentBlood = Math.min(
      1,
      (opponent.trauma.bleeding + opponent.trauma.left_cut + opponent.trauma.right_cut) / 620
        * (blood === "off" ? 0 : blood === "reduced" ? 0.3 : 1.5),
    );
    boxer.gloveGear.color.copy(boxer.gearBaseColor).lerp(BLOODED_GLOVE_COLOR, opponentBlood);
    applyTraumaToOverlays(boxer.trauma, fighter, opponentBlood, blood);
    boxer.setSkinClearcoat(0.25 + (1 - fighter.stamina / Math.max(1, fighter.maximum_stamina)) * 0.4);
    void time;
  }

  private applyActionWeights(): void {
    const downAction = this.downState === "falling" || this.downState === "down"
      ? this.boxer.actions.get("knockdown")!
      : this.downState === "rising"
        ? this.boxer.actions.get("getup")!
        : null;
    const hardOverride = downAction ?? this.reactionAction ?? this.activePunch;
    const stateWeight = hardOverride === null && this.stateAction !== null ? this.stateWeight : 0;
    const baseWeight = hardOverride === null ? 1 - stateWeight : 0;
    const defenseWeight = this.defenseWeight * baseWeight;
    const locomotionWeight = (1 - this.defenseWeight) * baseWeight;
    const locomotionTotal = LOCOMOTION.reduce(
      (total, name) => total + Math.max(0, this.locomotionWeights[name] ?? 0),
      0,
    );
    for (const name of LOCOMOTION) {
      const normalized = locomotionTotal > 0
        ? Math.max(0, this.locomotionWeights[name] ?? 0) / locomotionTotal
        : name === "idle" ? 1 : 0;
      this.boxer.actions.get(name)!.setEffectiveWeight(normalized * locomotionWeight);
    }
    for (const name of ["guard_high", "guard_low", "slip_left", "slip_right", "weave", "pull"] as const) {
      this.boxer.actions.get(name)!.setEffectiveWeight(name === this.defenseClip ? defenseWeight : 0);
    }
    for (const name of ONE_SHOTS) {
      const action = this.boxer.actions.get(name)!;
      const weight = action === hardOverride
        ? 1
        : hardOverride === null && action === this.stateAction
          ? stateWeight
          : 0;
      action.setEffectiveWeight(weight);
    }
  }

  private applyAimCorrection(fighter: FighterSnapshot, opponent: FighterSnapshot): void {
    if (this.activePunch === null || fighter.is_downed) return;
    const startupFrac = this.punchTiming.startup / Math.max(1, totalTicks(this.punchTiming));
    const punchT = this.punchAgeTicks / this.punchTotalTicks;
    if (punchT < startupFrac * 0.45 || punchT > startupFrac + 0.2) return;
    const metrics = this.boxer.metrics;
    const hurtbox = this.punchTarget === "body" ? HURTBOXES.torso : HURTBOXES.head;
    const opponentTarget = this.scratchA.set(
      this.mapping.x(opponent.x),
      (this.punchTarget === "body" ? metrics.chestRestY : metrics.headRestY) + hurtbox.offset_y + this.opponentDrop,
      this.mapping.z(opponent.y),
    );
    if (this.punchTarget === "head" && this.hasLiveHead) {
      opponentTarget.copy(this.liveOpponentHead).addScaledVector(this.boxer.root.up, hurtbox.offset_y);
    }
    const gloveName = this.punchHand === "left" ? "gloveL" : "gloveR";
    const gloveBone = this.boxer.bone(gloveName);
    const elbowBone = this.boxer.bone(gloveName === "gloveL" ? "elbowL" : "elbowR");
    const shoulderBone = this.boxer.bone(gloveName === "gloveL" ? "shoulderL" : "shoulderR");
    if (gloveBone === null || elbowBone === null || shoulderBone === null) return;
    this.boxer.root.updateMatrixWorld(true);
    const gloveWorld = gloveBone.getWorldPosition(this.scratchB);
    const correction = this.scratchC.subVectors(opponentTarget, gloveWorld);
    const contactDistance = hurtbox.radius + GLOVE_HITBOX_RADIUS;
    const overshoot = correction.length() - contactDistance;
    if (overshoot <= 0.01) return;
    correction.setLength(Math.min(0.42, overshoot));
    const targetWorld = this.aimTarget.copy(gloveWorld).add(correction);
    const shoulderWorld = shoulderBone.getWorldPosition(this.aimShoulder);
    const upper = this.boxer.metrics.armUpper;
    const fore = this.boxer.metrics.armFore;
    const to = this.aimTo.copy(targetWorld).sub(shoulderWorld);
    const reachReserve = this.punchClass === "hook" ? 0.11 : this.punchClass === "uppercut" ? 0.07 : 0.015;
    const distance = THREE.MathUtils.clamp(to.length(), 0.12, upper + fore - reachReserve);
    to.normalize();
    const a = (upper * upper - fore * fore + distance * distance) / (2 * distance);
    const h = Math.sqrt(Math.max(0.0001, upper * upper - a * a));
    const pole = this.aimPole.set(0.9 * (gloveName === "gloveL" ? 1 : -1), -1, -0.25).applyQuaternion(this.boxer.root.quaternion);
    const bend = this.aimBend.copy(pole).addScaledVector(to, -pole.dot(to)).normalize();
    const elbowWorld = this.aimElbow.copy(shoulderWorld).addScaledVector(to, a).addScaledVector(bend, h);
    aimBoneLocal(shoulderBone, elbowBone, elbowWorld);
    shoulderBone.updateMatrixWorld(true);
    aimBoneLocal(elbowBone, gloveBone, targetWorld);
  }

  private applyDislocation(): void {
    if (this.dislocation === null) return;
    if (this.dislocation === "jaw") {
      const head = this.boxer.bone("head");
      if (head !== null) {
        head.quaternion.multiply(
          this.scratchQ.setFromEuler(new THREE.Euler(0.08, 0.2, -0.22)),
        );
      }
      const jaw = this.boxer.trauma.jaw;
      const rest = jaw.userData.restPosition as THREE.Vector3;
      jaw.position.copy(rest).add(this.scratchA.set(0.04, -0.04, 0.018));
      jaw.rotation.set(0.16, 0.08, -0.18);
      return;
    }
    const side = this.dislocation === "shoulder_left" ? "L" : "R";
    const shoulder = this.boxer.bone(`shoulder${side}`);
    const elbow = this.boxer.bone(`elbow${side}`);
    if (shoulder === null || elbow === null) return;
    this.boxer.root.updateMatrixWorld(true);
    const shoulderWorld = shoulder.getWorldPosition(this.scratchA);
    const hangingOffset = this.scratchB
      .set(side === "L" ? 0.2 : -0.2, -0.38, 0.04)
      .applyQuaternion(this.boxer.root.quaternion);
    aimBoneLocal(shoulder, elbow, hangingOffset.add(shoulderWorld));
  }

  private lockFeet(fighter: FighterSnapshot, moving: boolean): void {
    for (const side of ["L", "R"] as const) {
      const ankle = this.boxer.bone(`ankle${side}`);
      const knee = this.boxer.bone(`knee${side}`);
      const hip = this.boxer.bone(`hip${side}`);
      if (ankle === null || knee === null || hip === null) continue;
      this.boxer.root.updateMatrixWorld(true);
      const world = ankle.getWorldPosition(this.lockAnkle);
      const key = side === "L" ? "plantedL" : "plantedR";
      let planted = this[key];
      if (moving || fighter.is_downed || world.y > this.boxer.metrics.ankleRestY * 1.35) {
        this[key] = null;
        continue;
      }
      if (planted === null) {
        this[key] = world.clone();
        continue;
      }
      const flatDrift = Math.hypot(world.x - planted.x, world.z - planted.z);
      if (flatDrift > 0.11) {
        this[key] = world.clone();
        planted = this[key];
        continue;
      }
      if (flatDrift < 0.008) continue;
      const pinned = this.lockPinned.set(planted.x, world.y, planted.z);
      const hipWorld = hip.getWorldPosition(this.lockHip);
      const thigh = this.boxer.metrics.legThigh;
      const shin = this.boxer.metrics.legShin;
      const to = this.lockTo.copy(pinned).sub(hipWorld);
      const distance = THREE.MathUtils.clamp(to.length(), 0.15, thigh + shin - 0.02);
      to.normalize();
      const a = (thigh * thigh - shin * shin + distance * distance) / (2 * distance);
      const h = Math.sqrt(Math.max(0.0001, thigh * thigh - a * a));
      const pole = this.lockPole.set(0, 0.2, 1).applyQuaternion(this.boxer.root.quaternion);
      const bend = this.lockBend.copy(pole).addScaledVector(to, -pole.dot(to));
      if (bend.lengthSq() < 0.0001) bend.set(0, 0, 1);
      bend.normalize();
      const kneeWorld = this.lockKnee.copy(hipWorld).addScaledVector(to, a).addScaledVector(bend, h);
      aimBoneLocal(hip, knee, kneeWorld);
      hip.updateMatrixWorld(true);
      aimBoneLocal(knee, ankle, pinned);
    }
  }

  dispose(): void {
    this.boxer.dispose();
  }
}

const aimJointWorld = new THREE.Vector3();
const aimChildWorld = new THREE.Vector3();
const aimCurrentDirection = new THREE.Vector3();
const aimTargetDirection = new THREE.Vector3();
const aimDelta = new THREE.Quaternion();
const aimWorldQuaternion = new THREE.Quaternion();
const aimParentQuaternion = new THREE.Quaternion();

export function aimBoneLocal(joint: THREE.Object3D, child: THREE.Object3D, toWorld: THREE.Vector3): void {
  joint.getWorldPosition(aimJointWorld);
  child.getWorldPosition(aimChildWorld);
  aimCurrentDirection.subVectors(aimChildWorld, aimJointWorld);
  aimTargetDirection.subVectors(toWorld, aimJointWorld);
  if (aimCurrentDirection.lengthSq() < 0.000001 || aimTargetDirection.lengthSq() < 0.000001) return;
  aimCurrentDirection.normalize();
  aimTargetDirection.normalize();
  if (aimCurrentDirection.dot(aimTargetDirection) > 1 - 1e-6) return;
  aimDelta.setFromUnitVectors(aimCurrentDirection, aimTargetDirection);
  joint.getWorldQuaternion(aimWorldQuaternion);
  aimWorldQuaternion.premultiply(aimDelta);
  const parent = joint.parent;
  if (parent === null) {
    joint.quaternion.copy(aimWorldQuaternion);
    return;
  }
  parent.getWorldQuaternion(aimParentQuaternion);
  joint.quaternion.copy(aimParentQuaternion.invert().multiply(aimWorldQuaternion));
}
