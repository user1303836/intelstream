import { punchStaminaCost, punchTiming, type PunchTiming } from "./manifest";
import type { FighterSnapshot, Hand, HeldDefense, Power, PunchClass, Target } from "./types";

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

export interface PunchIntent {
  readonly class: PunchClass;
  readonly hand: Hand;
  readonly target: Target;
  readonly power: Power;
}

/** The timing the engine will give this punch: slower for a tired fighter, a tick quicker for the lead-hand jab. */
export function predictedPunchTiming(fighter: FighterSnapshot, punch: PunchIntent): PunchTiming {
  const base = punchTiming(punch.class, punch.target, punch.power);
  const speed = fatigueFactor(fighter.conditioning, fighter.trauma.body);
  const lead = fighter.stance === "orthodox" ? "left" : "right";
  const quick = punch.class === "jab" && punch.hand === lead ? 1 : 0;
  return {
    ...base,
    startup: Math.max(2, Math.floor((base.startup * 100) / speed) - quick),
    recovery: Math.max(4, Math.floor((base.recovery * 100) / speed)),
  };
}

/** False when the fighter cannot pay for the punch even at the combo discount, so the engine will turn it down. */
export function canAffordPunch(fighter: FighterSnapshot, punch: PunchIntent): boolean {
  const cost = punchStaminaCost(punch.class, punch.target, punch.power);
  return fighter.stamina >= Math.max(1, Math.floor((cost * 90) / 100));
}

/**
 * Ticks until the fighter's punch ends, as of snapshot `tick`. The engine keeps a finished punch in
 * snapshots for a while so clients can present it, so `action` alone does not mean the fighter is
 * still committed to it.
 */
export function attackTicksRemaining(fighter: FighterSnapshot, tick: number): number {
  if (fighter.action === null) return 0;
  const end = fighter.action_start_tick + fighter.action_startup_ticks + fighter.action_active_ticks + fighter.action_recovery_ticks;
  return Math.max(0, end - tick);
}

export function movementLocked(fighter: FighterSnapshot, tick?: number): boolean {
  return (tick === undefined ? fighter.action !== null : attackTicksRemaining(fighter, tick) > 0)
    || stateLocked(fighter);
}

function stateLocked(fighter: FighterSnapshot): boolean {
  // A queued punch starts the tick the current one ends, so the fighter is never free in between.
  return fighter.queued_actions > 0
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
 * With the snapshot `tick`, a punch only holds the fighter for the ticks it
 * has left, so stepping out of a punch is predicted as soon as it ends.
 */
export function predictMovement(fighter: FighterSnapshot, held: HeldInput, ticks: number, tick?: number): PredictedOffset {
  if (ticks <= 0 || stateLocked(fighter)) return { dx: 0, dy: 0 };
  const committed = tick === undefined ? (fighter.action !== null ? Infinity : 0) : attackTicksRemaining(fighter, tick);
  if (committed >= ticks) return { dx: 0, dy: 0 };
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
    const free = step >= committed;
    vx = (vx + (free ? desiredX : 0)) / 2;
    vy = (vy + (free ? desiredY : 0)) / 2;
    const length = Math.hypot(vx, vy);
    if (length > speed) {
      vx = (vx / length) * speed;
      vy = (vy / length) * speed;
    }
    dx += vx;
    dy += vy;
  }
  if (fraction > 0) {
    const free = whole >= committed;
    dx += ((vx + (free ? desiredX : 0)) / 2) * fraction;
    dy += ((vy + (free ? desiredY : 0)) / 2) * fraction;
  }
  return { dx, dy };
}
