import manifestJson from "../../../src/intelstream/hands/combat-manifest.json";
import type { FighterStyle, Hand, Power, PunchClass, Target } from "./types";

export interface PunchTiming {
  readonly startup: number;
  readonly active: number;
  readonly recovery: number;
  readonly reach: number;
  readonly lateralArc: number;
}

interface ManifestVariant {
  readonly startup_add?: number;
  readonly active_add?: number;
  readonly recovery_add?: number;
  readonly reach_add?: number;
  readonly reach_min?: number;
  readonly reach_sub?: number;
  readonly lateral_arc_add?: number;
  readonly stamina_cost_add?: number;
  readonly stamina_cost_mul_num?: number;
  readonly stamina_cost_mul_den?: number;
}

interface ManifestPunch {
  readonly startup: number;
  readonly active: number;
  readonly recovery: number;
  readonly reach: number;
  readonly lateral_arc: number;
  readonly stamina_cost: number;
  readonly combo_window: number;
}

const punches = manifestJson.punches as unknown as Record<PunchClass, ManifestPunch>;
const variants = manifestJson.variants as unknown as Record<"body" | "power", ManifestVariant>;

export const TICK_RATE = manifestJson.tick_rate;
export const ACTION_BUFFER_TICKS = manifestJson.action_buffer_ticks;
export const HITSTOP_MS = manifestJson.hitstop_ms;
export const HURTBOXES = manifestJson.hurtboxes;
export const GLOVE_HITBOX_RADIUS = manifestJson.hitbox.glove_radius;
export const FATIGUE_SCALING = manifestJson.fatigue_scaling;
export const REST_CORNER_OFFSET = manifestJson.rest.corner_offset;
export const RING_HALF_WIDTH = manifestJson.ring.half_width;
export const RING_HALF_HEIGHT = manifestJson.ring.half_height;
export const FIGHTER_RADIUS = manifestJson.ring.fighter_radius;
/** Eye trauma at which the eye is swollen shut and punches from that side go unseen. */
export const EYE_SHUT_TRAUMA = manifestJson.blind_side.eye_threshold;
export const CORNER_TREATMENTS = manifestJson.corner;
export const RING_CORNER_REACH = manifestJson.corners.reach;
/** Percent of a punch's recovery that must pass before a chained follow-up may cut the rest of it short. */
export const RECOVERY_CANCEL_PERCENT = manifestJson.combos.recovery_cancel_percent;
const comboChains = new Set(manifestJson.combos.chains.map(([first, second]) => `${first}:${second}`));

/** Whether the engine counts `second` straight after `first` as a combination. */
export function comboChain(first: PunchClass, second: PunchClass): boolean {
  return comboChains.has(`${first}:${second}`);
}

/** Age from which a punch's recovery may give way to a follow-up: the engine's `cancel_age`. */
export function recoveryCancelAge(timing: Pick<PunchTiming, "startup" | "active" | "recovery">): number {
  return timing.startup + timing.active + Math.floor((timing.recovery * RECOVERY_CANCEL_PERCENT) / 100);
}

/**
 * The engine's `_can_cancel_recovery` for a punch past its `recoveryCancelAge`: the follow-up waiting
 * on it starts at once only if the punch landed (a hit or an ordinary block, not a whiff, an evade or a
 * parry), the two form a combination, the fighter can pay the follow-up's full cost at his style's price
 * (a punch he cannot is a tired one, and no combination) and the defender is not stunned. Otherwise the
 * follow-up starts the tick after the punch ends.
 */
export function cancelsRecovery(
  punch: PunchClass,
  landed: boolean,
  followUp: { readonly class: PunchClass; readonly target: Target; readonly power: Power },
  stamina: number,
  defenderStunned: boolean,
  style: FighterStyle = "balanced",
): boolean {
  return landed
    && !defenderStunned
    && comboChain(punch, followUp.class)
    && stamina >= styledStaminaCost(style, followUp.class, followUp.target, followUp.power);
}

/** Ticks after a punch ends during which a compatible follow-up still counts as a combination. */
export function comboWindow(punchClass: PunchClass): number {
  return punches[punchClass].combo_window;
}

/** A stun this long or longer is a fighter rocked by a big shot rather than a flinch. */
export const ROCKED_BASE_TICKS = manifestJson.stun.rocked_base_ticks;
export const ROCKED_MAX_TICKS = manifestJson.stun.rocked_max_ticks;
const knockdownRules = manifestJson.knockdown;
/** The engine caps head trauma here and stops a bout at the third knockdown. */
const HEAD_TRAUMA_LIMIT = 1400;
const KNOCKDOWN_LIMIT = 3;
/** The fewest get-up presses the engine asks for, and the most: three knockdowns on a head beaten to the cap. */
export const GET_UP_REQUIRED_MIN = knockdownRules.get_up_base;
export const GET_UP_REQUIRED_MAX = knockdownRules.get_up_base + KNOCKDOWN_LIMIT * knockdownRules.get_up_per_knockdown + Math.floor(HEAD_TRAUMA_LIMIT / knockdownRules.get_up_trauma_divisor);
/** A stunned fighter's footwork, as a share of his speed. */
export const STUNNED_SPEED_PERCENT = manifestJson.stun.moving_speed_percent;
/** A punch the fighter cannot pay for in full is thrown tired: this much slower to land and to recover. */
export const TIRED_STARTUP_TICKS = manifestJson.tired.startup_ticks;
export const TIRED_RECOVERY_TICKS = manifestJson.tired.recovery_ticks;

export function punchTiming(punchClass: PunchClass, target: Target, power: Power): PunchTiming {
  const base = punches[punchClass];
  let startup = base.startup;
  let active = base.active;
  let recovery = base.recovery;
  let reach = base.reach;
  let lateralArc = base.lateral_arc;
  if (target === "body") {
    const body = variants.body;
    startup += body.startup_add ?? 0;
    recovery += body.recovery_add ?? 0;
    reach = Math.max(body.reach_min ?? 0, reach - (body.reach_sub ?? 0));
    lateralArc += body.lateral_arc_add ?? 0;
  }
  if (power === "power") {
    const powerVariant = variants.power;
    startup += powerVariant.startup_add ?? 0;
    active += powerVariant.active_add ?? 0;
    recovery += powerVariant.recovery_add ?? 0;
    reach += powerVariant.reach_add ?? 0;
  }
  return { startup, active, recovery, reach, lateralArc };
}

/** Stamina the engine charges to start this punch, before any combo discount. */
export function punchStaminaCost(punchClass: PunchClass, target: Target, power: Power): number {
  let cost = punches[punchClass].stamina_cost;
  if (target === "body") cost += variants.body.stamina_cost_add ?? 0;
  if (power === "power") cost = Math.floor((cost * (variants.power.stamina_cost_mul_num ?? 1)) / (variants.power.stamina_cost_mul_den ?? 1));
  return cost;
}

interface ManifestStyle {
  readonly startup_ticks?: Partial<Record<PunchClass, number>>;
  readonly recovery_ticks?: Partial<Record<PunchClass, number>>;
  readonly stamina_cost_percent?: number;
  readonly conditioning_loss_percent?: number;
  readonly move_speed_percent?: number;
  readonly evasion_ticks?: number;
}

/** What the client needs of a style to predict the player's own punches, evasions and footwork as the engine will. */
export interface StyleTiming {
  readonly startupTicks: Readonly<Partial<Record<PunchClass, number>>>;
  readonly recoveryTicks: Readonly<Partial<Record<PunchClass, number>>>;
  readonly staminaCostPercent: number;
  readonly conditioningLossPercent: number;
  readonly moveSpeedPercent: number;
  /** Ticks a slip, weave or pull lasts beyond the engine's EVASION_TICKS. */
  readonly evasionTicks: number;
}

const styles = manifestJson.styles as unknown as Record<FighterStyle, ManifestStyle>;
/** Built once per style: the prediction asks for it many times a frame. */
const styleTimings = new Map<FighterStyle, StyleTiming>();

export function styleTiming(style: FighterStyle): StyleTiming {
  const known = styleTimings.get(style);
  if (known !== undefined) return known;
  const raw = styles[style] ?? {};
  const timing: StyleTiming = {
    startupTicks: raw.startup_ticks ?? {},
    recoveryTicks: raw.recovery_ticks ?? {},
    staminaCostPercent: raw.stamina_cost_percent ?? 100,
    conditioningLossPercent: raw.conditioning_loss_percent ?? 100,
    moveSpeedPercent: raw.move_speed_percent ?? 100,
    evasionTicks: raw.evasion_ticks ?? 0,
  };
  styleTimings.set(style, timing);
  return timing;
}

/** The stamina a fighter of `style` is charged for the punch, before any combo discount. */
export function styledStaminaCost(style: FighterStyle, punchClass: PunchClass, target: Target, power: Power): number {
  return Math.floor((punchStaminaCost(punchClass, target, power) * styleTiming(style).staminaCostPercent) / 100);
}

export function actionKey(punchClass: PunchClass, hand: Hand, target: Target, power: Power): string {
  return `${punchClass}:${hand}:${target}:${power}`;
}

export function totalTicks(timing: PunchTiming): number {
  return timing.startup + timing.active + timing.recovery;
}
