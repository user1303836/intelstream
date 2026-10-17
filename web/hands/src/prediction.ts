import { comboChain, comboWindow, EVASION_STAMINA, EVASION_TICKS, FIGHTER_RADIUS, MAX_SPEED, MOVE_BLEND_PERCENT, punchTiming, RECOVERY_SPEED_PERCENT, RING_CORNER_REACH, RING_HALF_HEIGHT, RING_HALF_WIDTH, STUNNED_SPEED_PERCENT, styledStaminaCost, styleTiming, TIRED_RECOVERY_TICKS, TIRED_STARTUP_TICKS, type PunchTiming } from "./manifest";
import type { CombatEvent, DefensivePose, FighterSnapshot, Hand, HeldDefense, MovementKind, Power, PunchClass, Target } from "./types";

export interface HeldInput {
  readonly moveX: number;
  readonly moveY: number;
  readonly defense: HeldDefense;
}

export interface PredictedOffset {
  readonly dx: number;
  readonly dy: number;
}

const GUARD_SPEED_PERCENT = 70;
const MAX_CONDITIONING = 1000;
export const MINIMUM_SEPARATION = FIGHTER_RADIUS * 2;

export function fatigueFactor(conditioning: number, bodyTrauma: number): number {
  return Math.max(65, 100 - Math.floor((MAX_CONDITIONING - conditioning) / 30) - Math.floor(bodyTrauma / 50));
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
 * before it measures fatigue, at the combination discount inside the window and at the rate the
 * fighter's style tires at. A fighter who cannot pay the full cost throws a tired arm punch on what
 * stamina is left, slower still and never a combination. For a style that tires less, the engine
 * carries the fraction of a point it saves from punch to punch, which no snapshot shows; this takes
 * none, as for a fresh fighter, so it can be a point off, and in about one such punch in a hundred
 * that crosses a fatigue step and puts the timing a tick out.
 */
export function predictedPunchTiming(fighter: FighterSnapshot, punch: PunchIntent, tick?: number): PunchTiming {
  const base = punchTiming(punch.class, punch.target, punch.power);
  const style = styleTiming(fighter.style);
  const fullCost = styledStaminaCost(fighter.style, punch.class, punch.target, punch.power);
  const tired = fighter.stamina < fullCost;
  const cost = tired ? fighter.stamina : tick !== undefined && inComboWindow(fighter, punch, tick) ? Math.max(1, Math.floor((fullCost * 90) / 100)) : fullCost;
  const conditioning = Math.max(0, fighter.conditioning - Math.floor((Math.max(1, Math.floor(cost / 20)) * style.conditioningLossPercent) / 100));
  const speed = fatigueFactor(conditioning, fighter.trauma.body);
  const lead = fighter.stance === "orthodox" ? "left" : "right";
  const quick = punch.class === "jab" && punch.hand === lead ? 1 : 0;
  return {
    ...base,
    startup: Math.max(2, Math.floor((base.startup * 100) / speed) - quick + (style.startupTicks[punch.class] ?? 0)) + (tired ? TIRED_STARTUP_TICKS : 0),
    recovery: Math.max(3, Math.floor((base.recovery * 100) / speed) + (style.recoveryTicks[punch.class] ?? 0)) + (tired ? TIRED_RECOVERY_TICKS : 0),
  };
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
    || fighter.queued_actions > 0
    || heldInPlace(fighter)
    || isEvasion(fighter.defense);
}

/** What holds a fighter's feet for as long as a snapshot shows it: down, a clinch, a taunt or a foul's recovery. */
function heldInPlace(fighter: FighterSnapshot): boolean {
  return fighter.is_downed
    || fighter.clinch_ticks > 0
    || fighter.clinch_startup_ticks > 0
    || fighter.taunt_ticks > 0
    || fighter.is_foul_recovery_target;
}

/** What the engine walks toward for a held input: the velocity it blends toward each tick, and its speed cap. */
export interface MovementIntent {
  readonly x: number;
  readonly y: number;
  readonly speed: number;
  /** The share of it the player's own punch, recovering when the input reaches the server, allows (1 when none). */
  readonly share?: number;
}

/**
 * The fatigue-, guard-, stun- and style-scaled walking intent of `held` on the tick `step` ticks after
 * the snapshot, as the engine's `_move_fighter` works it out, written to `out`. The engine counts a
 * stun down before the footwork of each tick, and a stunned fighter's guard is down: he stumbles at a
 * share of his plain speed while the stun has ticks left after that.
 */
export function movementIntent(fighter: FighterSnapshot, held: HeldInput, out: { x: number; y: number; speed: number } = { x: 0, y: 0, speed: 0 }, step = 0): MovementIntent {
  const base = Math.max(2, Math.floor((MAX_SPEED * fatigueFactor(fighter.conditioning, fighter.trauma.body)) / 100));
  const stunned = fighter.stunned_ticks - step;
  let speed = base;
  if (stunned > 1) speed = Math.max(2, Math.floor((base * STUNNED_SPEED_PERCENT) / 100));
  else if (stunned <= 0 && (held.defense === "guard_high" || held.defense === "guard_low")) speed = Math.max(2, Math.floor((base * GUARD_SPEED_PERCENT) / 100));
  // The engine moves in thousandths of a unit, so a style's few percent of footspeed are kept.
  speed *= styleTiming(fighter.style).moveSpeedPercent / 100;
  const magnitude = Math.hypot(held.moveX, held.moveY);
  const scale = magnitude > 1000 ? 1000 / magnitude : 1;
  out.x = (held.moveX * scale * speed) / 1000;
  out.y = (held.moveY * scale * speed) / 1000;
  out.speed = speed;
  return out;
}

/**
 * The tick until which `playerId` stands rooted, given an event from the engine and the tick known so
 * far: a parry roots the fighter it staggers for the stagger (its `amount`), so the counter it opens
 * can land.
 */
export function parryRootedUntil(event: CombatEvent, playerId: string | null, current: number): number {
  return event.kind === "parry" && event.target_id === playerId ? Math.max(current, event.tick + event.amount) : current;
}

/** The tick the newest slip, weave or pull of `playerId` started on, given an event from the engine and the tick known so far. */
export function evasionStartedAt(event: CombatEvent, playerId: string | null, current: number | undefined): number | undefined {
  return event.kind === "defense" && event.actor_id === playerId && isEvasion(event.detail as DefensivePose) ? Math.max(current ?? event.tick, event.tick) : current;
}

/** What holds a fighter's feet that a snapshot does not show: `MovementPrediction` keeps track of it. */
export interface FootworkHolds {
  /** The tick a parry roots him until (`parryRootedUntil`). */
  readonly rootedUntil?: number;
  /** A punch he was seen stunned in: the stun cut it short, though snapshots go on presenting it. */
  readonly cutActionId?: string | null;
  /** The tick his newest slip, weave or pull started on (`evasionStartedAt`). */
  readonly evasionFrom?: number | undefined;
}

/**
 * Whether the punch the snapshot presents was cut short, though snapshots go on presenting it with its own timing: by a
 * stun, or by a slip, weave or pull that started once it had landed or missed. It holds nothing then, nor slows him.
 */
function punchCut(fighter: FighterSnapshot, holds: FootworkHolds): boolean {
  if (fighter.stunned_ticks > 0 || (fighter.action_id !== null && fighter.action_id === holds.cutActionId)) return true;
  const from = holds.evasionFrom;
  if (from === undefined || fighter.action === null) return false;
  const recovery = fighter.action_start_tick + fighter.action_startup_ticks + fighter.action_active_ticks;
  return from >= recovery && from < recovery + fighter.action_recovery_ticks;
}

/** Whether the fighter's punch is in its recovery on engine tick `at`, when the engine lets him walk at a share of his speed. */
function recovering(fighter: FighterSnapshot, at: number): boolean {
  if (fighter.action === null) return false;
  const recovery = fighter.action_start_tick + fighter.action_startup_ticks + fighter.action_active_ticks;
  return at >= recovery && at < recovery + fighter.action_recovery_ticks;
}

/**
 * Steps of the replay from snapshot `tick` that the engine holds the fighter's feet still. A punch
 * holds them through its last active tick; recovering, he walks at a share of his speed. A stun cuts
 * a punch short on the tick it lands, though snapshots go on presenting the punch with its own timing
 * for a while, so a stunned fighter is not held by one, nor afterwards by the punch a stun was seen
 * to cut. A parry roots him while its stagger lasts.
 */
function heldSteps(fighter: FighterSnapshot, tick: number, holds: FootworkHolds): number {
  const cut = punchCut(fighter, holds);
  const punch = cut || fighter.action === null ? 0 : Math.max(0, fighter.action_start_tick + fighter.action_startup_ticks + fighter.action_active_ticks - tick - 1);
  const rooted = fighter.stunned_ticks > 0 ? Math.min((holds.rootedUntil ?? 0) - tick, fighter.stunned_ticks) - 1 : 0;
  return Math.max(punch, rooted);
}

/**
 * Steps of the replay from snapshot `tick` that the slip, weave or pull the snapshot shows holds the fighter's feet:
 * the engine frees them on the tick its evasion ticks run out. Null while its start is not known, when it holds them
 * for the whole replay.
 */
function evasionSteps(fighter: FighterSnapshot, tick: number | undefined, holds: FootworkHolds): number | null {
  if (!isEvasion(fighter.defense)) return 0;
  const from = holds.evasionFrom;
  if (tick === undefined || from === undefined || from > tick) return null;
  return Math.max(0, from + EVASION_TICKS + styleTiming(fighter.style).evasionTicks - tick - 1);
}

/**
 * Steps of the replay from snapshot `tick` before a press the server holds starts and holds the feet again: it waits for
 * the punch the snapshot presents to end, or for a stun to wear off (it fires the tick after), and starts at once
 * otherwise. Infinity with nothing held. A combination cutting a landed punch's recovery short starts sooner, which the
 * input history knows of for the player's own presses.
 */
function queuedSteps(fighter: FighterSnapshot, tick: number | undefined, holds: FootworkHolds): number {
  if (fighter.queued_actions === 0) return Infinity;
  if (tick === undefined) return 0;
  if (fighter.action !== null && !punchCut(fighter, holds)) {
    const ending = fighter.action_start_tick + fighter.action_startup_ticks + fighter.action_active_ticks + fighter.action_recovery_ticks - tick - 1;
    if (ending > 0) return ending;
  }
  return Math.max(0, fighter.stunned_ticks);
}

/**
 * Mirrors the authoritative movement integrator (velocity blends toward
 * the held direction each tick, capped at the fatigue-scaled speed) so the
 * viewer's own fighter can be shown `ticks` ahead of the delayed snapshot,
 * walking toward `intent(step)` on each tick. With the snapshot `tick`, a
 * punch, an evasion or a parry's stagger only holds the fighter for the
 * ticks it has left (see `heldSteps`), so stepping out of it is predicted as
 * soon as it ends, at the punch's share of his speed while it recovers, until
 * a press the server holds starts (see `queuedSteps`).
 */
export function replayMovement(fighter: FighterSnapshot, intent: (step: number) => MovementIntent, ticks: number, tick?: number, holds: FootworkHolds = {}): PredictedOffset {
  const evading = evasionSteps(fighter, tick, holds);
  if (ticks <= 0 || heldInPlace(fighter) || evading === null) return { dx: 0, dy: 0 };
  const committed = Math.max(evading, tick === undefined ? (fighter.action !== null ? Infinity : 0) : heldSteps(fighter, tick, holds));
  // Held from the first step, he still carries what is left of his velocity for a tick or two, as the engine blends it away.
  const queued = queuedSteps(fighter, tick, holds);
  const cut = punchCut(fighter, holds);
  // The snapshot's own punch and the one the input history knows of are the same punch: their shares do not multiply.
  const share = (step: number, want: MovementIntent): number => Math.min(want.share ?? 1, tick !== undefined && !cut && recovering(fighter, tick + 1 + step) ? RECOVERY_SPEED_PERCENT / 100 : 1);
  let vx = fighter.velocity_x;
  let vy = fighter.velocity_y;
  let dx = 0;
  let dy = 0;
  const whole = Math.floor(ticks);
  const fraction = ticks - whole;
  for (let step = 0; step < whole; step += 1) {
    const free = step >= committed && step < queued;
    const want = intent(step);
    const slowed = share(step, want);
    vx = blend(vx, free ? want.x * slowed : 0);
    vy = blend(vy, free ? want.y * slowed : 0);
    const length = Math.hypot(vx, vy);
    if (length > want.speed * slowed) {
      vx = (vx / length) * want.speed * slowed;
      vy = (vy / length) * want.speed * slowed;
    }
    dx += vx;
    dy += vy;
  }
  if (fraction > 0) {
    const free = whole >= committed && whole < queued;
    const want = intent(whole);
    const slowed = share(whole, want);
    dx += blend(vx, free ? want.x * slowed : 0) * fraction;
    dy += blend(vy, free ? want.y * slowed : 0) * fraction;
  }
  return { dx, dy };
}

/** The engine's `_blend_velocity`: the share of the way to the wanted velocity covered in a tick. */
const blend = (current: number, wanted: number): number => (current * (100 - MOVE_BLEND_PERCENT) + wanted * MOVE_BLEND_PERCENT) / 100;

/** `replayMovement` with the same input held on every tick. */
export function predictMovement(fighter: FighterSnapshot, held: HeldInput, ticks: number, tick?: number, holds: FootworkHolds = {}): PredictedOffset {
  const intent = { x: 0, y: 0, speed: 0 };
  return replayMovement(fighter, (step) => movementIntent(fighter, held, intent, step), ticks, tick, holds);
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
  private readonly history: { readonly at: number; readonly held: HeldInput; readonly share: number }[] = [];
  private readonly offset = { dx: 0, dy: 0 };
  private readonly mean = { x: 0, y: 0, speed: 0, share: 1 };
  private readonly sample = { x: 0, y: 0, speed: 0 };
  private horizon: number | null = null;
  private readonly holds: { rootedUntil: number; cutActionId: string | null; evasionFrom: number | undefined } = { rootedUntil: 0, cutActionId: null, evasionFrom: undefined };

  /** Takes note of an event from the engine for the fighter `playerId` (see `parryRootedUntil` and `evasionStartedAt`). */
  observe(event: CombatEvent, playerId: string | null): void {
    this.holds.rootedUntil = parryRootedUntil(event, playerId, this.holds.rootedUntil);
    this.holds.evasionFrom = evasionStartedAt(event, playerId, this.holds.evasionFrom);
  }

  /**
   * The offset to draw `fighter`, as shown, by this frame. `held` is the input held now and `footwork`
   * the share of it the server will walk him for when it arrives: 0 while the viewer's own punch or
   * evasion holds his feet there, the recovery's share while his own punch recovers, 1 otherwise.
   * `fighter` is null outside the fight, where the offset eases away.
   */
  update(fighter: FighterSnapshot | null, held: HeldInput, footwork: number, nowMs: number, horizonTicks: number, tick: number, dt: number, tickRate: number): PredictedOffset {
    this.history.push({ at: nowMs, held: footwork <= 0 ? { ...held, moveX: 0, moveY: 0 } : held, share: footwork <= 0 ? 1 : footwork });
    while (this.history.length > 2 && this.history[1]!.at < nowMs - HELD_HISTORY_MS) this.history.shift();
    this.horizon = this.horizon === null ? horizonTicks : this.horizon + (horizonTicks - this.horizon) * (1 - Math.exp(-HORIZON_EASE_RATE * dt));
    let target: PredictedOffset = { dx: 0, dy: 0 };
    if (fighter !== null && fighter.stunned_ticks > 0 && fighter.action_id !== null) this.holds.cutActionId = fighter.action_id;
    if (fighter !== null) {
      const tickMs = 1000 / tickRate;
      const lead = this.horizon;
      // The input applied `step` ticks ahead left with a flush around `lead - 1 - step` ticks ago.
      target = replayMovement(fighter, (step) => this.meanIntent(fighter, step, nowMs - (lead - 1 - step) * tickMs, tickMs), lead, tick, this.holds);
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

  /**
   * The walking intent `step` ticks ahead, averaged over the `width` ms around `centre`, the input held
   * after now being the current one.
   */
  private meanIntent(fighter: FighterSnapshot, step: number, centre: number, width: number): MovementIntent {
    const from = centre - width / 2;
    const to = centre + width / 2;
    const mean = this.mean;
    mean.x = 0;
    mean.y = 0;
    mean.speed = 0;
    mean.share = 0;
    for (let index = 0; index < this.history.length; index += 1) {
      const start = index === 0 ? from : Math.max(from, this.history[index]!.at);
      const end = Math.min(to, this.history[index + 1]?.at ?? Infinity);
      if (end <= start) continue;
      const intent = movementIntent(fighter, this.history[index]!.held, this.sample, step);
      const weight = (end - start) / width;
      mean.x += intent.x * weight;
      mean.y += intent.y * weight;
      mean.speed += intent.speed * weight;
      mean.share += this.history[index]!.share * weight;
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

export { EVASION_STAMINA, EVASION_TICKS };

export type EvasionKind = "slip_left" | "slip_right" | "weave" | "pull";

export function isEvasion(kind: MovementKind | "punch" | "foul" | DefensivePose): kind is EvasionKind {
  return kind === "slip_left" || kind === "slip_right" || kind === "weave" || kind === "pull";
}

/**
 * The defence the viewer's own fighter is shown in during the fight: the guard held now, ahead of the
 * snapshot like his feet, or the slip, weave or pull just pressed. The server's own defence stands
 * while it overrides the held guard: none while stunned or taunting, unchanged in a clinch, and an
 * evasion it is playing, unless it is one the viewer pressed and has already seen through
 * (`hideServerEvasion`): the delayed snapshot shows it a round trip after his own did.
 */
export function predictedDefense(server: FighterSnapshot, held: HeldInput, evasion: EvasionKind | null, hideServerEvasion = false): DefensivePose {
  if (server.stunned_ticks > 0 || server.taunt_ticks > 0 || server.clinch_ticks > 0) return server.defense;
  if (evasion !== null) return evasion;
  if (isEvasion(server.defense) && !hideServerEvasion) return server.defense;
  return held.defense;
}

/**
 * A slip, weave or pull the viewer pressed, shown on the press the way his punches are: for as long as
 * the server plays it, from when the server starts it on the press's own time (at once, or once the
 * punch it cuts short has landed or missed). The server's copy of it reaches the screen a lead later
 * and is not played again. The server can turn it down: once a snapshot has the frame that carried it,
 * the fighter is evading or never will for it, and a stun, a clinch or the end of the fight phase
 * clears it.
 */
export class EvasionPrediction {
  private kind: EvasionKind | null = null;
  private id = "";
  private startsAt = 0;
  private endsAt = 0;
  private until = 0;
  private sequence: number | null = null;
  private started = false;

  /**
   * `evasionTicks` is how long the server plays it: EVASION_TICKS plus the fighter's style's own. `startMs` is when it
   * starts on the press's time, later than the press behind a punch still to land or miss.
   */
  press(kind: EvasionKind, id: string, nowMs: number, leadTicks: number, tickRate: number, evasionTicks = EVASION_TICKS, startMs = nowMs): void {
    this.kind = kind;
    this.id = id;
    this.startsAt = startMs;
    this.endsAt = startMs + (evasionTicks * 1000) / tickRate;
    this.until = this.endsAt + (Math.max(0, leadTicks) * 1000) / tickRate;
    this.sequence = null;
    this.started = false;
  }

  /**
   * Squares the pressed evasion with the newest snapshot; `sequenceOf` gives the frame that carried a press once it has gone
   * out. True when the server turned it down without starting it.
   */
  acknowledge(server: FighterSnapshot, fighting: boolean, sequenceOf: ((actionId: string) => number | null) | null): boolean {
    if (this.kind === null) return false;
    this.sequence ??= sequenceOf?.(this.id) ?? null;
    if (server.defense === this.kind) this.started = true;
    const cutOff = !fighting || server.stunned_ticks > 0 || server.clinch_ticks > 0;
    const refused = !this.started && this.sequence !== null && server.last_input_sequence >= this.sequence && server.queued_actions === 0;
    if (cutOff || refused) this.kind = null;
    return refused;
  }

  /** The evasion to show at `nowMs`, or null. */
  pose(nowMs: number): EvasionKind | null {
    if (this.kind !== null && nowMs >= this.until) this.kind = null;
    return this.kind !== null && nowMs >= this.startsAt && nowMs < this.endsAt ? this.kind : null;
  }

  /** True while the evasion the delayed snapshot shows is this one, already played here. */
  hidesServerEvasion(nowMs: number): boolean {
    return this.kind !== null && nowMs >= this.startsAt && nowMs < this.until;
  }

  /** True while the server, evading, keeps the fighter's feet still for inputs sent now. */
  holdsFeet(nowMs: number): boolean {
    return this.kind !== null && nowMs >= this.startsAt && nowMs < this.endsAt;
  }

  /**
   * A newer press takes its place in the server's buffer, unless it has started there by now (on the press's time); true
   * when one is dropped before it started.
   */
  drop(nowMs: number): boolean {
    if (this.kind === null || nowMs >= this.startsAt) return false;
    this.kind = null;
    return true;
  }
}
