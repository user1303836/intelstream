import * as THREE from "three";
import { frameFromAxes, type CanonicalBone, type SolvedRig } from "./rig";
import { RING_FIGHT_HALF, ROPE_HEIGHTS, ROPE_LINE } from "./world";
import type { Hand, PunchClass, Target } from "../types";

/**
 * Knockout physics: a Verlet particle body over the fighter's skeleton. It starts from the posed
 * skeleton with its recent velocities, takes the punch as an impulse along the punch line, falls
 * under gravity against the canvas, the ropes and the posts, and is mapped back onto the bones.
 * World space, metres, seconds; every step has the same fixed length, so a given start always
 * produces the same fall, which is what lets the knockout replay show the fall the players saw.
 */

export const P = {
  pelvis: 0, hipL: 1, hipR: 2, belly: 3, chest: 4, upper: 5, neck: 6, shoulderL: 7, shoulderR: 8,
  head: 9, crown: 10, face: 11,
  elbowL: 12, wristL: 13, fistL: 14, elbowR: 15, wristR: 16, fistR: 17,
  kneeL: 18, ankleL: 19, toeL: 20, heelL: 21, kneeR: 22, ankleR: 23, toeR: 24, heelR: 25,
} as const;
export const PARTICLES = 26;

const MASS = [9, 4, 4, 2, 10, 7, 2, 3.5, 3.5, 2.5, 1.5, 1, 1.6, 1, 1, 1.6, 1, 1, 3.6, 1.6, 0.4, 0.6, 3.6, 1.6, 0.4, 0.6];
export const RADIUS = [0.12, 0.09, 0.09, 0.11, 0.14, 0.13, 0.06, 0.07, 0.07, 0.09, 0.085, 0.055, 0.05, 0.045, 0.08, 0.05, 0.045, 0.08, 0.06, 0.05, 0.035, 0.04, 0.06, 0.05, 0.035, 0.04];

/** Helpers fixed to a bone, in metres along the bone's own axes. */
const BELLY_FORWARD = 0.12;
const CROWN_UP = 0.16;
const FACE_FORWARD = 0.09;
const FACE_UP = 0.06;
const FIST_REACH = 0.11;
const HEEL_BACK = 0.07;
const HEEL_DOWN = 0.09;

const RIGID: readonly (readonly [number, number])[] = [
  [P.pelvis, P.hipL], [P.pelvis, P.hipR], [P.hipL, P.hipR], [P.belly, P.hipL], [P.belly, P.hipR], [P.belly, P.pelvis],
  [P.pelvis, P.chest], [P.chest, P.upper],
  [P.upper, P.neck], [P.upper, P.shoulderL], [P.upper, P.shoulderR], [P.neck, P.shoulderL], [P.neck, P.shoulderR], [P.shoulderL, P.shoulderR],
  [P.neck, P.head], [P.head, P.crown], [P.head, P.face], [P.crown, P.face],
  [P.shoulderL, P.elbowL], [P.elbowL, P.wristL], [P.wristL, P.fistL],
  [P.shoulderR, P.elbowR], [P.elbowR, P.wristR], [P.wristR, P.fistR],
  [P.hipL, P.kneeL], [P.kneeL, P.ankleL], [P.ankleL, P.toeL], [P.ankleL, P.heelL], [P.toeL, P.heelL],
  [P.hipR, P.kneeR], [P.kneeR, P.ankleR], [P.ankleR, P.toeR], [P.ankleR, P.heelR], [P.toeR, P.heelR],
];

/** Joint ranges as shares of the distance in the rest pose: the spine and neck bend but do not stretch. */
const RANGES: readonly (readonly [number, number, number, number])[] = [
  [P.hipL, P.shoulderL, 0.8, 1.05], [P.hipR, P.shoulderR, 0.8, 1.05],
  [P.hipL, P.shoulderR, 0.84, 1.08], [P.hipR, P.shoulderL, 0.84, 1.08],
  [P.belly, P.upper, 0.7, 1.06], [P.pelvis, P.upper, 0.86, 1.0], [P.hipL, P.chest, 0.84, 1.08], [P.hipR, P.chest, 0.84, 1.08],
  // The head turns no further than this; the neck cones bound its nod and tilt.
  [P.shoulderL, P.face, 0.76, 1.2], [P.shoulderR, P.face, 0.76, 1.2],
  // Thighs swing forward freely, outward and back a little, and do not cross far.
  [P.kneeL, P.hipR, 0.8, 1.3], [P.kneeR, P.hipL, 0.8, 1.3], [P.kneeL, P.belly, 0.5, 1.12], [P.kneeR, P.belly, 0.5, 1.12],
];

/** The first ranges hold the spine; a stiff body keeps them near where they started. */
const SPINE_RANGES = 8;

/** Absolute minimum distances: limbs do not pass through each other or fold completely. */
const MINIMA: readonly (readonly [number, number, number])[] = [
  [P.kneeL, P.kneeR, 0.13], [P.ankleL, P.ankleR, 0.11], [P.kneeL, P.ankleR, 0.1], [P.kneeR, P.ankleL, 0.1],
  [P.hipL, P.ankleL, 0.2], [P.hipR, P.ankleR, 0.2], [P.shoulderL, P.wristL, 0.14], [P.shoulderR, P.wristR, 0.14],
  [P.face, P.chest, 0.2], [P.crown, P.chest, 0.24], [P.kneeL, P.upper, 0.3], [P.kneeR, P.upper, 0.3],
];

const ARM_PARTS = [P.elbowL, P.wristL, P.fistL, P.elbowR, P.wristR, P.fistR] as const;
/** How much of a blow's carry each part takes: the upper body most, the feet nothing (they stay planted). */
const DRIVE_SHARE = [0.7, 0.6, 0.6, 0.7, 0.9, 1, 1, 1, 1, 1, 1, 1, 0.9, 0.8, 0.8, 0.9, 0.8, 0.8, 0.35, 0.1, 0, 0, 0.35, 0.1, 0, 0];
const TORSO_CAPSULES: readonly (readonly [number, number, number])[] = [[P.pelvis, P.chest, 0.12], [P.chest, P.upper, 0.13]];

/** The same tables flattened, so the step reads them without building anything. */
const RIGID_PAIRS = Int32Array.from(RIGID.flat());
const RANGE_PAIRS = Int32Array.from(RANGES.flatMap(([i, j]) => [i, j]));
const MINIMUM_PAIRS = Int32Array.from(MINIMA.flatMap(([i, j]) => [i, j]));
const MINIMUM_DISTANCES = Float64Array.from(MINIMA.map(([, , distance]) => distance));
const CAPSULES = Int32Array.from(TORSO_CAPSULES.flatMap(([from, to]) => [from, to]));
const CAPSULE_RADII = Float64Array.from(TORSO_CAPSULES.map(([, , radius]) => radius));
const HEAD_SHARES = Float64Array.from([P.head, 1, P.crown, 0.9, P.face, 1, P.neck, 0.45]);
const BODY_SHARES = Float64Array.from([P.belly, 1, P.chest, 0.6, P.pelvis, 0.4, P.hipL, 0.3, P.hipR, 0.3]);
const HEAD_PARTS = [P.head, P.crown, P.face] as const;
const SKULL_PARTS = [P.crown, P.face] as const;
/** What turns the other way as a leaning neck or skull is brought back: the upper chest below the neck, the neck below the skull. */
const NECK_BASE = [P.upper] as const;
const SKULL_BASE = [P.neck] as const;
const FOOT_PARTS = [[P.toeL, P.heelL], [P.toeR, P.heelR]] as const;
const HEEL_PARTS = [[P.heelL], [P.heelR]] as const;
const LOST_HEAD = [P.head, P.crown, P.face] as const;
const LOST_LEFT_HAND = [P.fistL] as const;
const LOST_RIGHT_HAND = [P.fistR] as const;

export const STEP_SECONDS = 1 / 120;
const ITERATIONS = 12;
const GRAVITY = 9.81;
const AIR_DAMPING = 0.998;
const GROUND_FRICTION = 0.5;
const ROPE_RADIUS = 0.03;
const ROPE_SOFTNESS = 0.35;
const POST_RADIUS_WITH_PAD = 0.12;
/** Torso parts never leave the ring; a head or limb may hang out between the ropes. */
const TORSO_PARTS = [P.pelvis, P.hipL, P.hipR, P.belly, P.chest, P.upper] as const;
/** What turns with the shoulders when the spine is wrung past its turn. */
const UPPER_BODY = [P.upper, P.neck, P.shoulderL, P.shoulderR, P.head, P.crown, P.face, P.elbowL, P.wristL, P.fistL, P.elbowR, P.wristR, P.fistR] as const;
/** What turns with the hips: the pelvis and both legs. */
const LOWER_BODY = [P.pelvis, P.hipL, P.hipR, P.belly, P.kneeL, P.ankleL, P.toeL, P.heelL, P.kneeR, P.ankleR, P.toeR, P.heelR] as const;
/** The shoulders turn on the hips no further than this, either way about the spine. */
const SPINE_TWIST = (40 * Math.PI) / 180;
const THIGH_PARTS = [[P.kneeL, P.ankleL, P.toeL, P.heelL], [P.kneeR, P.ankleR, P.toeR, P.heelR]] as const;
const SHIN_PARTS = [[P.ankleL, P.toeL, P.heelL], [P.ankleR, P.toeR, P.heelR]] as const;
/** How fast a limp thigh or shin left standing up topples once the body is down, per step and per unit it points up past `TOPPLE_FROM`. */
const TOPPLE_RATE = 0.08;
const TOPPLE_FROM = 0.35;
const TORSO_SET: ReadonlySet<number> = new Set(TORSO_PARTS);
const APRON_LIMIT = RING_FIGHT_HALF + 0.45;
const OBSTACLE_RADIUS = 0.24;
const OBSTACLE_HEIGHT = 1.75;
const SLEEP_SPEED = 0.012;
const SLEEP_SECONDS = 1;
/** Once the torso has come to rest, a limb held off the canvas by a joint limit is damped out instead of swinging on. */
const LANDED_SPEED = 0.35;
const LANDED_SECONDS = 0.15;
/** A body still sliding this long into the fall (draped on the ropes or the opponent) settles all the same. */
const LANDED_BY_SECONDS = 1.1;
const SETTLE_DAMPING = 0.975;
const SETTLE_RAMP_SECONDS = 0.4;
/** A landed body is put to sleep this long after it landed, whatever is still twitching. */
const SETTLE_SECONDS = 1.2;
/** Steps of the opponent's place kept with a recorded fall (ten seconds). */
const TRACKED_STEPS = 1200;
const MAX_START_SPEED = 3;
const MAX_SPEED = 7;
/** Below this speed a part loses a further share of its speed each step (the body at rest settles instead of creeping). */
const CREEP_SPEED = 0.08;
const CREEP_DAMPING = 0.97;
const KNEE_MAX_FLEX = 2.55;
/** Knees and elbows straighten a little past straight, which keeps the limit away from the straight limb. */
const HYPEREXTENSION = 0.12;
const HINGE_STIFFNESS = 0.5;
/** The neck leans this far from the line of the spine, and the skull this far again on the neck. */
const NECK_CONE = (30 * Math.PI) / 180;
const SKULL_CONE = (32 * Math.PI) / 180;
/** The foot turns in or out on the shin only this far from the plane the knee bends in. */
const FOOT_ROLL = (28 * Math.PI) / 180;
/** And rolls onto its outer edge (inversion) or its inner edge (eversion) only this far, as an ankle does. */
const FOOT_INVERSION = (35 * Math.PI) / 180;
const FOOT_EVERSION = (20 * Math.PI) / 180;
/**
 * A foot on the canvas is held to its range more gently, and no foot is turned further than this in one pass:
 * onto its edge a little faster, since a falling leg rolls the foot quickly and that measure has no blind spot.
 */
const FOOT_GROUNDED = 0.5;
const FOOT_TURN = 0.01;
const FOOT_ROLL_TURN = 0.04;
const CONE_STIFFNESS = 0.4;
/** No pass turns a neck or a skull back further than this. */
const NECK_TURN = 0.02;

interface StyleStiffness {
  /** How much further the knees may bend, in radians, while the legs still hold. */
  readonly knee: number;
  /** How far the spine may bend while the body still holds, as a share of its usual range. */
  readonly spine: number;
  /** Seconds the body holds before it goes limp. */
  readonly seconds: number;
}

/**
 * How the body holds for a moment after the blow before going limp: locked knees and a stiff
 * spine topple like a tree, legs that give at once drop in a heap, half-locked legs sag to the seat, and a body
 * shot doubles him over on knees that bend under him into a kneel before he pitches onto his face.
 */
const STIFFNESS: Readonly<Record<FallStyle, StyleStiffness>> = {
  timber: { knee: 0.12, spine: 0.2, seconds: 0.55 },
  crumple: { knee: KNEE_MAX_FLEX, spine: 1, seconds: 0 },
  sag: { knee: 0.55, spine: 0.6, seconds: 0.3 },
  fold: { knee: 0.9, spine: 1, seconds: 0.5 },
};

const ELBOW_MAX_FLEX = 2.5;
const WRIST_LIMIT = (35 * Math.PI) / 180;
const ANKLE_MIN = (50 * Math.PI) / 180;
const ANKLE_MAX = (135 * Math.PI) / 180;
/**
 * Joints bounded by the distance across them: the ankle between flat and pointed, the gloved
 * wrist nearly straight. [outer, joint, end, smallest bend, largest bend] in radians from straight.
 */
const ANGLE_LIMITS: readonly (readonly [number, number, number, number, number])[] = [
  [P.kneeL, P.ankleL, P.toeL, ANKLE_MIN, ANKLE_MAX], [P.kneeR, P.ankleR, P.toeR, ANKLE_MIN, ANKLE_MAX],
  [P.elbowL, P.wristL, P.fistL, 0, WRIST_LIMIT], [P.elbowR, P.wristR, P.fistR, 0, WRIST_LIMIT],
];
const ANGLE_PAIRS = Int32Array.from(ANGLE_LIMITS.flatMap(([outer, , end]) => [outer, end]));

export type FallStyle = "timber" | "crumple" | "sag" | "fold";


export function fallStyleFor(punchClass: PunchClass | null, target: Target, amount: number, seed: number): FallStyle {
  if (target === "body") return "fold";
  if (amount < 90) return "sag";
  const pick = Math.abs(Math.floor(seed)) % 3;
  if (punchClass === "hook") return pick === 0 ? "timber" : "crumple";
  return pick === 0 ? "crumple" : "timber";
}

export interface ImpulseRecord {
  step: number;
  /** Velocity change of the struck part (the head, or the belly for a body shot). */
  x: number;
  y: number;
  z: number;
  /** Velocity change of the whole body, carried along by the blow. */
  driveX: number;
  driveY: number;
  driveZ: number;
  target: Target;
  twist: number;
  /** The blow that decides how the fighter goes down, when it lands just after the fall began. */
  style?: FallStyle;
}

/** Where the opponent stood at each step of a fall: [active, x, z] per step, and how many steps are written. */
export interface ObstacleTrack {
  readonly data: Float64Array;
  steps: number;
}

/** Where a fall came to rest: its positions, its previous positions and the step it slept at (-1 until it has). */
export interface FallRest {
  readonly position: Float64Array;
  readonly previous: Float64Array;
  steps: number;
}

/**
 * Everything needed to run a fall again: the start, the style, each blow at the step it landed, where the opponent
 * stood, what parts were lost from which step (as [step, mask] pairs), and where the fall came to rest.
 */
export interface FallRecord {
  readonly positions: Float64Array;
  readonly velocities: Float64Array;
  readonly style: FallStyle;
  readonly impulses: ImpulseRecord[];
  readonly offsets: THREE.Quaternion[];
  readonly obstacles: ObstacleTrack;
  readonly losses: number[];
  readonly rest: FallRest;
}

const v = (a: Float64Array, i: number, out: THREE.Vector3): THREE.Vector3 => out.set(a[i * 3]!, a[i * 3 + 1]!, a[i * 3 + 2]!);
/** An angle brought within half a turn of zero. */
const wrapAngle = (angle: number): number => angle - Math.round(angle / (Math.PI * 2)) * Math.PI * 2;
const setV = (a: Float64Array, i: number, value: THREE.Vector3): void => {
  a[i * 3] = value.x;
  a[i * 3 + 1] = value.y;
  a[i * 3 + 2] = value.z;
};

/** The particle body. Pure simulation: it knows nothing about bones. */
export class RagdollBody {
  readonly position = new Float64Array(PARTICLES * 3);
  readonly previous = new Float64Array(PARTICLES * 3);
  /** Positions before the latest step, for drawing between steps. */
  readonly before = new Float64Array(PARTICLES * 3);
  readonly invMass = new Float64Array(PARTICLES);
  private readonly rigidLength = new Float64Array(RIGID.length);
  private readonly rangeMin = new Float64Array(RANGES.length);
  private readonly rangeMax = new Float64Array(RANGES.length);
  private readonly restRange = new Float64Array(RANGES.length);
  private readonly rangeStart = new Float64Array(RANGES.length);
  /** Each knee's bend at the start, so a held knee keeps its bend rather than snapping straight. */
  private readonly kneeStart = new Float64Array(2);
  /** Which way each foot's own side-to-side axis points relative to its knee's hinge at the start. */
  private readonly footSign = new Float64Array(2);
  private readonly turnAxis = new THREE.Vector3();
  private readonly turnQuaternion = new THREE.Quaternion();
  private readonly turnPoint = new THREE.Vector3();
  /** Angle limits written as distance ranges across a joint: [from, to, min, max]. */
  private readonly angleRanges = new Float64Array(ANGLE_LIMITS.length * 2);
  /** Elbow hinge axes at the start, left then right, in world space (for the record). */
  readonly elbowAxes = new Float64Array(6);
  /** Knee hinge axes at the start, in world space. */
  readonly kneeAxes = new Float64Array(6);
  /**
   * Each hinge in its body frame (pelvis for knees, upper torso for elbows): the parent segment's
   * direction at the last step and the hinge axis. Every step the axis turns with the parent's
   * small swing since the last, so it follows the limb without drifting against the body or
   * flipping when the limb ends up far from where it started (an arm flung overhead).
   * [knee L, knee R, elbow L, elbow R] x (direction xyz, axis xyz).
   */
  private readonly hingeStart = new Float64Array(24);
  private readonly hingeNow = new Float64Array(24);
  private readonly swing = new THREE.Quaternion();
  private readonly local = new THREE.Vector3();
  private readonly localAxis = new THREE.Vector3();
  private readonly ropeLines = new Float64Array(4);
  private style: FallStyle = "crumple";
  steps = 0;
  private stillSeconds = 0;
  private torsoStillSeconds = 0;
  private fallSeconds = 0;
  /** Seconds since the torso came to rest, or -1 while it is still falling. */
  private landedSeconds = -1;
  asleep = false;
  private obstacleActive = false;
  private obstacleX = 0;
  private obstacleZ = 0;
  private obstacleTrack: ObstacleTrack | null = null;
  private obstacleTrackLive = false;

  /**
   * A live fall writes where the opponent stood into `track` at every step; a replayed one reads each
   * step's place back from it, so the replay falls exactly as the live fall did whatever the opponent does now.
   */
  trackObstacle(track: ObstacleTrack | null, replay: boolean): void {
    this.obstacleTrack = track;
    this.obstacleTrackLive = track !== null && !replay;
  }
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly c = new THREE.Vector3();
  private readonly d = new THREE.Vector3();
  private readonly e = new THREE.Vector3();
  private readonly fx = new THREE.Vector3();
  private readonly fy = new THREE.Vector3();
  private readonly fz = new THREE.Vector3();
  private readonly gx = new THREE.Vector3();
  private readonly gy = new THREE.Vector3();
  private readonly gz = new THREE.Vector3();
  private readonly pivot = new THREE.Vector3();
  private readonly segmentA = new THREE.Vector3();
  private readonly segmentB = new THREE.Vector3();

  constructor() {
    for (let i = 0; i < PARTICLES; i += 1) this.invMass[i] = 1 / MASS[i]!;
  }

  /** Measures the joint ranges on the rest pose; call once with the rig's rest positions. */
  calibrate(rest: Float64Array): void {
    for (const [index, [i, j]] of RANGES.entries()) this.restRange[index] = this.distance(rest, i, j);
  }

  /**
   * Starts a fall. `positions` and `velocities` are world-space particle states; ranges widen to
   * take in the start so a twisted or crouched fighter does not snap straight at the first step.
   */
  start(positions: Float64Array, velocities: Float64Array, style: FallStyle): void {
    this.position.set(positions);
    this.before.set(positions);
    for (let i = 0; i < PARTICLES * 3; i += 1) this.previous[i] = positions[i]! - velocities[i]! * STEP_SECONDS;
    for (const [index, [i, j]] of RIGID.entries()) this.rigidLength[index] = this.distance(positions, i, j);
    for (const [index, [outer, joint, end, least, most]] of ANGLE_LIMITS.entries()) {
      // Across a joint bent by `bend` from straight: d^2 = a^2 + b^2 + 2ab cos(bend).
      const a = this.distance(positions, outer, joint);
      const b = this.distance(positions, joint, end);
      const now = this.distance(positions, outer, end);
      const across = (bend: number): number => Math.sqrt(a * a + b * b + 2 * a * b * Math.cos(bend));
      this.angleRanges[index * 2] = Math.min(across(most), now);
      this.angleRanges[index * 2 + 1] = Math.max(across(least), now);
    }
    for (const [index, [i, j, low, high]] of RANGES.entries()) {
      const now = this.distance(positions, i, j);
      const rest = this.restRange[index]! > 0 ? this.restRange[index]! : now;
      this.rangeMin[index] = Math.min(rest * low, now * 0.98);
      this.rangeMax[index] = Math.max(rest * high, now * 1.02);
      this.rangeStart[index] = now;
    }
    this.style = style;
    this.steps = 0;
    this.stillSeconds = 0;
    this.torsoStillSeconds = 0;
    this.fallSeconds = 0;
    this.landedSeconds = -1;
    this.asleep = false;
    this.upperFrame(this.position);
    this.pelvisFrame(this.position);
    for (const side of [0, 1] as const) {
      // A bent joint's own plane gives its hinge; a straight one bends the way a person's does.
      this.startHinge(this.elbowAxes, side, side === 0 ? P.shoulderL : P.shoulderR, side === 0 ? P.elbowL : P.elbowR, side === 0 ? P.wristL : P.wristR, this.gx, -1);
      this.startHinge(this.kneeAxes, side, side === 0 ? P.hipL : P.hipR, side === 0 ? P.kneeL : P.kneeR, side === 0 ? P.ankleL : P.ankleR, this.fx, 1);
      this.storeHingeStart(side, side === 0 ? P.hipL : P.hipR, side === 0 ? P.kneeL : P.kneeR, this.kneeAxes, this.fx, this.fy, this.fz);
      this.storeHingeStart(2 + side, side === 0 ? P.shoulderL : P.shoulderR, side === 0 ? P.elbowL : P.elbowR, this.elbowAxes, this.gx, this.gy, this.gz);
      const thigh = this.dir(side === 0 ? P.hipL : P.hipR, side === 0 ? P.kneeL : P.kneeR, this.a);
      const shin = this.dir(side === 0 ? P.kneeL : P.kneeR, side === 0 ? P.ankleL : P.ankleR, this.b);
      this.kneeStart[side] = Math.acos(Math.min(1, Math.max(-1, thigh.dot(shin))));
      const kneeAxis = this.c.set(this.kneeAxes[side * 3]!, this.kneeAxes[side * 3 + 1]!, this.kneeAxes[side * 3 + 2]!);
      this.footSign[side] = this.footNormal(side, this.d).dot(kneeAxis) >= 0 ? 1 : -1;
    }
    // The ropes sit where they are, unless the fighter starts against them and has already pushed them out.
    for (let side = 0; side < 4; side += 1) {
      const axis = side < 2 ? 0 : 2;
      const sign = side % 2 === 0 ? 1 : -1;
      let extent = 0;
      for (const i of TORSO_PARTS) extent = Math.max(extent, sign * positions[i * 3 + axis]! + RADIUS[i]!);
      this.ropeLines[side] = Math.max(ROPE_LINE, extent + 0.04);
    }
  }

  private startHinge(axes: Float64Array, side: 0 | 1, root: number, joint: number, end: number, sideways: THREE.Vector3, sign: number): void {
    const upper = this.dir(root, joint, this.a);
    const lower = this.dir(joint, end, this.b);
    const axis = this.c.crossVectors(upper, lower);
    if (axis.length() < 0.2) axis.copy(sideways).multiplyScalar(sign);
    axis.addScaledVector(upper, -axis.dot(upper));
    if (axis.lengthSq() < 1e-8) axis.copy(sideways).multiplyScalar(sign).addScaledVector(upper, -sign * sideways.dot(upper));
    axis.normalize();
    axes[side * 3] = axis.x;
    axes[side * 3 + 1] = axis.y;
    axes[side * 3 + 2] = axis.z;
  }

  private storeHingeStart(slot: number, root: number, joint: number, axes: Float64Array, x: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3): void {
    const side = slot % 2;
    const direction = this.dir(root, joint, this.a);
    const axis = this.b.set(axes[side * 3]!, axes[side * 3 + 1]!, axes[side * 3 + 2]!);
    const o = slot * 6;
    this.hingeStart[o] = direction.dot(x);
    this.hingeStart[o + 1] = direction.dot(y);
    this.hingeStart[o + 2] = direction.dot(z);
    this.hingeStart[o + 3] = axis.dot(x);
    this.hingeStart[o + 4] = axis.dot(y);
    this.hingeStart[o + 5] = axis.dot(z);
    for (let k = 0; k < 6; k += 1) this.hingeNow[o + k] = this.hingeStart[o + k]!;
  }

  /**
   * The hinge axis now: the start axis turned by the parent segment's swing since the start, both
   * measured in the body frame (x, y, z), back in world space.
   */
  private hingeAxis(slot: number, parent: THREE.Vector3, x: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const o = slot * 6;
    const state = this.hingeNow;
    this.local.set(parent.dot(x), parent.dot(y), parent.dot(z)).normalize();
    this.localAxis.set(state[o]!, state[o + 1]!, state[o + 2]!);
    this.swing.setFromUnitVectors(this.localAxis, this.local);
    this.localAxis.set(state[o + 3]!, state[o + 4]!, state[o + 5]!).applyQuaternion(this.swing);
    out.copy(x).multiplyScalar(this.localAxis.x).addScaledVector(y, this.localAxis.y).addScaledVector(z, this.localAxis.z);
    return out.addScaledVector(parent, -out.dot(parent)).normalize();
  }

  /** Moves each hinge's reference on to where its parent segment is now (once per step, so each swing is small). */
  private carryHinges(): void {
    this.pelvisFrame(this.position);
    this.upperFrame(this.position);
    for (let slot = 0; slot < 4; slot += 1) {
      const side = slot % 2;
      const knee = slot < 2;
      const root = knee ? (side === 0 ? P.hipL : P.hipR) : (side === 0 ? P.shoulderL : P.shoulderR);
      const joint = knee ? (side === 0 ? P.kneeL : P.kneeR) : (side === 0 ? P.elbowL : P.elbowR);
      const x = knee ? this.fx : this.gx;
      const y = knee ? this.fy : this.gy;
      const z = knee ? this.fz : this.gz;
      const parent = this.dir(root, joint, this.a);
      const axis = this.hingeAxis(slot, parent, x, y, z, this.b);
      const o = slot * 6;
      this.hingeNow[o] = parent.dot(x);
      this.hingeNow[o + 1] = parent.dot(y);
      this.hingeNow[o + 2] = parent.dot(z);
      this.hingeNow[o + 3] = axis.dot(x);
      this.hingeNow[o + 4] = axis.dot(y);
      this.hingeNow[o + 5] = axis.dot(z);
    }
  }

  /** Whether the body still holds itself after the blow. */
  private get holding(): boolean {
    return this.steps * STEP_SECONDS < STIFFNESS[this.style].seconds;
  }

  get fallStyle(): FallStyle {
    return this.style;
  }

  /** The other fighter as a standing capsule the fall cannot pass through. */
  setObstacle(x: number, z: number, active: boolean): void {
    this.obstacleX = x;
    this.obstacleZ = z;
    this.obstacleActive = active;
  }

  /** Takes a blow now: a velocity change on the struck part. Returns it stamped with the step it landed before. */
  impulse(record: ImpulseRecord): ImpulseRecord {
    this.applyImpulse(record);
    this.asleep = false;
    this.stillSeconds = 0;
    return { ...record, step: this.steps };
  }

  private applyImpulse(record: ImpulseRecord): void {
    if (record.style !== undefined) this.style = record.style;
    const shares = record.target === "head" ? HEAD_SHARES : BODY_SHARES;
    for (let k = 0; k < shares.length; k += 2) {
      const i = shares[k]!;
      // The face takes more of a head blow than the skull, which turns the head along the punch.
      const share = shares[k + 1]! + (i === P.face ? record.twist : 0);
      this.kick(i, record.x * share, record.y * share, record.z * share);
    }
    // The rest of the body is carried along, the upper body more than the legs.
    for (let i = 0; i < PARTICLES; i += 1) {
      const share = DRIVE_SHARE[i]!;
      this.kick(i, record.driveX * share, record.driveY * share, record.driveZ * share);
    }
  }

  private kick(i: number, x: number, y: number, z: number): void {
    this.previous[i * 3] = this.previous[i * 3]! - x * STEP_SECONDS;
    this.previous[i * 3 + 1] = this.previous[i * 3 + 1]! - y * STEP_SECONDS;
    this.previous[i * 3 + 2] = this.previous[i * 3 + 2]! - z * STEP_SECONDS;
  }

  /** Detaches a lost part's weight (a severed head or hand) so the rest of the body falls without it. */
  setLimp(indices: readonly number[], weightless: boolean): void {
    for (let k = 0; k < indices.length; k += 1) {
      const i = indices[k]!;
      this.invMass[i] = weightless ? 1 / 0.05 : 1 / MASS[i]!;
    }
  }

  step(replay?: readonly ImpulseRecord[]): void {
    if (this.asleep) return;
    if (replay !== undefined) {
      for (let k = 0; k < replay.length; k += 1) {
        const record = replay[k]!;
        if (record.step !== this.steps) continue;
        this.applyImpulse(record);
        this.stillSeconds = 0;
      }
    }
    const track = this.obstacleTrack;
    if (track !== null && this.obstacleTrackLive) {
      if (this.steps < TRACKED_STEPS) {
        track.data[this.steps * 3] = this.obstacleActive ? 1 : 0;
        track.data[this.steps * 3 + 1] = this.obstacleX;
        track.data[this.steps * 3 + 2] = this.obstacleZ;
        track.steps = this.steps + 1;
      }
    } else if (track !== null && track.steps > 0) {
      const k = Math.min(this.steps, track.steps - 1) * 3;
      this.obstacleActive = track.data[k] === 1;
      this.obstacleX = track.data[k + 1]!;
      this.obstacleZ = track.data[k + 2]!;
    }
    const h = STEP_SECONDS;
    const position = this.position;
    const previous = this.previous;
    const damping = this.landedSeconds < 0 ? AIR_DAMPING : AIR_DAMPING + (SETTLE_DAMPING - AIR_DAMPING) * Math.min(1, this.landedSeconds / SETTLE_RAMP_SECONDS);
    this.before.set(position);
    for (let i = 0; i < PARTICLES; i += 1) {
      for (let k = 0; k < 3; k += 1) {
        const index = i * 3 + k;
        const current = position[index]!;
        const velocity = (current - previous[index]!) * damping;
        previous[index] = current;
        position[index] = current + velocity - (k === 1 ? GRAVITY * h * h : 0);
      }
    }
    this.carryHinges();
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      this.solveRigid();
      this.solveRanges();
      this.solveKnees();
      this.solveTwist();
      this.solveElbows();
      this.solveNeck();
      this.solveFeet();
      this.solveArmsAgainstTorso();
      this.solveEnvironment();
    }
    if (this.landedSeconds >= 0) this.toppleLegs();
    this.applyFriction();
    this.limitSpeed();
    this.steps += 1;
    let fastest = 0;
    let torsoFastest = 0;
    for (let i = 0; i < PARTICLES; i += 1) {
      const dx = position[i * 3]! - previous[i * 3]!;
      const dy = position[i * 3 + 1]! - previous[i * 3 + 1]!;
      const dz = position[i * 3 + 2]! - previous[i * 3 + 2]!;
      const speed = Math.sqrt(dx * dx + dy * dy + dz * dz) / h;
      fastest = Math.max(fastest, speed);
      if (TORSO_SET.has(i)) torsoFastest = Math.max(torsoFastest, speed);
    }
    this.stillSeconds = fastest < SLEEP_SPEED ? this.stillSeconds + h : 0;
    this.fallSeconds += h;
    if (this.landedSeconds >= 0) this.landedSeconds += h;
    else {
      this.torsoStillSeconds = torsoFastest < LANDED_SPEED ? this.torsoStillSeconds + h : 0;
      if (this.torsoStillSeconds >= LANDED_SECONDS || this.fallSeconds >= LANDED_BY_SECONDS) this.landedSeconds = 0;
    }
    if (this.stillSeconds >= SLEEP_SECONDS || this.landedSeconds >= SETTLE_SECONDS) this.asleep = true;
  }

  private solveRigid(): void {
    for (let index = 0; index < this.rigidLength.length; index += 1) {
      this.satisfy(RIGID_PAIRS[index * 2]!, RIGID_PAIRS[index * 2 + 1]!, this.rigidLength[index]!, this.rigidLength[index]!);
    }
  }

  private solveRanges(): void {
    const hold = this.holding ? STIFFNESS[this.style].spine : 1;
    for (let index = 0; index < this.rangeMin.length; index += 1) {
      let low = this.rangeMin[index]!;
      let high = this.rangeMax[index]!;
      if (hold < 1 && index < SPINE_RANGES) {
        const start = this.rangeStart[index]!;
        low = start - (start - low) * hold;
        high = start + (high - start) * hold;
      }
      this.satisfy(RANGE_PAIRS[index * 2]!, RANGE_PAIRS[index * 2 + 1]!, low, high);
    }
    for (let index = 0; index < MINIMUM_DISTANCES.length; index += 1) {
      this.satisfy(MINIMUM_PAIRS[index * 2]!, MINIMUM_PAIRS[index * 2 + 1]!, MINIMUM_DISTANCES[index]!, Infinity);
    }
    for (let index = 0; index < ANGLE_PAIRS.length / 2; index += 1) {
      this.satisfy(ANGLE_PAIRS[index * 2]!, ANGLE_PAIRS[index * 2 + 1]!, this.angleRanges[index * 2]!, this.angleRanges[index * 2 + 1]!);
    }
  }

  /** Moves two particles, by their masses, until their distance is within [low, high]. */
  private satisfy(i: number, j: number, low: number, high: number): void {
    const p = this.position;
    const dx = p[j * 3]! - p[i * 3]!;
    const dy = p[j * 3 + 1]! - p[i * 3 + 1]!;
    const dz = p[j * 3 + 2]! - p[i * 3 + 2]!;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (length < 1e-9) return;
    const wanted = length < low ? low : length > high ? high : length;
    if (wanted === length) return;
    const wi = this.invMass[i]!;
    const wj = this.invMass[j]!;
    const total = wi + wj;
    if (total <= 0) return;
    const scale = (length - wanted) / (length * total);
    p[i * 3] = p[i * 3]! + dx * scale * wi;
    p[i * 3 + 1] = p[i * 3 + 1]! + dy * scale * wi;
    p[i * 3 + 2] = p[i * 3 + 2]! + dz * scale * wi;
    p[j * 3] = p[j * 3]! - dx * scale * wj;
    p[j * 3 + 1] = p[j * 3 + 1]! - dy * scale * wj;
    p[j * 3 + 2] = p[j * 3 + 2]! - dz * scale * wj;
  }

  /** Knees bend backward only, about an axis that swings with the thigh. */
  private solveKnees(): void {
    this.pelvisFrame(this.position);
    for (let side = 0; side < 2; side += 1) {
      const hip = side === 0 ? P.hipL : P.hipR;
      const knee = side === 0 ? P.kneeL : P.kneeR;
      const thigh = this.dir(hip, knee, this.a);
      const axis = this.hingeAxis(side, thigh, this.fx, this.fy, this.fz, this.b);
      const high = this.holding ? Math.min(KNEE_MAX_FLEX, this.kneeStart[side]! + STIFFNESS[this.style].knee) : KNEE_MAX_FLEX;
      this.hinge(knee, side === 0 ? P.ankleL : P.ankleR, thigh, axis, -HYPEREXTENSION, high);
    }
  }

  /** Elbows bend one way only, about an axis that swings with the upper arm. */
  private solveElbows(): void {
    this.upperFrame(this.position);
    for (let side = 0; side < 2; side += 1) {
      const shoulder = side === 0 ? P.shoulderL : P.shoulderR;
      const elbow = side === 0 ? P.elbowL : P.elbowR;
      const upper = this.dir(shoulder, elbow, this.a);
      const axis = this.hingeAxis(2 + side, upper, this.gx, this.gy, this.gz, this.b);
      this.hinge(elbow, side === 0 ? P.wristL : P.wristR, upper, axis, -HYPEREXTENSION, ELBOW_MAX_FLEX);
    }
  }

  /**
   * Nothing holds up a limp leg: a thigh or a shin left pointing up once the body is down goes over the
   * way it leans, where the heavy damping of a body at rest would otherwise keep a foot in the air.
   */
  private toppleLegs(): void {
    const p = this.position;
    for (let side = 0; side < 2; side += 1) {
      const hip = side === 0 ? P.hipL : P.hipR;
      const knee = side === 0 ? P.kneeL : P.kneeR;
      const ankle = side === 0 ? P.ankleL : P.ankleR;
      const thigh = this.dir(hip, knee, this.a);
      if (thigh.y > TOPPLE_FROM) {
        const across = this.dir(P.hipR, P.hipL, this.b);
        // Which way about the hips' axis takes the knee down.
        const down = this.c.crossVectors(across, this.d.set(p[knee * 3]! - p[hip * 3]!, p[knee * 3 + 1]! - p[hip * 3 + 1]!, p[knee * 3 + 2]! - p[hip * 3 + 2]!)).y > 0 ? -1 : 1;
        this.rotateAbout(THIGH_PARTS[side]!, hip, across, down * TOPPLE_RATE * (thigh.y - TOPPLE_FROM));
      }
      const shin = this.dir(knee, ankle, this.a);
      if (shin.y > TOPPLE_FROM) {
        const axis = this.kneeAxis(side === 0 ? 0 : 1, p, this.b);
        const down = this.c.crossVectors(axis, this.d.set(p[ankle * 3]! - p[knee * 3]!, p[ankle * 3 + 1]! - p[knee * 3 + 1]!, p[ankle * 3 + 2]! - p[knee * 3 + 2]!)).y > 0 ? -1 : 1;
        this.rotateAbout(SHIN_PARTS[side]!, knee, axis, down * TOPPLE_RATE * (shin.y - TOPPLE_FROM));
      }
    }
  }

  /** The shoulders turn on the hips only as far as a spine does, however the body landed. */
  private solveTwist(): void {
    const spine = this.dir(P.pelvis, P.upper, this.e);
    const hips = this.dir(P.hipR, P.hipL, this.a);
    hips.addScaledVector(spine, -hips.dot(spine));
    const shoulders = this.dir(P.shoulderR, P.shoulderL, this.c);
    shoulders.addScaledVector(spine, -shoulders.dot(spine));
    if (hips.lengthSq() < 1e-8 || shoulders.lengthSq() < 1e-8) return;
    const twist = Math.atan2(this.d.crossVectors(hips, shoulders).dot(spine), hips.dot(shoulders));
    const excess = Math.abs(twist) - SPINE_TWIST;
    if (excess <= 0) return;
    // The shoulders and the hips (the legs with them) share the turn back by how hard each is to turn about the
    // spine: legs folded out to the side are, so they no longer whip the feet round with half the correction.
    const upper = this.spinInertia(UPPER_BODY, spine);
    const lower = this.spinInertia(LOWER_BODY, spine);
    const turn = Math.sign(twist) * excess * CONE_STIFFNESS;
    this.rotateAbout(UPPER_BODY, P.chest, spine, -turn * (lower / (upper + lower)));
    this.rotateAbout(LOWER_BODY, P.chest, spine, turn * (upper / (upper + lower)));
  }

  /** The particles' mass times the square of their distance from the line through the chest along `axis`. */
  private spinInertia(parts: readonly number[], axis: THREE.Vector3): number {
    const p = this.position;
    let inertia = 1e-6;
    for (let k = 0; k < parts.length; k += 1) {
      const i = parts[k]!;
      const dx = p[i * 3]! - p[P.chest * 3]!;
      const dy = p[i * 3 + 1]! - p[P.chest * 3 + 1]!;
      const dz = p[i * 3 + 2]! - p[P.chest * 3 + 2]!;
      const along = dx * axis.x + dy * axis.y + dz * axis.z;
      inertia += (dx * dx + dy * dy + dz * dz - along * along) / this.invMass[i]!;
    }
    return inertia;
  }

  /** The neck and the skull lean from the line of the spine only so far, whatever the blow. */
  private solveNeck(): void {
    this.upperFrame(this.position);
    this.cone(this.gy, P.neck, P.head, NECK_CONE, P.neck, HEAD_PARTS, NECK_BASE);
    const neck = this.dir(P.neck, P.head, this.e);
    this.cone(neck, P.head, P.crown, SKULL_CONE, P.head, SKULL_PARTS, SKULL_BASE);
  }

  /**
   * A foot rolls onto its edge only as far as an ankle lets it, and turns in or out on the shin only a little from
   * the plane its knee bends in, on the canvas as well as off it. Each pass turns a foot at most FOOT_TURN, so a
   * foot held at its range is never flicked back to it in one step.
   */
  private solveFeet(): void {
    this.pelvisFrame(this.position);
    const p = this.position;
    for (let side = 0; side < 2; side += 1) {
      const toe = side === 0 ? P.toeL : P.toeR;
      const heel = side === 0 ? P.heelL : P.heelR;
      const hip = side === 0 ? P.hipL : P.hipR;
      const knee = side === 0 ? P.kneeL : P.kneeR;
      const ankle = side === 0 ? P.ankleL : P.ankleR;
      const grounded = p[toe * 3 + 1]! <= RADIUS[toe]! + 0.01 || p[heel * 3 + 1]! <= RADIUS[heel]! + 0.01;
      const stiffness = grounded ? CONE_STIFFNESS * FOOT_GROUNDED : CONE_STIFFNESS;
      const shin = this.dir(knee, ankle, this.c);
      // Onto its edge: the foot's side axis (to the fighter's left on both feet) leans along the shin as the foot rolls,
      // the left foot's onto its outer edge, the right foot's the other way. The heel swings round the ankle-toe line.
      const foot = this.footNormal(side === 0 ? 0 : 1, this.d).multiplyScalar(this.footSign[side]!);
      const lean = foot.dot(shin);
      const outward = Math.sin(FOOT_INVERSION);
      const inward = Math.sin(FOOT_EVERSION);
      const leanTo = side === 0 ? Math.min(outward, Math.max(-inward, lean)) : Math.min(inward, Math.max(-outward, lean));
      if (leanTo !== lean) {
        // Turned by `a` about the ankle-toe line, the side axis's lean is lean cos a + ((line x side) . shin) sin a.
        const line = this.dir(ankle, toe, this.a);
        const swing = this.e.crossVectors(line, foot).dot(shin);
        const reach = Math.hypot(lean, swing);
        if (reach > Math.abs(leanTo) + 1e-6) {
          const phase = Math.atan2(swing, lean);
          const spread = Math.acos(leanTo / reach);
          const first = wrapAngle(phase - spread);
          const second = wrapAngle(phase + spread);
          const turn = (Math.abs(first) <= Math.abs(second) ? first : second) * stiffness;
          this.rotateAbout(HEEL_PARTS[side]!, ankle, line, Math.min(FOOT_ROLL_TURN, Math.max(-FOOT_ROLL_TURN, turn)));
        }
      }
      // In or out on the shin: the knee's hinge and the foot's side axis, both seen across the shin. A side axis
      // nearly along the shin has no direction across it, so the foot is left as it is rather than spun.
      const thigh = this.dir(hip, knee, this.a);
      const hinge = this.hingeAxis(side, thigh, this.fx, this.fy, this.fz, this.b);
      const across = this.footNormal(side === 0 ? 0 : 1, this.d).multiplyScalar(this.footSign[side]!);
      hinge.addScaledVector(shin, -hinge.dot(shin));
      across.addScaledVector(shin, -across.dot(shin));
      if (hinge.lengthSq() < 0.09 || across.lengthSq() < 0.09) continue;
      hinge.normalize();
      across.normalize();
      const roll = Math.atan2(this.e.crossVectors(hinge, across).dot(shin), hinge.dot(across));
      const bounded = Math.min(FOOT_ROLL, Math.max(-FOOT_ROLL, roll));
      if (bounded !== roll) this.rotateAbout(FOOT_PARTS[side]!, ankle, shin, Math.min(FOOT_TURN, Math.max(-FOOT_TURN, (bounded - roll) * stiffness)));
    }
  }

  /** The side-to-side axis of a foot, from its heel, toe and ankle. */
  private footNormal(side: 0 | 1, out: THREE.Vector3): THREE.Vector3 {
    const p = this.position;
    const ankle = side === 0 ? P.ankleL : P.ankleR;
    const toe = side === 0 ? P.toeL : P.toeR;
    const heel = side === 0 ? P.heelL : P.heelR;
    out.set(p[toe * 3]! - p[heel * 3]!, p[toe * 3 + 1]! - p[heel * 3 + 1]!, p[toe * 3 + 2]! - p[heel * 3 + 2]!);
    this.turnPoint.set(p[ankle * 3]! - p[heel * 3]!, p[ankle * 3 + 1]! - p[heel * 3 + 1]!, p[ankle * 3 + 2]! - p[heel * 3 + 2]!);
    return out.cross(this.turnPoint).normalize();
  }

  /**
   * Keeps the direction from `from` to `to` within `limit` of `axis`: the `moved` particles turn about `pivot` back
   * toward it and the `base` particles the other way, a share of the excess each pass split by their masses. A side
   * lying on the canvas that the turn would press into it does not turn, and the other side takes the whole turn: a
   * skull on the canvas turned into it was lifted straight back out and skidded across it instead. No pass turns
   * more than NECK_TURN.
   */
  private cone(axis: THREE.Vector3, from: number, to: number, limit: number, pivot: number, moved: readonly number[], base: readonly number[]): void {
    const direction = this.dir(from, to, this.turnPoint);
    const angle = Math.acos(Math.min(1, Math.max(-1, direction.dot(axis))));
    if (angle <= limit) return;
    const turn = this.turnAxis.crossVectors(direction, axis);
    if (turn.lengthSq() < 1e-10) return;
    turn.normalize();
    const movedWeight = this.pressed(moved, pivot, turn, 1) ? 0 : this.invMass[moved[0]!]!;
    const baseWeight = this.pressed(base, pivot, turn, -1) ? 0 : this.invMass[base[0]!]!;
    if (movedWeight + baseWeight <= 0) return;
    const amount = Math.min(NECK_TURN, (angle - limit) * CONE_STIFFNESS) / (movedWeight + baseWeight);
    if (movedWeight > 0) this.rotateAbout(moved, pivot, turn, amount * movedWeight);
    if (baseWeight > 0) this.rotateAbout(base, pivot, turn, -amount * baseWeight);
  }

  /** Whether turning `parts` about `pivot` on `axis` (by `sign`) would press one lying on the canvas into it. */
  private pressed(parts: readonly number[], pivot: number, axis: THREE.Vector3, sign: number): boolean {
    const p = this.position;
    for (let k = 0; k < parts.length; k += 1) {
      const i = parts[k]!;
      if (p[i * 3 + 1]! > RADIUS[i]! + 0.005) continue;
      // The part's way at the start of the turn is axis x (part - pivot); only its height matters.
      const down = sign * (axis.z * (p[i * 3]! - p[pivot * 3]!) - axis.x * (p[i * 3 + 2]! - p[pivot * 3 + 2]!));
      if (down < -1e-9) return true;
    }
    return false;
  }

  /** Turns particles rigidly by `angle` about `axis` through the particle `pivot`. */
  private rotateAbout(moved: readonly number[], pivot: number, axis: THREE.Vector3, angle: number): void {
    const p = this.position;
    this.turnQuaternion.setFromAxisAngle(axis, angle);
    const px = p[pivot * 3]!;
    const py = p[pivot * 3 + 1]!;
    const pz = p[pivot * 3 + 2]!;
    for (let k = 0; k < moved.length; k += 1) {
      const i = moved[k]!;
      this.turnPoint.set(p[i * 3]! - px, p[i * 3 + 1]! - py, p[i * 3 + 2]! - pz).applyQuaternion(this.turnQuaternion);
      p[i * 3] = px + this.turnPoint.x;
      p[i * 3 + 1] = py + this.turnPoint.y;
      p[i * 3 + 2] = pz + this.turnPoint.z;
    }
  }

  /** The current elbow hinge axis (0 left, 1 right) in world space, for mapping the arm's twist. */
  elbowAxis(side: 0 | 1, positions: Float64Array, out: THREE.Vector3): THREE.Vector3 {
    this.upperFrame(positions);
    const shoulder = side === 0 ? P.shoulderL : P.shoulderR;
    const elbow = side === 0 ? P.elbowL : P.elbowR;
    const upper = this.e.set(positions[elbow * 3]! - positions[shoulder * 3]!, positions[elbow * 3 + 1]! - positions[shoulder * 3 + 1]!, positions[elbow * 3 + 2]! - positions[shoulder * 3 + 2]!).normalize();
    return this.hingeAxis(2 + side, upper, this.gx, this.gy, this.gz, out);
  }

  /** The current knee hinge axis in world space, for mapping the leg's twist. */
  kneeAxis(side: 0 | 1, positions: Float64Array, out: THREE.Vector3): THREE.Vector3 {
    this.pelvisFrame(positions);
    const hip = side === 0 ? P.hipL : P.hipR;
    const knee = side === 0 ? P.kneeL : P.kneeR;
    const thigh = this.e.set(positions[knee * 3]! - positions[hip * 3]!, positions[knee * 3 + 1]! - positions[hip * 3 + 1]!, positions[knee * 3 + 2]! - positions[hip * 3 + 2]!).normalize();
    return this.hingeAxis(side, thigh, this.fx, this.fy, this.fz, out);
  }

  /**
   * Keeps the bend of `child` about `axis` at `joint` (measured from the parent direction `parent`
   * in the hinge plane) between `low` and `high` radians. Only the in-plane angle is corrected, by
   * half per pass, so a limb twisted out of the plane is never yanked back into it.
   */
  private hinge(joint: number, child: number, parent: THREE.Vector3, axis: THREE.Vector3, low: number, high: number): void {
    const p = this.position;
    const segment = this.e.set(p[child * 3]! - p[joint * 3]!, p[child * 3 + 1]! - p[joint * 3 + 1]!, p[child * 3 + 2]! - p[joint * 3 + 2]!);
    const length = segment.length();
    if (length < 1e-9) return;
    segment.divideScalar(length);
    const out = segment.dot(axis);
    segment.addScaledVector(axis, -out);
    const inPlane = segment.length();
    if (inPlane < 0.2) return;
    segment.divideScalar(inPlane);
    const flex = Math.atan2(this.pivot.crossVectors(parent, segment).dot(axis), parent.dot(segment));
    const bounded = Math.min(high, Math.max(low, flex));
    if (bounded === flex) return;
    const side = this.pivot.crossVectors(axis, parent);
    segment.copy(parent).multiplyScalar(Math.cos(bounded)).addScaledVector(side, Math.sin(bounded)).multiplyScalar(inPlane).addScaledVector(axis, out);
    const tx = p[joint * 3]! + segment.x * length;
    const ty = p[joint * 3 + 1]! + segment.y * length;
    const tz = p[joint * 3 + 2]! + segment.z * length;
    const wj = this.invMass[joint]!;
    const wc = this.invMass[child]!;
    const share = wc / (wj + wc);
    const dx = (tx - p[child * 3]!) * HINGE_STIFFNESS;
    const dy = (ty - p[child * 3 + 1]!) * HINGE_STIFFNESS;
    const dz = (tz - p[child * 3 + 2]!) * HINGE_STIFFNESS;
    p[child * 3] = p[child * 3]! + dx * share;
    p[child * 3 + 1] = p[child * 3 + 1]! + dy * share;
    p[child * 3 + 2] = p[child * 3 + 2]! + dz * share;
    p[joint * 3] = p[joint * 3]! - dx * (1 - share);
    p[joint * 3 + 1] = p[joint * 3 + 1]! - dy * (1 - share);
    p[joint * 3 + 2] = p[joint * 3 + 2]! - dz * (1 - share);
  }

  /** Arms stay outside the torso. */
  private solveArmsAgainstTorso(): void {
    const p = this.position;
    for (let part = 0; part < ARM_PARTS.length; part += 1) {
      const i = ARM_PARTS[part]!;
      for (let capsule = 0; capsule < CAPSULE_RADII.length; capsule += 1) {
        const radius = CAPSULE_RADII[capsule]!;
        const a = v(p, CAPSULES[capsule * 2]!, this.a);
        const b = v(p, CAPSULES[capsule * 2 + 1]!, this.b);
        const point = v(p, i, this.c);
        const closest = this.closestOnSegment(a, b, point, this.d);
        const offset = this.e.subVectors(point, closest);
        const distance = offset.length();
        const wanted = radius + RADIUS[i]!;
        if (distance >= wanted || distance < 1e-6) continue;
        point.addScaledVector(offset, (wanted - distance) / distance);
        setV(p, i, point);
      }
    }
  }

  private closestOnSegment(a: THREE.Vector3, b: THREE.Vector3, point: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const ab = this.segmentA.subVectors(b, a);
    const lengthSq = ab.lengthSq();
    const t = lengthSq < 1e-12 ? 0 : Math.min(1, Math.max(0, this.segmentB.subVectors(point, a).dot(ab) / lengthSq));
    return out.copy(a).addScaledVector(ab, t);
  }

  /** Canvas, ropes, posts, the edge of the apron, and the other fighter. */
  private solveEnvironment(): void {
    const p = this.position;
    for (let i = 0; i < PARTICLES; i += 1) {
      const r = RADIUS[i]!;
      let x = p[i * 3]!;
      let y = p[i * 3 + 1]!;
      let z = p[i * 3 + 2]!;
      if (y < r) y = r;
      const torso = TORSO_SET.has(i);
      for (let side = 0; side < 4; side += 1) {
        const alongX = side < 2;
        const sign = side % 2 === 0 ? 1 : -1;
        const line = this.ropeLines[side]!;
        const out = sign * (alongX ? x : z);
        if (out < line - r - ROPE_RADIUS - 0.25) continue;
        for (let rope = 0; rope < ROPE_HEIGHTS.length; rope += 1) {
          const height = ROPE_HEIGHTS[rope]!;
          const dOut = out - line;
          const dUp = y - height;
          const distance = Math.sqrt(dOut * dOut + dUp * dUp);
          const wanted = r + ROPE_RADIUS;
          if (distance >= wanted || distance < 1e-9) continue;
          // A part already past the rope is pushed out the far side; otherwise back into the ring.
          const push = ((wanted - distance) / distance) * ROPE_SOFTNESS;
          const pushOut = dOut * push;
          const pushUp = dUp * push;
          if (alongX) x += sign * pushOut;
          else z += sign * pushOut;
          y += pushUp;
        }
        const limit = torso ? line - r * 0.6 : APRON_LIMIT;
        const now = sign * (alongX ? x : z);
        if (now > limit) {
          if (alongX) x = sign * limit;
          else z = sign * limit;
        }
      }
      for (let corner = 0; corner < 4; corner += 1) {
        const cornerX = corner < 2 ? -ROPE_LINE : ROPE_LINE;
        const cornerZ = corner % 2 === 0 ? -ROPE_LINE : ROPE_LINE;
        const dx = x - cornerX;
        const dz = z - cornerZ;
        const distance = Math.sqrt(dx * dx + dz * dz);
        const wanted = POST_RADIUS_WITH_PAD + r;
        if (distance >= wanted || distance < 1e-9 || y > 1.45) continue;
        x = cornerX + (dx / distance) * wanted;
        z = cornerZ + (dz / distance) * wanted;
      }
      if (this.obstacleActive && y < OBSTACLE_HEIGHT + r) {
        const dx = x - this.obstacleX;
        const dz = z - this.obstacleZ;
        const distance = Math.sqrt(dx * dx + dz * dz);
        const wanted = OBSTACLE_RADIUS + r;
        if (distance < wanted && distance > 1e-9) {
          x = this.obstacleX + (dx / distance) * wanted;
          z = this.obstacleZ + (dz / distance) * wanted;
        }
      }
      p[i * 3] = x;
      p[i * 3 + 1] = y;
      p[i * 3 + 2] = z;
    }
  }

  /**
   * A safety net: no part moves faster than a falling body can, whatever the constraints did this
   * step. Parts barely moving lose a little more speed, so a body at rest does not creep across the canvas.
   */
  private limitSpeed(): void {
    const p = this.position;
    const q = this.previous;
    const limit = MAX_SPEED * STEP_SECONDS;
    const creep = CREEP_SPEED * STEP_SECONDS;
    for (let i = 0; i < PARTICLES; i += 1) {
      const dx = p[i * 3]! - q[i * 3]!;
      const dy = p[i * 3 + 1]! - q[i * 3 + 1]!;
      const dz = p[i * 3 + 2]! - q[i * 3 + 2]!;
      const travel = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (travel > limit || travel < creep) {
        const keep = travel > limit ? limit / travel : CREEP_DAMPING;
        q[i * 3] = p[i * 3]! - dx * keep;
        q[i * 3 + 1] = p[i * 3 + 1]! - dy * keep;
        q[i * 3 + 2] = p[i * 3 + 2]! - dz * keep;
      }
    }
  }

  /** Parts on the canvas lose most of their sliding speed each step. */
  private applyFriction(): void {
    const p = this.position;
    const q = this.previous;
    for (let i = 0; i < PARTICLES; i += 1) {
      if (p[i * 3 + 1]! > RADIUS[i]! + 0.004) continue;
      q[i * 3] = q[i * 3]! + (p[i * 3]! - q[i * 3]!) * GROUND_FRICTION;
      q[i * 3 + 2] = q[i * 3 + 2]! + (p[i * 3 + 2]! - q[i * 3 + 2]!) * GROUND_FRICTION;
      if (q[i * 3 + 1]! > p[i * 3 + 1]!) q[i * 3 + 1] = p[i * 3 + 1]!;
    }
  }

  /** Runs until the body is at rest, or for at most `seconds`; used to show where a replayed fall ends. */
  settle(seconds = 4, replay?: readonly ImpulseRecord[]): void {
    const limit = this.steps + Math.ceil(seconds / STEP_SECONDS);
    while (!this.asleep && this.steps < limit) this.step(replay);
  }

  /** Copies where the body is now into `out`, as it comes to rest. */
  keepRest(out: FallRest): void {
    out.position.set(this.position);
    out.previous.set(this.previous);
    out.steps = this.steps;
  }

  /** Puts the body where a fall came to rest, asleep. */
  restore(rest: FallRest): void {
    this.position.set(rest.position);
    this.previous.set(rest.previous);
    this.before.set(rest.position);
    this.steps = rest.steps;
    this.asleep = true;
  }

  /** Writes positions drawn `alpha` of the way from the previous step to the latest. */
  interpolate(alpha: number, out: Float64Array): void {
    const before = this.before;
    const now = this.position;
    for (let i = 0; i < PARTICLES * 3; i += 1) out[i] = before[i]! + (now[i]! - before[i]!) * alpha;
  }

  private distance(positions: Float64Array, i: number, j: number): number {
    const dx = positions[j * 3]! - positions[i * 3]!;
    const dy = positions[j * 3 + 1]! - positions[i * 3 + 1]!;
    const dz = positions[j * 3 + 2]! - positions[i * 3 + 2]!;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  private dir(from: number, to: number, out: THREE.Vector3): THREE.Vector3 {
    const p = this.position;
    out.set(p[to * 3]! - p[from * 3]!, p[to * 3 + 1]! - p[from * 3 + 1]!, p[to * 3 + 2]! - p[from * 3 + 2]!);
    const length = out.length();
    return length > 1e-9 ? out.divideScalar(length) : out.set(0, 1, 0);
  }

  /** Pelvis axes into fx (the fighter's left), fy (up the spine) and fz (forward). */
  pelvisFrame(positions: Float64Array): void {
    this.fx.set(positions[P.hipL * 3]! - positions[P.hipR * 3]!, positions[P.hipL * 3 + 1]! - positions[P.hipR * 3 + 1]!, positions[P.hipL * 3 + 2]! - positions[P.hipR * 3 + 2]!).normalize();
    this.fz.set(
      positions[P.belly * 3]! - (positions[P.hipL * 3]! + positions[P.hipR * 3]!) / 2,
      positions[P.belly * 3 + 1]! - (positions[P.hipL * 3 + 1]! + positions[P.hipR * 3 + 1]!) / 2,
      positions[P.belly * 3 + 2]! - (positions[P.hipL * 3 + 2]! + positions[P.hipR * 3 + 2]!) / 2,
    );
    this.fz.addScaledVector(this.fx, -this.fz.dot(this.fx)).normalize();
    this.fy.crossVectors(this.fz, this.fx).normalize();
  }

  /** Upper-torso axes into gx (left), gy (up the neck) and gz (forward). */
  upperFrame(positions: Float64Array): void {
    this.gx.set(positions[P.shoulderL * 3]! - positions[P.shoulderR * 3]!, positions[P.shoulderL * 3 + 1]! - positions[P.shoulderR * 3 + 1]!, positions[P.shoulderL * 3 + 2]! - positions[P.shoulderR * 3 + 2]!).normalize();
    this.gy.set(positions[P.neck * 3]! - positions[P.upper * 3]!, positions[P.neck * 3 + 1]! - positions[P.upper * 3 + 1]!, positions[P.neck * 3 + 2]! - positions[P.upper * 3 + 2]!);
    this.gy.addScaledVector(this.gx, -this.gy.dot(this.gx)).normalize();
    this.gz.crossVectors(this.gx, this.gy).normalize();
  }

  /** The pelvis's forward direction, for telling a face-down landing from one on the back. */
  pelvisForward(out: THREE.Vector3): THREE.Vector3 {
    this.pelvisFrame(this.position);
    return out.copy(this.fz);
  }
}

/** A severed head or hand carries no weight; `lost` has a bit each for the head and the left and right hands. */
function weigh(body: RagdollBody, lost: number): void {
  body.setLimp(LOST_HEAD, (lost & 1) !== 0);
  body.setLimp(LOST_LEFT_HAND, (lost & 2) !== 0);
  body.setLimp(LOST_RIGHT_HAND, (lost & 4) !== 0);
}

/** Bones the fall drives, parents first. Clavicles, toes and fingers keep their last pose. */
const DRIVEN: readonly CanonicalBone[] = [
  "hips", "spine", "chest", "upperChest", "neck", "head",
  "shoulderL", "elbowL", "gloveL", "shoulderR", "elbowR", "gloveR",
  "hipL", "kneeL", "ankleL", "hipR", "kneeR", "ankleR",
];
/** The particles each limb bone runs between, by its place in DRIVEN. */
const SEGMENTS: readonly (readonly [number, number] | null)[] = DRIVEN.map((name) => ({
  shoulderL: [P.shoulderL, P.elbowL], elbowL: [P.elbowL, P.wristL], gloveL: [P.wristL, P.fistL],
  shoulderR: [P.shoulderR, P.elbowR], elbowR: [P.elbowR, P.wristR], gloveR: [P.wristR, P.fistR],
  hipL: [P.hipL, P.kneeL], kneeL: [P.kneeL, P.ankleL], hipR: [P.hipR, P.kneeR], kneeR: [P.kneeR, P.ankleR],
} as Partial<Record<CanonicalBone, readonly [number, number]>>)[name] ?? null);
/** The particle each driven bone is put on, by its place in DRIVEN (-1: it is placed by its parent). */
const PINNED: readonly number[] = DRIVEN.map((name) => ({ chest: P.chest, shoulderL: P.shoulderL, shoulderR: P.shoulderR, hipL: P.hipL, hipR: P.hipR } as Partial<Record<CanonicalBone, number>>)[name] ?? -1);
const BLEND_IN_SECONDS = 0.1;
/** A blow presented this soon after the fall began still decides how the fighter goes down. */
const LATE_BLOW_SECONDS = 0.35;
/** A blow presented this soon before the fall is the one that caused it. */
const EARLY_BLOW_SECONDS = 0.6;
const MAX_STEPS_PER_UPDATE = 10;
/** Steps a frame the fall a replay cut short is run on ahead of it, so it has come to rest by the time the replay ends. */
const AHEAD_STEPS = 6;
/** How long a fall is run on at most, from where it is, to show where it ends. */
const RUN_ON_SECONDS = 6;

export interface Blow {
  readonly target: Target;
  readonly punchClass: PunchClass | null;
  readonly hand: Hand | null;
  /** +1 when the blow drives the head toward the fighter's own left. */
  readonly lateral: number;
  readonly amount: number;
}

export interface BlowImpulse {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly driveX: number;
  readonly driveY: number;
  readonly driveZ: number;
  readonly twist: number;
}

/**
 * Velocity changes for a blow, in the struck fighter's own frame (+x his left, +y up, +z toward the
 * puncher): the snap of the struck part, the carry of the whole body, and how much the head turns.
 * Straights and uppercuts drive him back onto his back; a hook spins him over his front foot; a body
 * shot folds him at the waist.
 */
export function blowImpulse(blow: Blow): BlowImpulse {
  const lateral = blow.lateral;
  if (blow.target === "body") {
    const m = Math.min(2.6, Math.max(1, 0.9 + blow.amount / 90));
    return { x: 0.3 * lateral * m, y: -0.05 * m, z: -m, driveX: 0.1 * lateral * m, driveY: -0.2 * m, driveZ: 0.45 * m, twist: 0 };
  }
  const m = Math.min(3.2, Math.max(1.4, 1.2 + blow.amount / 70));
  const carry = m / 3.2;
  switch (blow.punchClass) {
    case "hook": return { x: lateral * m, y: 0.05 * m, z: -0.25 * m, driveX: 0.55 * lateral * carry, driveY: -0.1 * carry, driveZ: 0.85 * carry, twist: 0.6 };
    case "uppercut": return { x: 0, y: 0.8 * m, z: -0.65 * m, driveX: 0, driveY: 0.25 * carry, driveZ: -1.1 * carry, twist: 0.4 };
    case "straight": return { x: 0.12 * lateral * m, y: 0.1 * m, z: -m, driveX: 0.1 * lateral * carry, driveY: 0, driveZ: -1.25 * carry, twist: 0.3 };
    default: return { x: 0.12 * lateral * m, y: 0.1 * m, z: -0.85 * m, driveX: 0.08 * lateral * carry, driveY: 0, driveZ: -1 * carry, twist: 0.2 };
  }
}

/**
 * Knockout physics on a fighter's rig: samples the animated skeleton while he stands, starts the
 * fall from that pose and its velocities, takes the blow, drives the bones while he is down, hands
 * him back to the authored get-up, and keeps each fall so the knockout replay can run it again.
 */
export class KnockoutRagdoll {
  readonly body = new RagdollBody();
  /** The same fall run on ahead of a replay that cut the live one short, to find where it comes to rest. */
  private readonly ahead = new RagdollBody();
  private aheadOf: FallRecord | null = null;
  private aheadBlows = 0;
  private ragdolling = false;
  private age = 0;
  private accumulator = 0;
  private readonly sampleNow = new Float64Array(PARTICLES * 3);
  private readonly sampleBefore = new Float64Array(PARTICLES * 3);
  private sampleSeconds = 0;
  private samples = 0;
  private readonly drawn = new Float64Array(PARTICLES * 3);
  private readonly velocities = new Float64Array(PARTICLES * 3);
  private readonly offsets = DRIVEN.map(() => new THREE.Quaternion());
  private readonly fromLocal = DRIVEN.map(() => new THREE.Quaternion());
  private readonly fromPositions = DRIVEN.map(() => new THREE.Vector3());
  private readonly fromHips = new THREE.Vector3();
  private readonly riseLocal = DRIVEN.map(() => new THREE.Quaternion());
  private readonly riseHips = new THREE.Vector3();
  /** Each driven bone's turn in the body's frame (under the root) as the fall left it, and as the get-up has it. */
  private readonly riseTurns = DRIVEN.map(() => new THREE.Quaternion());
  private readonly solvedTurns = DRIVEN.map(() => new THREE.Quaternion());
  private readonly rootTurn = new THREE.Quaternion();
  private readonly turn = new THREE.Quaternion();
  private riseCaptured = false;
  private lastFall: FallRecord | null = null;
  /** The buffers the latest fall is recorded in, taken over by the next one: a knockdown builds nothing. */
  private readonly recordPositions = new Float64Array(PARTICLES * 3);
  private readonly recordVelocities = new Float64Array(PARTICLES * 3);
  private readonly recordOffsets = DRIVEN.map(() => new THREE.Quaternion());
  private readonly recordImpulses: ImpulseRecord[] = [];
  private readonly recordObstacles: ObstacleTrack = { data: new Float64Array(TRACKED_STEPS * 3), steps: 0 };
  private readonly recordLosses: number[] = [];
  private readonly recordRest: FallRest = { position: new Float64Array(PARTICLES * 3), previous: new Float64Array(PARTICLES * 3), steps: -1 };
  private replaying: FallRecord | null = null;
  private primed = false;
  private pending: (ImpulseRecord & { readonly at: number }) | null = null;
  private lost = 0;
  private clock = 0;
  private readonly bones: readonly THREE.Bone[];
  private readonly frame = new THREE.Quaternion();
  private readonly world = new THREE.Quaternion();
  private readonly axisX = new THREE.Vector3();
  private readonly axisY = new THREE.Vector3();
  private readonly axisZ = new THREE.Vector3();
  private readonly hint = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly other = new THREE.Vector3();
  private readonly pelvisX = new THREE.Vector3();
  private readonly pelvisY = new THREE.Vector3();
  private readonly upperX = new THREE.Vector3();
  private readonly headX = new THREE.Vector3();
  private readonly kneeAxes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(1, 0, 0)] as const;
  private readonly elbowAxes = [new THREE.Vector3(), new THREE.Vector3()] as const;
  /** From the spine's joint to the chest's at rest, in world units. */
  private readonly spineLength: number;
  private readonly tiltJoint = new THREE.Vector3();
  private readonly tiltChest = new THREE.Vector3();
  private readonly tiltAcross = new THREE.Vector3();
  private readonly tiltTurn = new THREE.Quaternion();

  constructor(private readonly rig: SolvedRig, private readonly root: THREE.Object3D) {
    this.bones = DRIVEN.map((name) => rig.bones[name]);
    const locals = new Map<THREE.Bone, [THREE.Quaternion, THREE.Vector3]>();
    root.traverse((object) => {
      if (object instanceof THREE.Bone) locals.set(object, [object.quaternion.clone(), object.position.clone()]);
    });
    rig.resetToRest();
    root.updateMatrixWorld(true);
    const rest = new Float64Array(PARTICLES * 3);
    this.read(rest);
    this.body.calibrate(rest);
    this.ahead.calibrate(rest);
    this.spineLength = this.tiltJoint.setFromMatrixPosition(rig.bones.spine.matrixWorld).distanceTo(this.tiltChest.setFromMatrixPosition(rig.bones.chest.matrixWorld));
    for (const [bone, [quaternion, position]] of locals) {
      bone.quaternion.copy(quaternion);
      bone.position.copy(position);
    }
    root.updateMatrixWorld(true);
  }

  /** True while physics drives the skeleton. */
  get active(): boolean {
    return this.ragdolling;
  }

  /** The record of the latest fall, for the replay. */
  get record(): FallRecord | null {
    return this.lastFall;
  }

  /** Remembers the animated pose after each solve so a fall starts with the body's own momentum. */
  sample(dt: number): void {
    if (this.ragdolling || dt <= 0) return;
    this.sampleBefore.set(this.sampleNow);
    this.read(this.sampleNow);
    this.sampleSeconds = dt;
    this.samples = Math.min(2, this.samples + 1);
  }

  /** Advances the clock that ages a blow waiting for its fall. */
  tick(dt: number): void {
    this.clock += dt;
  }

  /** A blow on this fighter, already turned into the world frame by the caller. */
  takeBlow(snap: THREE.Vector3, drive: THREE.Vector3, target: Target, twist: number, style: FallStyle): void {
    const impulse: ImpulseRecord = { step: 0, x: snap.x, y: snap.y, z: snap.z, driveX: drive.x, driveY: drive.y, driveZ: drive.z, target, twist, style };
    if (this.ragdolling) {
      if (this.age > LATE_BLOW_SECONDS) return;
      if (this.replaying !== null) {
        // A replayed fall plays its recorded blows; one that never reached the live fall is added and plays at the next step
        // (the fall run on ahead of the replay starts over with it).
        if (this.replaying.impulses.length === 0) this.replaying.impulses.push({ ...impulse, step: this.body.steps });
        return;
      }
      this.lastFall?.impulses.push(this.body.impulse(impulse));
      return;
    }
    this.pending = { ...impulse, at: this.clock };
  }

  /** The next fall runs the recorded one again (the knockout replay). */
  prime(): void {
    this.primed = this.lastFall !== null;
  }

  /** Drops the recorded fall: the latest fall was played by the animation instead, so there is nothing to run again. */
  forget(): void {
    this.lastFall = null;
    this.primed = false;
  }

  /** Starts the fall from the current pose. Returns false when there is nothing to start from. */
  start(defaultStyle: FallStyle): boolean {
    const record = this.primed ? this.lastFall : null;
    this.primed = false;
    this.root.updateMatrixWorld(true);
    this.captureLocals(this.fromLocal, this.fromHips);
    if (record !== null) {
      this.replaying = record;
      this.body.start(record.positions, record.velocities, record.style);
      this.body.trackObstacle(record.obstacles, true);
      this.replayLosses(this.body, record, 0);
      for (const [index, offset] of record.offsets.entries()) this.offsets[index]!.copy(offset);
      // A live fall the replay cut short has not come to rest: run it on ahead, a few steps a frame, to find where it does.
      this.aheadOf = null;
      if (record.rest.steps < 0) this.runAhead(record, 0);
    } else {
      this.replaying = null;
      if (this.samples === 0) this.read(this.sampleNow);
      const seconds = this.samples >= 2 && this.sampleSeconds > 0 ? this.sampleSeconds : 0;
      for (let i = 0; i < PARTICLES * 3; i += 1) {
        const speed = seconds > 0 ? (this.sampleNow[i]! - this.sampleBefore[i]!) / seconds : 0;
        this.velocities[i] = Math.max(-MAX_START_SPEED, Math.min(MAX_START_SPEED, speed));
      }
      // The poser moves the head off the neck for slips and blows, but the body on the canvas is drawn with the
      // head on its neck (see drive): the head, crown and face start where the neck will carry them.
      const neckBone = this.rig.bones.neck;
      const headBone = this.rig.bones.head;
      this.point.copy(this.rig.restLocalPosition(headBone)).applyMatrix4(neckBone.matrixWorld).sub(this.other.setFromMatrixPosition(headBone.matrixWorld));
      for (const i of HEAD_PARTS) {
        this.sampleNow[i * 3] = this.sampleNow[i * 3]! + this.point.x;
        this.sampleNow[i * 3 + 1] = this.sampleNow[i * 3 + 1]! + this.point.y;
        this.sampleNow[i * 3 + 2] = this.sampleNow[i * 3 + 2]! + this.point.z;
      }
      const blow = this.pending !== null && this.clock - this.pending.at <= EARLY_BLOW_SECONDS ? this.pending : null;
      this.body.start(this.sampleNow, this.velocities, blow?.style ?? defaultStyle);
      this.computeOffsets();
      const impulses = this.recordImpulses;
      impulses.length = 0;
      if (blow !== null) impulses.push(this.body.impulse({ step: 0, x: blow.x, y: blow.y, z: blow.z, driveX: blow.driveX, driveY: blow.driveY, driveZ: blow.driveZ, target: blow.target, twist: blow.twist }));
      const obstacles = this.recordObstacles;
      obstacles.steps = 0;
      this.body.trackObstacle(obstacles, false);
      this.recordPositions.set(this.sampleNow);
      this.recordVelocities.set(this.velocities);
      for (let index = 0; index < this.offsets.length; index += 1) this.recordOffsets[index]!.copy(this.offsets[index]!);
      this.recordLosses.length = 0;
      this.recordLosses.push(0, this.lost);
      this.recordRest.steps = -1;
      this.aheadOf = null;
      this.lastFall = {
        positions: this.recordPositions,
        velocities: this.recordVelocities,
        style: this.body.fallStyle,
        impulses,
        offsets: this.recordOffsets,
        obstacles,
        losses: this.recordLosses,
        rest: this.recordRest,
      };
    }
    this.pending = null;
    this.ragdolling = true;
    this.riseCaptured = false;
    this.age = 0;
    this.accumulator = 0;
    return true;
  }

  /** Steps the physics by `dt` and writes the pose onto the skeleton. */
  update(dt: number, obstacle: { readonly x: number; readonly z: number } | null): void {
    if (!this.ragdolling) return;
    this.body.setObstacle(obstacle?.x ?? 0, obstacle?.z ?? 0, obstacle !== null);
    this.accumulator += Math.max(0, dt);
    let steps = 0;
    const replaying = this.replaying;
    while (this.accumulator >= STEP_SECONDS && steps < MAX_STEPS_PER_UPDATE) {
      if (replaying !== null) this.replayLosses(this.body, replaying, this.body.steps);
      this.body.step(replaying?.impulses);
      this.accumulator -= STEP_SECONDS;
      steps += 1;
    }
    if (steps === MAX_STEPS_PER_UPDATE) this.accumulator = 0;
    // The live fall keeps where it came to rest, which the replay's end goes back to.
    const record = this.lastFall;
    if (replaying === null && record !== null && record.rest.steps < 0 && this.body.asleep) this.body.keepRest(record.rest);
    if (replaying !== null && this.aheadOf === replaying) this.runAhead(replaying, AHEAD_STEPS);
    this.age += dt;
    this.body.interpolate(this.body.asleep ? 1 : this.accumulator / STEP_SECONDS, this.drawn);
    this.drive(this.drawn);
    if (this.age < BLEND_IN_SECONDS) this.blend(this.fromLocal, this.fromHips, this.age / BLEND_IN_SECONDS);
  }

  /**
   * Puts the fall at its end (after the replay cuts back to live): where the live fall came to rest, which is what the
   * count showed, or failing that where the fall run on ahead of the replay did; only a fall with neither is run on here.
   */
  settle(): void {
    if (!this.ragdolling) return;
    const replaying = this.replaying;
    const rest = replaying?.rest;
    if (rest !== undefined && rest.steps >= 0) this.body.restore(rest);
    else {
      const limit = this.body.steps + Math.ceil(RUN_ON_SECONDS / STEP_SECONDS);
      while (!this.body.asleep && this.body.steps < limit) {
        if (replaying !== null) this.replayLosses(this.body, replaying, this.body.steps);
        this.body.step(replaying?.impulses);
      }
    }
    this.accumulator = 0;
    this.age = Math.max(this.age, BLEND_IN_SECONDS);
    this.body.interpolate(1, this.drawn);
    this.drive(this.drawn);
  }

  /** Starts the recorded fall over and runs it to its end; false when there is none. */
  restoreSettled(): boolean {
    if (this.lastFall === null) return false;
    this.primed = true;
    this.start("crumple");
    this.settle();
    return true;
  }

  /** Stops driving the skeleton; the pose it left is kept for the get-up blend. */
  stop(): void {
    if (this.ragdolling) {
      this.root.updateMatrixWorld(true);
      this.captureLocals(this.riseLocal, this.riseHips);
      this.bodyTurns(this.riseTurns);
      this.riseCaptured = true;
    }
    this.ragdolling = false;
    this.replaying = null;
  }

  /** Moves the pose the fall left by `world` (a world-space offset): its root moved the other way. */
  shiftRise(world: THREE.Vector3): void {
    const parent = this.rig.bones.hips.parent;
    if (parent === null) {
      this.riseHips.add(world);
      return;
    }
    parent.updateWorldMatrix(true, false);
    const from = parent.worldToLocal(this.point.set(0, 0, 0));
    this.riseHips.add(parent.worldToLocal(this.other.copy(world)).sub(from));
  }

  /** Forgets the pose left by the last fall, so nothing blends from it. */
  clearRise(): void {
    this.riseCaptured = false;
  }

  /** Whether the fall left a pose for the get-up to start from. */
  get hasRisePose(): boolean {
    return this.riseCaptured;
  }

  /** Blends the solved get-up pose from where the fall left the body; `weight` 1 is the solved pose. */
  blendRise(weight: number): void {
    if (!this.riseCaptured || weight >= 1) return;
    // Each bone turns in the body's frame from where the fall left it to where the get-up has it, rather than
    // joint by joint: blended against a parent that is itself still turning, a limb would swing through the canvas.
    const w = Math.min(1, Math.max(0, weight));
    this.bodyTurns(this.solvedTurns);
    this.rig.bones.hips.position.lerpVectors(this.riseHips, this.rig.bones.hips.position, w);
    for (let index = 0; index < this.bones.length; index += 1) {
      const bone = this.bones[index]!;
      if (bone !== this.rig.bones.hips) bone.position.lerpVectors(this.fromPositions[index]!, bone.position, w);
      bone.updateWorldMatrix(false, false);
      this.rig.setWorldRotation(bone, this.turn.slerpQuaternions(this.riseTurns[index]!, this.solvedTurns[index]!, w).premultiply(this.rootTurn));
      if (DRIVEN[index] === "upperChest") {
        this.rig.bones.clavicleL.updateWorldMatrix(false, false);
        this.rig.bones.clavicleR.updateWorldMatrix(false, false);
      }
    }
    this.root.updateMatrixWorld(true);
  }

  /** Every driven bone's world turn under the root's, into `out`; leaves the root's turn in `rootTurn`. */
  private bodyTurns(out: readonly THREE.Quaternion[]): void {
    this.root.updateMatrixWorld(true);
    this.root.getWorldQuaternion(this.rootTurn);
    this.turn.copy(this.rootTurn).invert();
    for (let index = 0; index < this.bones.length; index += 1) this.bones[index]!.getWorldQuaternion(out[index]!).premultiply(this.turn);
  }

  /** Where the pelvis came to rest, in world space. */
  pelvis(out: THREE.Vector3): THREE.Vector3 {
    return v(this.body.position, P.pelvis, out);
  }

  /** The middle of the body (between pelvis and chest), in world space. */
  centre(out: THREE.Vector3): THREE.Vector3 {
    v(this.body.position, P.pelvis, out);
    return out.add(v(this.body.position, P.upper, this.other)).multiplyScalar(0.5);
  }

  /** Points along the body on the canvas that others keep clear of: head, chest, pelvis and knees. */
  bodyPoint(index: 0 | 1 | 2 | 3 | 4, out: THREE.Vector3): THREE.Vector3 {
    const particle = [P.head, P.upper, P.pelvis, P.kneeL, P.kneeR][index]!;
    return v(this.body.position, particle, out);
  }

  /** Which way the face points, in world space. */
  faceDirection(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(v(this.body.position, P.face, out)).sub(v(this.body.position, P.head, this.other)).normalize();
  }

  /** Whether the body landed face down (belly to the canvas). */
  faceDown(): boolean {
    return this.body.pelvisForward(this.point).y < -0.25;
  }

  /**
   * Lost parts carry no weight. A live fall records the step each loss came at; a replay weighs the body as the live
   * fall did, whatever has been lost since (a knockout by the count loses the head only in its replay).
   */
  setLost(head: boolean, leftHand: boolean, rightHand: boolean): void {
    const lost = (head ? 1 : 0) | (leftHand ? 2 : 0) | (rightHand ? 4 : 0);
    if (this.replaying !== null || lost === this.lost) return;
    this.lost = lost;
    weigh(this.body, lost);
    if (this.ragdolling && this.lastFall !== null) this.lastFall.losses.push(this.body.steps, lost);
  }

  /** Weighs `body` as the record's losses have it from `step`. */
  private replayLosses(body: RagdollBody, record: FallRecord, step: number): void {
    const losses = record.losses;
    for (let k = 0; k < losses.length; k += 2) {
      if (losses[k] !== step) continue;
      if (body === this.body) this.lost = losses[k + 1]!;
      weigh(body, losses[k + 1]!);
    }
  }

  /**
   * Runs the replayed fall on ahead by up to `steps` (from its start with 0), as the replay runs it, and keeps where
   * it comes to rest; it starts over if the replay gives the fall a blow the record lacked.
   */
  private runAhead(record: FallRecord, steps: number): void {
    const ahead = this.ahead;
    if (steps === 0 || this.aheadBlows !== record.impulses.length) {
      ahead.start(record.positions, record.velocities, record.style);
      ahead.trackObstacle(record.obstacles, true);
      weigh(ahead, 0);
      this.replayLosses(ahead, record, 0);
      this.aheadOf = record;
      this.aheadBlows = record.impulses.length;
      if (steps === 0) return;
    }
    for (let k = 0; k < steps && !ahead.asleep; k += 1) {
      this.replayLosses(ahead, record, ahead.steps);
      ahead.step(record.impulses);
    }
    if (!ahead.asleep) return;
    ahead.keepRest(record.rest);
    this.aheadOf = null;
  }

  private captureLocals(out: readonly THREE.Quaternion[], hips: THREE.Vector3): void {
    for (let index = 0; index < this.bones.length; index += 1) {
      out[index]!.copy(this.bones[index]!.quaternion);
      this.fromPositions[index]!.copy(this.bones[index]!.position);
    }
    hips.copy(this.rig.bones.hips.position);
  }

  /** Slerps every driven bone from a stored pose toward its current pose by `weight`. */
  private blend(from: readonly THREE.Quaternion[], hips: THREE.Vector3, weight: number): void {
    const w = Math.min(1, Math.max(0, weight));
    for (let index = 0; index < this.bones.length; index += 1) {
      const bone = this.bones[index]!;
      // From the current pose back toward the stored one: slerpQuaternions(from, bone.quaternion, w) would copy
      // `from` over the bone's own quaternion first and never leave the stored pose.
      bone.quaternion.slerp(from[index]!, 1 - w);
      if (bone !== this.rig.bones.hips) bone.position.lerpVectors(this.fromPositions[index]!, bone.position, w);
    }
    this.rig.bones.hips.position.lerpVectors(hips, this.rig.bones.hips.position, w);
    this.root.updateMatrixWorld(true);
  }

  /** Reads the particles off the posed skeleton. */
  private read(out: Float64Array): void {
    const b = this.rig.bones;
    const put = (i: number, value: THREE.Vector3): void => setV(out, i, value);
    const position = (bone: THREE.Bone): THREE.Vector3 => this.point.setFromMatrixPosition(bone.matrixWorld);
    const axis = (bone: THREE.Bone, column: 0 | 1 | 2, target: THREE.Vector3): THREE.Vector3 => target.setFromMatrixColumn(bone.matrixWorld, column).normalize();
    put(P.pelvis, position(b.hips));
    put(P.hipL, position(b.hipL));
    put(P.hipR, position(b.hipR));
    put(P.belly, position(b.hips).addScaledVector(axis(b.hips, 2, this.axisZ), BELLY_FORWARD));
    put(P.chest, position(b.chest));
    put(P.upper, position(b.upperChest));
    put(P.neck, position(b.neck));
    put(P.shoulderL, position(b.shoulderL));
    put(P.shoulderR, position(b.shoulderR));
    put(P.head, position(b.head));
    put(P.crown, position(b.head).addScaledVector(axis(b.head, 1, this.axisY), CROWN_UP));
    put(P.face, position(b.head).addScaledVector(axis(b.head, 2, this.axisZ), FACE_FORWARD).addScaledVector(axis(b.head, 1, this.axisY), FACE_UP));
    put(P.elbowL, position(b.elbowL));
    put(P.wristL, position(b.gloveL));
    put(P.fistL, position(b.gloveL).addScaledVector(axis(b.gloveL, 1, this.axisY), FIST_REACH));
    put(P.elbowR, position(b.elbowR));
    put(P.wristR, position(b.gloveR));
    put(P.fistR, position(b.gloveR).addScaledVector(axis(b.gloveR, 1, this.axisY), FIST_REACH));
    put(P.kneeL, position(b.kneeL));
    put(P.ankleL, position(b.ankleL));
    put(P.toeL, position(b.toeL));
    put(P.heelL, position(b.ankleL).addScaledVector(axis(b.toeL, 1, this.axisY), -HEEL_BACK).addScaledVector(axis(b.toeL, 2, this.axisZ), -HEEL_DOWN));
    put(P.kneeR, position(b.kneeR));
    put(P.ankleR, position(b.ankleR));
    put(P.toeR, position(b.toeR));
    put(P.heelR, position(b.ankleR).addScaledVector(axis(b.toeR, 1, this.axisY), -HEEL_BACK).addScaledVector(axis(b.toeR, 2, this.axisZ), -HEEL_DOWN));
  }

  /** Each driven bone keeps its offset from the frame its particles make, measured at the start. */
  private computeOffsets(): void {
    this.prepareFrames(this.body.position);
    for (let index = 0; index < this.bones.length; index += 1) {
      const bone = this.bones[index]!;
      this.frameFor(index, this.body.position, this.frame);
      bone.matrixWorld.decompose(this.point, this.world, this.other);
      this.offsets[index]!.copy(this.frame.invert()).multiply(this.world);
    }
  }

  private drive(positions: Float64Array): void {
    // The poser moves the head off the neck for slips and blows; the body on the canvas has its own neck.
    for (let index = 0; index < this.bones.length; index += 1) {
      const bone = this.bones[index]!;
      if (bone !== this.rig.bones.hips) bone.position.copy(this.rig.restLocalPosition(bone));
    }
    this.root.updateMatrixWorld(true);
    const hips = this.rig.bones.hips;
    this.rig.setWorldPosition(hips, v(positions, P.pelvis, this.point));
    this.prepareFrames(positions);
    for (let index = 0; index < this.bones.length; index += 1) {
      const bone = this.bones[index]!;
      this.frameFor(index, positions, this.frame);
      this.world.copy(this.frame).multiply(this.offsets[index]!);
      this.rig.setWorldRotation(bone, this.world);
      if (bone === hips) this.tiltHips(positions);
      // The spine bone between the hips and the chest has no particle of its own, so the chest is put on its
      // particle; everything above it then lies on its particles too (the upper body's lengths are rigid). The
      // limbs' roots go on theirs as well: the tilted hips carry the hip joints a little off the hip line, and
      // the shoulders hang from clavicles the physics does not move.
      const pinned = PINNED[index]!;
      if (pinned >= 0) this.rig.setWorldPosition(bone, v(positions, pinned, this.point));
      if (DRIVEN[index] === "upperChest") {
        this.rig.bones.clavicleL.updateWorldMatrix(false, false);
        this.rig.bones.clavicleR.updateWorldMatrix(false, false);
      }
    }
    this.root.updateMatrixWorld(true);
  }

  /**
   * The particles bend the trunk at the pelvis, the skeleton at the spine's joint a hand's width above it: the
   * hips pitch about the hip line until that joint is the spine's own length from the chest particle, so the
   * belly neither stretches nor squashes however far he folds (the hip joints lie on that line and stay put).
   */
  private tiltHips(positions: Float64Array): void {
    const hips = this.rig.bones.hips;
    const origin = this.point.setFromMatrixPosition(hips.matrixWorld);
    const joint = this.tiltJoint.copy(this.rig.restLocalPosition(this.rig.bones.spine)).applyMatrix4(hips.matrixWorld).sub(origin);
    const chest = v(positions, P.chest, this.tiltChest).sub(origin);
    const axis = this.pelvisX;
    // The joint turns about the hip line: joint(a) = along + across cos a + (axis x across) sin a. Its distance
    // from the chest is the spine's length where joint(a).chest = wanted.
    const along = axis.dot(joint);
    const across = this.tiltAcross.copy(joint).addScaledVector(axis, -along);
    const wanted = (joint.lengthSq() + chest.lengthSq() - this.spineLength * this.spineLength) / 2 - along * axis.dot(chest);
    const b = across.dot(chest);
    const c = this.other.crossVectors(axis, across).dot(chest);
    const reach = Math.hypot(b, c);
    if (reach < 1e-9) return;
    const phase = Math.atan2(c, b);
    const spread = Math.acos(Math.min(1, Math.max(-1, wanted / reach)));
    // Of the two pitches that fit, the smaller.
    const first = wrapAngle(phase - spread);
    const second = wrapAngle(phase + spread);
    const pitch = Math.abs(first) <= Math.abs(second) ? first : second;
    if (Math.abs(pitch) < 1e-5) return;
    hips.getWorldQuaternion(this.world).premultiply(this.tiltTurn.setFromAxisAngle(axis, pitch));
    this.rig.setWorldRotation(hips, this.world);
  }

  /** Body axes shared by every bone's frame: the pelvis, the shoulder line and the head. Call before `frameFor`. */
  private prepareFrames(p: Float64Array): void {
    // Pelvis: x from the right hip to the left, y up the spine, z out through the belly.
    this.segment(p, P.hipR, P.hipL, this.pelvisX);
    this.axisZ.set(
      p[P.belly * 3]! - (p[P.hipL * 3]! + p[P.hipR * 3]!) / 2,
      p[P.belly * 3 + 1]! - (p[P.hipL * 3 + 1]! + p[P.hipR * 3 + 1]!) / 2,
      p[P.belly * 3 + 2]! - (p[P.hipL * 3 + 2]! + p[P.hipR * 3 + 2]!) / 2,
    );
    this.axisZ.addScaledVector(this.pelvisX, -this.axisZ.dot(this.pelvisX)).normalize();
    this.pelvisY.crossVectors(this.axisZ, this.pelvisX).normalize();
    this.segment(p, P.shoulderR, P.shoulderL, this.upperX);
    this.segment(p, P.head, P.crown, this.axisX);
    this.segment(p, P.head, P.face, this.other);
    this.headX.crossVectors(this.axisX, this.other).normalize();
  }

  private segment(p: Float64Array, from: number, to: number, out: THREE.Vector3): THREE.Vector3 {
    out.set(p[to * 3]! - p[from * 3]!, p[to * 3 + 1]! - p[from * 3 + 1]!, p[to * 3 + 2]! - p[from * 3 + 2]!);
    return out.lengthSq() > 1e-12 ? out.normalize() : out.set(0, 1, 0);
  }

  /** The world frame a driven bone's particles make (after `prepareFrames` for the same positions). */
  private frameFor(index: number, p: Float64Array, out: THREE.Quaternion): THREE.Quaternion {
    const name = DRIVEN[index]!;
    switch (name) {
      case "hips":
        return frameFromAxes(this.pelvisY, this.pelvisX, "x", out);
      case "spine": {
        // Aimed from its own joint, where the hips carry it, at the chest particle: aimed along the pelvis's line
        // instead, it left the chest up to 16 cm off its particle once the body folded at the waist.
        const spine = this.bones[index]!;
        spine.updateWorldMatrix(false, false);
        this.axisY.setFromMatrixPosition(spine.matrixWorld);
        this.axisY.set(p[P.chest * 3]! - this.axisY.x, p[P.chest * 3 + 1]! - this.axisY.y, p[P.chest * 3 + 2]! - this.axisY.z);
        if (this.axisY.lengthSq() > 1e-12) this.axisY.normalize();
        else this.segment(p, P.pelvis, P.chest, this.axisY);
        return frameFromAxes(this.axisY, this.hint.copy(this.pelvisX).multiplyScalar(0.75).addScaledVector(this.upperX, 0.25), "x", out);
      }
      case "chest":
        this.segment(p, P.chest, P.upper, this.axisY);
        return frameFromAxes(this.axisY, this.hint.copy(this.pelvisX).multiplyScalar(0.4).addScaledVector(this.upperX, 0.6), "x", out);
      case "upperChest":
        this.segment(p, P.upper, P.neck, this.axisY);
        return frameFromAxes(this.axisY, this.upperX, "x", out);
      case "neck":
        this.segment(p, P.neck, P.head, this.axisY);
        return frameFromAxes(this.axisY, this.hint.copy(this.upperX).add(this.headX), "x", out);
      case "head":
        this.segment(p, P.head, P.crown, this.axisY);
        return frameFromAxes(this.axisY, this.segment(p, P.head, P.face, this.hint), "z", out);
      case "shoulderL": case "elbowL": case "gloveL":
      case "shoulderR": case "elbowR": case "gloveR": {
        const side = name.endsWith("L") ? 0 : 1;
        const segment = SEGMENTS[index]!;
        const axis = this.body.elbowAxis(side, p, this.elbowAxes[side]);
        this.segment(p, segment[0], segment[1], this.axisY);
        return frameFromAxes(this.axisY, axis, "x", out);
      }
      case "hipL": case "kneeL": case "hipR": case "kneeR": {
        const side = name.endsWith("L") ? 0 : 1;
        const segment = SEGMENTS[index]!;
        const axis = this.body.kneeAxis(side, p, this.kneeAxes[side]);
        this.segment(p, segment[0], segment[1], this.axisY);
        return frameFromAxes(this.axisY, axis, "x", out);
      }
      default: {
        const left = name === "ankleL";
        const ankle = left ? P.ankleL : P.ankleR;
        const toe = left ? P.toeL : P.toeR;
        const heel = left ? P.heelL : P.heelR;
        this.segment(p, ankle, toe, this.axisY);
        this.segment(p, heel, toe, this.hint);
        this.other.set(p[ankle * 3]! - p[heel * 3]!, p[ankle * 3 + 1]! - p[heel * 3 + 1]!, p[ankle * 3 + 2]! - p[heel * 3 + 2]!);
        this.hint.cross(this.other);
        return frameFromAxes(this.axisY, this.hint, "x", out);
      }
    }
  }
}
