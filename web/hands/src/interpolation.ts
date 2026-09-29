import type { CombatEvent, EngineSnapshot, FighterSnapshot } from "./types";

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const presentationFighter = (a: FighterSnapshot, b: FighterSnapshot, t: number): FighterSnapshot => ({
  ...b,
  x: mix(a.x, b.x, t), y: mix(a.y, b.y, t), facing: mix(a.facing, b.facing, t),
  facing_x: mix(a.facing_x, b.facing_x, t), facing_y: mix(a.facing_y, b.facing_y, t),
  velocity_x: mix(a.velocity_x, b.velocity_x, t), velocity_y: mix(a.velocity_y, b.velocity_y, t),
  stamina: mix(a.stamina, b.stamina, t), maximum_stamina: mix(a.maximum_stamina, b.maximum_stamina, t),
  conditioning: mix(a.conditioning, b.conditioning, t), guard: mix(a.guard, b.guard, t), poise: mix(a.poise, b.poise, t),
});

const MIN_DELAY_TICKS = 1.5;
const MAX_DELAY_TICKS = 6;
const STARVATION_STEP_TICKS = 0.5;
const RELAX_STEP_TICKS = 0.25;
const RELAX_AFTER_MS = 8000;
const OFFSET_DRIFT_PER_PUSH = 0.01;

/**
 * Holds recent authoritative snapshots and provides a continuously advancing
 * render clock: the client estimates the server tick from snapshot arrival
 * times and presents the state a small, adaptive delay behind it so that
 * every rendered frame interpolates between two real snapshots instead of
 * holding the latest pose until the next packet arrives.
 */
export class SnapshotBuffer {
  private readonly snapshots: EngineSnapshot[] = [];
  private offsetTicks: number | null = null;
  private delayTicks: number;
  private lastStarvationMs = -Infinity;
  private lastRelaxMs = 0;
  constructor(private readonly maximum = 8, private readonly tickRate = 30, initialDelayTicks = 2) {
    this.delayTicks = initialDelayTicks;
  }
  get interpolationDelayTicks(): number { return this.delayTicks; }
  push(snapshot: EngineSnapshot, nowMs?: number): boolean {
    const latest = this.snapshots.at(-1); if (latest !== undefined && snapshot.tick <= latest.tick) return false;
    this.snapshots.push(snapshot); if (this.snapshots.length > this.maximum) this.snapshots.shift();
    if (nowMs !== undefined && Number.isFinite(nowMs)) {
      const sample = snapshot.tick - (nowMs * this.tickRate) / 1000;
      this.offsetTicks = this.offsetTicks === null ? sample : Math.max(sample, this.offsetTicks - OFFSET_DRIFT_PER_PUSH);
    }
    return true;
  }
  latest(): EngineSnapshot | null { return this.snapshots.at(-1) ?? null; }
  /** Fractional tick to present at `nowMs`, clamped to the buffered range. */
  renderTick(nowMs: number): number {
    const latest = this.latest();
    if (latest === null) return 0;
    const oldest = this.snapshots[0]!.tick;
    if (this.offsetTicks === null) return Math.max(oldest, latest.tick - 1);
    const estimate = (nowMs * this.tickRate) / 1000 + this.offsetTicks - this.delayTicks;
    if (estimate > latest.tick + 0.25 && nowMs - this.lastStarvationMs > 250) {
      this.lastStarvationMs = nowMs;
      this.lastRelaxMs = nowMs;
      this.delayTicks = Math.min(MAX_DELAY_TICKS, this.delayTicks + STARVATION_STEP_TICKS);
    } else if (nowMs - this.lastRelaxMs > RELAX_AFTER_MS) {
      this.lastRelaxMs = nowMs;
      this.delayTicks = Math.max(MIN_DELAY_TICKS, this.delayTicks - RELAX_STEP_TICKS);
    }
    return Math.min(latest.tick, Math.max(oldest, estimate));
  }
  sample(tick: number): EngineSnapshot | null {
    const nextIndex = this.snapshots.findIndex((item) => item.tick >= tick);
    if (nextIndex <= 0) return this.snapshots[Math.max(0, nextIndex)] ?? this.latest();
    const a = this.snapshots[nextIndex - 1]!, b = this.snapshots[nextIndex]!;
    if (a.phase !== b.phase || a.fighters.some((fighter, index) => fighter.knockdowns !== b.fighters[index]?.knockdowns)) return b;
    const t = Math.max(0, Math.min(1, (tick - a.tick) / Math.max(1, b.tick - a.tick)));
    return { ...b, fighters: [presentationFighter(a.fighters[0], b.fighters[0], t), presentationFighter(a.fighters[1], b.fighters[1], t)] };
  }
  clear(): void { this.snapshots.length = 0; this.offsetTicks = null; }
}
export class EventDeduplicator {
  private highest = -1;
  accept(events: readonly CombatEvent[]): CombatEvent[] {
    const seen = new Set<number>();
    const accepted = events
      .filter((event) => {
        if (event.event_id <= this.highest || seen.has(event.event_id)) return false;
        seen.add(event.event_id);
        return true;
      })
      .sort((a, b) => a.event_id - b.event_id);
    for (const event of accepted) this.highest = Math.max(this.highest, event.event_id);
    return accepted;
  }
  reset(): void { this.highest = -1; }
}
