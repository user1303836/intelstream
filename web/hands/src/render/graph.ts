import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { punchTiming, totalTicks, HURTBOXES } from "../manifest";
import type { BloodLevel } from "../settings";
import type { FighterSnapshot, Hand, Power, PunchClass, SemanticAction, Target } from "../types";
import { FIGHTER_GLB_BASE64 } from "../assets/fighter-glb";
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

export function loadBoxerGlb(): Promise<GLTF> {
  if (cachedGltf === null) {
    const bytes = Uint8Array.from(atob(FIGHTER_GLB_BASE64), (char) => char.charCodeAt(0));
    const gltf = new Promise<GLTF>((resolve, reject) => {
      new GLTFLoader().parse(bytes.buffer, "", resolve, (error: unknown) => reject(error instanceof Error ? error : new Error(String(error))));
    });
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
  let gloves: THREE.MeshStandardMaterial | null = null;
  target.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh) || Array.isArray(object.material)) return;
    const sourceName = object.material.name;
    const textureName = MATERIAL_TEXTURE[sourceName];
    if (textureName === undefined) throw new Error(`fighter GLB has unsupported material ${sourceName}`);
    const isSkin = sourceName === "MHeadMat0" || sourceName === "MBodyMat0";
    const color = sourceName === "GlovesMat0" || sourceName === "PantsMat0" ? palette.gear : 0xffffff;
    const material = isSkin
      ? new THREE.MeshPhysicalMaterial({ map: fighterTexture(textureName), color, roughness: 0.58, metalness: 0.02, clearcoat: 0.25, clearcoatRoughness: 0.6 })
      : new THREE.MeshStandardMaterial({ map: fighterTexture(textureName), color, roughness: 0.4, metalness: 0.03 });
    material.name = sourceName;
    object.material = material;
    object.castShadow = true;
    object.receiveShadow = true;
    object.frustumCulled = false;
    owned.push(material);
    if (material instanceof THREE.MeshPhysicalMaterial) skin.push(material);
    if (sourceName === "GlovesMat0") gloves = material as THREE.MeshStandardMaterial;
  });
  if (skin.length !== 2 || gloves === null || owned.length !== 5) {
    throw new Error(`fighter GLB material contract failed: ${skin.length} skin, ${owned.length} total`);
  }
  return { skin, gloves, owned };
}

export const CLIP_NAMES = [
  "idle", "move_forward", "move_backward", "move_lateral", "guard_high", "guard_low",
  "jab_left", "jab_right", "straight_left", "straight_right", "hook_left", "hook_right",
  "uppercut_left", "uppercut_right", "block_head", "hit_head", "knockdown", "getup",
] as const;

export type ClipName = (typeof CLIP_NAMES)[number];

export interface BoxerPaletteColors {
  readonly skin: number;
  readonly gear: number;
}

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
  private decapitated = false;
  readonly gearBaseColor: THREE.Color;
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
    instance.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh && object.name === "BoxerHead") this.headMeshes.push(object);
      if (object instanceof THREE.Bone) this.bones.set(object.name, object);
    });
    const missing = Object.values(BONE_ADAPTER).filter((name) => !this.bones.has(name));
    if (missing.length > 0) throw new Error(`fighter GLB missing required bones: ${missing.join(", ")}`);
    if (this.headMeshes.length !== 1) throw new Error(`fighter GLB requires one BoxerHead mesh, found ${this.headMeshes.length}`);
    this.mixer = new THREE.AnimationMixer(instance);
    for (const clip of gltf.animations) {
      const action = this.mixer.clipAction(clip);
      this.actions.set(clip.name as ClipName, action);
      if (["jab_left", "jab_right", "straight_left", "straight_right", "hook_left", "hook_right", "uppercut_left", "uppercut_right", "block_head", "hit_head", "knockdown", "getup"].includes(clip.name)) {
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
    this.overlays = buildTraumaOverlays(this.bone("head")!, this.bone("chest")!);
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

function buildTraumaOverlays(head: THREE.Bone, chest: THREE.Bone): TraumaOverlays {
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
  return {
    bruiseL, bruiseR, swellL, swellR, cutL, cutR, streakL, streakR, noseStreak, mouthBlood,
    cheekL, cheekR, ribL, ribR, bodyBruise, bodyStreak,
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
const LOCOMOTION: readonly ClipName[] = ["idle", "move_forward", "move_backward", "move_lateral"];
const PUNCH_CLIP = (punchClass: PunchClass, hand: Hand): ClipName => `${punchClass}_${hand}` as ClipName;

export class BoxingGraph {
  readonly boxer: SkinnedBoxer;
  private yaw = 0;
  private rootX: number | null = null;
  private rootZ = 0;
  private activePunch: THREE.AnimationAction | null = null;
  private punchAgeTicks = 0;
  private punchTotalTicks = 1;
  private actionId: string | null = null;
  private completedActionId: string | null = null;
  private predictedId: string | null = null;
  private predictedAtSeconds = -1;
  private predictionAgeTicks = 0;
  private predictedClip: ClipName = "jab_left";
  private predictedTotalTicks = 13;
  private hitstop = 0;
  private reactionAction: THREE.AnimationAction | null = null;
  private downState: "up" | "falling" | "down" | "rising" = "up";
  private fallAge = 0;
  private riseAge = 0;
  private opponentDrop = 0;
  private readonly liveOpponentHead = new THREE.Vector3(0, 0.97, 0);
  private hasLiveHead = false;
  private guardWeight = 0;
  private hitstopScale = 1;
  private plantedL: THREE.Vector3 | null = null;
  private plantedR: THREE.Vector3 | null = null;
  private readonly locomotionWeights: Record<string, number> = { idle: 1, move_forward: 0, move_backward: 0, move_lateral: 0 };
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

  react(kind: "block" | "hit"): void {
    const clip = this.boxer.actions.get(kind === "block" ? "block_head" : "hit_head");
    if (clip === undefined) return;
    this.reactionAction?.fadeOut(0.08);
    this.reactionAction = clip;
    clip.reset().setLoop(THREE.LoopOnce, 1);
    clip.setEffectiveWeight(0.85);
    clip.fadeIn(0.03).play();
  }

  private setPunch(action: THREE.AnimationAction, ageTicks: number): void {
    const clip = action.getClip();
    const clamped = THREE.MathUtils.clamp(ageTicks / 30, 0, Math.max(0.001, clip.duration - 0.001));
    action.time = clamped;
  }

  private beginPunch(action: THREE.AnimationAction, totalTicksValue: number): void {
    this.activePunch?.fadeOut(0.05);
    this.activePunch = action;
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.setEffectiveWeight(1);
    action.fadeIn(0.04).play();
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
        this.activePunch.fadeOut(0.12);
        this.activePunch = null;
      }
    }
    if (this.reactionAction !== null && !this.reactionAction.isRunning()) {
      this.reactionAction.fadeOut(0.1);
      this.reactionAction = null;
    }

    const speed = Math.hypot(fighter.velocity_x, fighter.velocity_y);
    const moving = speed > 0.5;
    const forward = THREE.MathUtils.clamp(fighter.velocity_x * fighter.facing / 7, -1, 1);
    const lateral = THREE.MathUtils.clamp(fighter.velocity_y / 7, -1, 1);
    const targets: { idle: number; move_forward: number; move_backward: number; move_lateral: number } = {
      idle: moving ? 0 : 1,
      move_forward: Math.max(0, forward) * (moving ? 1 : 0),
      move_backward: Math.max(0, -forward) * (moving ? 1 : 0),
      move_lateral: Math.abs(lateral) * (moving ? 1 : 0),
    };
    const weightSum = targets.idle + targets.move_forward + targets.move_backward + targets.move_lateral;
    for (const name of LOCOMOTION) {
      const normalized = weightSum > 0 ? targets[name as keyof typeof targets] / weightSum : name === "idle" ? 1 : 0;
      this.locomotionWeights[name] = smooth(this.locomotionWeights[name] ?? 0, normalized, 10, dt);
      const action = boxer.actions.get(name as ClipName)!;
      action.setEffectiveWeight(this.locomotionWeights[name]!);
      action.setEffectiveTimeScale(reducedMotion ? 0.4 : fatigueScale);
    }

    const guarding = fighter.defense === "guard_high" || fighter.defense === "guard_low";
    this.guardWeight = smooth(this.guardWeight, guarding ? 1 : 0, 12, dt);
    for (const name of ["guard_high", "guard_low"] as const) {
      const action = boxer.actions.get(name)!;
      const target = fighter.defense === name ? this.guardWeight : 0;
      if (target > 0 && !action.isRunning()) action.reset().play();
      action.setEffectiveWeight(target);
    }

    const dropTarget = opponent.is_downed ? -(this.boxer.metrics.headRestY * 0.88) : opponent.defense === "weave" ? -0.24 : -0.03;
    this.opponentDrop = smooth(this.opponentDrop, dropTarget, 4, dt);
    if (opponentHeadWorld !== undefined) {
      this.liveOpponentHead.copy(opponentHeadWorld);
      this.hasLiveHead = true;
    }

    if (fighter.is_downed) {
      if (this.activePunch !== null) {
        this.activePunch.fadeOut(0.06);
        this.activePunch = null;
      }
      this.actionId = null;
      this.predictedId = null;
      if (this.downState === "up") {
        this.downState = "falling";
        this.fallAge = 0;
        const knockdown = boxer.actions.get("knockdown")!;
        knockdown.reset().setLoop(THREE.LoopOnce, 1);
        knockdown.setEffectiveWeight(1);
        knockdown.fadeIn(0.03).play();
      } else if (this.downState === "falling") {
        this.fallAge += dt;
      }
    } else if (this.downState !== "up") {
      if (this.downState === "down" || this.downState === "falling") {
        this.downState = "rising";
        this.riseAge = 0;
        this.boxer.actions.get("knockdown")!.fadeOut(0.1);
        const getup = boxer.actions.get("getup")!;
        getup.reset().setLoop(THREE.LoopOnce, 1);
        getup.setEffectiveWeight(1);
        getup.fadeIn(0.05).play();
      } else {
        this.riseAge += dt;
        if (this.riseAge > 0.9) {
          this.downState = "up";
          this.boxer.actions.get("getup")!.fadeOut(0.12);
        }
      }
    }
    if (this.downState === "falling" && this.fallAge > 1.3) this.downState = "down";

    boxer.mixer.update(dt * this.hitstopScale);

    this.applyAimCorrection(fighter, opponent);
    this.lockFeet(fighter, moving);

    const opponentBlood = Math.min(
      1,
      (opponent.trauma.bleeding + opponent.trauma.left_cut + opponent.trauma.right_cut) / 620
        * (blood === "off" ? 0 : blood === "reduced" ? 0.3 : 1.5),
    );
    boxer.gloveGear.color.copy(boxer.gearBaseColor).lerp(BLOODED_GLOVE_COLOR, opponentBlood);
    applyTraumaToOverlays(boxer.trauma, fighter, opponentBlood, blood);
    boxer.setSkinClearcoat(0.25 + (1 - fighter.stamina / Math.max(1, fighter.maximum_stamina)) * 0.4);
    void time;
    void HURTBOXES;
  }

  private applyAimCorrection(fighter: FighterSnapshot, opponent: FighterSnapshot): void {
    if (this.activePunch === null || this.actionId === null || fighter.is_downed) return;
    const punchClass = fighter.action;
    if (punchClass === null) return;
    const timing = punchTiming(punchClass, fighter.action_target ?? "head", fighter.action_power ?? "normal");
    const startupFrac = timing.startup / Math.max(1, totalTicks(timing));
    const punchT = this.punchAgeTicks / this.punchTotalTicks;
    if (punchT < startupFrac * 0.45 || punchT > startupFrac + 0.2) return;
    const metrics = this.boxer.metrics;
    const opponentHead = this.scratchA.set(
      this.mapping.x(opponent.x),
      (fighter.action_target === "body" ? metrics.chestRestY : metrics.headRestY + 0.05) + this.opponentDrop,
      this.mapping.z(opponent.y),
    );
    if (this.hasLiveHead) {
      opponentHead.lerp(this.liveOpponentHead, 0.85);
    }
    const gloveName = (fighter.action_hand ?? "left") === "left" ? "gloveL" : "gloveR";
    const gloveBone = this.boxer.bone(gloveName);
    const elbowBone = this.boxer.bone(gloveName === "gloveL" ? "elbowL" : "elbowR");
    const shoulderBone = this.boxer.bone(gloveName === "gloveL" ? "shoulderL" : "shoulderR");
    if (gloveBone === null || elbowBone === null || shoulderBone === null) return;
    this.boxer.root.updateMatrixWorld(true);
    const gloveWorld = gloveBone.getWorldPosition(this.scratchB);
    const correction = this.scratchC.subVectors(opponentHead, gloveWorld);
    const overshoot = correction.length() - 0.09;
    if (overshoot <= 0.01) return;
    correction.setLength(Math.min(0.42, overshoot));
    const targetWorld = this.aimTarget.copy(gloveWorld).add(correction);
    const shoulderWorld = shoulderBone.getWorldPosition(this.aimShoulder);
    const upper = this.boxer.metrics.armUpper;
    const fore = this.boxer.metrics.armFore;
    const to = this.aimTo.copy(targetWorld).sub(shoulderWorld);
    const distance = THREE.MathUtils.clamp(to.length(), 0.12, upper + fore - 0.015);
    to.normalize();
    const a = (upper * upper - fore * fore + distance * distance) / (2 * distance);
    const h = Math.sqrt(Math.max(0.0001, upper * upper - a * a));
    const pole = this.aimPole.set(0.9 * (gloveName === "gloveL" ? 1 : -1), -1, -0.25).applyQuaternion(this.boxer.root.quaternion);
    const bend = this.aimBend.copy(pole).addScaledVector(to, -pole.dot(to)).normalize();
    const elbowWorld = this.aimElbow.copy(shoulderWorld).addScaledVector(to, a).addScaledVector(bend, h);
    aimBoneLocal(shoulderBone, shoulderWorld, elbowWorld);
    shoulderBone.updateMatrixWorld(true);
    aimBoneLocal(elbowBone, elbowWorld, targetWorld);
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
      aimBoneLocal(hip, hipWorld, kneeWorld);
      hip.updateMatrixWorld(true);
      aimBoneLocal(knee, kneeWorld, pinned);
    }
  }

  dispose(): void {
    this.boxer.dispose();
  }
}

const aimUp = new THREE.Vector3(0, 1, 0);
const aimDir = new THREE.Vector3();
const aimQuat = new THREE.Quaternion();
const aimParentQuat = new THREE.Quaternion();

export function aimBoneLocal(joint: THREE.Object3D, fromWorld: THREE.Vector3, toWorld: THREE.Vector3): void {
  aimDir.subVectors(toWorld, fromWorld);
  if (aimDir.lengthSq() < 0.000001) return;
  aimDir.normalize();
  aimQuat.setFromUnitVectors(aimUp, aimDir);
  const parent = joint.parent;
  if (parent === null) {
    joint.quaternion.copy(aimQuat);
    return;
  }
  parent.getWorldQuaternion(aimParentQuat);
  joint.quaternion.copy(aimParentQuat.invert().multiply(aimQuat));
}
