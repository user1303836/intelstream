import { EventDeduplicator, SnapshotBuffer } from "./interpolation";
import { snapshot } from "./test/fixtures";
describe("authoritative interpolation", () => {
  it("orders ticks, interpolates presentation geometry, and rejects stale state", () => { const buffer = new SnapshotBuffer(); const a = snapshot(10), b = { ...snapshot(12), fighters: [{ ...snapshot(12).fighters[0], x: 100, facing_x: 0, facing_y: 1000 }, snapshot(12).fighters[1]] as const }; expect(buffer.push(a)).toBe(true); expect(buffer.push(a)).toBe(false); expect(buffer.push(b)).toBe(true); const mid = buffer.sample(11)!; expect(mid.fighters[0].x).toBe(0); expect(mid.fighters[0].facing_x).toBe(500); expect(mid.fighters[0].facing_y).toBe(500); expect(buffer.sample(11.5)!.fighters[0].x).toBe(50); });
  it("snaps across phase and knockdown discontinuities", () => { const buffer = new SnapshotBuffer(); buffer.push(snapshot(10)); const b = { ...snapshot(12), phase: "knockdown" as const }; buffer.push(b); expect(buffer.sample(11)).toBe(b); });
  it("advances a continuous render clock behind the estimated server tick", () => {
    const buffer = new SnapshotBuffer(8, 30, 2);
    buffer.push(snapshot(10), 0);
    buffer.push(snapshot(11), 1000 / 30);
    buffer.push(snapshot(12), 2000 / 30);
    expect(buffer.renderTick(2000 / 30)).toBeCloseTo(10, 5);
    expect(buffer.renderTick(2500 / 30)).toBeCloseTo(10.5, 5);
    expect(buffer.renderTick(2000)).toBe(12);
    expect(buffer.renderTick(-5000)).toBe(10);
  });
  it("widens the interpolation delay when the clock starves and relaxes it later", () => {
    const buffer = new SnapshotBuffer(8, 30, 2);
    buffer.push(snapshot(10), 0);
    buffer.push(snapshot(11), 1000 / 30);
    expect(buffer.interpolationDelayTicks).toBe(2);
    buffer.renderTick(400);
    expect(buffer.interpolationDelayTicks).toBe(2.5);
    buffer.renderTick(500);
    expect(buffer.interpolationDelayTicks).toBe(2.5);
    for (let tick = 12; tick < 12 + 30 * 9; tick += 1) {
      const at = (tick - 10) * (1000 / 30);
      buffer.push(snapshot(tick), at);
      expect(buffer.renderTick(at)).toBeLessThanOrEqual(tick);
    }
    expect(buffer.interpolationDelayTicks).toBe(2.25);
  });
  it("deduplicates monotonic cosmetic events", () => { const events = [{ event_id: 2, tick: 1, kind: "hit", actor_id: null, target_id: null, amount: 1, detail: "", blood: 0, direction: 0, action_id: null }, { event_id: 1, tick: 1, kind: "block", actor_id: null, target_id: null, amount: 0, detail: "", blood: 0, direction: 0, action_id: null }, { event_id: 2, tick: 1, kind: "hit", actor_id: null, target_id: null, amount: 1, detail: "", blood: 0, direction: 0, action_id: null }]; const dedupe = new EventDeduplicator(); expect(dedupe.accept(events).map((e) => e.event_id)).toEqual([1, 2]); expect(dedupe.accept(events)).toEqual([]); });
});
