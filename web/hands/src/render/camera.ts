import * as THREE from "three";

const BASE_HEIGHT = 2.05;
const BASE_DISTANCE = 5.5;
const LOOK_HEIGHT = 1.05;

export interface CameraFrame {
  readonly position: THREE.Vector3;
  readonly lookAt: THREE.Vector3;
}

/** Seconds before the bell at which the corners are cleared: the fighters stand and the crews climb out. */
export const SECONDS_OUT = 3;
export const CORNER_SHOT_LEAD_SECONDS = 2.5;
export const CORNER_SHOT_TAIL_SECONDS = SECONDS_OUT;
export const CORNER_SHOT_SECONDS = 5.5;

/** Which corner the broadcast cuts to during the rest, or null for the wide shot while the fighters walk over and before the bell. */
export function cornerShot(elapsedSeconds: number, remainingSeconds: number, firstCorner: 0 | 1): 0 | 1 | null {
  if (elapsedSeconds < CORNER_SHOT_LEAD_SECONDS || remainingSeconds < CORNER_SHOT_TAIL_SECONDS) return null;
  const segment = Math.floor((elapsedSeconds - CORNER_SHOT_LEAD_SECONDS) / CORNER_SHOT_SECONDS);
  return ((firstCorner + segment) % 2) as 0 | 1;
}

/** Seconds into the current corner shot, for its slow drift. */
export function cornerShotProgress(elapsedSeconds: number): number {
  return Math.max(0, elapsedSeconds - CORNER_SHOT_LEAD_SECONDS) % CORNER_SHOT_SECONDS;
}

export const CUTMAN_WORK_DISTANCE = 0.95;
export const CUTMAN_WORK_DEGREES = 32;
const CORNER_CAMERA_DISTANCE = 2.6;
const CORNER_CAMERA_DEGREES = -25;

/**
 * Point `distance` metres from a corner stool, swung `degrees` off the diagonal the seated fighter
 * faces (positive toward the fighter's left). `corner` is the stool's distance from centre along each axis.
 */
export function cornerPoint(index: 0 | 1, corner: number, distance: number, degrees: number, out: THREE.Vector3): THREE.Vector3 {
  const sign = index === 0 ? -1 : 1;
  const angle = (degrees * Math.PI) / 180;
  const forwardX = -sign * Math.SQRT1_2;
  const forwardZ = sign * Math.SQRT1_2;
  const x = forwardX * Math.cos(angle) + forwardZ * Math.sin(angle);
  const z = -forwardX * Math.sin(angle) + forwardZ * Math.cos(angle);
  return out.set(sign * corner + x * distance, 0, -sign * corner + z * distance);
}

/** Three-quarter shot from inside the ropes: the cutman works from the fighter's left, the camera shoots from the right. */
export function cornerFrame(index: 0 | 1, corner: number, shotSeconds: number, position: THREE.Vector3, lookAt: THREE.Vector3): void {
  const drift = Math.min(1, shotSeconds / CORNER_SHOT_SECONDS) * 5;
  cornerPoint(index, corner, CORNER_CAMERA_DISTANCE, CORNER_CAMERA_DEGREES + drift, position).setY(1.45);
  cornerPoint(index, corner, 0.62, 27, lookAt).setY(1.05);
}

/** The three at the decision, from above the raised glove down to the waist. */
const CEREMONY_SUBJECT = { top: 2.42, bottom: 0.95, width: 2.4 } as const;

/**
 * Frames the announcement in the part of the screen the result card leaves free: how far back the
 * camera stands and the height it looks at. `covered` is the share of the screen's height under the
 * card and `clear` the share under the top bar.
 */
export function ceremonyShot(aspect: number, fovDegrees: number, covered: number, clear = 0.09): { distance: number; height: number } {
  const free = Math.max(0.2, 1 - covered - clear);
  const span = Math.max((CEREMONY_SUBJECT.top - CEREMONY_SUBJECT.bottom) / free, CEREMONY_SUBJECT.width / Math.max(0.1, aspect));
  const middle = (CEREMONY_SUBJECT.top + CEREMONY_SUBJECT.bottom) / 2;
  return {
    distance: span / (2 * Math.tan(THREE.MathUtils.degToRad(fovDegrees) / 2)),
    height: middle - (0.5 - (clear + free / 2)) * span,
  };
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

    const distance = THREE.MathUtils.clamp(BASE_DISTANCE + separation * 0.6 - (knockdown ? 0.9 : 0), 4.6, 8.4);
    const height = BASE_HEIGHT + separation * 0.08 - (knockdown ? 0.45 : 0);
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
    this.look.y += ((knockdown ? 0.7 : LOOK_HEIGHT) - this.look.y) * (1 - Math.exp(-3.2 * dt));
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
