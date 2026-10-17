import type { CombatEvent, EngineSnapshot } from "../types";

export const REPLAY_BEFORE_TICKS = 42;
export const REPLAY_AFTER_TICKS = 33;
export const REPLAY_SPEED = 0.4;
export const REPLAY_TAIL_SECONDS = 0.5;
/**
 * The referee's fall is replayed while the bout waits for it, so it is shorter and a little quicker: 3.7 s with
 * its tail, which with the live fall before it (REFEREE_REPLAY_DELAY_SECONDS) fits the engine's 5 s pause.
 */
export const REFEREE_REPLAY = { before: 24, after: 24, speed: 0.5 } as const;

export interface ReplayPlan {
  readonly snapshots: readonly EngineSnapshot[];
  readonly fromTick: number;
  readonly toTick: number;
  readonly impact: CombatEvent;
  readonly speed: number;
  readonly durationSeconds: number;
}

/**
 * Selects the recorded snapshots around the knockdown that ended the bout for
 * a slow-motion replay, or null when the recording does not cover it.
 */
export function planKnockoutReplay(
  history: readonly EngineSnapshot[],
  impact: CombatEvent,
  tickRate = 30,
  speed = REPLAY_SPEED,
  before = REPLAY_BEFORE_TICKS,
  after = REPLAY_AFTER_TICKS,
): ReplayPlan | null {
  const wantedFrom = impact.tick - before;
  const wantedTo = impact.tick + after;
  const recorded = history.filter((snapshot) => snapshot.tick >= wantedFrom - 1 && snapshot.tick <= wantedTo + 1);
  const ended = recorded.at(-1);
  // A bout that ends on the punch itself (a flash knockout, a third knockdown) stops the recording at the
  // impact, because the server stops; the replay holds that final picture while the fall plays out.
  const snapshots = ended !== undefined && ended.result !== null && ended.tick < wantedTo
    ? [...recorded, ...Array.from({ length: wantedTo - ended.tick }, (_, step) => ({ ...ended, tick: ended.tick + step + 1, events: [] }))]
    : recorded;
  const first = snapshots[0];
  const last = snapshots.at(-1);
  if (first === undefined || last === undefined || snapshots.length < 8) return null;
  if (first.tick > impact.tick - 12 || last.tick < impact.tick + 12) return null;
  const fromTick = Math.max(wantedFrom, first.tick);
  const toTick = Math.min(wantedTo, last.tick);
  return { snapshots, fromTick, toTick, impact, speed, durationSeconds: (toTick - fromTick) / tickRate / speed + REPLAY_TAIL_SECONDS };
}

/** Fractional simulation tick to present `elapsedSeconds` into the replay. */
export function replayTick(plan: ReplayPlan, elapsedSeconds: number, tickRate = 30): number {
  return Math.min(plan.toTick, plan.fromTick + Math.max(0, elapsedSeconds) * tickRate * plan.speed);
}
