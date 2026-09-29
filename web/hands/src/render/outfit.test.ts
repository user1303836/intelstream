import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { SkinnedBoxer, loadBoxerGlb } from "./graph";
import { SCANNED_LOOK } from "./looks";
import { CUTMAN_OUTFIT, REFEREE_OUTFIT, applyOutfitShading, buildCuffGeometry, buildHandGeometry } from "./outfit";

const gltf = await loadBoxerGlb();

const SHADER = {
  vertexShader: "#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>",
  fragmentShader: "#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>\n#include <lights_physical_fragment>",
};

function compile(material: THREE.Material): { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string } {
  const shader = { uniforms: {}, ...SHADER };
  material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
  return shader;
}

function bounds(geometry: THREE.BufferGeometry): THREE.Box3 {
  geometry.computeBoundingBox();
  return geometry.boundingBox!;
}

describe("official hands", () => {
  it("is hand sized, starts at the wrist and curls toward the palm", () => {
    const box = bounds(buildHandGeometry("left"));
    expect(box.min.y).toBeGreaterThan(-3.5);
    expect(box.max.y).toBeGreaterThan(14.6);
    expect(box.max.y).toBeLessThan(19.6);
    expect(box.max.x - box.min.x).toBeGreaterThan(9);
    expect(box.max.x - box.min.x).toBeLessThan(15);
    expect(box.max.z).toBeGreaterThan(3);
    expect(box.min.z).toBeGreaterThan(-2.5);
  });

  it("puts the thumb on opposite sides of the two hands", () => {
    const left = bounds(buildHandGeometry("left"));
    const right = bounds(buildHandGeometry("right"));
    expect(-left.min.x).toBeGreaterThan(left.max.x + 1);
    expect(right.max.x).toBeGreaterThan(-right.min.x + 1);
    expect(right.max.x).toBeCloseTo(-left.min.x, 5);
    expect(right.min.x).toBeCloseTo(-left.max.x, 5);
  });

  it("keeps smooth normals on every vertex", () => {
    const geometry = buildHandGeometry("right");
    const normal = geometry.getAttribute("normal");
    expect(normal.count).toBe(geometry.getAttribute("position").count);
    const n = new THREE.Vector3();
    for (let index = 0; index < normal.count; index += 97) expect(n.fromBufferAttribute(normal, index).length()).toBeCloseTo(1, 3);
  });

  it("covers the end of the forearm up to the wrist with the cuff", () => {
    const box = bounds(buildCuffGeometry());
    expect(box.min.y).toBeLessThan(19);
    expect(box.max.y).toBeGreaterThan(25);
  });
});

describe("official outfit shading", () => {
  it("keeps a shader patch that was already on the material", () => {
    const material = new THREE.MeshStandardMaterial();
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", "#include <map_fragment>\n// earlier patch");
    };
    material.customProgramCacheKey = () => "earlier";
    applyOutfitShading(material, "body", REFEREE_OUTFIT);
    const shader = compile(material);
    expect(shader.fragmentShader).toContain("// earlier patch");
    expect(shader.fragmentShader).toContain("outfitShirtTone");
    expect(shader.fragmentShader.indexOf("outfitCloth = ")).toBeLessThan(shader.fragmentShader.indexOf("// earlier patch"));
    expect(shader.vertexShader).toContain("outfitDraped");
    expect(Object.keys(shader.uniforms).sort()).toEqual(["uOutfitAccent", "uOutfitShape", "uOutfitShirt", "uOutfitTrousers"]);
    expect(material.customProgramCacheKey()).toBe("earlier-outfit-body");
  });

  it("compiles a different program for every part", () => {
    const keys = (["head", "body", "shoes", "pants"] as const).map((part) => {
      const material = new THREE.MeshStandardMaterial();
      applyOutfitShading(material, part, REFEREE_OUTFIT);
      return material.customProgramCacheKey();
    });
    expect(new Set(keys).size).toBe(4);
  });

  it("ends short sleeves above the elbow and long sleeves past the wrist", () => {
    const shape = (outfit: typeof REFEREE_OUTFIT): THREE.Vector4 => {
      const material = new THREE.MeshStandardMaterial();
      applyOutfitShading(material, "body", outfit);
      return (compile(material).uniforms.uOutfitShape as { value: THREE.Vector4 }).value;
    };
    expect(shape(CUTMAN_OUTFIT).x).toBeLessThan(31);
    expect(shape(REFEREE_OUTFIT).x).toBeGreaterThan(43.4);
    expect(shape(REFEREE_OUTFIT).y).toBe(1);
    expect(shape(CUTMAN_OUTFIT).y).toBe(0);
  });
});

describe("dressed official", () => {
  it("wears hands and cuffs instead of boxing gloves", () => {
    const boxer = new SkinnedBoxer(gltf, { skin: 0xc79b76, gear: 0x1b2230, outfit: REFEREE_OUTFIT });
    for (const side of ["left", "right"] as const) {
      expect(boxer.gloveMesh(side).visible).toBe(false);
      boxer.setHandDismembered(side, false);
      expect(boxer.gloveMesh(side).visible).toBe(false);
      const suffix = side === "left" ? "L" : "R";
      expect(boxer.rig.bones[`glove${suffix}`].getObjectByName(`hand-${side}`)).toBeInstanceOf(THREE.Mesh);
      expect(boxer.rig.bones[`elbow${suffix}`].getObjectByName(`cuff-${side}`)).toBeInstanceOf(THREE.Mesh);
    }
    boxer.dispose();
  });

  it("leaves a fighter in gloves with the scanned skin tone", () => {
    const boxer = new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8 });
    expect(boxer.gloveMesh("left").visible).toBe(true);
    expect(boxer.rig.bones.gloveL.getObjectByName("hand-left")).toBeUndefined();
    expect(boxer.skin.color.getHex()).toBe(0xffffff);
    boxer.setHandDismembered("left", true);
    expect(boxer.gloveMesh("left").visible).toBe(false);
    boxer.setHandDismembered("left", false);
    expect(boxer.gloveMesh("left").visible).toBe(true);
    boxer.dispose();
  });

  it("gives the cutman examination gloves in the glove colour", () => {
    const boxer = new SkinnedBoxer(gltf, { skin: 0xb98c66, gear: 0x1b2230, look: { ...SCANNED_LOOK, tint: 0xd8b498 }, outfit: CUTMAN_OUTFIT });
    const hand = boxer.rig.bones.gloveR.getObjectByName("hand-right") as THREE.Mesh;
    expect((hand.material as THREE.MeshStandardMaterial).color.getHex()).toBe(CUTMAN_OUTFIT.gloves);
    expect(boxer.skin.color.getHex()).toBe(0xd8b498);
    boxer.dispose();
  });
});
