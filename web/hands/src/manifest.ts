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
 * parry), the two form a combination, the fighter can pay the follow-up's full cost and the defender is
 * not stunned. Otherwise the follow-up starts the tick after the punch ends.
 */
export function cancelsRecovery(
  punch: PunchClass,
  landed: boolean,
  followUp: { readonly class: PunchClass; readonly target: Target; readonly power: Power },
  stamina: number,
  defenderStunned: boolean,
): boolean {
  return landed
    && !defenderStunned
    && comboChain(punch, followUp.class)
    && stamina >= punchStaminaCost(followUp.class, followUp.target, followUp.power);
}

/** Ticks after a punch ends during which a compatible follow-up still counts as a combination. */
export function comboWindow(punchClass: PunchClass): number {
  return punches[punchClass].combo_window;
}

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
