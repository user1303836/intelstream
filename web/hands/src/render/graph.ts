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
import { wearCornerColour } from "./gear";
import { BODY_SITES, BODY_SWELL_CORE, EYE_LIDS, HEAD_SITES, HEAD_SWELL_CORE, InjuryShading, applyBodyTrauma, applyHeadTrauma, trunksBloodFor } from "./injury";
import { LookShading, SCANNED_LOOK, type FighterLook } from "./looks";
import { applyOutfitShading, buildCuffGeometry, buildHandGeometry, type OfficialOutfit, type OutfitPart } from "./outfit";
import { PoseSolver, STANCE, easeIn, easeOut, mirrorX, smoothstep, vec, type FootTarget, type HandTarget, type PoseDescription } from "./poser";
import { KnockoutRagdoll, blowImpulse, fallStyleFor } from "./ragdoll";
import { SolvedRig } from "./rig";
import type { WorldMapping } from "./world";

export const FIGHTER_MODEL_SCALE = 1;

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
  readonly gloveBlood: { value: number };
  readonly trunksBlood: { value: number };
  readonly owned: readonly THREE.Material[];
  readonly headInjury: InjuryShading;
  readonly bodyInjury: InjuryShading;
}

export function applyFighterSkin(target: THREE.Object3D, palette: BoxerPaletteColors): AppliedFighterMaterials {
  const skin: THREE.MeshPhysicalMaterial[] = [];
  const owned: THREE.Material[] = [];
  const bySource = new Map<string, THREE.MeshStandardMaterial>();
  let gloveBlood: { value: number } | null = null;
  let trunksBlood: { value: number } = { value: 0 };
  let headInjury: InjuryShading | null = null;
  let bodyInjury: InjuryShading | null = null;
  target.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh) || Array.isArray(object.material)) return;
    const sourceName = object.material.name;
    const textureName = MATERIAL_TEXTURE[sourceName];
    if (textureName === undefined) throw new Error(`fighter GLB has unsupported material ${sourceName}`);
    let material = bySource.get(sourceName);
    if (material === undefined) {
      const isSkin = sourceName === "MHeadMat0" || sourceName === "MBodyMat0";
      const outfit = palette.outfit;
      const color = sourceName === "GlovesMat0" ? palette.gear
        : sourceName === "PantsMat0" ? (outfit?.trousers ?? palette.gear)
        : sourceName === "ShoesMat0" && outfit !== undefined ? outfit.shoes
        : 0xffffff;
      const map = fighterTexture(textureName);
      material = isSkin
        ? new THREE.MeshPhysicalMaterial({ map, color, roughness: 0.58, metalness: 0.02, clearcoat: 0.25, clearcoatRoughness: 0.6 })
        : new THREE.MeshStandardMaterial({ map, color, roughness: 0.4, metalness: 0.03 });
      material.name = sourceName;
      bySource.set(sourceName, material);
      owned.push(material);
      if (material instanceof THREE.MeshPhysicalMaterial) skin.push(material);
      if (sourceName === "MHeadMat0") headInjury = new InjuryShading(material, HEAD_SITES, { core: HEAD_SWELL_CORE, lids: EYE_LIDS });
      if (sourceName === "MBodyMat0") bodyInjury = new InjuryShading(material, BODY_SITES, { core: BODY_SWELL_CORE, wash: true });
      const part = OUTFIT_PARTS[sourceName];
      if (outfit !== undefined && part !== undefined) applyOutfitShading(material, part, outfit);
      else if (sourceName === "PantsMat0") trunksBlood = wearCornerColour(material, false, "trunks");
      else if (sourceName === "GlovesMat0") gloveBlood = wearCornerColour(material);
    }
    object.material = material;
    object.castShadow = true;
    object.receiveShadow = true;
    object.frustumCulled = false;
  });
  if (skin.length !== 2 || gloveBlood === null || owned.length !== 5 || headInjury === null || bodyInjury === null) {
    throw new Error(`fighter GLB material contract failed: ${skin.length} skin, ${owned.length} total`);
  }
  return { skin, gloveBlood, trunksBlood, owned, headInjury, bodyInjury };
}

export interface BoxerPaletteColors {
  readonly skin: number;
  readonly gear: number;
  /** Skin tone, hair, beard and face shape; the scanned man when omitted. */
  readonly look?: FighterLook;
  /** Dresses the body as a ring official and swaps the gloves for hands. */
  readonly outfit?: OfficialOutfit;
}

const OUTFIT_PARTS: Readonly<Record<string, OutfitPart>> = { MHeadMat0: "head", MBodyMat0: "body", ShoesMat0: "shoes", PantsMat0: "pants" };
/** The lit tone of the scanned face texture in linear light, so bare hands match the face. */
const SCANNED_SKIN = new THREE.Color().setRGB(0.6, 0.32, 0.19, THREE.LinearSRGBColorSpace);

export type ArcadeDislocation = "jaw" | "shoulder_left" | "shoulder_right";
/** What the cutman has in his hand: the enswell for a cut or a swelling, a water bottle for the breath. */
export type CutmanProp = "enswell" | "bottle";

const smooth = (current: number, target: number, rate: number, dt: number): number => current + (target - current) * (1 - Math.exp(-rate * dt));
const smoothAngle = (current: number, target: number, rate: number, dt: number): number => {
  const delta = ((target - current + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return current + delta * (1 - Math.exp(-rate * dt));
};
const clamp = THREE.MathUtils.clamp;

export class SkinnedBoxer {
  readonly root = new THREE.Group();
  readonly bones = new Map<string, THREE.Bone>();
  readonly rig: SolvedRig;
  /** Bone-derived measurements in world units (after MODEL_SCALE). */
  readonly metrics: { armUpper: number; armFore: number; legThigh: number; legShin: number; headRestY: number; chestRestY: number; ankleRestY: number };
  private readonly skinMaterials: readonly THREE.MeshPhysicalMaterial[];
  private readonly ownedMaterials: THREE.Material[];
  private readonly gloveBlood: { value: number };
  private readonly trunksBlood: { value: number };
  private readonly headMeshes: THREE.SkinnedMesh[] = [];
  private readonly handMeshes: Record<Hand, THREE.SkinnedMesh[]> = { left: [], right: [] };
  private decapitated = false;
  private burst = false;
  private readonly dismemberedHands: Record<Hand, boolean> = { left: false, right: false };
  private readonly dressed: boolean;
  private readonly ownedGeometries: THREE.BufferGeometry[] = [];
  readonly gearBaseColor: THREE.Color;
  readonly skinBaseColor: THREE.Color;
  readonly headInjury: InjuryShading;
  readonly bodyInjury: InjuryShading;
  private readonly headLook: LookShading;
  private readonly bareHand: THREE.MeshStandardMaterial | null;

  constructor(gltf: GLTF, palette: BoxerPaletteColors) {
    const instance = cloneSkeleton(gltf.scene);
    instance.scale.setScalar(FIGHTER_MODEL_SCALE);
    this.root.add(instance);
    const materials = applyFighterSkin(instance, palette);
    this.skinMaterials = materials.skin;
    this.ownedMaterials = [...materials.owned];
    this.gloveBlood = materials.gloveBlood;
    this.trunksBlood = materials.trunksBlood;
    this.headInjury = materials.headInjury;
    this.bodyInjury = materials.bodyInjury;
    this.gearBaseColor = new THREE.Color(palette.gear);
    this.skinBaseColor = new THREE.Color(palette.skin);
    this.dressed = palette.outfit !== undefined;
    instance.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh && object.name === "BoxerHead") this.headMeshes.push(object);
      if (object instanceof THREE.SkinnedMesh && object.name === "BoxerGloveLeft") this.handMeshes.left.push(object);
      if (object instanceof THREE.SkinnedMesh && object.name === "BoxerGloveRight") this.handMeshes.right.push(object);
      if (object instanceof THREE.Bone) this.bones.set(object.name, object);
    });
    const missing = Object.values(BONE_ADAPTER).filter((name) => !this.bones.has(name));
    if (missing.length > 0) throw new Error(`fighter GLB missing required bones: ${missing.join(", ")}`);
    if (this.headMeshes.length !== 1) throw new Error(`fighter GLB requires one BoxerHead mesh, found ${this.headMeshes.length}`);
    const headShadow = this.headInjury.shadowMaterial();
    this.headMeshes[0]!.customDepthMaterial = headShadow;
    // Drawn from inside too, so a cut through the head shows flesh where it is open. Shadows still come
    // from the back faces as for a one-sided skin, or the face would shadow itself in stripes.
    const headMaterial = this.headMeshes[0]!.material as THREE.Material;
    headMaterial.side = THREE.DoubleSide;
    headMaterial.shadowSide = THREE.BackSide;
    this.ownedMaterials.push(headShadow);
    for (const side of ["left", "right"] as const) {
      if (this.handMeshes[side].length !== 1) {
        throw new Error(`fighter GLB requires one ${side} glove mesh, found ${this.handMeshes[side].length}`);
      }
    }
    this.root.updateMatrixWorld(true);
    this.rig = new SolvedRig(this.root);
    // Last on, so it runs first in the shader: the look, then the clothes over it, then the injuries.
    this.headLook = new LookShading(this.headMeshes[0]!.material as THREE.MeshStandardMaterial);
    this.bareHand = palette.outfit === undefined ? null : this.addHands(palette.outfit);
    this.setLook(palette.look ?? SCANNED_LOOK);
    const rigMetrics = this.rig.metrics;
    this.metrics = {
      armUpper: rigMetrics.armL.upper,
      armFore: rigMetrics.armL.lower,
      legThigh: rigMetrics.legL.upper,
      legShin: rigMetrics.legL.lower,
      headRestY: rigMetrics.headHeight,
      chestRestY: rigMetrics.chestHeight,
      ankleRestY: rigMetrics.ankleHeight,
    };
  }

  bone(name: string): THREE.Bone | null {
    return this.bones.get(BONE_ADAPTER[name] ?? name) ?? null;
  }

  /** How much of the opponent's blood is on the gloves, 0 to 1. */
  setGloveBlood(amount: number): void {
    this.gloveBlood.value = clamp(amount, 0, 1);
  }

  get gloveBloodLevel(): number {
    return this.gloveBlood.value;
  }

  /** How far the fighter's own blood has run into the front of the trunks, 0 to 1. */
  setTrunksBlood(amount: number): void {
    this.trunksBlood.value = clamp(amount, 0, 1);
  }

  get trunksBloodLevel(): number {
    return this.trunksBlood.value;
  }

  get headMesh(): THREE.SkinnedMesh {
    return this.headMeshes[0]!;
  }

  gloveMesh(side: Hand): THREE.SkinnedMesh {
    return this.handMeshes[side][0]!;
  }

  get skin(): THREE.MeshPhysicalMaterial {
    return this.skinMaterials[0]!;
  }

  get isDecapitated(): boolean {
    return this.decapitated;
  }

  /** Cuts the head off through the neck; the collar of the head mesh stays on the shoulders. */
  setDecapitated(value: boolean): void {
    this.decapitated = value;
    this.burst = false;
    this.headInjury.setSevered(value);
    this.bone("head")!.visible = !value;
  }

  get isHeadBurst(): boolean {
    return this.burst;
  }

  /** Bursts the head above the mouth; the lower jaw stays on the neck. */
  setHeadBurst(value: boolean): void {
    this.burst = value;
    this.decapitated = false;
    this.headInjury.setBurst(value);
    this.bone("head")!.visible = !value;
  }

  isHandDismembered(side: Hand): boolean {
    return this.dismemberedHands[side];
  }

  setHandDismembered(side: Hand, value: boolean): void {
    this.dismemberedHands[side] = value;
    for (const mesh of this.handMeshes[side]) mesh.visible = !value && !this.dressed;
  }

  /** Changes who this fighter is: skin tone, hair, beard and face shape. */
  setLook(look: FighterLook): void {
    this.headLook.set(look);
    for (const material of this.skinMaterials) material.color.setHex(look.tint);
    this.bareHand?.color.copy(SCANNED_SKIN).multiply(this.skinMaterials[0]!.color);
  }

  get look(): FighterLook {
    return this.headLook.look;
  }

  /** Returns the material of bare hands, which follows the skin tone, or null for gloved ones. */
  private addHands(outfit: OfficialOutfit): THREE.MeshStandardMaterial | null {
    const gloved = outfit.gloves !== null;
    const hand = new THREE.MeshStandardMaterial({
      color: gloved ? outfit.gloves! : SCANNED_SKIN,
      roughness: gloved ? 0.38 : 0.6,
      metalness: 0.02,
    });
    const cuff = gloved ? hand : new THREE.MeshStandardMaterial({ color: new THREE.Color(outfit.shirt).multiplyScalar(0.9), roughness: 0.88, metalness: 0 });
    this.ownedMaterials.push(hand);
    if (cuff !== hand) this.ownedMaterials.push(cuff);
    const cuffGeometry = buildCuffGeometry();
    this.ownedGeometries.push(cuffGeometry);
    for (const side of ["left", "right"] as const) {
      for (const mesh of this.handMeshes[side]) mesh.visible = false;
      const geometry = buildHandGeometry(side);
      this.ownedGeometries.push(geometry);
      const suffix = side === "left" ? "L" : "R";
      for (const [bone, part, material, name] of [
        [this.rig.bones[`glove${suffix}`], geometry, hand, `hand-${side}`],
        [this.rig.bones[`elbow${suffix}`], cuffGeometry, cuff, `cuff-${side}`],
      ] as const) {
        const mesh = new THREE.Mesh(part, material);
        mesh.name = name;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        bone.add(mesh);
      }
    }
    return gloved ? null : hand;
  }

  setSkinClearcoat(value: number): void {
    for (const material of this.skinMaterials) material.clearcoat = value;
  }

  dispose(): void {
    for (const material of this.ownedMaterials) material.dispose();
    for (const geometry of this.ownedGeometries) geometry.dispose();
  }
}

export type ReactionKind = "block" | "hit";

export type Verdict = "winner" | "loser" | "level";

interface FootState {
  readonly planted: THREE.Vector3;
  readonly from: THREE.Vector3;
  readonly to: THREE.Vector3;
  progress: number;
  stepping: boolean;
  duration: number;
}

interface Spring3 {
  readonly value: THREE.Vector3;
  readonly velocity: THREE.Vector3;
}

const springStep = (spring: Spring3, dt: number, stiffness: number, damping: number, limit: number): void => {
  const value = spring.value;
  const velocity = spring.velocity;
  velocity.addScaledVector(value, -stiffness * dt).multiplyScalar(Math.exp(-damping * dt));
  value.addScaledVector(velocity, dt);
  if (value.length() > limit) value.setLength(limit);
};

const PUNCH_CONTACT_OFFSET = 0.06;
/** Between these gaps (metres between the fighters' feet) the stance closes up for infighting. */
const CROWDED_GAP = 0.58;
const OPEN_GAP = 1;
const KNOCKDOWN_FALL_SECONDS = 0.75;
const GETUP_SECONDS = 1.7;
/** Hips of the authored lying poses (x for a fall to the fighter's left), which the get-up starts from. */
const FALLEN_SUPINE_HIPS = { x: 0.22, z: -0.4 } as const;
const FALLEN_PRONE_HIPS = { x: 0.12, z: 0.32 } as const;

const SIDE_FROM_HAND = (hand: Hand): "L" | "R" => (hand === "left" ? "L" : "R");

export class BoxingGraph {
  readonly boxer: SkinnedBoxer;
  private readonly solver: PoseSolver;
  private yaw = 0;
  private yawInitialized = false;
  private rootX: number | null = null;
  private rootZ = 0;
  private punchActive = false;
  private punchAgeTicks = 0;
  private punchTotalTicks = 1;
  private punchClass: PunchClass = "jab";
  private punchHand: Hand = "left";
  private punchTarget: Target = "head";
  private punchPower: Power = "normal";
  private punchTiming: PunchTiming = punchTiming("jab", "head", "normal");
  private actionId: string | null = null;
  private completedActionId: string | null = null;
  /** Id of the viewer's own punch while its animation is the one started on the key press. */
  private ownActionId: string | null = null;
  /** Ticks the key press led the server's presentation, absorbed by stretching the punch's startup. */
  private ownLeadTicks = 0;
  private ownAuthoritativeAge: number | null = null;
  /** Real ticks the own punch has waited for the server, and how long that is expected to take. */
  private ownWaitedTicks = 0;
  private ownExpectedTicks = 0;
  /** The server turned the punch down before it landed, so the glove is coming back the way it went. */
  private ownPulled = false;
  /** Own punches already played or cut short here; the server's copy of them is not played again. */
  private readonly retiredOwnIds: string[] = [];
  private anticipatedId: string | null = null;
  private hitstop = 0;
  private hitstopScale = 1;
  private downState: "up" | "falling" | "down" | "rising" = "up";
  private fallAge = 0;
  private riseAge = 0;
  private fallSide = 0;
  private fallProne = false;
  /** The knockdown was a body shot: the fighter goes to a knee instead of falling. */
  private fallKneel = false;
  /** Which side of the body took the shot that is putting him down: 1 his left, -1 his right. */
  private windedSide = -1;
  private windedTime = 0;
  private winded = 0;
  private readonly liveOpponentHead = new THREE.Vector3();
  private hasLiveHead = false;
  private readonly headKick: Spring3 = { value: new THREE.Vector3(), velocity: new THREE.Vector3() };
  private readonly torsoKick: Spring3 = { value: new THREE.Vector3(), velocity: new THREE.Vector3() };
  private readonly rootKick: Spring3 = { value: new THREE.Vector3(), velocity: new THREE.Vector3() };
  private guardKick = 0;
  private guardHigh = 0;
  private guardLow = 0;
  private slip = 0;
  private weave = 0;
  private weaveTime = 0;
  private pull = 0;
  private crouchExtra = 0;
  private bouncePhase = 0;
  private weightPhase = 0;
  private stunPhase = 0;
  private feintTimer = 2;
  private feint = 0;
  private stunAmount = 0;
  private tired = 0;
  private clinchWeight = 0;
  private foulWeight = 0;
  private tauntWeight = 0;
  private crowding = 0;
  private lastSpeed = 0;
  private readonly stool: { group: THREE.Group; dispose: () => void };
  private readonly enswell: { group: THREE.Group; dispose: () => void };
  private readonly bottle: { group: THREE.Group; dispose: () => void };
  private treatProp: CutmanProp = "enswell";
  private readonly treatTarget = new THREE.Vector3();
  private readonly treatScratch = new THREE.Vector3();
  private readonly treatFacing = new THREE.Vector3(0, 0, -1);
  private readonly treatFacingLocal = new THREE.Vector3();
  private treatSide = 1;
  private treating = false;
  private treatWeight = 0;
  private resting = false;
  private seated = 0;
  private stillTime = 0;
  private celebrateTime = 0;
  private celebration = 0;
  private waveTime = 0;
  private wave = 0;
  private breakTime = 0;
  private breakWeight = 0;
  private attending = false;
  /** Where the referee stands at the announcement (1 = on this fighter's left), or 0 outside it. */
  private verdictSide = 0;
  private verdict: Verdict | null = null;
  private squareWeight = 0;
  private raisedWeight = 0;
  private bowedWeight = 0;
  private readonly wrists: [THREE.Vector3 | null, THREE.Vector3 | null] = [null, null];
  private readonly wristTargets = [new THREE.Vector3(), new THREE.Vector3()] as const;
  private readonly wristWeights: [number, number] = [0, 0];
  private attendWeight = 0;
  private countdownTicks: number | null = null;
  private touchWeight = 0;
  /** Pose lab: keep the impact dent at full depth for review. */
  debugHoldImpact = false;
  private readonly feet: [FootState, FootState] = [
    { planted: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), progress: 1, stepping: false, duration: 0.2 },
    { planted: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), progress: 1, stepping: false, duration: 0.2 },
  ];
  private feetInitialized = false;
  private dislocation: ArcadeDislocation | null = null;
  private readonly scratch = new THREE.Vector3();
  private readonly scratchB = new THREE.Vector3();
  private readonly scratchC = new THREE.Vector3();
  private readonly scratchD = new THREE.Vector3();
  private readonly scratchE = new THREE.Vector3();
  private readonly clinchCentre = new THREE.Vector3();
  private readonly clinchForward = new THREE.Vector3();
  private readonly clinchTemp = new THREE.Vector3();
  private readonly scratchQ = new THREE.Quaternion();
  private readonly headWorld = new THREE.Vector3();
  private readonly hand = { L: this.makeHand(), R: this.makeHand() };
  private readonly foot = { L: this.makeFoot(), R: this.makeFoot() };
  private readonly torso = {
    hips: new THREE.Vector3(),
    hipsYaw: 0,
    hipsPitch: 0,
    hipsRoll: 0,
    shouldersYaw: 0,
    spinePitch: 0,
    spineRoll: 0,
    headYaw: 0,
    headPitch: 0,
    headRoll: 0,
    headOffset: new THREE.Vector3(),
  };
  private readonly pose: PoseDescription;

  private readonly referee: boolean;
  private refereeCount = 0;
  private refereeCounting = false;
  /** Knockout physics; officials have none. */
  private readonly ragdoll: KnockoutRagdoll | null;
  /** Knocked out on his feet (a flash knockout): down although the engine never counts him. */
  private forcedDown = false;
  /** The next fall is the animation's, not the physics' (a body shot that takes him to one knee). */
  private authoredNextFall = false;
  private obstacle: { x: number; z: number } | null = null;
  private blows = 0;
  /** Where the fall left the pelvis relative to the authored lying pose, in character space; the get-up starts there. */
  private readonly riseOffset = new THREE.Vector3();

  constructor(boxer: SkinnedBoxer, private readonly mapping: WorldMapping, options: { referee?: boolean } = {}) {
    this.boxer = boxer;
    this.referee = options.referee === true;
    this.solver = new PoseSolver(boxer.rig);
    this.pose = { torso: this.torso, handL: this.hand.L, handR: this.hand.R, footL: this.foot.L, footR: this.foot.R, shrugL: 0, shrugR: 0 };
    this.stool = buildStool();
    this.stool.group.position.set(0, 0, 0.02);
    boxer.root.add(this.stool.group);
    this.enswell = buildEnswell();
    boxer.rig.bones.gloveL.add(this.enswell.group);
    this.bottle = buildBottle();
    boxer.rig.bones.gloveL.add(this.bottle.group);
    this.ragdoll = this.referee ? null : new KnockoutRagdoll(boxer.rig, boxer.root);
  }

  /** The knockout replay runs the recorded fall again rather than a new one. */
  primeReplayFall(): void {
    this.ragdoll?.prime();
  }

  /** The next knockdown plays the animation rather than the physics: a body shot drops him to one knee. */
  useAuthoredFall(): void {
    this.authoredNextFall = true;
  }

  /** Puts the fighter down for a flash knockout, which the engine ends without a count. */
  knockOut(): void {
    this.forcedDown = true;
  }

  /** The standing opponent, whom a falling fighter does not fall through. */
  setObstacle(x: number, z: number): void {
    this.obstacle ??= { x, z };
    this.obstacle.x = x;
    this.obstacle.z = z;
  }

  /** The knockout physics while it drives this fighter, for the camera and the officials. */
  get fallBody(): KnockoutRagdoll | null {
    return this.ragdoll?.active === true ? this.ragdoll : null;
  }

  /** Between rounds the fighter walks to the corner, and once still, sits on the stool. */
  setResting(resting: boolean): void {
    this.resting = resting;
  }

  get stoolVisible(): boolean {
    return this.stool.group.visible;
  }

  /** Raises both gloves overhead for a stoppage win, then settles back to the guard. */
  celebrate(seconds = 4.4): void {
    this.celebrateTime = seconds;
  }

  /**
   * Drops every transient animation state (falls, reactions, celebrations,
   * smoothing) so the next update snaps to its snapshot; used around the
   * knockout replay. `downed` seeds the lying pose instead of standing.
   */
  resetTransient(downed = false): void {
    this.forcedDown = false;
    const ragdoll = this.ragdoll;
    if (ragdoll !== null) {
      if (!downed) {
        ragdoll.stop();
        ragdoll.clearRise();
      } else if (ragdoll.active) {
        ragdoll.settle();
      } else {
        ragdoll.restoreSettled();
      }
    }
    this.downState = downed ? "down" : "up";
    this.fallAge = downed ? KNOCKDOWN_FALL_SECONDS : 0;
    this.riseAge = 0;
    this.hitstop = 0;
    this.hitstopScale = 1;
    for (const spring of [this.headKick, this.torsoKick, this.rootKick]) {
      spring.value.set(0, 0, 0);
      spring.velocity.set(0, 0, 0);
    }
    this.guardKick = 0;
    this.stunAmount = 0;
    this.windedTime = 0;
    this.winded = 0;
    this.celebrateTime = 0;
    this.celebration = 0;
    this.waveTime = 0;
    this.wave = 0;
    this.verdictSide = 0;
    this.verdict = null;
    this.squareWeight = 0;
    this.raisedWeight = 0;
    this.bowedWeight = 0;
    this.wrists.fill(null);
    this.wristWeights.fill(0);
    this.seated = 0;
    this.stillTime = 0;
    this.rootX = null;
    this.yawInitialized = false;
    this.feetInitialized = false;
    this.retirePunch();
    this.completedActionId = null;
    this.retiredOwnIds.length = 0;
    this.anticipatedId = null;
  }

  /** Referee wave-off: both arms sweep crossing overhead to call the fight. */
  waveOff(seconds = 2.6): void {
    this.waveTime = seconds;
  }

  /** Ticks left in the opening countdown, or null outside it; drives the glove touch before the bell. */
  setCountdown(ticksRemaining: number | null): void {
    this.countdownTicks = ticksRemaining;
  }

  /** Cornerman: lean in over the top rope and work on the seated fighter while attending. */
  attend(active: boolean): void {
    this.attending = active;
  }

  /**
   * Cutman: crouch by a seated fighter and press the enswell on the eye at `eye` (world). `facing` is
   * the direction the fighter's face points and `side` is 1 when the eye is the fighter's left.
   */
  treat(eye: THREE.Vector3 | null, facing?: THREE.Vector3, side = 1, prop: CutmanProp = "enswell"): void {
    this.treating = eye !== null;
    if (eye === null) return;
    this.treatTarget.copy(eye);
    if (facing !== undefined) this.treatFacing.copy(facing);
    this.treatSide = side;
    this.treatProp = prop;
  }

  /**
   * The announcement of a decision. The fighter stands square to the camera beside the referee, who
   * is on the side given (1 = the fighter's left); null ends it.
   */
  awaitVerdict(side: 1 | -1 | null): void {
    this.verdictSide = side ?? 0;
    if (side === null) this.verdict = null;
  }

  /** The winner's arm on the referee's side goes up, as do both fighters' after a draw; the loser's head goes down. */
  announce(verdict: Verdict): void {
    this.verdict = verdict;
  }

  /** Referee: hold up the wrists at these world positions, one to each side; null lets that arm down. */
  raise(left: THREE.Vector3 | null, right: THREE.Vector3 | null): void {
    this.wrists[0] = left === null ? null : this.wristTargets[0].copy(left);
    this.wrists[1] = right === null ? null : this.wristTargets[1].copy(right);
  }

  /** Referee break: both arms push out and apart at chest height to separate a clinch. */
  breakClinch(seconds = 1.3): void {
    this.breakTime = seconds;
  }

  private makeHand(): { position: THREE.Vector3; knuckles: THREE.Vector3; palm: THREE.Vector3; pole: THREE.Vector3 } {
    return { position: new THREE.Vector3(), knuckles: new THREE.Vector3(0, 1, 0), palm: new THREE.Vector3(0, 0, 1), pole: new THREE.Vector3(0, -1, 0) };
  }

  private makeFoot(): { position: THREE.Vector3; toe: THREE.Vector3; heel: number; pole: THREE.Vector3 } {
    return { position: new THREE.Vector3(), toe: new THREE.Vector3(0, 0, 1), heel: 0, pole: new THREE.Vector3(0, 0, 1) };
  }

  get currentRoot(): { x: number; z: number } {
    return { x: this.rootX ?? 0, z: this.rootZ };
  }

  get isDown(): boolean {
    return this.downState !== "up";
  }

  setRefereeCount(counting: boolean, count: number): void {
    this.refereeCounting = counting;
    this.refereeCount = count;
  }

  /**
   * Starts the viewer's own punch on the key press. `leadTicks` estimates how far ahead of the
   * server's presentation that is (input latency plus the interpolation delay); the startup is
   * stretched by it so the glove arrives when the hit is shown, and the punch is never pulled back.
   */
  predict(action: SemanticAction, timeSeconds: number, tickRate: number, leadTicks = 0, expected?: PunchTiming): void {
    if (action.kind !== "punch" || action.id === undefined) return;
    void timeSeconds;
    void tickRate;
    // Mid-punch the server queues the press, so it plays on the server's timeline. Late in the
    // recovery the follow-up cuts in at once.
    const remaining = this.punchActive ? this.punchTotalTicks - this.punchAgeTicks : 0;
    if (this.punchActive && this.punchAgeTicks / this.punchTotalTicks <= 0.55) return;
    const timing = expected ?? punchTiming(action.class, action.target, action.power);
    this.startEarly(action.id, action.class, action.hand, action.target, action.power, timing, leadTicks, Math.max(0, leadTicks) + remaining);
  }

  /**
   * Starts a punch the server has begun but the delayed render clock has not reached, so an
   * opponent's punch is seen as early as the network allows. `leadTicks` is how long the render
   * clock will take to reach the punch's first tick. The wind-up is stretched over that wait, so
   * a punch too far ahead is held back until it can be shown at half speed or faster.
   */
  anticipate(fighter: FighterSnapshot, leadTicks: number): void {
    const id = fighter.action_id;
    if (id === null || fighter.action === null || leadTicks <= 0) return;
    if (id === this.anticipatedId || id === this.actionId || id === this.completedActionId || id === this.ownActionId || this.retiredOwnIds.includes(id)) return;
    if (leadTicks > fighter.action_startup_ticks * (1 / MIN_ANTICIPATION_RATE - 1)) return;
    if (this.punchActive && this.punchAgeTicks / this.punchTotalTicks <= 0.55) return;
    this.anticipatedId = id;
    const target = fighter.action_target ?? "head";
    const power = fighter.action_power ?? "normal";
    const timing = {
      ...punchTiming(fighter.action, target, power),
      startup: fighter.action_startup_ticks,
      active: fighter.action_active_ticks,
      recovery: fighter.action_recovery_ticks,
    };
    const hand = fighter.action_hand ?? (fighter.stance === "orthodox" ? "left" : "right");
    this.startEarly(id, fighter.action, hand, target, power, timing, leadTicks, leadTicks);
  }

  private startEarly(id: string, punchClass: PunchClass, hand: Hand, target: Target, power: Power, timing: PunchTiming, leadTicks: number, expectedTicks: number): void {
    this.retirePunch();
    this.punchClass = punchClass;
    this.punchHand = hand;
    this.punchTarget = target;
    this.punchPower = power;
    this.punchTiming = timing;
    this.punchTotalTicks = Math.max(1, totalTicks(timing));
    this.punchAgeTicks = 0;
    this.punchActive = true;
    this.ownActionId = id;
    this.ownLeadTicks = clamp(leadTicks, 0, MAX_OWN_LEAD_TICKS);
    this.ownExpectedTicks = expectedTicks;
  }

  /** True while the viewer's own punch, started on the key press, is playing. */
  get ownPunchActive(): boolean {
    return this.punchActive && this.ownActionId !== null;
  }

  /** Marks the punch being played as done so neither copy of it is started again. */
  private retirePunch(): void {
    if (this.actionId !== null) this.completedActionId = this.actionId;
    if (this.ownActionId !== null) {
      this.retiredOwnIds.push(this.ownActionId);
      if (this.retiredOwnIds.length > 6) this.retiredOwnIds.shift();
    }
    this.actionId = null;
    this.punchActive = false;
    this.ownActionId = null;
    this.ownLeadTicks = 0;
    this.ownAuthoritativeAge = null;
    this.ownWaitedTicks = 0;
    this.ownExpectedTicks = 0;
    this.ownPulled = false;
  }

  landedHit(blocked: boolean): void {
    this.hitstop = Math.max(this.hitstop, blocked ? 0.045 : 0.078);
  }

  setArcadeDislocation(dislocation: ArcadeDislocation | null): void {
    this.dislocation = dislocation;
    this.boxer.headInjury.setJaw(dislocation === "jaw" ? 1 : 0);
  }

  /**
   * Contact-synchronised reaction. `punchClass`/`hand` describe the incoming
   * punch so the head snaps along the real impact line; `direction` is the
   * legacy world-x sign used when the class is unknown.
   */
  react(kind: ReactionKind, target: Target = "head", direction = 1, punchClass: PunchClass | null = null, hand: Hand | null = null, amount = 200): void {
    const scale = clamp(0.55 + amount / 320, 0.55, 1.6) * (kind === "block" ? 0.35 : 1);
    const lateral = hand === "left" ? 1 : hand === "right" ? -1 : direction >= 0 ? -1 : 1;
    if (target === "body") {
      this.torsoKick.velocity.x += 4.6 * scale;
      this.rootKick.velocity.z -= 0.45 * scale;
      this.headKick.velocity.z -= 0.6 * scale;
      this.headKick.velocity.y -= 0.7 * scale;
      this.guardKick = Math.max(this.guardKick, 0.6 * scale);
    } else {
      if (kind === "hit") this.guardKick = Math.max(this.guardKick, 0.4 * scale);
      switch (punchClass) {
        case "hook":
          this.headKick.velocity.x += 2.6 * scale * lateral;
          this.headKick.velocity.z -= 0.7 * scale;
          this.torsoKick.velocity.z += 0.9 * scale * lateral;
          break;
        case "uppercut":
          this.headKick.velocity.y += 2.2 * scale;
          this.headKick.velocity.z -= 1.2 * scale;
          this.torsoKick.velocity.x -= 1.2 * scale;
          break;
        case "straight":
          this.headKick.velocity.z -= 2.4 * scale;
          this.torsoKick.velocity.x -= 0.6 * scale;
          break;
        default:
          this.headKick.velocity.z -= 1.5 * scale;
          this.torsoKick.velocity.x -= 0.35 * scale;
          break;
      }
      this.rootKick.velocity.z -= 0.45 * scale;
      if (kind === "block") this.guardKick = Math.max(this.guardKick, 0.9 * scale);
    }
    if (kind === "hit") this.dentSurface(target, lateral, punchClass, amount);
    if (kind === "hit" && target === "head" && amount > 250) {
      this.fallSide = lateral;
      this.fallProne = punchClass === "hook";
    }
    // The knockdown itself is presented as a hit too, carrying the count rather than the damage.
    if (kind === "hit" && amount >= 10 && this.ragdoll !== null) {
      const blow = blowImpulse({ target, punchClass, hand, lateral, amount });
      const snap = this.scratchE.set(blow.x, blow.y, blow.z).applyAxisAngle(worldUpVector, this.yaw);
      const drive = this.scratchD.set(blow.driveX, blow.driveY, blow.driveZ).applyAxisAngle(worldUpVector, this.yaw);
      this.blows += 1;
      this.ragdoll.takeBlow(snap, drive, target, blow.twist, fallStyleFor(punchClass, target, amount, this.blows + Math.round(amount)));
    }
  }

  /** The puncher's power shot was parried: he is knocked back off balance with his hands thrown wide. */
  stagger(): void {
    this.torsoKick.velocity.x -= 2.6;
    this.headKick.velocity.z -= 1.4;
    this.headKick.velocity.y += 0.5;
    this.rootKick.velocity.z -= 1.1;
    this.guardKick = Math.max(this.guardKick, 1.1);
  }

  /** A body shot that is going to put him down: he freezes, folds over the shot and clutches it. `side` is 1 for his left. */
  windedFor(seconds: number, side: number): void {
    this.windedTime = Math.max(this.windedTime, seconds);
    this.windedSide = side >= 0 ? 1 : -1;
  }

  /** Sets how the next knockdown looks: to a knee after a body shot, otherwise a fall. */
  fallToKnee(knee: boolean): void {
    this.fallKneel = knee;
    // Taking a knee is played by the animation, never by the knockout physics.
    if (knee) this.authoredNextFall = true;
  }

  /** Transient compression of the struck surface at contact; the injury shading releases it. */
  private dentSurface(target: Target, lateral: number, punchClass: PunchClass | null, amount: number): void {
    const depth = THREE.MathUtils.clamp(1.1 + amount / 220, 1.1, 3.2);
    if (target === "body") {
      const site = punchClass === "hook" ? (lateral > 0 ? "rightRibs" : "leftRibs") : "solarPlexus";
      this.boxer.bodyInjury.impact(site, [punchClass === "hook" ? lateral * depth * 0.8 : 0, 0, -depth], 9);
      return;
    }
    if (punchClass === "hook") this.boxer.headInjury.impact(lateral > 0 ? "rightCheek" : "leftCheek", [lateral * depth, 0, -depth * 0.35], 5.5);
    else if (punchClass === "uppercut") this.boxer.headInjury.impact("chin", [0, depth * 0.7, -depth * 0.6], 5);
    else this.boxer.headInjury.impact(punchClass === "jab" ? "nose" : "mouth", [0, 0, -depth], 4.5);
  }

  private stepFeet(dt: number, mirror: number, speed: number, velocityWorld: THREE.Vector3, rootPosition: THREE.Vector3, yaw: number): void {
    const desired = this.scratch;
    const rotate = this.scratchQ.setFromAxisAngle(worldUpVector, yaw);
    for (const [index, foot] of this.feet.entries()) {
      const isLead = (index === 0) === (mirror > 0);
      const offset = isLead ? STANCE.leadFoot : STANCE.rearFoot;
      if (this.referee || this.squareWeight > 0.5) desired.set((index === 0 ? 0.16 : -0.16), 0, index === 0 ? 0.02 : -0.02).applyQuaternion(rotate).add(rootPosition);
      else desired.set(offset.x * mirror, 0, offset.z).applyQuaternion(rotate).add(rootPosition);
      desired.y = 0;
      if (!this.feetInitialized) {
        foot.planted.copy(desired);
        foot.progress = 1;
        foot.stepping = false;
        continue;
      }
      if (foot.stepping) {
        foot.progress = Math.min(1, foot.progress + dt / foot.duration);
        if (foot.progress >= 1) {
          foot.stepping = false;
          foot.planted.copy(foot.to);
        }
        continue;
      }
      const other = this.feet[1 - index]!;
      const drift = foot.planted.distanceTo(desired);
      const threshold = speed > 0.05 ? 0.09 : 0.14;
      if (drift > threshold && !other.stepping) {
        foot.stepping = true;
        foot.progress = 0;
        foot.duration = clamp(0.24 - speed * 0.07, 0.15, 0.24);
        foot.from.copy(foot.planted);
        foot.to.copy(desired).addScaledVector(velocityWorld, foot.duration * 0.6);
        foot.to.y = 0;
      }
    }
    this.feetInitialized = true;
  }

  private footWorld(index: 0 | 1, out: THREE.Vector3): { lift: number } {
    const foot = this.feet[index];
    if (!foot.stepping) {
      out.copy(foot.planted);
      return { lift: 0 };
    }
    const t = easeOut(foot.progress, 1.6);
    out.copy(foot.from).lerp(foot.to, t);
    return { lift: Math.sin(foot.progress * Math.PI) * 0.055 };
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
    const motionScale = reducedMotion ? 0.35 : 1;

    const worldX = this.mapping.x(fighter.x);
    const worldZ = this.mapping.z(fighter.y);
    if (this.rootX === null) {
      this.rootX = worldX;
      this.rootZ = worldZ;
    }
    const maxStep = ROOT_FOLLOW_SPEED * Math.max(dt, 1 / 60);
    this.rootX += clamp(worldX - this.rootX, -maxStep, maxStep);
    this.rootZ += clamp(worldZ - this.rootZ, -maxStep, maxStep);
    const targetYaw = Math.atan2(fighter.facing_x, -fighter.facing_y);
    if (!this.yawInitialized) {
      this.yaw = targetYaw;
      this.yawInitialized = true;
    }
    const turnRate = this.punchActive ? 3 : 9;
    this.yaw = smoothAngle(this.yaw, targetYaw, turnRate, dt);
    boxer.root.position.set(this.rootX, 0, this.rootZ);
    boxer.root.rotation.set(0, this.yaw, 0);

    this.hitstop = Math.max(0, this.hitstop - dt);
    this.hitstopScale = this.hitstop > 0 ? 0.12 : 1;
    const simDt = dt * this.hitstopScale;

    this.syncAction(fighter, sampledTick, simDt);
    if (!this.debugHoldImpact) {
      this.boxer.headInjury.update(simDt);
      this.boxer.bodyInjury.update(simDt);
    }

    if (opponentHeadWorld !== undefined) {
      this.liveOpponentHead.copy(opponentHeadWorld);
      this.hasLiveHead = true;
    }

    const velocityWorld = this.scratchB.set(this.mapping.x(fighter.velocity_x) * 30, 0, this.mapping.z(fighter.velocity_y) * 30);
    const speed = velocityWorld.length();
    this.lastSpeed = speed;
    this.stillTime = speed < 0.03 ? this.stillTime + dt : 0;
    const wantSeated = this.resting && this.stillTime > 0.2 && this.downState === "up";
    this.seated = smooth(this.seated, wantSeated ? 1 : 0, wantSeated ? 2.2 : 4, dt);
    this.stool.group.visible = this.resting && this.stillTime > 0.05 && this.downState === "up";
    this.celebrateTime = Math.max(0, this.celebrateTime - dt);
    this.celebration = smooth(this.celebration, this.celebrateTime > 0 && this.downState === "up" ? 1 : 0, 3.5, dt);
    this.waveTime = Math.max(0, this.waveTime - dt);
    this.wave = smooth(this.wave, this.waveTime > 0 && this.downState === "up" ? 1 : 0, 4, dt);
    this.breakTime = Math.max(0, this.breakTime - dt);
    this.breakWeight = smooth(this.breakWeight, this.breakTime > 0 && this.downState === "up" ? 1 : 0, 6, dt);
    this.attendWeight = smooth(this.attendWeight, this.attending ? 1 : 0, 2.5, dt);
    this.squareWeight = smooth(this.squareWeight, this.verdictSide !== 0 ? 1 : 0, 3, dt);
    this.raisedWeight = smooth(this.raisedWeight, this.verdictSide !== 0 && (this.verdict === "winner" || this.verdict === "level") ? 1 : 0, 3.2, dt);
    this.bowedWeight = smooth(this.bowedWeight, this.verdictSide !== 0 && this.verdict === "loser" ? 1 : 0, 2.2, dt);
    for (const index of [0, 1] as const) this.wristWeights[index] = smooth(this.wristWeights[index], this.wrists[index] !== null ? 1 : 0, 3.2, dt);
    this.treatWeight = smooth(this.treatWeight, this.treating ? 1 : 0, 3, dt);
    this.windedTime = Math.max(0, this.windedTime - dt);
    // Folded over the body shot until he is down on the knee, so the fall starts from the hunch.
    const sinking = this.fallKneel && this.downState === "falling";
    this.winded = smooth(this.winded, (this.windedTime > 0 && this.downState === "up") || sinking ? 1 : 0, this.windedTime > 0 || sinking ? 12 : 4, dt);
    this.enswell.group.visible = this.treatWeight > 0.4 && this.treatProp === "enswell";
    this.bottle.group.visible = this.treatWeight > 0.4 && this.treatProp === "bottle";
    const touching = this.countdownTicks !== null && this.countdownTicks <= TOUCH_GLOVES_START_TICKS && this.countdownTicks >= TOUCH_GLOVES_END_TICKS;
    this.touchWeight = smooth(this.touchWeight, touching ? 1 : 0, 6, dt);
    const stamina = fighter.stamina / Math.max(1, fighter.maximum_stamina);
    this.tired = smooth(this.tired, clamp((0.55 - stamina) / 0.5, 0, 1), 2, dt);
    this.stunAmount = smooth(this.stunAmount, Math.min(1, fighter.stunned_ticks / 24), 8, dt);
    const defending = fighter.defense;
    this.guardHigh = smooth(this.guardHigh, defending === "guard_high" ? 1 : 0, 14, dt);
    this.guardLow = smooth(this.guardLow, defending === "guard_low" ? 1 : 0, 14, dt);
    const slipTarget = defending === "slip_left" ? 1 : defending === "slip_right" ? -1 : 0;
    this.slip = smooth(this.slip, slipTarget, 16, dt);
    const weaving = defending === "weave";
    this.weaveTime = weaving ? this.weaveTime + dt : 0;
    this.weave = smooth(this.weave, weaving ? 1 : 0, 14, dt);
    this.pull = smooth(this.pull, defending === "pull" ? 1 : 0, 14, dt);
    this.clinchWeight = smooth(this.clinchWeight, fighter.clinch_ticks > 0 || fighter.clinch_startup_ticks > 0 ? 1 : 0, 10, dt);
    this.foulWeight = smooth(this.foulWeight, fighter.is_foul_recovery_target ? 1 : 0, 8, dt);
    this.tauntWeight = smooth(this.tauntWeight, fighter.taunt_ticks > 0 ? 1 : 0, 10, dt);
    const gap = Math.hypot(this.mapping.x(opponent.x) - this.mapping.x(fighter.x), this.mapping.z(opponent.y) - this.mapping.z(fighter.y));
    const crowded = this.referee || fighter.is_downed || opponent.is_downed ? 0 : 1 - smoothstep(CROWDED_GAP, OPEN_GAP, gap);
    this.crowding = smooth(this.crowding, crowded, 9, dt);

    springStep(this.headKick, dt, 190, 7.5, 0.24);
    springStep(this.torsoKick, dt, 150, 7, 0.7);
    springStep(this.rootKick, dt, 120, 8, 0.12);
    this.guardKick = Math.max(0, this.guardKick - dt * 2.4);

    this.ragdoll?.tick(dt);
    this.updateDownState(fighter, dt, reducedMotion);

    const bounceTempo = (1.9 - this.tired * 0.7) * (1 - this.stunAmount * 0.6);
    this.bouncePhase += dt * bounceTempo * Math.PI * 2 * motionScale;
    this.weightPhase += dt * 0.55 * Math.PI * 2 * motionScale;
    this.stunPhase += dt * 5.5;
    this.feintTimer -= dt;
    if (this.feintTimer <= 0 && !this.punchActive && speed < 0.05 && this.downState === "up") {
      this.feintTimer = 2.5 + (this.bouncePhase % 1.7);
      this.feint = 1;
    }
    this.feint = Math.max(0, this.feint - dt * 3.5);

    // Feet.
    const rootPosition = this.scratchC.set(this.rootX, 0, this.rootZ);
    if (this.downState === "up") this.stepFeet(dt, mirror, speed, velocityWorld, rootPosition, this.yaw);
    const rootQuatInverse = this.scratchQ.setFromAxisAngle(worldUpVector, -this.yaw);
    const lead = mirror > 0 ? this.foot.L : this.foot.R;
    const rear = mirror > 0 ? this.foot.R : this.foot.L;
    const leadIndex: 0 | 1 = mirror > 0 ? 0 : 1;
    const rearIndex: 0 | 1 = mirror > 0 ? 1 : 0;
    const leadLift = this.footWorld(leadIndex, lead.position).lift;
    const rearLift = this.footWorld(rearIndex, rear.position).lift;
    lead.position.sub(rootPosition).applyQuaternion(rootQuatInverse);
    rear.position.sub(rootPosition).applyQuaternion(rootQuatInverse);
    const ankleRest = this.boxer.rig.metrics.ankleHeight;
    lead.position.y = ankleRest + leadLift;
    rear.position.y = ankleRest + rearLift;
    mirrorX(STANCE.leadToe, mirror, lead.toe);
    mirrorX(STANCE.rearToe, mirror, rear.toe);
    lead.heel = 0;
    rear.heel = 0;
    lead.pole.copy(lead.toe).setY(0.35).normalize();
    rear.pole.copy(rear.toe).setY(0.35).normalize();

    // Torso baseline.
    const torso = this.torso;
    const blade = STANCE.bladeYaw * mirror;
    const bounce = Math.sin(this.bouncePhase) * 0.012 * (1 - this.stunAmount) * (speed > 0.6 ? 0.6 : 1);
    const sway = Math.sin(this.weightPhase) * 0.02;
    let crouch = 0.012 + this.tired * 0.03 + this.stunAmount * 0.05;
    torso.hips.set(sway * mirror + Math.sin(this.stunPhase * 0.9) * 0.05 * this.stunAmount, STANCE.hipsHeight - crouch + bounce, 0.0);
    torso.hipsYaw = blade;
    torso.hipsPitch = 0.02 + this.tired * 0.08;
    torso.hipsRoll = Math.sin(this.stunPhase) * 0.09 * this.stunAmount;
    torso.shouldersYaw = blade * 0.88;
    torso.spinePitch = 0.16 + this.tired * 0.16 + Math.sin(time * (2.1 + this.tired * 1.8)) * 0.012;
    torso.spineRoll = Math.sin(this.stunPhase * 1.3) * 0.06 * this.stunAmount;
    torso.headYaw = -0.12 * mirror + Math.sin(time * 0.9) * 0.05 + Math.sin(this.stunPhase * 0.7) * 0.25 * this.stunAmount;
    torso.headPitch = 0.12 + Math.sin(time * 1.7) * 0.02 + this.stunAmount * 0.18;
    torso.headRoll = Math.sin(this.stunPhase * 1.1) * 0.14 * this.stunAmount;
    torso.headOffset.set(0, 0, 0);

    // Hands: guard baseline with feints, fatigue, stun.
    const leadHand = mirror > 0 ? this.hand.L : this.hand.R;
    const rearHand = mirror > 0 ? this.hand.R : this.hand.L;
    const headRest = this.headRestChar(mirror);
    const guardBlend = clamp(this.guardHigh + this.guardLow, 0, 1);
    const leadTarget = this.scratch.copy(STANCE.relaxedLead).lerp(STANCE.guardHighLead, this.guardHigh).lerp(STANCE.guardLowLead, this.guardLow);
    const rearTarget = this.scratchB.copy(STANCE.relaxedRear).lerp(STANCE.guardHighRear, this.guardHigh).lerp(STANCE.guardLowRear, this.guardLow);
    leadTarget.y -= this.tired * 0.12 + this.stunAmount * 0.22;
    rearTarget.y -= this.tired * 0.1 + this.stunAmount * 0.2;
    leadTarget.z += this.feint * 0.1 + Math.sin(time * 2.3) * 0.012 * motionScale;
    leadTarget.x += Math.sin(time * 1.9) * 0.01 * motionScale;
    rearTarget.y += Math.cos(time * 2.7) * 0.01 * motionScale;
    leadTarget.z -= this.guardKick * 0.07;
    rearTarget.z -= this.guardKick * 0.05;
    leadTarget.y -= this.guardKick * 0.02;
    leadTarget.add(headRest);
    rearTarget.add(headRest);
    leadHand.position.set(leadTarget.x * mirror, leadTarget.y, leadTarget.z);
    rearHand.position.set(rearTarget.x * mirror, rearTarget.y, rearTarget.z);
    mirrorX(STANCE.leadKnuckles, mirror, leadHand.knuckles);
    mirrorX(STANCE.leadPalm, mirror, leadHand.palm);
    mirrorX(STANCE.rearKnuckles, mirror, rearHand.knuckles);
    mirrorX(STANCE.rearPalm, mirror, rearHand.palm);
    mirrorX(STANCE.leadPole, mirror, leadHand.pole);
    mirrorX(STANCE.rearPole, mirror, rearHand.pole);
    let shrugLead = 0.15 * guardBlend;
    let shrugRear = 0.25 * guardBlend;

    // Defensive body movement.
    if (Math.abs(this.slip) > 0.001) {
      const s = this.slip;
      torso.headOffset.x += s * 0.13;
      torso.spineRoll += -s * 0.28;
      torso.hips.x += s * 0.03;
      torso.hips.y -= Math.abs(s) * 0.05;
      torso.spinePitch += Math.abs(s) * 0.12;
      torso.headRoll += -s * 0.2;
    }
    if (this.weave > 0.001) {
      const w = this.weave;
      const phase = clamp(this.weaveTime / 0.42, 0, 1);
      const arc = Math.sin(phase * Math.PI);
      torso.hips.y -= w * 0.2;
      torso.spinePitch += w * 0.42;
      torso.headOffset.x += w * (1 - 2 * phase) * 0.16 * mirror;
      torso.headOffset.y -= w * arc * 0.08;
      torso.spineRoll += w * (1 - 2 * phase) * 0.18 * mirror;
      leadHand.position.y -= w * 0.1;
      rearHand.position.y -= w * 0.1;
    }
    if (this.pull > 0.001) {
      const p = this.pull;
      torso.spinePitch -= p * 0.34;
      torso.hips.z -= p * 0.11;
      torso.hips.x -= p * 0.05 * mirror;
      torso.headOffset.z -= p * 0.06;
      torso.headPitch -= p * 0.1;
    }

    // Inside, the fighter stands taller with the guard tucked in and the head off the centre line,
    // so two fighters chest to chest do not pass through each other.
    const inside = this.crowding * (1 - this.clinchWeight);
    if (inside > 0.001) {
      torso.headOffset.x -= inside * 0.075;
      torso.headOffset.z -= inside * 0.05;
      torso.headYaw -= inside * 0.2;
      torso.spinePitch -= inside * 0.07;
      torso.hips.z -= inside * 0.05;
      leadHand.position.z -= inside * 0.14;
      leadHand.position.x -= inside * 0.035 * mirror;
      rearHand.position.z -= inside * 0.07;
    }

    // Reactions.
    torso.headOffset.add(this.headKick.value);
    torso.headPitch += -this.headKick.value.z * 2.4 + this.headKick.value.y * 1.6;
    torso.headYaw += this.headKick.value.x * 2.2;
    torso.headRoll += -this.headKick.value.x * 0.9;
    torso.spinePitch += this.torsoKick.value.x;
    torso.spineRoll += this.torsoKick.value.z * 0.5;
    torso.hips.z += this.rootKick.value.z;
    torso.hips.y -= Math.max(0, this.torsoKick.value.x) * 0.08;
    if (this.torsoKick.value.x > 0.05) {
      leadHand.position.y -= this.torsoKick.value.x * 0.25;
      rearHand.position.y -= this.torsoKick.value.x * 0.2;
      leadHand.position.z -= this.torsoKick.value.x * 0.1;
    }

    // Punch.
    if (this.punchActive) {
      shrugLead = 0;
      shrugRear = 0;
      const shrug = this.applyPunch(mirror, leadHand, rearHand, lead, rear, headRest);
      if ((this.punchHand === "left") === (mirror > 0)) shrugLead = shrug;
      else shrugRear = shrug;
    }

    if (this.referee) this.applyRefereePose(mirror, leadHand, rearHand, lead, rear, headRest, time);

    // Special states.
    if (this.clinchWeight > 0.001) this.applyClinchPose(this.clinchWeight, time, mirror, fighter, opponent, leadHand, rearHand, headRest);
    if (this.foulWeight > 0.001) {
      const f = this.foulWeight;
      torso.hips.y -= f * 0.16;
      torso.spinePitch += f * 0.55;
      torso.headPitch += f * 0.2;
      leadHand.position.lerp(this.scratch.set(0.06 * mirror, 0.72, 0.16), f);
      rearHand.position.lerp(this.scratch.set(-0.05 * mirror, 0.7, 0.14), f);
      leadHand.pole.set(0.6 * mirror, -0.6, 0.5);
      rearHand.pole.set(-0.6 * mirror, -0.6, 0.5);
    }
    if (this.tauntWeight > 0.001) this.applyTauntPose(this.tauntWeight, ((60 - fighter.taunt_ticks) / 60) * 4, mirror, leadHand, rearHand, headRest);

    // Exhaustion and stun on guard.
    if (this.dislocation === "shoulder_left" || this.dislocation === "shoulder_right") {
      const hand = this.dislocation === "shoulder_left" ? this.hand.L : this.hand.R;
      const side = this.dislocation === "shoulder_left" ? 1 : -1;
      hand.position.set(0.24 * side, 0.55, 0.05);
      hand.pole.set(0.9 * side, -0.3, 0.2);
      hand.knuckles.set(0, -1, 0.1);
      hand.palm.set(-side, 0, 0.2);
    }

    if (this.winded > 0.001 && (this.downState === "up" || sinking)) this.applyWindedPose(this.winded, time, mirror, leadHand, rearHand);

    // Knockdown overrides everything above.
    if (this.touchWeight > 0.001 && this.downState === "up") this.applyTouchGlovesPose(this.touchWeight, mirror, leadHand, rearHand);
    if (this.celebration > 0.001 && this.downState === "up") this.applyCelebratePose(this.celebration, time, mirror, leadHand, rearHand, lead, rear);
    if (this.wave > 0.001 && this.downState === "up") this.applyWaveOffPose(this.wave, time, mirror, leadHand, rearHand);
    if (this.squareWeight > 0.001 && this.downState === "up") this.applyVerdictPose(this.squareWeight, time, mirror, leadHand, rearHand, lead, rear, headRest);
    if ((this.wristWeights[0] > 0.001 || this.wristWeights[1] > 0.001) && this.downState === "up") this.applyRaisePose(mirror, leadHand, rearHand);
    if (this.breakWeight > 0.001 && this.downState === "up") this.applyBreakPose(this.breakWeight, mirror, leadHand, rearHand);
    if (this.attendWeight > 0.001 && this.downState === "up") this.applyAttendPose(this.attendWeight, time, mirror, leadHand, rearHand);
    if (this.treatWeight > 0.001 && this.downState === "up") this.applyTreatPose(this.treatWeight, time, mirror, leadHand, rearHand, lead, rear);
    if (this.seated > 0.001 && this.downState === "up") this.applySeatedPose(this.seated, time, mirror, leadHand, rearHand, lead, rear);
    if (this.downState !== "up") this.applyDownPose(mirror, leadHand, rearHand, lead, rear, headRest);

    crouch = 0;
    void crouch;
    const pose = this.pose as { shrugL: number; shrugR: number };
    pose.shrugL = mirror > 0 ? shrugLead : shrugRear;
    pose.shrugR = mirror > 0 ? shrugRear : shrugLead;
    const ragdoll = this.ragdoll;
    if (ragdoll?.active === true && reducedMotion) {
      ragdoll.stop();
      ragdoll.clearRise();
    }
    if (ragdoll?.active === true) {
      ragdoll.setLost(boxer.isDecapitated, boxer.isHandDismembered("left"), boxer.isHandDismembered("right"));
      ragdoll.update(dt, this.obstacle);
    } else {
      this.solver.apply(boxer.root, this.pose);
      if (ragdoll !== null && this.downState === "rising" && ragdoll.hasRisePose) {
        ragdoll.blendRise(smoothstep(0, 0.3, this.riseAge / GETUP_SECONDS));
      }
      ragdoll?.sample(dt);
    }
    this.applyDislocation();

    const opponentBlood = Math.min(
      1,
      (opponent.trauma.bleeding + opponent.trauma.left_cut + opponent.trauma.right_cut) / 620
        * (blood === "off" ? 0 : blood === "reduced" ? 0.3 : 1.5),
    );
    boxer.setGloveBlood(opponentBlood);
    boxer.setTrunksBlood(trunksBloodFor(fighter.trauma, blood));
    applyHeadTrauma(boxer.headInjury, fighter.trauma, blood);
    applyBodyTrauma(boxer.bodyInjury, fighter.trauma, blood);
    boxer.setSkinClearcoat(0.25 + (1 - stamina) * 0.4);
  }

  /**
   * Showboat: the rear glove drops to the hip with the chest out and chin up
   * while the lead glove beckons the opponent in, palm up, twice per taunt.
   */
  private applyTauntPose(t: number, beat: number, mirror: number, leadHand: HandTarget, rearHand: HandTarget, headRest: THREE.Vector3): void {
    const torso = this.torso;
    const curl = 0.5 - 0.5 * Math.cos(beat * Math.PI * 2);
    rearHand.position.lerp(this.scratch.set(-0.3 * mirror, headRest.y - 0.62, 0.02), t);
    rearHand.pole.lerp(this.scratch.set(-0.5 * mirror, -0.4, -0.75), t).normalize();
    rearHand.knuckles.lerp(this.scratch.set(-0.1 * mirror, -0.95, 0.3), t).normalize();
    rearHand.palm.lerp(this.scratch.set(0, 0.3, 0.95), t).normalize();
    leadHand.position.lerp(this.scratch.set(0.26 * mirror, headRest.y - 0.36 + curl * 0.1, 0.52 - curl * 0.24), t);
    leadHand.pole.lerp(this.scratch.set(0.7 * mirror, -0.7, 0.1), t).normalize();
    leadHand.knuckles.lerp(this.scratch.set(0.1 * mirror, 0.25 + curl * 0.6, 0.95 - curl * 0.7), t).normalize();
    leadHand.palm.lerp(this.scratch.set(-0.2 * mirror, 0.95, -0.2 - curl * 0.5), t).normalize();
    torso.spinePitch -= t * 0.12;
    torso.headPitch -= t * 0.22;
    torso.headYaw += Math.sin(beat * Math.PI) * 0.15 * t;
    torso.shouldersYaw += Math.sin(beat * Math.PI * 3) * 0.1 * t;
    torso.hips.x += Math.sin(beat * Math.PI) * 0.03 * t * mirror;
    torso.headOffset.z += t * 0.03;
  }

  /**
   * Tie-up: the fighter whose id sorts first hooks over the opponent's arms,
   * the other digs under them around the ribs. Both lean in over the bladed
   * chest line and rest the head to their own right, so the skulls pass on
   * opposite shoulders, and both keep working for position while they hold.
   */
  private applyClinchPose(c: number, time: number, mirror: number, fighter: FighterSnapshot, opponent: FighterSnapshot, leadHand: HandTarget, rearHand: HandTarget, headRest: THREE.Vector3): void {
    const torso = this.torso;
    const over = fighter.player_id < opponent.player_id;
    const struggle = Math.sin(time * 7.3) * 0.5 + Math.sin(time * 4.1 + 1.2) * 0.5;
    const centre = this.clinchCentre
      .set(this.mapping.x(opponent.x) - (this.rootX ?? 0), 0, this.mapping.z(opponent.y) - this.rootZ)
      .applyQuaternion(this.scratchQ.setFromAxisAngle(worldUpVector, -this.yaw));
    if (centre.lengthSq() < 0.04) centre.set(0, 0, 0.5);
    const forward = this.clinchForward.copy(centre).normalize();
    const acrossX = forward.z;
    const acrossZ = -forward.x;
    torso.spinePitch += c * (over ? 0.28 : 0.42) + struggle * 0.025 * c;
    torso.hips.z += c * (over ? 0.04 : 0.06);
    torso.hips.x += struggle * 0.02 * c;
    torso.hips.y -= c * (over ? 0 : 0.03) + Math.abs(struggle) * 0.012 * c;
    torso.hipsYaw += struggle * 0.06 * c;
    torso.headPitch += c * (over ? 0.15 : 0.3);
    torso.headYaw -= c * 0.3;
    torso.headOffset.x -= c * 0.05;
    torso.headOffset.y -= c * (over ? 0.02 : 0.06);
    const metrics = this.boxer.rig.metrics;
    const reach = Math.min(metrics.armL.upper + metrics.armL.lower, metrics.armR.upper + metrics.armR.lower) * 0.92;
    for (const [hand, side] of [[leadHand, mirror], [rearHand, -mirror]] as const) {
      const wrap = over ? 0.2 : 0.17;
      const depth = over ? 0.05 : 0.1;
      const shoulderX = 0.19 * side;
      const shoulderZ = torso.hips.z + 0.04 + torso.spinePitch * 0.25;
      const target = this.clinchTemp.set(
        centre.x + acrossX * wrap * side + forward.x * depth - shoulderX,
        headRest.y - (over ? 0.24 : 0.5) - (side === mirror ? 0 : 0.05),
        centre.z + acrossZ * wrap * side + forward.z * depth - shoulderZ,
      );
      const rise = target.y - (headRest.y - 0.22);
      const horizontal = Math.hypot(target.x, target.z);
      const limit = Math.sqrt(Math.max(0.01, reach * reach - rise * rise));
      if (horizontal > limit) {
        target.x *= limit / horizontal;
        target.z *= limit / horizontal;
      }
      target.x += shoulderX;
      target.z += shoulderZ;
      hand.position.lerp(target, c);
      hand.pole.lerp(this.clinchTemp.set(side * 0.85, over ? 0.35 : -0.6, 0.25), c).normalize();
      hand.knuckles.lerp(this.clinchTemp.set(-acrossX * side * 0.9 + forward.x * 0.3, over ? -0.25 : 0.1, -acrossZ * side * 0.9 + forward.z * 0.3), c).normalize();
      hand.palm.lerp(this.clinchTemp.set(-forward.x, over ? 0.1 : 0.35, -forward.z), c).normalize();
    }
  }

  /** Character-space head rest position for hand offsets (before torso deltas). */
  private headRestChar(mirror: number): THREE.Vector3 {
    const metrics = this.boxer.rig.metrics;
    void mirror;
    return this.headWorld.set(-0.08, metrics.headHeight - metrics.hipsHeight + this.torso.hips.y, 0.02);
  }

  private syncAction(fighter: FighterSnapshot, sampledTick: number, simDt: number): void {
    if (
      fighter.action_id !== null
      && fighter.action_id !== this.actionId
      && fighter.action_id !== this.completedActionId
      && !this.retiredOwnIds.includes(fighter.action_id)
    ) {
      const punchClass = fighter.action;
      if (punchClass !== null) {
        const hand = fighter.action_hand ?? (fighter.stance === "orthodox" ? "left" : "right");
        const own = this.ownActionId === fighter.action_id && this.punchActive;
        const predictedTiming = this.punchTiming;
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
        this.punchTotalTicks = Math.max(1, fighter.action_startup_ticks + fighter.action_active_ticks + fighter.action_recovery_ticks);
        const authoritativeAge = Math.max(0, sampledTick - fighter.action_start_tick);
        if (own) {
          // The server's timing can differ from the predicted one (fatigue); keep the glove where it is.
          this.punchAgeTicks = remapPunchAge(this.punchAgeTicks, predictedTiming, this.punchTiming);
          this.ownAuthoritativeAge = authoritativeAge;
          this.ownPulled = false;
          if (authoritativeAge - this.punchAgeTicks > 1) this.punchAgeTicks = authoritativeAge;
        } else {
          this.punchAgeTicks = authoritativeAge;
          this.ownActionId = null;
          this.ownLeadTicks = 0;
          this.ownAuthoritativeAge = null;
        }
        this.ownWaitedTicks = 0;
        this.punchActive = true;
      }
    }
    if (fighter.action_id === null) {
      this.actionId = null;
      this.completedActionId = null;
    } else if (fighter.action_id === this.actionId && this.punchActive) {
      // Same instance: re-lock the phase if the render clock drifted more than a tick. The viewer's
      // own punch started ahead of the server, so it only ever catches up, never goes back.
      const authoritativeAge = Math.max(0, sampledTick - fighter.action_start_tick);
      if (this.ownActionId === this.actionId) {
        this.ownAuthoritativeAge = authoritativeAge;
        if (authoritativeAge - this.punchAgeTicks > 1.5) this.punchAgeTicks = authoritativeAge;
      } else if (Math.abs(this.punchAgeTicks - authoritativeAge) > 1.5) {
        this.punchAgeTicks = authoritativeAge;
      }
    }
    if (this.punchActive && this.ownActionId !== null && this.ownAuthoritativeAge === null && !this.ownPulled) {
      // No word from the server well past when it was due: it turned the punch down. Before
      // contact the glove comes back; after it the punch simply finishes.
      this.ownWaitedTicks += simDt * 30;
      if (this.ownWaitedTicks > this.ownExpectedTicks * 1.5 + OWN_PUNCH_GRACE_TICKS && this.punchAgeTicks < this.punchTiming.startup) this.ownPulled = true;
    }
    if (this.punchActive && this.ownPulled) {
      this.punchAgeTicks -= simDt * 30 * OWN_PUNCH_PULL_RATE;
      if (this.punchAgeTicks <= 0) {
        // Not retired: if the server does start it after all, it plays on the server's timeline.
        this.ownActionId = null;
        this.retirePunch();
      }
    } else if (this.punchActive) {
      this.punchAgeTicks += simDt * 30 * this.ownPunchRate();
      if (this.punchAgeTicks >= this.punchTotalTicks) this.retirePunch();
    }
    if (fighter.is_downed && this.punchActive) this.retirePunch();
  }

  /**
   * Playback rate of the viewer's own punch. Until the server's version is on screen the startup is
   * stretched by the estimated lead; once it is, the rate aims the glove at the server's contact
   * tick, and any lead left after contact is worked off in a slower recovery.
   */
  private ownPunchRate(): number {
    if (this.ownActionId === null) return 1;
    const startup = this.punchTiming.startup;
    const authoritative = this.ownAuthoritativeAge;
    if (authoritative === null) return this.punchAgeTicks < startup ? startup / (startup + this.ownLeadTicks) : 1;
    // The server has stopped reporting it, for a clinch or the bell: the age it last gave is stale.
    if (this.actionId !== this.ownActionId) return 1;
    if (this.punchAgeTicks - authoritative <= 0.25) return 1;
    if (this.punchAgeTicks < startup && authoritative < startup) return clamp((startup - this.punchAgeTicks) / (startup - authoritative), 0.25, 1);
    return 0.5;
  }

  /** Punch mechanics. Returns the punching shoulder's shrug. */
  private applyPunch(
    mirror: number,
    leadHand: { position: THREE.Vector3; knuckles: THREE.Vector3; palm: THREE.Vector3; pole: THREE.Vector3 },
    rearHand: { position: THREE.Vector3; knuckles: THREE.Vector3; palm: THREE.Vector3; pole: THREE.Vector3 },
    lead: { position: THREE.Vector3; toe: THREE.Vector3; heel: number; pole: THREE.Vector3 },
    rear: { position: THREE.Vector3; toe: THREE.Vector3; heel: number; pole: THREE.Vector3 },
    headRest: THREE.Vector3,
  ): number {
    const torso = this.torso;
    const timing = this.punchTiming;
    const age = this.punchAgeTicks;
    const startup = Math.max(1, timing.startup);
    const active = Math.max(0.5, timing.active);
    const recovery = Math.max(1, timing.recovery);
    const isLead = (this.punchHand === "left") === (mirror > 0);
    const hand = isLead ? leadHand : rearHand;
    const other = isLead ? rearHand : leadHand;
    const side = isLead ? 1 : -1;
    const power = this.punchPower === "power" ? 1 : 0;
    const body = this.punchTarget === "body" ? 1 : 0;

    let extend: number;
    let windup: number;
    let phase: "startup" | "active" | "recovery";
    if (age < startup) {
      phase = "startup";
      const u = age / startup;
      const windupEnd = this.punchClass === "hook" ? 0.3 : this.punchClass === "uppercut" ? 0.45 : 0.18;
      windup = smoothstep(0, windupEnd, u) * (1 - smoothstep(windupEnd, Math.min(1, windupEnd + 0.4), u));
      extend = u <= windupEnd ? 0 : easeIn((u - windupEnd) / (1 - windupEnd), 1.65);
    } else if (age < startup + active) {
      phase = "active";
      windup = 0;
      extend = 1 + 0.06 * Math.sin(((age - startup) / active) * Math.PI);
    } else {
      phase = "recovery";
      windup = 0;
      extend = 1 - easeOut((age - startup - active) / recovery, 1.9);
    }
    const e = clamp(extend, 0, 1.1);
    // The swing follows its arc out to contact; on the way back the glove retracts straight to the
    // guard instead of retracing the arc (a hook must not swing back out wide).
    const travel = phase === "recovery" ? 1 : e;
    const retract = phase === "recovery" ? 1 - e : 0;

    const guard = hand.position.clone();
    const guardKnuckles = hand.knuckles.clone();
    const guardPalm = hand.palm.clone();
    const guardPole = hand.pole.clone();

    // Torso rotation: lead punches blade further, rear punches square up.
    const blade = STANCE.bladeYaw * mirror;
    let yawTravel: number;
    let hipsTravel: number;
    let hipsForward = 0;
    let heelRear = 0;
    let heelLead = 0;
    let leadPivot = 0;
    let dip = 0;
    switch (this.punchClass) {
      case "jab":
        yawTravel = -0.2 * side;
        hipsTravel = -0.06 * side;
        hipsForward = 0.03;
        heelRear = 0.18;
        break;
      case "straight":
        yawTravel = isLead ? -0.3 : 1.15 + 0.15 * power;
        hipsTravel = isLead ? -0.1 : 1.05 + 0.1 * power;
        hipsForward = 0.08;
        heelRear = isLead ? 0.2 : 0.62;
        break;
      case "hook":
        yawTravel = isLead ? -0.95 - 0.2 * power : 1.35 + 0.2 * power;
        hipsTravel = isLead ? -0.8 : 1.15;
        heelRear = isLead ? 0.1 : 0.55;
        heelLead = isLead ? 0.45 : 0;
        leadPivot = isLead ? 0.5 : 0;
        hipsForward = 0.02;
        break;
      default:
        yawTravel = isLead ? -0.55 : 0.95;
        hipsTravel = isLead ? -0.45 : 0.85;
        heelRear = isLead ? 0.15 : 0.5;
        dip = 0.12 + 0.05 * power;
        break;
    }
    const rotation = this.punchClass === "hook" ? smoothstep(0.15, 1, e) : e;
    torso.shouldersYaw = blade * 0.88 + yawTravel * mirror * rotation;
    torso.hipsYaw = blade + hipsTravel * mirror * rotation;
    torso.hips.z += hipsForward * e;
    torso.hips.x += (isLead ? 0.02 : 0.05) * mirror * e;
    torso.hips.y -= body * 0.1 * e + dip * windup + dip * 0.3 * e;
    torso.spinePitch += 0.06 * e + body * 0.25 * e + dip * 1.4 * windup;
    torso.headPitch += 0.05 * e + body * 0.12 * e;
    torso.headOffset.z += 0.02 * e;
    torso.headYaw += -yawTravel * mirror * rotation * 0.35;

    // Target in character space, measured from the rotated shoulder.
    const target = this.scratch;
    const rootPosition = this.scratchB.set(this.rootX ?? 0, 0, this.rootZ);
    if (this.hasLiveHead) {
      target.copy(this.liveOpponentHead).sub(rootPosition).applyQuaternion(this.scratchQ.setFromAxisAngle(worldUpVector, -this.yaw));
      if (body === 1) target.y -= 0.42;
      else target.y -= 0.04;
    } else {
      target.set(0, body === 1 ? 1.15 : 1.5, 0.9);
    }
    const shoulderSpan = 0.19 * side * mirror;
    const shoulderChar = this.scratchD.set(
      torso.hips.x + shoulderSpan * Math.cos(torso.shouldersYaw),
      headRest.y - 0.22,
      torso.hips.z + 0.04 + torso.spinePitch * 0.25 - shoulderSpan * Math.sin(torso.shouldersYaw),
    );
    const toTarget = target.clone().sub(shoulderChar);
    const distance = toTarget.length();
    const dir = toTarget.normalize();
    const reach = 0.5 + 0.04 * power + (this.punchClass === "straight" ? 0.06 : 0) + (this.punchClass === "jab" ? 0.03 : 0)
      - (this.punchClass === "hook" ? 0.08 : 0) - (this.punchClass === "uppercut" ? 0.08 : 0);
    const contactDistance = Math.min(distance - HURTBOXES.head.radius - GLOVE_HITBOX_RADIUS + PUNCH_CONTACT_OFFSET, reach);
    const contact = shoulderChar.clone().addScaledVector(dir, Math.max(0.2, contactDistance));
    rear.heel = heelRear * e;
    lead.heel = heelLead * e;
    if (leadPivot > 0) {
      const pivot = this.scratchQ.setFromAxisAngle(worldUpVector, -leadPivot * mirror * e);
      lead.toe.applyQuaternion(pivot);
      lead.pole.applyQuaternion(pivot);
    }
    if (heelRear > 0.3) {
      const pivot = this.scratchQ.setFromAxisAngle(worldUpVector, 0.45 * mirror * e);
      rear.toe.applyQuaternion(pivot);
      rear.pole.applyQuaternion(pivot);
    }

    // Hand path.
    const windupOffset = this.scratchE;
    switch (this.punchClass) {
      case "hook":
        windupOffset.set(0.22 * side * mirror, -0.06, -0.12);
        break;
      case "uppercut":
        windupOffset.set(0.05 * side * mirror, -0.42, -0.02);
        break;
      case "straight":
        windupOffset.set(0.02 * side * mirror, -0.03, -0.09 - 0.05 * power);
        break;
      default:
        windupOffset.set(0, -0.01, -0.05 - 0.04 * power);
        break;
    }
    const start = guard.clone().addScaledVector(windupOffset, Math.max(windup, this.punchClass === "hook" || this.punchClass === "uppercut" ? (1 - travel) * 0.6 : 0));
    if (this.punchClass === "hook") {
      // Horizontal sweep around the shoulder from the wide windup into the target.
      const radius = Math.max(0.32, Math.min(0.48, contact.distanceTo(shoulderChar)));
      const startDir = start.clone().sub(shoulderChar).setY(0).normalize();
      const endDir = contact.clone().sub(shoulderChar).setY(0).normalize();
      const angle = Math.acos(clamp(startDir.dot(endDir), -1, 1));
      const turn = new THREE.Vector3().crossVectors(startDir, endDir).y >= 0 ? 1 : -1;
      const sweep = smoothstep(0, 1, travel);
      const rotated = startDir.clone().applyAxisAngle(worldUpVector, angle * sweep * turn).normalize();
      hand.position.copy(shoulderChar).addScaledVector(rotated, radius * (0.8 + 0.2 * sweep));
      hand.position.y = THREE.MathUtils.lerp(start.y, contact.y, sweep);
      hand.pole.set(0.95 * side * mirror, 0.08, 0.3).normalize();
      hand.knuckles.copy(rotated).applyAxisAngle(worldUpVector, turn * Math.PI / 2).setY(0.05).normalize();
      hand.palm.set(0, -1, 0);
    } else if (this.punchClass === "uppercut") {
      const rise = smoothstep(0, 1, travel);
      const low = start.clone();
      const mid = contact.clone().lerp(low, 0.5);
      mid.y = Math.min(low.y, contact.y) - 0.04;
      mid.z += 0.08;
      hand.position.copy(low).lerp(mid, rise * 2 > 1 ? 1 : rise * 2);
      if (rise > 0.5) hand.position.copy(mid).lerp(contact, (rise - 0.5) * 2);
      hand.pole.set(0.3 * side * mirror, -0.2, 1);
      hand.knuckles.set(0.05 * side * mirror, 0.9, 0.35).normalize();
      hand.palm.set(-0.2 * side * mirror, 0.3, -0.95).normalize();
    } else {
      hand.position.copy(start).lerp(contact, travel);
      hand.position.y += Math.sin(clamp(travel, 0, 1) * Math.PI) * 0.025;
      hand.pole.set(0.55 * side * mirror, -0.9, 0.35);
      const pronate = smoothstep(0.55, 1, travel);
      hand.knuckles.copy(dir).lerp(this.scratchC.set(0.1 * side * mirror, 0.55, 0.8), 1 - pronate).normalize();
      hand.palm.set(-0.9 * side * mirror, 0.2, -0.3).lerp(this.scratchC.set(0, -1, 0.1), pronate).normalize();
    }

    if (retract > 0) {
      hand.position.lerp(guard, retract);
      hand.knuckles.lerp(guardKnuckles, retract).normalize();
      hand.palm.lerp(guardPalm, retract).normalize();
      hand.pole.lerp(guardPole, retract).normalize();
    }

    // Non-punching hand protects the chin.
    const chin = this.scratchE.set(-0.1 * side * mirror, headRest.y - 0.04, 0.12 + headRest.z);
    other.position.lerp(chin, e * 0.7);
    return e;
  }

  /** Square, hands-low official's posture with a raised counting arm during knockdowns. */
  private applyRefereePose(
    mirror: number,
    leadHand: { position: THREE.Vector3; knuckles: THREE.Vector3; palm: THREE.Vector3; pole: THREE.Vector3 },
    rearHand: { position: THREE.Vector3; knuckles: THREE.Vector3; palm: THREE.Vector3; pole: THREE.Vector3 },
    lead: { position: THREE.Vector3; toe: THREE.Vector3; heel: number; pole: THREE.Vector3 },
    rear: { position: THREE.Vector3; toe: THREE.Vector3; heel: number; pole: THREE.Vector3 },
    headRest: THREE.Vector3,
    time: number,
  ): void {
    const torso = this.torso;
    torso.hipsYaw = 0;
    torso.shouldersYaw = 0;
    torso.hipsPitch = 0;
    torso.spinePitch = 0.06;
    torso.headYaw = Math.sin(time * 0.7) * 0.08;
    torso.headPitch = 0.08;
    torso.hips.y = STANCE.hipsHeight + 0.03;
    torso.hips.x = 0;
    torso.hips.z = 0;
    lead.toe.set(0.12 * mirror, 0, 1).normalize();
    rear.toe.set(-0.12 * mirror, 0, 1).normalize();
    lead.pole.copy(lead.toe).setY(0.3).normalize();
    rear.pole.copy(rear.toe).setY(0.3).normalize();
    const sway = Math.sin(time * 1.3) * 0.01;
    leadHand.position.set(0.27 * mirror, 0.86 + sway, 0.12);
    rearHand.position.set(-0.27 * mirror, 0.86 - sway, 0.12);
    leadHand.pole.set(0.5 * mirror, -0.4, -0.8).normalize();
    rearHand.pole.set(-0.5 * mirror, -0.4, -0.8).normalize();
    leadHand.knuckles.set(0.15 * mirror, -0.9, 0.35).normalize();
    rearHand.knuckles.set(-0.15 * mirror, -0.9, 0.35).normalize();
    leadHand.palm.set(-0.9 * mirror, 0.1, 0.35).normalize();
    rearHand.palm.set(0.9 * mirror, 0.1, 0.35).normalize();
    if (this.refereeCounting) {
      const beat = time * 2 * Math.PI;
      const pump = 0.5 + 0.5 * Math.sin(beat);
      rearHand.position.set(-0.22 * mirror, headRest.y - 0.05 + pump * 0.12, 0.34 + pump * 0.08);
      rearHand.pole.set(-0.9 * mirror, -0.3, 0.2).normalize();
      rearHand.knuckles.set(0, 0.7, 0.7).normalize();
      rearHand.palm.set(0, 0.3, -0.95).normalize();
      torso.spinePitch += 0.12;
      torso.headPitch += 0.18;
      leadHand.position.set(0.24 * mirror, 0.95, 0.08);
      void this.refereeCount;
    }
  }

  private updateDownState(fighter: FighterSnapshot, dt: number, reducedMotion: boolean): void {
    if (fighter.is_downed || this.forcedDown) {
      if (this.downState === "up" || this.downState === "rising") {
        this.downState = "falling";
        this.fallAge = 0;
        this.ragdoll?.clearRise();
        if (this.authoredNextFall) this.ragdoll?.forget();
        else if (!reducedMotion) this.ragdoll?.start("crumple");
        this.authoredNextFall = false;
      } else if (this.downState === "falling") {
        this.fallAge += dt;
        if (this.fallAge >= KNOCKDOWN_FALL_SECONDS) this.downState = "down";
      }
      return;
    }
    if (this.downState === "down" || this.downState === "falling") {
      this.downState = "rising";
      this.riseAge = 0;
      this.riseOffset.set(0, 0, 0);
      const ragdoll = this.ragdoll;
      if (ragdoll?.active === true) {
        // Get up from where the fall ended: face down or on the back, beside the spot it started from.
        this.fallProne = ragdoll.faceDown();
        const pelvis = ragdoll.pelvis(this.scratchE);
        pelvis.x -= this.rootX ?? 0;
        pelvis.z -= this.rootZ;
        pelvis.applyAxisAngle(worldUpVector, -this.yaw);
        this.fallSide = Math.abs(pelvis.x) > 0.12 ? Math.sign(pelvis.x) : 0;
        const lying = this.fallProne ? FALLEN_PRONE_HIPS : FALLEN_SUPINE_HIPS;
        this.riseOffset.set(pelvis.x - lying.x * this.fallSide, 0, pelvis.z - lying.z);
        ragdoll.stop();
      }
    } else if (this.downState === "rising") {
      this.riseAge += dt;
      if (this.riseAge >= GETUP_SECONDS) {
        this.downState = "up";
        this.feetInitialized = false;
        this.fallKneel = false;
      }
    }
  }

  /** Folded over a body shot: knees giving, the glove on the struck side clamped over the ribs, the other hanging. */
  private applyWindedPose(blend: number, time: number, mirror: number, leadHand: HandTarget, rearHand: HandTarget): void {
    const torso = this.torso;
    const lerp = THREE.MathUtils.lerp;
    const side = this.windedSide;
    const shudder = Math.sin(time * 23) * 0.006;
    torso.hips.y = lerp(torso.hips.y, STANCE.hipsHeight - 0.1, blend);
    torso.hips.z = lerp(torso.hips.z, -0.04, blend);
    torso.hipsPitch = lerp(torso.hipsPitch, 0.2, blend);
    torso.spinePitch = lerp(torso.spinePitch, 0.62 + shudder, blend);
    torso.spineRoll = lerp(torso.spineRoll, side * 0.16, blend);
    torso.headPitch = lerp(torso.headPitch, 0.38, blend);
    const clutch = side > 0 ? this.hand.L : this.hand.R;
    const free = clutch === leadHand ? rearHand : leadHand;
    clutch.position.lerp(seatedScratch.set(side * 0.13, 0.98, 0.17), blend);
    clutch.palm.lerp(seatedScratch.set(-side * 0.6, 0, -0.8), blend).normalize();
    clutch.knuckles.lerp(seatedScratch.set(-side * 0.5, 0.5, 0.2), blend).normalize();
    clutch.pole.lerp(seatedScratch.set(side * 0.9, -0.3, -0.3), blend).normalize();
    free.position.lerp(seatedScratch.set(-side * 0.2, 0.86, 0.3), blend);
    free.pole.lerp(seatedScratch.set(-side * 0.8, -0.6, 0), blend).normalize();
    void mirror;
  }

  private applyTouchGlovesPose(
    blend: number,
    mirror: number,
    leadHand: { position: THREE.Vector3; knuckles: THREE.Vector3; palm: THREE.Vector3; pole: THREE.Vector3 },
    rearHand: { position: THREE.Vector3; knuckles: THREE.Vector3; palm: THREE.Vector3; pole: THREE.Vector3 },
  ): void {
    const torso = this.torso;
    const lerp = THREE.MathUtils.lerp;
    torso.hips.z = lerp(torso.hips.z, 0.06, blend);
    torso.hipsYaw = lerp(torso.hipsYaw, torso.hipsYaw * 0.4, blend);
    torso.shouldersYaw = lerp(torso.shouldersYaw, 0, blend);
    torso.spinePitch = lerp(torso.spinePitch, 0.12, blend);
    torso.headPitch = lerp(torso.headPitch, 0.1, blend);
    leadHand.position.lerp(seatedScratch.set(0.11 * mirror, 1.24, 0.5), blend);
    rearHand.position.lerp(seatedScratch.set(-0.11 * mirror, 1.22, 0.47), blend);
    leadHand.palm.lerp(seatedScratch.set(-mirror, 0, 0), blend).normalize();
    rearHand.palm.lerp(seatedScratch.set(mirror, 0, 0), blend).normalize();
    leadHand.knuckles.lerp(seatedScratch.set(0, 0.15, 1), blend).normalize();
    rearHand.knuckles.lerp(seatedScratch.set(0, 0.15, 1), blend).normalize();
    leadHand.pole.lerp(seatedScratch.set(0.7 * mirror, -0.7, 0), blend).normalize();
    rearHand.pole.lerp(seatedScratch.set(-0.7 * mirror, -0.7, 0), blend).normalize();
  }

  private applyCelebratePose(
    blend: number,
    time: number,
    mirror: number,
    leadHand: { position: THREE.Vector3; knuckles: THREE.Vector3; palm: THREE.Vector3; pole: THREE.Vector3 },
    rearHand: { position: THREE.Vector3; knuckles: THREE.Vector3; palm: THREE.Vector3; pole: THREE.Vector3 },
    lead: { position: THREE.Vector3; toe: THREE.Vector3; heel: number; pole: THREE.Vector3 },
    rear: { position: THREE.Vector3; toe: THREE.Vector3; heel: number; pole: THREE.Vector3 },
  ): void {
    const torso = this.torso;
    const lerp = THREE.MathUtils.lerp;
    const pump = Math.sin(time * 6) * 0.04;
    torso.hips.y = lerp(torso.hips.y, STANCE.hipsHeight + 0.035 + pump * 0.5, blend);
    torso.hipsYaw = lerp(torso.hipsYaw, 0, blend);
    torso.hipsPitch = lerp(torso.hipsPitch, -0.12, blend);
    torso.hipsRoll = lerp(torso.hipsRoll, 0, blend);
    torso.shouldersYaw = lerp(torso.shouldersYaw, 0, blend);
    torso.spinePitch = lerp(torso.spinePitch, -0.1, blend);
    torso.headPitch = lerp(torso.headPitch, -0.25, blend);
    leadHand.position.lerp(seatedScratch.set(0.3 * mirror, 1.86 + pump, 0.08), blend);
    rearHand.position.lerp(seatedScratch.set(-0.3 * mirror, 1.84 + pump, 0.06), blend);
    leadHand.palm.lerp(seatedScratch.set(0, 0, 1), blend).normalize();
    rearHand.palm.lerp(seatedScratch.set(0, 0, 1), blend).normalize();
    leadHand.knuckles.lerp(seatedScratch.set(0.15 * mirror, 1, 0), blend).normalize();
    rearHand.knuckles.lerp(seatedScratch.set(-0.15 * mirror, 1, 0), blend).normalize();
    leadHand.pole.lerp(seatedScratch.set(mirror, 0.1, -0.3), blend).normalize();
    rearHand.pole.lerp(seatedScratch.set(-mirror, 0.1, -0.3), blend).normalize();
    lead.heel = lerp(lead.heel, 0.45, blend);
    rear.heel = lerp(rear.heel, 0.45, blend);
  }

  private applyAttendPose(
    blend: number,
    time: number,
    mirror: number,
    leadHand: { position: THREE.Vector3; knuckles: THREE.Vector3; palm: THREE.Vector3; pole: THREE.Vector3 },
    rearHand: { position: THREE.Vector3; knuckles: THREE.Vector3; palm: THREE.Vector3; pole: THREE.Vector3 },
  ): void {
    const torso = this.torso;
    const lerp = THREE.MathUtils.lerp;
    const work = Math.sin(time * 3.1) * 0.03;
    torso.hips.z = lerp(torso.hips.z, 0.12, blend);
    torso.hips.y = lerp(torso.hips.y, STANCE.hipsHeight - 0.04, blend);
    torso.hipsPitch = lerp(torso.hipsPitch, 0.3, blend);
    torso.spinePitch = lerp(torso.spinePitch, 0.42, blend);
    torso.headPitch = lerp(torso.headPitch, 0.4, blend);
    leadHand.position.lerp(seatedScratch.set(0.2 * mirror, 1.3 + work, 0.62), blend);
    rearHand.position.lerp(seatedScratch.set(-0.18 * mirror, 1.24 - work, 0.58), blend);
    leadHand.palm.lerp(seatedScratch.set(0, -0.6, 0.8), blend).normalize();
    rearHand.palm.lerp(seatedScratch.set(0, -0.6, 0.8), blend).normalize();
    leadHand.knuckles.lerp(seatedScratch.set(0.1 * mirror, 0.5, 1), blend).normalize();
    rearHand.knuckles.lerp(seatedScratch.set(-0.1 * mirror, 0.5, 1), blend).normalize();
    leadHand.pole.lerp(seatedScratch.set(0.8 * mirror, -0.5, -0.1), blend).normalize();
    rearHand.pole.lerp(seatedScratch.set(-0.8 * mirror, -0.5, -0.1), blend).normalize();
  }

  /** Cutman work: a deep crouch before the seated fighter, the lead glove pressing the enswell on the eye, the rear hand steadying the jaw. */
  private applyTreatPose(
    blend: number,
    time: number,
    mirror: number,
    leadHand: HandTarget,
    rearHand: HandTarget,
    lead: { position: THREE.Vector3; toe: THREE.Vector3; heel: number; pole: THREE.Vector3 },
    rear: { position: THREE.Vector3; toe: THREE.Vector3; heel: number; pole: THREE.Vector3 },
  ): void {
    const torso = this.torso;
    const lerp = THREE.MathUtils.lerp;
    const rootPosition = this.treatScratch.set(this.rootX ?? 0, 0, this.rootZ);
    const inverse = this.scratchQ.setFromAxisAngle(worldUpVector, -this.yaw);
    const eye = seatedScratch.copy(this.treatTarget).sub(rootPosition).applyQuaternion(inverse);
    const facing = this.treatFacingLocal.copy(this.treatFacing).applyQuaternion(inverse);
    const leftX = facing.z;
    const leftZ = -facing.x;
    const press = Math.sin(time * 2.6) * 0.006;
    torso.hips.lerp(this.treatScratch.set(0, 0.62, 0.04), blend);
    torso.hipsYaw = lerp(torso.hipsYaw, 0, blend);
    torso.hipsPitch = lerp(torso.hipsPitch, 0.22, blend);
    torso.hipsRoll = lerp(torso.hipsRoll, 0, blend);
    torso.shouldersYaw = lerp(torso.shouldersYaw, 0, blend);
    torso.spinePitch = lerp(torso.spinePitch, 0.3, blend);
    torso.headPitch = lerp(torso.headPitch, 0.2, blend);
    lead.position.x = lerp(lead.position.x, 0.24 * mirror, blend);
    lead.position.z = lerp(lead.position.z, 0.14, blend);
    rear.position.x = lerp(rear.position.x, -0.2 * mirror, blend);
    rear.position.z = lerp(rear.position.z, -0.2, blend);
    rear.heel = lerp(rear.heel, 0.55, blend);
    lead.toe.lerp(this.treatScratch.set(0.2 * mirror, 0, 1), blend).normalize();
    rear.toe.lerp(this.treatScratch.set(-0.1 * mirror, 0, 1), blend).normalize();
    lead.pole.lerp(this.treatScratch.set(0.25 * mirror, 0.4, 1), blend).normalize();
    rear.pole.lerp(this.treatScratch.set(-0.2 * mirror, 0.4, 1), blend).normalize();
    // The enswell's plate sits above the fist and presses on the eye; the bottle points from the fist into the mouth.
    const bottle = this.treatProp === "bottle";
    const reach = bottle ? 0.3 : 0.08 - press;
    leadHand.position.lerp(this.treatScratch.set(eye.x + facing.x * reach, eye.y + (bottle ? 0.02 : -0.07), eye.z + facing.z * reach), blend);
    if (bottle) leadHand.knuckles.lerp(this.treatScratch.set(-facing.x, -0.25, -facing.z), blend).normalize();
    else leadHand.knuckles.lerp(this.treatScratch.set(0, 1, 0.05), blend).normalize();
    leadHand.palm.lerp(bottle ? this.treatScratch.set(0, -1, 0) : this.treatScratch.set(-facing.x, 0, -facing.z), blend).normalize();
    leadHand.pole.lerp(this.treatScratch.set(0.85 * mirror, -0.35, 0.1), blend).normalize();
    const jaw = this.treatSide * 0.135;
    rearHand.position.lerp(this.treatScratch.set(eye.x - leftX * jaw + facing.x * 0.05, eye.y - 0.2, eye.z - leftZ * jaw + facing.z * 0.05), blend);
    rearHand.knuckles.lerp(this.treatScratch.set(0, 0.9, 0.4), blend).normalize();
    rearHand.palm.lerp(this.treatScratch.set(leftX * this.treatSide * 0.8 - facing.x * 0.6, 0.1, leftZ * this.treatSide * 0.8 - facing.z * 0.6), blend).normalize();
    rearHand.pole.lerp(this.treatScratch.set(-0.85 * mirror, -0.4, 0.1), blend).normalize();
  }

  private applyBreakPose(
    blend: number,
    mirror: number,
    leadHand: { position: THREE.Vector3; knuckles: THREE.Vector3; palm: THREE.Vector3; pole: THREE.Vector3 },
    rearHand: { position: THREE.Vector3; knuckles: THREE.Vector3; palm: THREE.Vector3; pole: THREE.Vector3 },
  ): void {
    const torso = this.torso;
    const lerp = THREE.MathUtils.lerp;
    torso.hipsPitch = lerp(torso.hipsPitch, 0.14, blend);
    torso.spinePitch = lerp(torso.spinePitch, 0.08, blend);
    leadHand.position.lerp(seatedScratch.set(0.48 * mirror, 1.22, 0.52), blend);
    rearHand.position.lerp(seatedScratch.set(-0.48 * mirror, 1.22, 0.52), blend);
    leadHand.palm.lerp(seatedScratch.set(mirror, 0, 0.2), blend).normalize();
    rearHand.palm.lerp(seatedScratch.set(-mirror, 0, 0.2), blend).normalize();
    leadHand.knuckles.lerp(seatedScratch.set(0, 0.3, 1), blend).normalize();
    rearHand.knuckles.lerp(seatedScratch.set(0, 0.3, 1), blend).normalize();
    leadHand.pole.lerp(seatedScratch.set(0.2 * mirror, -1, 0.1), blend).normalize();
    rearHand.pole.lerp(seatedScratch.set(-0.2 * mirror, -1, 0.1), blend).normalize();
  }

  /** Standing square beside the referee for the decision, then the arm on the referee's side going up or the head going down. */
  private applyVerdictPose(
    blend: number,
    time: number,
    mirror: number,
    leadHand: HandTarget,
    rearHand: HandTarget,
    lead: FootTarget,
    rear: FootTarget,
    headRest: THREE.Vector3,
  ): void {
    const torso = this.torso;
    const lerp = THREE.MathUtils.lerp;
    const raised = this.raisedWeight;
    const bowed = this.bowedWeight;
    const breath = Math.sin(time * 1.9) * 0.008;
    torso.hips.x = lerp(torso.hips.x, this.verdictSide * 0.02 * raised, blend);
    torso.hips.y = lerp(torso.hips.y, STANCE.hipsHeight + 0.03 + raised * 0.01 - bowed * 0.015, blend);
    torso.hips.z = lerp(torso.hips.z, 0, blend);
    torso.hipsYaw = lerp(torso.hipsYaw, 0, blend);
    torso.hipsPitch = lerp(torso.hipsPitch, 0, blend);
    torso.shouldersYaw = lerp(torso.shouldersYaw, 0, blend);
    torso.spinePitch = lerp(torso.spinePitch, 0.05 - raised * 0.1 + bowed * 0.12, blend);
    torso.spineRoll = lerp(torso.spineRoll, -this.verdictSide * 0.06 * raised, blend);
    torso.headYaw = lerp(torso.headYaw, 0, blend);
    torso.headPitch = lerp(torso.headPitch, 0.04 - raised * 0.2 + bowed * 0.34, blend);
    lead.toe.lerp(seatedScratch.set(0.12 * mirror, 0, 1), blend).normalize();
    rear.toe.lerp(seatedScratch.set(-0.12 * mirror, 0, 1), blend).normalize();
    lead.pole.lerp(seatedScratch.set(0.12 * mirror, 0.3, 1), blend).normalize();
    rear.pole.lerp(seatedScratch.set(-0.12 * mirror, 0.3, 1), blend).normalize();
    for (const [hand, side] of [[leadHand, mirror], [rearHand, -mirror]] as const) {
      const lifted = side === this.verdictSide ? raised : 0;
      hand.position.lerp(seatedScratch.set(side * (0.27 + lifted * 0.11), lerp(0.88 + breath, headRest.y + 0.44, lifted), lerp(0.12, 0.05, lifted)), blend);
      hand.knuckles.lerp(seatedScratch.set(side * 0.15, lerp(-0.9, 1, lifted), lerp(0.35, 0, lifted)), blend).normalize();
      hand.palm.lerp(seatedScratch.set(lerp(-0.9 * side, 0, lifted), 0.1, lerp(0.35, 1, lifted)), blend).normalize();
      hand.pole.lerp(seatedScratch.set(side * lerp(0.5, 1, lifted), lerp(-0.4, 0.1, lifted), lerp(-0.8, -0.3, lifted)), blend).normalize();
    }
  }

  /** Referee: a hand around each wrist it has been given, just below the glove. */
  private applyRaisePose(mirror: number, leadHand: HandTarget, rearHand: HandTarget): void {
    const root = this.treatScratch.set(this.rootX ?? 0, 0, this.rootZ);
    const inverse = this.scratchQ.setFromAxisAngle(worldUpVector, -this.yaw);
    for (const [index, side] of [[0, 1], [1, -1]] as const) {
      const wrist = this.wrists[index] ?? this.wristTargets[index];
      const weight = this.wristWeights[index];
      if (weight <= 0.001) continue;
      const hand = side === mirror ? leadHand : rearHand;
      const held = seatedScratch.copy(wrist).sub(root).applyQuaternion(inverse);
      held.y -= 0.17;
      hand.position.lerp(held, weight);
      hand.knuckles.lerp(seatedScratch.set(0, 1, 0), weight).normalize();
      hand.palm.lerp(seatedScratch.set(side, 0, 0.2), weight).normalize();
      hand.pole.lerp(seatedScratch.set(side * 0.6, -0.5, -0.6), weight).normalize();
    }
    this.torso.headPitch = THREE.MathUtils.lerp(this.torso.headPitch, -0.05, Math.max(this.wristWeights[0], this.wristWeights[1]));
  }

  private applyWaveOffPose(
    blend: number,
    time: number,
    mirror: number,
    leadHand: { position: THREE.Vector3; knuckles: THREE.Vector3; palm: THREE.Vector3; pole: THREE.Vector3 },
    rearHand: { position: THREE.Vector3; knuckles: THREE.Vector3; palm: THREE.Vector3; pole: THREE.Vector3 },
  ): void {
    const torso = this.torso;
    const lerp = THREE.MathUtils.lerp;
    const sweep = Math.cos(time * 7.5);
    torso.hipsPitch = lerp(torso.hipsPitch, 0.08, blend);
    torso.spinePitch = lerp(torso.spinePitch, 0.05, blend);
    torso.headPitch = lerp(torso.headPitch, -0.1, blend);
    leadHand.position.lerp(seatedScratch.set(0.42 * sweep * mirror, 1.66 + Math.abs(sweep) * 0.08, 0.34), blend);
    rearHand.position.lerp(seatedScratch.set(-0.42 * sweep * mirror, 1.62 + Math.abs(sweep) * 0.08, 0.24), blend);
    leadHand.palm.lerp(seatedScratch.set(0, 0, 1), blend).normalize();
    rearHand.palm.lerp(seatedScratch.set(0, 0, 1), blend).normalize();
    leadHand.knuckles.lerp(seatedScratch.set(0, 1, 0), blend).normalize();
    rearHand.knuckles.lerp(seatedScratch.set(0, 1, 0), blend).normalize();
    leadHand.pole.lerp(seatedScratch.set(mirror, -0.2, -0.3), blend).normalize();
    rearHand.pole.lerp(seatedScratch.set(-mirror, -0.2, -0.3), blend).normalize();
  }

  private applySeatedPose(
    blend: number,
    time: number,
    mirror: number,
    leadHand: { position: THREE.Vector3; knuckles: THREE.Vector3; palm: THREE.Vector3; pole: THREE.Vector3 },
    rearHand: { position: THREE.Vector3; knuckles: THREE.Vector3; palm: THREE.Vector3; pole: THREE.Vector3 },
    lead: { position: THREE.Vector3; toe: THREE.Vector3; heel: number; pole: THREE.Vector3 },
    rear: { position: THREE.Vector3; toe: THREE.Vector3; heel: number; pole: THREE.Vector3 },
  ): void {
    const torso = this.torso;
    const lerp = THREE.MathUtils.lerp;
    const breath = 0.5 + 0.5 * Math.sin(time * 1.9);
    torso.hips.lerp(seatedScratch.set(0.02 * mirror, STOOL_SEAT_HEIGHT + 0.07 + breath * 0.004, -0.06), blend);
    torso.hipsYaw = lerp(torso.hipsYaw, 0, blend);
    torso.hipsPitch = lerp(torso.hipsPitch, 0.32 + breath * 0.03, blend);
    torso.hipsRoll = lerp(torso.hipsRoll, 0, blend);
    torso.shouldersYaw = lerp(torso.shouldersYaw, 0, blend);
    torso.spinePitch = lerp(torso.spinePitch, 0.1 - breath * 0.05, blend);
    torso.headPitch = lerp(torso.headPitch, 0.28 - breath * 0.08, blend);
    leadHand.position.lerp(seatedScratch.set(0.21 * mirror, STOOL_SEAT_HEIGHT + 0.17, 0.36), blend);
    rearHand.position.lerp(seatedScratch.set(-0.21 * mirror, STOOL_SEAT_HEIGHT + 0.17, 0.36), blend);
    leadHand.palm.lerp(seatedScratch.set(0, -1, 0), blend).normalize();
    rearHand.palm.lerp(seatedScratch.set(0, -1, 0), blend).normalize();
    leadHand.knuckles.lerp(seatedScratch.set(0.2 * mirror, 0, 1), blend).normalize();
    rearHand.knuckles.lerp(seatedScratch.set(-0.2 * mirror, 0, 1), blend).normalize();
    leadHand.pole.lerp(seatedScratch.set(0.9 * mirror, -0.3, -0.2), blend).normalize();
    rearHand.pole.lerp(seatedScratch.set(-0.9 * mirror, -0.3, -0.2), blend).normalize();
    lead.position.lerp(seatedScratch.set(0.18 * mirror, 0, 0.4), blend);
    rear.position.lerp(seatedScratch.set(-0.18 * mirror, 0, 0.38), blend);
    lead.heel = lerp(lead.heel, 0, blend);
    rear.heel = lerp(rear.heel, 0, blend);
    lead.toe.lerp(seatedScratch.set(0.15 * mirror, 0, 1), blend).normalize();
    rear.toe.lerp(seatedScratch.set(-0.15 * mirror, 0, 1), blend).normalize();
    lead.pole.lerp(seatedScratch.set(0.1 * mirror, 0.5, 1), blend).normalize();
    rear.pole.lerp(seatedScratch.set(-0.1 * mirror, 0.5, 1), blend).normalize();
  }

  private applyDownPose(
    mirror: number,
    leadHand: { position: THREE.Vector3; knuckles: THREE.Vector3; palm: THREE.Vector3; pole: THREE.Vector3 },
    rearHand: { position: THREE.Vector3; knuckles: THREE.Vector3; palm: THREE.Vector3; pole: THREE.Vector3 },
    lead: { position: THREE.Vector3; toe: THREE.Vector3; heel: number; pole: THREE.Vector3 },
    rear: { position: THREE.Vector3; toe: THREE.Vector3; heel: number; pole: THREE.Vector3 },
    headRest: THREE.Vector3,
  ): void {
    const torso = this.torso;
    const side = this.fallSide === 0 ? 0 : this.fallSide;
    // Lying-on-the-back pose (character space).
    const lying = {
      hips: vec(side * FALLEN_SUPINE_HIPS.x, 0.14, FALLEN_SUPINE_HIPS.z),
      hipsYaw: side * 0.35,
      hipsPitch: -1.42,
      hipsRoll: side * 0.25,
      shouldersYaw: side * 0.2,
      spinePitch: 0.1,
      headPitch: -0.5,
      leadHand: vec(0.52 * mirror, 0.1, -0.62),
      rearHand: vec(-0.5 * mirror, 0.1, -0.7),
      leadFoot: vec(0.17 * mirror + side * 0.05, 0.08, 0.16),
      rearFoot: vec(-0.16 * mirror + side * 0.05, 0.09, -0.02),
    };
    // Face-down pose after a hook: the fighter pitches forward over the front foot.
    const prone = {
      hips: vec(side * FALLEN_PRONE_HIPS.x, 0.13, FALLEN_PRONE_HIPS.z),
      hipsYaw: side * 0.3,
      hipsPitch: 1.5,
      hipsRoll: side * 0.15,
      shouldersYaw: side * 0.15,
      spinePitch: 0.05,
      headPitch: 0.2,
      leadHand: vec(0.34 * mirror, 0.06, 0.78),
      rearHand: vec(-0.3 * mirror, 0.06, 0.62),
      leadFoot: vec(0.16 * mirror + side * 0.04, 0.06, -0.5),
      rearFoot: vec(-0.15 * mirror + side * 0.04, 0.07, -0.55),
    };
    // Taking a knee after a body shot: the rear knee on the canvas, folded over the shot with that
    // side's glove clamped on the ribs and the other glove braced on the front knee.
    const struck = this.windedSide;
    const clutch = vec(struck * 0.13, 0.66, 0.2);
    const brace = vec(0.13 * mirror, 0.66, 0.37);
    const clutchLead = (struck > 0) === (mirror > 0);
    const kneel = {
      hips: vec(0.02 * mirror, 0.53, -0.06),
      hipsYaw: STANCE.bladeYaw * mirror * 0.3,
      hipsPitch: 0.24,
      hipsRoll: 0,
      shouldersYaw: STANCE.bladeYaw * mirror * 0.2,
      spinePitch: 0.62,
      headPitch: 0.48,
      leadHand: clutchLead ? clutch : brace,
      rearHand: clutchLead ? brace : clutch,
      leadFoot: vec(0.16 * mirror, 0.125, 0.32),
      rearFoot: vec(-0.12 * mirror, 0.12, -0.5),
    };
    const down = this.fallKneel ? kneel : this.fallProne ? prone : lying;
    const standing = {
      hips: torso.hips.clone(),
      hipsYaw: torso.hipsYaw,
      hipsPitch: torso.hipsPitch,
      hipsRoll: torso.hipsRoll,
      shouldersYaw: torso.shouldersYaw,
      spinePitch: torso.spinePitch,
      headPitch: torso.headPitch,
      leadHand: leadHand.position.clone(),
      rearHand: rearHand.position.clone(),
      leadFoot: lead.position.clone(),
      rearFoot: rear.position.clone(),
    };
    let t: number;
    let headLag: number;
    if (this.downState === "falling") {
      const u = clamp(this.fallAge / KNOCKDOWN_FALL_SECONDS, 0, 1);
      t = easeIn(u, 2.1);
      headLag = Math.sin(u * Math.PI) * 0.12;
      const buckle = smoothstep(0, 0.35, u) * (1 - smoothstep(0.35, 0.8, u));
      standing.hips.y -= buckle * 0.12;
    } else if (this.downState === "down") {
      t = 1;
      headLag = 0;
    } else {
      // Rising: lying -> all fours -> one knee -> stand.
      const u = clamp(this.riseAge / GETUP_SECONDS, 0, 1);
      headLag = 0;
      const fours = {
        hips: vec(0.08 * mirror, 0.52, -0.18),
        hipsYaw: STANCE.bladeYaw * mirror * 0.4,
        hipsPitch: 1.0,
        hipsRoll: 0,
        shouldersYaw: STANCE.bladeYaw * mirror * 0.35,
        spinePitch: 0.15,
        headPitch: -0.5,
        leadHand: vec(0.26 * mirror, 0.02, 0.18),
        rearHand: vec(-0.24 * mirror, 0.02, 0.1),
        leadFoot: vec(0.17 * mirror, 0.05, -0.55),
        rearFoot: vec(-0.16 * mirror, 0.05, -0.6),
      };
      const knee = {
        hips: vec(0.03 * mirror, 0.66, -0.06),
        hipsYaw: STANCE.bladeYaw * mirror * 0.7,
        hipsPitch: 0.5,
        hipsRoll: 0,
        shouldersYaw: STANCE.bladeYaw * mirror * 0.6,
        spinePitch: 0.25,
        headPitch: -0.15,
        leadHand: vec(0.2 * mirror, 0.75, 0.3),
        rearHand: vec(-0.25 * mirror, 0.55, 0.05),
        leadFoot: vec(0.14 * mirror, 0.0, 0.3),
        rearFoot: vec(-0.14 * mirror, 0.06, -0.5),
      };
      const blend = (a: typeof lying, b: typeof lying, s: number): typeof lying => ({
        hips: a.hips.clone().lerp(b.hips, s),
        hipsYaw: THREE.MathUtils.lerp(a.hipsYaw, b.hipsYaw, s),
        hipsPitch: THREE.MathUtils.lerp(a.hipsPitch, b.hipsPitch, s),
        hipsRoll: THREE.MathUtils.lerp(a.hipsRoll, b.hipsRoll, s),
        shouldersYaw: THREE.MathUtils.lerp(a.shouldersYaw, b.shouldersYaw, s),
        spinePitch: THREE.MathUtils.lerp(a.spinePitch, b.spinePitch, s),
        headPitch: THREE.MathUtils.lerp(a.headPitch, b.headPitch, s),
        leadHand: a.leadHand.clone().lerp(b.leadHand, s),
        rearHand: a.rearHand.clone().lerp(b.rearHand, s),
        leadFoot: a.leadFoot.clone().lerp(b.leadFoot, s),
        rearFoot: a.rearFoot.clone().lerp(b.rearFoot, s),
      });
      let current: typeof lying;
      const stood = smoothstep(0.25, 1, u);
      if (this.fallKneel) current = blend(kneel, standing, stood);
      else if (u < 0.38) current = blend(down, fours, smoothstep(0, 0.38, u));
      else if (u < 0.72) current = blend(fours, knee, smoothstep(0.38, 0.72, u));
      else current = blend(knee, standing, smoothstep(0.72, 1, u));
      const away = 1 - smoothstep(0.3, 0.95, u);
      if (away > 0) {
        for (const point of [current.hips, current.leadHand, current.rearHand, current.leadFoot, current.rearFoot]) {
          point.x += this.riseOffset.x * away;
          point.z += this.riseOffset.z * away;
        }
      }
      this.writeDown(current, leadHand, rearHand, lead, rear, 0);
      if (this.fallKneel) this.orientKneel(1 - stood, mirror, clutchLead, leadHand, rearHand, lead, rear);
      return;
    }
    const mixed = {
      hips: standing.hips.clone().lerp(down.hips, t),
      hipsYaw: THREE.MathUtils.lerp(standing.hipsYaw, down.hipsYaw, t),
      hipsPitch: THREE.MathUtils.lerp(standing.hipsPitch, down.hipsPitch, t),
      hipsRoll: THREE.MathUtils.lerp(standing.hipsRoll, down.hipsRoll, t),
      shouldersYaw: THREE.MathUtils.lerp(standing.shouldersYaw, down.shouldersYaw, t),
      spinePitch: THREE.MathUtils.lerp(standing.spinePitch, down.spinePitch, t),
      headPitch: THREE.MathUtils.lerp(standing.headPitch, down.headPitch, t),
      leadHand: standing.leadHand.clone().lerp(down.leadHand, t),
      rearHand: standing.rearHand.clone().lerp(down.rearHand, t),
      leadFoot: standing.leadFoot.clone().lerp(down.leadFoot, t),
      rearFoot: standing.rearFoot.clone().lerp(down.rearFoot, t),
    };
    if (this.downState === "falling" && !this.fallKneel) {
      const flail = Math.sin(clamp(this.fallAge / KNOCKDOWN_FALL_SECONDS, 0, 1) * Math.PI) * 0.35;
      mixed.leadHand.y += flail;
      mixed.rearHand.y += flail * 0.8;
    }
    this.writeDown(mixed, leadHand, rearHand, lead, rear, headLag);
    if (this.fallKneel) this.orientKneel(t, mirror, clutchLead, leadHand, rearHand, lead, rear);
    void headRest;
  }

  /** The knees, feet and gloves of the kneel, which the lying poses' orientations do not fit. */
  private orientKneel(weight: number, mirror: number, clutchLead: boolean, leadHand: HandTarget, rearHand: HandTarget, lead: FootTarget, rear: FootTarget): void {
    if (weight <= 0.001) return;
    const struck = this.windedSide;
    const clutch = clutchLead ? leadHand : rearHand;
    const brace = clutchLead ? rearHand : leadHand;
    lead.pole.lerp(seatedScratch.set(0.15 * mirror, 0.35, 1), weight).normalize();
    rear.pole.lerp(seatedScratch.set(-0.1 * mirror, -1, 0.3), weight).normalize();
    lead.toe.lerp(seatedScratch.set(0.15 * mirror, 0, 1), weight).normalize();
    rear.toe.lerp(seatedScratch.set(0, -0.35, -1), weight).normalize();
    clutch.palm.lerp(seatedScratch.set(-struck * 0.75, 0, -0.65), weight).normalize();
    clutch.knuckles.lerp(seatedScratch.set(-struck * 0.35, 0.25, 0.9), weight).normalize();
    clutch.pole.lerp(seatedScratch.set(struck * 0.9, -0.35, -0.25), weight).normalize();
    brace.palm.lerp(seatedScratch.set(0, -1, 0.1), weight).normalize();
    brace.knuckles.lerp(seatedScratch.set(0.2 * mirror, -0.2, 1), weight).normalize();
    brace.pole.lerp(seatedScratch.set(mirror * 0.7, 0.1, -0.7), weight).normalize();
  }

  private writeDown(
    state: { hips: THREE.Vector3; hipsYaw: number; hipsPitch: number; hipsRoll: number; shouldersYaw: number; spinePitch: number; headPitch: number; leadHand: THREE.Vector3; rearHand: THREE.Vector3; leadFoot: THREE.Vector3; rearFoot: THREE.Vector3 },
    leadHand: { position: THREE.Vector3; knuckles: THREE.Vector3; palm: THREE.Vector3; pole: THREE.Vector3 },
    rearHand: { position: THREE.Vector3; knuckles: THREE.Vector3; palm: THREE.Vector3; pole: THREE.Vector3 },
    lead: { position: THREE.Vector3; toe: THREE.Vector3; heel: number; pole: THREE.Vector3 },
    rear: { position: THREE.Vector3; toe: THREE.Vector3; heel: number; pole: THREE.Vector3 },
    headLag: number,
  ): void {
    const torso = this.torso;
    torso.hips.copy(state.hips);
    torso.hipsYaw = state.hipsYaw;
    torso.hipsPitch = state.hipsPitch;
    torso.hipsRoll = state.hipsRoll;
    torso.shouldersYaw = state.shouldersYaw;
    torso.spinePitch = state.spinePitch;
    torso.spineRoll = 0;
    torso.headPitch = state.headPitch;
    torso.headYaw = 0;
    torso.headRoll = 0;
    torso.headOffset.set(0, 0, -headLag);
    leadHand.position.copy(state.leadHand);
    rearHand.position.copy(state.rearHand);
    leadHand.pole.set(0.4, 0.9, 0.2);
    rearHand.pole.set(-0.4, 0.9, 0.2);
    leadHand.knuckles.set(0.6, 0.2, -0.75).normalize();
    rearHand.knuckles.set(-0.6, 0.2, -0.75).normalize();
    leadHand.palm.set(0, 1, 0.2).normalize();
    rearHand.palm.set(0, 1, 0.2).normalize();
    lead.position.copy(state.leadFoot);
    rear.position.copy(state.rearFoot);
    lead.pole.set(0, 1, 0.35).normalize();
    rear.pole.set(0, 1, 0.35).normalize();
    lead.toe.set(0.2, 0, 1).normalize();
    rear.toe.set(-0.2, 0, 1).normalize();
    lead.heel = 0;
    rear.heel = 0;
  }

  private applyDislocation(): void {
    if (this.dislocation !== "jaw") return;
    const head = this.boxer.bone("head");
    if (head !== null) {
      head.quaternion.multiply(this.scratchQ.setFromEuler(new THREE.Euler(0.08, 0.2, -0.22)));
      head.updateWorldMatrix(false, true);
    }
  }

  dispose(): void {
    this.stool.dispose();
    this.enswell.dispose();
    this.bottle.dispose();
    this.boxer.dispose();
  }
}

const STOOL_SEAT_HEIGHT = 0.44;
const TOUCH_GLOVES_START_TICKS = 48;
const TOUCH_GLOVES_END_TICKS = 14;
const seatedScratch = new THREE.Vector3();

function buildEnswell(): { group: THREE.Group; dispose: () => void } {
  const group = new THREE.Group();
  group.name = "enswell";
  group.visible = false;
  const plateGeometry = new THREE.CylinderGeometry(3.2, 3.2, 0.9, 20);
  const handleGeometry = new THREE.CylinderGeometry(0.8, 0.8, 6, 10);
  const metal = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.3, metalness: 0.9 });
  const plate = new THREE.Mesh(plateGeometry, metal);
  plate.rotation.x = Math.PI / 2;
  plate.position.set(0, 9.5, 3.4);
  group.add(plate);
  const handle = new THREE.Mesh(handleGeometry, metal);
  handle.position.set(0, 5.5, 2.4);
  group.add(handle);
  return {
    group,
    dispose: () => {
      plateGeometry.dispose();
      handleGeometry.dispose();
      metal.dispose();
    },
  };
}

/** A squeeze bottle held at its base, the spout along the fingers. Centimetres, in the glove bone's frame. */
function buildBottle(): { group: THREE.Group; dispose: () => void } {
  const group = new THREE.Group();
  group.name = "bottle";
  group.visible = false;
  const bodyGeometry = new THREE.CylinderGeometry(3.3, 3.3, 15, 18);
  const shoulderGeometry = new THREE.CylinderGeometry(1.3, 3.3, 3, 18);
  const spoutGeometry = new THREE.CylinderGeometry(0.7, 1.1, 3.2, 10);
  const plastic = new THREE.MeshStandardMaterial({ color: 0xd9e6ee, roughness: 0.32, metalness: 0 });
  const cap = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.5, metalness: 0 });
  const body = new THREE.Mesh(bodyGeometry, plastic);
  body.position.set(0, 9, 2.6);
  const shoulder = new THREE.Mesh(shoulderGeometry, plastic);
  shoulder.position.set(0, 18, 2.6);
  const spout = new THREE.Mesh(spoutGeometry, cap);
  spout.position.set(0, 21, 2.6);
  group.add(body, shoulder, spout);
  return {
    group,
    dispose: () => {
      bodyGeometry.dispose();
      shoulderGeometry.dispose();
      spoutGeometry.dispose();
      plastic.dispose();
      cap.dispose();
    },
  };
}

function buildStool(): { group: THREE.Group; dispose: () => void } {
  const group = new THREE.Group();
  group.name = "stool";
  group.visible = false;
  const seatGeometry = new THREE.CylinderGeometry(0.17, 0.17, 0.035, 18);
  const legGeometry = new THREE.CylinderGeometry(0.012, 0.014, STOOL_SEAT_HEIGHT - 0.02, 8);
  const seatMaterial = new THREE.MeshStandardMaterial({ color: 0xc9c2b5, roughness: 0.85 });
  const legMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.45, metalness: 0.6 });
  const seat = new THREE.Mesh(seatGeometry, seatMaterial);
  seat.position.y = STOOL_SEAT_HEIGHT - 0.0175;
  seat.castShadow = true;
  group.add(seat);
  for (let index = 0; index < 4; index += 1) {
    const angle = Math.PI / 4 + (index * Math.PI) / 2;
    const leg = new THREE.Mesh(legGeometry, legMaterial);
    leg.position.set(Math.cos(angle) * 0.13, (STOOL_SEAT_HEIGHT - 0.02) / 2, Math.sin(angle) * 0.13);
    leg.rotation.set(-Math.sin(angle) * 0.12, 0, Math.cos(angle) * 0.12);
    leg.castShadow = true;
    group.add(leg);
  }
  return {
    group,
    dispose: () => {
      seatGeometry.dispose();
      legGeometry.dispose();
      seatMaterial.dispose();
      legMaterial.dispose();
    },
  };
}

const worldUpVector = new THREE.Vector3(0, 1, 0);
/** Most ticks of latency a predicted punch absorbs by stretching its startup; beyond this the hit is shown late instead. */
const MAX_OWN_LEAD_TICKS = 6;
const OWN_PUNCH_GRACE_TICKS = 5;
const OWN_PUNCH_PULL_RATE = 1.5;
const MIN_ANTICIPATION_RATE = 0.5;

/** Age in `to`'s timing at the same progress through the same phase as `age` in `from`'s. */
export function remapPunchAge(age: number, from: PunchTiming, to: PunchTiming): number {
  if (age < from.startup) return (age / Math.max(1, from.startup)) * to.startup;
  const active = age - from.startup;
  if (active < from.active) return to.startup + (active / Math.max(1, from.active)) * to.active;
  const recovery = Math.min(1, (active - from.active) / Math.max(1, from.recovery));
  return to.startup + to.active + recovery * to.recovery;
}
/** Metres per second the rendered root may move toward the authoritative position; above any walking speed so slow frames never fall behind. */
const ROOT_FOLLOW_SPEED = 6;

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
