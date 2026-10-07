import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { fighter } from "../test/fixtures";
import type { TraumaSnapshot } from "../types";
import { wearCornerColour } from "./gear";
import { BoxingGraph, SkinnedBoxer, loadBoxerGlb } from "./graph";
import { BODY_SITES, CHEEK_SWELL, EYE_LIDS, EYE_SHUT_TRAUMA, EYE_SWELL, HEAD_SITES, HEAD_SWELL_CORE, InjuryShading, applyHeadTrauma, eyeShut, trunksBloodFor } from "./injury";
import { REFEREE_OUTFIT } from "./outfit";
import { worldMapping } from "./world";

const gltf = await loadBoxerGlb();
const mapping = worldMapping({ tick_rate: 30, ring_half_width: 500, ring_half_height: 500 });
const SHADER = {
  vertexShader: "#include <common>\n#include <begin_vertex>",
  fragmentShader: "#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>",
};

function compile(material: THREE.Material): { uniforms: Record<string, { value: unknown }>; vertexShader: string; fragmentShader: string } {
  const shader = { uniforms: {} as Record<string, { value: unknown }>, ...SHADER };
  material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
  return shader;
}


describe("the inside of a head", () => {
  it("is drawn only for a fighter, whose head can be cut open, and a whole head's back faces do no work", () => {
    const fighterHead = new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8 });
    const referee = new SkinnedBoxer(gltf, { skin: 0xc79b76, gear: 0x3b57b8, outfit: REFEREE_OUTFIT });
    const headOf = (boxer: SkinnedBoxer): THREE.Material => {
      let found: THREE.Material | null = null;
      boxer.root.traverse((object) => { if (object instanceof THREE.SkinnedMesh && object.name === "BoxerHead") found = object.material as THREE.Material; });
      return found!;
    };
    expect(headOf(fighterHead).side).toBe(THREE.DoubleSide);
    expect(headOf(referee).side).toBe(THREE.FrontSide);
    const material = new THREE.MeshStandardMaterial();
    new InjuryShading(material, HEAD_SITES);
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: SHADER.vertexShader, fragmentShader: "#include <common>\nvoid main() {\n#include <clipping_planes_fragment>\n#include <map_fragment>\n#include <roughnessmap_fragment>\n}" };
    material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
    const lines = shader.fragmentShader.split("\n");
    expect(lines[lines.indexOf("#include <clipping_planes_fragment>") + 1]).toMatch(/^if \(!gl_FrontFacing && uInjurySever >= \d+\.0\) discard;$/u);
  });
});

const trauma = (values: Partial<TraumaSnapshot>): TraumaSnapshot => ({ head: 0, body: 0, left_eye: 0, right_eye: 0, left_cut: 0, right_cut: 0, swelling: 0, bleeding: 0, ...values });

describe("swelling", () => {
  it("pushes tissue out from inside the skull, so the hollow round an eye cannot fold over itself", () => {
    const boxer = new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8 });
    const head = compile(boxer.headMesh.material as THREE.Material);
    expect(head.vertexShader).toContain("transformed += normalize(transformed - injuryCore");
    expect(head.vertexShader).not.toContain("objectNormal * injurySwell");
    const core = boxer.headInjury.uniforms.uInjuryCore.value;
    expect(core.w).toBe(0);
    // Inside the head mesh's bounds (x -10.6..10.3, y 104.6..128.9, z -11.4..6.7) and behind the eyes.
    expect(Math.abs(core.x)).toBeLessThan(1);
    expect(core.y).toBeGreaterThan(114);
    expect(core.y).toBeLessThan(124);
    expect(core.z).toBeLessThan(EYE_LIDS[0]![2] - 5);
    // The body swells out from the spine.
    expect(boxer.bodyInjury.uniforms.uInjuryCore.value.w).toBe(1);
    boxer.dispose();
  });

  it("swells a beaten eye into a two-centimetre mound that still folds no triangle of the face", () => {
    const shading = new InjuryShading(new THREE.MeshStandardMaterial(), HEAD_SITES);
    applyHeadTrauma(shading, trauma({ head: 1400, left_eye: 1000, right_eye: 1000, left_cut: 1000, right_cut: 1000, swelling: 1000, bleeding: 1000 }), "full");
    expect(Math.max(...shading.uniforms.uInjurySwell.value)).toBe(EYE_SWELL);
    expect(EYE_SWELL).toBe(2);
    expect(shading.level("rightCheek").swell).toBeCloseTo(CHEEK_SWELL, 6);
    // The vertex shader's push, out from the skull's core, on the real head at the worst of it.
    const boxer = new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8 });
    const position = boxer.headMesh.geometry.getAttribute("position");
    const index = boxer.headMesh.geometry.getIndex()!;
    const core = new THREE.Vector3(...HEAD_SWELL_CORE.slice(0, 3) as [number, number, number]);
    const smooth = (edge: number, x: number): number => {
      const t = THREE.MathUtils.clamp(x / edge, 0, 1);
      return t * t * (3 - 2 * t);
    };
    const swollen = Array.from({ length: position.count }, (_, vertex) => {
      const at = new THREE.Vector3().fromBufferAttribute(position, vertex);
      let push = 0;
      for (const [site, place] of HEAD_SITES.entries()) {
        const weight = 1 - smooth(place.radius * 1.15, at.distanceTo(new THREE.Vector3(...place.position)));
        push += shading.uniforms.uInjurySwell.value[site]! * weight * weight;
      }
      return at.clone().addScaledVector(at.clone().sub(core).add(new THREE.Vector3(0, 0, 0.001)).normalize(), push);
    });
    let face = 0;
    let folded = 0;
    const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    for (let corner = 0; corner < index.count; corner += 3) {
      const [i, j, k] = [index.getX(corner), index.getX(corner + 1), index.getX(corner + 2)];
      a.fromBufferAttribute(position, i);
      b.fromBufferAttribute(position, j);
      c.fromBufferAttribute(position, k);
      // The front of the face, from the jaw up.
      if ((a.y + b.y + c.y) / 3 < 113 || (a.z + b.z + c.z) / 3 < -1) continue;
      const before = b.clone().sub(a).cross(c.clone().sub(a));
      const after = swollen[j]!.clone().sub(swollen[i]!).cross(swollen[k]!.clone().sub(swollen[i]!));
      if (before.lengthSq() < 1e-12) continue;
      face += 1;
      if (before.dot(after) <= 0) folded += 1;
    }
    expect(face).toBeGreaterThan(2000);
    expect(folded).toBe(0);
    boxer.dispose();
  });

  it("opens a cheek cut wide before the doctor stops the bout, and splits a forehead swollen for a round or two", () => {
    const shading = new InjuryShading(new THREE.MeshStandardMaterial(), HEAD_SITES);
    // The doctor stops a bout at a cut of 800.
    applyHeadTrauma(shading, trauma({ left_cut: 760, swelling: 450 }), "full");
    expect(shading.level("leftCheek").cut).toBe(1);
    expect(shading.level("forehead").cut).toBeGreaterThan(0.15);
    expect(shading.level("forehead").blood).toBeGreaterThan(0.15);
    applyHeadTrauma(shading, trauma({ left_cut: 300, swelling: 360 }), "full");
    expect(shading.level("leftCheek").cut).toBe(0);
    expect(shading.level("forehead").cut).toBe(0);
  });
});

describe("an eye swelling shut", () => {
  it("starts to close once the eye has taken a beating and is fully shut at the eye damage that shuts it", () => {
    expect(EYE_SHUT_TRAUMA).toBe(700);
    expect(eyeShut(0, 0)).toBe(0);
    expect(eyeShut(330, 200)).toBe(0);
    expect(eyeShut(500, 0)).toBeGreaterThan(0.3);
    expect(eyeShut(500, 0)).toBeLessThan(0.7);
    expect(eyeShut(EYE_SHUT_TRAUMA, 0)).toBe(1);
    expect(eyeShut(EYE_SHUT_TRAUMA - 1, 0)).toBeLessThan(1);
    expect(eyeShut(700, 200)).toBe(1);
    expect(eyeShut(500, 800)).toBeGreaterThan(eyeShut(500, 0));
    expect(eyeShut(1000, 1000)).toBe(1);
  });

  it("closes each eye from its own damage", () => {
    const shading = new InjuryShading(new THREE.MeshStandardMaterial(), HEAD_SITES, { core: [0, 119, -3.5, 0], lids: EYE_LIDS });
    applyHeadTrauma(shading, trauma({ left_eye: 720, right_eye: 120 }), "full");
    expect(shading.eyesShut[0]).toBe(1);
    expect(shading.eyesShut[1]).toBe(0);
    shading.clear();
    expect(shading.eyesShut).toEqual([0, 0]);
  });

  it("draws lids only where there are eyes", () => {
    const boxer = new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8 });
    boxer.headInjury.setEyesShut(1, 0.5);
    expect(boxer.headInjury.eyesShut).toEqual([1, 0.5]);
    boxer.bodyInjury.setEyesShut(1, 1);
    expect(boxer.bodyInjury.eyesShut).toEqual([0, 0]);
    const head = compile(boxer.headMesh.material as THREE.Material);
    expect(head.uniforms.uInjuryLid).toBe(boxer.headInjury.uniforms.uInjuryLid);
    expect(head.fragmentShader).toContain("uniform vec4 uInjuryLid[2];");
    boxer.dispose();
  });

  it("puts blood over a closed lid, not the lid over the blood", () => {
    const head = compile(new InjuryShading(new THREE.MeshStandardMaterial(), HEAD_SITES).material!);
    const lids = head.fragmentShader.indexOf("vec4 lid = uInjuryLid[e];");
    const streams = head.fragmentShader.indexOf("float blood = uInjuryBlood[i];");
    expect(lids).toBeGreaterThan(0);
    expect(streams).toBeGreaterThan(lids);
  });
});

describe("blood running from a wound", () => {
  it("splits into a second rivulet only once it runs freely", () => {
    const head = compile(new InjuryShading(new THREE.MeshStandardMaterial(), HEAD_SITES).material!);
    expect(head.fragmentShader).toContain("if (fk > 0.5 && blood < 0.45) break;");
  });

  it("is washed broad across the body by sweat, and only the body", () => {
    const boxer = new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8 });
    expect(boxer.bodyInjury.uniforms.uInjuryWash.value).toBe(1);
    expect(boxer.headInjury.uniforms.uInjuryWash.value).toBe(0);
    expect(new InjuryShading(new THREE.MeshStandardMaterial(), BODY_SITES, { core: [0, 0, -2, 1] }).uniforms.uInjuryWash.value).toBe(0);
    boxer.dispose();
  });
});

describe("a cut with blood off", () => {
  it("is still drawn, as a closed dark line with no raw lips and nothing wet, and bleeds nowhere", () => {
    const shading = new InjuryShading(new THREE.MeshStandardMaterial(), HEAD_SITES, { core: HEAD_SWELL_CORE, lids: EYE_LIDS });
    const beaten = trauma({ head: 600, left_eye: 500, right_eye: 300, left_cut: 300, right_cut: 120, swelling: 400, bleeding: 120 });
    applyHeadTrauma(shading, beaten, "off");
    expect(shading.level("leftBrow").cut).toBe(1);
    expect(shading.level("mouth").cut).toBeGreaterThan(0.2);
    for (const site of HEAD_SITES) expect(shading.level(site.name).blood).toBe(0);
    expect(shading.uniforms.uInjuryRaw.value).toBe(0);
    applyHeadTrauma(shading, beaten, "reduced");
    expect(shading.uniforms.uInjuryRaw.value).toBeGreaterThan(0);
    expect(shading.uniforms.uInjuryRaw.value).toBeLessThan(1);
    applyHeadTrauma(shading, beaten, "full");
    expect(shading.uniforms.uInjuryRaw.value).toBe(1);
    // The raw lips, the width of the gash and its wetness all go with it.
    const head = compile(shading.material!);
    expect(head.uniforms.uInjuryRaw).toBe(shading.uniforms.uInjuryRaw);
    expect(head.fragmentShader).toContain("float lip = (1.0 - smoothstep(0.1 * taper, (0.22 + cut * 0.12) * taper, slit)) * (1.0 - gash) * uInjuryRaw;");
    expect(head.fragmentShader).toContain("(0.03 + cut * 0.05 * uInjuryRaw) * taper");
    expect(head.fragmentShader).toContain("injuryWet = max(injuryWet, cut * max(gash, lip * 0.6) * uInjuryRaw);");
  });
});

describe("blood in the trunks", () => {
  it("runs in from a fighter's own bleeding, lighter with reduced blood and never with blood off", () => {
    expect(trunksBloodFor(trauma({ bleeding: 30, left_cut: 60 }), "full")).toBe(0);
    const bleeding = trauma({ bleeding: 300, left_cut: 300, right_cut: 150 });
    expect(trunksBloodFor(bleeding, "full")).toBeGreaterThan(0.6);
    expect(trunksBloodFor(bleeding, "reduced")).toBeLessThan(trunksBloodFor(bleeding, "full") * 0.5);
    expect(trunksBloodFor(bleeding, "off")).toBe(0);
    expect(trunksBloodFor(trauma({ bleeding: 1000, left_cut: 1000, right_cut: 1000 }), "full")).toBe(1);
  });

  it("soaks the front of the waistband down, a part of the trunks shader of its own", () => {
    const trunks = new THREE.MeshStandardMaterial();
    const blood = wearCornerColour(trunks, false, "trunks");
    expect(trunks.defines).toHaveProperty("GEAR_TRUNKS");
    expect(compile(trunks).uniforms.uGearBlood).toBe(blood);
    const gloves = new THREE.MeshStandardMaterial();
    wearCornerColour(gloves);
    expect(gloves.defines ?? {}).not.toHaveProperty("GEAR_TRUNKS");
  });

  it("follows the fighter's bleeding through the graph", () => {
    const boxer = new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8 });
    const graph = new BoxingGraph(boxer, mapping);
    const one = { ...fighter("one"), x: 0, y: 0, facing_x: 0, facing_y: -1000 };
    const two = { ...fighter("two"), x: 0, y: -150, facing_x: 0, facing_y: 1000 };
    graph.update(one, two, 1 / 60, 0, false, "full", 1, undefined);
    expect(boxer.trunksBloodLevel).toBe(0);
    graph.update({ ...one, trauma: trauma({ bleeding: 460, left_cut: 300 }) }, two, 1 / 60, 0.02, false, "full", 2, undefined);
    expect(boxer.trunksBloodLevel).toBeGreaterThan(0.9);
    graph.update({ ...one, trauma: trauma({ bleeding: 460, left_cut: 300 }) }, two, 1 / 60, 0.04, false, "off", 3, undefined);
    expect(boxer.trunksBloodLevel).toBe(0);
    graph.dispose();
  });
});
