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
});
