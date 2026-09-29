import * as THREE from "three";
import { BONE_ADAPTER } from "./skeleton";

/**
 * Direct world-space skeleton control for the Texel Boxer rig.
 *
 * Every bone points down its local +Y axis. Elbows hinge about the arm bones'
 * local Z (mirrored sign per side), knees hinge about the leg bones' local X,
 * hands use local +Y for the knuckles and local +Z for the palm normal, and the
 * torso chain uses +Y up with +Z as anatomical forward. The rig solves bones top
 * down, refreshing each bone's world matrix immediately so children can be
 * solved against the parent's new frame.
 */

export type CanonicalBone =
  | "hips" | "spine" | "chest" | "upperChest" | "neck" | "head"
  | "clavicleL" | "shoulderL" | "elbowL" | "gloveL" | "clavicleR" | "shoulderR" | "elbowR" | "gloveR"
  | "hipL" | "kneeL" | "ankleL" | "toeL" | "hipR" | "kneeR" | "ankleR" | "toeR";

export const RIG_BONES: Readonly<Record<CanonicalBone, string>> = {
  hips: BONE_ADAPTER.hips!,
  spine: BONE_ADAPTER.spine!,
  chest: "Spine1_024",
  upperChest: BONE_ADAPTER.chest!,
  neck: "Neck_012",
  head: BONE_ADAPTER.head!,
  clavicleL: "LeftShoulder_09",
  shoulderL: BONE_ADAPTER.shoulderL!,
  elbowL: BONE_ADAPTER.elbowL!,
  gloveL: BONE_ADAPTER.gloveL!,
  clavicleR: "RightShoulder_020",
  shoulderR: BONE_ADAPTER.shoulderR!,
  elbowR: BONE_ADAPTER.elbowR!,
  gloveR: BONE_ADAPTER.gloveR!,
  hipL: BONE_ADAPTER.hipL!,
  kneeL: BONE_ADAPTER.kneeL!,
  ankleL: BONE_ADAPTER.ankleL!,
  toeL: "LeftToeBase_011",
  hipR: BONE_ADAPTER.hipR!,
  kneeR: BONE_ADAPTER.kneeR!,
  ankleR: BONE_ADAPTER.ankleR!,
  toeR: "RightToeBase_022",
};

export interface LimbLengths {
  readonly upper: number;
  readonly lower: number;
}

export interface RigMetrics {
  readonly hipsHeight: number;
  readonly headHeight: number;
  readonly chestHeight: number;
  readonly ankleHeight: number;
  readonly armL: LimbLengths;
  readonly armR: LimbLengths;
  readonly legL: LimbLengths;
  readonly legR: LimbLengths;
  readonly footLength: number;
  readonly unitsPerMeter: number;
}

const scratchX = new THREE.Vector3();
const scratchY = new THREE.Vector3();
const scratchZ = new THREE.Vector3();
const scratchMatrix = new THREE.Matrix4();
const scratchWorld = new THREE.Quaternion();
const scratchParent = new THREE.Quaternion();
const scratchPosition = new THREE.Vector3();
const scratchScale = new THREE.Vector3();
const scratchA = new THREE.Vector3();
const scratchB = new THREE.Vector3();
const scratchDir = new THREE.Vector3();
const scratchBend = new THREE.Vector3();
const scratchMid = new THREE.Vector3();
const scratchNormal = new THREE.Vector3();
const scratchLower = new THREE.Vector3();

export function worldPosition(object: THREE.Object3D, target: THREE.Vector3): THREE.Vector3 {
  return target.setFromMatrixPosition(object.matrixWorld);
}

export function worldQuaternion(object: THREE.Object3D, target: THREE.Quaternion): THREE.Quaternion {
  object.matrixWorld.decompose(scratchPosition, target, scratchScale);
  return target;
}

/** Builds a right-handed world rotation whose +Y is `yDir` and whose `axis` (X or Z) is as close as possible to `hint`. */
export function frameFromAxes(yDir: THREE.Vector3, hint: THREE.Vector3, axis: "x" | "z", target: THREE.Quaternion): THREE.Quaternion {
  scratchY.copy(yDir).normalize();
  if (axis === "z") {
    scratchZ.copy(hint).addScaledVector(scratchY, -hint.dot(scratchY));
    if (scratchZ.lengthSq() < 1e-8) scratchZ.set(0, 0, 1).addScaledVector(scratchY, -scratchY.z);
    scratchZ.normalize();
    scratchX.crossVectors(scratchY, scratchZ).normalize();
  } else {
    scratchX.copy(hint).addScaledVector(scratchY, -hint.dot(scratchY));
    if (scratchX.lengthSq() < 1e-8) scratchX.set(1, 0, 0).addScaledVector(scratchY, -scratchY.x);
    scratchX.normalize();
    scratchZ.crossVectors(scratchX, scratchY).normalize();
  }
  scratchMatrix.makeBasis(scratchX, scratchY, scratchZ);
  return target.setFromRotationMatrix(scratchMatrix);
}

export class SolvedRig {
  readonly bones: Readonly<Record<CanonicalBone, THREE.Bone>>;
  readonly metrics: RigMetrics;
  private readonly restLocal = new Map<THREE.Bone, THREE.Quaternion>();
  private readonly restLocalPosition = new Map<THREE.Bone, THREE.Vector3>();

  constructor(root: THREE.Object3D) {
    const found = new Map<string, THREE.Bone>();
    root.traverse((object) => {
      if (object instanceof THREE.Bone) found.set(object.name, object);
    });
    const bones = {} as Record<CanonicalBone, THREE.Bone>;
    for (const [canonical, name] of Object.entries(RIG_BONES) as [CanonicalBone, string][]) {
      const bone = found.get(name);
      if (bone === undefined) throw new Error(`fighter rig missing bone ${name} (${canonical})`);
      bones[canonical] = bone;
    }
    this.bones = bones;
    root.updateMatrixWorld(true);
    for (const bone of found.values()) {
      this.restLocal.set(bone, bone.quaternion.clone());
      this.restLocalPosition.set(bone, bone.position.clone());
    }
    const distance = (from: CanonicalBone, to: CanonicalBone): number =>
      worldPosition(bones[from], scratchA).distanceTo(worldPosition(bones[to], scratchB));
    const hipsWorld = worldPosition(bones.hips, scratchA).clone();
    const hipsParent = bones.hips.parent ?? root;
    const parentWorld = worldPosition(hipsParent, scratchB).clone();
    const localLength = bones.hips.position.length();
    const worldLength = hipsWorld.distanceTo(parentWorld);
    this.metrics = {
      hipsHeight: hipsWorld.y,
      headHeight: worldPosition(bones.head, scratchA).y,
      chestHeight: worldPosition(bones.upperChest, scratchA).y,
      ankleHeight: worldPosition(bones.ankleL, scratchA).y,
      armL: { upper: distance("shoulderL", "elbowL"), lower: distance("elbowL", "gloveL") },
      armR: { upper: distance("shoulderR", "elbowR"), lower: distance("elbowR", "gloveR") },
      legL: { upper: distance("hipL", "kneeL"), lower: distance("kneeL", "ankleL") },
      legR: { upper: distance("hipR", "kneeR"), lower: distance("kneeR", "ankleR") },
      footLength: distance("ankleL", "toeL"),
      unitsPerMeter: worldLength > 1e-6 ? localLength / worldLength : 1,
    };
  }

  resetToRest(): void {
    for (const [bone, quaternion] of this.restLocal) {
      bone.quaternion.copy(quaternion);
      const position = this.restLocalPosition.get(bone);
      if (position !== undefined) bone.position.copy(position);
    }
  }

  restLocalQuaternion(bone: THREE.Bone): THREE.Quaternion {
    return this.restLocal.get(bone) ?? bone.quaternion;
  }

  position(bone: CanonicalBone, target: THREE.Vector3): THREE.Vector3 {
    return worldPosition(this.bones[bone], target);
  }

  /** Sets a bone's world rotation, keeping its rest position, and refreshes its world matrix. */
  setWorldRotation(bone: THREE.Bone, world: THREE.Quaternion): void {
    const parent = bone.parent;
    if (parent === null) {
      bone.quaternion.copy(world);
    } else {
      worldQuaternion(parent, scratchParent);
      bone.quaternion.copy(scratchParent.invert().multiply(world)).normalize();
    }
    bone.updateWorldMatrix(false, false);
  }

  setWorldFrame(bone: THREE.Bone, yDir: THREE.Vector3, hint: THREE.Vector3, axis: "x" | "z"): void {
    this.setWorldRotation(bone, frameFromAxes(yDir, hint, axis, scratchWorld));
  }

  /** Moves a bone to a world position (its parent's frame is converted), keeping rotation. */
  setWorldPosition(bone: THREE.Bone, world: THREE.Vector3): void {
    const parent = bone.parent;
    if (parent === null) {
      bone.position.copy(world);
    } else {
      bone.position.copy(world);
      parent.worldToLocal(bone.position);
    }
    bone.updateWorldMatrix(false, false);
  }

  /** Rotates a bone so its +Y points at `target` while keeping its rest roll as closely as possible. */
  aimAt(bone: THREE.Bone, target: THREE.Vector3, axis: "x" | "z"): void {
    bone.updateWorldMatrix(false, false);
    worldPosition(bone, scratchA);
    scratchDir.subVectors(target, scratchA);
    if (scratchDir.lengthSq() < 1e-10) return;
    worldQuaternion(bone, scratchWorld);
    const hint = axis === "z" ? scratchZ.set(0, 0, 1).applyQuaternion(scratchWorld) : scratchX.set(1, 0, 0).applyQuaternion(scratchWorld);
    this.setWorldFrame(bone, scratchDir, hint.clone(), axis);
  }

  /**
   * Two-bone IK. `pole` is a world direction the joint bends toward. `hingeAxis`
   * selects which local axis of the two bones is the hinge and `hingeSign`
   * orients it (+1: hinge = pole x limb direction, -1: the opposite).
   */
  solveLimb(
    upper: THREE.Bone,
    lower: THREE.Bone,
    lengths: LimbLengths,
    target: THREE.Vector3,
    pole: THREE.Vector3,
    hingeAxis: "x" | "z",
    hingeSign: 1 | -1,
    minimumBend = 0.01,
  ): { reached: boolean; joint: THREE.Vector3 } {
    upper.updateWorldMatrix(false, false);
    const root = worldPosition(upper, scratchA);
    scratchDir.subVectors(target, root);
    const maximum = lengths.upper + lengths.lower - minimumBend;
    const distance = THREE.MathUtils.clamp(scratchDir.length(), Math.abs(lengths.upper - lengths.lower) + 0.005, maximum);
    const reached = scratchDir.length() <= maximum;
    if (scratchDir.lengthSq() < 1e-10) scratchDir.set(0, -1, 0);
    scratchDir.normalize();
    scratchBend.copy(pole).addScaledVector(scratchDir, -pole.dot(scratchDir));
    if (scratchBend.lengthSq() < 1e-8) {
      scratchBend.set(0, 0, 1).addScaledVector(scratchDir, -scratchDir.z);
      if (scratchBend.lengthSq() < 1e-8) scratchBend.set(1, 0, 0);
    }
    scratchBend.normalize();
    const cosUpper = THREE.MathUtils.clamp(
      (lengths.upper * lengths.upper + distance * distance - lengths.lower * lengths.lower) / (2 * lengths.upper * distance),
      -1,
      1,
    );
    const along = lengths.upper * cosUpper;
    const out = lengths.upper * Math.sqrt(Math.max(0, 1 - cosUpper * cosUpper));
    scratchMid.copy(root).addScaledVector(scratchDir, along).addScaledVector(scratchBend, out);
    scratchNormal.crossVectors(scratchBend, scratchDir).multiplyScalar(hingeSign).normalize();
    scratchLower.copy(scratchMid).sub(root);
    this.setWorldFrame(upper, scratchLower, scratchNormal, hingeAxis);
    lower.updateWorldMatrix(false, false);
    const jointWorld = worldPosition(lower, scratchB);
    scratchLower.copy(root).addScaledVector(scratchDir, distance).sub(jointWorld);
    this.setWorldFrame(lower, scratchLower, scratchNormal, hingeAxis);
    return { reached, joint: jointWorld };
  }
}
