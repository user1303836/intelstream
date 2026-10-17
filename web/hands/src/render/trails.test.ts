import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { GloveTrail } from "./trails";

describe("glove trail", () => {
  it("appears only while the glove moves at punch speed and fades out afterwards", () => {
    const trail = new GloveTrail(new THREE.Color(0xffffff));
    const camera = new THREE.Vector3(0, 2, 5);
    const glove = new THREE.Vector3(0, 1.3, 0);
    for (let frame = 0; frame < 12; frame += 1) {
      glove.z += 0.01;
      trail.update(glove, 1 / 60, camera, true);
    }
    expect(trail.active).toBe(false);
    for (let frame = 0; frame < 12; frame += 1) {
      glove.z += 0.1;
      trail.update(glove, 1 / 60, camera, true);
    }
    expect(trail.active).toBe(true);
    const alphas = trail.mesh.geometry.getAttribute("color") as THREE.BufferAttribute;
    expect(alphas.getW(alphas.count - 1)).toBeGreaterThan(alphas.getW(0));
    for (let frame = 0; frame < 30; frame += 1) trail.update(glove, 1 / 60, camera, true);
    expect(trail.active).toBe(false);
    for (let frame = 0; frame < 12; frame += 1) {
      glove.z += 0.1;
      trail.update(glove, 1 / 60, camera, false);
    }
    expect(trail.active).toBe(false);
    trail.dispose();
  });

  it("leaves a wider ribbon in the colour of its heat behind a glove throwing a power punch, from a slower glove", () => {
    const camera = new THREE.Vector3(0, 2, 5);
    const ribbon = (heat: number, step: number): { active: boolean; width: number; red: number; blue: number } => {
      const trail = new GloveTrail(new THREE.Color(0x4466ff));
      const glove = new THREE.Vector3(0, 1.3, 0);
      for (let frame = 0; frame < 12; frame += 1) {
        glove.x += step;
        trail.update(glove, 1 / 60, camera, true, heat);
      }
      const positions = trail.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      const colors = trail.mesh.geometry.getAttribute("color") as THREE.BufferAttribute;
      const last = positions.count - 2;
      const width = Math.hypot(positions.getX(last) - positions.getX(last + 1), positions.getY(last) - positions.getY(last + 1), positions.getZ(last) - positions.getZ(last + 1));
      const result = { active: trail.active, width, red: colors.getX(last), blue: colors.getZ(last) };
      trail.dispose();
      return result;
    };
    // Two metres a second: too slow for a punch's ribbon, not for a power punch's.
    expect(ribbon(0, 2 / 60).active).toBe(false);
    expect(ribbon(1, 2 / 60).active).toBe(true);
    const cold = ribbon(0, 0.1);
    const hot = ribbon(1, 0.1);
    expect(hot.width).toBeGreaterThan(cold.width * 2);
    expect(cold.blue).toBeGreaterThan(cold.red);
    expect(hot.red).toBeGreaterThan(hot.blue * 3);
  });

  it("reuses its sample vectors instead of allocating one every frame", () => {
    const trail = new GloveTrail(new THREE.Color(0xffffff));
    const camera = new THREE.Vector3(0, 2, 5);
    const glove = new THREE.Vector3(0, 1.3, 0);
    const history = (trail as unknown as { history: THREE.Vector3[] }).history;
    for (let frame = 0; frame < 40; frame += 1) {
      glove.z += 0.05;
      trail.update(glove, 1 / 60, camera, true);
    }
    const pool = new Set(history);
    for (let frame = 0; frame < 200; frame += 1) {
      glove.z += 0.05;
      trail.update(glove, 1 / 60, camera, true);
      for (const sample of history) expect(pool.has(sample)).toBe(true);
    }
    expect(history.at(-1)!.z).toBeCloseTo(glove.z);
    trail.dispose();
  });
});
