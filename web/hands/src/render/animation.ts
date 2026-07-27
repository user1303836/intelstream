import * as THREE from "three";
import type { FighterSnapshot, Hand, Power, PunchClass, Target } from "../types";
import { aimBone, solveArm, type BoxerRig } from "./boxer";
import type { WorldMapping } from "./world";

const GUARD_HIGH_L = new THREE.Vector3(0.1, 0.27, 0.27);
const GUARD_HIGH_R = new THREE.Vector3(-0.09, 0.29, 0.23);
const GUARD_LOW_L = new THREE.Vector3(0.13, 0.0, 0.26);
const GUARD_LOW_R = new THREE.Vector3(-0.11, 0.02, 0.22);
const RELAXED_L = new THREE.Vector3(0.13, 0.1, 0.28);
const RELAXED_R = new THREE.Vector3(-0.11, 0.14, 0.24);

const PUNCH_DURATION: Record<PunchClass, number> = { jab: 0.3, straight: 0.38, hook: 0.44, uppercut: 0.46 };
const HEAD_Y = 0.33;
const BODY_Y = -0.02;

function punchTarget(kind: PunchClass, target: Target, power: Power): THREE.Vector3 {
  const boost = power === "power" ? 0.12 : 0;
  const y = target === "head" ? HEAD_Y : BODY_Y;
  switch (kind) {
    case "jab": return new THREE.Vector3(0.06, y, 0.56 + boost * 0.5);
    case "straight": return new THREE.Vector3(-0.04, y, 0.62 + boost * 0.5);
    case "hook": return new THREE.Vector3(-0.3, y + 0.02, 0.48 + boost * 0.4);
    case "uppercut": return new THREE.Vector3(0.0, y + 0.1, 0.46 + boost * 0.4);
  }
}

export interface Impact {
  direction: number;
  amount: number;
  blocked: boolean;
}

const smooth = (current: number, target: number, rate: number, dt: number): number => current + (target - current) * (1 - Math.exp(-rate * dt));
const smoothAngle = (current: number, target: number, rate: number, dt: number): number => {
  let delta = ((target - current + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return current + delta * (1 - Math.exp(-rate * dt));
};
const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

const scratchTarget = new THREE.Vector3();
const scratchShoulder = new THREE.Vector3();
const scratchPole = new THREE.Vector3();
const scratchElbowOut = { elbowWorld: new THREE.Vector3() };
const scratchGlove = new THREE.Vector3();

export class BoxerAnimator {
  private yaw = 0;
  private punchT = 1;
  private punchKind: PunchClass | null = null;
  private punchHand: Hand = "left";
  private punchTargetKind: Target = "head";
  private punchPower: Power = "normal";
  private activeAction: PunchClass | null = null;
  private downAmount = 0;
  private reactionT = 1;
  private reactionDirection = 1;
  private reactionPower = 0;
  private walkPhase = 0;
  private readonly gloveLCurrent = new THREE.Vector3().copy(RELAXED_L);
  private readonly gloveRCurrent = new THREE.Vector3().copy(RELAXED_R);
  private hipsRoll = 0;
  private spinePitch = 0;
  private spineTwist = 0;
  private drop = 0;

  constructor(private readonly rig: BoxerRig, private readonly mapping: WorldMapping) {}

  impact(impact: Impact): void {
    if (impact.amount > this.reactionPower || this.reactionT > 0.4) {
      this.reactionT = 0;
      this.reactionDirection = impact.direction;
      this.reactionPower = Math.max(this.reactionPower * 0.4, impact.amount);
    }
  }

  update(fighter: FighterSnapshot, opponent: FighterSnapshot, dt: number, time: number, reducedMotion: boolean): void {
    const rig = this.rig;
    const mirror = fighter.stance === "orthodox" ? 1 : -1;

    const worldX = this.mapping.x(fighter.x);
    const worldZ = this.mapping.z(fighter.y);
    const targetYaw = Math.atan2(this.mapping.x(opponent.x) - worldX, (this.mapping.z(opponent.y) - worldZ) * 0.45);
    this.yaw = smoothAngle(this.yaw, targetYaw, 7, dt);

    if (fighter.action !== this.activeAction) {
      if (fighter.action !== null) {
        this.punchT = 0;
        this.punchKind = fighter.action;
        this.punchHand = fighter.action_hand ?? (fighter.stance === "orthodox" ? "left" : "right");
        this.punchTargetKind = fighter.action_target ?? "head";
        this.punchPower = fighter.action_power ?? "normal";
      }
      this.activeAction = fighter.action;
    }
    const duration = this.punchKind === null ? 1 : PUNCH_DURATION[this.punchKind] * (this.punchPower === "power" ? 1.3 : 1);
    this.punchT = Math.min(1, this.punchT + dt / duration);

    const tired = 1 - fighter.stamina / Math.max(1, fighter.maximum_stamina);
    const speed = Math.hypot(fighter.velocity_x, fighter.velocity_y) * 0.006;
    this.walkPhase += speed * dt * 4.4;

    const downTarget = fighter.is_downed ? 1 : 0;
    const downRate = fighter.is_downed ? 2.6 : 1.5;
    this.downAmount = smooth(this.downAmount, downTarget, downRate, dt);
    const down = smoothstep(0, 1, this.downAmount);

    this.reactionT = Math.min(1, this.reactionT + dt / 0.42);
    const reaction = (1 - smoothstep(0, 1, this.reactionT)) * Math.min(1, this.reactionPower / 220);

    const stunned = Math.min(1, fighter.stunned_ticks / 45);
    const wobble = reducedMotion ? 0 : Math.sin(time * 8.6) * 0.05 * stunned;

    const bob = reducedMotion || down > 0.5 ? 0 : Math.sin(time * (4.6 - tired * 1.6) + this.walkPhase * 0.5) * (0.014 + tired * 0.012);
    const breath = reducedMotion ? 0 : Math.sin(time * (2.2 + tired * 2.6)) * (0.012 + tired * 0.03);

    let dropTarget = 0;
    let rollTarget = 0;
    let pitchTarget = 0;
    if (fighter.defense === "weave") { dropTarget = -0.24; rollTarget = 0.34 * mirror; pitchTarget = 0.3; }
    else if (fighter.defense === "slip_left") { rollTarget = 0.2; pitchTarget = 0.06; }
    else if (fighter.defense === "slip_right") { rollTarget = -0.2; pitchTarget = 0.06; }
    else if (fighter.defense === "pull") { pitchTarget = -0.3; }
    if (fighter.is_foul_recovery_target) { dropTarget = -0.18; pitchTarget = 0.42; }
    if (fighter.clinch_ticks > 0 || fighter.clinch_startup_ticks > 0) { pitchTarget = 0.4; dropTarget = -0.06; }
    dropTarget -= reaction * 0.05;
    pitchTarget -= reaction * 0.34;
    rollTarget += wobble;
    this.drop = smooth(this.drop, dropTarget, 12, dt);
    this.hipsRoll = smooth(this.hipsRoll, rollTarget, 12, dt);
    this.spinePitch = smooth(this.spinePitch, pitchTarget, 11, dt);

    let twistTarget = 0;
    if (this.punchT < 1 && this.punchKind !== null) {
      const extend = smoothstep(0.16, 0.5, this.punchT) * (1 - smoothstep(0.6, 1, this.punchT));
      if (this.punchKind === "straight") twistTarget = -0.42 * extend * (this.punchHand === "left" ? 1 : -1) * mirror;
      if (this.punchKind === "hook") twistTarget = 0.4 * extend * (this.punchHand === "left" ? 1 : -1) * mirror;
      if (this.punchKind === "uppercut") twistTarget = -0.2 * extend * (this.punchHand === "left" ? 1 : -1) * mirror;
      if (this.punchKind === "jab") twistTarget = 0.24 * extend * (this.punchHand === "left" ? 1 : -1) * mirror;
    }
    this.spineTwist = smooth(this.spineTwist, twistTarget, 16, dt);

    const blade = 0.34 * mirror;
    rig.root.position.set(worldX, 0, worldZ);
    rig.root.rotation.set(0, this.yaw + blade * (1 - down), 0);

    const fallSide = this.reactionDirection >= 0 ? 1 : -1;
    rig.hips.position.y = 0.98 + bob + this.drop * (1 - down) - down * 0.82;
    rig.hips.rotation.set(
      -down * (Math.PI / 2 - 0.12) + this.spinePitch * 0.35 * (1 - down),
      0,
      this.hipsRoll * 0.5 * (1 - down) + down * 0.15 * fallSide,
    );
    rig.spine.rotation.set(this.spinePitch * (1 - down), this.spineTwist * (1 - down), this.hipsRoll * 0.55 * (1 - down));

    const headPitch = -this.spinePitch * 0.7 - reaction * 0.55 + down * 0.3;
    const headRoll = -this.hipsRoll * 0.8 + reaction * 0.3 * (this.reactionDirection >= 0 ? -1 : 1);
    rig.head.rotation.set(headPitch, -this.spineTwist * 0.5, headRoll);
    rig.chest.scale.set(1 + breath, 1 + breath * 0.5, 1 + breath);

    this.poseLegs(fighter, speed, down, fallSide, mirror);

    rig.root.updateMatrixWorld(true);

    const guardL = fighter.defense === "guard_high" ? GUARD_HIGH_L : fighter.defense === "guard_low" ? GUARD_LOW_L : RELAXED_L;
    const guardR = fighter.defense === "guard_high" ? GUARD_HIGH_R : fighter.defense === "guard_low" ? GUARD_LOW_R : RELAXED_R;
    let targetL = scratchTarget.copy(guardL);
    const targetR = new THREE.Vector3().copy(guardR);
    let finalL = new THREE.Vector3().copy(targetL);
    if (fighter.is_foul_recovery_target) { finalL.set(0.08, 0.32, 0.2); targetR.set(-0.06, 0.3, 0.18); }
    if (fighter.clinch_ticks > 0 || fighter.clinch_startup_ticks > 0) { finalL.set(0.16, -0.05, 0.5); targetR.set(-0.16, -0.02, 0.48); }
    if (down > 0.03) {
      finalL.lerp(new THREE.Vector3(0.5, 0.28, -0.1), down);
      targetR.lerp(new THREE.Vector3(-0.48, 0.3, 0.05), down);
    } else if (stunned > 0.15) {
      finalL.lerp(new THREE.Vector3(0.3, -0.25, 0.15), stunned * 0.7);
      targetR.lerp(new THREE.Vector3(-0.3, -0.22, 0.15), stunned * 0.7);
    }

    if (this.punchT < 1 && this.punchKind !== null) {
      const windup = smoothstep(0, 0.2, this.punchT) * (1 - smoothstep(0.16, 0.45, this.punchT));
      const extend = smoothstep(0.18, this.punchKind === "jab" ? 0.42 : 0.5, this.punchT) * (1 - smoothstep(0.62, 1, this.punchT));
      const punch = punchTarget(this.punchKind, this.punchTargetKind, this.punchPower);
      if (this.punchKind === "hook") {
        const sweep = smoothstep(0.18, 0.55, this.punchT);
        punch.x = THREE.MathUtils.lerp(-0.62, -0.1, sweep) * (this.punchHand === "left" ? 1 : -1) * -1;
        punch.z = 0.5 + 0.14 * sweep;
      }
      const windupOffset = new THREE.Vector3(0, this.punchKind === "uppercut" ? -0.22 : -0.03, -0.16).multiplyScalar(windup);
      const mixed = (this.punchHand === "left" ? finalL.clone() : targetR.clone()).add(windupOffset).lerp(punch, extend);
      if (this.punchHand === "left") finalL = mixed;
      else targetR.copy(mixed);
    }

    finalL.x *= mirror;
    targetR.x *= mirror;
    this.gloveLCurrent.x = smooth(this.gloveLCurrent.x, finalL.x, 22, dt);
    this.gloveLCurrent.y = smooth(this.gloveLCurrent.y, finalL.y, 22, dt);
    this.gloveLCurrent.z = smooth(this.gloveLCurrent.z, finalL.z, 22, dt);
    this.gloveRCurrent.x = smooth(this.gloveRCurrent.x, targetR.x, 22, dt);
    this.gloveRCurrent.y = smooth(this.gloveRCurrent.y, targetR.y, 22, dt);
    this.gloveRCurrent.z = smooth(this.gloveRCurrent.z, targetR.z, 22, dt);

    this.solveArmIK(rig.shoulderL, rig.elbowL, rig.gloveL, this.gloveLCurrent, 1, rig);
    this.solveArmIK(rig.shoulderR, rig.elbowR, rig.gloveR, this.gloveRCurrent, -1, rig);

    this.applyTrauma(fighter);
  }

  private poseLegs(fighter: FighterSnapshot, speed: number, down: number, fallSide: number, mirror: number): void {
    const rig = this.rig;
    const swing = Math.min(0.5, speed * 0.35) * (1 - down);
    const stride = Math.sin(this.walkPhase) * swing;
    const crouch = -this.drop * 1.4 * (1 - down);
    const baseL = { hip: -0.18 - crouch * 0.5, knee: 0.26 + crouch, ankle: -0.08 - crouch * 0.5 };
    const baseR = { hip: 0.14 - crouch * 0.5, knee: 0.3 + crouch, ankle: -0.1 - crouch * 0.5 };
    rig.hipL.rotation.set(
      THREE.MathUtils.lerp(baseL.hip + stride, -0.5, down),
      0.3 * mirror * (1 - down),
      THREE.MathUtils.lerp(0, 0.5 * fallSide, down),
    );
    rig.kneeL.rotation.x = THREE.MathUtils.lerp(baseL.knee - stride * 0.8, 0.7, down);
    rig.ankleL.rotation.x = THREE.MathUtils.lerp(baseL.ankle, 0.4, down);
    rig.hipR.rotation.set(
      THREE.MathUtils.lerp(baseR.hip - stride, -0.35, down),
      -0.12 * mirror * (1 - down),
      THREE.MathUtils.lerp(0, 0.35 * fallSide, down),
    );
    rig.kneeR.rotation.x = THREE.MathUtils.lerp(baseR.knee + stride * 0.8, 0.5, down);
    rig.ankleR.rotation.x = THREE.MathUtils.lerp(baseR.ankle, 0.4, down);
  }

  private solveArmIK(shoulder: THREE.Group, elbow: THREE.Group, glove: THREE.Group, localTarget: THREE.Vector3, side: 1 | -1, rig: BoxerRig): void {
    shoulder.getWorldPosition(scratchShoulder);
    scratchGlove.copy(localTarget);
    rig.chest.localToWorld(scratchGlove);
    scratchPole.set(0.9 * side, -1, -0.25).applyQuaternion(rig.chest.getWorldQuaternion(new THREE.Quaternion()));
    solveArm(scratchShoulder, scratchGlove, scratchPole, scratchElbowOut);
    aimBone(shoulder, scratchShoulder, scratchElbowOut.elbowWorld);
    shoulder.updateMatrixWorld(true);
    aimBone(elbow, scratchElbowOut.elbowWorld, scratchGlove);
  }

  private applyTrauma(fighter: FighterSnapshot): void {
    const trauma = fighter.trauma;
    const bruise = (value: number): number => Math.min(0.85, value / 170 + trauma.swelling / 420);
    (this.rig.bruiseL.material as THREE.MeshStandardMaterial).opacity = bruise(trauma.left_eye);
    (this.rig.bruiseR.material as THREE.MeshStandardMaterial).opacity = bruise(trauma.right_eye);
    (this.rig.cutL.material as THREE.MeshStandardMaterial).opacity = Math.min(1, trauma.left_cut / 200 + trauma.bleeding / 600);
    (this.rig.cutR.material as THREE.MeshStandardMaterial).opacity = Math.min(1, trauma.right_cut / 200 + trauma.bleeding / 600);
    (this.rig.bodyBruise.material as THREE.MeshStandardMaterial).opacity = Math.min(0.7, trauma.body / 950);
    const swell = 1 + Math.min(0.12, trauma.swelling / 2500);
    this.rig.headMesh.scale.set(0.92 * swell, 1.08 * swell, 0.98 * swell);
  }
}
