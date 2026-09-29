import * as THREE from "three";
import { SolvedRig, worldPosition, worldQuaternion, type CanonicalBone } from "./rig";

/**
 * Character-space boxing pose description and the solver that applies it to
 * the skinned rig. Character space is metres relative to the fighter's root:
 * +Z toward the opponent, +X the fighter's left, +Y up. Orthodox poses are
 * authored for a left lead; southpaw mirrors x and swaps limb roles.
 */

export interface HandTarget {
  /** Character-space wrist position. */
  readonly position: THREE.Vector3;
  /** Character-space knuckle direction (bone +Y). */
  readonly knuckles: THREE.Vector3;
  /** Character-space palm normal (bone +Z). */
  readonly palm: THREE.Vector3;
  /** Character-space direction the elbow bends toward. */
  readonly pole: THREE.Vector3;
}

export interface FootTarget {
  /** Character-space ankle position. */
  readonly position: THREE.Vector3;
  /** Character-space horizontal toe direction. */
  readonly toe: THREE.Vector3;
  /** Heel lift in radians (foot pitched onto the ball). */
  readonly heel: number;
  /** Character-space direction the knee bends toward. */
  readonly pole: THREE.Vector3;
}

export interface TorsoPose {
  /** Hips centre in character space. */
  readonly hips: THREE.Vector3;
  readonly hipsYaw: number;
  readonly hipsPitch: number;
  readonly hipsRoll: number;
  /** Shoulder-line yaw relative to the root, distributed over the spine. */
  readonly shouldersYaw: number;
  readonly spinePitch: number;
  readonly spineRoll: number;
  readonly headYaw: number;
  readonly headPitch: number;
  readonly headRoll: number;
  /** Extra head translation (whiplash) in character space. */
  readonly headOffset: THREE.Vector3;
}

export interface PoseDescription {
  readonly torso: TorsoPose;
  readonly handL: HandTarget;
  readonly handR: HandTarget;
  readonly footL: FootTarget;
  readonly footR: FootTarget;
  /** Clavicle protraction per side (0..1 pushes the shoulder forward and up). */
  readonly shrugL: number;
  readonly shrugR: number;
}

export const HIPS_TO_THIGH = { x: 0.1059, y: 0.0253, z: -0.0026 } as const;
const HIPS_TO_SPINE = 0.0815;
const SPINE_TO_CHEST = 0.2606;
const CHEST_TO_UPPER = 0.1337;
const UPPER_TO_NECK = 0.1923;
const NECK_TO_HEAD = { y: 0.1025, z: 0.0313 } as const;
const CLAVICLE_ROOT = { x: 0.0109, y: 0.1200, z: -0.0006 } as const;
const CLAVICLE_LENGTH = 0.2;
/** Rest arm-root positions in upper-chest space: the left hangs lower and forward. */
const ARM_ROOT_L = new THREE.Vector3(0.2018, 0.081, -0.027);
const ARM_ROOT_R = new THREE.Vector3(-0.2018, 0.081, -0.027);

export const vec = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
export const lerpVec = (out: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, t: number): THREE.Vector3 => out.copy(a).lerp(b, t);
export const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = THREE.MathUtils.clamp((value - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const easeIn = (t: number, power = 1.7): number => Math.pow(THREE.MathUtils.clamp(t, 0, 1), power);
export const easeOut = (t: number, power = 2): number => 1 - Math.pow(1 - THREE.MathUtils.clamp(t, 0, 1), power);

const rootQuat = new THREE.Quaternion();
const rootPos = new THREE.Vector3();
const scratch = new THREE.Vector3();
const scratchB = new THREE.Vector3();
const scratchC = new THREE.Vector3();
const scratchD = new THREE.Vector3();
const scratchQ = new THREE.Quaternion();
const scratchQ2 = new THREE.Quaternion();
const scratchEuler = new THREE.Euler();
const worldUp = new THREE.Vector3(0, 1, 0);

/** Applies a character-space pose to the rig in world space. */
export class PoseSolver {
  private readonly chestLocal = new THREE.Vector3();
  constructor(private readonly rig: SolvedRig) {}

  private toWorld(local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(local).applyQuaternion(rootQuat).add(rootPos);
  }

  private dirToWorld(local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(local).applyQuaternion(rootQuat);
  }

  private setYawPitchRoll(bone: THREE.Bone, yaw: number, pitch: number, roll: number): void {
    scratchEuler.set(pitch, yaw, roll, "YXZ");
    scratchQ.setFromEuler(scratchEuler);
    scratchQ2.copy(rootQuat).multiply(scratchQ);
    this.rig.setWorldRotation(bone, scratchQ2);
  }

  apply(root: THREE.Object3D, pose: PoseDescription): void {
    const rig = this.rig;
    const bones = rig.bones;
    rig.resetToRest();
    root.updateMatrixWorld(true);
    worldQuaternion(root, rootQuat);
    worldPosition(root, rootPos);

    const torso = pose.torso;
    this.toWorld(torso.hips, scratch);
    rig.setWorldPosition(bones.hips, scratch);
    this.setYawPitchRoll(bones.hips, torso.hipsYaw, torso.hipsPitch, torso.hipsRoll);
    const twist = torso.shouldersYaw - torso.hipsYaw;
    const segments: [CanonicalBone, number, number][] = [
      ["spine", 0.25, 0.2],
      ["chest", 0.55, 0.5],
      ["upperChest", 1.0, 1.0],
    ];
    for (const [name, twistShare, pitchShare] of segments) {
      this.setYawPitchRoll(
        bones[name],
        torso.hipsYaw + twist * twistShare,
        torso.hipsPitch + torso.spinePitch * pitchShare,
        torso.hipsRoll + torso.spineRoll * pitchShare,
      );
    }
    const neckYaw = torso.shouldersYaw + (torso.headYaw - torso.shouldersYaw) * 0.45;
    const neckPitch = torso.hipsPitch + torso.spinePitch + (torso.headPitch - torso.spinePitch) * 0.5;
    this.setYawPitchRoll(bones.neck, neckYaw, neckPitch, torso.hipsRoll + torso.spineRoll * 0.6 + torso.headRoll * 0.4);
    this.setYawPitchRoll(bones.head, torso.headYaw, torso.headPitch, torso.headRoll);
    if (torso.headOffset.lengthSq() > 0) {
      worldPosition(bones.head, scratch);
      this.dirToWorld(torso.headOffset, scratchB);
      scratch.add(scratchB);
      rig.setWorldPosition(bones.head, scratch);
    }

    this.solveArm("L", pose.handL, pose.shrugL);
    this.solveArm("R", pose.handR, pose.shrugR);
    this.solveLeg("L", pose.footL);
    this.solveLeg("R", pose.footR);
  }

  private solveArm(side: "L" | "R", hand: HandTarget, shrug: number): void {
    const rig = this.rig;
    const bones = rig.bones;
    const clavicle = side === "L" ? bones.clavicleL : bones.clavicleR;
    const shoulder = side === "L" ? bones.shoulderL : bones.shoulderR;
    const elbow = side === "L" ? bones.elbowL : bones.elbowR;
    const glove = side === "L" ? bones.gloveL : bones.gloveR;
    const lengths = side === "L" ? rig.metrics.armL : rig.metrics.armR;
    const restRoot = side === "L" ? ARM_ROOT_L : ARM_ROOT_R;
    // Clavicle: aim at the rest arm root (upper-chest space) pushed forward and up by the shrug.
    this.chestLocal.copy(restRoot);
    this.chestLocal.z += shrug * 0.06;
    this.chestLocal.y += shrug * 0.035;
    this.chestLocal.x *= 1 - shrug * 0.08;
    scratchC.copy(this.chestLocal).multiplyScalar(rig.metrics.unitsPerMeter);
    bones.upperChest.localToWorld(scratchC);
    rig.aimAt(clavicle, scratchC, "z");
    shoulder.updateWorldMatrix(false, false);
    this.toWorld(hand.position, scratch);
    this.dirToWorld(hand.pole, scratchB);
    rig.solveLimb(shoulder, elbow, lengths, scratch, scratchB, "z", side === "L" ? 1 : -1, 0.012);
    glove.updateWorldMatrix(false, false);
    this.dirToWorld(hand.knuckles, scratchC);
    this.dirToWorld(hand.palm, scratchD);
    rig.setWorldFrame(glove, scratchC, scratchD, "z");
    void CLAVICLE_ROOT;
    void CLAVICLE_LENGTH;
  }

  private solveLeg(side: "L" | "R", foot: FootTarget): void {
    const rig = this.rig;
    const bones = rig.bones;
    const hip = side === "L" ? bones.hipL : bones.hipR;
    const knee = side === "L" ? bones.kneeL : bones.kneeR;
    const ankle = side === "L" ? bones.ankleL : bones.ankleR;
    const toe = side === "L" ? bones.toeL : bones.toeR;
    const lengths = side === "L" ? rig.metrics.legL : rig.metrics.legR;
    this.toWorld(foot.position, scratch);
    this.dirToWorld(foot.toe, scratchC).normalize();
    if (foot.heel !== 0) {
      // Pivot on the ball of the foot: the toe stays planted while the ankle rises and drifts forward.
      const pivot = rig.metrics.footLength * 0.72;
      scratch.addScaledVector(worldUp, Math.sin(foot.heel) * pivot).addScaledVector(scratchC, (1 - Math.cos(foot.heel)) * pivot);
    }
    this.dirToWorld(foot.pole, scratchB);
    rig.solveLimb(hip, knee, lengths, scratch, scratchB, "x", -1, 0.02);
    ankle.updateWorldMatrix(false, false);
    // Foot: +Y runs from the ankle down to the toe base, pitched by the heel lift.
    this.dirToWorld(foot.toe, scratchC).normalize();
    const drop = rig.metrics.ankleHeight;
    scratchD.copy(scratchC).multiplyScalar(rig.metrics.footLength).addScaledVector(worldUp, -drop);
    scratchD.normalize();
    if (foot.heel !== 0) {
      scratchQ.setFromAxisAngle(scratchB.crossVectors(scratchC, worldUp).normalize(), -foot.heel);
      scratchD.applyQuaternion(scratchQ);
    }
    rig.setWorldFrame(ankle, scratchD, worldUp, "z");
    toe.updateWorldMatrix(false, false);
    scratchB.copy(scratchC);
    if (foot.heel !== 0) scratchB.applyQuaternion(scratchQ);
    rig.setWorldFrame(toe, scratchB, worldUp, "z");
  }
}

/** Constants describing the authored orthodox stance in character space. */
export const STANCE = {
  bladeYaw: -1.05,
  hipsHeight: 0.8,
  leadFoot: vec(0.12, 0, 0.24),
  rearFoot: vec(-0.1, 0, -0.34),
  leadToe: vec(-0.34, 0, 0.94),
  rearToe: vec(-0.77, 0, 0.64),
  /** Hand offsets relative to the head bone. */
  relaxedLead: vec(0.11, -0.22, 0.36),
  relaxedRear: vec(-0.11, -0.16, 0.1),
  guardHighLead: vec(0.14, -0.02, 0.17),
  guardHighRear: vec(-0.1, -0.02, 0.11),
  guardLowLead: vec(0.15, -0.36, 0.22),
  guardLowRear: vec(-0.13, -0.34, 0.12),
  leadPole: vec(0.45, -1, 0.2),
  rearPole: vec(-0.5, -1, -0.05),
  leadKnuckles: vec(0.1, 0.55, 0.8),
  leadPalm: vec(-0.9, 0.15, -0.35),
  rearKnuckles: vec(-0.05, 0.7, 0.7),
  rearPalm: vec(0.95, 0.1, -0.25),
} as const;

export function mirrorX(v: THREE.Vector3, mirror: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(v.x * mirror, v.y, v.z);
}
