import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Effects3D } from "./effects";
import { SkinnedBoxer, loadBoxerGlb } from "./graph";
import { LOOK_GROOM_GLSL, LOOK_MASKS_GLSL, LOOK_SHAPE_GLSL, LookShading, OFFICIAL_LOOKS, SCANNED_LOOK, lookFor, lookShape, type FighterLook } from "./looks";
import { REFEREE_OUTFIT } from "./outfit";
import { aboveNeckCut, bakeSkinnedPart, measureBurstStump } from "./renderer";

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

/**
 * Runs the groom's own shader text for one texel, a colour channel at a time: each colour is a vec3 whose
 * arithmetic gives that channel, while positions are only read by component or measured whole.
 */
function groomed(texel: number, tint: number, look: FighterLook, at: THREE.Vector3): THREE.Color {
  const js = (glsl: string): string => glsl
    .replace(/^\s*(uniform|varying|attribute)\b.*$/gm, "")
    .replace(/^#.*$/gm, "")
    .replace(/\bfloat (\w+)\(vec3 (\w+)\)/g, "function $1($2)")
    .replace(/\b(float|vec3) (?=\w+\s*=)/g, "let ");
  const run = new Function("channel", "colours", `
    const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
    const max = Math.max;
    const mix = (a, b, t) => +a + (+b - +a) * t;
    const abs = Math.abs;
    const sin = Math.sin;
    const vec3 = (x, y, z) => ({ x, y, z, valueOf: () => [x, y, z][channel] });
    const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
    const length = (v) => Math.hypot(v.x, v.y, v.z);
    const colour = (c) => vec3(c.r, c.g, c.b);
    const uLookHair = colour(colours.hair);
    const diffuse = colour(colours.tint);
    const uLookGroom = colours.groom;
    const vLookPos = colours.at;
    const sampledDiffuseColor = { rgb: colour(colours.texel) };
    const diffuseColor = { rgb: vec3(colours.tint.r * colours.texel.r, colours.tint.g * colours.texel.g, colours.tint.b * colours.texel.b) };
    ${js(LOOK_MASKS_GLSL)}
    ${js(LOOK_GROOM_GLSL)}
    return +diffuseColor.rgb;
  `) as (channel: number, colours: Record<string, unknown>) => number;
  const colours = {
    hair: new THREE.Color(look.hair), tint: new THREE.Color(tint), texel: new THREE.Color(texel),
    groom: { x: look.shaved, y: look.beard }, at: { x: at.x, y: at.y, z: at.z },
  };
  return new THREE.Color(run(0, colours), run(1, colours), run(2, colours));
}

describe("grooming on every skin tone", () => {
  const darkest = 0x6f5548;
  // A dark texel of the scanned hair on the crown, and one of the skin along the jaw under a beard.
  const crown = new THREE.Vector3(0, 127.6, -3);
  const jaw = new THREE.Vector3(4.6, 112.8, 1.4);
  const hairTexel = 0x2a1d16;
  const skinTexel = 0xd7a184;
  const close = (a: THREE.Color, b: THREE.Color, within: number): void => {
    for (const channel of ["r", "g", "b"] as const) expect(Math.abs(a[channel] - b[channel])).toBeLessThanOrEqual(within * Math.max(a[channel], b[channel]) + 1e-6);
  };

  it("dyes the hair the same colour on the darkest skin as on the scanned man", () => {
    for (const hair of [0x8c8a86, 0xa88c58]) {
      const look: FighterLook = { ...SCANNED_LOOK, hair, shaved: 0, beard: 0 };
      close(groomed(hairTexel, darkest, look, crown), groomed(hairTexel, 0xffffff, look, crown), 0.05);
    }
  });

  it("grows a beard of the hair's colour, with the skin's own tone showing through", () => {
    const look: FighterLook = { ...SCANNED_LOOK, hair: 0xa88c58, shaved: 0, beard: 1 };
    // Over a black texel only the beard itself shows: most of it is the dye, whatever the skin.
    const pale = groomed(0x000000, 0xffffff, look, jaw);
    const dark = groomed(0x000000, darkest, look, jaw);
    expect(pale.r).toBeGreaterThan(0.05);
    for (const channel of ["r", "g", "b"] as const) expect(dark[channel]).toBeGreaterThan(0.7 * pale[channel]);
    // Without one, the jaw is just the tinted skin.
    const bare = groomed(skinTexel, darkest, { ...look, beard: 0 }, jaw);
    close(bare, new THREE.Color(skinTexel).multiply(new THREE.Color(darkest)), 0.001);
  });

  it("tints a shaved scalp with the skin", () => {
    const look: FighterLook = { ...SCANNED_LOOK, hair: 0x8c8a86, shaved: 1, beard: 0 };
    const pale = groomed(hairTexel, 0xffffff, look, crown);
    const dark = groomed(hairTexel, darkest, look, crown);
    const tint = new THREE.Color(darkest);
    close(dark, new THREE.Color(pale.r * tint.r, pale.g * tint.g, pale.b * tint.b), 0.001);
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

  it("keeps an official's hands and cuffs out of the shadow map, where they are too small to show", () => {
    const boxer = new SkinnedBoxer(gltf, { skin: 0xc79b76, gear: 0x1b2230, look: OFFICIAL_LOOKS.referee, outfit: REFEREE_OUTFIT });
    const parts: THREE.Mesh[] = [];
    boxer.root.traverse((object) => { if (object instanceof THREE.Mesh && /^(hand|cuff)-/u.test(object.name)) parts.push(object); });
    expect(parts).toHaveLength(4);
    for (const part of parts) expect(part.castShadow).toBe(false);
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

/** Runs the shader's own text in JavaScript: its scalar GLSL is valid JavaScript once the types are dropped. */
function shaderShape(): (position: THREE.Vector3, look: FighterLook) => { x: number; y: number; z: number } {
  const js = (glsl: string): string => glsl
    .replace(/^\s*(uniform|varying|attribute)\b.*$/gm, "")
    .replace(/\bfloat (\w+)\(vec3 (\w+)\)/g, "function $1($2)")
    .replace(/\b(float|vec3) (?=\w+\s*=)/g, "let ");
  const run = new Function("position", "uLookFace", "uLookGroom", `
    const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const mix = (a, b, t) => a + (b - a) * t;
    const abs = Math.abs;
    const vec3 = (x, y, z) => ({ x, y, z });
    const distance = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
    const normalize = (v) => { const l = Math.hypot(v.x, v.y, v.z); return { x: v.x / l, y: v.y / l, z: v.z / l }; };
    let vLookPos;
    ${js(LOOK_MASKS_GLSL)}
    const transformed = { x: position.x, y: position.y, z: position.z };
    ${js(LOOK_SHAPE_GLSL)}
    return transformed;
  `) as (position: THREE.Vector3, face: { x: number; y: number; z: number; w: number }, groom: { x: number; y: number }) => { x: number; y: number; z: number };
  return (position, look) => run(position, { x: look.jaw, y: look.nose, z: look.brow, w: look.skull }, { x: look.shaved, y: look.beard });
}

describe("a head's shape off the GPU", () => {
  const looks: FighterLook[] = [SCANNED_LOOK, lookFor("dave"), lookFor("erin"), ...Object.values(OFFICIAL_LOOKS), { ...SCANNED_LOOK, shaved: 1, jaw: 1, nose: -1, brow: 1, skull: -1 }];

  it("is the shader's own reshaping, for every look and all over the head", () => {
    const shader = shaderShape();
    const point = new THREE.Vector3();
    const out = new THREE.Vector3();
    let checked = 0;
    for (const look of looks) {
      for (let y = 104; y <= 128; y += 1.5) {
        for (let x = -8; x <= 8; x += 2) {
          for (let z = -8; z <= 7; z += 2.5) {
            const expected = shader(point.set(x, y, z), look);
            lookShape(point, look, out);
            expect(out.x).toBeCloseTo(expected.x, 9);
            expect(out.y).toBeCloseTo(expected.y, 9);
            expect(out.z).toBeCloseTo(expected.z, 9);
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(5000);
  });

  it("leaves the scanned man's head as it is", () => {
    const out = new THREE.Vector3();
    expect(lookShape(new THREE.Vector3(4, 111, 2), SCANNED_LOOK, out).toArray()).toEqual([4, 111, 2]);
  });

  it("keeps the owner's jaw, nose, brow and skull on a severed head", () => {
    const look = { ...lookFor("dave"), jaw: 1, nose: 1, brow: 1, skull: 1, shaved: 1 };
    const boxer = new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8, look });
    boxer.root.updateMatrixWorld(true);
    const pivot = boxer.bone("head")!;
    const at = pivot.getWorldPosition(new THREE.Vector3());
    const turn = pivot.getWorldQuaternion(new THREE.Quaternion());
    const shaped = bakeSkinnedPart(boxer.headMesh, at, turn, aboveNeckCut, look);
    const plain = bakeSkinnedPart(boxer.headMesh, at, turn, aboveNeckCut);
    const bind = boxer.headMesh.geometry.getAttribute("position");
    const inverse = turn.clone().invert();
    const expected = new THREE.Vector3();
    const baked = new THREE.Vector3();
    let moved = 0;
    for (let vertex = 0; vertex < bind.count; vertex += 211) {
      lookShape(expected.fromBufferAttribute(bind, vertex), look, expected);
      boxer.headMesh.applyBoneTransform(vertex, expected).applyMatrix4(boxer.headMesh.matrixWorld).sub(at).applyQuaternion(inverse);
      baked.fromBufferAttribute(shaped.geometry.getAttribute("position"), vertex);
      expect(baked.distanceTo(expected)).toBeLessThan(1e-6);
      if (baked.distanceTo(new THREE.Vector3().fromBufferAttribute(plain.geometry.getAttribute("position"), vertex)) > 1e-4) moved += 1;
    }
    expect(moved).toBeGreaterThan(3);
    for (const part of [shaped, plain]) part.geometry.dispose();
    boxer.dispose();
  });
});

describe("wounds on a reshaped head", () => {
  it("are measured on the head as it is drawn, reshaped by the fighter's look", () => {
    const rimFor = (look: FighterLook): Float32Array => {
      const boxer = new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8, look });
      const out = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), across: new THREE.Vector3(), scratch: new THREE.Vector3() };
      const rim = measureBurstStump(boxer, new Float32Array(0), out)!;
      boxer.dispose();
      return rim;
    };
    const plain = rimFor(SCANNED_LOOK);
    const wide = rimFor({ ...SCANNED_LOOK, jaw: 1 });
    expect(wide.length).toBe(plain.length);
    let moved = 0;
    for (let index = 0; index < plain.length; index += 1) if (Math.abs(wide[index]! - plain[index]!) > 1e-4) moved += 1;
    expect(moved).toBeGreaterThan(plain.length / 6);
  });
});

describe("a severed glove", () => {
  it("keeps the blood that was on it and loses it when the hand is put back", () => {
    const scene = new THREE.Scene();
    const effects = new Effects3D(scene);
    const geometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    geometry.setAttribute("bindPosition", geometry.getAttribute("position").clone());
    effects.dismemberHand(0, "left", new THREE.Vector3(0, 1.2, 0), new THREE.Quaternion(), 1, 21, 0x1d4ed8, { geometry, map: null, color: 0x1d4ed8, gloveBlood: 0.7 });
    const hand = scene.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh && child.geometry === geometry)!;
    const blood = () => compile(hand.material as THREE.Material).uniforms.uGearBlood!.value;
    expect(blood()).toBeCloseTo(0.7, 6);
    effects.restoreFighter(0);
    effects.dismemberHand(0, "left", new THREE.Vector3(0, 1.2, 0), new THREE.Quaternion(), 1, 22, 0x1d4ed8);
    expect(blood()).toBe(0);
    effects.dispose();
  });
});
