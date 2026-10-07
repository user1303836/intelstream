import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { GLOVE_HITBOX_RADIUS, HURTBOXES, cancelsRecovery, punchTiming, recoveryCancelAge, totalTicks, type PunchTiming } from "../manifest";
import type { BloodLevel } from "../settings";
import type { CombatEvent, FighterSnapshot, Hand, Power, PunchAction, PunchClass, SemanticAction, Target } from "../types";
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
import { CANVAS_TOP, PLATFORM_HALF, POST_RADIUS, type WorldMapping } from "./world";

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
  readonly skin: readonly THREE.MeshStandardMaterial[];
  readonly gloveBlood: { value: number };
  readonly trunksBlood: { value: number };
  readonly owned: readonly THREE.Material[];
  readonly headInjury: InjuryShading;
  readonly bodyInjury: InjuryShading;
}

/**
 * Lifts a posed vertex that is under the ring's floor onto it, in the mesh's own space, just before it is projected.
 * Off the platform the floor is the arena's, a metre lower, and a vertex there is left alone.
 */
export const PRESS_ONTO_CANVAS_GLSL = /* glsl */ `{
  vec4 pressedOntoCanvas = modelMatrix * vec4( transformed, 1.0 );
  if ( pressedOntoCanvas.y < ${CANVAS_TOP.toFixed(4)} && max( abs( pressedOntoCanvas.x ), abs( pressedOntoCanvas.z ) ) < ${PLATFORM_HALF.toFixed(4)} ) {
    transformed += inverse( mat3( modelMatrix ) ) * vec3( 0.0, ${CANVAS_TOP.toFixed(4)} - pressedOntoCanvas.y, 0.0 );
  }
}`;

/**
 * Skin and kit meet the canvas instead of passing through it: a vertex the skeleton puts below the canvas is drawn on
 * it, as flesh or cloth pressed flat on the floor. A body lying on the canvas rests on spheres at its joints, which the
 * calves, the loose trunks and the gloves' padding reach past: they went 5-10 cm under it. Composes with a shader
 * patch already on the material.
 */
export function pressOntoCanvas(material: THREE.Material): void {
  const before = material.onBeforeCompile;
  const beforeKey = Object.hasOwn(material, "customProgramCacheKey") ? material.customProgramCacheKey() : "plain";
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader.replace("#include <project_vertex>", `${PRESS_ONTO_CANVAS_GLSL}\n#include <project_vertex>`);
  };
  material.customProgramCacheKey = () => `${beforeKey}-on-canvas`;
  material.needsUpdate = true;
}

export function applyFighterSkin(target: THREE.Object3D, palette: BoxerPaletteColors): AppliedFighterMaterials {
  // An official never takes damage or sweats: plain materials, injury state that shades nothing, and no shadow.
  const official = palette.outfit !== undefined;
  const skin: THREE.MeshStandardMaterial[] = [];
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
      // Only a fighter's skin takes the clearcoat that sweat shows on; the outfit makes an official's shirt cloth.
      material = isSkin && !official
        ? new THREE.MeshPhysicalMaterial({ map, color, roughness: 0.58, metalness: 0.02, clearcoat: 0.25, clearcoatRoughness: 0.6 })
        : new THREE.MeshStandardMaterial({ map, color, roughness: isSkin ? 0.58 : 0.4, metalness: isSkin ? 0.02 : 0.03 });
      material.name = sourceName;
      bySource.set(sourceName, material);
      owned.push(material);
      if (isSkin) skin.push(material);
      if (sourceName === "MHeadMat0") headInjury = new InjuryShading(official ? null : material, HEAD_SITES, { core: HEAD_SWELL_CORE, lids: EYE_LIDS });
      if (sourceName === "MBodyMat0") bodyInjury = new InjuryShading(official ? null : material, BODY_SITES, { core: BODY_SWELL_CORE, wash: true });
      const part = OUTFIT_PARTS[sourceName];
      if (outfit !== undefined && part !== undefined) applyOutfitShading(material, part, outfit);
      else if (sourceName === "PantsMat0") trunksBlood = wearCornerColour(material, false, "trunks");
      else if (sourceName === "GlovesMat0") gloveBlood = wearCornerColour(material);
      pressOntoCanvas(material);
    }
    object.material = material;
    object.castShadow = !official;
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
  /**
   * Dresses the body as a ring official and swaps the gloves for hands. Officials get plain materials:
   * no injury shading, no sweat and no shadow (see applyFighterSkin).
   */
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
  private readonly skinMaterials: readonly THREE.MeshStandardMaterial[];
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
    // A fighter's head is drawn from inside too, so a cut through it shows flesh where it is open (the
    // injury shading drops back faces while it is whole); an official's head is never cut open. Shadows
    // still come from the back faces as for a one-sided skin, or the face would shadow itself in stripes.
    const headMaterial = this.headMeshes[0]!.material as THREE.Material;
    headMaterial.side = this.dressed ? THREE.FrontSide : THREE.DoubleSide;
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

  get skin(): THREE.MeshStandardMaterial {
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
        // Too small to throw a shadow anyone would see; it would only cost a draw in the shadow pass.
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        bone.add(mesh);
      }
    }
    return gloved ? null : hand;
  }

  /** Sweat sheen; only a fighter's skin is clearcoated, an official's stays matte. */
  setSkinClearcoat(value: number): void {
    for (const material of this.skinMaterials) if (material instanceof THREE.MeshPhysicalMaterial) material.clearcoat = value;
  }

  dispose(): void {
    for (const material of this.ownedMaterials) material.dispose();
    for (const geometry of this.ownedGeometries) geometry.dispose();
    disposeSkeletons(this.root);
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

/** A press of the viewer's own punch, kept until it plays. */
interface OwnPress {
  readonly action: PunchAction & { readonly id: string };
  readonly timing: PunchTiming;
  readonly leadTicks: number;
  readonly pressedAt: number;
  /** The input frame that carried it, once known. */
  sequence: number | null;
  /** The server has started it, so it is no longer the server's to refuse. */
  started: boolean;
  /** Real ticks since the key was pressed. */
  waited: number;
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
/** Between these gaps (metres between the fighters' feet) the stance closes up for infighting. */
const CROWDED_GAP = 0.58;
/** Two heads keep at least this far apart: closer, each leans his head and shoulders away from the other's, and eases back once they are clear. */
const HEAD_SPACE = 0.25;
const HEAD_SPACE_CLEAR = 0.32;
const HEAD_SPACE_RATE = 9;
const OPEN_GAP = 1;
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
/**
 * How fast a knee's or an elbow's pole that has to come round a long way swings round its limb, down and getting up,
 * and how long after he is up the swing may still be finishing.
 */
const POLE_TURN_RATE = 6;
const POLE_SETTLE_SECONDS = 0.4;
/** Seconds over which the get-up takes the body over from the pose the knockout physics left it in. */
const RISE_BLEND_SECONDS = 0.2;
/**
 * The knockout physics follows the get-up from the canvas until he is on all fours (and for at least this long): the
 * get-up's first stage, blended from wherever the fall left him, can pass through the canvas; all fours does not.
 */
const RISE_HANDOVER_SECONDS = 0.3;
/** A root this far from the fighter's place when he goes down was drawn there before a gap: he falls at his place. */
const FALL_ROOT_JUMP = 0.5;

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
  /** Input frame that carried the press, once known: once a snapshot has it, the punch has started there or never will. */
  private ownSequence: number | null = null;
  /** A snapshot has shown the server playing the punch. */
  private ownStarted = false;
  /** When the key was pressed, in seconds. */
  private ownPressedAt = 0;
  /** The server refused the punch or cut it off before contact, so the pull-back is final. */
  private ownRefused = false;
  /** A press made during a punch: the server holds it until that punch lets it go, and so does the graph. */
  private ownQueued: OwnPress | null = null;
  /** This fighter's newest punch the server reported meeting the opponent, and whether it was parried. */
  private contactId: string | null = null;
  private contactParried = false;
  /** The fighters as last shown, for the recovery cancel's stamina and stun checks. */
  private shownFighter: FighterSnapshot | null = null;
  private shownOpponent: FighterSnapshot | null = null;
  /** Own punches already played or cut short here; the server's copy of them is not played again. */
  private readonly retiredOwnIds: string[] = [];
  private anticipatedId: string | null = null;
  private hitstop = 0;
  private hitstopScale = 1;
  private downState: "up" | "falling" | "down" | "rising" = "up";
  private fallAge = 0;
  /** How far along the get-up he is (see RISE_KNEE), and where it stood when the server let him up. */
  private riseProgress = 0;
  private riseFrom = 0;
  private fallSide = 0;
  private fallProne = false;
  /** The knockdown was a body shot: the fighter goes to a knee instead of falling. */
  private fallKneel = false;
  /** Which side of the body took the shot that is putting him down: 1 his left, -1 his right. */
  private windedSide = -1;
  private windedTime = 0;
  private winded = 0;
  /**
   * The fall played: the punch's own, or the nearest variant that keeps the body inside the ropes, moved in as
   * far as it must; after a fall the knockout physics played, where and how that left the body.
   */
  private landProne = false;
  private landSide = 0;
  private readonly landShift = new THREE.Vector3();
  private landSettled = false;
  /** Where the knockout physics left the body, as a down pose the get-up starts from; set when it hands him over. */
  private readonly fallen = downPose();
  private fallenFromPhysics = false;
  /**
   * How far (world x and z) the drawn fighter stands from his place in the engine after the physics took the body
   * somewhere else, and how far it was when he started to get up: he gets up where he lies and steps back to his place
   * as he rises off his knee. `riseRootVelocity` is that step's, for the feet.
   */
  private readonly riseRoot = new THREE.Vector3();
  private readonly riseRootFrom = new THREE.Vector3();
  /** The knee and elbow poles last drawn down or getting up (lead knee, rear knee, lead elbow, rear elbow). */
  private readonly downPoles = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] as const;
  private downPolesSet = false;
  private poleSettle = 0;
  private readonly characterInverse = new THREE.Matrix4();
  /** Where the engine has the fighter this frame (with the glove-touch walk and the walk back from a fall). */
  private readonly place = new THREE.Vector3();
  private readonly riseRootVelocity = new THREE.Vector3();
  private readonly liveOpponentHead = new THREE.Vector3();
  private hasLiveHead = false;
  /**
   * Where the opponent's head would be without a slip, weave or pull: its offset from his root, learnt
   * while he stands his ground, is held from the moment he evades until his head is back.
   */
  private readonly guardOpponentHead = new THREE.Vector3();
  private readonly opponentHeadOffset = new THREE.Vector3();
  private opponentSteadySeconds = 0;
  /** How far the punch's aim has moved from that head onto the live one: only once the punch is known to have met him. */
  private followHead = 0;
  private aimActionId: string | null = null;
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
  private crowding = 0;
  /** How far he has stepped into the punch he is throwing, out of the tall, tucked stance of the inside. */
  private punchCommit = 0;
  /** How far, in his own frame (x to the side, y ahead), the fighter is leaning his head away from the other's. */
  private readonly headSpace = new THREE.Vector2();
  private readonly ownHead = new THREE.Vector3();
  /** Render tick the taunt ends on (see latchEndTick). */
  private tauntEnd: number | null = null;
  private lastSpeed = 0;
  private readonly stool: { group: THREE.Group; dispose: () => void };
  /** Root position and yaw the stool was set down at, where it stays while the fighter rises off it. */
  private readonly stoolRoot = new THREE.Vector3();
  private stoolYaw = 0;
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
  private readonly breakFighters: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3()];
  private breakAimed = false;
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
  /** Render tick the opening countdown ends on (see latchEndTick). */
  private countdownEnd: number | null = null;
  private touchWeight = 0;
  /** The walk in to the glove touch: offset from the engine position, and its velocity for the footwork. */
  private readonly touchOffset = new THREE.Vector3();
  private readonly touchVelocity = new THREE.Vector3();
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
  /** Scratch for the punch path, so a punch allocates nothing per frame. */
  private readonly punchGuard = this.makeHand();
  private readonly punchDir = new THREE.Vector3();
  private readonly punchContact = new THREE.Vector3();
  private readonly punchStart = new THREE.Vector3();
  private readonly punchSweepFrom = new THREE.Vector3();
  private readonly punchSweepTo = new THREE.Vector3();
  private readonly punchMid = new THREE.Vector3();
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
  /** Render tick the referee's count last changed on; the counting arm is timed from it. */
  private countChangedTick: number | null = null;
  /** Knockout physics; officials have none. */
  private readonly ragdoll: KnockoutRagdoll | null;
  /** Knocked out on his feet (a flash knockout): down although the engine never counts him. */
  private forcedDown = false;
  /** The bout is over, or being replayed, with him on the canvas: he does not try to get up. */
  private heldDown = false;
  /** The next fall is the animation's, not the physics' (a body shot that takes him to one knee). */
  private authoredNextFall = false;
  private obstacle: { x: number; z: number } | null = null;
  private blows = 0;
  /** Seconds since the knockout physics handed the body to the get-up, which blends in from where it left it. */
  private riseBlendAge = 0;

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

  /**
   * Once the bout is over, and while its finish is replayed, a fighter on the canvas stays there: the
   * get-up stops following his meter and the knockout physics keeps the body.
   */
  stayDown(held: boolean): void {
    this.heldDown = held;
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
    this.landSettled = false;
    this.fallenFromPhysics = false;
    this.riseRoot.set(0, 0, 0);
    this.riseRootFrom.set(0, 0, 0);
    this.riseRootVelocity.set(0, 0, 0);
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
    this.ownQueued = null;
    this.completedActionId = null;
    this.retiredOwnIds.length = 0;
    this.anticipatedId = null;
  }

  /** Referee wave-off: both arms sweep crossing in front of the chest to call the fight. */
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

  /** Whether the referee is separating a clinch. */
  get breaking(): boolean {
    return this.breakTime > 0;
  }

  /** Where the two fighters stand (world, on the canvas): the break puts a palm on each one's chest. */
  aimBreak(first: THREE.Vector3, second: THREE.Vector3): void {
    this.breakFighters[0].copy(first);
    this.breakFighters[1].copy(second);
    this.breakAimed = true;
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
    if (counting !== this.refereeCounting || count !== this.refereeCount) this.countChangedTick = null;
    this.refereeCounting = counting;
    this.refereeCount = count;
  }

  /**
   * Starts the viewer's own punch on the key press. `leadTicks` estimates how far ahead of the
   * server's presentation that is (input latency plus the interpolation delay); the startup is
   * stretched by it so the glove arrives when the hit is shown. A press made during a punch waits, as
   * it does on the server, until that punch lets it go.
   */
  predict(action: SemanticAction, timeSeconds: number, tickRate: number, leadTicks = 0, expected?: PunchTiming): void {
    if (action.kind !== "punch" || action.id === undefined) return;
    const press: OwnPress = {
      action: { ...action, id: action.id },
      timing: expected ?? punchTiming(action.class, action.target, action.power),
      leadTicks,
      pressedAt: timeSeconds,
      sequence: null,
      started: false,
      waited: 0,
    };
    // The server keeps one press waiting and a newer one takes its place. Two presses less than half a
    // tick apart usually reach it before the same step, so only the second starts there: it replaces
    // the first here too, unless the server has already started it. (Two presses sent in one input
    // frame are only ever the newer one; `acknowledge` catches that once the newer one has gone out.)
    const unstarted = this.punchActive && this.ownActionId !== null && this.ownAuthoritativeAge === null && !this.ownPulled && !this.ownStarted;
    if (unstarted && (timeSeconds - this.ownPressedAt) * tickRate < SAME_STEP_TICKS) {
      // Not retired: if the first did start after all, it plays on the server's timeline.
      this.ownActionId = null;
    } else if (this.punchActive && !this.ownPulled) {
      // Behind a punch the server holds the press until a combination cuts the recovery short or the
      // punch ends. A press it already holds is replaced only if it is still held when this one
      // arrives; otherwise it has started by then, and this one waits behind it and plays when shown.
      if (this.ownQueued !== null && this.followUpStartAge(this.ownQueued) - this.punchAgeTicks <= leadTicks) return;
      if (this.punchAgeTicks < this.followUpStartAge(press)) {
        this.ownQueued = press;
        return;
      }
    }
    this.ownQueued = null;
    this.retirePunch();
    this.startOwnPunch(press, leadTicks);
  }

  /** True while the viewer's own punch, started on the key press, is playing. */
  get ownPunchActive(): boolean {
    return this.punchActive && this.ownActionId !== null;
  }

  /**
   * Squares the viewer's own punches with the newest snapshot, which is ahead of the one on screen by
   * the interpolation delay. `sequenceOf` gives the input frame that carried a press once it has gone
   * out. Once the snapshot has that frame, the punch has started on the server or never will: a guard
   * raised in the same tick, a newer press or a stun clears it there. A stun, a clinch or the end of
   * the fight phase also clears a press still waiting and cuts off a punch the server did start, unless
   * it had already landed. Either way the glove comes straight back. `contacts` are the snapshot's
   * contact events for this fighter's punches.
   */
  acknowledge(server: FighterSnapshot, fighting: boolean, contacts: readonly CombatEvent[] = [], sequenceOf: ((actionId: string) => number | null) | null = null): void {
    for (const event of contacts) {
      if (event.action_id === null || !CONNECTING_CONTACTS.has(event.kind)) continue;
      if (event.action_id !== this.contactId) {
        this.contactId = event.action_id;
        this.contactParried = false;
      }
      if (event.kind === "perfect_block") this.contactParried = true;
    }
    const cutOff = !fighting || server.stunned_ticks > 0 || server.clinch_ticks > 0 || server.clinch_startup_ticks > 0;
    const queued = this.ownQueued;
    if (queued !== null) {
      queued.sequence ??= sequenceOf?.(queued.action.id) ?? null;
      if (server.action_id === queued.action.id) queued.started = true;
      else if (!queued.started && (cutOff || (queued.sequence !== null && server.last_input_sequence >= queued.sequence && server.queued_actions === 0))) this.ownQueued = null;
    }
    if (!this.punchActive || this.ownActionId === null || this.ownPulled || this.ownRefused) return;
    if (!this.ownStarted) this.ownSequence ??= sequenceOf?.(this.ownActionId) ?? null;
    const started = server.action_id === this.ownActionId;
    if (started) this.ownStarted = true;
    const held = this.ownQueued;
    if (held !== null && held.sequence !== null && sequenceOf !== null && !this.ownStarted && this.ownSequence === null && this.ownAuthoritativeAge === null) {
      // A later press went out and this one never did: the input queue kept only the newer press, so
      // the server never sees this one and starts that one as soon as it gets it.
      this.ownActionId = null;
      this.ownQueued = null;
      this.retirePunch();
      this.startOwnPunch(held, Math.max(0, held.leadTicks - held.waited));
      return;
    }
    const refused = started
      ? cutOff && server.action_contact_tick === null
      : !this.ownStarted && this.ownAuthoritativeAge === null
        && (cutOff || (this.ownSequence !== null && server.last_input_sequence >= this.ownSequence && server.queued_actions === 0));
    if (!refused) return;
    this.ownRefused = true;
    // Before contact the glove comes back the way it went; after it the punch simply finishes.
    if (this.punchAgeTicks < this.punchTiming.startup) this.ownPulled = true;
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

  /** Plays the viewer's own press from its first frame, its startup stretched by `leadTicks`. */
  private startOwnPunch(press: OwnPress, leadTicks: number): void {
    const { action, timing } = press;
    this.startEarly(action.id, action.class, action.hand, action.target, action.power, timing, leadTicks, Math.max(0, leadTicks));
    this.ownSequence = press.sequence;
    this.ownStarted = press.started;
    this.ownPressedAt = press.pressedAt;
  }

  /** Starts a punch ahead of the server's presentation of it: the viewer's own press, or a punch seen early. */
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

  /**
   * Age of the punch being played at which the server starts `press`, held behind it: the cancel age
   * when a combination may cut the recovery short (the engine's rule, with the fighters as shown),
   * otherwise the tick after the punch ends.
   */
  private followUpStartAge(press: OwnPress): number {
    const fighter = this.shownFighter;
    const opponent = this.shownOpponent;
    const id = this.actionId ?? this.ownActionId;
    const landed = id !== null && id === this.contactId && !this.contactParried;
    if (fighter !== null && opponent !== null && cancelsRecovery(this.punchClass, landed, press.action, fighter.stamina, opponent.stunned_ticks > 0, fighter.style)) {
      return recoveryCancelAge(this.punchTiming);
    }
    return this.punchTotalTicks + 1;
  }

  /**
   * Starts the held press when the server would: at the cancel age when a combination cuts the
   * recovery short, the tick after the punch ends otherwise, and at once if the punch in front of it
   * was refused. Its startup is stretched by whatever lead the wait has not used up.
   */
  private releaseQueuedPress(simDt: number, ended: boolean): void {
    const press = this.ownQueued;
    if (press === null) return;
    press.waited += simDt * 30;
    if (this.punchActive && !this.ownPulled && this.punchAgeTicks < this.followUpStartAge(press)) return;
    this.ownQueued = null;
    this.retirePunch();
    this.startOwnPunch(press, Math.max(ended ? 1 : 0, press.leadTicks - press.waited));
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
    this.ownSequence = null;
    this.ownStarted = false;
    this.ownRefused = false;
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

    const touch = this.touchWalk(fighter, opponent, dt, sampledTick);
    this.walkBackFromTheFall(dt);
    const worldX = this.mapping.x(fighter.x) + touch.x + this.riseRoot.x;
    const worldZ = this.mapping.z(fighter.y) + touch.z + this.riseRoot.z;
    this.place.set(worldX, 0, worldZ);
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

    this.syncAction(fighter, opponent, sampledTick, simDt);
    if (!this.debugHoldImpact) {
      this.boxer.headInjury.update(simDt);
      this.boxer.bodyInjury.update(simDt);
    }

    if (opponentHeadWorld !== undefined) this.trackOpponentHead(opponent, opponentHeadWorld, dt);

    const velocityWorld = this.scratchB.set(this.mapping.x(fighter.velocity_x) * 30, 0, this.mapping.z(fighter.velocity_y) * 30).add(this.touchVelocity).add(this.riseRootVelocity);
    const speed = velocityWorld.length();
    // His own walking, without the step back to his place that a get-up takes.
    const ownSpeed = Math.hypot(velocityWorld.x - this.riseRootVelocity.x, velocityWorld.z - this.riseRootVelocity.z);
    this.lastSpeed = speed;
    this.stillTime = speed < 0.03 ? this.stillTime + dt : 0;
    const wantSeated = this.resting && this.stillTime > 0.2 && this.downState === "up";
    this.seated = smooth(this.seated, wantSeated ? 1 : 0, wantSeated ? 2.2 : 4, dt);
    const onStool = this.resting && this.stillTime > 0.05 && this.downState === "up";
    if (onStool) {
      this.stoolRoot.set(this.rootX, 0, this.rootZ);
      this.stoolYaw = this.yaw;
    }
    // The round can start with the fighter still seated: the stool stays where it stood until his hips are clear of it.
    this.stool.group.visible = onStool || (this.seated > STOOL_CLEAR_SEATED && this.downState === "up");
    this.stool.group.position.set(this.stoolRoot.x - this.rootX, 0, this.stoolRoot.z - this.rootZ)
      .add(this.scratch.set(0, 0, 0.02).applyAxisAngle(worldUpVector, this.stoolYaw))
      .applyAxisAngle(worldUpVector, -this.yaw);
    this.stool.group.rotation.y = this.stoolYaw - this.yaw;
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
    let apart = Number.POSITIVE_INFINITY;
    if (this.hasLiveHead && !this.referee && this.downState === "up" && this.clinchWeight < 0.5) {
      const own = this.boxer.rig.bones.head.getWorldPosition(this.ownHead);
      const dx = own.x - this.liveOpponentHead.x;
      const dz = own.z - this.liveOpponentHead.z;
      const flat = Math.hypot(dx, dz);
      apart = Math.hypot(dx, own.y - this.liveOpponentHead.y, dz);
      if (apart < HEAD_SPACE && flat > 1e-4) {
        // The lean builds while the heads are too close, in his own frame: x to his side, y ahead of him.
        const push = ((HEAD_SPACE - apart) / HEAD_SPACE) * HEAD_SPACE_RATE * dt;
        const cos = Math.cos(-this.yaw);
        const sin = Math.sin(-this.yaw);
        this.headSpace.x += ((dx * cos + dz * sin) / flat) * push;
        this.headSpace.y += ((-dx * sin + dz * cos) / flat) * push;
        if (this.headSpace.lengthSq() > 1) this.headSpace.normalize();
      }
    }
    if (apart > HEAD_SPACE_CLEAR) this.headSpace.multiplyScalar(Math.exp(-3 * dt));
    this.tauntEnd = latchEndTick(this.tauntEnd, sampledTick, fighter.taunt_ticks > 0 ? fighter.taunt_ticks : null);

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

    this.ragdoll?.tick(dt);
    this.updateDownState(fighter, dt, reducedMotion, ownSpeed);

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

    // Inside, the fighter stands taller with the guard tucked in and the head off the centre line,
    // so two fighters chest to chest do not pass through each other.
    // Throwing, he steps into the punch out of the tall, tucked stance, so it reaches the contact point the engine hit.
    this.punchCommit = smooth(this.punchCommit, this.punchActive ? 1 : 0, 10, dt);
    const inside = this.crowding * (1 - this.clinchWeight) * (1 - this.punchCommit);
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

    // Heads never pass through each other: the one too close leans away from the other's.
    if (Math.abs(this.headSpace.x) + Math.abs(this.headSpace.y) > 0.001) {
      const side = this.headSpace.x;
      const ahead = this.headSpace.y;
      torso.spinePitch += ahead * 0.7;
      torso.spineRoll -= side * 0.7;
      torso.hips.z += ahead * 0.1;
      torso.hips.x += side * 0.05;
      torso.headOffset.x += side * 0.05;
      torso.headOffset.z += ahead * 0.05;
      torso.headPitch += ahead * 0.2;
      torso.headRoll -= side * 0.3;
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

    if (this.referee) this.applyRefereePose(mirror, leadHand, rearHand, lead, rear, headRest, time, sampledTick);

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
    if (this.tauntWeight > 0.001) {
      const tauntLeft = this.tauntEnd === null ? 0 : clamp(this.tauntEnd - sampledTick, 0, TAUNT_TICKS);
      this.applyTauntPose(this.tauntWeight, ((TAUNT_TICKS - tauntLeft) / TAUNT_TICKS) * TAUNT_BECKONS, mirror, leadHand, rearHand, headRest);
    }

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
    if (this.downState !== "up") this.applyDownPose(mirror, leadHand, rearHand, lead, rear);
    this.steadyJointPoles(mirror, leadHand, rearHand, lead, rear, dt);

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
    if (ragdoll?.active === true && !ragdoll.handingOver) {
      ragdoll.setLost(boxer.isDecapitated, boxer.isHandDismembered("left"), boxer.isHandDismembered("right"));
      ragdoll.update(dt, this.obstacle);
    } else {
      this.solver.apply(boxer.root, this.pose);
      if (ragdoll?.handingOver === true) {
        ragdoll.followPose(dt, this.obstacle);
        // On all fours the physics lets go, and what it left short of the get-up pose blends out from there.
        if (this.riseProgress >= RISE_FOURS && ragdoll.handOverSeconds >= RISE_HANDOVER_SECONDS) {
          ragdoll.letGo();
          this.riseBlendAge = 0;
        }
      } else if (ragdoll !== null && ragdoll.hasRisePose) {
        const settled = smoothstep(0, RISE_BLEND_SECONDS, this.riseBlendAge);
        if (settled < 1 && this.downState !== "up") ragdoll.blendRise(settled);
        else ragdoll.clearRise();
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
   * while the lead glove beckons the opponent in, palm up, four times per taunt.
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

  private syncAction(fighter: FighterSnapshot, opponent: FighterSnapshot, sampledTick: number, simDt: number): void {
    this.shownFighter = fighter;
    this.shownOpponent = opponent;
    const queued = this.ownQueued;
    if (queued !== null && fighter.action_id === queued.action.id) {
      // The server let the held press go sooner than expected: it plays on the server's timeline.
      this.ownQueued = null;
      this.retirePunch();
      this.startOwnPunch(queued, 0);
    }
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
          // A punch the server cut off keeps coming back; one that was only late resumes.
          if (!this.ownRefused) {
            this.ownPulled = false;
            if (authoritativeAge - this.punchAgeTicks > 1) this.punchAgeTicks = authoritativeAge;
          }
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
        if (!this.ownPulled && authoritativeAge - this.punchAgeTicks > 1.5) this.punchAgeTicks = authoritativeAge;
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
    let ended = false;
    if (this.punchActive && this.ownPulled) {
      this.punchAgeTicks -= simDt * 30 * OWN_PUNCH_PULL_RATE;
      if (this.punchAgeTicks <= 0) {
        // Only a punch the server refused is retired. One that was merely late is not: if the server
        // does start it after all, it plays on the server's timeline.
        if (!this.ownRefused) this.ownActionId = null;
        this.retirePunch();
      }
    } else if (this.punchActive) {
      this.punchAgeTicks += simDt * 30 * this.ownPunchRate();
      if (this.punchAgeTicks >= this.punchTotalTicks) {
        this.retirePunch();
        ended = true;
      }
    }
    if (fighter.is_downed) {
      if (this.punchActive) this.retirePunch();
      this.ownQueued = null;
    }
    this.releaseQueuedPress(simDt, ended);
    // A punch the server says met the opponent, hit or block, follows his head wherever it went.
    const aimed = this.actionId ?? this.ownActionId;
    if (aimed !== this.aimActionId) {
      this.aimActionId = aimed;
      this.followHead = 0;
    }
    this.followHead = smooth(this.followHead, aimed !== null && aimed === this.contactId ? 1 : 0, FOLLOW_HEAD_RATE, simDt);
  }

  /** Takes the opponent's head as drawn and keeps where it would be without his slip, weave or pull. */
  private trackOpponentHead(opponent: FighterSnapshot, head: THREE.Vector3, dt: number): void {
    const root = this.guardOpponentHead.set(this.mapping.x(opponent.x), 0, this.mapping.z(opponent.y));
    this.opponentSteadySeconds = EVASION_POSES.has(opponent.defense) ? 0 : this.opponentSteadySeconds + dt;
    if (!this.hasLiveHead || this.opponentSteadySeconds >= HEAD_SETTLE_SECONDS) this.opponentHeadOffset.copy(head).sub(root);
    root.add(this.opponentHeadOffset);
    this.liveOpponentHead.copy(head);
    this.hasLiveHead = true;
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
    // Every punch leaves the guard and eases into its windup instead of jumping on its first frame:
    // the hand over the windup, its turn and the elbow over twice that.
    let windupIn = 1;
    let onset = 1;
    if (age < startup) {
      phase = "startup";
      const u = age / startup;
      const windupEnd = this.punchClass === "hook" ? 0.3 : this.punchClass === "uppercut" ? 0.45 : 0.18;
      windup = smoothstep(0, windupEnd, u) * (1 - smoothstep(windupEnd, Math.min(1, windupEnd + 0.4), u));
      extend = u <= windupEnd ? 0 : easeIn((u - windupEnd) / (1 - windupEnd), 1.65);
      windupIn = smoothstep(0, windupEnd, u);
      onset = smoothstep(0, Math.min(1, windupEnd * 2), u);
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

    const guard = this.punchGuard.position.copy(hand.position);
    const guardKnuckles = this.punchGuard.knuckles.copy(hand.knuckles);
    const guardPalm = this.punchGuard.palm.copy(hand.palm);
    const guardPole = this.punchGuard.pole.copy(hand.pole);

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
      // An evading head is aimed at where it was, so a slip or weave that worked shows the glove go by.
      target.copy(this.guardOpponentHead).lerp(this.liveOpponentHead, this.followHead).sub(rootPosition).applyQuaternion(this.scratchQ.setFromAxisAngle(worldUpVector, -this.yaw));
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
    const dir = this.punchDir.copy(target).sub(shoulderChar);
    const distance = dir.length();
    dir.normalize();
    const reach = 0.5 + 0.04 * power + (this.punchClass === "straight" ? 0.06 : 0) + (this.punchClass === "jab" ? 0.03 : 0)
      - (this.punchClass === "hook" ? 0.08 : 0) - (this.punchClass === "uppercut" ? 0.08 : 0);
    const contactDistance = Math.min(distance - HURTBOXES.head.radius - GLOVE_HITBOX_RADIUS + PUNCH_CONTACT_OFFSET, reach);
    // Pressed together there is little room: the punch shortens and the elbow stays bent rather than
    // the glove going past the contact point into the face.
    const contact = this.punchContact.copy(shoulderChar).addScaledVector(dir, Math.max(0, contactDistance));
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
    // A hook or uppercut keeps part of its windup until it travels, once the windup has eased in.
    const start = this.punchStart.copy(guard).addScaledVector(windupOffset, Math.max(windup, this.punchClass === "hook" || this.punchClass === "uppercut" ? (1 - travel) * 0.6 * windupIn : 0));
    if (this.punchClass === "hook") {
      // Horizontal sweep around the shoulder from the wide windup into the target. The radius runs
      // from the windup's to the contact's, measured flat, so the sweep ends on the contact point.
      const startRadius = Math.hypot(start.x - shoulderChar.x, start.z - shoulderChar.z);
      const contactRadius = Math.hypot(contact.x - shoulderChar.x, contact.z - shoulderChar.z);
      const startDir = this.punchSweepFrom.copy(start).sub(shoulderChar).setY(0).normalize();
      const endDir = this.punchSweepTo.copy(contact).sub(shoulderChar).setY(0).normalize();
      const angle = Math.acos(clamp(startDir.dot(endDir), -1, 1));
      // The sign of the cross product's vertical component: which way round the shoulder the sweep turns.
      const turn = startDir.z * endDir.x - startDir.x * endDir.z >= 0 ? 1 : -1;
      const sweep = smoothstep(0, 1, travel);
      // The start direction is not needed again, so it turns in place.
      const rotated = startDir.applyAxisAngle(worldUpVector, angle * sweep * turn).normalize();
      hand.position.copy(shoulderChar).addScaledVector(rotated, THREE.MathUtils.lerp(startRadius, contactRadius, sweep));
      hand.position.y = THREE.MathUtils.lerp(start.y, contact.y, sweep);
      hand.pole.set(0.95 * side * mirror, 0.08, 0.3).normalize();
      hand.knuckles.copy(rotated).applyAxisAngle(worldUpVector, turn * Math.PI / 2).setY(0.05).normalize();
      hand.palm.set(0, -1, 0);
    } else if (this.punchClass === "uppercut") {
      const rise = smoothstep(0, 1, travel);
      const low = start;
      const mid = this.punchMid.copy(contact).lerp(low, 0.5);
      mid.y = Math.min(low.y, contact.y) - 0.04;
      mid.z += 0.08;
      hand.position.copy(low).lerp(mid, rise * 2 > 1 ? 1 : rise * 2);
      if (rise > 0.5) hand.position.copy(mid).lerp(contact, (rise - 0.5) * 2);
      hand.pole.set(0.3 * side * mirror, -0.2, 1);
      hand.knuckles.set(0.05 * side * mirror, 0.9, 0.35).normalize();
      hand.palm.set(-0.2 * side * mirror, 0.3, -0.95).normalize();
    } else {
      hand.position.copy(start).lerp(contact, Math.min(1, travel));
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
    if (onset < 1) {
      // The hand turns and the elbow lifts out of the guard over the windup too. The further the elbow
      // has to turn, the more it swings out on the way, so its pull never lines up with the arm, which
      // would flip it in a frame.
      const turn = (1 - hand.pole.dot(guardPole) / Math.max(1e-6, hand.pole.length() * guardPole.length())) / 2;
      hand.knuckles.lerp(guardKnuckles, 1 - onset).normalize();
      hand.palm.lerp(guardPalm, 1 - onset).normalize();
      hand.pole.lerp(guardPole, 1 - onset).addScaledVector(this.scratchC.set(side * mirror, 0, 0), ONSET_ELBOW_FLARE * turn * Math.sin(Math.PI * onset)).normalize();
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
    sampledTick: number,
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
      // The arm comes up through each second of the count and chops down onto the next number.
      this.countChangedTick ??= sampledTick;
      const beat = clamp((sampledTick - this.countChangedTick) / COUNT_TICKS, 0, 1);
      const pump = beat < COUNT_DROP_START ? easeOut(beat / COUNT_DROP_START) : 1 - easeIn((beat - COUNT_DROP_START) / (1 - COUNT_DROP_START), 2);
      rearHand.position.set(-0.22 * mirror, headRest.y - 0.05 + pump * 0.12, 0.34 + pump * 0.08);
      rearHand.pole.set(-0.9 * mirror, -0.3, 0.2).normalize();
      rearHand.knuckles.set(0, 0.7, 0.7).normalize();
      rearHand.palm.set(0, 0.3, -0.95).normalize();
      torso.spinePitch += 0.12;
      torso.headPitch += 0.18;
      leadHand.position.set(0.24 * mirror, 0.95, 0.08);
    }
  }

  private updateDownState(fighter: FighterSnapshot, dt: number, reducedMotion: boolean, speed: number): void {
    this.riseBlendAge += dt;
    if (fighter.is_downed || this.forcedDown) {
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
        this.riseRootFrom.copy(this.riseRoot);
        this.landSettled = false;
        this.fallenFromPhysics = false;
        this.downPolesSet = false;
        // The knockout physics plays the fall, from the pose on screen (so a knockdown mid-rise falls from
        // where he was), unless the animation does: a body shot to one knee, or reduced motion.
        this.ragdoll?.clearRise();
        if (this.authoredNextFall) this.ragdoll?.forget();
        else if (!reducedMotion) this.startFall(fighter);
        this.authoredNextFall = false;
      } else if (this.downState === "falling") {
        this.fallAge += dt;
        if (this.fallAge >= KNOCKDOWN_FALL_SECONDS) this.downState = "down";
      } else if (this.fallKneel) {
        // Down on one knee after a body shot: the get-up from there is only its last stage.
        this.riseProgress = RISE_KNEE;
      } else {
        // Each good press of the get-up prompt pushes him further up; a bad one lets him sink back. Knocked
        // out, or once the bout is over, he stays down.
        const trying = !this.forcedDown && !this.heldDown && fighter.get_up_required > 0;
        const meter = trying ? clamp(fighter.get_up_meter / fighter.get_up_required, 0, 1) : 0;
        const target = meter * RISE_KNEE;
        // The physics keeps the body until he starts to get up, then hands it to the animated get-up.
        if (this.ragdoll?.active === true && !this.ragdoll.handingOver) {
          if (target <= 0) return;
          this.handOverFall(fighter);
        }
        this.riseProgress += clamp(target - this.riseProgress, -RISE_SINK_RATE * dt, RISE_PUSH_RATE * dt);
      }
      return;
    }
    if (this.downState === "down" || this.downState === "falling") {
      this.downState = "rising";
      if (this.ragdoll?.active === true && !this.ragdoll.handingOver) this.handOverFall(fighter);
      if (this.fallKneel) this.riseProgress = Math.max(this.riseProgress, RISE_KNEE);
      this.riseFrom = this.riseProgress;
      this.feetInitialized = false;
    }
    if (this.downState !== "rising") return;
    // The server already has him fighting: finish inside the stun, sooner if he walks or throws.
    const hurried = speed > 0.3 || this.punchActive;
    const rate = (1 - this.riseFrom) / (hurried ? GETUP_HURRIED_SECONDS : GETUP_SECONDS);
    this.riseProgress = Math.min(1, this.riseProgress + (this.riseProgress < RISE_FOURS ? Math.min(rate, RISE_ROLL_RATE) : rate) * dt);
    if (this.riseProgress >= 1) {
      this.downState = "up";
      this.fallKneel = false;
    }
  }

  /**
   * Starts the knockout physics. After a gap in drawing (the Activity hidden, a reconnect, a spectator joining
   * mid-count) the fighter was last drawn where he stood then, which can be metres from his place: he falls at his
   * place instead, and when the count is already running he is put down where that fall ends.
   */
  private startFall(fighter: FighterSnapshot): void {
    const ragdoll = this.ragdoll;
    if (ragdoll === null) return;
    if (this.rootX !== null && Math.hypot(this.place.x - this.rootX, this.place.z - this.rootZ) > FALL_ROOT_JUMP) {
      this.rootX = this.place.x;
      this.rootZ = this.place.z;
      this.boxer.root.position.set(this.rootX, 0, this.rootZ);
    }
    ragdoll.start("crumple");
    if (fighter.get_up_count > 0) {
      ragdoll.settle();
      this.fallAge = KNOCKDOWN_FALL_SECONDS;
    }
  }

  /**
   * The knockout physics hands the body to the animated get-up: the down pose it starts from is read off
   * the skeleton as the fall left it (the hips' place and turn, the spine, the gloves and the ankles), so
   * the get-up begins exactly there, and the joints' own turns blend in over RISE_BLEND_SECONDS.
   */
  private handOverFall(fighter: FighterSnapshot): void {
    const ragdoll = this.ragdoll;
    if (ragdoll === null || !ragdoll.active || ragdoll.handingOver) return;
    const mirror = fighter.stance === "orthodox" ? 1 : -1;
    const bones = this.boxer.rig.bones;
    // The bones still carry the physics' last frame; read them in character space under this frame's root.
    this.boxer.root.updateMatrixWorld(true);
    const root = this.scratchC.set(this.rootX ?? 0, 0, this.rootZ);
    const inverse = this.scratchQ.setFromAxisAngle(worldUpVector, -this.yaw);
    const fallen = this.fallen;
    const toCharacter = (bone: THREE.Bone, out: THREE.Vector3): THREE.Vector3 => out.setFromMatrixPosition(bone.matrixWorld).sub(root).applyQuaternion(inverse);
    // The poser builds the spine and head by adding to the hips' angles, so each turn is read as the angles nearest
    // the ones it is built on: the hips' nearest the authored lying pose's, the chest's nearest the hips', the head's
    // nearest the chest's.
    const turnOf = (bone: THREE.Bone, pitch: number, yaw: number, roll: number): THREE.Euler =>
      nearestTurn(downEuler.setFromQuaternion(bone.getWorldQuaternion(fallenTurn).premultiply(inverse), "YXZ"), pitch, yaw, roll);
    toCharacter(bones.hips, fallen.hips);
    this.landProne = ragdoll.faceDown();
    const side = Math.abs(fallen.hips.x) > 0.12 ? Math.sign(fallen.hips.x) : 0;
    const authored = this.landProne
      ? placeDownPose(this.downTo, PRONE, PRONE_TWIST, mirror, side, this.boxer.rig.metrics.ankleHeight)
      : placeDownPose(this.downTo, LYING, LYING_TWIST, mirror, side, this.boxer.rig.metrics.ankleHeight);
    this.landSide = side;
    this.landShift.set(fallen.hips.x - authored.hips.x, 0, fallen.hips.z - authored.hips.z);
    const hips = turnOf(bones.hips, authored.hipsPitch, authored.hipsYaw, authored.hipsRoll);
    fallen.hipsPitch = hips.x;
    fallen.hipsYaw = hips.y;
    fallen.hipsRoll = hips.z;
    // The chest's turn is the upper chest's whole turn on the hips, its side bend included: dropped, the get-up's
    // first frame drew the head and shoulders 30-70 cm from where the fall had left them.
    const chest = turnOf(bones.upperChest, fallen.hipsPitch, fallen.hipsYaw, fallen.hipsRoll);
    fallen.shouldersYaw = chest.y;
    fallen.spinePitch = chest.x - fallen.hipsPitch;
    fallen.spineRoll = chest.z - fallen.hipsRoll;
    const head = turnOf(bones.head, chest.x, chest.y, chest.z);
    fallen.headPitch = head.x;
    fallen.turn = head.y;
    fallen.headRoll = head.z;
    toCharacter(mirror > 0 ? bones.gloveL : bones.gloveR, fallen.leadHand);
    toCharacter(mirror > 0 ? bones.gloveR : bones.gloveL, fallen.rearHand);
    toCharacter(mirror > 0 ? bones.ankleL : bones.ankleR, fallen.leadFoot);
    toCharacter(mirror > 0 ? bones.ankleR : bones.ankleL, fallen.rearFoot);
    // The get-up draws each foot sole down, so an ankle the fall left lower than a standing one (a foot on its side,
    // or toes up) is put at the ankle's height: below it the foot went into the canvas.
    const ankle = this.boxer.rig.metrics.ankleHeight;
    fallen.leadFoot.y = Math.max(fallen.leadFoot.y, ankle);
    fallen.rearFoot.y = Math.max(fallen.rearFoot.y, ankle);
    // Each knee and elbow keeps the way it is bent: from the line between the limb's ends out to the joint. A limb
    // lying nearly straight has no such line to speak of, so the way the joint faces (the kneecap, the back of the
    // elbow) settles it: read off a straight limb's noise, a knee could bend into the canvas and then flip over.
    const bend = (root: THREE.Bone, joint: THREE.Bone, end: THREE.Bone, out: THREE.Vector3, faces: THREE.Vector3): void => {
      const from = toCharacter(root, this.scratchB);
      const along = toCharacter(end, this.scratchD).sub(from).normalize();
      toCharacter(joint, out).sub(from);
      out.addScaledVector(downScratch.copy(faces).applyQuaternion(root.getWorldQuaternion(fallenTurn)).applyQuaternion(inverse), STRAIGHT_LIMB_BEND);
      out.addScaledVector(along, -out.dot(along));
      if (out.lengthSq() > 1e-6) out.normalize();
      else out.copy(faces === KNEECAP ? downForward : downBelow);
    };
    const left = mirror > 0;
    bend(left ? bones.hipL : bones.hipR, left ? bones.kneeL : bones.kneeR, left ? bones.ankleL : bones.ankleR, fallen.leadKnee, KNEECAP);
    bend(left ? bones.hipR : bones.hipL, left ? bones.kneeR : bones.kneeL, left ? bones.ankleR : bones.ankleL, fallen.rearKnee, KNEECAP);
    bend(left ? bones.shoulderL : bones.shoulderR, left ? bones.elbowL : bones.elbowR, left ? bones.gloveL : bones.gloveR, fallen.leadElbow, left ? ELBOW_BACK_L : ELBOW_BACK_R);
    bend(left ? bones.shoulderR : bones.shoulderL, left ? bones.elbowR : bones.elbowL, left ? bones.gloveR : bones.gloveL, fallen.rearElbow, left ? ELBOW_BACK_R : ELBOW_BACK_L);
    // The gloves as they lie: knuckles along the bone's y axis, the palm along its z axis.
    const glove = (bone: THREE.Bone, knuckles: THREE.Vector3, palm: THREE.Vector3): void => {
      const turn = bone.getWorldQuaternion(fallenTurn).premultiply(inverse);
      knuckles.set(0, 1, 0).applyQuaternion(turn);
      palm.set(0, 0, 1).applyQuaternion(turn);
    };
    glove(left ? bones.gloveL : bones.gloveR, fallen.leadKnuckles, fallen.leadPalm);
    glove(left ? bones.gloveR : bones.gloveL, fallen.rearKnuckles, fallen.rearPalm);
    fallen.ownJoints = 1;
    fallen.leadHeel = 0;
    fallen.rearHeel = 0;
    fallen.palmsDown = this.landProne ? 1 : 0;
    this.fallenFromPhysics = true;
    this.landSettled = true;
    this.downPolesSet = false;
    ragdoll.handOver();
    this.riseBlendAge = 0;
    // The drawn fighter's root moves under the body, which gets up where it lies; the fitted pose and the pose
    // the physics left move with it the other way, so nothing jumps. He steps back to his place as he rises.
    const shift = this.scratchE.set(ragdoll.pelvis(this.scratchD).x - (this.rootX ?? 0), 0, this.scratchD.z - this.rootZ);
    const local = this.scratchB.copy(shift).applyQuaternion(inverse);
    for (const point of [fallen.hips, fallen.leadHand, fallen.rearHand, fallen.leadFoot, fallen.rearFoot]) {
      point.x -= local.x;
      point.z -= local.z;
    }
    ragdoll.shiftRise(this.scratchC.copy(shift).negate());
    this.rootX = (this.rootX ?? 0) + shift.x;
    this.rootZ += shift.z;
    this.boxer.root.position.set(this.rootX, 0, this.rootZ);
    this.riseRoot.set(this.rootX - this.mapping.x(fighter.x) - this.touchOffset.x, 0, this.rootZ - this.mapping.z(fighter.y) - this.touchOffset.z);
    this.riseRootFrom.copy(this.riseRoot);
  }

  /**
   * Getting up from where the physics took the body, he steps back to his place in the engine as he rises off his
   * knee and stands up on it. Walking back only once he was up left him drawn up to 0.6 m from the place the
   * opponent's punches aim at for half a second after the server had him fighting again.
   */
  private walkBackFromTheFall(dt: number): void {
    const share = this.downState === "rising" ? 1 - smoothstep(RISE_KNEE, 1, this.riseProgress) : this.downState === "up" ? 0 : 1;
    const x = this.riseRootFrom.x * share;
    const z = this.riseRootFrom.z * share;
    if (dt > 0) this.riseRootVelocity.set((x - this.riseRoot.x) / dt, 0, (z - this.riseRoot.z) / dt);
    else this.riseRootVelocity.set(0, 0, 0);
    this.riseRoot.set(x, 0, z);
    if (share === 0) this.riseRootFrom.set(0, 0, 0);
  }

  /**
   * Down and getting up, a knee or an elbow whose pole has to come a long way round (from how the physics left the limb
   * to how the get-up has it) swings round the limb at POLE_TURN_RATE rather than straight across: a pole crossing the
   * line of the limb flipped the knee to its other side in one frame, 62 cm. Each limb's line runs from its hip or
   * shoulder as last drawn to where its foot or glove goes now.
   */
  private steadyJointPoles(mirror: number, leadHand: HandTarget, rearHand: HandTarget, lead: FootTarget, rear: FootTarget, dt: number): void {
    this.poleSettle = this.downState !== "up" ? POLE_SETTLE_SECONDS : Math.max(0, this.poleSettle - dt);
    if (this.poleSettle <= 0 || (this.ragdoll?.active === true && !this.ragdoll.handingOver)) {
      this.downPolesSet = false;
      return;
    }
    const bones = this.boxer.rig.bones;
    const left = mirror > 0;
    // The skeleton and the root's matrix are both still last frame's, so together they give last frame's character space.
    this.characterInverse.copy(this.boxer.root.matrixWorld).invert();
    // Lead knee, rear knee, lead elbow, rear elbow.
    for (let index = 0; index < 4; index += 1) {
      const leg = index < 2;
      const leading = index % 2 === 0;
      const onLeft = leading === left;
      const root = leg ? (onLeft ? bones.hipL : bones.hipR) : (onLeft ? bones.shoulderL : bones.shoulderR);
      const target = leg ? (leading ? lead : rear) : (leading ? leadHand : rearHand);
      const end = target.position;
      const pole = target.pole;
      const last = this.downPoles[index]!;
      if (!this.downPolesSet) {
        last.copy(pole);
        continue;
      }
      const axis = this.scratchB.setFromMatrixPosition(root.matrixWorld).applyMatrix4(this.characterInverse).sub(end).negate();
      if (axis.lengthSq() < 1e-6) {
        last.copy(pole);
        continue;
      }
      axis.normalize();
      // Both poles seen across the limb; the drawn one turns toward the wanted one about the limb, the short way, and only so fast.
      const from = this.scratchD.copy(last).addScaledVector(axis, -last.dot(axis));
      const to = this.scratchE.copy(pole).addScaledVector(axis, -pole.dot(axis));
      if (from.lengthSq() < 1e-4 || to.lengthSq() < 1e-4) {
        last.copy(pole);
        continue;
      }
      const angle = Math.atan2(this.scratch.crossVectors(from, to).dot(axis), from.dot(to));
      const most = POLE_TURN_RATE * Math.max(dt, 1 / 120);
      if (Math.abs(angle) <= most) {
        last.copy(pole);
        continue;
      }
      pole.copy(from.normalize().applyAxisAngle(axis, Math.sign(angle) * most));
      last.copy(pole);
    }
    this.downPolesSet = true;
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

  /**
   * Through the opening countdown the engine holds both fighters 2.2 m apart, so for the glove touch
   * the rendered fighter walks in until the gloves meet and is back on his mark before the bell.
   * Returns the offset from the engine position, and keeps the walk's velocity for the footwork.
   */
  private touchWalk(fighter: FighterSnapshot, opponent: FighterSnapshot, dt: number, sampledTick: number): THREE.Vector3 {
    this.countdownEnd = latchEndTick(this.countdownEnd, sampledTick, this.countdownTicks);
    const walk = this.countdownEnd === null ? 0 : touchWalkProgress(this.countdownEnd - sampledTick);
    const towardX = this.mapping.x(opponent.x) - this.mapping.x(fighter.x);
    const towardZ = this.mapping.z(opponent.y) - this.mapping.z(fighter.y);
    const gap = Math.hypot(towardX, towardZ);
    const share = gap > TOUCH_GLOVES_GAP ? ((gap - TOUCH_GLOVES_GAP) / 2 / gap) * walk : 0;
    // Capped at a walk, so a jump (a client that joins mid-countdown) is not taken as one huge stride.
    this.touchVelocity.set(towardX * share - this.touchOffset.x, 0, towardZ * share - this.touchOffset.z).divideScalar(Math.max(dt, 1e-3)).clampLength(0, TOUCH_WALK_TOP_SPEED);
    return this.touchOffset.set(towardX * share, 0, towardZ * share);
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
    const leadTarget = this.scratchC.set(0.48 * mirror, 1.22, 0.52);
    const rearTarget = this.scratchD.set(-0.48 * mirror, 1.22, 0.52);
    if (this.breakAimed) {
      // A palm on the front of each fighter's chest, the side facing the other fighter.
      const [first, second] = this.breakFighters;
      const toward = this.scratch.subVectors(second, first).setY(0).normalize();
      const inverse = this.scratchQ.setFromAxisAngle(worldUpVector, -this.yaw);
      const root = this.scratchB.set(this.rootX ?? 0, 0, this.rootZ);
      leadTarget.copy(first).addScaledVector(toward, BREAK_CHEST_DEPTH).sub(root).applyQuaternion(inverse);
      rearTarget.copy(second).addScaledVector(toward, -BREAK_CHEST_DEPTH).sub(root).applyQuaternion(inverse);
      if (leadTarget.x * mirror < rearTarget.x * mirror) {
        root.copy(leadTarget);
        leadTarget.copy(rearTarget);
        rearTarget.copy(root);
      }
      leadTarget.y = BREAK_CHEST_HEIGHT;
      rearTarget.y = BREAK_CHEST_HEIGHT;
    }
    leadHand.position.lerp(leadTarget, blend);
    rearHand.position.lerp(rearTarget, blend);
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
    // Arms all but straight, crossing below the chin and swinging wide past the shoulders, so the call
    // reads from any side and the hands never come up over the face.
    leadHand.position.lerp(seatedScratch.set(0.62 * sweep * mirror, 1.3 + Math.abs(sweep) * 0.1, 0.44), blend);
    rearHand.position.lerp(seatedScratch.set(-0.62 * sweep * mirror, 1.24 + Math.abs(sweep) * 0.1, 0.36), blend);
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
      if (this.fallKneel) {
        // On one knee after a body shot he rises from there straight to his feet.
        stand = smoothstep(RISE_KNEE, 1, u);
        lerpDownPose(pose, this.placeKneel(this.downFrom, mirror), standing, stand);
      } else if (u < RISE_FOURS) {
        const s = smoothstep(0, RISE_FOURS, u);
        const lying = this.fallenFromPhysics ? this.fallen : this.placeLying(mirror);
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
      if (this.fallKneel) this.orientKneel(1 - stand, mirror, leadHand, rearHand, lead, rear);
      return;
    }
    const lying = this.fallKneel ? this.placeKneel(this.downFrom, mirror) : this.placeLying(mirror);
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
    if (this.fallKneel) {
      // Sinking to the knee he stays folded over the shot, the gloves on the ribs and the front knee.
    } else if (this.landProne) {
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
    if (this.fallKneel) this.orientKneel(t, mirror, leadHand, rearHand, lead, rear);
  }

  /**
   * Taking a knee after a body shot: the rear knee on the canvas, folded over the shot with that side's
   * glove clamped on the ribs and the other glove braced on the front knee.
   */
  private placeKneel(out: DownPose, mirror: number): DownPose {
    const struck = this.windedSide;
    const clutchLead = (struck > 0) === (mirror > 0);
    out.hips.set(0.02 * mirror, 0.53, -0.06);
    out.hipsYaw = STANCE.bladeYaw * mirror * 0.3;
    out.hipsPitch = 0.24;
    out.hipsRoll = 0;
    out.shouldersYaw = STANCE.bladeYaw * mirror * 0.2;
    out.spinePitch = 0.62;
    out.headPitch = 0.48;
    (clutchLead ? out.leadHand : out.rearHand).set(struck * 0.13, 0.66, 0.2);
    (clutchLead ? out.rearHand : out.leadHand).set(0.13 * mirror, 0.66, 0.37);
    // Ankle positions: the lead foot flat on the canvas, the rear one behind the knee on its toes.
    out.leadFoot.set(0.16 * mirror, 0.125, 0.32);
    out.rearFoot.set(-0.12 * mirror, 0.12, -0.5);
    out.leadHeel = 0;
    out.rearHeel = 0;
    out.palmsDown = 1;
    return out;
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

  /** The knees, feet and gloves of the kneel, which the lying poses' orientations do not fit. */
  private orientKneel(weight: number, mirror: number, leadHand: HandTarget, rearHand: HandTarget, lead: FootTarget, rear: FootTarget): void {
    if (weight <= 0.001) return;
    const struck = this.windedSide;
    const clutchLead = (struck > 0) === (mirror > 0);
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
    torso.spineRoll = torso.spineRoll * stand + state.spineRoll;
    torso.headPitch = state.headPitch;
    torso.headYaw = torso.headYaw * stand + state.turn;
    torso.headRoll = torso.headRoll * stand + state.headRoll;
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
    if (state.ownJoints > 0) {
      // Turned round the limb rather than mixed: a joint bent the other way from the authored one swings over.
      const own = state.ownJoints * down;
      turnToward(lead.pole, state.leadKnee, own);
      turnToward(rear.pole, state.rearKnee, own);
      turnToward(leadHand.pole, state.leadElbow, own);
      turnToward(rearHand.pole, state.rearElbow, own);
      turnToward(leadHand.knuckles, state.leadKnuckles, own);
      turnToward(leadHand.palm, state.leadPalm, own);
      turnToward(rearHand.knuckles, state.rearKnuckles, own);
      turnToward(rearHand.palm, state.rearPalm, own);
    }
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
    this.bottle.dispose();
    this.boxer.dispose();
  }
}

const STOOL_SEAT_HEIGHT = 0.44;
/** Seated weight below which a rising fighter's hips are about 0.2 m clear of the seat. */
const STOOL_CLEAR_SEATED = 0.2;
/** The engine counts a knockdown one number a second; the counting arm starts down this far into each second. */
const COUNT_TICKS = 30;
const COUNT_DROP_START = 0.75;
/** Where the referee's palms press to break a clinch: on each fighter's chest, this far toward the other from his centre, at sternum height. */
const BREAK_CHEST_DEPTH = 0.26;
const BREAK_CHEST_HEIGHT = 1.2;
const TOUCH_GLOVES_START_TICKS = 48;
const TOUCH_GLOVES_END_TICKS = 14;
/** Root-to-root distance at which the touch pose's gloves meet: each glove's front reaches 0.68 m ahead. */
const TOUCH_GLOVES_GAP = 1.34;
/** Countdown ticks left over which the fighters walk in to the touch, and back onto their marks for the bell. */
const TOUCH_WALK_IN_START_TICKS = 80;
const TOUCH_WALK_IN_END_TICKS = 56;
const TOUCH_WALK_BACK_START_TICKS = 24;
const TOUCH_WALK_BACK_END_TICKS = 4;
/** Metres per second; the walk itself peaks at about 1. */
const TOUCH_WALK_TOP_SPEED = 1.5;
/** The engine's taunt length in ticks, over which the lead glove beckons TAUNT_BECKONS times. */
const TAUNT_TICKS = 60;
const TAUNT_BECKONS = 4;
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
  /** The spine's and the head's side bend: only a body the knockout physics left has them; the authored poses have none. */
  spineRoll: number;
  headPitch: number;
  headRoll: number;
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
  /** The head's yaw on the canvas: only a body the knockout physics left has one; the authored poses look along the spine. */
  turn: number;
  /**
   * Where the knees and elbows point, held against the authored directions by `ownJoints`: a body the knockout
   * physics left keeps its own, so the limbs solve the way they lie.
   */
  readonly leadKnee: THREE.Vector3;
  readonly rearKnee: THREE.Vector3;
  readonly leadElbow: THREE.Vector3;
  readonly rearElbow: THREE.Vector3;
  /** And how the gloves are turned: the knuckles' and the palm's directions. */
  readonly leadKnuckles: THREE.Vector3;
  readonly leadPalm: THREE.Vector3;
  readonly rearKnuckles: THREE.Vector3;
  readonly rearPalm: THREE.Vector3;
  ownJoints: number;
}

const downScratch = new THREE.Vector3();
const downForward = new THREE.Vector3(0, 0, 1);
const downBelow = new THREE.Vector3(0, -1, 0);
/** The way a knee faces in its thigh bone's own frame, and the back of each elbow in its upper arm's. */
const KNEECAP = new THREE.Vector3(0, 0, 1);
const ELBOW_BACK_L = new THREE.Vector3(1, 0, 0);
const ELBOW_BACK_R = new THREE.Vector3(-1, 0, 0);
/** How much the way a joint faces counts against its bend, as metres of bend: it decides only for a limb lying nearly straight. */
const STRAIGHT_LIMB_BEND = 0.04;
const fallenTurn = new THREE.Quaternion();
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
    spineRoll: 0,
    headPitch: 0,
    headRoll: 0,
    leadHand: new THREE.Vector3(),
    rearHand: new THREE.Vector3(),
    leadFoot: new THREE.Vector3(),
    rearFoot: new THREE.Vector3(),
    leadHeel: 0,
    rearHeel: 0,
    palmsDown: 0,
    turn: 0,
    leadKnee: new THREE.Vector3(0, 0, 1),
    rearKnee: new THREE.Vector3(0, 0, 1),
    leadElbow: new THREE.Vector3(0, -1, 0),
    rearElbow: new THREE.Vector3(0, -1, 0),
    leadKnuckles: new THREE.Vector3(0, 0, 1),
    leadPalm: new THREE.Vector3(0, -1, 0),
    rearKnuckles: new THREE.Vector3(0, 0, 1),
    rearPalm: new THREE.Vector3(0, -1, 0),
    ownJoints: 0,
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
  out.spineRoll = 0;
  out.headPitch = base.headPitch;
  out.headRoll = 0;
  mirrorX(base.leadHand, mirror, out.leadHand);
  mirrorX(base.rearHand, mirror, out.rearHand);
  mirrorX(base.leadFoot, mirror, out.leadFoot).y += ankle;
  mirrorX(base.rearFoot, mirror, out.rearFoot).y += ankle;
  out.leadHeel = base.leadHeel;
  out.rearHeel = base.rearHeel;
  out.palmsDown = base.palmsDown;
  out.turn = 0;
  out.ownJoints = 0;
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

const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));
const turnAxis = new THREE.Vector3();

/** Turns the direction `out` toward `target` by `t` of the angle between them (both unit length, or near it). */
function turnToward(out: THREE.Vector3, target: THREE.Vector3, t: number): THREE.Vector3 {
  if (t <= 0) return out;
  out.normalize();
  const angle = out.angleTo(target);
  if (angle < 1e-4) return out;
  turnAxis.crossVectors(out, target);
  // Opposite directions have no one way round: go over the top, or round the side for a vertical one.
  if (turnAxis.lengthSq() < 1e-8) turnAxis.crossVectors(out, Math.abs(out.y) < 0.9 ? worldUpVector : downForward);
  return out.applyAxisAngle(turnAxis.normalize(), angle * Math.min(1, t));
}

/**
 * Of the two sets of yaw-pitch-roll angles (YXZ) that give a turn, (pitch, yaw, roll) and (half a turn - pitch,
 * yaw + half a turn, roll + half a turn), the one nearest the angles given, each wrapped to within half a turn of
 * them, so blending toward them takes the short way round. Keeping the pitch within a quarter turn instead made a
 * body lying back past it read with its yaw and roll half a turn out, and the spine built on those was wrung round.
 */
function nearestTurn(turn: THREE.Euler, pitch: number, yaw: number, roll: number): THREE.Euler {
  const ax = pitch + wrapAngle(turn.x - pitch);
  const ay = yaw + wrapAngle(turn.y - yaw);
  const az = roll + wrapAngle(turn.z - roll);
  const bx = pitch + wrapAngle(Math.PI - turn.x - pitch);
  const by = yaw + wrapAngle(turn.y + Math.PI - yaw);
  const bz = roll + wrapAngle(turn.z + Math.PI - roll);
  const first = Math.abs(ax - pitch) + Math.abs(ay - yaw) + Math.abs(az - roll);
  const second = Math.abs(bx - pitch) + Math.abs(by - yaw) + Math.abs(bz - roll);
  return first <= second ? turn.set(ax, ay, az, "YXZ") : turn.set(bx, by, bz, "YXZ");
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
  out.spineRoll = lerp(a.spineRoll, b.spineRoll, t);
  out.headPitch = lerp(a.headPitch, b.headPitch, t);
  out.headRoll = lerp(a.headRoll, b.headRoll, t);
  out.leadHand.copy(a.leadHand).lerp(b.leadHand, t);
  out.rearHand.copy(a.rearHand).lerp(b.rearHand, t);
  out.leadFoot.copy(a.leadFoot).lerp(b.leadFoot, t);
  out.rearFoot.copy(a.rearFoot).lerp(b.rearFoot, t);
  out.leadHeel = lerp(a.leadHeel, b.leadHeel, t);
  out.rearHeel = lerp(a.rearHeel, b.rearHeel, t);
  out.palmsDown = lerp(a.palmsDown, b.palmsDown, t);
  out.turn = lerp(a.turn, b.turn, t);
  turnToward(out.leadKnee.copy(a.leadKnee), b.leadKnee, t);
  turnToward(out.rearKnee.copy(a.rearKnee), b.rearKnee, t);
  turnToward(out.leadElbow.copy(a.leadElbow), b.leadElbow, t);
  turnToward(out.rearElbow.copy(a.rearElbow), b.rearElbow, t);
  turnToward(out.leadKnuckles.copy(a.leadKnuckles), b.leadKnuckles, t);
  turnToward(out.leadPalm.copy(a.leadPalm), b.leadPalm, t);
  turnToward(out.rearKnuckles.copy(a.rearKnuckles), b.rearKnuckles, t);
  turnToward(out.rearPalm.copy(a.rearPalm), b.rearPalm, t);
  out.ownJoints = lerp(a.ownJoints, b.ownJoints, t);
  return out;
}

/** How far a count's end may stray from the one held before it is taken again: a few snapshots. */
const LATCH_SLACK_TICKS = 3;

/**
 * Render tick at which a count carried in the snapshots runs out. The snapshots step such counts once
 * per tick while the render tick moves every frame, so a pose timed straight from the count moves in
 * 30 Hz steps. The end is held instead, and taken again only when the count disagrees with it by more
 * than a few snapshots (a new count, or a jump in the clock). Null while there is no count.
 */
function latchEndTick(held: number | null, sampledTick: number, remaining: number | null): number | null {
  if (remaining === null) return null;
  const end = sampledTick + remaining;
  return held === null || Math.abs(end - held) > LATCH_SLACK_TICKS ? end : held;
}

/** How far through the walk in to the glove touch a fighter is, by countdown ticks left: 0 on his mark, 1 at the touch. */
function touchWalkProgress(ticksLeft: number): number {
  return (1 - smoothstep(TOUCH_WALK_IN_END_TICKS, TOUCH_WALK_IN_START_TICKS, ticksLeft)) * smoothstep(TOUCH_WALK_BACK_END_TICKS, TOUCH_WALK_BACK_START_TICKS, ticksLeft);
}

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
/** An opponent's punch seen early is held back unless its wind-up can play at this share of its speed or faster. */
const MIN_ANTICIPATION_RATE = 0.5;
/** Presses closer together than this usually reach the server before the same step, where the newer one replaces the older. */
const SAME_STEP_TICKS = 0.5;
/** Contact events in which a punch met the opponent: a hit or a block, a parry included. */
const CONNECTING_CONTACTS: ReadonlySet<string> = new Set(["hit", "counter_hit", "block", "perfect_block"]);
const EVASION_POSES: ReadonlySet<string> = new Set(["slip_left", "slip_right", "weave", "pull"]);
/** Seconds after an evasion ends for the head to settle back (the slip, weave and pull ease at 14-16 a second). */
const HEAD_SETTLE_SECONDS = 0.25;
/** Rate at which a punch known to connect turns its aim onto the head where it actually is. */
const FOLLOW_HEAD_RATE = 30;
/** How far the elbow's pull swings out while it turns from the guard's to the punch's. */
const ONSET_ELBOW_FLARE = 2;

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
