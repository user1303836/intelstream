import type { CombatEvent, EngineSnapshot, FighterSnapshot } from "./types";

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const presentationFighter = (a: FighterSnapshot, b: FighterSnapshot, t: number): FighterSnapshot => ({
  ...b,
  x: mix(a.x, b.x, t), y: mix(a.y, b.y, t), facing: mix(a.facing, b.facing, t),
  velocity_x: mix(a.velocity_x, b.velocity_x, t), velocity_y: mix(a.velocity_y, b.velocity_y, t),
  stamina: mix(a.stamina, b.stamina, t), maximum_stamina: mix(a.maximum_stamina, b.maximum_stamina, t),
  conditioning: mix(a.conditioning, b.conditioning, t), guard: mix(a.guard, b.guard, t), poise: mix(a.poise, b.poise, t),
});
export class SnapshotBuffer {
  private readonly snapshots: EngineSnapshot[] = [];
  constructor(private readonly maximum = 6) {}
  push(snapshot: EngineSnapshot): boolean {
    const latest = this.snapshots.at(-1); if (latest !== undefined && snapshot.tick <= latest.tick) return false;
    this.snapshots.push(snapshot); if (this.snapshots.length > this.maximum) this.snapshots.shift(); return true;
  }
  latest(): EngineSnapshot | null { return this.snapshots.at(-1) ?? null; }
  sample(tick: number): EngineSnapshot | null {
    const nextIndex = this.snapshots.findIndex((item) => item.tick >= tick);
    if (nextIndex <= 0) return this.snapshots[Math.max(0, nextIndex)] ?? this.latest();
    const a = this.snapshots[nextIndex - 1]!, b = this.snapshots[nextIndex]!;
    if (a.phase !== b.phase || a.fighters.some((fighter, index) => fighter.knockdowns !== b.fighters[index]?.knockdowns)) return b;
    const t = Math.max(0, Math.min(1, (tick - a.tick) / Math.max(1, b.tick - a.tick)));
    return { ...b, fighters: [presentationFighter(a.fighters[0], b.fighters[0], t), presentationFighter(a.fighters[1], b.fighters[1], t)] };
  }
  clear(): void { this.snapshots.length = 0; }
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
