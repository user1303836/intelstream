import * as THREE from "three";
import type { BloodLevel } from "../settings";
import type { FighterSnapshot, Hand, Power, PunchClass, Target } from "../types";
import { aimBone, solveArm, type BoxerRig } from "./boxer";
import type { WorldMapping } from "./world";

const GUARD_HIGH_L = new THREE.Vector3(0.08, 0.29, 0.25);
const GUARD_HIGH_R = new THREE.Vector3(-0.07, 0.3, 0.21);
const GUARD_LOW_L = new THREE.Vector3(0.12, 0.02, 0.26);
const GUARD_LOW_R = new THREE.Vector3(-0.1, 0.04, 0.21);
const RELAXED_L = new THREE.Vector3(0.14, 0.14, 0.32);
const RELAXED_R = new THREE.Vector3(-0.09, 0.22, 0.21);

const PUNCH_DURATION: Record<PunchClass, number> = { jab: 0.26, straight: 0.42, hook: 0.5, uppercut: 0.55 };
const HEAD_Y = 0.33;
const BODY_Y = -0.02;

function punchEnvelope(kind: PunchClass, t: number): { windup: number; extend: number } {
  switch (kind) {
    case "jab":
      return { windup: smoothstep(0, 0.12, t) * (1 - smoothstep(0.1, 0.3, t)), extend: smoothstep(0.08, 0.3, t) * (1 - smoothstep(0.42, 0.82, t)) };
    case "straight":
      return { windup: smoothstep(0, 0.2, t) * (1 - smoothstep(0.16, 0.45, t)), extend: smoothstep(0.18, 0.5, t) * (1 - smoothstep(0.68, 1, t)) };
    case "hook":
      return { windup: smoothstep(0, 0.22, t) * (1 - smoothstep(0.18, 0.5, t)), extend: smoothstep(0.2, 0.52, t) * (1 - smoothstep(0.66, 1, t)) };
    case "uppercut":
      return { windup: smoothstep(0, 0.26, t) * (1 - smoothstep(0.22, 0.55, t)), extend: smoothstep(0.24, 0.58, t) * (1 - smoothstep(0.7, 1, t)) };
  }
}

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
  const delta = ((target - current + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return current + delta * (1 - Math.exp(-rate * dt));
};
const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

const scratchTarget = new THREE.Vector3();
const scratchShoulder = new THREE.Vector3();
const scratchPole = new THREE.Vector3();
const scratchElbowOut = { elbowWorld: new THREE.Vector3(), targetWorld: new THREE.Vector3() };
const scratchGlove = new THREE.Vector3();
const scratchFinalL = new THREE.Vector3();
const scratchFinalR = new THREE.Vector3();
const scratchPunch = new THREE.Vector3();
const scratchMixed = new THREE.Vector3();
const scratchWindup = new THREE.Vector3();
const scratchQuat = new THREE.Quaternion();

const BLOOD_CUT_SCALE: Record<BloodLevel, number> = { full: 1, reduced: 0.45, off: 0 };
const BLOODED_GLOVE = new THREE.Color(0x5c0a0e);

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
  private kinStep = 0;
  private kinHipYaw = 0;
  private kinDrop = 0;
  private kinHeelR = 0;
  private kinPivotL = 0;
  private kinHeadTuck = 0;
  private hitstop = 0;
  private prevVelocityX = 0;
  private prevVelocityY = 0;
  private inertiaPitch = 0;
  private inertiaRoll = 0;
  private prevDown = 0;
  private landingSpring = 0;
  private landingVelocity = 0;

  constructor(private readonly rig: BoxerRig, private readonly mapping: WorldMapping) {}

  get landingOffset(): number {
    return this.landingSpring;
  }

  impact(impact: Impact): void {
    if (impact.amount > this.reactionPower || this.reactionT > 0.4) {
      this.reactionT = 0;
      this.reactionDirection = impact.direction;
      this.reactionPower = Math.max(this.reactionPower * 0.4, impact.amount);
    }
  }

  landedHit(blocked: boolean): void {
    this.hitstop = Math.max(this.hitstop, blocked ? 0.045 : 0.078);
  }

  update(fighter: FighterSnapshot, opponent: FighterSnapshot, dt: number, time: number, reducedMotion: boolean, blood: BloodLevel = "full"): void {
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
    const punchDt = this.hitstop > 0 ? 0 : dt;
    this.hitstop = Math.max(0, this.hitstop - dt);
    this.punchT = Math.min(1, this.punchT + punchDt / duration);

    const tired = 1 - fighter.stamina / Math.max(1, fighter.maximum_stamina);
    const speed = Math.hypot(fighter.velocity_x, fighter.velocity_y) * 0.006;
    const speedFactor = Math.min(1, speed * 0.55);
    this.walkPhase += speed * dt * 4.6;

    const accelX = (fighter.velocity_x - this.prevVelocityX) / Math.max(0.001, dt);
    const accelY = (fighter.velocity_y - this.prevVelocityY) / Math.max(0.001, dt);
    this.prevVelocityX = fighter.velocity_x;
    this.prevVelocityY = fighter.velocity_y;
    const accelForward = (Math.sin(this.yaw) * this.mapping.x(accelX) + Math.cos(this.yaw) * this.mapping.z(accelY)) * 0.12;
    const accelLateral = (Math.cos(this.yaw) * this.mapping.x(accelX) - Math.sin(this.yaw) * this.mapping.z(accelY)) * 0.12;
    this.inertiaPitch = smooth(this.inertiaPitch, THREE.MathUtils.clamp(-accelForward, -0.16, 0.16), 6, dt);
    this.inertiaRoll = smooth(this.inertiaRoll, THREE.MathUtils.clamp(accelLateral, -0.12, 0.12), 6, dt);

    const downTarget = fighter.is_downed ? 1 : 0;
    const downRate = fighter.is_downed ? 2.6 : 1.5;
    this.downAmount = smooth(this.downAmount, downTarget, downRate, dt);
    const down = smoothstep(0, 1, this.downAmount);
    if (down > 0.72 && this.prevDown <= 0.72) this.landingVelocity = -0.85;
    this.prevDown = down;
    const springAccel = -this.landingSpring * 90 - this.landingVelocity * 12;
    this.landingVelocity += springAccel * dt;
    this.landingSpring = THREE.MathUtils.clamp(this.landingSpring + this.landingVelocity * dt, -0.09, 0.06);

    this.reactionT = Math.min(1, this.reactionT + dt / 0.42);
    const reactionPower = Math.min(1, this.reactionPower / 220);
    const reactionHead = (1 - smoothstep(0, 0.8, this.reactionT)) * reactionPower;
    const reaction = smoothstep(0, 0.14, this.reactionT) * (1 - smoothstep(0.35, 1, this.reactionT)) * reactionPower;

    const stunned = Math.min(1, fighter.stunned_ticks / 45);
    const wobble = reducedMotion ? 0 : Math.sin(time * 8.6) * 0.05 * stunned;

    const idleTempo = 4.4 - tired * 1.4;
    const stepBounce = reducedMotion || down > 0.5 ? 0 : -Math.abs(Math.sin(time * idleTempo + this.walkPhase * 0.35)) * (0.017 + tired * 0.01);
    const weightSway = reducedMotion || down > 0.5 ? 0 : Math.sin(time * idleTempo * 0.5) * 0.022;
    const breath = reducedMotion ? 0 : Math.sin(time * (2.2 + tired * 2.6)) * (0.012 + tired * 0.03);

    let dropTarget = -0.035;
    let rollTarget = 0;
    let pitchTarget = 0.09;
    if (fighter.defense === "weave") { dropTarget = -0.26; rollTarget = 0.34 * mirror; pitchTarget = 0.3; }
    else if (fighter.defense === "slip_left") { rollTarget = 0.2; pitchTarget = 0.12; }
    else if (fighter.defense === "slip_right") { rollTarget = -0.2; pitchTarget = 0.12; }
    else if (fighter.defense === "pull") { pitchTarget = -0.26; }
    if (fighter.is_foul_recovery_target) { dropTarget = -0.18; pitchTarget = 0.42; }
    if (fighter.clinch_ticks > 0 || fighter.clinch_startup_ticks > 0) { pitchTarget = 0.4; dropTarget = -0.08; }
    dropTarget -= reaction * 0.05;
    pitchTarget -= reaction * 0.34;
    rollTarget += wobble + this.inertiaRoll;
    pitchTarget += this.inertiaPitch;

    let twistTarget = 0;
    let stepTarget = 0;
    let hipYawTarget = 0;
    let kinDropTarget = 0;
    let heelRearTarget = 0;
    let pivotPunchTarget = 0;
    let tuckTarget = 0;
    if (this.punchT < 1 && this.punchKind !== null) {
      const { windup, extend } = punchEnvelope(this.punchKind, this.punchT);
      // three.js: rotation.y > 0 brings the anatomical RIGHT shoulder forward.
      // The punching shoulder must rotate through the target line regardless of stance.
      const handTwist = this.punchHand === "left" ? -1 : 1;
      const bodyDip = this.punchTargetKind === "body" ? -0.09 * extend : 0;
      if (this.punchKind === "jab") {
        twistTarget = 0.14 * extend * handTwist;
        stepTarget = 0.085 * extend;
        hipYawTarget = 0.06 * extend * handTwist;
        heelRearTarget = 0.3 * extend;
        tuckTarget = 0.15 * extend;
      } else if (this.punchKind === "straight") {
        twistTarget = 0.38 * extend * handTwist;
        hipYawTarget = 0.32 * extend * handTwist;
        heelRearTarget = 0.5 * extend;
        stepTarget = 0.06 * extend;
        tuckTarget = 0.1 * extend;
      } else if (this.punchKind === "hook") {
        twistTarget = 0.34 * extend * handTwist;
        hipYawTarget = 0.3 * extend * handTwist;
        pivotPunchTarget = 0.55 * extend;
        rollTarget += 0.09 * extend * handTwist;
        tuckTarget = 0.08 * extend;
      } else {
        twistTarget = 0.26 * extend * handTwist;
        hipYawTarget = 0.22 * extend * handTwist;
        kinDropTarget = -0.18 * windup + 0.07 * extend;
        pitchTarget += 0.14 * windup - 0.07 * extend;
        heelRearTarget = 0.4 * extend;
      }
      kinDropTarget += bodyDip;
    }
    this.drop = smooth(this.drop, dropTarget, 12, dt);
    this.hipsRoll = smooth(this.hipsRoll, rollTarget, 12, dt);
    this.spinePitch = smooth(this.spinePitch, pitchTarget, 11, dt);
    this.spineTwist = smooth(this.spineTwist, twistTarget, 16, dt);
    this.kinStep = smooth(this.kinStep, stepTarget, 14, dt);
    this.kinHipYaw = smooth(this.kinHipYaw, hipYawTarget, 14, dt);
    this.kinDrop = smooth(this.kinDrop, kinDropTarget, 13, dt);
    this.kinHeelR = smooth(this.kinHeelR, heelRearTarget, 14, dt);
    this.kinPivotL = smooth(this.kinPivotL, pivotPunchTarget, 14, dt);
    this.kinHeadTuck = smooth(this.kinHeadTuck, tuckTarget, 14, dt);

    const blade = 0.5 * mirror;
    const rootYaw = this.yaw + blade * (1 - down);
    rig.root.rotation.set(0, rootYaw, 0);
    const stepForwardX = Math.sin(rootYaw) * this.kinStep * (1 - down);
    const stepForwardZ = Math.cos(rootYaw) * this.kinStep * (1 - down);
    rig.root.position.set(worldX + stepForwardX, 0, worldZ + stepForwardZ);

    const fallSide = this.reactionDirection >= 0 ? 1 : -1;
    rig.hips.position.y = 0.955 + stepBounce + (this.drop + this.kinDrop) * (1 - down) - down * 0.8 + this.landingSpring;
    rig.hips.position.x = weightSway * (1 - down);
    rig.hips.rotation.set(
      -down * (Math.PI / 2 - 0.12) + this.spinePitch * 0.35 * (1 - down),
      this.kinHipYaw * (1 - down) + down * 0.32 * fallSide,
      this.hipsRoll * 0.5 * (1 - down) + weightSway * 0.8 * (1 - down) + down * 0.15 * fallSide,
    );
    rig.spine.rotation.set(this.spinePitch * (1 - down), (this.spineTwist + Math.sin(this.walkPhase) * 0.05 * speedFactor) * (1 - down), this.hipsRoll * 0.55 * (1 - down));

    const headPitch = 0.1 + this.kinHeadTuck - this.spinePitch * 0.7 - reactionHead * 0.55 + down * 0.3;
    const headRoll = -this.hipsRoll * 0.8 + reactionHead * 0.3 * (this.reactionDirection >= 0 ? -1 : 1);
    const headWeave = reducedMotion ? 0 : Math.sin(time * 0.9) * 0.07 + Math.sin(time * 1.7) * 0.03;
    rig.head.rotation.set(headPitch, -this.spineTwist * 0.5 + headWeave * (1 - down), headRoll);
    rig.chest.scale.set(1 + breath, 1 + breath * 0.5, 1 + breath);

    this.poseLegs(fighter, speedFactor, down, fallSide, mirror);

    rig.root.updateMatrixWorld(true);

    const guardL = fighter.defense === "guard_high" ? GUARD_HIGH_L : fighter.defense === "guard_low" ? GUARD_LOW_L : RELAXED_L;
    const guardR = fighter.defense === "guard_high" ? GUARD_HIGH_R : fighter.defense === "guard_low" ? GUARD_LOW_R : RELAXED_R;
    const finalL = scratchFinalL.copy(guardL);
    const finalR = scratchFinalR.copy(guardR);
    if (fighter.is_foul_recovery_target) { finalL.set(0.08, 0.32, 0.2); finalR.set(-0.06, 0.3, 0.18); }
    if (fighter.clinch_ticks > 0 || fighter.clinch_startup_ticks > 0) { finalL.set(0.16, -0.05, 0.5); finalR.set(-0.16, -0.02, 0.48); }
    if (down > 0.03) {
      const flail = Math.sin(smoothstep(0.06, 0.5, down) * Math.PI) * 0.42;
      finalL.lerp(scratchTarget.set(0.56, 0.1, -0.05), down);
      finalR.lerp(scratchTarget.set(-0.54, 0.12, 0.02), down);
      finalL.y += flail;
      finalR.y += flail * 0.85;
      finalL.x += flail * 0.2 * fallSide;
      finalR.x += flail * 0.15 * fallSide;
    } else if (stunned > 0.15) {
      finalL.lerp(scratchTarget.set(0.3, -0.25, 0.15), stunned * 0.7);
      finalR.lerp(scratchTarget.set(-0.3, -0.22, 0.15), stunned * 0.7);
    }

    if (!reducedMotion && down < 0.1) {
      const driftPhase = time * 1.9 + this.walkPhase * 0.2;
      finalL.x += Math.sin(driftPhase) * 0.014;
      finalL.y += Math.cos(driftPhase * 1.3) * 0.012;
      finalR.x += Math.cos(driftPhase * 0.8) * 0.012;
      finalR.y += Math.sin(driftPhase * 1.1) * 0.013;
      const feintCycle = (time * 0.27 + (mirror > 0 ? 0 : 0.5)) % 1;
      const feint = smoothstep(0.86, 0.9, feintCycle) * (1 - smoothstep(0.9, 0.97, feintCycle));
      if (this.punchT >= 1) {
        if (mirror > 0) finalL.z += feint * 0.12;
        else finalR.z += feint * 0.12;
      }
    }

    if (this.punchT < 1 && this.punchKind !== null && down < 0.85) {
      const { windup, extend } = punchEnvelope(this.punchKind, this.punchT);
      const scaledExtend = extend * (1 - down);
      const punch = scratchPunch.copy(punchTarget(this.punchKind, this.punchTargetKind, this.punchPower));
      if (this.punchKind === "hook") {
        const sweep = smoothstep(0.3, 0.62, this.punchT);
        const sideSign = this.punchHand === "left" ? 1 : -1;
        punch.x = THREE.MathUtils.lerp(0.58 * sideSign, -0.3 * sideSign, sweep);
        punch.z = 0.34 + 0.3 * Math.sin(sweep * Math.PI * 0.5);
      } else if (this.punchKind === "uppercut") {
        const rise = smoothstep(0.22, 0.6, this.punchT);
        punch.y = THREE.MathUtils.lerp(-0.26, punch.y, rise);
        punch.z = THREE.MathUtils.lerp(0.24, punch.z, rise);
      }
      const windupOffset = scratchWindup.set(0, this.punchKind === "uppercut" ? -0.22 : -0.03, this.punchKind === "jab" ? -0.1 : -0.16).multiplyScalar(windup);
      const base = this.punchHand === "left" ? finalL : finalR;
      const other = this.punchHand === "left" ? finalR : finalL;
      if (this.punchKind === "straight") other.set(-0.06, 0.27, 0.17);
      if (this.punchKind === "hook") other.set(-0.05, 0.3, 0.15);
      if (this.punchKind === "uppercut") other.y -= 0.08;
      const mixed = scratchMixed.copy(base).add(windupOffset).lerp(punch, scaledExtend);
      if (this.punchPower === "power" && this.punchT > 0.5 && this.punchT < 0.68) {
        const overshoot = (1 - Math.abs(this.punchT - 0.59) / 0.09) * 0.06;
        mixed.addScaledVector(punch, overshoot * scaledExtend);
      }
      base.copy(mixed);
    }

    if (fighter.taunt_ticks > 0 && down < 0.1) {
      const beat = ((60 - fighter.taunt_ticks) / 60) * 4;
      const direction = Math.floor(beat) % 2 === 0 ? 1 : -1;
      const swing = Math.abs(Math.sin(beat * Math.PI));
      finalL.set(THREE.MathUtils.lerp(0.28, -0.3, swing * (direction > 0 ? 1 : 0.15)), 0.52 + swing * 0.18, 0.3);
      finalR.set(THREE.MathUtils.lerp(-0.28, 0.3, swing * (direction < 0 ? 1 : 0.15)), 0.46 + swing * 0.2, 0.3);
      rig.hips.rotation.z += direction * swing * 0.14;
      rig.hips.position.y -= swing * 0.035;
      rig.spine.rotation.y += direction * swing * 0.18;
      rig.head.rotation.z += direction * swing * 0.1;
    }

    finalL.x *= mirror;
    finalR.x *= mirror;
    const gloveRate = down > 0.05 ? 9 : 26;
    this.gloveLCurrent.x = smooth(this.gloveLCurrent.x, finalL.x, gloveRate, dt);
    this.gloveLCurrent.y = smooth(this.gloveLCurrent.y, finalL.y, gloveRate, dt);
    this.gloveLCurrent.z = smooth(this.gloveLCurrent.z, finalL.z, gloveRate, dt);
    this.gloveRCurrent.x = smooth(this.gloveRCurrent.x, finalR.x, gloveRate, dt);
    this.gloveRCurrent.y = smooth(this.gloveRCurrent.y, finalR.y, gloveRate, dt);
    this.gloveRCurrent.z = smooth(this.gloveRCurrent.z, finalR.z, gloveRate, dt);

    this.solveArmIK(rig.shoulderL, rig.elbowL, rig.gloveL, this.gloveLCurrent, 1, rig);
    this.solveArmIK(rig.shoulderR, rig.elbowR, rig.gloveR, this.gloveRCurrent, -1, rig);

    this.applyTrauma(fighter, opponent, blood);
  }

  private poseLegs(fighter: FighterSnapshot, speedFactor: number, down: number, fallSide: number, mirror: number): void {
    const rig = this.rig;
    const strideAmp = 0.42 * speedFactor * (1 - down);
    const liftAmp = 0.5 * speedFactor * (1 - down);
    const crouch = -(this.drop + this.kinDrop) * 1.35 * (1 - down);
    const phaseL = this.walkPhase;
    const phaseR = this.walkPhase + Math.PI;
    const baseL = { hip: -0.2 - crouch * 0.5, knee: 0.34 + crouch, ankle: -0.1 - crouch * 0.5 };
    const baseR = { hip: 0.15 - crouch * 0.5, knee: 0.38 + crouch, ankle: -0.12 - crouch * 0.5 };
    const swingL = Math.sin(phaseL) * strideAmp;
    const swingR = Math.sin(phaseR) * strideAmp;
    const liftL = Math.max(0, Math.sin(phaseL - Math.PI / 2)) * liftAmp;
    const liftR = Math.max(0, Math.sin(phaseR - Math.PI / 2)) * liftAmp;
    const buckle = smoothstep(0, 0.3, down) * (1 - smoothstep(0.32, 0.62, down));
    rig.hipL.rotation.set(
      THREE.MathUtils.lerp(baseL.hip + swingL, -0.18, down),
      0.32 * mirror * (1 - down) + (this.punchHand === "left" ? this.kinPivotL : 0) * (1 - down),
      THREE.MathUtils.lerp(0, 0.5 * fallSide, down),
    );
    rig.kneeL.rotation.x = THREE.MathUtils.lerp(baseL.knee + liftL + buckle * 0.85, 0.24, Math.max(down, buckle));
    rig.ankleL.rotation.x = THREE.MathUtils.lerp(baseL.ankle - swingL * 0.4 - (mirror < 0 ? this.kinHeelR : 0) * (1 - down), 0.42, down);
    rig.hipR.rotation.set(
      THREE.MathUtils.lerp(baseR.hip + swingR, -0.12, down),
      -0.14 * mirror * (1 - down) + (this.punchHand === "right" ? this.kinPivotL : 0) * (1 - down),
      THREE.MathUtils.lerp(0, 0.35 * fallSide, down),
    );
    rig.kneeR.rotation.x = THREE.MathUtils.lerp(baseR.knee + liftR + buckle * 0.8, 0.18, Math.max(down, buckle));
    rig.ankleR.rotation.x = THREE.MathUtils.lerp(baseR.ankle - swingR * 0.4 - (mirror > 0 ? this.kinHeelR : 0) * (1 - down), 0.42, down);
  }

  private solveArmIK(shoulder: THREE.Group, elbow: THREE.Group, glove: THREE.Group, localTarget: THREE.Vector3, side: 1 | -1, rig: BoxerRig): void {
    shoulder.getWorldPosition(scratchShoulder);
    scratchGlove.copy(localTarget);
    rig.chest.localToWorld(scratchGlove);
    scratchPole.set(0.9 * side, -1, -0.25).applyQuaternion(rig.chest.getWorldQuaternion(scratchQuat));
    solveArm(scratchShoulder, scratchGlove, scratchPole, scratchElbowOut);
    aimBone(shoulder, scratchShoulder, scratchElbowOut.elbowWorld);
    shoulder.updateMatrixWorld(true);
    aimBone(elbow, scratchElbowOut.elbowWorld, scratchElbowOut.targetWorld);
  }

  private applyTrauma(fighter: FighterSnapshot, opponent: FighterSnapshot, blood: BloodLevel): void {
    const trauma = fighter.trauma;
    const bruise = (value: number): number => Math.min(0.85, value / 170 + trauma.swelling / 420);
    const cutScale = BLOOD_CUT_SCALE[blood];
    (this.rig.bruiseL.material as THREE.MeshStandardMaterial).opacity = bruise(trauma.left_eye);
    (this.rig.bruiseR.material as THREE.MeshStandardMaterial).opacity = bruise(trauma.right_eye);
    (this.rig.cutL.material as THREE.MeshStandardMaterial).opacity = Math.min(1, trauma.left_cut / 200 + trauma.bleeding / 600) * cutScale;
    (this.rig.cutR.material as THREE.MeshStandardMaterial).opacity = Math.min(1, trauma.right_cut / 200 + trauma.bleeding / 600) * cutScale;

    const swellAmount = (value: number): number => Math.min(1.35, value / 260 + trauma.swelling / 560);
    const swellL = swellAmount(trauma.left_eye);
    const swellR = swellAmount(trauma.right_eye);
    this.rig.swellL.scale.setScalar(0.25 + swellL * 1.15);
    this.rig.swellR.scale.setScalar(0.25 + swellR * 1.15);
    (this.rig.swellL.material as THREE.MeshStandardMaterial).opacity = Math.min(0.92, swellL * 1.1);
    (this.rig.swellR.material as THREE.MeshStandardMaterial).opacity = Math.min(0.92, swellR * 1.1);
    const cheekAmount = Math.min(1, trauma.head / 900 + trauma.swelling / 800);
    this.rig.cheekL.scale.setScalar(0.2 + cheekAmount * 1.05);
    this.rig.cheekR.scale.setScalar(0.2 + cheekAmount * 0.95);
    (this.rig.cheekL.material as THREE.MeshStandardMaterial).opacity = cheekAmount * 0.8;
    (this.rig.cheekR.material as THREE.MeshStandardMaterial).opacity = cheekAmount * 0.75;

    const dripL = Math.min(1.7, (trauma.left_cut + trauma.bleeding) / 260);
    const dripR = Math.min(1.7, (trauma.right_cut + trauma.bleeding) / 260);
    this.rig.streakL.scale.set(1, 0.15 + dripL, 1);
    this.rig.streakR.scale.set(1, 0.15 + dripR, 1);
    (this.rig.streakL.material as THREE.MeshStandardMaterial).opacity = Math.min(1, dripL) * cutScale;
    (this.rig.streakR.material as THREE.MeshStandardMaterial).opacity = Math.min(1, dripR) * cutScale;
    const noseAmount = Math.min(1.4, trauma.head / 700 + trauma.bleeding / 420);
    this.rig.noseStreak.scale.set(1, 0.2 + noseAmount, 1);
    (this.rig.noseStreak.material as THREE.MeshStandardMaterial).opacity = Math.min(1, noseAmount * 0.9) * cutScale;
    (this.rig.mouthBlood.material as THREE.MeshStandardMaterial).opacity = Math.min(1, trauma.head / 800 + trauma.bleeding / 500) * cutScale;

    const ribAmount = Math.min(1, trauma.body / 750);
    this.rig.ribL.scale.set(0.5 + ribAmount * 0.35, 1.2 + ribAmount * 0.5, 0.7 + ribAmount * 0.2);
    this.rig.ribR.scale.set(0.5 + ribAmount * 0.3, 1.2 + ribAmount * 0.4, 0.7 + ribAmount * 0.2);
    (this.rig.ribL.material as THREE.MeshStandardMaterial).opacity = ribAmount * 0.85;
    (this.rig.ribR.material as THREE.MeshStandardMaterial).opacity = ribAmount * 0.8;

    const opponentBlood = Math.min(1, (opponent.trauma.bleeding + opponent.trauma.left_cut + opponent.trauma.right_cut) / 620) * cutScale;
    this.rig.gloveLMaterial.color.copy(this.rig.gloveBaseColor).lerp(BLOODED_GLOVE, opponentBlood * 0.85);

    const smear = Math.min(1.3, trauma.body / 500 + trauma.bleeding / 420);
    this.rig.bodyStreak.scale.set(1 + smear * 0.4, 0.3 + smear, 1);
    (this.rig.bodyStreak.material as THREE.MeshStandardMaterial).opacity = Math.min(1, smear) * cutScale;

    (this.rig.bodyBruise.material as THREE.MeshStandardMaterial).opacity = Math.min(0.7, trauma.body / 950);
    const swell = 1 + Math.min(0.12, trauma.swelling / 2500);
    this.rig.headMesh.scale.set(0.92 * swell, 1.05 * swell, 0.95 * swell);
    const skin = this.rig.skinMaterial;
    skin.clearcoat = 0.25 + tiredSheen(fighter) * 0.4;
  }
}

function tiredSheen(fighter: FighterSnapshot): number {
  return 1 - fighter.stamina / Math.max(1, fighter.maximum_stamina);
}
