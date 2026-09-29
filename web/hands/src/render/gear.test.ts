import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { fighter as baseFighter } from "../test/fixtures";
import type { FighterSnapshot } from "../types";
import { wearCornerColour } from "./gear";
import { BoxingGraph, SkinnedBoxer, loadBoxerGlb } from "./graph";
import { worldMapping } from "./world";

const gltf = await loadBoxerGlb();
const mapping = worldMapping({ tick_rate: 30, ring_half_width: 500, ring_half_height: 500 });

const SHADER = {
  vertexShader: "#include <common>\n#include <begin_vertex>",
  fragmentShader: "#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>",
};

function compile(material: THREE.Material): { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string } {
  const shader = { uniforms: {} as Record<string, unknown>, ...SHADER };
  material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
  return shader;
}

function gloveMaterial(boxer: SkinnedBoxer): THREE.MeshStandardMaterial {
  return boxer.gloveMesh("left").material as THREE.MeshStandardMaterial;
}

describe("corner colour", () => {
  it("hands the shader the blood level it returns", () => {
    const material = new THREE.MeshStandardMaterial();
    const blood = wearCornerColour(material);
    const shader = compile(material);
    expect(shader.uniforms.uGearBlood).toBe(blood);
    expect(shader.vertexShader).toContain("vGearPos = position;");
    expect(shader.fragmentShader).toContain("uGearBlood");
    expect(material.customProgramCacheKey()).toBe("hands-gear-live");
  });

  it("reads bind positions from an attribute on a baked part", () => {
    const material = new THREE.MeshStandardMaterial();
    wearCornerColour(material, true);
    const shader = compile(material);
    expect(shader.vertexShader).toContain("attribute vec3 bindPosition;");
    expect(shader.vertexShader).toContain("vGearPos = bindPosition;");
    expect(material.customProgramCacheKey()).toBe("hands-gear-baked");
  });
});

describe("blood on the gloves", () => {
  const bleeding = (id: string): FighterSnapshot => ({
    ...baseFighter(id), x: 0, y: -150, facing_x: 0, facing_y: 1000,
    trauma: { head: 600, body: 0, left_eye: 0, right_eye: 0, left_cut: 300, right_cut: 200, swelling: 0, bleeding: 400 },
  });
  const fighter = (): FighterSnapshot => ({ ...baseFighter("one"), x: 0, y: 0, facing_x: 0, facing_y: -1000 });

  it("soaks the gloves as the opponent bleeds and leaves them in the corner's colour", () => {
    const boxer = new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8 });
    const graph = new BoxingGraph(boxer, mapping);
    graph.update(fighter(), baseFighter("two"), 1 / 60, 0, false, "full", 1, undefined);
    expect(boxer.gloveBloodLevel).toBe(0);
    graph.update(fighter(), bleeding("two"), 1 / 60, 0.02, false, "full", 2, undefined);
    expect(boxer.gloveBloodLevel).toBe(1);
    expect(gloveMaterial(boxer).color.getHex()).toBe(0x1d4ed8);
    expect(compile(gloveMaterial(boxer)).uniforms.uGearBlood).toEqual({ value: 1 });
    graph.dispose();
  });

  it("is lighter with reduced blood and absent with blood off", () => {
    const boxer = new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0xb91c1c });
    const graph = new BoxingGraph(boxer, mapping);
    graph.update(fighter(), bleeding("two"), 1 / 60, 0, false, "reduced", 1, undefined);
    expect(boxer.gloveBloodLevel).toBeGreaterThan(0.2);
    expect(boxer.gloveBloodLevel).toBeLessThan(0.6);
    graph.update(fighter(), bleeding("two"), 1 / 60, 0.02, false, "off", 2, undefined);
    expect(boxer.gloveBloodLevel).toBe(0);
    graph.dispose();
  });
});
