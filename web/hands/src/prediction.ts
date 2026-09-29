import type { FighterSnapshot, HeldDefense } from "./types";

export interface HeldInput {
  readonly moveX: number;
  readonly moveY: number;
  readonly defense: HeldDefense;
}

export interface PredictedOffset {
  readonly dx: number;
  readonly dy: number;
}

const MAX_SPEED = 7;
const GUARD_SPEED_PERCENT = 70;
const MAX_CONDITIONING = 1000;

export function fatigueFactor(conditioning: number, bodyTrauma: number): number {
  return Math.max(48, 100 - Math.floor((MAX_CONDITIONING - conditioning) / 18) - Math.floor(bodyTrauma / 35));
}

export function movementLocked(fighter: FighterSnapshot): boolean {
  return fighter.action !== null
    || fighter.is_downed
    || fighter.stunned_ticks > 0
    || fighter.clinch_ticks > 0
    || fighter.clinch_startup_ticks > 0
    || fighter.taunt_ticks > 0
    || fighter.is_foul_recovery_target
    || ["slip_left", "slip_right", "weave", "pull"].includes(fighter.defense);
}

/**
 * Mirrors the authoritative movement integrator (velocity blends halfway to
 * the held direction each tick, capped at the fatigue-scaled speed) so the
 * viewer's own fighter can be shown `ticks` ahead of the delayed snapshot.
 */
export function predictMovement(fighter: FighterSnapshot, held: HeldInput, ticks: number): PredictedOffset {
  if (ticks <= 0 || movementLocked(fighter)) return { dx: 0, dy: 0 };
  let speed = Math.max(2, Math.floor((MAX_SPEED * fatigueFactor(fighter.conditioning, fighter.trauma.body)) / 100));
  if (held.defense === "guard_high" || held.defense === "guard_low") speed = Math.max(2, Math.floor((speed * GUARD_SPEED_PERCENT) / 100));
  const magnitude = Math.hypot(held.moveX, held.moveY);
  const scale = magnitude > 1000 ? 1000 / magnitude : 1;
  const desiredX = (held.moveX * scale * speed) / 1000;
  const desiredY = (held.moveY * scale * speed) / 1000;
  let vx = fighter.velocity_x;
  let vy = fighter.velocity_y;
  let dx = 0;
  let dy = 0;
  const whole = Math.floor(ticks);
  const fraction = ticks - whole;
  for (let step = 0; step < whole; step += 1) {
    vx = (vx + desiredX) / 2;
    vy = (vy + desiredY) / 2;
    const length = Math.hypot(vx, vy);
    if (length > speed) {
      vx = (vx / length) * speed;
      vy = (vy / length) * speed;
    }
    dx += vx;
    dy += vy;
  }
  if (fraction > 0) {
    dx += ((vx + desiredX) / 2) * fraction;
    dy += ((vy + desiredY) / 2) * fraction;
  }
  return { dx, dy };
}
