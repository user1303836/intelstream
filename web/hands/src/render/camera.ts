import * as THREE from "three";

const BASE_HEIGHT = 1.88;
const BASE_DISTANCE = 7.15;
const LOOK_HEIGHT = 1.12;

export interface CameraFrame {
  readonly position: THREE.Vector3;
  readonly lookAt: THREE.Vector3;
}

export class CameraDirector {
  private readonly current = new THREE.Vector3(0, BASE_HEIGHT, BASE_DISTANCE);
  private readonly look = new THREE.Vector3(0, LOOK_HEIGHT, 0);
  private swayPhase = 0;

  update(
    dt: number,
    time: number,
    fighterA: { x: number; z: number },
    fighterB: { x: number; z: number },
    separation: number,
    knockdown: boolean,
    shake: number,
    reducedMotion: boolean,
  ): CameraFrame {
    this.swayPhase += dt;
    const midX = (fighterA.x + fighterB.x) / 2;
    const midZ = (fighterA.z + fighterB.z) / 2;
    const clampedX = THREE.MathUtils.clamp(midX, -1.4, 1.4);
    const clampedZ = THREE.MathUtils.clamp(midZ, -1.1, 1.1);

    const distance = THREE.MathUtils.clamp(BASE_DISTANCE + separation * 0.42 - (knockdown ? 1.1 : 0), 6.4, 9.8);
    const height = BASE_HEIGHT + separation * 0.1 - (knockdown ? 0.35 : 0);
    const sway = reducedMotion ? 0 : Math.sin(this.swayPhase * 0.21) * 0.35;
    const drift = reducedMotion ? 0 : Math.sin(this.swayPhase * 0.13) * 0.3;

    const targetX = clampedX * 0.32 + sway;
    const targetZ = distance + clampedZ * 0.2;
    const targetY = height + drift * 0.2;

    const followRate = 2.6;
    this.current.x += (targetX - this.current.x) * (1 - Math.exp(-followRate * dt));
    this.current.y += (targetY - this.current.y) * (1 - Math.exp(-followRate * dt));
    this.current.z += (targetZ - this.current.z) * (1 - Math.exp(-followRate * dt));

    this.look.x += (clampedX - this.look.x) * (1 - Math.exp(-3.2 * dt));
    this.look.y += ((knockdown ? 0.75 : LOOK_HEIGHT) - this.look.y) * (1 - Math.exp(-3.2 * dt));
    this.look.z += (clampedZ * 0.6 - this.look.z) * (1 - Math.exp(-3.2 * dt));

    if (!reducedMotion && shake > 0.0005) {
      const t = time * 61;
      this.current.x += Math.sin(t * 1.31) * shake;
      this.current.y += Math.cos(t * 1.97) * shake * 0.6;
      this.look.x += Math.sin(t * 1.53) * shake * 0.5;
      this.look.y += Math.cos(t * 2.11) * shake * 0.35;
    }

    return { position: this.current, lookAt: this.look };
  }
}
