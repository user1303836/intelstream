import { EventDeduplicator, SnapshotBuffer } from "./interpolation";
import { snapshot } from "./test/fixtures";

/** 30 Hz snapshots over an ordered (TCP) link with the given one-way latency, rendered at 60 Hz. */
function simulateLink(endMs: number, latencyMs: (sentMs: number, tick: number) => number): { delayAt: (ms: number) => number; starvedAfter: (ms: number) => number } {
  const buffer = new SnapshotBuffer(8, 30, 2);
  const arrivals: { tick: number; at: number }[] = [];
  let previous = -Infinity;
  for (let tick = 1; tick * (1000 / 30) < endMs; tick += 1) {
    const sent = tick * (1000 / 30);
    previous = Math.max(sent + latencyMs(sent, tick), previous);
    arrivals.push({ tick, at: previous });
  }
  const delays: { at: number; delay: number }[] = [];
  const starved: number[] = [];
  let next = 0;
  for (let now = 0; now < endMs; now += 1000 / 60) {
    while (next < arrivals.length && arrivals[next]!.at <= now) { buffer.push(snapshot(arrivals[next]!.tick), arrivals[next]!.at); next += 1; }
    const latest = buffer.latest();
    const rendered = buffer.renderTick(now);
    if (latest !== null && now > 1000 && rendered >= latest.tick) starved.push(now);
    delays.push({ at: now, delay: buffer.interpolationDelayTicks });
  }
  return {
    delayAt: (ms) => delays.findLast((sample) => sample.at <= ms)!.delay,
    starvedAfter: (ms) => starved.filter((at) => at > ms).length,
  };
}

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
  it("widens the interpolation delay when the clock starves and relaxes it within seconds once snapshots arrive on time", () => {
    const buffer = new SnapshotBuffer(8, 30, 2);
    buffer.push(snapshot(10), 0);
    buffer.push(snapshot(11), 1000 / 30);
    expect(buffer.interpolationDelayTicks).toBe(2);
    buffer.renderTick(400);
    expect(buffer.interpolationDelayTicks).toBe(2.5);
    buffer.renderTick(500);
    expect(buffer.interpolationDelayTicks).toBe(2.5);
    const delays = new Map<number, number>();
    for (let tick = 12; tick < 12 + 30 * 9; tick += 1) {
      const at = (tick - 10) * (1000 / 30);
      buffer.push(snapshot(tick), at);
      expect(buffer.renderTick(at)).toBeLessThanOrEqual(tick);
      delays.set(at, buffer.interpolationDelayTicks);
    }
    // Held while the starved frame is in the lateness window, then back down to the floor.
    expect(delays.get(75 * (1000 / 30))).toBe(2.5);
    expect(delays.get(150 * (1000 / 30))).toBe(1.5);
    expect(buffer.interpolationDelayTicks).toBe(1.5);
  });
  it("recovers within seconds from a two-second latency spike", () => {
    // 40 ms one way, then 150 ms more for the two seconds from 20 s.
    const link = simulateLink(40_000, (sent) => 40 + (sent >= 20_000 && sent < 22_000 ? 150 : 0));
    expect(link.delayAt(19_000)).toBe(1.5);
    expect(link.delayAt(22_000)).toBeGreaterThanOrEqual(4.5);
    // Before, the delay was still 4.5 ticks at 39 s and took about two minutes to come back.
    expect(link.delayAt(28_000)).toBe(1.5);
    expect(link.starvedAfter(23_000)).toBe(0);
  });
  it("settles above steady jitter instead of relaxing into it again and again", () => {
    // Every eighth snapshot is 70 ms late, for good.
    const link = simulateLink(30_000, (_sent, tick) => 40 + (tick % 8 === 0 ? 70 : 0));
    expect(link.starvedAfter(5_000)).toBe(0);
    expect(link.delayAt(29_000)).toBeGreaterThanOrEqual(2.85);
  });
  it("finds the server clock again by itself after the server stops for a disconnection", () => {
    const buffer = new SnapshotBuffer(8, 30, 2);
    const frame = 1000 / 60;
    let now = 0;
    let tick = 0;
    const play = (seconds: number, onFrame?: (renderTick: number, latest: number) => void): void => {
      const end = now + seconds * 1000;
      let nextSnapshot = now;
      for (; now < end; now += frame) {
        while (nextSnapshot <= now) {
          tick += 1;
          buffer.push(snapshot(tick), nextSnapshot);
          nextSnapshot += 1000 / 30;
        }
        onFrame?.(buffer.renderTick(now), tick);
      }
    };
    play(10);
    const stalled = now + 10_000;
    for (; now < stalled; now += frame) buffer.renderTick(now);
    play(1);
    let latestFrames = 0;
    let frames = 0;
    play(2, (renderTick, latest) => { frames += 1; if (renderTick >= latest) latestFrames += 1; });
    expect(latestFrames / frames).toBeLessThan(0.1);
    expect(buffer.interpolationDelayTicks).toBeLessThanOrEqual(3);
  });
  it("starts the clock over on resync, dropping a delay widened by the pause", () => {
    const buffer = new SnapshotBuffer(8, 30, 2);
    for (let tick = 1; tick <= 60; tick += 1) buffer.push(snapshot(tick), (tick * 1000) / 30);
    for (let at = 2000; at < 12_000; at += 16) buffer.renderTick(at);
    expect(buffer.interpolationDelayTicks).toBe(6);
    buffer.resync();
    expect(buffer.interpolationDelayTicks).toBe(2);
    buffer.push(snapshot(61), 12_000);
    buffer.push(snapshot(62), 12_000 + 1000 / 30);
    expect(buffer.renderTick(12_000 + 1000 / 30)).toBeCloseTo(60, 5);
  });
  it("deduplicates monotonic cosmetic events", () => { const events = [{ event_id: 2, tick: 1, kind: "hit", actor_id: null, target_id: null, amount: 1, detail: "", blood: 0, direction: 0, action_id: null }, { event_id: 1, tick: 1, kind: "block", actor_id: null, target_id: null, amount: 0, detail: "", blood: 0, direction: 0, action_id: null }, { event_id: 2, tick: 1, kind: "hit", actor_id: null, target_id: null, amount: 1, detail: "", blood: 0, direction: 0, action_id: null }]; const dedupe = new EventDeduplicator(); expect(dedupe.accept(events).map((e) => e.event_id)).toEqual([1, 2]); expect(dedupe.accept(events)).toEqual([]); });
});
