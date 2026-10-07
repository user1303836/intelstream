import type { FighterSnapshot, MatchPhase } from "../types";

/** Stun at which the hurt vision is at full strength: a big head shot stuns for this long or longer. */
export const ROCKED_STUN_TICKS = 45;
/** Below this poise a fighter is hanging on even when not stunned. */
export const ROCKED_POISE = 150;
/** On the canvas during a count. */
export const ROCKED_DOWN = 0.9;

/** How rocked the viewer's own fighter is, 0 to 1, while the bout is live. */
export function rockedLevel(fighter: FighterSnapshot | undefined, phase: MatchPhase): number {
  if (fighter === undefined || (phase !== "fight" && phase !== "knockdown")) return 0;
  if (fighter.is_downed) return ROCKED_DOWN;
  const stunned = Math.min(1, fighter.stunned_ticks / ROCKED_STUN_TICKS);
  const shaky = fighter.poise < ROCKED_POISE ? ((ROCKED_POISE - fighter.poise) / ROCKED_POISE) * 0.6 : 0;
  return Math.max(stunned, shaky);
}

/** Eases the hurt vision in at once and lets it go slowly, as a fighter clears the head. */
export class RockedVision {
  private value = 0;

  get level(): number {
    return this.value;
  }

  update(target: number, dt: number): number {
    const rate = target > this.value ? 7 : 0.9;
    this.value += (target - this.value) * (1 - Math.exp(-rate * Math.max(0, dt)));
    if (target === 0 && this.value < 0.003) this.value = 0;
    return this.value;
  }
}
