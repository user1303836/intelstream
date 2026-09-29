import { describe, expect, it } from "vitest";
import { ResolutionScaler } from "./quality";

function feed(scaler: ResolutionScaler, frameMs: number, count: number): number {
  let changes = 0;
  for (let index = 0; index < count; index += 1) if (scaler.record(frameMs)) changes += 1;
  return changes;
}

describe("ResolutionScaler", () => {
  it("starts at full scale and ignores frames while a window is still filling", () => {
    const scaler = new ResolutionScaler();
    expect(scaler.scale).toBe(1);
    expect(feed(scaler, 33, 20)).toBe(0);
    expect(scaler.scale).toBe(1);
  });

  it("steps down after a slow window and keeps the step when frames get faster", () => {
    const scaler = new ResolutionScaler();
    expect(feed(scaler, 40, 25)).toBe(1);
    expect(scaler.scale).toBeCloseTo(0.85);
    expect(feed(scaler, 30, 34)).toBe(1);
    expect(scaler.scale).toBeCloseTo(0.7);
  });

  it("reverts a downscale that did not speed the next window up and holds off with backoff", () => {
    const scaler = new ResolutionScaler();
    feed(scaler, 40, 25);
    expect(scaler.scale).toBeCloseTo(0.85);
    expect(feed(scaler, 40, 25)).toBe(1);
    expect(scaler.scale).toBe(1);
    expect(feed(scaler, 40, 25 * 10)).toBe(0);
    expect(feed(scaler, 40, 25)).toBe(1);
    expect(scaler.scale).toBeCloseTo(0.85);
    expect(feed(scaler, 40, 25)).toBe(1);
    expect(scaler.scale).toBe(1);
    expect(feed(scaler, 40, 25 * 20)).toBe(0);
    expect(feed(scaler, 40, 25)).toBe(1);
    expect(scaler.scale).toBeCloseTo(0.85);
  });

  it("never drops below the minimum or rises above the maximum", () => {
    const scaler = new ResolutionScaler({ maximum: 1, minimum: 0.55, slowMs: 24, fastMs: 17.5, windowMs: 1000, step: 0.15 });
    const slow = [60, 50, 40, 32, 26];
    for (const frameMs of slow) feed(scaler, frameMs, Math.ceil(1000 / frameMs) + 1);
    expect(scaler.scale).toBeCloseTo(0.55);
    feed(scaler, 25, 41);
    expect(scaler.scale).toBeCloseTo(0.55);
    feed(scaler, 16, 63 * 12);
    expect(scaler.scale).toBe(1);
  });

  it("needs three consecutive fast windows before raising the scale", () => {
    const scaler = new ResolutionScaler();
    feed(scaler, 40, 25);
    feed(scaler, 30, 34);
    expect(scaler.scale).toBeCloseTo(0.7);
    expect(feed(scaler, 16, 63 * 2)).toBe(0);
    feed(scaler, 20, 51);
    expect(feed(scaler, 16, 63 * 2)).toBe(0);
    expect(feed(scaler, 16, 63)).toBe(1);
    expect(scaler.scale).toBeCloseTo(0.85);
  });

  it("ignores hidden-tab gaps and non-positive intervals", () => {
    const scaler = new ResolutionScaler();
    expect(scaler.record(0)).toBe(false);
    expect(scaler.record(Number.NaN)).toBe(false);
    expect(scaler.record(5000)).toBe(false);
    expect(feed(scaler, 16, 63 * 3)).toBe(0);
    expect(scaler.scale).toBe(1);
  });
});
