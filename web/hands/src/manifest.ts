import manifestJson from "../../../src/intelstream/hands/combat-manifest.json";
import type { Hand, Power, PunchClass, Target } from "./types";

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
const comboChains = new Set(manifestJson.combos.chains.map(([first, second]) => `${first}:${second}`));

/** Whether the engine counts `second` straight after `first` as a combination. */
export function comboChain(first: PunchClass, second: PunchClass): boolean {
  return comboChains.has(`${first}:${second}`);
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

export function actionKey(punchClass: PunchClass, hand: Hand, target: Target, power: Power): string {
  return `${punchClass}:${hand}:${target}:${power}`;
}

export function totalTicks(timing: PunchTiming): number {
  return timing.startup + timing.active + timing.recovery;
}
