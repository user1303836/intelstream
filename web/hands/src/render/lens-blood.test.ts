import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { CombatEvent } from "../types";
import { Effects3D } from "./effects";
import { LensBlood, MOST_LENS_DROPS } from "./lens-blood";

/** A context that records where each drop's sprite is drawn, after the drop's own turn and move. */
function recording(): { ctx: CanvasRenderingContext2D; drawn: { x: number; y: number; size: number; alpha: number }[]; resets: number } {
  const drawn: { x: number; y: number; size: number; alpha: number }[] = [];
  const stack: { x: number; y: number }[] = [];
  let at = { x: 0, y: 0 };
  const record = { ctx: null as unknown as CanvasRenderingContext2D, drawn, resets: 0 };
  record.ctx = {
    globalAlpha: 1,
    fillStyle: "",
    save: () => stack.push({ ...at }),
    restore: () => { at = stack.pop() ?? { x: 0, y: 0 }; },
    translate: (x: number, y: number) => { at = { x: at.x + x, y: at.y + y }; },
    rotate: () => {},
    setTransform: () => { record.resets += 1; },
    fillRect: () => {},
    drawImage(this: { globalAlpha: number }, _image: unknown, x: number, _y: number, width: number) { drawn.push({ x: at.x, y: at.y, size: width, alpha: this.globalAlpha }); },
  } as unknown as CanvasRenderingContext2D;
  return record;
}

describe("blood on the lens", () => {
  it("lands round where the blow is on the screen, more of it and bigger the harder it is thrown", () => {
    const light = new LensBlood();
    light.splash(0.7, 0.4, 0.2, 3);
    const soaked = new LensBlood();
    soaked.splash(0.7, 0.4, 2, 3);
    expect(light.count).toBeGreaterThanOrEqual(1);
    expect(light.count).toBeLessThanOrEqual(3);
    expect(soaked.count).toBe(16);
    const draw = (lens: LensBlood) => {
      const record = recording();
      lens.draw(record.ctx, 1000, 500);
      return record;
    };
    const big = draw(soaked);
    expect(big.drawn).toHaveLength(16);
    const near = big.drawn.filter((drop) => Math.hypot(drop.x - 700, drop.y - 200) < 450);
    expect(near.length).toBeGreaterThan(10);
    expect(Math.max(...big.drawn.map((drop) => drop.size))).toBeGreaterThan(Math.max(...draw(light).drawn.map((drop) => drop.size)));
    // Drawn within the screen's own transform (the HUD's pixel ratio), which it never resets.
    expect(big.resets).toBe(0);
  });

  it("runs the big drops down the glass and fades every drop away within four seconds", () => {
    const lens = new LensBlood();
    lens.splash(0.5, 0.3, 2, 8);
    const heights = (): number[] => {
      const record = recording();
      lens.draw(record.ctx, 800, 600);
      return record.drawn.map((drop) => drop.y);
    };
    const before = heights();
    lens.update(1);
    const after = heights();
    expect(after.some((y, index) => y > before[index]! + 5)).toBe(true);
    expect(after.every((y, index) => y >= before[index]! - 1e-9)).toBe(true);
    for (let step = 0; step < 31; step += 1) lens.update(0.1);
    expect(lens.count).toBe(0);
  });

  it("holds only so many drops, wiping off the oldest, and ignores nonsense", () => {
    const lens = new LensBlood();
    for (let splash = 0; splash < 10; splash += 1) lens.splash(0.5, 0.5, 2, splash);
    expect(lens.count).toBe(MOST_LENS_DROPS);
    lens.clear();
    expect(lens.count).toBe(0);
    lens.splash(Number.NaN, 0.5, 2, 1);
    lens.splash(0.5, 0.5, 0, 1);
    lens.update(Number.NaN);
    expect(lens.count).toBe(0);
  });
});

describe("blood thrown at the camera", () => {
  const camera = (z: number): THREE.PerspectiveCamera => {
    const lens = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 80);
    lens.position.set(0, 1.5, z);
    lens.lookAt(0, 1.4, 0);
    lens.updateMatrixWorld(true);
    return lens;
  };
  const punch = (amount: number, blood = 60, eventId = 5): CombatEvent => ({ event_id: eventId, tick: 1, kind: "hit", actor_id: "one", target_id: "two", amount, detail: "straight:head", blood, direction: 1, action_id: null });
  const thrown = (event: CombatEvent, lens: THREE.Camera | null, at = new THREE.Vector3(), setup?: (effects: Effects3D) => void, reducedMotion = false): number => {
    const effects = new Effects3D(new THREE.Scene(), 256);
    if (lens !== null) effects.setCamera(lens);
    setup?.(effects);
    effects.addEvent(event, at, reducedMotion);
    const drops = effects.lensDrops;
    effects.dispose();
    return drops;
  };

  it("lands on the lens from a hard punch in the picture near the camera, and soaks it from a nearer one", () => {
    expect(thrown(punch(120), camera(3))).toBeGreaterThan(4);
    expect(thrown(punch(120), camera(3))).toBeGreaterThan(thrown(punch(120), camera(5.5)));
    expect(thrown(punch(120), camera(9))).toBe(0);
    // Nothing from a light punch, from behind the camera, from off the screen, or without a camera.
    expect(thrown(punch(45), camera(3))).toBe(0);
    expect(thrown(punch(120), camera(-3), new THREE.Vector3(0, 0, -6))).toBe(0);
    expect(thrown(punch(120), camera(3), new THREE.Vector3(6, 0, 0))).toBe(0);
    expect(thrown(punch(120), null)).toBe(0);
  });

  it("throws a few drops with reduced blood and none with blood off or reduced motion", () => {
    const full = thrown(punch(140, 100), camera(2.5));
    const reduced = thrown(punch(140, 100), camera(2.5), undefined, (effects) => effects.setBloodLevel("reduced"));
    expect(reduced).toBeGreaterThan(0);
    expect(reduced).toBeLessThan(full / 2);
    expect(thrown(punch(140, 100), camera(2.5), undefined, (effects) => effects.setBloodLevel("off"))).toBe(0);
    expect(thrown(punch(140, 100), camera(2.5), undefined, undefined, true)).toBe(0);
  });

  it("is soaked by a finisher near the camera, and wiped clean when the blood is turned off or the bout is cleared", () => {
    const effects = new Effects3D(new THREE.Scene(), 256);
    effects.setCamera(camera(3));
    effects.burstHead(1, new THREE.Vector3(0, 1.6, 0), 1, 9);
    expect(effects.lensDrops).toBe(16);
    const draw = vi.fn();
    effects.drawLens({ save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(), fillRect: vi.fn(), drawImage: draw } as unknown as CanvasRenderingContext2D, 1280, 720);
    expect(draw).toHaveBeenCalledTimes(16);
    effects.clearDynamic();
    expect(effects.lensDrops).toBe(0);
    effects.decapitate(0, new THREE.Vector3(0.2, 1.55, 0), new THREE.Quaternion(), 1, 10);
    expect(effects.lensDrops).toBeGreaterThan(8);
    effects.setBloodLevel("off");
    expect(effects.lensDrops).toBe(0);
    effects.dispose();
  });
});
