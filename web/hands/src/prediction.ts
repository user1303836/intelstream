import { comboChain, comboWindow, FIGHTER_RADIUS, punchStaminaCost, punchTiming, RING_CORNER_REACH, RING_HALF_HEIGHT, RING_HALF_WIDTH, type PunchTiming } from "./manifest";
import type { DefensivePose, FighterSnapshot, Hand, HeldDefense, MovementKind, Power, PunchClass, Target } from "./types";

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
export const MINIMUM_SEPARATION = FIGHTER_RADIUS * 2;

export function fatigueFactor(conditioning: number, bodyTrauma: number): number {
  return Math.max(48, 100 - Math.floor((MAX_CONDITIONING - conditioning) / 18) - Math.floor(bodyTrauma / 35));
}

export interface PunchIntent {
  readonly class: PunchClass;
  readonly hand: Hand;
  readonly target: Target;
  readonly power: Power;
}

/** Whether a punch started at `tick` follows the fighter's last one inside its combination window. */
export function inComboWindow(fighter: FighterSnapshot, punch: PunchIntent, tick: number): boolean {
  if (fighter.action === null || !comboChain(fighter.action, punch.class)) return false;
  const total = fighter.action_startup_ticks + fighter.action_active_ticks + fighter.action_recovery_ticks;
  return tick - fighter.action_start_tick < total + comboWindow(fighter.action);
}

/**
 * The timing the engine will give this punch if it starts at `tick`: slower for a tired fighter, a
 * tick quicker for the lead-hand jab. The engine takes the punch's own cost off the conditioning
 * before it measures fatigue, at the combination discount inside the window.
 */
export function predictedPunchTiming(fighter: FighterSnapshot, punch: PunchIntent, tick?: number): PunchTiming {
  const base = punchTiming(punch.class, punch.target, punch.power);
  const fullCost = punchStaminaCost(punch.class, punch.target, punch.power);
  const cost = tick !== undefined && inComboWindow(fighter, punch, tick) ? Math.max(1, Math.floor((fullCost * 90) / 100)) : fullCost;
  const conditioning = Math.max(0, fighter.conditioning - Math.max(1, Math.floor(cost / 12)));
  const speed = fatigueFactor(conditioning, fighter.trauma.body);
  const lead = fighter.stance === "orthodox" ? "left" : "right";
  const quick = punch.class === "jab" && punch.hand === lead ? 1 : 0;
  return {
    ...base,
    startup: Math.max(2, Math.floor((base.startup * 100) / speed) - quick),
    recovery: Math.max(4, Math.floor((base.recovery * 100) / speed)),
  };
}

/** False when the fighter cannot pay the punch's full cost: the engine checks it before any combo discount. */
export function canAffordPunch(fighter: FighterSnapshot, punch: PunchIntent): boolean {
  return fighter.stamina >= punchStaminaCost(punch.class, punch.target, punch.power);
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

/** What the engine walks toward for a held input: the velocity it blends halfway to each tick, and its speed cap. */
export interface MovementIntent {
  readonly x: number;
  readonly y: number;
  readonly speed: number;
}

/** The fatigue- and guard-scaled walking intent of `held`, as the engine's `_move_fighter` works it out, written to `out`. */
export function movementIntent(fighter: FighterSnapshot, held: HeldInput, out: { x: number; y: number; speed: number } = { x: 0, y: 0, speed: 0 }): MovementIntent {
  let speed = Math.max(2, Math.floor((MAX_SPEED * fatigueFactor(fighter.conditioning, fighter.trauma.body)) / 100));
  if (held.defense === "guard_high" || held.defense === "guard_low") speed = Math.max(2, Math.floor((speed * GUARD_SPEED_PERCENT) / 100));
  const magnitude = Math.hypot(held.moveX, held.moveY);
  const scale = magnitude > 1000 ? 1000 / magnitude : 1;
  out.x = (held.moveX * scale * speed) / 1000;
  out.y = (held.moveY * scale * speed) / 1000;
  out.speed = speed;
  return out;
}

/**
 * Mirrors the authoritative movement integrator (velocity blends halfway to
 * the held direction each tick, capped at the fatigue-scaled speed) so the
 * viewer's own fighter can be shown `ticks` ahead of the delayed snapshot,
 * walking toward `intent(step)` on each tick. With the snapshot `tick`, a
 * punch only holds the fighter for the ticks it has left, so stepping out of
 * a punch is predicted as soon as it ends.
 */
export function replayMovement(fighter: FighterSnapshot, intent: (step: number) => MovementIntent, ticks: number, tick?: number): PredictedOffset {
  if (ticks <= 0 || stateLocked(fighter)) return { dx: 0, dy: 0 };
  const committed = tick === undefined ? (fighter.action !== null ? Infinity : 0) : attackTicksRemaining(fighter, tick);
  if (committed >= ticks) return { dx: 0, dy: 0 };
  let vx = fighter.velocity_x;
  let vy = fighter.velocity_y;
  let dx = 0;
  let dy = 0;
  const whole = Math.floor(ticks);
  const fraction = ticks - whole;
  for (let step = 0; step < whole; step += 1) {
    const free = step >= committed;
    const want = intent(step);
    vx = (vx + (free ? want.x : 0)) / 2;
    vy = (vy + (free ? want.y : 0)) / 2;
    const length = Math.hypot(vx, vy);
    if (length > want.speed) {
      vx = (vx / length) * want.speed;
      vy = (vy / length) * want.speed;
    }
    dx += vx;
    dy += vy;
  }
  if (fraction > 0) {
    const free = whole >= committed;
    const want = intent(whole);
    dx += ((vx + (free ? want.x : 0)) / 2) * fraction;
    dy += ((vy + (free ? want.y : 0)) / 2) * fraction;
  }
  return { dx, dy };
}

/** `replayMovement` with the same input held on every tick. */
export function predictMovement(fighter: FighterSnapshot, held: HeldInput, ticks: number, tick?: number): PredictedOffset {
  const intent = movementIntent(fighter, held);
  return replayMovement(fighter, () => intent, ticks, tick);
}

/** Held input kept for replay, longer than any lead the renderer works with. */
const HELD_HISTORY_MS = 1000;
/** The prediction offset may move at most this many times the top walking speed: real motion is never slowed, a correction slides. */
const OFFSET_SPEED_LIMIT = 2.5;
/** Rate at which the lead eases to a new estimate of the latency or the interpolation delay. */
const HORIZON_EASE_RATE = 4;

/**
 * Keeps the viewer's own fighter ahead of the delayed snapshot on screen by the input latency plus
 * the interpolation delay. That far ahead the server is still applying inputs held in the past, so
 * rather than assume the current one was held all along, each tick ahead replays the input the
 * server applies at that tick: the one a flush sent a lead earlier. The fighter then sets off on the
 * press and stops on the release instead of stepping, stalling and overshooting.
 */
export class MovementPrediction {
  private readonly history: { readonly at: number; readonly held: HeldInput }[] = [];
  private readonly offset = { dx: 0, dy: 0 };
  private readonly mean = { x: 0, y: 0, speed: 0 };
  private readonly sample = { x: 0, y: 0, speed: 0 };
  private horizon: number | null = null;

  /**
   * The offset to draw `fighter`, as shown, by this frame. `held` is the input held now; with
   * `holdFeet` (the viewer's own punch playing) the server will not walk him for it. `fighter` is
   * null outside the fight, where the offset eases away.
   */
  update(fighter: FighterSnapshot | null, held: HeldInput, holdFeet: boolean, nowMs: number, horizonTicks: number, tick: number, dt: number, tickRate: number): PredictedOffset {
    this.history.push({ at: nowMs, held: holdFeet ? { ...held, moveX: 0, moveY: 0 } : held });
    while (this.history.length > 2 && this.history[1]!.at < nowMs - HELD_HISTORY_MS) this.history.shift();
    this.horizon = this.horizon === null ? horizonTicks : this.horizon + (horizonTicks - this.horizon) * (1 - Math.exp(-HORIZON_EASE_RATE * dt));
    let target: PredictedOffset = { dx: 0, dy: 0 };
    if (fighter !== null) {
      const tickMs = 1000 / tickRate;
      const lead = this.horizon;
      // The input applied `step` ticks ahead left with a flush around `lead - 1 - step` ticks ago.
      target = replayMovement(fighter, (step) => this.meanIntent(fighter, nowMs - (lead - 1 - step) * tickMs, tickMs), lead, tick);
    }
    const limit = OFFSET_SPEED_LIMIT * MAX_SPEED * tickRate * dt;
    const changeX = target.dx - this.offset.dx;
    const changeY = target.dy - this.offset.dy;
    const change = Math.hypot(changeX, changeY);
    const scale = change > limit ? limit / change : 1;
    this.offset.dx += changeX * scale;
    this.offset.dy += changeY * scale;
    return { dx: this.offset.dx, dy: this.offset.dy };
  }

  /** The walking intent averaged over the `width` ms around `centre`, the input held after now being the current one. */
  private meanIntent(fighter: FighterSnapshot, centre: number, width: number): MovementIntent {
    const from = centre - width / 2;
    const to = centre + width / 2;
    const mean = this.mean;
    mean.x = 0;
    mean.y = 0;
    mean.speed = 0;
    for (let index = 0; index < this.history.length; index += 1) {
      const start = index === 0 ? from : Math.max(from, this.history[index]!.at);
      const end = Math.min(to, this.history[index + 1]?.at ?? Infinity);
      if (end <= start) continue;
      const intent = movementIntent(fighter, this.history[index]!.held, this.sample);
      const weight = (end - start) / width;
      mean.x += intent.x * weight;
      mean.y += intent.y * weight;
      mean.speed += intent.speed * weight;
    }
    return mean;
  }
}

/** The nearest point inside the ropes and corner pads, the engine's ring projection without its integer rounding. */
export function ringPoint(x: number, y: number): { x: number; y: number } {
  const limitX = RING_HALF_WIDTH - FIGHTER_RADIUS;
  const limitY = RING_HALF_HEIGHT - FIGHTER_RADIUS;
  const signX = x < 0 ? -1 : 1;
  const signY = y < 0 ? -1 : 1;
  const reachX = Math.abs(x);
  const reachY = Math.abs(y);
  const insideX = Math.min(reachX, limitX);
  const insideY = Math.min(reachY, limitY);
  if (insideX + insideY <= RING_CORNER_REACH) return { x: signX * insideX, y: signY * insideY };
  const excess = reachX + reachY - RING_CORNER_REACH;
  const cutX = reachX - excess / 2;
  const cutY = reachY - excess / 2;
  if (cutY > limitY) return { x: signX * (RING_CORNER_REACH - limitY), y: signY * limitY };
  if (cutX > limitX) return { x: signX * limitX, y: signY * (RING_CORNER_REACH - limitX) };
  return { x: signX * cutX, y: signY * cutY };
}

/**
 * Keeps a predicted step where the engine can put the fighter: inside the ropes and corner pads, and
 * no nearer the opponent than the engine's minimum separation (or than they already stand, in a clinch).
 */
export function constrainPrediction(fighter: { readonly x: number; readonly y: number }, offset: PredictedOffset, opponent: { readonly x: number; readonly y: number } | null): PredictedOffset {
  let x = fighter.x + offset.dx;
  let y = fighter.y + offset.dy;
  if (opponent !== null) {
    const limit = Math.min(MINIMUM_SEPARATION, Math.hypot(fighter.x - opponent.x, fighter.y - opponent.y));
    const awayX = x - opponent.x;
    const awayY = y - opponent.y;
    const apart = Math.hypot(awayX, awayY);
    if (apart < limit) {
      if (apart > 1e-9) {
        x = opponent.x + (awayX / apart) * limit;
        y = opponent.y + (awayY / apart) * limit;
      } else {
        x = fighter.x;
        y = fighter.y;
      }
    }
  }
  const inside = ringPoint(x, y);
  return { dx: inside.x - fighter.x, dy: inside.y - fighter.y };
}

/** Ticks a slip, weave or pull lasts on the server (the engine's EVASION_TICKS). */
export const EVASION_TICKS = 10;
/** Stamina the server asks of a slip, weave or pull before it starts one. */
export const EVASION_STAMINA = 25;

export type EvasionKind = "slip_left" | "slip_right" | "weave" | "pull";

export function isEvasion(kind: MovementKind | "punch" | "foul" | DefensivePose): kind is EvasionKind {
  return kind === "slip_left" || kind === "slip_right" || kind === "weave" || kind === "pull";
}

/**
 * The defence the viewer's own fighter is shown in during the fight: the guard held now, ahead of the
 * snapshot like his feet, or the slip, weave or pull just pressed. The server's own defence stands
 * while it overrides the held guard: none while stunned or taunting, unchanged in a clinch, and an
 * evasion it is playing.
 */
export function predictedDefense(server: FighterSnapshot, held: HeldInput, evasion: EvasionKind | null): DefensivePose {
  if (server.stunned_ticks > 0 || server.taunt_ticks > 0 || server.clinch_ticks > 0) return server.defense;
  if (evasion !== null) return evasion;
  if (isEvasion(server.defense)) return server.defense;
  return held.defense;
}

/**
 * A slip, weave or pull the viewer pressed, shown on the press the way his punches are. It lasts the
 * lead plus its own ticks, so it ends as the server's copy does on screen, unless the server turns it
 * down: once a snapshot has the frame that carried it, the fighter is evading or never will for it, and
 * a stun, a clinch or the end of the fight phase clears it.
 */
export class EvasionPrediction {
  private kind: EvasionKind | null = null;
  private id = "";
  private pressedAt = 0;
  private until = 0;
  private sequence: number | null = null;
  private started = false;

  press(kind: EvasionKind, id: string, nowMs: number, leadTicks: number, tickRate: number): void {
    this.kind = kind;
    this.id = id;
    this.pressedAt = nowMs;
    this.until = nowMs + ((Math.max(0, leadTicks) + EVASION_TICKS) * 1000) / tickRate;
    this.sequence = null;
    this.started = false;
  }

  /** Squares the pressed evasion with the newest snapshot; `sequenceOf` gives the frame that carried a press once it has gone out. */
  acknowledge(server: FighterSnapshot, fighting: boolean, sequenceOf: ((actionId: string) => number | null) | null): void {
    if (this.kind === null) return;
    this.sequence ??= sequenceOf?.(this.id) ?? null;
    if (server.defense === this.kind) this.started = true;
    const cutOff = !fighting || server.stunned_ticks > 0 || server.clinch_ticks > 0;
    const refused = !this.started && this.sequence !== null && server.last_input_sequence >= this.sequence && server.queued_actions === 0;
    if (cutOff || refused) this.kind = null;
  }

  /** The evasion to show at `nowMs`, or null. */
  pose(nowMs: number): EvasionKind | null {
    if (this.kind !== null && nowMs >= this.until) this.kind = null;
    return this.kind;
  }

  /** True while the server, evading, keeps the fighter's feet still for inputs sent now. */
  holdsFeet(nowMs: number, tickRate: number): boolean {
    return this.kind !== null && nowMs < this.pressedAt + (EVASION_TICKS * 1000) / tickRate;
  }
}
