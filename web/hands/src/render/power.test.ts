import * as THREE from "three";
import { GloveGlow, ImpactFlash, glowTexture } from "./power";

describe("a power punch's glow", () => {
  it("builds with the glove's heat and flares as it reaches the target, only glowing when motion is reduced", () => {
    const glove = new THREE.Vector3(0.2, 1.4, 0.3);
    const sizes = (reducedMotion: boolean): number[] => {
      const glow = new GloveGlow(glowTexture());
      const seen: number[] = [];
      for (const heat of [0, 0.3, 0.7, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.5, 0]) {
        glow.update(glove, heat, 1 / 60, reducedMotion, new THREE.PerspectiveCamera());
        seen.push(glow.active ? glow.mesh.scale.x : 0);
      }
      expect(glow.mesh.position.toArray()).toEqual(glove.toArray());
      glow.dispose();
      return seen;
    };
    const full = sizes(false);
    expect(full[0]).toBe(0);
    expect(full[1]).toBeGreaterThan(0);
    expect(full[2]).toBeGreaterThan(full[1]!);
    // The flare at the target, gone in a fifth of a second.
    expect(full[3]).toBeGreaterThan(full[2]! * 1.8);
    expect(full[12]).toBeLessThan(full[3]! * 0.7);
    expect(full.at(-1)).toBe(0);
    const calm = sizes(true);
    expect(Math.max(...calm)).toBeCloseTo(calm[12]!, 6);
  });
});

describe("a landed power punch's flash", () => {
  it("flashes and throws a ring out from where it lands, then is gone", () => {
    const flash = new ImpactFlash(glowTexture());
    const camera = new THREE.PerspectiveCamera();
    expect(flash.active).toBe(false);
    flash.fire(new THREE.Vector3(0, 1.5, 0.4));
    flash.update(0, camera);
    expect(flash.active).toBe(true);
    expect(flash.group.position.toArray()).toEqual([0, 1.5, 0.4]);
    const ring = flash.group.children[1]!;
    const early = ring.scale.x;
    for (let frame = 0; frame < 8; frame += 1) flash.update(1 / 60, camera);
    expect(ring.scale.x).toBeGreaterThan(early * 3);
    for (let frame = 0; frame < 12; frame += 1) flash.update(1 / 60, camera);
    expect(flash.active).toBe(false);
    flash.dispose();
  });
});
