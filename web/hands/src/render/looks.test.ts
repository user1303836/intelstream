import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Effects3D } from "./effects";
import { SkinnedBoxer, loadBoxerGlb } from "./graph";
import { LookShading, OFFICIAL_LOOKS, SCANNED_LOOK, lookFor, type FighterLook } from "./looks";
import { REFEREE_OUTFIT } from "./outfit";
import { aboveNeckCut, bakeSkinnedPart } from "./renderer";

const gltf = await loadBoxerGlb();

const SHADER = {
  vertexShader: "#include <common>\n#include <begin_vertex>\n#include <morphtarget_vertex>",
  fragmentShader: "#include <common>\n#include <map_fragment>",
};

function compile(material: THREE.Material): { uniforms: Record<string, { value: unknown }>; vertexShader: string; fragmentShader: string } {
  const shader = { uniforms: {} as Record<string, { value: unknown }>, ...SHADER };
  material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
  return shader;
}

describe("a player's look", () => {
  it("is the same every time for the same player", () => {
    expect(lookFor("123456789012345678")).toEqual(lookFor("123456789012345678"));
  });

  it("stays within what the face can take", () => {
    for (let player = 0; player < 500; player += 1) {
      const look = lookFor(String(200000000000000000 + player * 104729));
      for (const value of [look.jaw, look.nose, look.brow, look.skull]) {
        expect(value).toBeGreaterThanOrEqual(-1);
        expect(value).toBeLessThanOrEqual(1);
      }
      expect([0, 1]).toContain(look.shaved);
      expect(look.beard === 0 || (look.beard >= 0.35 && look.beard <= 1)).toBe(true);
    }
  });

  it("differs from player to player", () => {
    const looks = new Set<string>();
    const tints = new Set<number>();
    const hair = new Set<number>();
    let shaved = 0;
    let bearded = 0;
    const players = 400;
    for (let player = 0; player < players; player += 1) {
      const look = lookFor(String(300000000000000000 + player * 7919));
      looks.add(JSON.stringify(look));
      tints.add(look.tint);
      hair.add(look.hair);
      shaved += look.shaved;
      bearded += look.beard > 0 ? 1 : 0;
    }
    expect(looks.size).toBe(players);
    expect(tints.size).toBeGreaterThanOrEqual(6);
    expect(hair.size).toBeGreaterThanOrEqual(7);
    expect(shaved / players).toBeGreaterThan(0.15);
    expect(shaved / players).toBeLessThan(0.45);
    expect(bearded / players).toBeGreaterThan(0.35);
    expect(bearded / players).toBeLessThan(0.75);
  });
});

describe("look shading", () => {
  const look: FighterLook = { tint: 0xa38a7c, hair: 0x6e3420, shaved: 1, beard: 0.6, jaw: 0.5, nose: -0.25, brow: 0.75, skull: -1 };

  it("keeps a shader patch that was already on the material and runs before it", () => {
    const material = new THREE.MeshStandardMaterial();
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", "#include <map_fragment>\n// earlier patch");
      shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n// earlier vertex patch");
    };
    material.customProgramCacheKey = () => "earlier";
    new LookShading(material).set(look);
    const shader = compile(material);
    expect(shader.fragmentShader.indexOf("lookHairZone(p)")).toBeGreaterThan(0);
    expect(shader.fragmentShader.indexOf("lookHairZone(p)")).toBeLessThan(shader.fragmentShader.indexOf("// earlier patch"));
    expect(shader.vertexShader.indexOf("// earlier vertex patch")).toBeLessThan(shader.vertexShader.indexOf("uLookFace.x"));
    expect(material.customProgramCacheKey()).toBe("earlier-look-live");
  });

  it("carries the look in its uniforms and the skin tone in the material colour", () => {
    const material = new THREE.MeshStandardMaterial();
    const shading = new LookShading(material);
    shading.set(look);
    const { uniforms } = compile(material);
    expect((uniforms.uLookHair!.value as THREE.Color).getHex()).toBe(0x6e3420);
    expect((uniforms.uLookFace!.value as THREE.Vector4).toArray()).toEqual([0.5, -0.25, 0.75, -1]);
    expect((uniforms.uLookGroom!.value as THREE.Vector2).toArray()).toEqual([1, 0.6]);
    expect(material.color.getHex()).toBe(0xa38a7c);
    expect(shading.look).toBe(look);
  });

  it("reads bind positions from an attribute and leaves the shape alone on a baked part", () => {
    const material = new THREE.MeshStandardMaterial();
    new LookShading(material, true);
    const shader = compile(material);
    expect(shader.vertexShader).toContain("attribute vec3 bindPosition;");
    expect(shader.vertexShader).toContain("vLookPos = bindPosition;");
    expect(shader.vertexShader).not.toContain("uLookFace.x");
    expect(material.customProgramCacheKey()).toBe("plain-look-baked");
  });
});

describe("a fighter wearing a look", () => {
  it("takes the skin tone on the head and the body and can change it", () => {
    const boxer = new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8 });
    expect(boxer.look).toBe(SCANNED_LOOK);
    const look = lookFor("987654321098765432");
    boxer.setLook(look);
    expect(boxer.look).toBe(look);
    expect(boxer.skin.color.getHex()).toBe(look.tint);
    expect((boxer.headMesh.material as THREE.MeshStandardMaterial).color.getHex()).toBe(look.tint);
    boxer.root.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh && object.name === "BoxerBody") expect((object.material as THREE.MeshStandardMaterial).color.getHex()).toBe(look.tint);
    });
    boxer.dispose();
  });

  it("gives an official bare hands in the official's skin tone", () => {
    const boxer = new SkinnedBoxer(gltf, { skin: 0xc79b76, gear: 0x1b2230, look: OFFICIAL_LOOKS.blueCorner, outfit: REFEREE_OUTFIT });
    const hand = boxer.rig.bones.gloveL.getObjectByName("hand-left") as THREE.Mesh;
    const shown = (hand.material as THREE.MeshStandardMaterial).color;
    const dark = shown.r + shown.g + shown.b;
    boxer.setLook(OFFICIAL_LOOKS.redCorner);
    expect(shown.r + shown.g + shown.b).toBeGreaterThan(dark * 1.5);
    boxer.dispose();
  });

  it("keeps its hair and beard on a severed head", () => {
    const boxer = new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8, look: lookFor("dave") });
    boxer.root.updateMatrixWorld(true);
    const pivot = boxer.bone("head")!;
    const baked = { ...bakeSkinnedPart(boxer.headMesh, pivot.getWorldPosition(new THREE.Vector3()), pivot.getWorldQuaternion(new THREE.Quaternion()), aboveNeckCut), look: boxer.look };
    const bind = baked.geometry.getAttribute("bindPosition");
    const source = boxer.headMesh.geometry.getAttribute("position");
    expect(bind.count).toBe(source.count);
    expect(bind.getY(100)).toBe(source.getY(100));
    expect(bind.array).not.toBe(source.array);
    const scene = new THREE.Scene();
    const effects = new Effects3D(scene);
    effects.decapitate(0, new THREE.Vector3(0, 1.5, 0), new THREE.Quaternion(), 1, 12, 0xb0703f, baked);
    const head = scene.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh && child.geometry === baked.geometry)!;
    const material = head.material as THREE.MeshStandardMaterial;
    expect(material.color.getHex()).toBe(lookFor("dave").tint);
    const { uniforms } = compile(material);
    expect((uniforms.uLookHair!.value as THREE.Color).getHex()).toBe(lookFor("dave").hair);
    expect((uniforms.uLookGroom!.value as THREE.Vector2).x).toBe(lookFor("dave").shaved);
    effects.dispose();
    boxer.dispose();
  });
});
