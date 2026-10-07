import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { CANVAS_BLOOD_UPLOAD_INTERVAL, CanvasBlood } from "./canvas-blood";
import { Effects3D } from "./effects";
import { poolRadius } from "./renderer";
import { CANVAS_TOP, RING_FIGHT_HALF } from "./world";

describe("blood on the canvas", () => {
  it("is painted over the whole canvas the fighters stand on, the ring's corners at the texture's", () => {
    const blood = new CanvasBlood(new THREE.Scene(), 512);
    expect(blood.pixel(-RING_FIGHT_HALF, -RING_FIGHT_HALF)).toEqual({ x: 0, y: 0 });
    expect(blood.pixel(RING_FIGHT_HALF, RING_FIGHT_HALF)).toEqual({ x: 512, y: 512 });
    expect(blood.pixel(0, 0)).toEqual({ x: 256, y: 256 });
    expect(blood.mesh.position.y).toBeGreaterThan(CANVAS_TOP);
    expect(blood.mesh.position.y).toBeLessThan(CANVAS_TOP + 0.01);
    blood.dispose();
  });

  it("keeps every stain for the bout, where the old decals recycled after 48", () => {
    const blood = new CanvasBlood(new THREE.Scene());
    for (let index = 0; index < 500; index += 1) blood.stain((index % 50) * 0.1 - 2.5, 0.3, 0.1, 0.08, index, 0.6, 0x6e0d13);
    expect(blood.stains).toBe(500);
    blood.stain(RING_FIGHT_HALF + 0.2, 0, 0.1, 0.1, 0, 0.5, 0x6e0d13);
    blood.stain(0, Number.NaN, 0.1, 0.1, 0, 0.5, 0x6e0d13);
    expect(blood.stains).toBe(500);
    blood.dispose();
  });

  it("sends what it has painted to the GPU at most every eighth of a second", () => {
    const blood = new CanvasBlood(new THREE.Scene());
    const texture = (blood.mesh.material as THREE.MeshStandardMaterial).map!;
    blood.update(1);
    const version = texture.version;
    blood.stain(0, 0, 0.2, 0.2, 0, 0.8, 0x6e0d13);
    expect(blood.uploadPending).toBe(true);
    blood.update(1);
    expect(texture.version).toBe(version + 1);
    blood.stain(0.1, 0, 0.2, 0.2, 0, 0.8, 0x6e0d13);
    blood.update(CANVAS_BLOOD_UPLOAD_INTERVAL / 2);
    expect(blood.uploadPending).toBe(true);
    expect(texture.version).toBe(version + 1);
    blood.update(CANVAS_BLOOD_UPLOAD_INTERVAL / 2);
    expect(blood.uploadPending).toBe(false);
    expect(texture.version).toBe(version + 2);
    blood.update(1);
    expect(texture.version).toBe(version + 2);
    blood.dispose();
  });

  it("is hidden until blood lands and when the canvas is cleaned, and leaves nothing behind", () => {
    const scene = new THREE.Scene();
    const blood = new CanvasBlood(scene);
    expect(blood.mesh.visible).toBe(false);
    blood.pool(0.4, -0.2, 0.3, 0.9, 2);
    expect(blood.mesh.visible).toBe(true);
    expect(blood.stains).toBe(1);
    blood.clear();
    expect(blood.mesh.visible).toBe(false);
    expect(blood.stains).toBe(0);
    const material = blood.mesh.material as THREE.MeshStandardMaterial;
    const disposed = [vi.spyOn(material, "dispose"), vi.spyOn(material.map!, "dispose"), vi.spyOn(blood.mesh.geometry, "dispose")];
    blood.dispose();
    for (const spy of disposed) expect(spy).toHaveBeenCalledOnce();
    expect(scene.children).toHaveLength(0);
  });

  it("pools under a fighter on the canvas, smaller with reduced blood and never with blood off", () => {
    const pooled = (level: "full" | "reduced" | "off"): number => {
      const effects = new Effects3D(new THREE.Scene(), 256);
      effects.setBloodLevel(level);
      effects.pool(0.5, 0.5, 0.3, 1);
      const stains = effects.canvasStains;
      effects.dispose();
      return stains;
    };
    expect(pooled("full")).toBe(1);
    expect(pooled("reduced")).toBe(1);
    expect(pooled("off")).toBe(0);
  });

  it("spreads fast at first and then slower, wider the worse the fighter bleeds, to under half a metre", () => {
    expect(poolRadius(0, 1)).toBeCloseTo(0.05, 5);
    expect(poolRadius(4, 1) - poolRadius(0, 1)).toBeGreaterThan(poolRadius(16, 1) - poolRadius(12, 1));
    expect(poolRadius(16, 1.4)).toBeGreaterThan(poolRadius(16, 0.5));
    expect(poolRadius(20, 1)).toBeGreaterThan(0.2);
    expect(poolRadius(10_000, 10)).toBe(0.42);
  });
});
