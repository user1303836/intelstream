import * as THREE from "three";
import type { BloodLevel } from "../settings";
import type { CombatEvent, Hand } from "../types";
import { CanvasBlood, type RegionUploader } from "./canvas-blood";
import { wearCornerColour } from "./gear";
import { BIG_SHOT, HARD_SHOT, ROCKING_COUNTER, bloodDropsFor, bloodShade, buildChunkGeometry, buildDropletGeometry, buildShardGeometry, buildWoundGeometry, closeCut, dropletShape, eyeTexture, jawWoundTexture, woundTexture, wristWoundTexture } from "./gore";
import { LookShading, SCANNED_LOOK, type FighterLook } from "./looks";
import { SHIELD_RADIUS, buildMouthpieceGeometry, idleShield, stepShield, type ShieldState } from "./mouthpiece";
import { CANVAS_TOP, RING_FIGHT_HALF, ROPE_LINE } from "./world";

const MAX_DROPLETS = 900;
const MAX_MIST = 90;
const MAX_GIBS = 48;
const MAX_SHARDS = 24;
const SHARDS_PER_BURST = 18;
const BRAIN_PER_BURST = 14;
const TEETH_PER_BURST = 5;
const MAX_HEADS = 2;
const MAX_HANDS = 4;
const GIBS_PER_DECAPITATION = 24;
const GIBS_PER_HAND = 16;
const HEAD_RADIUS = 0.12;
const HEAD_SETTLE_SECONDS = 0.35;
const SEVERED_PART_MARGIN = 0.04;
/** Inward speed of a part beyond the ropes, per metre it is beyond them. */
const ROPE_RETURN_RATE = 4;
const DROPLET_GRAVITY = 9.81;
/** Of every `STRAND_PERIOD` drops of blood thrown by a blow, one leads a strand and `STRAND_LINKS` trail it. */
const STRAND_PERIOD = 5;
const STRAND_LINKS = 2;
const STRAND_LAG = 0.09;
const STRAND_THINNING = 0.22;
/**
 * How dark a stain soaks into the canvas: a drop leaves a dark spot, the spray off a cut a lighter
 * splash, and the canvas goes solid only where blood lands again and again, so it gets bloodier round
 * by round instead of the first round painting it solid. A knockdown and a finisher soak in darker.
 */
const DROP_STAIN = 0.7;
const SPLASH_STAIN = 0.45;
const KNOCKDOWN_STAIN = 0.6;
const FINISHER_STAIN = 0.9;
/** A cut's share of a punch's blood (the engine's bleeding over eight) once it is open: bleeding of about 60. */
const OPEN_WOUND = 8;
/** A drop the size of a gob of blood (this radius, in metres) always stains where it lands; fine spray does one time in four. */
const GOB = 0.015;
/** The neck is close to round where it is cut. */
export const NECK_WOUND_RADIUS = 0.068;
const HAND_RADIUS = 0.085;
const MAX_STEP = 0.05;
const SIMULATION_STEP = 1 / 60;

interface Droplet {
  alive: boolean;
  blood: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number;
  maxLife: number;
  r: number; g: number; b: number;
  radius: number;
}

export interface BakedPart {
  /** Carries the mesh's bind positions in a `bindPosition` attribute. */
  readonly geometry: THREE.BufferGeometry;
  readonly map: THREE.Texture | null;
  readonly color: number;
  /** The cut that freed the part, in the part's own frame: its middle, and the flesh that closes it, measured from there. */
  readonly cut?: { readonly position: THREE.Vector3; readonly flesh: THREE.BufferGeometry };
  /** Whose head it is, so it keeps its hair and beard once it is off. */
  readonly look?: FighterLook;
  /** How soaked a severed glove was with the opponent's blood (0..1), so it stays that way. */
  readonly gloveBlood?: number;
}

interface Mist {
  alive: boolean;
  x: number; y: number; z: number;
  life: number;
  maxLife: number;
  scale: number;
}

interface Gib {
  alive: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  rx: number; ry: number; rz: number;
  vrx: number; vry: number; vrz: number;
  life: number;
  scale: number;
  /** Lengthens the chunk along one axis so no two look alike. */
  stretch: number;
  bounces: number;
  stained: boolean;
  kind: DebrisKind;
}

/** Flesh is gone once it lands; teeth, brain and skull lie on the canvas a while. */
type DebrisKind = "flesh" | "tooth" | "brain" | "shard";
const DEBRIS_LIFE: Readonly<Record<DebrisKind, number>> = { flesh: 3, tooth: 6, brain: 14, shard: 14 };
const DEBRIS_BOUNCES: Readonly<Record<DebrisKind, number>> = { flesh: 1, tooth: 3, brain: 1, shard: 2 };

interface SeveredHead {
  readonly mesh: THREE.Mesh;
  readonly defaultGeometry: THREE.BufferGeometry;
  readonly defaultScale: THREE.Vector3;
  readonly cap: THREE.Mesh;
  readonly defaultCap: THREE.BufferGeometry;
  /** Hair and beard of a severed head; null for a hand. */
  readonly look: LookShading | null;
  /** The blood soaked into a severed glove; null for a head. */
  readonly blood: { value: number } | null;
  baked: THREE.BufferGeometry | null;
  bakedFlesh: THREE.BufferGeometry | null;
  readonly radius: number;
  active: boolean;
  moving: boolean;
  eventId: number | null;
  vx: number; vy: number; vz: number;
  vrx: number; vry: number; vrz: number;
  bounces: number;
  stained: boolean;
  /** A head rolls onto an ear once it stops: 0 to 1 through the roll, -1 when it is not rolling. */
  settle: number;
  readonly settleFrom: THREE.Quaternion;
  readonly settleTo: THREE.Quaternion;
  settleFromY: number;
  settleToY: number;
  /** How far the part reaches to either side of its pivot, along its own side-to-side axis. */
  sideLow: number;
  sideHigh: number;
}

interface Stump {
  readonly mesh: THREE.Mesh;
  /** The wound shaped to the cut, once the renderer has measured it. */
  readonly flesh: THREE.BufferGeometry;
  active: boolean;
  fountainLife: number;
  accumulator: number;
  seed: number;
  direction: SprayDirection;
}

/** An eye hanging out of its socket on its nerve, swinging as a weight on a cord. */
interface HangingEye {
  active: boolean;
  eventId: number | null;
  readonly position: THREE.Vector3;
  readonly previous: THREE.Vector3;
  readonly socket: THREE.Vector3;
  /** The way the face points, which the pupil half turns to as it hangs. */
  readonly facing: THREE.Vector3;
  /** The middle of the skull and how the head is turned: the eye lies against the head rather than hanging through it. */
  readonly skull: THREE.Vector3;
  readonly skullTurn: THREE.Quaternion;
  hasSkull: boolean;
  bleeding: number;
  accumulator: number;
}

interface DripEmitter {
  readonly position: THREE.Vector3;
  active: boolean;
  rate: number;
  accumulator: number;
}

const seeded = (seed: number): (() => number) => () => {
  seed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed);
  return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
};

const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;
const idleGib = (): Gib => ({ alive: false, x: 0, y: -50, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, vrx: 0, vry: 0, vrz: 0, life: 0, scale: 0, stretch: 1, bounces: 0, stained: false, kind: "flesh" });
const SHIELD_WHITE = new THREE.Color(0xf4f7fb);
const EYE_RADIUS = 0.012;
/** How far an eye forced out hangs below its socket on the nerve. */
export const EYE_NERVE_LENGTH = 0.055;
const EYE_DAMPING = 0.985;
/** Half the width and height of the head about the middle of the skull, plus the eye, for a hanging eye. */
const SKULL_RADII = new THREE.Vector2(0.085 + EYE_RADIUS, 0.12 + EYE_RADIUS);
/** How far in front of the socket's plane a hanging eye lies on the face, for the cheekbone and the lids. */
const FACE_CLEARANCE = 0.012;
const SALIVA = { r: 0.82, g: 0.86, b: 0.9 } as const;

/** Horizontal world direction (x and z) a spray flies in. */
export interface SprayDirection {
  readonly x: number;
  readonly z: number;
}

/** A spray direction as a unit vector; a bare number is the world-x sign that hit events carry. */
function unitSpray(direction: number | SprayDirection): SprayDirection {
  if (typeof direction === "number") return { x: direction < 0 ? -1 : 1, z: 0 };
  const length = Math.hypot(direction.x, direction.z);
  return Number.isFinite(length) && length > 1e-6 ? { x: direction.x / length, z: direction.z / length } : { x: 1, z: 0 };
}

const unitY = new THREE.Vector3(0, 1, 0);
const UNIT_Z = new THREE.Vector3(0, 0, 1);
const safeStep = (dt: number): number => Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, MAX_STEP) : 0;
const IMPACT_KINDS = new Set(["hit", "counter_hit", "block", "perfect_block", "guard_break", "knockdown", "bleed"]);

/**
 * One axis of a severed part against the ropes. A part that reaches them from inside bounces off.
 * One cut off beyond them, on a fighter leaning into the ropes, is drawn back in rather than moved.
 */
export function confineToRopes(position: number, velocity: number, from: number, limit: number): { position: number; velocity: number } {
  const excess = Math.abs(position) - limit;
  if (excess <= 0) return { position, velocity };
  const side = Math.sign(position);
  if (Math.abs(from) <= limit) return { position: side * limit, velocity: velocity * -0.42 };
  return { position, velocity: -side * Math.max(-side * velocity, excess * ROPE_RETURN_RATE) };
}

export type BloodPattern = "jet" | "fan" | "plume" | "body_burst" | "ooze" | "impact";

export function bloodPatternFor(event: CombatEvent): BloodPattern {
  if (event.kind === "bleed") return "ooze";
  if (event.kind === "knockdown") return "impact";
  const parts = event.detail.split(":");
  if (parts.at(-1) === "body") return "body_burst";
  const punch = parts.find((part) => ["jab", "straight", "hook", "uppercut"].includes(part));
  if (punch === "hook") return "fan";
  if (punch === "uppercut") return "plume";
  return "jet";
}

function copyFiniteQuaternion(target: THREE.Quaternion, source: THREE.Quaternion): void {
  target.set(finite(source.x), finite(source.y), finite(source.z), finite(source.w, 1));
  if (target.lengthSq() < 0.000001) target.identity();
  else target.normalize();
}

function mistTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    gradient.addColorStop(0, "rgba(120,10,16,0.72)");
    gradient.addColorStop(0.5, "rgba(90,8,14,0.36)");
    gradient.addColorStop(1, "rgba(70,6,10,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(canvas);
}

export class Effects3D {
  readonly dropletMesh: THREE.InstancedMesh;
  private readonly droplets: Droplet[] = [];
  private readonly dropletPositions: Float32Array;
  private readonly dropletColors: Float32Array;
  readonly dropletBuffers: { readonly position: THREE.BufferAttribute; readonly color: THREE.BufferAttribute };
  private readonly dropletGeometry: THREE.BufferGeometry;
  private readonly dropletShape = { width: 0, length: 0 };
  private readonly dropletMaterial: THREE.MeshStandardMaterial;
  private readonly dropletMatrix = new THREE.Matrix4();
  private readonly dropletQuaternion = new THREE.Quaternion();
  private readonly dropletScale = new THREE.Vector3();
  private readonly dropletVelocity = new THREE.Vector3();
  private readonly dropletColor = new THREE.Color();
  private dropletIndex = 0;
  /** Live droplets fill the front of the pool, and only they are drawn and uploaded. */
  private liveDroplets = 0;

  readonly mistPoints: THREE.Points;
  private readonly mists: Mist[] = [];
  private readonly mistPositions: Float32Array;
  private readonly mistColors: Float32Array;
  private readonly mistGeometry: THREE.BufferGeometry;
  private readonly mistMaterial: THREE.PointsMaterial;
  private readonly mistMap: THREE.CanvasTexture;
  private mistIndex = 0;

  private readonly canvasBlood: CanvasBlood;

  private readonly gibGeometry: THREE.BufferGeometry;
  private readonly gibMaterial: THREE.MeshStandardMaterial;
  private readonly gibMesh: THREE.InstancedMesh;
  private readonly shardGeometry: THREE.BufferGeometry;
  private readonly shardMaterial: THREE.MeshStandardMaterial;
  private readonly shardMesh: THREE.InstancedMesh;
  private readonly shards: Gib[] = [];
  private shardIndex = 0;
  private readonly gibColor = new THREE.Color();
  private readonly gibs: Gib[] = [];
  private gibIndex = 0;
  private readonly gibMatrix = new THREE.Matrix4();
  private readonly gibPosition = new THREE.Vector3();
  private readonly gibQuaternion = new THREE.Quaternion();
  private readonly gibEuler = new THREE.Euler();
  private readonly gibScale = new THREE.Vector3();

  private readonly headGeometry: THREE.SphereGeometry;
  private readonly headMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly heads: SeveredHead[] = [];
  private readonly handGeometry: THREE.CapsuleGeometry;
  private readonly handMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly hands: SeveredHead[] = [];
  private readonly stumpGeometry: THREE.BufferGeometry;
  private readonly wristStumpGeometry: THREE.BufferGeometry;
  private readonly stumpMaterial: THREE.MeshStandardMaterial;
  private readonly stumpMap: THREE.CanvasTexture;
  private readonly wristMaterial: THREE.MeshStandardMaterial;
  private readonly wristMap: THREE.CanvasTexture;
  private readonly jawMaterial: THREE.MeshStandardMaterial;
  private readonly jawMap: THREE.CanvasTexture;
  private readonly stumpAcross = new THREE.Vector3();
  private readonly settleAxis = new THREE.Vector3();
  private readonly settleUp = new THREE.Vector3();
  private dropletCloseness = 1;
  private readonly stumpOutward = new THREE.Vector3();
  private readonly stumps: Stump[] = [];
  private readonly handStumps: Stump[] = [];
  private readonly lastDecapitationEvent = [null, null] as Array<number | null>;
  private readonly lastBurstEvent = [null, null] as Array<number | null>;
  private readonly lastDismembermentEvent = Array<number | null>(MAX_HANDS).fill(null);

  private readonly eyeGeometry: THREE.SphereGeometry;
  private readonly eyeMap: THREE.CanvasTexture;
  private readonly eyeMaterial: THREE.MeshStandardMaterial;
  private readonly nerveGeometry: THREE.CylinderGeometry;
  private readonly nerveMaterial: THREE.MeshStandardMaterial;
  private readonly eyeMeshes: THREE.Mesh[] = [];
  private readonly nerveMeshes: THREE.Mesh[] = [];
  private readonly eyes: HangingEye[] = [];
  private readonly eyeDirection = new THREE.Vector3();
  private readonly eyeTurn = new THREE.Quaternion();
  private readonly eyeSocketLocal = new THREE.Vector3();
  private readonly shieldGeometry: THREE.BufferGeometry;
  private readonly shieldMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly shieldMeshes: THREE.Mesh[] = [];
  private readonly shields: ShieldState[] = [idleShield(), idleShield()];
  private readonly lastShieldEvent = [null, null] as Array<number | null>;
  /** Materials only for the shader pre-compile, made on the first call for it. */
  private bakedStandIns: { readonly map: THREE.Texture; readonly materials: readonly THREE.MeshStandardMaterial[] } | null = null;

  private readonly dripEmitters: [DripEmitter, DripEmitter] = [
    { position: new THREE.Vector3(), active: false, rate: 0, accumulator: 0 },
    { position: new THREE.Vector3(), active: false, rate: 0, accumulator: 0 },
  ];
  private simulationRemainder = 0;
  private ambientSeed = 0x5f37_59df;
  private shake = 0;
  private bloodLevel: BloodLevel = "full";

  /** `bloodCanvasSize` is the resolution blood on the canvas is painted at, in pixels across the ring. */
  constructor(private readonly scene: THREE.Scene, bloodCanvasSize = 1024) {
    this.dropletPositions = new Float32Array(MAX_DROPLETS * 3);
    this.dropletColors = new Float32Array(MAX_DROPLETS * 3);
    this.dropletBuffers = {
      position: new THREE.BufferAttribute(this.dropletPositions, 3),
      color: new THREE.BufferAttribute(this.dropletColors, 3),
    };
    this.dropletGeometry = buildDropletGeometry();
    this.dropletMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.02 });
    this.dropletMesh = new THREE.InstancedMesh(this.dropletGeometry, this.dropletMaterial, MAX_DROPLETS);
    this.dropletMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dropletMesh.frustumCulled = false;
    this.dropletMesh.castShadow = false;
    scene.add(this.dropletMesh);
    for (let i = 0; i < MAX_DROPLETS; i += 1) {
      this.droplets.push({ alive: false, blood: false, x: 0, y: -50, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, r: 1, g: 1, b: 1, radius: 0.012 });
      this.dropletPositions[i * 3 + 1] = -50;
      this.dropletMesh.setColorAt(i, this.dropletColor.setRGB(0.5, 0.02, 0.04));
      this.writeDropletMatrix(i, this.droplets[i]!);
    }
    this.dropletMesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
    this.dropletMesh.instanceMatrix.needsUpdate = true;
    this.dropletMesh.count = 0;

    this.mistPositions = new Float32Array(MAX_MIST * 3);
    this.mistColors = new Float32Array(MAX_MIST * 4).fill(1);
    this.mistGeometry = new THREE.BufferGeometry();
    this.mistGeometry.setAttribute("position", new THREE.BufferAttribute(this.mistPositions, 3));
    this.mistGeometry.setAttribute("color", new THREE.BufferAttribute(this.mistColors, 4));
    this.mistMap = mistTexture();
    this.mistMaterial = new THREE.PointsMaterial({ size: 0.36, map: this.mistMap, transparent: true, opacity: 0.6, depthWrite: false, sizeAttenuation: true, vertexColors: true });
    this.mistPoints = new THREE.Points(this.mistGeometry, this.mistMaterial);
    this.mistPoints.frustumCulled = false;
    scene.add(this.mistPoints);
    for (let i = 0; i < MAX_MIST; i += 1) {
      this.mists.push({ alive: false, x: 0, y: -50, z: 0, life: 0, maxLife: 1, scale: 1 });
      this.mistPositions[i * 3 + 1] = -50;
    }

    this.canvasBlood = new CanvasBlood(scene, bloodCanvasSize);

    this.gibGeometry = buildChunkGeometry();
    // Each piece carries its whole colour, so teeth are white and brain is grey beside the flesh.
    this.gibMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.34, metalness: 0 });
    this.gibMesh = new THREE.InstancedMesh(this.gibGeometry, this.gibMaterial, MAX_GIBS);
    this.gibMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.gibMesh.frustumCulled = false;
    scene.add(this.gibMesh);
    for (let i = 0; i < MAX_GIBS; i += 1) {
      const gib = idleGib();
      this.gibs.push(gib);
      this.gibMesh.setColorAt(i, this.gibColor.setHex(0x5c0a10));
      this.writeDebrisMatrix(this.gibMesh, i, gib);
    }
    this.gibMesh.instanceMatrix.needsUpdate = true;
    this.shardGeometry = buildShardGeometry();
    this.shardMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0, vertexColors: true, side: THREE.DoubleSide });
    this.shardMesh = new THREE.InstancedMesh(this.shardGeometry, this.shardMaterial, MAX_SHARDS);
    this.shardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shardMesh.frustumCulled = false;
    this.shardMesh.castShadow = true;
    scene.add(this.shardMesh);
    for (let i = 0; i < MAX_SHARDS; i += 1) {
      const shard = idleGib();
      this.shards.push(shard);
      this.shardMesh.setColorAt(i, this.gibColor.setHex(0xffffff));
      this.writeDebrisMatrix(this.shardMesh, i, shard);
    }
    this.shardMesh.instanceMatrix.needsUpdate = true;

    this.headGeometry = new THREE.SphereGeometry(HEAD_RADIUS, 18, 14);
    this.handGeometry = new THREE.CapsuleGeometry(0.055, 0.09, 6, 12);
    this.stumpGeometry = buildWoundGeometry(NECK_WOUND_RADIUS, NECK_WOUND_RADIUS);
    this.wristStumpGeometry = buildWoundGeometry(0.038, 0.042, 0.006);
    this.stumpMap = woundTexture();
    this.stumpMaterial = new THREE.MeshStandardMaterial({ map: this.stumpMap, roughness: 0.3, metalness: 0 });
    this.wristMap = wristWoundTexture();
    this.wristMaterial = new THREE.MeshStandardMaterial({ map: this.wristMap, roughness: 0.3, metalness: 0 });
    this.jawMap = jawWoundTexture();
    this.jawMaterial = new THREE.MeshStandardMaterial({ map: this.jawMap, roughness: 0.28, metalness: 0 });
    for (let i = 0; i < MAX_HEADS; i += 1) {
      const headMaterial = new THREE.MeshStandardMaterial({ color: 0x8a4d32, roughness: 0.76, metalness: 0 });
      this.headMaterials.push(headMaterial);
      const headLook = new LookShading(headMaterial, true);
      const headMesh = new THREE.Mesh(this.headGeometry, headMaterial);
      headMesh.scale.set(0.82, 1.08, 0.9);
      headMesh.castShadow = true;
      headMesh.visible = false;
      scene.add(headMesh);
      const cap = new THREE.Mesh(this.stumpGeometry, this.stumpMaterial);
      cap.visible = false;
      headMesh.add(cap);
      this.heads.push({ mesh: headMesh, defaultGeometry: this.headGeometry, defaultScale: headMesh.scale.clone(), cap, defaultCap: this.stumpGeometry, look: headLook, blood: null, baked: null, bakedFlesh: null, radius: HEAD_RADIUS, active: false, moving: false, eventId: null, vx: 0, vy: 0, vz: 0, vrx: 0, vry: 0, vrz: 0, bounces: 0, stained: false, settle: -1, settleFrom: new THREE.Quaternion(), settleTo: new THREE.Quaternion(), settleFromY: 0, settleToY: 0, sideLow: -HEAD_RADIUS, sideHigh: HEAD_RADIUS });

      const stumpMesh = new THREE.Mesh(this.stumpGeometry, this.stumpMaterial);
      stumpMesh.visible = false;
      scene.add(stumpMesh);
      this.stumps.push({ mesh: stumpMesh, flesh: new THREE.BufferGeometry(), active: false, fountainLife: 0, accumulator: 0, seed: 1, direction: { x: 1, z: 0 } });
    }
    this.eyeGeometry = new THREE.SphereGeometry(EYE_RADIUS, 16, 12);
    this.eyeMap = eyeTexture();
    this.eyeMaterial = new THREE.MeshStandardMaterial({ map: this.eyeMap, roughness: 0.18, metalness: 0 });
    this.nerveGeometry = new THREE.CylinderGeometry(0.0034, 0.0045, 1, 8, 1, true);
    this.nerveGeometry.translate(0, 0.5, 0);
    this.nerveMaterial = new THREE.MeshStandardMaterial({ color: 0xb04048, roughness: 0.25, metalness: 0, side: THREE.DoubleSide });
    for (let index = 0; index < MAX_HEADS; index += 1) {
      const eye = new THREE.Mesh(this.eyeGeometry, this.eyeMaterial);
      const nerve = new THREE.Mesh(this.nerveGeometry, this.nerveMaterial);
      eye.visible = false;
      nerve.visible = false;
      eye.castShadow = true;
      scene.add(eye, nerve);
      this.eyeMeshes.push(eye);
      this.nerveMeshes.push(nerve);
      this.eyes.push({ active: false, eventId: null, position: new THREE.Vector3(), previous: new THREE.Vector3(), socket: new THREE.Vector3(), facing: new THREE.Vector3(0, 0, 1), skull: new THREE.Vector3(), skullTurn: new THREE.Quaternion(), hasSkull: false, bleeding: 0, accumulator: 0 });
    }
    this.shieldGeometry = buildMouthpieceGeometry();
    for (let index = 0; index < MAX_HEADS; index += 1) {
      const material = new THREE.MeshStandardMaterial({ color: 0xe8eef5, roughness: 0.22, metalness: 0, side: THREE.DoubleSide });
      this.shieldMaterials.push(material);
      const mesh = new THREE.Mesh(this.shieldGeometry, material);
      mesh.castShadow = true;
      mesh.visible = false;
      scene.add(mesh);
      this.shieldMeshes.push(mesh);
    }
    for (let index = 0; index < MAX_HANDS; index += 1) {
      const material = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.38, metalness: 0.03 });
      const blood = wearCornerColour(material, true);
      this.handMaterials.push(material);
      const handMesh = new THREE.Mesh(this.handGeometry, material);
      handMesh.scale.set(1.15, 1, 1.35);
      handMesh.castShadow = true;
      handMesh.visible = false;
      scene.add(handMesh);
      const cap = new THREE.Mesh(this.wristStumpGeometry, this.wristMaterial);
      cap.rotation.x = Math.PI;
      cap.position.y = 0.02;
      cap.visible = false;
      handMesh.add(cap);
      this.hands.push({ mesh: handMesh, defaultGeometry: this.handGeometry, defaultScale: handMesh.scale.clone(), cap, defaultCap: this.wristStumpGeometry, look: null, blood, baked: null, bakedFlesh: null, radius: HAND_RADIUS, active: false, moving: false, eventId: null, vx: 0, vy: 0, vz: 0, vrx: 0, vry: 0, vrz: 0, bounces: 0, stained: false, settle: -1, settleFrom: new THREE.Quaternion(), settleTo: new THREE.Quaternion(), settleFromY: 0, settleToY: 0, sideLow: -HAND_RADIUS, sideHigh: HAND_RADIUS });

      const stumpMesh = new THREE.Mesh(this.wristStumpGeometry, this.wristMaterial);
      stumpMesh.visible = false;
      scene.add(stumpMesh);
      this.handStumps.push({ mesh: stumpMesh, flesh: new THREE.BufferGeometry(), active: false, fountainLife: 0, accumulator: 0, seed: 1, direction: { x: 1, z: 0 } });
    }
  }

  /**
   * Droplets are drawn oversized so they read from the broadcast camera; a close camera shrinks
   * them toward their real size. `distance` is from the camera to what it is looking at.
   */
  setViewDistance(distance: number): void {
    this.dropletCloseness = THREE.MathUtils.clamp(finite(distance, 5) / 5, 0.4, 1);
  }

  /**
   * Stand-ins sharing the hidden pools' geometry and materials (blood on the canvas, severed heads and
   * gloves and their wounds, the jaw a burst head leaves, a forced-out eye on its nerve, a gum shield),
   * so their shaders can be compiled ahead of the first bloody hit instead of inside it.
   */
  compileStandIns(): THREE.Mesh[] {
    const hidden = [
      this.canvasBlood.mesh,
      this.heads[0]!.mesh,
      this.hands[0]!.mesh,
      this.stumps[0]!.mesh,
      this.handStumps[0]!.mesh,
      this.eyeMeshes[0]!,
      this.nerveMeshes[0]!,
      this.shieldMeshes[0]!,
    ];
    // Each casts a shadow as its pool does, so the key light's shadow pass can be compiled for it too.
    const standIns = hidden.map((mesh) => Object.assign(new THREE.Mesh(mesh.geometry, mesh.material), { castShadow: mesh.castShadow }));
    standIns.push(Object.assign(new THREE.Mesh(this.stumpGeometry, this.jawMaterial), { castShadow: this.stumps[0]!.mesh.castShadow }));
    // Baked from a fighter, a severed head or glove is drawn with its owner's texture: a variant of its
    // shader of its own, compiled here on materials in that state, which share its program.
    if (this.bakedStandIns === null) {
      const map = new THREE.Texture();
      const head = new THREE.MeshStandardMaterial({ color: 0x8a4d32, roughness: 0.76, metalness: 0, map });
      new LookShading(head, true);
      const glove = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.38, metalness: 0.03, map });
      wearCornerColour(glove, true);
      this.bakedStandIns = { map, materials: [head, glove] };
    }
    for (const material of this.bakedStandIns.materials) standIns.push(Object.assign(new THREE.Mesh(this.headGeometry, material), { castShadow: true }));
    return standIns;
  }

  setBloodLevel(level: BloodLevel): void {
    if (level === this.bloodLevel) return;
    const previous = this.bloodLevel;
    this.bloodLevel = level;
    if (level === "off" || (previous === "full" && level === "reduced")) this.clearArcadeGore();
  }

  get shakeAmount(): number {
    return this.shake;
  }

  get liveParticles(): number {
    return this.droplets.filter((droplet) => droplet.alive).length;
  }

  get liveBloodParticles(): number {
    return this.droplets.filter((droplet) => droplet.alive && droplet.blood).length;
  }

  get liveMist(): number {
    return this.mists.filter((mist) => mist.alive).length;
  }

  /** Stains of blood painted on the canvas since it was last cleaned. */
  get canvasStains(): number {
    return this.canvasBlood.stains;
  }

  /** Sends only the newly painted part of the canvas blood to the GPU from now on. */
  useUploader(uploader: RegionUploader): void {
    this.canvasBlood.useUploader(uploader);
  }

  setLowTier(low: boolean): void {
    this.canvasBlood.setLowTier(low);
  }

  get liveGibs(): number {
    return this.gibs.filter((gib) => gib.alive).length;
  }

  get liveShards(): number {
    return this.shards.filter((shard) => shard.alive).length;
  }

  /** How many teeth, pieces of brain and pieces of skull are out, by kind. */
  debrisCount(kind: DebrisKind): number {
    return [...this.gibs, ...this.shards].filter((gib) => gib.alive && gib.kind === kind).length;
  }

  get activeHeads(): number {
    return this.heads.filter((head) => head.active).length;
  }

  /** Whether a fighter's head has burst, leaving the jaw on his neck. */
  headBurst(fighterIndex: number): boolean {
    const stump = this.stumps[Math.trunc(fighterIndex)];
    return stump !== undefined && stump.active && stump.mesh.material === this.jawMaterial;
  }

  /** Copies the world position of a fighter's severed head into `out`; false when the head is still on. */
  severedHeadPosition(fighterIndex: number, out: THREE.Vector3): boolean {
    const head = this.heads[Math.trunc(fighterIndex)];
    if (head === undefined || !head.active) return false;
    out.copy(head.mesh.position);
    return true;
  }

  /** Copies the direction a severed head's face points into `out`; false when the head is still on. */
  severedHeadFacing(fighterIndex: number, out: THREE.Vector3): boolean {
    const head = this.heads[Math.trunc(fighterIndex)];
    if (head === undefined || !head.active) return false;
    out.set(0, 0, 1).applyQuaternion(head.mesh.quaternion);
    return true;
  }

  /** Whether a fighter's gum shield is out of his mouth. */
  mouthpieceOut(fighterIndex: number): boolean {
    return this.shields[Math.trunc(fighterIndex)]?.out === true;
  }

  /** Copies where a fighter's gum shield is into `out`; false while it is still in his mouth. */
  mouthpiecePosition(fighterIndex: number, out: THREE.Vector3): boolean {
    const shield = this.shields[Math.trunc(fighterIndex)];
    if (shield === undefined || !shield.out) return false;
    out.set(shield.x, shield.y, shield.z);
    return true;
  }

  /**
   * Knocks a fighter's gum shield out of his mouth along the punch: it tumbles, bounces and slides on
   * the canvas and lies there until the round ends. Once out it stays out, unless `again` replays the
   * blow. A spray of spit, and of blood when blood is shown, follows it.
   */
  ejectMouthpiece(fighterIndex: number, mouth: THREE.Vector3, quaternion: THREE.Quaternion, direction: number | SprayDirection, eventId: number, color: number, again = false): boolean {
    if (fighterIndex < 0 || fighterIndex >= MAX_HEADS) return false;
    const index = Math.trunc(fighterIndex);
    const shield = this.shields[index]!;
    const safeEventId = Number.isSafeInteger(eventId) ? eventId : 0;
    if ((shield.out && !again) || this.lastShieldEvent[index] === safeEventId) return false;
    this.lastShieldEvent[index] = safeEventId;
    const rand = seeded(safeEventId * 48271 + index * 7907 + 5);
    const launch = unitSpray(direction);
    const along = 0.9 + rand() * 0.9;
    const vy = 0.9 + rand() * 0.9;
    const across = (rand() - 0.5) * 1.1;
    Object.assign(shield, idleShield(), {
      out: true,
      moving: true,
      x: finite(mouth.x), y: finite(mouth.y, 1.45), z: finite(mouth.z),
      vx: along * launch.x - across * launch.z,
      vy,
      vz: along * launch.z + across * launch.x,
      wx: (rand() - 0.5) * 26,
      wy: (rand() - 0.5) * 18,
      wz: (rand() - 0.5) * 26,
      restYaw: rand() * Math.PI * 2,
    } satisfies Partial<ShieldState>);
    const mesh = this.shieldMeshes[index]!;
    mesh.position.set(shield.x, shield.y, shield.z);
    copyFiniteQuaternion(mesh.quaternion, quaternion);
    mesh.visible = true;
    const material = this.shieldMaterials[index]!;
    material.color.setHex(color).lerp(SHIELD_WHITE, 0.55);
    const bloody = this.bloodLevel !== "off";
    for (let drop = 0; drop < (bloody ? 22 : 12); drop += 1) {
      const angle = rand() * Math.PI * 2;
      const blood = bloody && drop % 3 !== 0;
      this.spawnDroplet(
        shield.x + (rand() - 0.5) * 0.03,
        shield.y + (rand() - 0.5) * 0.03,
        shield.z + (rand() - 0.5) * 0.03,
        shield.vx * (0.5 + rand() * 0.6) + Math.sin(angle) * 0.4,
        shield.vy * (0.4 + rand() * 0.6),
        shield.vz * 0.5 + Math.cos(angle) * 0.4,
        blood ? bloodShade(rand()) : SALIVA,
        0.5 + rand() * 0.5,
        blood,
      );
    }
    return true;
  }

  /**
   * Forces a fighter's eye out of its socket at `socket`, along `forward` (the way the face points):
   * it springs out, then hangs and swings on its nerve, bleeding from the empty socket.
   */
  gougeEye(fighterIndex: number, socket: THREE.Vector3, forward: THREE.Vector3, direction: number | SprayDirection, eventId: number): void {
    if (this.bloodLevel !== "full" || fighterIndex < 0 || fighterIndex >= MAX_HEADS) return;
    const index = Math.trunc(fighterIndex);
    const eye = this.eyes[index]!;
    const safeEventId = Number.isSafeInteger(eventId) ? eventId : 0;
    if (eye.active || eye.eventId === safeEventId) return;
    eye.active = true;
    eye.eventId = safeEventId;
    eye.socket.set(finite(socket.x), finite(socket.y, 1.6), finite(socket.z));
    eye.facing.copy(forward);
    eye.hasSkull = false;
    eye.position.copy(eye.socket).addScaledVector(forward, EYE_RADIUS * 1.5);
    // It leaves at about a metre and a half a second, out of the face and away from the punch.
    this.eyeDirection.copy(forward).multiplyScalar(1.3);
    const launch = unitSpray(direction);
    this.eyeDirection.x += launch.x * 0.5;
    this.eyeDirection.z += launch.z * 0.5;
    eye.previous.copy(eye.position).addScaledVector(this.eyeDirection, -SIMULATION_STEP);
    eye.bleeding = 2;
    eye.accumulator = 0;
    this.eyeMeshes[index]!.visible = true;
    this.nerveMeshes[index]!.visible = true;
    const rand = seeded(safeEventId * 52_711 + index * 3571 + 13);
    for (let drop = 0; drop < 36; drop += 1) {
      const angle = rand() * Math.PI * 2;
      this.spawnDroplet(eye.socket.x, eye.socket.y, eye.socket.z, forward.x * (0.8 + rand()) + Math.sin(angle) * 0.6, 0.4 + rand() * 1.2, forward.z * (0.8 + rand()) + Math.cos(angle) * 0.6, bloodShade(rand()), 0.6 + rand() * 0.6, true);
    }
    for (let puff = 0; puff < 4; puff += 1) this.spawnMist(eye.socket.x + (rand() - 0.5) * 0.1, eye.socket.y + (rand() - 0.5) * 0.08, eye.socket.z + (rand() - 0.5) * 0.1, 0.7 + rand() * 0.6, 0.5 + rand() * 0.4);
    this.writeEye(index);
  }

  /**
   * Keeps the nerve of a hanging eye in its socket as the head moves; `facing` is the way the face
   * points and `skull` the middle of the head, which the eye lies against.
   */
  anchorEye(fighterIndex: number, socket: THREE.Vector3, facing?: THREE.Vector3, skull?: THREE.Vector3, skullTurn?: THREE.Quaternion): void {
    const eye = this.eyes[Math.trunc(fighterIndex)];
    if (eye === undefined || !eye.active) return;
    eye.socket.set(finite(socket.x), finite(socket.y, 1.6), finite(socket.z));
    if (facing !== undefined && facing.lengthSq() > 1e-8) eye.facing.copy(facing).normalize();
    if (skull !== undefined && skullTurn !== undefined) {
      eye.skull.set(finite(skull.x), finite(skull.y, 1.6), finite(skull.z));
      copyFiniteQuaternion(eye.skullTurn, skullTurn);
      eye.hasSkull = true;
    }
  }

  eyeOut(fighterIndex: number): boolean {
    return this.eyes[Math.trunc(fighterIndex)]?.active === true;
  }

  /** Copies where a fighter's hanging eye is into `out`; false while it is in his head. */
  eyePosition(fighterIndex: number, out: THREE.Vector3): boolean {
    const eye = this.eyes[Math.trunc(fighterIndex)];
    if (eye === undefined || !eye.active) return false;
    out.copy(eye.position);
    return true;
  }

  private updateEyes(step: number): void {
    for (const [index, eye] of this.eyes.entries()) {
      if (!eye.active) continue;
      // Verlet: what it moved last step, a little damped, plus gravity; then the nerve holds it.
      this.eyeDirection.copy(eye.position).sub(eye.previous).multiplyScalar(EYE_DAMPING);
      eye.previous.copy(eye.position);
      eye.position.add(this.eyeDirection);
      eye.position.y -= DROPLET_GRAVITY * step * step;
      this.eyeDirection.copy(eye.position).sub(eye.socket);
      const stretch = this.eyeDirection.length();
      if (stretch > EYE_NERVE_LENGTH) eye.position.copy(eye.socket).addScaledVector(this.eyeDirection, EYE_NERVE_LENGTH / stretch);
      if (eye.hasSkull && this.restOnFace(eye)) {
        // It rests where it touches rather than sliding round the head, and the nerve still holds it.
        eye.previous.lerp(eye.position, 0.6);
        this.eyeDirection.copy(eye.position).sub(eye.socket);
        const held = this.eyeDirection.length();
        if (held > EYE_NERVE_LENGTH) eye.position.copy(eye.socket).addScaledVector(this.eyeDirection, EYE_NERVE_LENGTH / held);
      }
      if (eye.position.y < CANVAS_TOP + EYE_RADIUS) eye.position.y = CANVAS_TOP + EYE_RADIUS;
      if (this.bloodLevel === "full" && eye.bleeding > 0) {
        eye.bleeding = Math.max(0, eye.bleeding - step);
        eye.accumulator += step * 14;
        while (eye.accumulator >= 1) {
          eye.accumulator -= 1;
          this.spawnDroplet(eye.socket.x, eye.socket.y - 0.005, eye.socket.z, (this.ambientRandom() - 0.5) * 0.2, -0.2 - this.ambientRandom() * 0.3, (this.ambientRandom() - 0.5) * 0.2, bloodShade(this.ambientRandom()), 0.9, true);
        }
      }
      this.writeEye(index);
    }
  }

  /**
   * Keeps a hanging eye out of the head. Seen in the head's own frame the head behind the face is a
   * column as wide and tall as the skull, ending in the plane of the face just in front of the socket;
   * an eye inside it goes out the shorter way, to the face or to the side. True when it was moved.
   */
  private restOnFace(eye: HangingEye): boolean {
    this.eyeTurn.copy(eye.skullTurn).invert();
    const local = this.eyeDirection.copy(eye.position).sub(eye.skull).applyQuaternion(this.eyeTurn);
    const face = this.eyeSocketLocal.copy(eye.socket).sub(eye.skull).applyQuaternion(this.eyeTurn).z + EYE_RADIUS + FACE_CLEARANCE;
    if (local.z >= face) return false;
    const across = Math.hypot(local.x / SKULL_RADII.x, local.y / SKULL_RADII.y);
    if (across >= 1) return false;
    const toFace = face - local.z;
    const toSide = (1 - across) * Math.min(SKULL_RADII.x, SKULL_RADII.y);
    if (toFace <= toSide || across < 1e-6) local.z = face;
    else {
      local.x /= across;
      local.y /= across;
    }
    eye.position.copy(eye.skull).add(local.applyQuaternion(eye.skullTurn));
    return true;
  }

  private writeEye(index: number): void {
    const eye = this.eyes[index]!;
    const ball = this.eyeMeshes[index]!;
    const nerve = this.nerveMeshes[index]!;
    ball.position.copy(eye.position);
    // The nerve leaves the back of the eye, so the pupil looks away from the socket.
    this.eyeDirection.copy(eye.position).sub(eye.socket);
    const length = this.eyeDirection.length();
    if (length > 1e-5) {
      this.eyeDirection.multiplyScalar(1 / length);
      nerve.quaternion.setFromUnitVectors(unitY, this.eyeDirection);
      this.eyeDirection.addScaledVector(eye.facing, 0.9).normalize();
      ball.quaternion.setFromUnitVectors(UNIT_Z, this.eyeDirection);
    }
    nerve.position.copy(eye.socket);
    nerve.scale.set(1, Math.max(0.001, length - EYE_RADIUS * 0.8), 1);
  }

  /** Puts one fighter's gum shield back in his mouth, for a replay that knocks it out again. */
  returnMouthpiece(fighterIndex: number): void {
    const index = Math.trunc(fighterIndex);
    const shield = this.shields[index];
    if (shield === undefined) return;
    Object.assign(shield, idleShield());
    this.shieldMeshes[index]!.visible = false;
    this.lastShieldEvent[index] = null;
  }

  /** The corner puts the gum shield back in between rounds. */
  clearMouthpieces(): void {
    for (const [index, shield] of this.shields.entries()) {
      Object.assign(shield, idleShield());
      this.shieldMeshes[index]!.visible = false;
      this.lastShieldEvent[index] = null;
    }
  }

  private updateShields(step: number): void {
    for (const [index, shield] of this.shields.entries()) {
      if (!shield.out || !shield.moving) continue;
      const mesh = this.shieldMeshes[index]!;
      const flying = shield.age < 0.3 && !shield.sliding;
      const fromX = shield.x;
      const fromZ = shield.z;
      stepShield(shield, mesh.quaternion, step, CANVAS_TOP);
      const limit = ROPE_LINE - SHIELD_RADIUS - SEVERED_PART_MARGIN;
      const x = confineToRopes(shield.x, shield.vx, fromX, limit);
      const z = confineToRopes(shield.z, shield.vz, fromZ, limit);
      shield.x = x.position;
      shield.vx = x.velocity;
      shield.z = z.position;
      shield.vz = z.velocity;
      mesh.position.set(shield.x, shield.y, shield.z);
      // A thread of spit and blood trails it for the first moments of its flight.
      if (flying && this.ambientRandom() < step * 40) {
        const blood = this.bloodLevel !== "off" && this.ambientRandom() < 0.6;
        this.spawnDroplet(shield.x, shield.y, shield.z, shield.vx * 0.6, shield.vy * 0.6, shield.vz * 0.6, blood ? bloodShade(this.ambientRandom()) : SALIVA, 0.45, blood, 0.003);
      }
    }
  }

  get activeHands(): number {
    return this.hands.filter((hand) => hand.active).length;
  }

  get activeStumps(): number {
    return [...this.stumps, ...this.handStumps].filter((stump) => stump.active).length;
  }

  private spawnDroplet(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: { r: number; g: number; b: number }, life: number, blood: boolean, radius = blood ? 0.0035 + this.ambientRandom() ** 3 * 0.0125 : 0.0025 + this.ambientRandom() ** 2 * 0.004): void {
    // A new droplet joins the live ones at the front; a full pool reuses its slots in turn.
    const index = this.liveDroplets < MAX_DROPLETS ? this.liveDroplets++ : this.dropletIndex++ % MAX_DROPLETS;
    const droplet = this.droplets[index]!;
    droplet.alive = true;
    droplet.blood = blood;
    droplet.radius = radius;
    droplet.x = finite(x);
    droplet.y = finite(y, 1);
    droplet.z = finite(z);
    droplet.vx = finite(vx);
    droplet.vy = finite(vy);
    droplet.vz = finite(vz);
    droplet.maxLife = Math.max(0.05, finite(life, 0.5));
    droplet.life = droplet.maxLife;
    droplet.r = finite(color.r, 0.5);
    droplet.g = finite(color.g, 0.04);
    droplet.b = finite(color.b, 0.06);
    this.dropletPositions[index * 3] = droplet.x;
    this.dropletPositions[index * 3 + 1] = droplet.y;
    this.dropletPositions[index * 3 + 2] = droplet.z;
    this.dropletColors[index * 3] = droplet.r;
    this.dropletColors[index * 3 + 1] = droplet.g;
    this.dropletColors[index * 3 + 2] = droplet.b;
    this.dropletMesh.setColorAt(index, this.dropletColor.setRGB(droplet.r, droplet.g, droplet.b));
    this.writeDropletMatrix(index, droplet);
    this.uploadDroplets(index, index + 1, true);
  }

  /** Draws only the live droplets and uploads the instances from `from` up to `to`. */
  private uploadDroplets(from: number, to: number, colors: boolean): void {
    this.dropletMesh.count = this.liveDroplets;
    if (to <= from) return;
    this.dropletMesh.instanceMatrix.addUpdateRange(from * 16, (to - from) * 16);
    this.dropletMesh.instanceMatrix.needsUpdate = true;
    const instanceColor = this.dropletMesh.instanceColor;
    if (!colors || instanceColor === null) return;
    instanceColor.addUpdateRange(from * 3, (to - from) * 3);
    instanceColor.needsUpdate = true;
  }

  /** Retires the droplet in slot `index` and moves the last live droplet into its place. */
  private retireDroplet(index: number): void {
    const last = this.liveDroplets - 1;
    const retired = this.droplets[index]!;
    retired.alive = false;
    this.liveDroplets = last;
    if (index !== last) {
      const moved = this.droplets[last]!;
      this.droplets[index] = moved;
      this.droplets[last] = retired;
      this.dropletPositions.copyWithin(index * 3, last * 3, last * 3 + 3);
      this.dropletColors.copyWithin(index * 3, last * 3, last * 3 + 3);
      this.dropletMesh.setColorAt(index, this.dropletColor.setRGB(moved.r, moved.g, moved.b));
      this.writeDropletMatrix(index, moved);
    }
    this.dropletPositions[last * 3 + 1] = -50;
    this.writeDropletMatrix(last, retired);
  }

  /** Spawns a droplet whose horizontal velocity is given along the spray and across it. */
  private sprayDroplet(spray: SprayDirection, x: number, y: number, z: number, along: number, vy: number, across: number, color: { r: number; g: number; b: number }, life: number, blood: boolean, radius?: number): void {
    this.spawnDroplet(x, y, z, along * spray.x - across * spray.z, vy, along * spray.z + across * spray.x, color, life, blood, radius);
  }

  private writeDropletMatrix(index: number, droplet: Droplet): void {
    if (!droplet.alive) {
      this.dropletScale.setScalar(0);
      this.dropletQuaternion.identity();
      this.dropletMatrix.compose(this.dropletVelocity.set(0, -50, 0), this.dropletQuaternion, this.dropletScale);
      this.dropletMesh.setMatrixAt(index, this.dropletMatrix);
      return;
    }
    const speed = Math.hypot(droplet.vx, droplet.vy, droplet.vz);
    if (speed > 1e-4) {
      this.dropletVelocity.set(droplet.vx / speed, droplet.vy / speed, droplet.vz / speed);
      this.dropletQuaternion.setFromUnitVectors(unitY, this.dropletVelocity);
    } else {
      this.dropletQuaternion.identity();
    }
    const fade = Math.min(1, droplet.life / (droplet.maxLife * 0.3)) * this.dropletCloseness;
    const shape = dropletShape(droplet.radius * fade, speed, this.dropletShape);
    this.dropletScale.set(shape.width, shape.length, shape.width);
    this.dropletMatrix.compose(this.dropletVelocity.set(droplet.x, droplet.y, droplet.z), this.dropletQuaternion, this.dropletScale);
    this.dropletMesh.setMatrixAt(index, this.dropletMatrix);
  }

  private spawnMist(x: number, y: number, z: number, scale: number, life: number): void {
    const index = this.mistIndex % MAX_MIST;
    this.mistIndex += 1;
    const mist = this.mists[index]!;
    mist.alive = true;
    mist.x = finite(x);
    mist.y = finite(y, 1);
    mist.z = finite(z);
    mist.maxLife = Math.max(0.05, finite(life, 0.5));
    mist.life = mist.maxLife;
    mist.scale = Math.max(0.1, finite(scale, 1));
    this.mistPositions[index * 3] = mist.x;
    this.mistPositions[index * 3 + 1] = mist.y;
    this.mistPositions[index * 3 + 2] = mist.z;
    this.mistColors[index * 4 + 3] = Math.min(1, mist.scale);
    this.mistGeometry.attributes.position!.needsUpdate = true;
    this.mistGeometry.attributes.color!.needsUpdate = true;
  }

  private placeDecal(x: number, z: number, scaleX: number, scaleZ: number, rotation: number, opacity: number, color: number): void {
    this.canvasBlood.stain(
      finite(x),
      finite(z),
      Math.max(0.01, finite(scaleX, 0.2)) * 0.28,
      Math.max(0.01, finite(scaleZ, 0.15)) * 0.28,
      finite(rotation),
      THREE.MathUtils.clamp(finite(opacity, 0.4), 0, 0.95),
      color,
    );
  }

  private ambientRandom(): number {
    this.ambientSeed = Math.imul(this.ambientSeed ^ (this.ambientSeed >>> 15), 1 | this.ambientSeed);
    this.ambientSeed ^= this.ambientSeed + Math.imul(this.ambientSeed ^ (this.ambientSeed >>> 7), 61 | this.ambientSeed);
    return ((this.ambientSeed ^ (this.ambientSeed >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Blood thrown onto the canvas round `x`, `z`: `stamps` blots of about `opacity` each (a quarter as
   * many, smaller and fainter, with reduced blood). One splash is a stain the canvas shows through, and
   * where splashes land on each other it darkens, so the canvas gets bloodier as the bout goes on.
   */
  splatter(x: number, z: number, scale: number, rand: () => number = () => this.ambientRandom(), stamps = 12, opacity = FINISHER_STAIN): void {
    if (this.bloodLevel === "off") return;
    const reduced = this.bloodLevel === "reduced";
    const drops = reduced ? Math.ceil(stamps / 4) : stamps;
    const modeScale = reduced ? 0.35 : 1;
    for (let i = 0; i < drops; i += 1) {
      const angle = rand() * Math.PI * 2;
      const radius = rand() * (reduced ? 0.22 : 0.48) * scale;
      this.placeDecal(
        x + Math.sin(angle) * radius,
        z + Math.cos(angle) * radius,
        (0.35 + rand() * 0.9) * scale * modeScale,
        (0.2 + rand() * 0.65) * scale * modeScale,
        rand() * Math.PI,
        opacity * (0.75 + rand() * 0.5) * (reduced ? 0.6 : 1),
        i === 0 ? 0x4c070b : 0x6e0d13,
      );
    }
  }

  /** Blood pooling on the canvas, `radius` metres from `x`, `z`; `stamp` picks the shape of its edge. */
  pool(x: number, z: number, radius: number, stamp: number): void {
    if (this.bloodLevel === "off") return;
    const reduced = this.bloodLevel === "reduced";
    this.canvasBlood.pool(finite(x), finite(z), Math.max(0.02, finite(radius, 0.1)) * (reduced ? 0.5 : 1), reduced ? 0.45 : 0.92, stamp);
  }

  /**
   * Blood, sweat and chunks for a contact. `spray` is the way the punch travelled (from puncher to
   * recipient); without it the event's world-x sign stands in.
   */
  addEvent(event: CombatEvent, targetWorld: THREE.Vector3, reducedMotion: boolean, spray?: SprayDirection): void {
    if (!IMPACT_KINDS.has(event.kind)) return;
    const rand = seeded(event.event_id * 7919 + 17);
    const blocked = event.kind === "block" || event.kind === "perfect_block";
    const pattern = bloodPatternFor(event);
    const launch = unitSpray(spray ?? event.direction);
    // Sweat and chunks are pushed along the punch as hard as the event's sign says (a block may carry none).
    const push = spray === undefined ? Math.abs(finite(event.direction)) : 1;
    const origin = { x: finite(targetWorld.x), y: event.detail.endsWith(":body") ? 1.05 : 1.58, z: finite(targetWorld.z) };
    // A cut's beat throws no sweat and shakes nothing: no punch landed.
    const beat = event.kind === "bleed";
    const sweatCount = reducedMotion || beat ? 0 : Math.round((blocked ? 6 : 16) + Math.min(20, Math.max(0, event.amount) / 20));
    const strand = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, radius: 0, color: bloodShade(0) };
    // The engine's blood is the cut's bleeding over eight plus the damage over four: the first part is
    // what an open wound throws. A block's amount is the guard's damage and a knockdown's its count,
    // neither the weight of the punch.
    const landed = event.kind === "hit" || event.kind === "counter_hit";
    const wound = landed ? Math.max(0, event.blood - Math.floor(Math.max(0, event.amount) / 4)) : 0;
    const bloodCount = reducedMotion || event.blood <= 0 || this.bloodLevel === "off"
      ? 0
      : beat
        // The drip from the face carries the bleeding, and the beat adds a few drops.
        ? (this.bloodLevel === "reduced" ? 1 : Math.min(5, 2 + Math.floor(Math.max(0, event.amount) / 12)))
        : this.bloodLevel === "reduced"
          ? Math.min(24, Math.round(event.blood * (blocked ? 0.12 : 0.24)))
          // The guard takes the punch, and half the blood it would have thrown.
          : blocked ? Math.round(bloodDropsFor(event.blood, 0) / 2) : bloodDropsFor(event.blood, landed ? event.amount : 0);
    if (!beat) this.shake = Math.min(0.09, this.shake + (blocked ? 0.008 : Math.max(0.012, event.amount / 2600)));
    if (event.kind === "knockdown") this.shake = Math.min(0.14, this.shake + 0.06);

    for (let i = 0; i < sweatCount; i += 1) {
      const angle = rand() * Math.PI * 2;
      const outward = 0.4 + rand() * 0.9;
      this.sprayDroplet(
        launch,
        origin.x + (rand() - 0.5) * 0.12,
        origin.y + (rand() - 0.5) * 0.14,
        origin.z + (rand() - 0.5) * 0.12,
        Math.sin(angle) * outward + push * (0.5 + rand() * 0.9),
        0.6 + rand() * 1.5,
        Math.cos(angle) * outward,
        { r: 0.82, g: 0.9, b: 1.0 },
        0.5 + rand() * 0.5,
        false,
      );
    }
    for (let i = 0; i < bloodCount; i += 1) {
      const link = i % STRAND_PERIOD;
      if (link > 0 && link <= STRAND_LINKS) {
        const slower = 1 - STRAND_LAG * link;
        this.spawnDroplet(strand.x, strand.y, strand.z, strand.vx * slower, strand.vy * slower, strand.vz * slower, strand.color, strand.life, true, strand.radius * (1 - STRAND_THINNING * link));
        continue;
      }
      const arterial = link === 0;
      const angle = (rand() - 0.5) * Math.PI;
      const speed = arterial ? 2.2 + rand() * 1.8 : 0.9 + rand() * 1.5;
      let along = speed;
      let vy = 0.5 + rand() * 1.25;
      let across = (rand() - 0.5) * 0.5;
      if (pattern === "fan") {
        along = speed * (0.45 + Math.cos(angle) * 0.35);
        vy = 0.55 + rand() * 1.15;
        across = Math.sin(angle) * speed * 0.9;
      } else if (pattern === "plume") {
        along = speed * (0.25 + rand() * 0.25);
        vy = 1.8 + rand() * 2.2;
        across = (rand() - 0.5) * speed * 0.65;
      } else if (pattern === "body_burst") {
        along = speed * (0.55 + rand() * 0.45);
        vy = -0.15 + rand() * 1.05;
        across = Math.sin(angle) * speed * 0.75;
      } else if (pattern === "ooze") {
        along = 0.08 + rand() * 0.22;
        vy = -0.3 - rand() * 0.55;
        across = (rand() - 0.5) * 0.22;
      } else if (pattern === "impact") {
        along = speed * (0.45 + rand() * 0.65);
        vy = 0.9 + rand() * 2.1;
        across = Math.sin(angle) * speed;
      } else {
        const spread = arterial ? 0.12 : 0.34;
        along = speed * (0.8 + rand() * 0.35);
        vy = arterial ? 1.3 + rand() * 1.6 : 0.5 + rand() * 1.25;
        across = (rand() - 0.5) * speed * spread;
      }
      // Authored along and across the punch, turned onto the line it travelled; a strand's links follow its lead.
      const vx = along * launch.x - across * launch.z;
      const vz = along * launch.z + across * launch.x;
      const color = bloodShade(rand());
      const x = origin.x + (rand() - 0.5) * 0.12;
      const y = origin.y + (rand() - 0.5) * 0.14;
      const z = origin.z + (rand() - 0.5) * 0.12;
      const life = 0.65 + rand() * 0.85;
      if (!arterial) {
        this.spawnDroplet(x, y, z, vx, vy, vz, color, life, true);
        continue;
      }
      strand.x = x;
      strand.y = y;
      strand.z = z;
      strand.vx = vx;
      strand.vy = vy;
      strand.vz = vz;
      strand.color = color;
      strand.life = life;
      strand.radius = 0.008 + rand() * 0.008;
      this.spawnDroplet(x, y, z, vx, vy, vz, color, life, true, strand.radius);
    }
    const misty = (event.kind === "hit" && event.amount >= HARD_SHOT) || event.kind === "knockdown" || event.kind === "counter_hit" || wound >= OPEN_WOUND * 2;
    if (!reducedMotion && event.blood > 0 && this.bloodLevel !== "off" && misty) {
      // The worse the cut, the thicker the mist off every punch, so the blood in the air grows round by round.
      const puffs = this.bloodLevel === "reduced" ? (event.kind === "knockdown" ? 3 : 2) : (event.kind === "knockdown" ? 14 : 10 + Math.min(8, Math.floor(wound / 4)));
      const scale = this.bloodLevel === "reduced" ? 0.35 : 1;
      for (let i = 0; i < puffs; i += 1) {
        this.spawnMist(origin.x + (rand() - 0.5) * 0.34, origin.y + (rand() - 0.5) * 0.26, origin.z + (rand() - 0.5) * 0.34, (0.9 + rand() * 1.2) * scale, 0.55 + rand() * 0.55);
      }
    }
    // The canvas is splashed by what an open wound throws and by a man going down, not by every punch
    // that draws a little blood: the drops that land paint the rest.
    const stamps = event.kind === "knockdown" ? 12 : Math.min(8, Math.round(wound / 4));
    if (stamps > 0 && this.bloodLevel !== "off") {
      const knockdown = event.kind === "knockdown";
      this.splatter(origin.x + (rand() - 0.5) * 0.6, origin.z + (rand() - 0.5) * 0.6, knockdown ? 1 + Math.min(2, event.blood / 55) : 0.8 + Math.min(1.2, wound / 30), rand, stamps, knockdown ? KNOCKDOWN_STAIN : SPLASH_STAIN);
    }
    // A punch that rocks him tears flesh from an open cut, and a big counter tears it from any face.
    const rocking = event.amount >= HARD_SHOT || (event.kind === "counter_hit" && event.amount >= ROCKING_COUNTER);
    const tearing = landed && ((rocking && wound >= OPEN_WOUND) || (event.kind === "counter_hit" && event.amount >= BIG_SHOT));
    if (this.bloodLevel === "full" && !reducedMotion && tearing && !event.detail.endsWith(":body")) {
      const chunks = Math.min(8, Math.max(2, Math.round((event.amount - 30) / 10)));
      for (let index = 0; index < chunks; index += 1) {
        const angle = rand() * Math.PI * 2;
        const speed = 0.5 + rand() * 1.8;
        this.sprayGib(
          launch,
          origin.x + (rand() - 0.5) * 0.12,
          origin.y + (rand() - 0.5) * 0.14,
          origin.z + (rand() - 0.5) * 0.12,
          push * (0.5 + rand() * 1.4) + Math.sin(angle) * speed * 0.5,
          0.5 + rand() * 1.7,
          Math.cos(angle) * speed,
          rand,
        );
      }
    }
  }

  private applyBakedPart(part: SeveredHead, baked: BakedPart | undefined, fallbackColor: number): void {
    part.baked?.dispose();
    part.bakedFlesh?.dispose();
    part.baked = null;
    part.bakedFlesh = null;
    part.cap.geometry = part.defaultCap;
    part.cap.quaternion.identity();
    const material = part.mesh.material as THREE.MeshStandardMaterial;
    part.sideLow = -part.radius;
    part.sideHigh = part.radius;
    if (baked !== undefined) {
      part.mesh.geometry = baked.geometry;
      part.baked = baked.geometry;
      part.mesh.scale.setScalar(1);
      const position = baked.geometry.getAttribute("position");
      const used = baked.geometry.getIndex();
      if (used !== null && used.count > 0) {
        part.sideLow = Infinity;
        part.sideHigh = -Infinity;
        for (let at = 0; at < used.count; at += 1) {
          const x = position.getX(used.getX(at));
          part.sideLow = Math.min(part.sideLow, x);
          part.sideHigh = Math.max(part.sideHigh, x);
        }
      }
      material.map = baked.map;
      part.look?.set(baked.look ?? SCANNED_LOOK);
      if (part.blood !== null) part.blood.value = baked.gloveBlood ?? 0;
      material.color.setHex(baked.color);
      if (baked.cut !== undefined) {
        part.cap.geometry = baked.cut.flesh;
        part.bakedFlesh = baked.cut.flesh;
        part.cap.position.copy(baked.cut.position);
      } else {
        // A glove is a mesh of its own, open at the wrist: the wound closes its lowest point.
        baked.geometry.computeBoundingBox();
        const box = baked.geometry.boundingBox;
        part.cap.position.set(0, (box?.min.y ?? 0) + 0.004, 0);
        part.cap.rotation.x = Math.PI;
      }
      part.cap.visible = true;
    } else {
      part.mesh.geometry = part.defaultGeometry;
      part.mesh.scale.copy(part.defaultScale);
      material.map = null;
      material.color.setHex(fallbackColor);
      if (part.blood !== null) part.blood.value = 0;
      part.cap.visible = false;
    }
    material.needsUpdate = true;
  }

  decapitate(
    fighterIndex: number,
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
    direction: number | SprayDirection,
    eventId: number,
    skinColor = 0x8a4d32,
    baked?: BakedPart,
  ): void {
    if (this.bloodLevel !== "full" || fighterIndex < 0 || fighterIndex >= MAX_HEADS) return;
    const index = Math.trunc(fighterIndex);
    const safeEventId = Number.isSafeInteger(eventId) ? eventId : 0;
    const head = this.heads[index]!;
    if (head.active || this.lastDecapitationEvent[index] === safeEventId) return;
    this.applyBakedPart(head, baked, skinColor);
    const rand = seeded(safeEventId * 104729 + index * 8191 + 23);
    const launch = unitSpray(direction);
    this.lastDecapitationEvent[index] = safeEventId;

    head.active = true;
    head.moving = true;
    head.eventId = safeEventId;
    const along = 1.8 + rand() * 1.1;
    head.vy = 2.3 + rand() * 1.1;
    const across = (rand() - 0.5) * 2.2;
    head.vx = along * launch.x - across * launch.z;
    head.vz = along * launch.z + across * launch.x;
    head.vrx = (rand() - 0.5) * 12;
    head.vry = (rand() - 0.5) * 12;
    head.vrz = (rand() - 0.5) * 12;
    head.bounces = 0;
    head.stained = false;
    head.settle = -1;
    head.mesh.position.set(finite(position.x), finite(position.y, 1.55), finite(position.z));
    copyFiniteQuaternion(head.mesh.quaternion, quaternion);
    head.mesh.visible = true;

    const stump = this.stumps[index]!;
    stump.mesh.material = this.stumpMaterial;
    stump.active = true;
    stump.fountainLife = 1.25;
    stump.accumulator = 0;
    stump.seed = safeEventId | 1;
    stump.direction = launch;
    stump.mesh.position.copy(head.mesh.position);
    stump.mesh.quaternion.copy(head.mesh.quaternion);
    stump.mesh.visible = true;

    for (let i = 0; i < GIBS_PER_DECAPITATION; i += 1) {
      const angle = rand() * Math.PI * 2;
      const speed = 0.8 + rand() * 2.4;
      this.sprayGib(
        launch,
        head.mesh.position.x + (rand() - 0.5) * 0.12,
        head.mesh.position.y + (rand() - 0.5) * 0.12,
        head.mesh.position.z + (rand() - 0.5) * 0.12,
        0.7 + rand() * 1.8 + Math.sin(angle) * speed * 0.55,
        0.8 + rand() * 2.4,
        Math.cos(angle) * speed,
        rand,
      );
    }
    for (let i = 0; i < 120; i += 1) {
      const angle = rand() * Math.PI * 2;
      const speed = 1 + rand() * 2.6;
      const shade = rand();
      this.sprayDroplet(
        launch,
        head.mesh.position.x + (rand() - 0.5) * 0.12,
        head.mesh.position.y + (rand() - 0.5) * 0.1,
        head.mesh.position.z + (rand() - 0.5) * 0.12,
        1.2 + rand() * 2.2 + Math.sin(angle) * speed * 0.35,
        0.7 + rand() * 2.7,
        Math.cos(angle) * speed,
        bloodShade(shade),
        0.75 + rand() * 1.1,
        true,
      );
    }
    for (let i = 0; i < 14; i += 1) {
      this.spawnMist(head.mesh.position.x + (rand() - 0.5) * 0.35, head.mesh.position.y + (rand() - 0.5) * 0.25, head.mesh.position.z + (rand() - 0.5) * 0.35, 1 + rand() * 1.4, 0.65 + rand() * 0.55);
    }
    this.splatter(head.mesh.position.x, head.mesh.position.z, 1.5, rand, 18);
  }

  /**
   * The head bursts above the mouth: pieces of skull and brain, teeth and a great spray of blood go out
   * from the middle of the skull at `position`, and the lower jaw is left on the neck.
   */
  burstHead(fighterIndex: number, position: THREE.Vector3, direction: number | SprayDirection, eventId: number): void {
    if (this.bloodLevel !== "full" || fighterIndex < 0 || fighterIndex >= MAX_HEADS) return;
    const index = Math.trunc(fighterIndex);
    const safeEventId = Number.isSafeInteger(eventId) ? eventId : 0;
    const stump = this.stumps[index]!;
    if (stump.active || this.lastBurstEvent[index] === safeEventId) return;
    this.lastBurstEvent[index] = safeEventId;
    const rand = seeded(safeEventId * 91_813 + index * 6151 + 41);
    const launch = unitSpray(direction);
    const x = finite(position.x);
    const y = finite(position.y, 1.6);
    const z = finite(position.z);
    const scatter = (count: number, kind: DebrisKind, speed: number, spread: number, lift: number): void => {
      for (let piece = 0; piece < count; piece += 1) {
        const around = rand() * Math.PI * 2;
        const up = rand() * 1.2 - 0.2;
        const flat = Math.sqrt(Math.max(0, 1 - up * up));
        const pace = speed + rand() * spread;
        this.spawnGib(
          x + Math.cos(around) * flat * 0.06,
          y + up * 0.05 - (kind === "tooth" ? 0.07 : 0),
          z + Math.sin(around) * flat * 0.06,
          Math.cos(around) * flat * pace + launch.x * pace * 0.45,
          up * pace + lift,
          Math.sin(around) * flat * pace + launch.z * pace * 0.45,
          rand,
          kind,
        );
      }
    };
    scatter(SHARDS_PER_BURST, "shard", 2.2, 2.4, 1);
    scatter(BRAIN_PER_BURST, "brain", 1.2, 1.8, 0.8);
    scatter(TEETH_PER_BURST, "tooth", 1, 1.4, 0.6);
    for (let drop = 0; drop < 180; drop += 1) {
      const around = rand() * Math.PI * 2;
      const up = rand() * 1.3 - 0.3;
      const flat = Math.sqrt(Math.max(0, 1 - Math.min(1, up * up)));
      const pace = 1.4 + rand() * 3.2;
      this.spawnDroplet(
        x + (rand() - 0.5) * 0.1,
        y + (rand() - 0.5) * 0.1,
        z + (rand() - 0.5) * 0.1,
        Math.cos(around) * flat * pace + launch.x * pace * 0.35,
        up * pace + 0.8,
        Math.sin(around) * flat * pace + launch.z * pace * 0.35,
        bloodShade(rand()),
        0.8 + rand() * 1.1,
        true,
        0.004 + rand() ** 2 * 0.014,
      );
    }
    for (let puff = 0; puff < 24; puff += 1) {
      this.spawnMist(x + (rand() - 0.5) * 0.5, y + (rand() - 0.3) * 0.4, z + (rand() - 0.5) * 0.5, 1.2 + rand() * 1.6, 0.8 + rand() * 0.7);
    }
    this.splatter(x + launch.x * 0.3, z + launch.z * 0.3, 2.2, rand, 18);
    this.shake = Math.min(0.16, this.shake + 0.1);
    stump.mesh.material = this.jawMaterial;
    stump.active = true;
    stump.fountainLife = 1.8;
    stump.accumulator = 0;
    stump.seed = safeEventId | 1;
    stump.direction = launch;
    stump.mesh.position.set(x, y - 0.08, z);
    stump.mesh.visible = true;
  }

  dismemberHand(
    fighterIndex: number,
    side: Hand,
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
    direction: number | SprayDirection,
    eventId: number,
    color: number,
    baked?: BakedPart,
  ): void {
    if (this.bloodLevel !== "full" || fighterIndex < 0 || fighterIndex >= MAX_HEADS) return;
    const index = Math.trunc(fighterIndex) * 2 + (side === "left" ? 0 : 1);
    const safeEventId = Number.isSafeInteger(eventId) ? eventId : 0;
    const hand = this.hands[index]!;
    if (hand.active || this.lastDismembermentEvent[index] === safeEventId) return;
    this.applyBakedPart(hand, baked, color);
    const rand = seeded(safeEventId * 130363 + index * 12289 + 37);
    const launch = unitSpray(direction);
    this.lastDismembermentEvent[index] = safeEventId;
    hand.active = true;
    hand.moving = true;
    hand.eventId = safeEventId;
    const along = 1.3 + rand() * 1.1;
    hand.vy = 1.5 + rand() * 1.2;
    const across = (rand() - 0.5) * 1.8;
    hand.vx = along * launch.x - across * launch.z;
    hand.vz = along * launch.z + across * launch.x;
    hand.vrx = (rand() - 0.5) * 16;
    hand.vry = (rand() - 0.5) * 16;
    hand.vrz = (rand() - 0.5) * 16;
    hand.bounces = 0;
    hand.stained = false;
    hand.mesh.position.set(finite(position.x), finite(position.y, 1.25), finite(position.z));
    copyFiniteQuaternion(hand.mesh.quaternion, quaternion);
    hand.mesh.visible = true;

    const stump = this.handStumps[index]!;
    stump.active = true;
    stump.fountainLife = 0.9;
    stump.accumulator = 0;
    stump.seed = safeEventId | 1;
    stump.direction = launch;
    stump.mesh.position.copy(hand.mesh.position);
    stump.mesh.quaternion.copy(hand.mesh.quaternion);
    stump.mesh.visible = true;

    for (let gib = 0; gib < GIBS_PER_HAND; gib += 1) {
      const angle = rand() * Math.PI * 2;
      const speed = 0.55 + rand() * 1.8;
      this.sprayGib(
        launch,
        hand.mesh.position.x + (rand() - 0.5) * 0.08,
        hand.mesh.position.y + (rand() - 0.5) * 0.08,
        hand.mesh.position.z + (rand() - 0.5) * 0.08,
        0.5 + rand() * 1.4 + Math.sin(angle) * speed * 0.45,
        0.5 + rand() * 1.9,
        Math.cos(angle) * speed,
        rand,
      );
    }
    for (let drop = 0; drop < 80; drop += 1) {
      const angle = rand() * Math.PI * 2;
      const speed = 0.8 + rand() * 2.1;
      this.sprayDroplet(
        launch,
        hand.mesh.position.x + (rand() - 0.5) * 0.08,
        hand.mesh.position.y + (rand() - 0.5) * 0.08,
        hand.mesh.position.z + (rand() - 0.5) * 0.08,
        0.8 + rand() * 1.7 + Math.sin(angle) * speed * 0.35,
        0.5 + rand() * 2.1,
        Math.cos(angle) * speed,
        bloodShade(rand()),
        0.7 + rand() * 0.9,
        true,
      );
    }
    for (let puff = 0; puff < 8; puff += 1) {
      this.spawnMist(
        hand.mesh.position.x + (rand() - 0.5) * 0.24,
        hand.mesh.position.y + (rand() - 0.5) * 0.18,
        hand.mesh.position.z + (rand() - 0.5) * 0.24,
        0.7 + rand(),
        0.5 + rand() * 0.45,
      );
    }
    this.splatter(hand.mesh.position.x, hand.mesh.position.z, 1.1, rand);
  }

  anchorHandStump(
    fighterIndex: number,
    side: Hand,
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
  ): void {
    if (this.bloodLevel !== "full" || fighterIndex < 0 || fighterIndex >= MAX_HEADS) return;
    const index = Math.trunc(fighterIndex) * 2 + (side === "left" ? 0 : 1);
    const stump = this.handStumps[index]!;
    if (!stump.active) return;
    stump.mesh.position.set(finite(position.x), finite(position.y, 1.2), finite(position.z));
    copyFiniteQuaternion(stump.mesh.quaternion, quaternion);
  }

  /**
   * Keeps the wound on the neck. `rim` is the edge of the cut as the skin is posed, both ends of each
   * edge in turn: with it the wound closes the opening exactly, and without it a disc stands in.
   */
  anchorStump(fighterIndex: number, position: THREE.Vector3, quaternion: THREE.Quaternion, rim?: ArrayLike<number>, across?: THREE.Vector3): void {
    if (this.bloodLevel !== "full" || fighterIndex < 0 || fighterIndex >= MAX_HEADS) return;
    const stump = this.stumps[Math.trunc(fighterIndex)]!;
    if (!stump.active) return;
    stump.mesh.position.set(finite(position.x), finite(position.y, 1.5), finite(position.z));
    if (rim === undefined || rim.length < 18) {
      stump.mesh.geometry = this.stumpGeometry;
      copyFiniteQuaternion(stump.mesh.quaternion, quaternion);
      return;
    }
    closeCut(stump.flesh, rim, stump.mesh.position, this.stumpOutward.set(0, 1, 0).applyQuaternion(quaternion), 0.01, across);
    stump.mesh.geometry = stump.flesh;
    stump.mesh.quaternion.identity();
  }

  restoreFighter(fighterIndex: number): void {
    if (fighterIndex < 0 || fighterIndex >= MAX_HEADS) return;
    const index = Math.trunc(fighterIndex);
    const head = this.heads[index]!;
    head.active = false;
    head.moving = false;
    head.mesh.visible = false;
    head.mesh.position.y = -50;
    this.applyBakedPart(head, undefined, 0x8a4d32);
    const stump = this.stumps[index]!;
    stump.active = false;
    stump.fountainLife = 0;
    stump.accumulator = 0;
    stump.mesh.visible = false;
    stump.mesh.position.y = -50;
    stump.mesh.material = this.stumpMaterial;
    const eye = this.eyes[index]!;
    eye.active = false;
    eye.bleeding = 0;
    this.eyeMeshes[index]!.visible = false;
    this.nerveMeshes[index]!.visible = false;
    for (const handIndex of [index * 2, index * 2 + 1]) {
      const hand = this.hands[handIndex]!;
      hand.active = false;
      hand.moving = false;
      hand.mesh.visible = false;
      hand.mesh.position.y = -50;
      this.applyBakedPart(hand, undefined, 0x1d4ed8);
      const handStump = this.handStumps[handIndex]!;
      handStump.active = false;
      handStump.fountainLife = 0;
      handStump.accumulator = 0;
      handStump.mesh.visible = false;
      handStump.mesh.position.y = -50;
    }
  }

  drip(headWorld: THREE.Vector3, severity: number, reducedMotion: boolean, fighterIndex = 0): void {
    const index = fighterIndex === 1 ? 1 : 0;
    if (this.bloodLevel === "off" || reducedMotion || severity <= 0.05) {
      this.stopDrip(index);
      return;
    }
    const emitter = this.dripEmitters[index];
    emitter.position.set(finite(headWorld.x), finite(headWorld.y, 1.5), finite(headWorld.z));
    emitter.rate = this.bloodLevel === "reduced" ? Math.min(3, severity * 3) : Math.min(18, severity * 14);
    emitter.active = true;
  }

  stopDrip(fighterIndex: number): void {
    const emitter = this.dripEmitters[fighterIndex === 1 ? 1 : 0];
    emitter.active = false;
    emitter.rate = 0;
    emitter.accumulator = 0;
  }

  private updateDripEmitters(step: number): void {
    for (const emitter of this.dripEmitters) {
      if (!emitter.active) continue;
      emitter.accumulator += step * emitter.rate;
      while (emitter.accumulator >= 1) {
        emitter.accumulator -= 1;
        this.spawnDroplet(
          emitter.position.x + (this.ambientRandom() - 0.5) * 0.14,
          emitter.position.y - 0.04,
          emitter.position.z + (this.ambientRandom() - 0.5) * 0.1,
          (this.ambientRandom() - 0.5) * 0.08,
          -0.25 - this.ambientRandom() * 0.4,
          (this.ambientRandom() - 0.5) * 0.08,
          bloodShade(this.ambientRandom()),
          1.1,
          true,
        );
      }
    }
  }

  /** Ejects teeth from the mouth on heavy head contact. */
  spawnTeeth(mouthWorld: THREE.Vector3, direction: number | SprayDirection, count: number, eventId: number): void {
    if (this.bloodLevel === "off") return;
    const rand = seeded((Number.isSafeInteger(eventId) ? eventId : 0) * 7331 + 91);
    const launch = unitSpray(direction);
    const teeth = Math.min(4, Math.max(1, Math.round(count * (this.bloodLevel === "reduced" ? 0.5 : 1))));
    for (let i = 0; i < teeth; i += 1) {
      const angle = rand() * Math.PI * 2;
      this.sprayGib(
        launch,
        finite(mouthWorld.x) + (rand() - 0.5) * 0.04,
        finite(mouthWorld.y, 1.4) + (rand() - 0.5) * 0.02,
        finite(mouthWorld.z) + (rand() - 0.5) * 0.04,
        0.9 + rand() * 1.6 + Math.sin(angle) * 0.6,
        1.1 + rand() * 1.4,
        Math.cos(angle) * 0.7,
        rand,
        "tooth",
      );
    }
    for (let i = 0; i < 18; i += 1) {
      const angle = rand() * Math.PI * 2;
      this.sprayDroplet(launch, finite(mouthWorld.x), finite(mouthWorld.y, 1.4), finite(mouthWorld.z), 0.8 + rand() * 1.4 + Math.sin(angle) * 0.5, 0.6 + rand() * 1.3, Math.cos(angle) * 0.5, bloodShade(rand()), 0.6 + rand() * 0.6, true);
    }
  }

  private spawnGib(x: number, y: number, z: number, vx: number, vy: number, vz: number, rand: () => number, kind: DebrisKind = "flesh"): void {
    const shard = kind === "shard";
    const pool = shard ? this.shards : this.gibs;
    const mesh = shard ? this.shardMesh : this.gibMesh;
    const index = shard ? this.shardIndex++ % MAX_SHARDS : this.gibIndex++ % MAX_GIBS;
    const gib = pool[index]!;
    gib.alive = true;
    gib.kind = kind;
    const shade = 0.55 + rand() * 0.45;
    if (kind === "tooth") this.gibColor.setHex(0xf3ead6);
    else if (kind === "brain") this.gibColor.setHex(rand() < 0.3 ? 0x8a3a3c : 0xb7918e).multiplyScalar(0.8 + shade * 0.25);
    else if (shard) this.gibColor.setScalar(0.85 + shade * 0.15);
    else {
      this.gibColor.setHex(0x5c0a10).multiplyScalar(shade);
      this.gibColor.g *= 0.75 + rand() * 0.25;
    }
    mesh.setColorAt(index, this.gibColor);
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
    gib.x = finite(x);
    gib.y = finite(y, 1.5);
    gib.z = finite(z);
    gib.vx = finite(vx);
    gib.vy = finite(vy);
    gib.vz = finite(vz);
    gib.rx = rand() * Math.PI * 2;
    gib.ry = rand() * Math.PI * 2;
    gib.rz = rand() * Math.PI * 2;
    gib.vrx = (rand() - 0.5) * 18;
    gib.vry = (rand() - 0.5) * 18;
    gib.vrz = (rand() - 0.5) * 18;
    gib.life = kind === "flesh" ? 1.8 + rand() * 1.2 : DEBRIS_LIFE[kind];
    gib.scale = kind === "tooth" ? 0.22 + rand() * 0.12 : shard ? 0.6 + rand() * 0.6 : kind === "brain" ? 0.45 + rand() * 0.55 : 0.3 + rand() * 0.6;
    gib.stretch = kind === "tooth" ? 1 : 0.7 + rand() * 0.9;
    gib.bounces = 0;
    gib.stained = false;
    this.writeDebrisMatrix(mesh, index, gib);
    mesh.instanceMatrix.needsUpdate = true;
  }

  /** Spawns a piece of debris whose horizontal velocity is given along the spray and across it. */
  private sprayGib(spray: SprayDirection, x: number, y: number, z: number, along: number, vy: number, across: number, rand: () => number, kind: DebrisKind = "flesh"): void {
    this.spawnGib(x, y, z, along * spray.x - across * spray.z, vy, along * spray.z + across * spray.x, rand, kind);
  }

  private writeDebrisMatrix(mesh: THREE.InstancedMesh, index: number, gib: Gib): void {
    if (!gib.alive) {
      this.gibPosition.set(0, -50, 0);
      this.gibQuaternion.identity();
      this.gibScale.setScalar(0);
    } else {
      this.gibPosition.set(gib.x, gib.y, gib.z);
      this.gibEuler.set(gib.rx, gib.ry, gib.rz);
      this.gibQuaternion.setFromEuler(this.gibEuler);
      this.gibScale.set(gib.scale * gib.stretch, gib.scale, gib.scale / Math.sqrt(gib.stretch));
    }
    this.gibMatrix.compose(this.gibPosition, this.gibQuaternion, this.gibScale);
    mesh.setMatrixAt(index, this.gibMatrix);
  }

  private updateDebris(pool: readonly Gib[], mesh: THREE.InstancedMesh, dt: number): void {
    let changed = false;
    for (const [index, gib] of pool.entries()) {
      if (!gib.alive) continue;
      changed = true;
      gib.life -= dt;
      if (gib.life <= 0) {
        gib.alive = false;
        this.writeDebrisMatrix(mesh, index, gib);
        continue;
      }
      gib.vy -= 6.4 * dt;
      gib.x += gib.vx * dt;
      gib.y += gib.vy * dt;
      gib.z += gib.vz * dt;
      gib.rx += gib.vrx * dt;
      gib.ry += gib.vry * dt;
      gib.rz += gib.vrz * dt;
      this.confineGib(gib);
      if (gib.y <= CANVAS_TOP + 0.015) {
        gib.y = CANVAS_TOP + 0.015;
        if (!gib.stained && this.bloodLevel === "full" && gib.kind !== "tooth") {
          gib.stained = true;
          this.placeDecal(gib.x, gib.z, 0.24 + gib.scale * 0.16, 0.14 + gib.scale * 0.1, gib.rz, 0.55, 0x620a10);
        }
        if (gib.bounces < DEBRIS_BOUNCES[gib.kind] && Math.abs(gib.vy) > 0.35) {
          gib.bounces += 1;
          gib.vy = Math.abs(gib.vy) * 0.3;
          gib.vx *= 0.68;
          gib.vz *= 0.68;
          gib.vrx *= 0.7;
          gib.vry *= 0.7;
          gib.vrz *= 0.7;
        } else if (gib.kind !== "flesh") {
          // It lies where it came down; a piece of skull settles on its back or its face.
          gib.vx = 0;
          gib.vy = 0;
          gib.vz = 0;
          gib.vrx = gib.vry = gib.vrz = 0;
          if (gib.kind === "shard") gib.rx = Math.round(gib.rx / Math.PI) * Math.PI;
        } else {
          gib.alive = false;
        }
      }
      this.writeDebrisMatrix(mesh, index, gib);
    }
    if (changed) mesh.instanceMatrix.needsUpdate = true;
  }

  private confineGib(gib: Gib): void {
    if (Math.abs(gib.x) > RING_FIGHT_HALF) {
      gib.x = Math.sign(gib.x) * RING_FIGHT_HALF;
      gib.vx *= -0.45;
    }
    if (Math.abs(gib.z) > RING_FIGHT_HALF) {
      gib.z = Math.sign(gib.z) * RING_FIGHT_HALF;
      gib.vz *= -0.45;
    }
  }

  private updateDetachedParts(parts: readonly SeveredHead[], dt: number): void {
    for (const part of parts) {
      if (part.active && part.settle >= 0 && part.settle < 1) {
        part.settle = Math.min(1, part.settle + dt / HEAD_SETTLE_SECONDS);
        const eased = part.settle * part.settle * (3 - 2 * part.settle);
        part.mesh.quaternion.slerpQuaternions(part.settleFrom, part.settleTo, eased);
        part.mesh.position.y = part.settleFromY + (part.settleToY - part.settleFromY) * eased;
      }
      if (!part.active || !part.moving) continue;
      const fromX = part.mesh.position.x;
      const fromZ = part.mesh.position.z;
      part.vy -= 5.8 * dt;
      part.mesh.position.x += part.vx * dt;
      part.mesh.position.y += part.vy * dt;
      part.mesh.position.z += part.vz * dt;
      part.mesh.rotation.x += part.vrx * dt;
      part.mesh.rotation.y += part.vry * dt;
      part.mesh.rotation.z += part.vrz * dt;
      // The ropes keep a severed part in the ring, where the cameras can reach it.
      const limit = ROPE_LINE - part.radius - SEVERED_PART_MARGIN;
      const x = confineToRopes(part.mesh.position.x, part.vx, fromX, limit);
      const z = confineToRopes(part.mesh.position.z, part.vz, fromZ, limit);
      part.mesh.position.x = x.position;
      part.mesh.position.z = z.position;
      part.vx = x.velocity;
      part.vz = z.velocity;
      if (part.mesh.position.y <= CANVAS_TOP + part.radius) {
        part.mesh.position.y = CANVAS_TOP + part.radius;
        if (!part.stained && this.bloodLevel === "full") {
          part.stained = true;
          const stainScale = part.radius === HEAD_RADIUS ? 1 : 0.55;
          this.placeDecal(part.mesh.position.x, part.mesh.position.z, 1.3 * stainScale, 0.9 * stainScale, part.mesh.rotation.z, 0.85, 0x430507);
        }
        if (part.bounces < 2 && Math.abs(part.vy) > 0.42) {
          part.bounces += 1;
          part.vy = Math.abs(part.vy) * 0.32;
          part.vx *= 0.62;
          part.vz *= 0.62;
          part.vrx *= 0.65;
          part.vry *= 0.65;
          part.vrz *= 0.65;
        } else {
          part.moving = false;
          part.vx = 0;
          part.vy = 0;
          part.vz = 0;
          part.vrx = 0;
          part.vry = 0;
          part.vrz = 0;
          if (part.look !== null) this.rollOntoEar(part);
        }
      }
      if (!Number.isFinite(part.mesh.position.x) || !Number.isFinite(part.mesh.position.y) || !Number.isFinite(part.mesh.position.z) || !Number.isFinite(part.mesh.quaternion.x) || !Number.isFinite(part.mesh.quaternion.y) || !Number.isFinite(part.mesh.quaternion.z) || !Number.isFinite(part.mesh.quaternion.w)) {
        part.mesh.position.set(0, CANVAS_TOP + part.radius, 0);
        part.mesh.quaternion.identity();
        part.moving = false;
        part.vx = 0;
        part.vy = 0;
        part.vz = 0;
      }
    }
  }

  /**
   * A head left on the canvas rolls the short way onto an ear, as a head does: its face turns to the
   * side, where a camera can find it, and it lies on the canvas rather than on the ball it bounced as.
   */
  private rollOntoEar(part: SeveredHead): void {
    const side = this.settleAxis.set(1, 0, 0).applyQuaternion(part.mesh.quaternion);
    const up = side.y >= 0 ? 1 : -1;
    part.settleFrom.copy(part.mesh.quaternion);
    part.settleTo.setFromUnitVectors(side, this.settleUp.set(0, up, 0)).multiply(part.mesh.quaternion);
    part.settleFromY = part.mesh.position.y;
    part.settleToY = CANVAS_TOP + (up > 0 ? -part.sideLow : part.sideHigh);
    part.settle = 0;
  }

  private stumpRandom(stump: Stump): number {
    let seed = stump.seed | 0;
    seed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed);
    stump.seed = seed | 0;
    return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
  }

  private updateStumpFountains(dt: number): void {
    if (this.bloodLevel !== "full") return;
    for (const stump of [...this.stumps, ...this.handStumps]) {
      if (!stump.active || stump.fountainLife <= 0) continue;
      stump.fountainLife = Math.max(0, stump.fountainLife - dt);
      stump.accumulator += dt * 36;
      while (stump.accumulator >= 1) {
        stump.accumulator -= 1;
        const first = this.stumpRandom(stump);
        const second = this.stumpRandom(stump);
        const third = this.stumpRandom(stump);
        this.sprayDroplet(
          stump.direction,
          stump.mesh.position.x + (first - 0.5) * 0.08,
          stump.mesh.position.y + 0.015,
          stump.mesh.position.z + (second - 0.5) * 0.08,
          0.35 + first * 0.55,
          1.3 + second * 1.45,
          (third - 0.5) * 0.85,
          bloodShade(first),
          0.65 + third * 0.5,
          true,
        );
      }
    }
  }

  update(dt: number): void {
    this.canvasBlood.update(safeStep(dt));
    this.simulationRemainder += safeStep(dt);
    while (this.simulationRemainder + 1e-9 >= SIMULATION_STEP) {
      this.simulationRemainder = Math.max(0, this.simulationRemainder - SIMULATION_STEP);
      this.simulate(SIMULATION_STEP);
    }
  }

  private simulate(step: number): void {
    this.shake *= Math.pow(0.02, step);
    this.updateDripEmitters(step);
    this.updateStumpFountains(step);
    this.updateDetachedParts(this.heads, step);
    this.updateDetachedParts(this.hands, step);
    this.updateShields(step);
    this.updateEyes(step);
    this.updateDebris(this.gibs, this.gibMesh, step);
    this.updateDebris(this.shards, this.shardMesh, step);

    const live = this.liveDroplets;
    let retired = false;
    for (let i = 0; i < this.liveDroplets;) {
      const droplet = this.droplets[i]!;
      droplet.life -= step;
      if (droplet.life <= 0 || droplet.y < CANVAS_TOP) {
        // A drop leaves a spot the size of the drop: fine spray soaks in unseen, a gob of blood splashes.
        const lands = THREE.MathUtils.clamp(droplet.radius / GOB, 0.25, 1) * (this.bloodLevel === "full" ? 1 : 0.4);
        if (droplet.y < CANVAS_TOP && droplet.blood && this.bloodLevel !== "off" && this.ambientRandom() < lands) {
          const scale = this.bloodLevel === "full" ? 1 : 0.6;
          const size = droplet.radius * (40 + this.ambientRandom() * 20) * scale;
          this.placeDecal(droplet.x, droplet.z, size, size * (0.55 + this.ambientRandom() * 0.35), this.ambientRandom() * Math.PI, this.bloodLevel === "full" ? DROP_STAIN : DROP_STAIN * 0.6, 0x6e0d13);
        }
        // The last live droplet takes this slot and is stepped next.
        this.retireDroplet(i);
        retired = true;
        continue;
      }
      droplet.vy -= DROPLET_GRAVITY * step;
      droplet.x += droplet.vx * step;
      droplet.y += droplet.vy * step;
      droplet.z += droplet.vz * step;
      const fade = Math.min(1, droplet.life / (droplet.maxLife * 0.4));
      this.dropletPositions[i * 3] = droplet.x;
      this.dropletPositions[i * 3 + 1] = droplet.y;
      this.dropletPositions[i * 3 + 2] = droplet.z;
      this.dropletColors[i * 3] = droplet.r * fade;
      this.dropletColors[i * 3 + 1] = droplet.g * fade;
      this.dropletColors[i * 3 + 2] = droplet.b * fade;
      this.writeDropletMatrix(i, droplet);
      i += 1;
    }
    if (live > 0) {
      this.dropletBuffers.position.needsUpdate = true;
      this.dropletBuffers.color.needsUpdate = true;
      this.uploadDroplets(0, this.liveDroplets, retired);
    }

    let mistChanged = false;
    for (const [i, mist] of this.mists.entries()) {
      if (!mist.alive) continue;
      mistChanged = true;
      mist.life -= step;
      if (mist.life <= 0) {
        mist.alive = false;
        this.mistPositions[i * 3 + 1] = -50;
        continue;
      }
      const progress = 1 - mist.life / mist.maxLife;
      this.mistPositions[i * 3] = mist.x;
      this.mistPositions[i * 3 + 1] = mist.y + progress * 0.14;
      this.mistPositions[i * 3 + 2] = mist.z;
      this.mistColors[i * 4 + 3] = Math.max(0, 1 - progress) * Math.min(1, mist.scale);
    }
    if (mistChanged) {
      this.mistGeometry.attributes.position!.needsUpdate = true;
      this.mistGeometry.attributes.color!.needsUpdate = true;
    }
  }

  private clearDroplets(bloodOnly: boolean): void {
    const live = this.liveDroplets;
    for (let index = 0; index < this.liveDroplets;) {
      if (bloodOnly && !this.droplets[index]!.blood) index += 1;
      else this.retireDroplet(index);
    }
    if (this.liveDroplets !== live) {
      this.dropletBuffers.position.needsUpdate = true;
      this.uploadDroplets(0, this.liveDroplets, true);
    }
  }

  private clearMists(): void {
    let changed = false;
    for (const [index, mist] of this.mists.entries()) {
      if (!mist.alive) continue;
      mist.alive = false;
      this.mistPositions[index * 3 + 1] = -50;
      changed = true;
    }
    if (changed) {
      this.mistGeometry.attributes.position!.needsUpdate = true;
      this.mistGeometry.attributes.color!.needsUpdate = true;
    }
  }

  private clearGibs(): void {
    for (const [pool, mesh] of [[this.gibs, this.gibMesh], [this.shards, this.shardMesh]] as const) {
      let changed = false;
      for (const [index, gib] of pool.entries()) {
        if (!gib.alive) continue;
        gib.alive = false;
        this.writeDebrisMatrix(mesh, index, gib);
        changed = true;
      }
      if (changed) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  clearDynamic(): void {
    this.clearDroplets(false);
    this.clearMists();
    this.clearGibs();
    this.clearMouthpieces();
    for (let index = 0; index < MAX_HEADS; index += 1) this.restoreFighter(index);
    this.shake = 0;
    this.stopDrip(0);
    this.stopDrip(1);
    this.simulationRemainder = 0;
    this.ambientSeed = 0x5f37_59df;
  }

  clearArcadeGore(): void {
    this.clearDroplets(true);
    this.clearMists();
    this.clearGibs();
    for (let index = 0; index < MAX_HEADS; index += 1) this.restoreFighter(index);
    this.clearDecals();
    this.stopDrip(0);
    this.stopDrip(1);
    this.simulationRemainder = 0;
  }

  clearDecals(): void {
    this.canvasBlood.clear();
  }

  dispose(): void {
    this.scene.remove(this.dropletMesh);
    this.scene.remove(this.mistPoints);
    this.scene.remove(this.gibMesh);
    this.scene.remove(this.shardMesh);
    this.dropletMesh.dispose();
    this.dropletGeometry.dispose();
    this.dropletMaterial.dispose();
    this.canvasBlood.dispose();
    for (const part of [...this.heads, ...this.hands]) {
      part.baked?.dispose();
      part.bakedFlesh?.dispose();
    }
    for (const stump of [...this.stumps, ...this.handStumps]) stump.flesh.dispose();
    this.mistGeometry.dispose();
    this.mistMaterial.dispose();
    this.mistMap.dispose();
    this.gibMesh.dispose();
    this.gibGeometry.dispose();
    this.gibMaterial.dispose();
    this.shardMesh.dispose();
    this.shardGeometry.dispose();
    this.shardMaterial.dispose();
    this.jawMaterial.dispose();
    this.jawMap.dispose();
    this.headGeometry.dispose();
    for (const material of this.headMaterials) material.dispose();
    this.handGeometry.dispose();
    for (const material of this.handMaterials) material.dispose();
    this.stumpGeometry.dispose();
    this.wristStumpGeometry.dispose();
    this.shieldGeometry.dispose();
    for (const material of this.shieldMaterials) material.dispose();
    for (const mesh of this.shieldMeshes) this.scene.remove(mesh);
    this.eyeGeometry.dispose();
    this.eyeMap.dispose();
    this.eyeMaterial.dispose();
    this.nerveGeometry.dispose();
    this.nerveMaterial.dispose();
    for (const mesh of [...this.eyeMeshes, ...this.nerveMeshes]) this.scene.remove(mesh);
    this.stumpMaterial.dispose();
    this.stumpMap.dispose();
    this.wristMaterial.dispose();
    this.wristMap.dispose();
    if (this.bakedStandIns !== null) {
      this.bakedStandIns.map.dispose();
      for (const material of this.bakedStandIns.materials) material.dispose();
      this.bakedStandIns = null;
    }
    for (const head of this.heads) this.scene.remove(head.mesh);
    for (const hand of this.hands) this.scene.remove(hand.mesh);
    for (const stump of [...this.stumps, ...this.handStumps]) this.scene.remove(stump.mesh);
  }
}
