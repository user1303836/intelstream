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
}

interface ManifestPunch {
  readonly startup: number;
  readonly active: number;
  readonly recovery: number;
  readonly reach: number;
  readonly lateral_arc: number;
}

const punches = manifestJson.punches as unknown as Record<PunchClass, ManifestPunch>;
const variants = manifestJson.variants as unknown as Record<"body" | "power", ManifestVariant>;

export const TICK_RATE = manifestJson.tick_rate;
export const ACTION_BUFFER_TICKS = manifestJson.action_buffer_ticks;
export const HITSTOP_MS = manifestJson.hitstop_ms;
export const HURTBOXES = manifestJson.hurtboxes;
export const GLOVE_HITBOX_RADIUS = manifestJson.hitbox.glove_radius;
export const FATIGUE_SCALING = manifestJson.fatigue_scaling;

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

export function actionKey(punchClass: PunchClass, hand: Hand, target: Target, power: Power): string {
  return `${punchClass}:${hand}:${target}:${power}`;
}

export function totalTicks(timing: PunchTiming): number {
  return timing.startup + timing.active + timing.recovery;
}
