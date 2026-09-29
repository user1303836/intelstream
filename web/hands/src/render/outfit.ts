import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Hand } from "../types";

/**
 * Clothing for the ring officials, who share the fighter's body.
 *
 * The cloth is drawn in the mesh's bind space, like the injuries: a collar line on the neck, sleeves
 * measured along the arms, trousers below the waist. The vertex stage rounds off the muscle shading
 * under the cloth, turns the lower legs and boot shafts into trouser legs and narrows the trunks to
 * meet them. Hands replace the boxing gloves.
 */

export type OutfitPart = "head" | "body" | "shoes" | "pants";

export interface OfficialOutfit {
  readonly shirt: number;
  readonly trousers: number;
  readonly shoes: number;
  /** Bow tie, buttons and belt. */
  readonly accent: number;
  readonly sleeves: "long" | "short";
  readonly bowTie: boolean;
  /** Examination glove colour, or null for bare hands. */
  readonly gloves: number | null;
}

export const REFEREE_OUTFIT: OfficialOutfit = { shirt: 0xa9c1e6, trousers: 0x111318, shoes: 0x0b0b0d, accent: 0x08080a, sleeves: "long", bowTie: true, gloves: null };
export const BLUE_CORNER_OUTFIT: OfficialOutfit = { shirt: 0x23408f, trousers: 0x14161c, shoes: 0x0b0b0d, accent: 0x0c0d12, sleeves: "long", bowTie: false, gloves: null };
export const RED_CORNER_OUTFIT: OfficialOutfit = { shirt: 0x8f2323, trousers: 0x14161c, shoes: 0x0b0b0d, accent: 0x0c0d12, sleeves: "long", bowTie: false, gloves: null };
export const CUTMAN_OUTFIT: OfficialOutfit = { shirt: 0xb4b8c0, trousers: 0x14161c, shoes: 0x0b0b0d, accent: 0x0c0d12, sleeves: "short", bowTie: false, gloves: 0x4f8fd0 };

/** Where the forearm mesh ends, along the arm in bind space. */
const FOREARM_END = 43.4;
const SHORT_SLEEVE_END = 25;
const SHIRT_LIFT = 0.35;

const SHARED = /* glsl */ `
uniform vec4 uOutfitShape;
float outfitCollar(vec3 p) { return mix(111.0, 109.2, smoothstep(-8.0, 0.5, p.z)); }
vec2 outfitLegAxis(float y, float side) {
  float x = mix(9.2, 8.1, smoothstep(30.0, 40.0, y));
  x = mix(x, 7.8, smoothstep(40.0, 47.0, y));
  float z = mix(-10.3, -9.0, smoothstep(21.0, 30.0, y));
  z = mix(z, -4.7, smoothstep(30.0, 40.0, y));
  z = mix(z, -3.4, smoothstep(40.0, 47.0, y));
  return vec2(side * x, z);
}
vec2 outfitArmAxis(float along) {
  float upper = clamp((along - 14.1) / 16.9, 0.0, 1.0);
  float lower = clamp((along - 31.0) / 16.0, 0.0, 1.0);
  return vec2(mix(103.9, 102.8, upper) - 3.6 * lower, mix(-5.1, -5.2, upper) + 3.8 * lower);
}
/** Centre (z) and half axes of the torso's cross-section at a height. */
vec3 outfitTorso(float y) {
  float centre = mix(mix(-0.2, -2.8, smoothstep(80.0, 97.0, y)), -4.2, smoothstep(98.0, 107.0, y));
  float wide = mix(11.6, 15.4, smoothstep(80.0, 100.0, y));
  float deep = mix(mix(7.5, 9.1, smoothstep(80.0, 98.0, y)), 7.5, smoothstep(100.0, 108.0, y));
  return vec3(centre, wide, deep);
}
float outfitNeckReach(vec3 p) { return length(vec2(p.x, p.z + 4.6)); }
`;

const CLOTH_MASK: Record<OutfitPart, string> = {
  head: "1.0 - smoothstep(outfitCollar(p) - 0.3, outfitCollar(p) + 0.3, p.y)",
  body: "p.y < 60.0 ? 1.0 : 1.0 - smoothstep(uOutfitShape.x - 0.4, uOutfitShape.x + 0.4, abs(p.x))",
  shoes: "smoothstep(9.0, 11.0, p.y)",
  pants: "1.0",
};

const vertexDeclarations = (part: OutfitPart): string => /* glsl */ `
${SHARED}
varying vec3 vOutfitPos;
vec3 outfitBindNormal = vec3(0.0, 1.0, 0.0);
float outfitClothAt(vec3 p) { return ${CLOTH_MASK[part]}; }
vec3 outfitRounded(vec3 p, vec3 n) {
  if (p.y < 60.0) {
    vec2 radial = normalize(p.xz - outfitLegAxis(p.y, sign(p.x)) + vec2(1e-4));
    return normalize(vec3(radial.x, n.y * 0.3, radial.y));
  }
  vec3 shape = outfitTorso(p.y);
  float planar = length(n.xz);
  vec2 ring = vec2(p.x, p.z - shape.x) / shape.yz;
  ring = normalize(ring * ring * ring / shape.yz + vec2(0.0, 1e-5));
  float lift = smoothstep(99.0, 106.0, p.y);
  vec3 torso = normalize(vec3(ring.x * mix(1.0, planar, lift), n.y * lift, ring.y * mix(1.0, planar, lift)));
  vec2 centre = outfitArmAxis(abs(p.x));
  vec2 around = normalize(vec2(p.y - centre.x, p.z - centre.y) + vec2(1e-4));
  vec3 arm = normalize(vec3(n.x * 0.25, around.x, around.y));
  return normalize(mix(torso, arm, smoothstep(11.0, 17.0, abs(p.x))));
}
/** Cloth hangs from the high points: hollows in the torso and arms are filled out to a smooth drape. */
vec3 outfitDraped(vec3 p, vec3 at, float cloth) {
  vec3 shape = outfitTorso(p.y);
  vec2 offset = vec2(p.x, p.z - shape.x);
  float reach = max(length(offset), 1e-3);
  vec2 toward = offset / reach;
  vec2 squared = toward * toward / (shape.yz * shape.yz);
  float rim = 1.0 / sqrt(sqrt(dot(squared, squared)));
  float torso = (1.0 - smoothstep(10.5, 15.0, abs(p.x))) * (1.0 - smoothstep(104.0, 108.0, p.y)) * cloth;
  at.xz += toward * (max(reach, rim) - reach) * torso;
  float along = abs(p.x);
  vec2 centre = outfitArmAxis(along);
  vec2 around = vec2(p.y - centre.x, p.z - centre.y);
  float span = max(length(around), 1e-3);
  float sleeve = mix(5.1, 3.3, smoothstep(30.0, 43.0, along));
  float arm = smoothstep(15.0, 19.0, along) * cloth;
  at.yz += around / span * (max(span, sleeve) - span) * arm;
  return at;
}
`;

const VERTEX_NORMAL = /* glsl */ `
{
  vec3 p = position;
  float cloth = outfitClothAt(p);
  objectNormal = normalize(mix(objectNormal, outfitRounded(p, objectNormal), 0.97 * cloth));
  outfitBindNormal = objectNormal;
}
`;

const TROUSER_LEG = /* glsl */ `
  float side = sign(p.x);
  vec2 axis = outfitLegAxis(p.y, side);
  vec2 offset = transformed.xz - axis;
  float reach = max(length(offset), 1e-3);
  float tube = mix(5.2, 6.0, smoothstep(12.0, 40.0, p.y));
`;

const VERTEX_POSITION: Record<OutfitPart, string> = {
  head: /* glsl */ `
{
  vec3 p = position;
  vOutfitPos = p;
  float cloth = outfitClothAt(p);
  transformed = outfitDraped(p, transformed, cloth) + outfitBindNormal * uOutfitShape.z * cloth;
}
`,
  body: /* glsl */ `
{
  vec3 p = position;
  vOutfitPos = p;
  if (p.y < 60.0) {
    ${TROUSER_LEG}
    float weight = 1.0 - smoothstep(40.5, 45.0, p.y);
    transformed.xz = axis + offset / reach * mix(reach, max(reach, tube), weight);
  } else {
    float cloth = outfitClothAt(p);
    transformed = outfitDraped(p, transformed, cloth) + outfitBindNormal * uOutfitShape.z * cloth;
  }
}
`,
  shoes: /* glsl */ `
{
  vec3 p = position;
  vOutfitPos = p;
  ${TROUSER_LEG}
  float weight = smoothstep(9.0, 11.5, p.y);
  transformed.xz = axis + offset / reach * mix(reach, max(reach, tube), weight);
}
`,
  pants: /* glsl */ `
{
  vec3 p = position;
  vOutfitPos = p;
  vec2 axis = vec2(sign(p.x) * 8.4, -4.9);
  float slim = smoothstep(38.0, 56.0, p.y);
  vec2 narrow = vec2(mix(0.76, 1.0, slim), mix(0.62, 1.0, slim));
  transformed.xz = mix(transformed.xz, axis + (transformed.xz - axis) * narrow, smoothstep(0.5, 4.0, abs(p.x)));
}
`,
};

const FRAGMENT_DECLARATIONS = /* glsl */ `
${SHARED}
uniform vec3 uOutfitShirt;
uniform vec3 uOutfitTrousers;
uniform vec3 uOutfitAccent;
varying vec3 vOutfitPos;
float outfitCloth = 0.0;
float outfitGloss = 0.0;
float outfitBowTie(vec3 p) {
  if (uOutfitShape.y < 0.5 || p.z < -2.5) return 0.0;
  float dx = abs(p.x);
  float dy = abs(p.y - 106.6);
  float wing = step(dx, 3.7) * step(dy, 0.4 + 1.2 * dx / 3.7);
  float knot = step(dx, 0.8) * step(dy, 0.95);
  return max(wing, knot);
}
/** The shirt above the waist, the same on the neck mesh and the body mesh so the pattern has no seam. */
vec3 outfitShirtTone(vec3 p) {
  float along = abs(p.x);
  float fold = 0.5 + 0.5 * sin(p.y * 0.9 + sin(p.x * 0.7 + p.z * 0.8) * 2.4);
  fold *= 0.6 + 0.4 * sin(p.x * 1.9 - p.y * 0.35 + p.z * 1.3);
  float reach = outfitNeckReach(p);
  float band = (1.0 - smoothstep(7.0, 7.2, reach)) * step(104.0, p.y);
  vec3 tone = uOutfitShirt * mix(mix(0.9, 1.0, fold), 1.07, band);
  tone *= 1.0 - 0.4 * (1.0 - smoothstep(0.0, 0.3, abs(reach - 7.25))) * step(104.0, p.y);
  float hem = min(uOutfitShape.x, ${FOREARM_END.toFixed(1)}) - 2.4;
  tone *= mix(1.0, 0.86, smoothstep(hem - 0.1, hem + 0.1, along));
  if (along < 1.0 && p.z > 0.5 && p.y < 106.0) {
    tone *= 0.92;
    float button = 1.0 - smoothstep(0.32, 0.46, length(vec2(p.x, mod(p.y - 81.0, 4.6) - 2.3)));
    tone = mix(tone, uOutfitAccent, button * 0.85);
  }
  float tie = outfitBowTie(p);
  outfitGloss = tie * 0.4;
  return mix(tone, uOutfitAccent, tie);
}
`;

const FRAGMENT_COLOR: Record<OutfitPart, string> = {
  head: /* glsl */ `
{
  vec3 p = vOutfitPos;
  float collar = outfitCollar(p);
  outfitCloth = 1.0 - smoothstep(collar - 0.12, collar + 0.12, p.y);
  diffuseColor.rgb = mix(diffuseColor.rgb, outfitShirtTone(p), outfitCloth);
  outfitGloss *= outfitCloth;
}
`,
  body: /* glsl */ `
{
  vec3 p = vOutfitPos;
  if (p.y < 60.0) {
    diffuseColor.rgb = uOutfitTrousers;
    outfitCloth = 1.0;
  } else {
    outfitCloth = 1.0 - smoothstep(uOutfitShape.x - 0.12, uOutfitShape.x + 0.12, abs(p.x));
    diffuseColor.rgb = mix(diffuseColor.rgb, outfitShirtTone(p), outfitCloth);
    outfitGloss *= outfitCloth;
  }
}
`,
  shoes: /* glsl */ `
{
  float cloth = smoothstep(9.3, 9.7, vOutfitPos.y);
  diffuseColor.rgb = mix(diffuseColor.rgb, uOutfitTrousers, cloth);
  outfitCloth = cloth;
  outfitGloss = 1.0 - cloth;
}
`,
  pants: /* glsl */ `
{
  vec3 p = vOutfitPos;
  float belt = smoothstep(76.3, 76.5, p.y);
  float buckle = belt * step(abs(p.x), 1.8) * step(6.0, p.z) * step(76.9, p.y) * step(p.y, 79.2);
  diffuseColor.rgb = mix(mix(uOutfitTrousers, uOutfitAccent, belt), vec3(0.72, 0.71, 0.66), buckle);
  outfitCloth = 1.0 - belt;
  outfitGloss = belt;
}
`,
};

const FRAGMENT_ROUGHNESS = /* glsl */ `
roughnessFactor = mix(mix(roughnessFactor, 0.88, outfitCloth), 0.32, outfitGloss);
`;

const FRAGMENT_CLEARCOAT = /* glsl */ `
#ifdef USE_CLEARCOAT
material.clearcoat *= 1.0 - outfitCloth;
#endif
`;

/** Dresses one of the fighter materials. Composes with a shader patch already on the material. */
export function applyOutfitShading(material: THREE.MeshStandardMaterial, part: OutfitPart, outfit: OfficialOutfit): void {
  const uniforms = {
    uOutfitShirt: { value: new THREE.Color(outfit.shirt) },
    uOutfitTrousers: { value: new THREE.Color(outfit.trousers) },
    uOutfitAccent: { value: new THREE.Color(outfit.accent) },
    uOutfitShape: { value: new THREE.Vector4(outfit.sleeves === "long" ? FOREARM_END + 20 : SHORT_SLEEVE_END, outfit.bowTie ? 1 : 0, SHIRT_LIFT, 0) },
  };
  const before = material.onBeforeCompile;
  const beforeKey = Object.hasOwn(material, "customProgramCacheKey") ? material.customProgramCacheKey() : "plain";
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${vertexDeclarations(part)}`)
      .replace("#include <beginnormal_vertex>", `#include <beginnormal_vertex>\n${VERTEX_NORMAL}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${VERTEX_POSITION[part]}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAGMENT_DECLARATIONS}`)
      .replace("#include <map_fragment>", `#include <map_fragment>\n${FRAGMENT_COLOR[part]}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n${FRAGMENT_ROUGHNESS}`)
      .replace("#include <lights_physical_fragment>", `#include <lights_physical_fragment>\n${FRAGMENT_CLEARCOAT}`);
  };
  material.customProgramCacheKey = () => `${beforeKey}-outfit-${part}`;
  material.needsUpdate = true;
}

const UP = new THREE.Vector3(0, 1, 0);

function segment(from: THREE.Vector3, direction: THREE.Vector3, length: number, radius: number): THREE.BufferGeometry {
  const geometry = new THREE.CapsuleGeometry(radius, length, 4, 10);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, direction));
  geometry.translate(from.x + direction.x * length * 0.5, from.y + direction.y * length * 0.5, from.z + direction.z * length * 0.5);
  return geometry;
}

/**
 * A relaxed hand in the hand bone's frame, in centimetres: wrist at the origin, fingers along +Y,
 * palm facing +Z. The thumb is on -X for the left hand and +X for the right.
 */
export function buildHandGeometry(side: Hand): THREE.BufferGeometry {
  const thumb = side === "left" ? -1 : 1;
  const parts: THREE.BufferGeometry[] = [];
  const palm = new RoundedBoxGeometry(8.4, 9.2, 2.8, 3, 1.25);
  palm.translate(0, 5.2, 0);
  parts.push(palm);
  const wrist = new THREE.CapsuleGeometry(2.2, 2.2, 4, 12);
  wrist.scale(1.3, 1, 0.9);
  wrist.translate(0, 0.4, 0);
  parts.push(wrist);
  const fingers = [
    { x: 3.2 * thumb, y: 9.1, scale: 0.95, curl: 0.22, splay: 0.12 * thumb },
    { x: 1.08 * thumb, y: 9.5, scale: 1.05, curl: 0.34, splay: 0.03 * thumb },
    { x: -1.05 * thumb, y: 9.3, scale: 0.98, curl: 0.46, splay: -0.05 * thumb },
    { x: -3.05 * thumb, y: 8.7, scale: 0.8, curl: 0.6, splay: -0.16 * thumb },
  ];
  for (const finger of fingers) {
    const at = new THREE.Vector3(finger.x, finger.y, 0);
    let bend = finger.curl;
    for (const [length, radius, more] of [[4.3, 1.04, 0.55], [2.7, 0.95, 0.5], [2.2, 0.86, 0]] as const) {
      const direction = new THREE.Vector3(Math.sin(finger.splay) * Math.cos(bend), Math.cos(finger.splay) * Math.cos(bend), Math.sin(bend));
      const reach = length * finger.scale;
      parts.push(segment(at, direction, reach, radius * (0.88 + 0.12 * finger.scale)));
      at.addScaledVector(direction, reach);
      bend += more;
    }
  }
  const heel = new THREE.SphereGeometry(1.9, 12, 10);
  heel.scale(1.15, 1.5, 0.95);
  heel.translate(2.7 * thumb, 3.3, 0.9);
  parts.push(heel);
  const base = new THREE.Vector3(3.7 * thumb, 3.4, 0.9);
  const first = new THREE.Vector3(0.62 * thumb, 0.64, 0.45).normalize();
  parts.push(segment(base, first, 3.9, 1.2));
  base.addScaledVector(first, 3.9);
  parts.push(segment(base, new THREE.Vector3(0.3 * thumb, 0.82, 0.48).normalize(), 3, 1.05));
  const plain = parts.map((part) => {
    const flat = part.index === null ? part : part.toNonIndexed();
    flat.deleteAttribute("uv");
    return flat;
  });
  const merged = mergeGeometries(plain, false);
  for (const part of new Set([...parts, ...plain])) part.dispose();
  if (merged === null) throw new Error("hand geometry could not be merged");
  return merged;
}

/** Covers the end of the forearm mesh up to the wrist: a shirt cuff, or the cuff of an examination glove. */
export function buildCuffGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(3.9, 6, 9.2, 20, 1, false);
  geometry.scale(1, 1, 0.96);
  geometry.translate(0, 21.1, 0);
  return geometry;
}
