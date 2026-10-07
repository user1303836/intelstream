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
import { BODY_SITES, HEAD_SITES, InjuryShading, applyBodyTrauma, applyHeadTrauma } from "./injury";
import { PoseSolver, STANCE, easeIn, easeOut, mirrorX, smoothstep, vec, type FootTarget, type HandTarget, type PoseDescription } from "./poser";
import { SolvedRig } from "./rig";
import { POST_RADIUS, type WorldMapping } from "./world";

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
let loadedScene: THREE.Object3D | null = null;

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
    cachedGltf = Promise.all([gltf, preloadFighterTextures()]).then(([loaded]) => {
      loadedScene = loaded.scene;
      return loaded;
    });
  }
  return cachedGltf;
}

/**
 * Every fighter shares the model's geometry and textures, and a rematch builds a new renderer on the
 * same graphics context: the last renderer frees their graphics copies, and the next uploads them again.
 */
export function releaseFighterGpu(): void {
  releaseSharedGpu(loadedScene, cachedTextures.values());
}

export function releaseSharedGpu(scene: THREE.Object3D | null, textures: Iterable<THREE.Texture>): void {
  scene?.traverse((object) => {
    if (object instanceof THREE.Mesh) object.geometry.dispose();
  });
  for (const texture of textures) texture.dispose();
}

/** Each skinned mesh's skeleton holds its bones in a texture on the graphics card. */
export function disposeSkeletons(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
  });
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
  readonly headInjury: InjuryShading;
  readonly bodyInjury: InjuryShading;
}

export function applyFighterSkin(target: THREE.Object3D, palette: BoxerPaletteColors): AppliedFighterMaterials {
  const skin: THREE.MeshPhysicalMaterial[] = [];
  const owned: THREE.Material[] = [];
  const bySource = new Map<string, THREE.MeshStandardMaterial>();
  let gloves: THREE.MeshStandardMaterial | null = null;
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
      const color = sourceName === "GlovesMat0" ? palette.gear : sourceName === "PantsMat0" ? (palette.pants ?? palette.gear) : 0xffffff;
      const map = sourceName === "MBodyMat0" && palette.bodyMap !== undefined ? palette.bodyMap : fighterTexture(textureName);
      material = isSkin
        ? new THREE.MeshPhysicalMaterial({ map, color, roughness: sourceName === "MBodyMat0" && palette.bodyMap !== undefined ? 0.85 : 0.58, metalness: 0.02, clearcoat: palette.bodyMap !== undefined && sourceName === "MBodyMat0" ? 0 : 0.25, clearcoatRoughness: 0.6 })
        : new THREE.MeshStandardMaterial({ map, color, roughness: 0.4, metalness: 0.03 });
      material.name = sourceName;
      bySource.set(sourceName, material);
      owned.push(material);
      if (material instanceof THREE.MeshPhysicalMaterial) skin.push(material);
      if (sourceName === "GlovesMat0") gloves = material;
      if (sourceName === "MHeadMat0") headInjury = new InjuryShading(material, HEAD_SITES);
      if (sourceName === "MBodyMat0") bodyInjury = new InjuryShading(material, BODY_SITES);
    }
    object.material = material;
    object.castShadow = true;
    object.receiveShadow = true;
    object.frustumCulled = false;
  });
  if (skin.length !== 2 || gloves === null || owned.length !== 5 || headInjury === null || bodyInjury === null) {
    throw new Error(`fighter GLB material contract failed: ${skin.length} skin, ${owned.length} total`);
  }
  return { skin, gloves, owned, headInjury, bodyInjury };
}

export interface BoxerPaletteColors {
  readonly skin: number;
  readonly gear: number;
  readonly pants?: number;
  readonly bodyMap?: THREE.Texture;
}

export type ArcadeDislocation = "jaw" | "shoulder_left" | "shoulder_right";

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
  private readonly ownedMaterials: readonly THREE.Material[];
  private readonly gearMaterial: THREE.MeshStandardMaterial;
  private readonly headMeshes: THREE.SkinnedMesh[] = [];
  private readonly handMeshes: Record<Hand, THREE.SkinnedMesh[]> = { left: [], right: [] };
  private decapitated = false;
  private readonly dismemberedHands: Record<Hand, boolean> = { left: false, right: false };
  readonly gearBaseColor: THREE.Color;
  readonly skinBaseColor: THREE.Color;
  readonly headInjury: InjuryShading;
  readonly bodyInjury: InjuryShading;

  constructor(gltf: GLTF, palette: BoxerPaletteColors) {
    const instance = cloneSkeleton(gltf.scene);
    instance.scale.setScalar(FIGHTER_MODEL_SCALE);
    this.root.add(instance);
    const materials = applyFighterSkin(instance, palette);
    this.skinMaterials = materials.skin;
    this.ownedMaterials = materials.owned;
    this.gearMaterial = materials.gloves;
    this.headInjury = materials.headInjury;
    this.bodyInjury = materials.bodyInjury;
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
    this.root.updateMatrixWorld(true);
    this.rig = new SolvedRig(this.root);
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

  get gloveGear(): THREE.MeshStandardMaterial {
    return this.gearMaterial;
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
    for (const material of this.ownedMaterials) material.dispose();
    disposeSkeletons(this.root);
  }
}

const BLOODED_GLOVE_COLOR = new THREE.Color(0x5c0a0e);

export type ReactionKind = "block" | "hit";

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
/** Damage of the hardest hit the engine deals (a countered power uppercut in a combination, about 153). */
const HARDEST_HIT = 150;
const KNOCKDOWN_FALL_SECONDS = 0.75;
/**
 * The get-up runs lying -> all fours (RISE_FOURS) -> one knee (RISE_KNEE) -> standing (1). While he is down it
 * follows the get-up meter, as far as one knee; once the server lets him up he can walk at once and act after
 * a 20-tick stun, so the rest takes at most GETUP_SECONDS, or GETUP_HURRIED_SECONDS once he moves or punches.
 */
const RISE_FOURS = 0.38;
const RISE_KNEE = 0.72;
const GETUP_SECONDS = 0.5;
const GETUP_HURRIED_SECONDS = 0.2;
/** How fast the get-up follows the meter while he is down, pushing up and sinking back. */
const RISE_PUSH_RATE = 0.55;
const RISE_SINK_RATE = 0.4;
/** Rolling off the back onto all fours is a big movement, never hurried past this. */
const RISE_ROLL_RATE = 0.7;

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
  private hitstop = 0;
  private hitstopScale = 1;
  private downState: "up" | "falling" | "down" | "rising" = "up";
  private fallAge = 0;
  /** How far along the get-up he is (see RISE_KNEE), and where it stood when the server let him up. */
  private riseProgress = 0;
  private riseFrom = 0;
  private fallSide = 0;
  private fallProne = false;
  /** The fall played: the punch's own, or the nearest variant that keeps the body inside the ropes, moved in as far as it must. */
  private landProne = false;
  private landSide = 0;
  private readonly landShift = new THREE.Vector3();
  private landSettled = false;
  private readonly liveOpponentHead = new THREE.Vector3();
  private hasLiveHead = false;
  private readonly headKick: Spring3 = { value: new THREE.Vector3(), velocity: new THREE.Vector3() };
  private readonly torsoKick: Spring3 = { value: new THREE.Vector3(), velocity: new THREE.Vector3() };
  private readonly rootKick: Spring3 = { value: new THREE.Vector3(), velocity: new THREE.Vector3() };
  /** x: how far the elbow on the side a body hook struck drops to cover the ribs (+ right, - left). */
  private readonly coverKick: Spring3 = { value: new THREE.Vector3(), velocity: new THREE.Vector3() };
  /** A body uppercut folds the fighter over it once the lift has peaked. */
  private foldDelay = 0;
  private pendingFold = 0;
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
  private lastSpeed = 0;
  private readonly stool: { group: THREE.Group; dispose: () => void };
  private readonly enswell: { group: THREE.Group; dispose: () => void };
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
  /** Scratch poses for the fall and the get-up: the live pose, the two being blended and the result. */
  private readonly downStanding = downPose();
  private readonly downFrom = downPose();
  private readonly downTo = downPose();
  private readonly downResult = downPose();
  /** The last pose written by `writeDown` and its share of the standing pose, where a fall that cuts into a get-up starts. */
  private downStand = 1;
  private readonly fallStart = downPose();
  private fallStartStand = 1;
  private fallFromGetUp = false;

  private readonly referee: boolean;
  private refereeCount = 0;
  private refereeCounting = false;

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
    this.downState = downed ? "down" : "up";
    this.landSettled = false;
    this.fallAge = downed ? KNOCKDOWN_FALL_SECONDS : 0;
    this.riseProgress = 0;
    this.hitstop = 0;
    this.hitstopScale = 1;
    for (const spring of [this.headKick, this.torsoKick, this.rootKick, this.coverKick]) {
      spring.value.set(0, 0, 0);
      spring.velocity.set(0, 0, 0);
    }
    this.foldDelay = 0;
    this.pendingFold = 0;
    this.guardKick = 0;
    this.stunAmount = 0;
    this.celebrateTime = 0;
    this.celebration = 0;
    this.waveTime = 0;
    this.wave = 0;
    this.seated = 0;
    this.stillTime = 0;
    this.rootX = null;
    this.yawInitialized = false;
    this.feetInitialized = false;
    this.retirePunch();
    this.completedActionId = null;
    this.retiredOwnIds.length = 0;
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
  treat(eye: THREE.Vector3 | null, facing?: THREE.Vector3, side = 1): void {
    this.treating = eye !== null;
    if (eye === null) return;
    this.treatTarget.copy(eye);
    if (facing !== undefined) this.treatFacing.copy(facing);
    this.treatSide = side;
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
    this.retirePunch();
    const timing = expected ?? punchTiming(action.class, action.target, action.power);
    this.punchClass = action.class;
    this.punchHand = action.hand;
    this.punchTarget = action.target;
    this.punchPower = action.power;
    this.punchTiming = timing;
    this.punchTotalTicks = Math.max(1, totalTicks(timing));
    this.punchAgeTicks = 0;
    this.punchActive = true;
    this.ownActionId = action.id;
    this.ownLeadTicks = clamp(leadTicks, 0, MAX_OWN_LEAD_TICKS);
    this.ownExpectedTicks = Math.max(0, leadTicks) + remaining;
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
   * legacy world-x sign used when the class is unknown. `amount` is the hit's
   * damage, which tops out at `HARDEST_HIT`.
   */
  react(kind: ReactionKind, target: Target = "head", direction = 1, punchClass: PunchClass | null = null, hand: Hand | null = null, amount = 90): void {
    const force = clamp(amount / HARDEST_HIT, 0, 1);
    const scale = (0.55 + force * 1.05) * (kind === "block" ? 0.35 : 1);
    const lateral = hand === "left" ? 1 : hand === "right" ? -1 : direction >= 0 ? -1 : 1;
    if (target === "body") {
      switch (punchClass) {
        case "hook":
          // Into the ribs from the side: the trunk bends around the fist, the hips give way from it and
          // the elbow on that side drops to cover.
          this.torsoKick.velocity.x += 3 * scale;
          this.torsoKick.velocity.z += 4.6 * scale * lateral;
          this.rootKick.velocity.x += 0.5 * scale * lateral;
          this.coverKick.velocity.x += 2.2 * scale * lateral;
          break;
        case "uppercut":
          // Up under the ribs: the blow lifts him onto his toes and straightens him, then he folds over it.
          this.rootKick.velocity.y += 0.9 * scale;
          this.torsoKick.velocity.x -= 1.6 * scale;
          this.foldDelay = 0.1;
          this.pendingFold = 5.2 * scale;
          break;
        default:
          this.torsoKick.velocity.x += 4.6 * scale;
          break;
      }
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
    if (kind === "hit") {
      this.dentSurface(target, lateral, punchClass, force);
      // A knockdown only gives the count, so every clean hit sets how the fighter would go down: a
      // hook or a body shot pitches him forward onto his face, anything else onto his back, and
      // either way he falls away from the side the punch came from, a hook twisting him furthest.
      this.fallSide = punchClass === "hook" ? lateral : lateral * 0.5;
      this.fallProne = punchClass === "hook" || target === "body";
    }
  }

  /** Transient compression of the struck surface at contact; the injury shading releases it. */
  private dentSurface(target: Target, lateral: number, punchClass: PunchClass | null, force: number): void {
    const depth = 1.1 + force * 2.1;
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
    for (let index = 0; index < 2; index += 1) {
      const foot = this.feet[index]!;
      const isLead = (index === 0) === (mirror > 0);
      const offset = isLead ? STANCE.leadFoot : STANCE.rearFoot;
      if (this.referee) desired.set((index === 0 ? 0.16 : -0.16), 0, index === 0 ? 0.02 : -0.02).applyQuaternion(rotate).add(rootPosition);
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

  /** Writes the foot's world position into `out` and returns how high it is lifted mid-step. */
  private footWorld(index: 0 | 1, out: THREE.Vector3): number {
    const foot = this.feet[index];
    if (!foot.stepping) {
      out.copy(foot.planted);
      return 0;
    }
    const t = easeOut(foot.progress, 1.6);
    out.copy(foot.from).lerp(foot.to, t);
    return Math.sin(foot.progress * Math.PI) * 0.055;
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
    // On the canvas and getting up he turns with his whole body on the ground, so more slowly.
    const turnRate = this.punchActive ? 3 : this.downState === "up" ? 9 : 4;
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
    this.treatWeight = smooth(this.treatWeight, this.treating ? 1 : 0, 3, dt);
    this.enswell.group.visible = this.treatWeight > 0.4;
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

    springStep(this.headKick, dt, 190, 7.5, 0.24);
    springStep(this.torsoKick, dt, 150, 7, 0.7);
    springStep(this.rootKick, dt, 120, 8, 0.12);
    springStep(this.coverKick, dt, 110, 15, 0.3);
    if (this.foldDelay > 0) {
      this.foldDelay -= dt;
      if (this.foldDelay <= 0) {
        this.torsoKick.velocity.x += this.pendingFold;
        this.pendingFold = 0;
      }
    }
    this.guardKick = Math.max(0, this.guardKick - dt * 2.4);

    this.updateDownState(fighter, dt, speed);

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
    // Getting up, the feet are planted again under him and step as he turns or walks, ready for the standing pose.
    if (this.downState === "up" || this.downState === "rising") this.stepFeet(dt, mirror, speed, velocityWorld, rootPosition, this.yaw);
    const rootQuatInverse = this.scratchQ.setFromAxisAngle(worldUpVector, -this.yaw);
    const lead = mirror > 0 ? this.foot.L : this.foot.R;
    const rear = mirror > 0 ? this.foot.R : this.foot.L;
    const leadIndex: 0 | 1 = mirror > 0 ? 0 : 1;
    const rearIndex: 0 | 1 = mirror > 0 ? 1 : 0;
    const leadLift = this.footWorld(leadIndex, lead.position);
    const rearLift = this.footWorld(rearIndex, rear.position);
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

    // Reactions.
    torso.headOffset.add(this.headKick.value);
    torso.headPitch += -this.headKick.value.z * 2.4 + this.headKick.value.y * 1.6;
    torso.headYaw += this.headKick.value.x * 2.2;
    torso.headRoll += -this.headKick.value.x * 0.9;
    torso.spinePitch += this.torsoKick.value.x;
    torso.spineRoll += this.torsoKick.value.z * 0.5;
    torso.hips.x += this.rootKick.value.x;
    torso.hips.z += this.rootKick.value.z;
    torso.hips.y -= Math.max(0, this.torsoKick.value.x) * 0.08;
    if (this.torsoKick.value.x > 0.05) {
      leadHand.position.y -= this.torsoKick.value.x * 0.25;
      rearHand.position.y -= this.torsoKick.value.x * 0.2;
      leadHand.position.z -= this.torsoKick.value.x * 0.1;
    }
    // A body uppercut lifts the fighter onto his toes.
    const lift = Math.max(0, this.rootKick.value.y);
    torso.hips.y += lift;
    lead.heel += lift * 6;
    rear.heel += lift * 6;
    const cover = this.coverKick.value.x;
    if (Math.abs(cover) > 0.002) {
      const near = cover > 0 ? this.hand.R : this.hand.L;
      near.position.y -= Math.abs(cover) * 0.9;
      near.position.x += cover * 0.2;
      near.position.z -= Math.abs(cover) * 0.25;
      near.pole.y -= Math.abs(cover) * 3;
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

    // Knockdown overrides everything above.
    if (this.touchWeight > 0.001 && this.downState === "up") this.applyTouchGlovesPose(this.touchWeight, mirror, leadHand, rearHand);
    if (this.celebration > 0.001 && this.downState === "up") this.applyCelebratePose(this.celebration, time, mirror, leadHand, rearHand, lead, rear);
    if (this.wave > 0.001 && this.downState === "up") this.applyWaveOffPose(this.wave, time, mirror, leadHand, rearHand);
    if (this.breakWeight > 0.001 && this.downState === "up") this.applyBreakPose(this.breakWeight, mirror, leadHand, rearHand);
    if (this.attendWeight > 0.001 && this.downState === "up") this.applyAttendPose(this.attendWeight, time, mirror, leadHand, rearHand);
    if (this.treatWeight > 0.001 && this.downState === "up") this.applyTreatPose(this.treatWeight, time, mirror, leadHand, rearHand, lead, rear);
    if (this.seated > 0.001 && this.downState === "up") this.applySeatedPose(this.seated, time, mirror, leadHand, rearHand, lead, rear);
    if (this.downState !== "up") this.applyDownPose(mirror, leadHand, rearHand, lead, rear);

    crouch = 0;
    void crouch;
    const pose = this.pose as { shrugL: number; shrugR: number };
    pose.shrugL = mirror > 0 ? shrugLead : shrugRear;
    pose.shrugR = mirror > 0 ? shrugRear : shrugLead;
    this.solver.apply(boxer.root, this.pose);
    this.applyDislocation();

    const opponentBlood = Math.min(
      1,
      (opponent.trauma.bleeding + opponent.trauma.left_cut + opponent.trauma.right_cut) / 620
        * (blood === "off" ? 0 : blood === "reduced" ? 0.3 : 1.5),
    );
    boxer.gloveGear.color.copy(boxer.gearBaseColor).lerp(BLOODED_GLOVE_COLOR, opponentBlood);
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

  private updateDownState(fighter: FighterSnapshot, dt: number, speed: number): void {
    if (fighter.is_downed) {
      if (this.downState === "up" || this.downState === "rising") {
        // Knocked down again while getting up, he falls from where the get-up had him, not from standing.
        this.fallFromGetUp = this.downState === "rising";
        if (this.fallFromGetUp) {
          copyDownPose(this.fallStart, this.downResult);
          this.fallStartStand = this.downStand;
        }
        this.downState = "falling";
        this.fallAge = 0;
        this.riseProgress = 0;
        this.landSettled = false;
      } else if (this.downState === "falling") {
        this.fallAge += dt;
        if (this.fallAge >= KNOCKDOWN_FALL_SECONDS) this.downState = "down";
      } else {
        // Each good press of the get-up prompt pushes him further up; a bad one lets him sink back.
        const meter = fighter.get_up_required > 0 ? clamp(fighter.get_up_meter / fighter.get_up_required, 0, 1) : 0;
        const target = meter * RISE_KNEE;
        this.riseProgress += clamp(target - this.riseProgress, -RISE_SINK_RATE * dt, RISE_PUSH_RATE * dt);
      }
      return;
    }
    if (this.downState === "down" || this.downState === "falling") {
      this.downState = "rising";
      this.riseFrom = this.riseProgress;
      this.feetInitialized = false;
    }
    if (this.downState !== "rising") return;
    // The server already has him fighting: finish inside the stun, sooner if he walks or throws.
    const hurried = speed > 0.3 || this.punchActive;
    const rate = (1 - this.riseFrom) / (hurried ? GETUP_HURRIED_SECONDS : GETUP_SECONDS);
    this.riseProgress = Math.min(1, this.riseProgress + (this.riseProgress < RISE_FOURS ? Math.min(rate, RISE_ROLL_RATE) : rate) * dt);
    if (this.riseProgress >= 1) this.downState = "up";
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
    const reach = 0.08 - press;
    leadHand.position.lerp(this.treatScratch.set(eye.x + facing.x * reach, eye.y - 0.07, eye.z + facing.z * reach), blend);
    leadHand.knuckles.lerp(this.treatScratch.set(0, 1, 0.05), blend).normalize();
    leadHand.palm.lerp(this.treatScratch.set(-facing.x, 0, -facing.z), blend).normalize();
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
    // Foot targets are ankle joints: the soles rest on the canvas.
    const ankle = this.boxer.rig.metrics.ankleHeight;
    lead.position.lerp(seatedScratch.set(0.18 * mirror, ankle, 0.4), blend);
    rear.position.lerp(seatedScratch.set(-0.18 * mirror, ankle, 0.38), blend);
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
  ): void {
    const torso = this.torso;
    const standing = this.downStanding;
    standing.hips.copy(torso.hips);
    standing.hipsYaw = torso.hipsYaw;
    standing.hipsPitch = torso.hipsPitch;
    standing.hipsRoll = torso.hipsRoll;
    standing.shouldersYaw = torso.shouldersYaw;
    standing.spinePitch = torso.spinePitch;
    standing.headPitch = torso.headPitch;
    standing.leadHand.copy(leadHand.position);
    standing.rearHand.copy(rearHand.position);
    standing.leadFoot.copy(lead.position);
    standing.rearFoot.copy(rear.position);
    standing.leadHeel = lead.heel;
    standing.rearHeel = rear.heel;
    // Where he lands is chosen while the fall is still barely visible (the hit that decides it can arrive a
    // frame after the knockdown), then kept.
    if (!this.landSettled) this.chooseLanding(mirror);
    this.landSettled = this.downState !== "falling" || this.fallAge > KNOCKDOWN_FALL_SECONDS * 0.15;
    const pose = this.downResult;
    if (this.downState !== "falling") {
      // Down and getting up: lying -> all fours -> one knee -> stand, as far as the get-up has come.
      const u = this.riseProgress;
      let stand = 0;
      if (u < RISE_FOURS) {
        const s = smoothstep(0, RISE_FOURS, u);
        const lying = this.placeLying(mirror);
        const fours = this.placeDown(this.downTo, ALL_FOURS, mirror);
        lerpDownPose(pose, lying, fours, s);
        // Face down, he pushes up on his gloves before the knees come under him: the hips rise first.
        if (this.landProne) pose.hips.y = THREE.MathUtils.lerp(lying.hips.y, fours.hips.y, easeOut(s, 3));
      } else if (u < RISE_KNEE) {
        lerpDownPose(pose, this.placeDown(this.downFrom, ALL_FOURS, mirror), this.placeDown(this.downTo, ONE_KNEE, mirror), smoothstep(RISE_FOURS, RISE_KNEE, u));
      } else {
        stand = smoothstep(RISE_KNEE, 1, u);
        lerpDownPose(pose, this.placeDown(this.downFrom, ONE_KNEE, mirror), standing, stand);
      }
      this.writeDown(pose, mirror, leadHand, rearHand, lead, rear, 0, stand);
      return;
    }
    const lying = this.placeLying(mirror);
    const u = clamp(this.fallAge / KNOCKDOWN_FALL_SECONDS, 0, 1);
    const t = easeIn(u, 2.1);
    const start = this.fallFromGetUp ? this.fallStart : standing;
    if (!this.fallFromGetUp) standing.hips.y -= smoothstep(0, 0.35, u) * (1 - smoothstep(0.35, 0.8, u)) * 0.12;
    lerpDownPose(pose, start, lying, t);
    // The feet slide out from under him while he is still high, so his knees never fold through the canvas;
    // knocked down from his knees, the folded legs go with him from the start.
    const feet = this.fallFromGetUp ? smoothstep(0, 0.6, u) : smoothstep(0.3, 0.9, u);
    pose.leadFoot.lerpVectors(start.leadFoot, lying.leadFoot, feet);
    pose.rearFoot.lerpVectors(start.rearFoot, lying.rearFoot, feet);
    pose.leadHeel = THREE.MathUtils.lerp(start.leadHeel, lying.leadHeel, feet);
    pose.rearHeel = THREE.MathUtils.lerp(start.rearHeel, lying.rearHeel, feet);
    if (this.landProne) {
      // Pitching forward, the gloves reach out ahead of him to break the fall.
      const reach = easeOut(u, 2.5);
      pose.leadHand.lerpVectors(start.leadHand, lying.leadHand, reach);
      pose.rearHand.lerpVectors(start.rearHand, lying.rearHand, reach);
    } else {
      const flail = Math.sin(u * Math.PI) * 0.35;
      pose.leadHand.y += flail;
      pose.rearHand.y += flail * 0.8;
    }
    const stand = (this.fallFromGetUp ? this.fallStartStand : 1) * (1 - t);
    this.writeDown(pose, mirror, leadHand, rearHand, lead, rear, Math.sin(u * Math.PI) * 0.12, stand);
  }

  /** The pose the fighter ends up in on the canvas: face down or on his back, twisted by the fall side. */
  private placeLying(mirror: number): DownPose {
    const ankle = this.boxer.rig.metrics.ankleHeight;
    const pose = this.landProne
      ? placeDownPose(this.downFrom, PRONE, PRONE_TWIST, mirror, this.landSide, ankle)
      : placeDownPose(this.downFrom, LYING, LYING_TWIST, mirror, this.landSide, ankle);
    return moveDownPose(pose, this.landShift);
  }

  /** A get-up stage, over the root: a body that landed moved in from the ropes comes back as he gets onto all fours. */
  private placeDown(out: DownPose, base: DownPose, mirror: number): DownPose {
    return placeDownPose(out, base, null, mirror, 0, this.boxer.rig.metrics.ankleHeight);
  }

  /**
   * Picks the fall that keeps the body inside the ropes: the punch's own when it fits, otherwise the variant
   * (untwisted, twisted the other way, or falling the other way round) that needs the least moving in from
   * the ropes, counting each change from the punch's fall as some distance moved.
   */
  private chooseLanding(mirror: number): void {
    const ankle = this.boxer.rig.metrics.ankleHeight;
    let best = Infinity;
    for (let index = 0; index < LANDINGS.length; index += 1) {
      const [otherWay, twist, cost] = LANDINGS[index]!;
      const prone = this.fallProne !== otherWay;
      const side = this.fallSide * twist;
      const pose = placeDownPose(this.downTo, prone ? PRONE : LYING, prone ? PRONE_TWIST : LYING_TWIST, mirror, side, ankle);
      const shift = this.ropeShift(pose, this.scratchE);
      if (shift.length() + cost >= best) continue;
      best = shift.length() + cost;
      this.landProne = prone;
      this.landSide = side;
      this.landShift.copy(shift);
    }
  }

  /** How far, in character space, a body lying in `pose` must move to stay inside the ropes. */
  private ropeShift(pose: DownPose, out: THREE.Vector3): THREE.Vector3 {
    const turn = this.scratchQ.setFromAxisAngle(worldUpVector, this.yaw);
    // The head and shoulders sit along the spine from the hips (the elbows bend out past the shoulders); the
    // feet reach past the ankles to the toes, or to the heels when they are up on their toes.
    downEuler.set(pose.hipsPitch + pose.spinePitch * 0.7, pose.hipsYaw, pose.hipsRoll, "YXZ");
    REACH_POINTS[0]!.set(0, HIPS_TO_HEAD, 0).applyEuler(downEuler).add(pose.hips);
    REACH_POINTS[1]!.set(0.2, HIPS_TO_SHOULDERS, 0).applyEuler(downEuler).add(pose.hips);
    REACH_POINTS[2]!.set(-0.2, HIPS_TO_SHOULDERS, 0).applyEuler(downEuler).add(pose.hips);
    REACH_POINTS[3]!.copy(pose.leadHand);
    REACH_POINTS[4]!.copy(pose.rearHand);
    REACH_POINTS[5]!.copy(pose.leadFoot).z += pose.leadHeel > 0 ? 0.25 : 0.19;
    REACH_POINTS[6]!.copy(pose.rearFoot).z += pose.rearHeel > 0 ? 0.25 : 0.19;
    REACH_POINTS[7]!.copy(pose.hips);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let index = 0; index < REACH_POINTS.length; index += 1) {
      const point = REACH_POINTS[index]!.applyQuaternion(turn);
      const radius = REACH_RADII[index]!;
      minX = Math.min(minX, (this.rootX ?? 0) + point.x - radius);
      maxX = Math.max(maxX, (this.rootX ?? 0) + point.x + radius);
      minZ = Math.min(minZ, this.rootZ + point.z - radius);
      maxZ = Math.max(maxZ, this.rootZ + point.z + radius);
    }
    return out.set(fitInsideRopes(minX, maxX), 0, fitInsideRopes(minZ, maxZ)).applyQuaternion(turn.invert());
  }

  /**
   * Writes a down or rising pose over the targets. `stand` is the share of the live standing pose in
   * it: what the standing layers set (the guard's arm and knee directions, reactions) fades out on the
   * way down and back in on the way up.
   */
  private writeDown(
    state: DownPose,
    mirror: number,
    leadHand: { position: THREE.Vector3; knuckles: THREE.Vector3; palm: THREE.Vector3; pole: THREE.Vector3 },
    rearHand: { position: THREE.Vector3; knuckles: THREE.Vector3; palm: THREE.Vector3; pole: THREE.Vector3 },
    lead: { position: THREE.Vector3; toe: THREE.Vector3; heel: number; pole: THREE.Vector3 },
    rear: { position: THREE.Vector3; toe: THREE.Vector3; heel: number; pole: THREE.Vector3 },
    headLag: number,
    stand: number,
  ): void {
    const torso = this.torso;
    const down = 1 - stand;
    this.downStand = stand;
    torso.hips.copy(state.hips);
    torso.hipsYaw = state.hipsYaw;
    torso.hipsPitch = state.hipsPitch;
    torso.hipsRoll = state.hipsRoll;
    torso.shouldersYaw = state.shouldersYaw;
    torso.spinePitch = state.spinePitch;
    torso.spineRoll *= stand;
    torso.headPitch = state.headPitch;
    torso.headYaw *= stand;
    torso.headRoll *= stand;
    torso.headOffset.multiplyScalar(stand);
    torso.headOffset.z -= headLag;
    leadHand.position.copy(state.leadHand);
    rearHand.position.copy(state.rearHand);
    turnDownArm(leadHand, mirror, state.palmsDown, down);
    turnDownArm(rearHand, -mirror, state.palmsDown, down);
    lead.position.copy(state.leadFoot);
    rear.position.copy(state.rearFoot);
    lead.toe.lerp(downScratch.set(0.2 * mirror, 0, 1).normalize(), down).normalize();
    rear.toe.lerp(downScratch.set(-0.2 * mirror, 0, 1).normalize(), down).normalize();
    lead.heel = state.leadHeel;
    rear.heel = state.rearHeel;
    // Knees bend the way the pelvis faces, whether that is the sky, the canvas or the opponent.
    const forward = downScratch.set(0, 0, 1).applyEuler(downEuler.set(state.hipsPitch, state.hipsYaw, state.hipsRoll, "YXZ"));
    lead.pole.lerp(forward, down);
    rear.pole.lerp(forward, down);
  }

  private applyDislocation(): void {
    if (this.dislocation !== "jaw") return;
    const head = this.boxer.bone("head");
    if (head !== null) {
      head.quaternion.multiply(JAW_DISLOCATION);
      head.updateWorldMatrix(false, true);
    }
  }

  dispose(): void {
    this.stool.dispose();
    this.enswell.dispose();
    this.boxer.dispose();
  }
}

const STOOL_SEAT_HEIGHT = 0.44;
const TOUCH_GLOVES_START_TICKS = 48;
const TOUCH_GLOVES_END_TICKS = 14;
const seatedScratch = new THREE.Vector3();
const JAW_DISLOCATION = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.08, 0.2, -0.22));

/** A whole-body pose on the way down and back up, in character space. */
interface DownPose {
  readonly hips: THREE.Vector3;
  hipsYaw: number;
  hipsPitch: number;
  hipsRoll: number;
  shouldersYaw: number;
  spinePitch: number;
  headPitch: number;
  readonly leadHand: THREE.Vector3;
  readonly rearHand: THREE.Vector3;
  /** Ankle positions; the tables give the sole's height above the canvas instead. */
  readonly leadFoot: THREE.Vector3;
  readonly rearFoot: THREE.Vector3;
  /** Heel lift: a foot pitched onto its toes, as on the canvas behind a kneeling or prone fighter. */
  leadHeel: number;
  rearHeel: number;
  /** 0 with the arms thrown out palm-up, 1 with the gloves pressed palm-down on the canvas. */
  palmsDown: number;
}

const downScratch = new THREE.Vector3();
const downEuler = new THREE.Euler();
/** Arm directions on the canvas for an orthodox fighter's lead arm, thrown out palm-up or pressing palm-down. */
const PALM_UP = { pole: vec(0.4, 0.9, 0.2), knuckles: vec(0.6, 0.2, -0.75).normalize(), palm: vec(0, 1, 0.2).normalize() };
const PALM_DOWN = { pole: vec(0.6, 0.2, -0.7), knuckles: vec(0.25, -0.1, 1).normalize(), palm: vec(0, -1, 0.1).normalize() };

/** Turns an arm from its standing directions toward the down ones; `sideX` mirrors x for the stance and the arm. */
function turnDownArm(hand: { knuckles: THREE.Vector3; palm: THREE.Vector3; pole: THREE.Vector3 }, sideX: number, palmsDown: number, down: number): void {
  downScratch.lerpVectors(PALM_UP.pole, PALM_DOWN.pole, palmsDown);
  downScratch.x *= sideX;
  hand.pole.lerp(downScratch, down);
  downScratch.lerpVectors(PALM_UP.knuckles, PALM_DOWN.knuckles, palmsDown);
  downScratch.x *= sideX;
  hand.knuckles.lerp(downScratch.normalize(), down).normalize();
  downScratch.lerpVectors(PALM_UP.palm, PALM_DOWN.palm, palmsDown);
  downScratch.x *= sideX;
  hand.palm.lerp(downScratch.normalize(), down).normalize();
}

function downPose(pose: Partial<DownPose> = {}): DownPose {
  return {
    hips: new THREE.Vector3(),
    hipsYaw: 0,
    hipsPitch: 0,
    hipsRoll: 0,
    shouldersYaw: 0,
    spinePitch: 0,
    headPitch: 0,
    leadHand: new THREE.Vector3(),
    rearHand: new THREE.Vector3(),
    leadFoot: new THREE.Vector3(),
    rearFoot: new THREE.Vector3(),
    leadHeel: 0,
    rearHeel: 0,
    palmsDown: 0,
    ...pose,
  };
}

// The authored poses are for an orthodox fighter; a twist table is added per unit of fall side.
/** Lying on the back with the knees up; turning the hips swings the head the opposite way. */
const LYING = downPose({
  hips: vec(0, 0.14, -0.4), hipsPitch: -1.42, spinePitch: 0.1, headPitch: -0.5,
  leadHand: vec(0.52, 0.1, -0.62), rearHand: vec(-0.5, 0.1, -0.7), leadFoot: vec(0.17, 0, 0.16), rearFoot: vec(-0.16, 0, -0.02),
});
const LYING_TWIST = downPose({ hips: vec(0.22, 0, 0), hipsYaw: -0.35, hipsRoll: -0.25, shouldersYaw: -0.2, leadFoot: vec(0.05, 0, 0), rearFoot: vec(0.05, 0, 0) });
/** Face down after a hook or a body shot, on the toes: the fighter pitches forward over the front foot. */
const PRONE = downPose({
  hips: vec(0, 0.25, 0.32), hipsPitch: 1.5, spinePitch: 0.05, headPitch: 0.2, palmsDown: 1,
  leadHand: vec(0.34, 0.12, 0.78), rearHand: vec(-0.3, 0.12, 0.62), leadFoot: vec(0.16, 0, -0.82), rearFoot: vec(-0.15, 0, -0.86), leadHeel: 1.3, rearHeel: 1.3,
});
const PRONE_TWIST = downPose({ hips: vec(0.12, 0, 0), hipsYaw: 0.3, hipsRoll: 0.15, shouldersYaw: 0.15, leadFoot: vec(0.04, 0, 0), rearFoot: vec(0.04, 0, 0) });
/** The get-up's first stage, on the gloves and knees with the toes tucked under. */
const ALL_FOURS = downPose({
  hips: vec(0.05, 0.52, -0.2), hipsYaw: STANCE.bladeYaw * 0.15, hipsPitch: 1.38, shouldersYaw: STANCE.bladeYaw * 0.15, spinePitch: 0.35, headPitch: 1.0, palmsDown: 1,
  leadHand: vec(0.2, 0.115, 0.36), rearHand: vec(-0.2, 0.115, 0.32), leadFoot: vec(0.15, 0, -0.74), rearFoot: vec(-0.14, 0, -0.78), leadHeel: 1.25, rearHeel: 1.25,
});
/** The get-up's second stage, on the rear knee with the lead foot planted and a glove on the knee. */
const ONE_KNEE = downPose({
  hips: vec(0, 0.47, -0.05), hipsYaw: STANCE.bladeYaw * 0.12, hipsPitch: 0.2, shouldersYaw: STANCE.bladeYaw * 0.4, spinePitch: 0.3, headPitch: 0.2, palmsDown: 1,
  leadHand: vec(0.15, 0.68, 0.32), rearHand: vec(-0.26, 0.42, 0.02), leadFoot: vec(0.15, 0, 0.36), rearFoot: vec(-0.13, 0, -0.7), rearHeel: 1.2,
});

/** Writes `base` mirrored for the stance, plus `twist` per unit of `side`, into `out`, with the feet raised by `ankle`. */
function placeDownPose(out: DownPose, base: DownPose, twist: DownPose | null, mirror: number, side: number, ankle: number): DownPose {
  out.hips.set(base.hips.x * mirror, base.hips.y, base.hips.z);
  out.hipsYaw = base.hipsYaw * mirror;
  out.hipsPitch = base.hipsPitch;
  out.hipsRoll = base.hipsRoll * mirror;
  out.shouldersYaw = base.shouldersYaw * mirror;
  out.spinePitch = base.spinePitch;
  out.headPitch = base.headPitch;
  mirrorX(base.leadHand, mirror, out.leadHand);
  mirrorX(base.rearHand, mirror, out.rearHand);
  mirrorX(base.leadFoot, mirror, out.leadFoot).y += ankle;
  mirrorX(base.rearFoot, mirror, out.rearFoot).y += ankle;
  out.leadHeel = base.leadHeel;
  out.rearHeel = base.rearHeel;
  out.palmsDown = base.palmsDown;
  if (twist === null || side === 0) return out;
  out.hips.addScaledVector(twist.hips, side);
  out.hipsYaw += twist.hipsYaw * side;
  out.hipsPitch += twist.hipsPitch * side;
  out.hipsRoll += twist.hipsRoll * side;
  out.shouldersYaw += twist.shouldersYaw * side;
  out.spinePitch += twist.spinePitch * side;
  out.headPitch += twist.headPitch * side;
  out.leadHand.addScaledVector(twist.leadHand, side);
  out.rearHand.addScaledVector(twist.rearHand, side);
  out.leadFoot.addScaledVector(twist.leadFoot, side);
  out.rearFoot.addScaledVector(twist.rearFoot, side);
  return out;
}

/** Moves a whole pose by `shift` (character space). */
function moveDownPose(pose: DownPose, shift: THREE.Vector3): DownPose {
  pose.hips.add(shift);
  pose.leadHand.add(shift);
  pose.rearHand.add(shift);
  pose.leadFoot.add(shift);
  pose.rearFoot.add(shift);
  return pose;
}

/** The rope line between the corner posts (as built in ring.ts), less a margin for the rough reach of a lying body. */
const ROPE_LINE = POST_RADIUS * 0.72 - 0.05;
/** Hips to the head bone, and to the shoulder line, along the spine of a body lying on the canvas. */
const HIPS_TO_HEAD = 0.78;
const HIPS_TO_SHOULDERS = 0.5;
/** Head, shoulders, gloves, feet and hips of a lying body, and how far the mesh reaches around each. */
const REACH_POINTS = Array.from({ length: 8 }, () => new THREE.Vector3());
const REACH_RADII = [0.17, 0.22, 0.22, 0.13, 0.13, 0.12, 0.12, 0.2] as const;
/** Falls tried near the ropes: [the other way round, the punch's twist scaled by, cost of the change in metres]. */
const LANDINGS: readonly (readonly [boolean, number, number])[] = [
  [false, 1, 0],
  [false, 0, 0.15],
  [false, -1, 0.3],
  [true, 1, 0.4],
  [true, 0, 0.5],
  [true, -1, 0.6],
];

/** The move along one axis that brings the span [low, high] inside the rope line (centred if it cannot fit). */
function fitInsideRopes(low: number, high: number): number {
  if (low < -ROPE_LINE && high > ROPE_LINE) return -(low + high) / 2;
  if (low < -ROPE_LINE) return -ROPE_LINE - low;
  if (high > ROPE_LINE) return ROPE_LINE - high;
  return 0;
}

function copyDownPose(out: DownPose, from: DownPose): DownPose {
  return lerpDownPose(out, from, from, 0);
}

/** Writes the blend from `a` to `b` into `out`, which may be `a` but not `b`. */
function lerpDownPose(out: DownPose, a: DownPose, b: DownPose, t: number): DownPose {
  const lerp = THREE.MathUtils.lerp;
  out.hips.copy(a.hips).lerp(b.hips, t);
  out.hipsYaw = lerp(a.hipsYaw, b.hipsYaw, t);
  out.hipsPitch = lerp(a.hipsPitch, b.hipsPitch, t);
  out.hipsRoll = lerp(a.hipsRoll, b.hipsRoll, t);
  out.shouldersYaw = lerp(a.shouldersYaw, b.shouldersYaw, t);
  out.spinePitch = lerp(a.spinePitch, b.spinePitch, t);
  out.headPitch = lerp(a.headPitch, b.headPitch, t);
  out.leadHand.copy(a.leadHand).lerp(b.leadHand, t);
  out.rearHand.copy(a.rearHand).lerp(b.rearHand, t);
  out.leadFoot.copy(a.leadFoot).lerp(b.leadFoot, t);
  out.rearFoot.copy(a.rearFoot).lerp(b.rearFoot, t);
  out.leadHeel = lerp(a.leadHeel, b.leadHeel, t);
  out.rearHeel = lerp(a.rearHeel, b.rearHeel, t);
  out.palmsDown = lerp(a.palmsDown, b.palmsDown, t);
  return out;
}

function buildEnswell(): { group: THREE.Group; dispose: () => void } {
  const group = new THREE.Group();
  group.name = "enswell";
  group.visible = false;
  const plateGeometry = new THREE.CylinderGeometry(0.03, 0.03, 0.008, 16);
  const handleGeometry = new THREE.CylinderGeometry(0.008, 0.008, 0.06, 8);
  const metal = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.3, metalness: 0.9 });
  const plate = new THREE.Mesh(plateGeometry, metal);
  plate.rotation.x = Math.PI / 2;
  plate.position.set(0, 0.07, 0.075);
  group.add(plate);
  const handle = new THREE.Mesh(handleGeometry, metal);
  handle.position.set(0, 0.035, 0.075);
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
