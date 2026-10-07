import { fighter } from "../test/fixtures";
import { ROCKED_DOWN, RockedVision, rockedLevel } from "./rocked";

describe("hurt vision", () => {
  it("follows how long the fighter is stunned and how little poise is left", () => {
    expect(rockedLevel(undefined, "fight")).toBe(0);
    expect(rockedLevel(fighter("one"), "fight")).toBe(0);
    expect(rockedLevel({ ...fighter("one"), stunned_ticks: 45 }, "fight")).toBe(1);
    expect(rockedLevel({ ...fighter("one"), stunned_ticks: 90 }, "fight")).toBe(1);
    expect(rockedLevel({ ...fighter("one"), stunned_ticks: 9 }, "fight")).toBeCloseTo(0.2);
    expect(rockedLevel({ ...fighter("one"), poise: 75 }, "fight")).toBeCloseTo(0.3);
    expect(rockedLevel({ ...fighter("one"), poise: 75, stunned_ticks: 30 }, "fight")).toBeCloseTo(30 / 45);
  });

  it("is strongest on the canvas and gone once the bout is not live", () => {
    expect(rockedLevel({ ...fighter("one"), is_downed: true, poise: 0 }, "knockdown")).toBe(ROCKED_DOWN);
    for (const phase of ["countdown", "rest", "foul_recovery", "complete"] as const) expect(rockedLevel({ ...fighter("one"), stunned_ticks: 60, is_downed: true }, phase)).toBe(0);
  });

  it("comes on at once and clears slowly", () => {
    const vision = new RockedVision();
    let level = 0;
    for (let frame = 0; frame < 18; frame += 1) level = vision.update(1, 1 / 60);
    expect(level).toBeGreaterThan(0.85);
    for (let frame = 0; frame < 60; frame += 1) level = vision.update(0, 1 / 60);
    expect(level).toBeGreaterThan(0.35);
    for (let frame = 0; frame < 600; frame += 1) level = vision.update(0, 1 / 60);
    expect(level).toBe(0);
    expect(vision.update(0.5, 0)).toBe(0);
  });
});
