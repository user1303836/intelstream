import * as THREE from "three";

const BASE_HEIGHT = 2.05;
const BASE_DISTANCE = 5.5;
const LOOK_HEIGHT = 1.05;
const CLOSE_HEIGHT = 1.78;
const CLOSE_DISTANCE = 3.75;
/** How far over a count the shot moves from between the fighters to the one on the canvas, and how low it looks. */
const DOWNED_FOCUS = 0.85;
const DOWNED_LOOK_HEIGHT = 0.45;
const CLOSE_LOOK_HEIGHT = 1.18;

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
    close = false,
    downed: { readonly x: number; readonly z: number } | null = null,
  ): CameraFrame {
    this.swayPhase += dt;
    // Over a count the shot centres on the man on the canvas, not on the gap between the two, where he
    // would lie along the bottom of the picture behind the plates.
    const onCanvas = knockdown && downed !== null ? DOWNED_FOCUS : 0;
    const midX = (fighterA.x + fighterB.x) / 2 + ((downed?.x ?? 0) - (fighterA.x + fighterB.x) / 2) * onCanvas;
    const midZ = (fighterA.z + fighterB.z) / 2 + ((downed?.z ?? 0) - (fighterA.z + fighterB.z) / 2) * onCanvas;
    const clampedX = THREE.MathUtils.clamp(midX, -1.4, 1.4);
    const clampedZ = THREE.MathUtils.clamp(midZ, -1.1, 1.1);

    const distance = close
      ? THREE.MathUtils.clamp(CLOSE_DISTANCE + separation * 0.45 - (knockdown ? 0.6 : 0), 3.3, 5.6)
      : THREE.MathUtils.clamp(BASE_DISTANCE + separation * 0.6 - (knockdown ? 0.9 : 0), 4.6, 8.4);
    const height = (close ? CLOSE_HEIGHT : BASE_HEIGHT) + separation * 0.08 - (knockdown ? 0.45 : 0);
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
    this.look.y += ((knockdown ? (onCanvas > 0 ? DOWNED_LOOK_HEIGHT : 0.7) : close ? CLOSE_LOOK_HEIGHT : LOOK_HEIGHT) - this.look.y) * (1 - Math.exp(-3.2 * dt));
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

const FIGHTER_CAM_DISTANCE = 2.45;
/** Degrees round from straight behind the fighter toward his right: wider when the two are chest to chest. */
export const FIGHTER_CAM_ORBIT = 31;
export const FIGHTER_CAM_CLOSE_ORBIT = 60;
const FIGHTER_CAM_HEIGHT = 2.25;
const FIGHTER_CAM_LOOK_HEIGHT = 1.35;
/** Over the apron at most (it ends at 3.85 m): the camera stands high enough there to look over the top rope (1.26 m). */
export const FIGHTER_CAM_LIMIT = 3.5;
export const FIGHTER_CAM_FOV_SCALE = 1.25;
/** On a screen narrower than it is tall the orbit shrinks with the aspect, to no less than this share of it. */
const FIGHTER_CAM_NARROW_ORBIT = 0.45;

/**
 * Where the over-the-shoulder camera stands: behind the player's own fighter and `orbitDegrees`
 * round toward his right shoulder, `forward` being the unit direction he looks along the canvas,
 * aimed at the opponent.
 */
export function fighterCamFrame(
  viewer: { x: number; z: number },
  opponent: { x: number; z: number },
  forwardX: number,
  forwardZ: number,
  position: THREE.Vector3,
  lookAt: THREE.Vector3,
  orbitDegrees = FIGHTER_CAM_ORBIT,
): void {
  const orbit = THREE.MathUtils.degToRad(orbitDegrees);
  const back = Math.cos(orbit) * FIGHTER_CAM_DISTANCE;
  const side = Math.sin(orbit) * FIGHTER_CAM_DISTANCE;
  const rightX = -forwardZ;
  const rightZ = forwardX;
  const offsetX = -forwardX * back + rightX * side;
  const offsetZ = -forwardZ * back + rightZ * side;
  // Short of room behind him, the camera comes in along the same line rather than sliding round to his side.
  const room = (from: number, offset: number): number => Math.abs(offset) < 1e-9 ? 1 : THREE.MathUtils.clamp((Math.sign(offset) * FIGHTER_CAM_LIMIT - from) / offset, 0, 1);
  const reach = Math.min(room(viewer.x, offsetX), room(viewer.z, offsetZ));
  position.set(
    THREE.MathUtils.clamp(viewer.x + offsetX * reach, -FIGHTER_CAM_LIMIT, FIGHTER_CAM_LIMIT),
    FIGHTER_CAM_HEIGHT,
    THREE.MathUtils.clamp(viewer.z + offsetZ * reach, -FIGHTER_CAM_LIMIT, FIGHTER_CAM_LIMIT),
  );
  lookAt.set(opponent.x, FIGHTER_CAM_LOOK_HEIGHT, opponent.z);
}

/** The player's own view of the fight: it turns with him toward the opponent, a beat behind. */
export class FighterCam {
  private angle = Math.PI;
  private closeness = 0;
  private initialised = false;
  private readonly target = new THREE.Vector3();
  private readonly position = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly aim = new THREE.Vector3();

  /** Unit direction the camera looks along the canvas (world x and z). */
  get forwardX(): number { return Math.sin(this.angle); }
  get forwardZ(): number { return Math.cos(this.angle); }

  reset(): void { this.initialised = false; }

  /**
   * `aspect` is the screen's width over its height. A phone held upright sees too little to the sides for
   * the orbit, so the camera comes round behind his back until he and the opponent fit across it.
   */
  update(dt: number, time: number, viewer: { x: number; z: number }, opponent: { x: number; z: number }, shake: number, reducedMotion: boolean, aspect = 16 / 9): CameraFrame & { tight: true } {
    const dx = opponent.x - viewer.x;
    const dz = opponent.z - viewer.z;
    const apart = Math.hypot(dx, dz);
    const wanted = apart > 0.05 ? Math.atan2(dx, dz) : this.angle;
    const closeness = THREE.MathUtils.clamp((1.3 - apart) / 0.8, 0, 1);
    if (!this.initialised) {
      this.angle = wanted;
      this.closeness = closeness;
    } else {
      const turn = Math.atan2(Math.sin(wanted - this.angle), Math.cos(wanted - this.angle));
      this.angle += turn * (1 - Math.exp(-4.5 * dt));
      this.closeness += (closeness - this.closeness) * (1 - Math.exp(-3 * dt));
    }
    const narrow = THREE.MathUtils.clamp(aspect, FIGHTER_CAM_NARROW_ORBIT, 1);
    fighterCamFrame(viewer, opponent, this.forwardX, this.forwardZ, this.target, this.aim, THREE.MathUtils.lerp(FIGHTER_CAM_ORBIT, FIGHTER_CAM_CLOSE_ORBIT, this.closeness) * narrow);
    if (!this.initialised) {
      this.position.copy(this.target);
      this.look.copy(this.aim);
      this.initialised = true;
    } else {
      const follow = 1 - Math.exp(-10 * dt);
      this.position.lerp(this.target, follow);
      this.look.lerp(this.aim, follow);
    }
    const frame = { position: this.position, lookAt: this.look, tight: true as const };
    if (reducedMotion || shake <= 0.0005) return frame;
    const t = time * 61;
    this.target.set(this.position.x + Math.sin(t * 1.31) * shake, this.position.y + Math.cos(t * 1.97) * shake * 0.6, this.position.z);
    this.aim.set(this.look.x + Math.sin(t * 1.53) * shake * 0.5, this.look.y + Math.cos(t * 2.11) * shake * 0.35, this.look.z);
    return { position: this.target, lookAt: this.aim, tight: true };
  }
}
