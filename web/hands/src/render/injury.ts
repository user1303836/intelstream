import * as THREE from "three";
import { EYE_SHUT_TRAUMA } from "../manifest";
import type { BloodLevel } from "../settings";
import type { TraumaSnapshot } from "../types";

/**
 * Object-space injury shading for the Texel Boxer skin materials.
 *
 * The source textures are a fragmented photogrammetry atlas, so damage is not
 * painted in UV space. Instead each material gets a fixed set of anatomical
 * sites in the mesh's bind space (centimetres). The vertex shader swells
 * tissue around bruised sites and can shear the jaw; the fragment shader
 * blends hematoma discolouration, cuts, and gravity-fed blood streaks into the
 * albedo and wets the surface where blood sits.
 */

export const INJURY_SITE_COUNT = 12;

export interface InjurySite {
  readonly name: string;
  readonly position: readonly [number, number, number];
  readonly radius: number;
  /** Cut segment half-length along local x; zero means the site never cuts. */
  readonly cutHalfLength: number;
  /** Whether blood can stream downward from this site. */
  readonly bleeds: boolean;
}

export const HEAD_SITES: readonly InjurySite[] = [
  { name: "leftEye", position: [2.4, 120.0, 3.4], radius: 3.4, cutHalfLength: 0, bleeds: false },
  { name: "rightEye", position: [-2.8, 120.1, 3.2], radius: 3.4, cutHalfLength: 0, bleeds: false },
  { name: "leftBrow", position: [2.9, 123.4, 3.0], radius: 2.2, cutHalfLength: 1.1, bleeds: true },
  { name: "rightBrow", position: [-2.7, 123.0, 3.3], radius: 2.2, cutHalfLength: 1.1, bleeds: true },
  { name: "nose", position: [0, 117.0, 5.3], radius: 1.6, cutHalfLength: 0, bleeds: true },
  { name: "mouth", position: [0, 114.3, 4.6], radius: 1.8, cutHalfLength: 0.9, bleeds: true },
  { name: "leftCheek", position: [3.4, 117.8, 3.4], radius: 3.0, cutHalfLength: 0.8, bleeds: true },
  { name: "rightCheek", position: [-3.4, 117.9, 3.3], radius: 3.0, cutHalfLength: 0.8, bleeds: true },
  { name: "chin", position: [0, 110.8, 4.2], radius: 2.2, cutHalfLength: 0, bleeds: false },
  { name: "leftJaw", position: [4.6, 113.0, 1.4], radius: 2.6, cutHalfLength: 0, bleeds: false },
  { name: "rightJaw", position: [-4.6, 113.0, 1.4], radius: 2.6, cutHalfLength: 0, bleeds: false },
  { name: "forehead", position: [0, 125.5, 3.5], radius: 3.2, cutHalfLength: 1.3, bleeds: true },
];

export const BODY_SITES: readonly InjurySite[] = [
  { name: "leftRibs", position: [13.5, 98.0, 1.0], radius: 7.5, cutHalfLength: 0, bleeds: false },
  { name: "rightRibs", position: [-13.5, 98.0, 1.0], radius: 7.5, cutHalfLength: 0, bleeds: false },
  { name: "solarPlexus", position: [0.5, 96.5, 5.5], radius: 6.0, cutHalfLength: 0, bleeds: false },
  { name: "leftPec", position: [9.0, 96.2, 4.4], radius: 6.0, cutHalfLength: 0, bleeds: false },
  { name: "rightPec", position: [-8.8, 96.2, 4.4], radius: 6.0, cutHalfLength: 0, bleeds: false },
  { name: "neckSmear", position: [0.4, 105.5, 5.8], radius: 4.0, cutHalfLength: 0, bleeds: true },
  { name: "leftShoulderSmear", position: [10.5, 104.0, 4.5], radius: 3.0, cutHalfLength: 0, bleeds: true },
  { name: "rightShoulderSmear", position: [-10.5, 104.0, 4.5], radius: 3.0, cutHalfLength: 0, bleeds: true },
  { name: "unused0", position: [0, -100, 0], radius: 0, cutHalfLength: 0, bleeds: false },
  { name: "unused1", position: [0, -100, 0], radius: 0, cutHalfLength: 0, bleeds: false },
  { name: "unused2", position: [0, -100, 0], radius: 0, cutHalfLength: 0, bleeds: false },
  { name: "unused3", position: [0, -100, 0], radius: 0, cutHalfLength: 0, bleeds: false },
];

/** Height of a cut through the neck in bind space, at the spine. It slopes down toward the throat so the chin stays on the head. */
export const NECK_CUT_HEIGHT = 112.4;
export const NECK_CUT_SLOPE = 0.3;
export const NECK_CUT_DEPTH = -4;
/** Where a head that bursts is gone above: level with the mouth, so the lower jaw and its teeth stay on the neck. */
export const BURST_CUT_HEIGHT = 114.5;
const BURST_RAGGED = 1.8;
const UNCUT = 1000;

/** The cut line, shared by the skin and the shadow pass. `uInjurySeverShape` is its slope toward the throat and how ragged it is. */
const SEVER = /* glsl */ `
uniform float uInjurySever;
uniform vec2 uInjurySeverShape;
float injuryCutLine(vec3 p) {
  float around = atan(p.z + 3.6, p.x);
  return uInjurySever - uInjurySeverShape.x * (p.z - (${NECK_CUT_DEPTH.toFixed(1)})) + uInjurySeverShape.y * (0.4 * sin(around * 6.0) + 0.22 * sin(around * 13.0 + 1.7));
}
`;

export interface InjuryLevels {
  readonly bruise: Float32Array;
  readonly swell: Float32Array;
  readonly cut: Float32Array;
  readonly blood: Float32Array;
}

/**
 * Where swollen tissue pushes out from, in bind space: a point inside the skull for the head, and
 * the spine's vertical axis for the body (w = 1). Pushing along each vertex normal instead folded
 * the hollow round an eye over itself.
 */
export const HEAD_SWELL_CORE: readonly [number, number, number, number] = [0, 119, -3.5, 0];
export const BODY_SWELL_CORE: readonly [number, number, number, number] = [0, 0, -2, 1];
/** Middle of each eye opening in bind space, for the lids that swell shut over it: left, then right. */
export const EYE_LIDS: readonly (readonly [number, number, number])[] = [
  [2.65, 120.65, 3.6],
  [-2.75, 120.75, 3.4],
];

const VERTEX_DECLARATIONS = /* glsl */ `
uniform vec4 uInjurySite[${INJURY_SITE_COUNT}];
uniform float uInjurySwell[${INJURY_SITE_COUNT}];
uniform vec4 uInjuryCore;
uniform vec4 uInjuryLid[2];
uniform vec2 uInjuryEyeOut;
uniform float uInjuryJaw;
uniform float uInjuryJawLevel;
uniform vec4 uInjuryImpact;
uniform vec3 uInjuryImpactPush;
uniform vec4 uInjuryNose;
varying vec3 vInjuryPos;
`;

const VERTEX_BODY = /* glsl */ `
vInjuryPos = transformed;
{
  float injurySwell = 0.0;
  for (int i = 0; i < ${INJURY_SITE_COUNT}; i++) {
    float radius = uInjurySite[i].w;
    if (radius <= 0.0) continue;
    float d = distance(transformed, uInjurySite[i].xyz);
    float w = 1.0 - smoothstep(0.0, radius * 1.15, d);
    injurySwell += uInjurySwell[i] * w * w;
  }
  vec3 injuryCore = uInjuryCore.w > 0.5 ? vec3(uInjuryCore.x, transformed.y, uInjuryCore.z) : uInjuryCore.xyz;
  transformed += normalize(transformed - injuryCore + vec3(0.0, 0.0, 0.001)) * injurySwell;
  float noseWeight = 1.0 - smoothstep(0.0, 2.6, distance(transformed, uInjuryNose.xyz));
  transformed.x += uInjuryNose.w * 1.1 * noseWeight * noseWeight;
  transformed.z -= abs(uInjuryNose.w) * 0.5 * noseWeight * noseWeight;
  float impactDistance = distance(transformed, uInjuryImpact.xyz);
  float impactWeight = 1.0 - smoothstep(0.0, max(uInjuryImpact.w, 0.001), impactDistance);
  transformed += uInjuryImpactPush * (impactWeight * impactWeight);
  // An eye forced out leaves its socket hollow.
  for (int e = 0; e < 2; e++) {
    float gone = e == 0 ? uInjuryEyeOut.x : uInjuryEyeOut.y;
    if (gone <= 0.0) continue;
    float socket = 1.0 - smoothstep(0.0, 1.7, distance(transformed, uInjuryLid[e].xyz));
    transformed.z -= 1.1 * socket * socket * gone;
  }
  // Only the mandible: the mask fades out again under the chin, above the throat and the seam with the body.
  float jawMask = (1.0 - smoothstep(uInjuryJawLevel - 2.5, uInjuryJawLevel + 1.5, transformed.y))
    * smoothstep(uInjuryJawLevel - 6.0, uInjuryJawLevel - 4.0, transformed.y)
    * smoothstep(-6.0, 0.0, transformed.z);
  transformed.x += uInjuryJaw * 1.7 * jawMask;
  transformed.y -= uInjuryJaw * 0.9 * jawMask;
  transformed.z -= uInjuryJaw * 0.4 * jawMask;
}
`;

const FRAGMENT_DECLARATIONS = /* glsl */ `
uniform vec4 uInjurySite[${INJURY_SITE_COUNT}];
uniform vec4 uInjuryCut[${INJURY_SITE_COUNT}];
uniform float uInjuryBruise[${INJURY_SITE_COUNT}];
uniform float uInjuryBlood[${INJURY_SITE_COUNT}];
uniform float uInjuryWetness;
uniform float uInjuryWash;
uniform float uInjuryRaw;
uniform vec4 uInjuryLid[2];
uniform vec2 uInjuryEyeOut;
varying vec3 vInjuryPos;
float injuryWet = 0.0;
${SEVER}

float injuryHash(float n) { return fract(sin(n) * 43758.5453123); }
`;

/** A head drawn from both sides only shows its inside once it is cut open: until then a back face does no work. */
const CLOSED_BACK_FACE = /* glsl */ `if (!gl_FrontFacing && uInjurySever >= ${UNCUT}.0) discard;`;

const FRAGMENT_BODY = /* glsl */ `
{
  vec3 injuryPos = vInjuryPos;
  if (uInjurySever < ${UNCUT}.0) {
    float below = injuryCutLine(injuryPos) - injuryPos.y;
    if (below < 0.0) discard;
    float torn = 1.0 - smoothstep(0.0, 1.8, below);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.008, 0.012), torn * 0.94);
    injuryWet = max(injuryWet, torn);
  }
  vec3 hematomaFresh = vec3(0.42, 0.09, 0.11);
  vec3 hematomaDeep = vec3(0.2, 0.04, 0.07);
  vec3 bloodColor = vec3(0.30, 0.008, 0.012);
  vec3 bloodEdge = vec3(0.13, 0.0, 0.004);
  vec3 cutColor = vec3(0.1, 0.002, 0.004);
  vec3 rawFlesh = vec3(0.42, 0.05, 0.06);
  for (int i = 0; i < ${INJURY_SITE_COUNT}; i++) {
    float radius = uInjurySite[i].w;
    if (radius <= 0.0) continue;
    vec3 site = uInjurySite[i].xyz;
    float bruise = uInjuryBruise[i];
    if (bruise > 0.001) {
      // Wider than tall, with an uneven edge: a bruise follows the bone under it, not a compass.
      vec3 offset = injuryPos - site;
      float ragged = 1.0 + 0.18 * sin(atan(offset.y, offset.x) * 5.0 + float(i) * 2.3) + 0.08 * sin(offset.z * 3.1 + offset.x * 2.2);
      float spread = length(vec3(offset.x, offset.y * 1.35, offset.z)) / ragged;
      float mottle = 0.85 + 0.15 * sin(injuryPos.x * 3.1 + injuryPos.y * 2.3) * sin(injuryPos.z * 2.7 - injuryPos.y * 1.9);
      float w = (1.0 - smoothstep(radius * 0.15, radius * 1.05, spread)) * mottle;
      float core = 1.0 - smoothstep(0.0, radius * 0.6, spread);
      vec3 tone = mix(hematomaFresh, hematomaDeep, clamp(bruise * 1.1 - 0.15 + core * 0.35, 0.0, 1.0));
      vec3 stained = diffuseColor.rgb * tone / vec3(0.6, 0.32, 0.19);
      diffuseColor.rgb = mix(diffuseColor.rgb, mix(stained, tone, 0.25), clamp(bruise, 0.0, 1.0) * w * 0.85);
    }
    float cut = uInjuryCut[i].y;
    float halfLength = uInjuryCut[i].x;
    if (cut > 0.001 && halfLength > 0.0) {
      // A split: a dark gash between swollen raw lips, tapering to its ends. Without blood it is closed,
      // a thin dark line with no raw flesh and nothing wet about it.
      vec3 local = injuryPos - site;
      float along = clamp(local.x, -halfLength, halfLength);
      float taper = 1.0 - 0.6 * (abs(along) / halfLength) * (abs(along) / halfLength);
      vec2 delta = vec2(local.x - along, local.y - 0.18 * sin(local.x * 3.0));
      float slit = length(delta) + abs(local.z) * 0.25;
      float gash = 1.0 - smoothstep((0.03 + cut * 0.05 * uInjuryRaw) * taper, (0.09 + cut * 0.09 * uInjuryRaw) * taper, slit);
      float lip = (1.0 - smoothstep(0.1 * taper, (0.22 + cut * 0.12) * taper, slit)) * (1.0 - gash) * uInjuryRaw;
      diffuseColor.rgb = mix(diffuseColor.rgb, rawFlesh, cut * lip * 0.75);
      diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.12, 0.06, 0.05), cutColor, uInjuryRaw), cut * gash);
      injuryWet = max(injuryWet, cut * max(gash, lip * 0.6) * uInjuryRaw);
    }
  }
  // An eye swollen shut: the lids meet over it in a tight, shiny, purple-red mound closed to a dark slit.
  vec3 lidSkin = vec3(0.6, 0.32, 0.19) * diffuse;
  for (int e = 0; e < 2; e++) {
    vec4 lid = uInjuryLid[e];
    if (lid.w <= 0.001) continue;
    vec3 q = injuryPos - lid.xyz;
    float across = q.x / 1.85;
    float lifted = q.y + 0.1 * q.x * q.x;
    float upDown = lifted / (lifted > 0.0 ? 0.8 + 0.35 * lid.w : 0.5 + 0.22 * lid.w);
    float reach = length(vec2(across, upDown)) + max(0.0, -q.z - 1.0) * 1.5;
    float closed = (1.0 - smoothstep(0.7, 1.08, reach)) * smoothstep(0.0, 0.85, lid.w);
    if (closed <= 0.0) continue;
    float dome = 1.0 - reach * reach * 0.6;
    vec3 puffed = lidSkin * mix(vec3(0.95, 0.62, 0.72), vec3(0.78, 0.4, 0.62), lid.w) * (0.8 + 0.35 * dome);
    float crease = (1.0 - smoothstep(0.035, 0.07 + 0.12 * (1.0 - lid.w), abs(lifted + 0.12))) * (1.0 - smoothstep(0.55, 0.95, abs(across)));
    diffuseColor.rgb = mix(diffuseColor.rgb, mix(puffed, vec3(0.03, 0.006, 0.01), crease * 0.92), closed);
    injuryWet = max(injuryWet, closed * 0.35 * (1.0 - crease));
  }
  // An empty socket: a raw red rim round a dark hollow where the eye was.
  for (int e = 0; e < 2; e++) {
    float gone = e == 0 ? uInjuryEyeOut.x : uInjuryEyeOut.y;
    if (gone <= 0.0) continue;
    vec3 q = injuryPos - uInjuryLid[e].xyz;
    float reach = length(vec2(q.x / 1.45, (q.y + 0.1 * q.x * q.x) / 1.0)) + max(0.0, -q.z - 1.6) * 1.5;
    float hollow = (1.0 - smoothstep(0.7, 1.05, reach)) * gone;
    vec3 inside = mix(vec3(0.03, 0.0, 0.004), rawFlesh * 1.15, smoothstep(0.3, 0.85, reach));
    diffuseColor.rgb = mix(diffuseColor.rgb, inside, hollow);
    injuryWet = max(injuryWet, hollow);
  }
  for (int i = 0; i < ${INJURY_SITE_COUNT}; i++) {
    float radius = uInjurySite[i].w;
    float blood = uInjuryBlood[i];
    if (radius <= 0.0 || blood <= 0.001) continue;
    vec3 origin = uInjurySite[i].xyz + vec3(0.0, -radius * 0.35, 0.0);
    float drop = origin.y - injuryPos.y;
    if (drop < -0.6 || injuryPos.z < origin.z - 3.2) continue;
    float flow = smoothstep(0.0, 0.3, blood);
    float well = (1.0 - smoothstep(0.0, 0.3 + blood * 0.4, distance(injuryPos.xy, origin.xy))) * flow;
    float w = well;
    // Two rivulets of their own lengths run from each wound, wandering, thinning, with a bead at each tip.
    for (int k = 0; k < 2; k++) {
      float fk = float(k);
      if (fk > 0.5 && blood < 0.45) break;
      float seed = fract(sin(float(i) * 12.9898 + fk * 78.233) * 43758.5453);
      float reach = (2.0 + blood * 9.0) * (fk < 0.5 ? 1.0 : 0.55 + 0.3 * seed);
      float start = (fk < 0.5 ? -0.3 : 0.4) * (0.6 + 0.6 * seed) * radius * 0.35;
      float t = clamp(drop / reach, 0.0, 1.0);
      float wander = (0.35 * sin(injuryPos.y * 1.3 + float(i) * 1.7 + fk * 2.1) + 0.15 * sin(injuryPos.y * 3.7 + fk)) * t;
      float dx = abs(injuryPos.x - origin.x - start - wander);
      float width = (0.26 - 0.12 * t) * (0.7 + 0.45 * min(1.0, blood));
      float run = (1.0 - smoothstep(width * 0.55, width, dx)) * step(drop, reach) * smoothstep(-0.4, 0.1, drop);
      float tipY = origin.y - reach;
      vec2 tip = vec2(origin.x + start + 0.35 * sin(tipY * 1.3 + float(i) * 1.7 + fk * 2.1) + 0.15 * sin(tipY * 3.7 + fk), tipY);
      float bead = 1.0 - smoothstep(width * 1.15, width * 1.15 + 0.1, distance(injuryPos.xy, tip));
      float stream = max(run, bead) * flow;
      float edge = smoothstep(width * 0.2, width * 0.85, dx);
      diffuseColor.rgb = mix(diffuseColor.rgb, mix(bloodColor, bloodEdge, edge * 0.6), stream * 0.95);
      w = max(w, stream);
    }
    diffuseColor.rgb = mix(diffuseColor.rgb, bloodColor, well * 0.92);
    if (uInjuryWash > 0.5) {
      // On the body, sweat thins the blood into a broad wash that the gloves smear across the chest.
      float t = clamp(drop / (radius * 3.2 + blood * 10.0), 0.0, 1.0);
      float across = abs(injuryPos.x - origin.x + 0.9 * sin(injuryPos.y * 0.45 + float(i)));
      float wash = (1.0 - smoothstep(radius * (0.5 + 0.4 * t), radius * (1.0 + 0.7 * t), across)) * (1.0 - t * t) * smoothstep(-0.6, 0.6, drop) * flow;
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.95, 0.26, 0.26) + vec3(0.07, 0.0, 0.0), wash * min(1.0, blood) * 0.7);
      w = max(w, wash * 0.5);
    }
    injuryWet = max(injuryWet, w);
  }
  // Where a cut or a burst opens the head, its inside shows as raw flesh rather than nothing.
  if (!gl_FrontFacing) {
    diffuseColor.rgb = vec3(0.2, 0.012, 0.022);
    injuryWet = 1.0;
  }
  injuryWet *= uInjuryWetness;
}
`;

const ROUGHNESS_BODY = /* glsl */ `
roughnessFactor = mix(roughnessFactor, 0.18, injuryWet);
`;

const IMPACT_RELEASE_RATE = 9;

export class InjuryShading {
  readonly uniforms = {
    uInjurySite: { value: [] as THREE.Vector4[] },
    uInjuryCut: { value: [] as THREE.Vector4[] },
    uInjurySwell: { value: new Float32Array(INJURY_SITE_COUNT) },
    uInjuryBruise: { value: new Float32Array(INJURY_SITE_COUNT) },
    uInjuryBlood: { value: new Float32Array(INJURY_SITE_COUNT) },
    uInjuryJaw: { value: 0 },
    uInjuryJawLevel: { value: 114.5 },
    uInjuryImpact: { value: new THREE.Vector4(0, -1000, 0, 1) },
    uInjuryImpactPush: { value: new THREE.Vector3() },
    uInjuryNose: { value: new THREE.Vector4(0, -1000, 0, 0) },
    uInjuryWetness: { value: 1 },
    uInjuryRaw: { value: 1 },
    uInjurySever: { value: UNCUT },
    uInjurySeverShape: { value: new THREE.Vector2(NECK_CUT_SLOPE, 1) },
    uInjuryCore: { value: new THREE.Vector4(...HEAD_SWELL_CORE) },
    uInjuryWash: { value: 0 },
    uInjuryLid: { value: [new THREE.Vector4(0, -1000, 0, 0), new THREE.Vector4(0, -1000, 0, 0)] },
    uInjuryEyeOut: { value: new THREE.Vector2() },
  };
  private readonly index = new Map<string, number>();

  /** With no material the state is kept but shades nothing: an official, who never takes damage. */
  constructor(
    readonly material: THREE.MeshStandardMaterial | null,
    readonly sites: readonly InjurySite[],
    shape: { readonly core: readonly [number, number, number, number]; readonly lids?: readonly (readonly [number, number, number])[]; readonly wash?: boolean } = { core: HEAD_SWELL_CORE },
  ) {
    if (sites.length !== INJURY_SITE_COUNT) throw new Error(`injury shading requires ${INJURY_SITE_COUNT} sites`);
    this.uniforms.uInjuryCore.value.set(...shape.core);
    this.uniforms.uInjuryWash.value = shape.wash === true ? 1 : 0;
    for (const [index, lid] of (shape.lids ?? []).slice(0, 2).entries()) this.uniforms.uInjuryLid.value[index]!.set(lid[0], lid[1], lid[2], 0);
    for (const [index, site] of sites.entries()) {
      this.index.set(site.name, index);
      this.uniforms.uInjurySite.value.push(new THREE.Vector4(site.position[0], site.position[1], site.position[2], site.radius));
      this.uniforms.uInjuryCut.value.push(new THREE.Vector4(site.cutHalfLength, 0, 0, 0));
    }
    if (material === null) return;
    const uniforms = this.uniforms;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${VERTEX_DECLARATIONS}`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>\n${VERTEX_BODY}`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${FRAGMENT_DECLARATIONS}`)
        .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>\n${CLOSED_BACK_FACE}`)
        .replace("#include <map_fragment>", `#include <map_fragment>\n${FRAGMENT_BODY}`)
        .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n${ROUGHNESS_BODY}`);
    };
    material.customProgramCacheKey = () => `hands-injury-${INJURY_SITE_COUNT}`;
    material.needsUpdate = true;
  }

  private slot(name: string): number {
    const index = this.index.get(name);
    if (index === undefined) throw new Error(`unknown injury site ${name}`);
    return index;
  }

  set(name: string, levels: { bruise?: number; swell?: number; cut?: number; blood?: number }): void {
    const index = this.slot(name);
    if (levels.bruise !== undefined) this.uniforms.uInjuryBruise.value[index] = THREE.MathUtils.clamp(levels.bruise, 0, 1.2);
    if (levels.swell !== undefined) this.uniforms.uInjurySwell.value[index] = THREE.MathUtils.clamp(levels.swell, 0, 2.2);
    if (levels.cut !== undefined) this.uniforms.uInjuryCut.value[index]!.y = THREE.MathUtils.clamp(levels.cut, 0, 1);
    if (levels.blood !== undefined) this.uniforms.uInjuryBlood.value[index] = THREE.MathUtils.clamp(levels.blood, 0, 1.4);
  }

  /** Dents the surface around a site along `push` (object-space centimetres); released by update(). */
  impact(name: string, push: readonly [number, number, number], radius: number): void {
    const site = this.uniforms.uInjurySite.value[this.slot(name)]!;
    this.uniforms.uInjuryImpact.value.set(site.x, site.y, site.z, radius);
    this.uniforms.uInjuryImpactPush.value.set(push[0], push[1], push[2]);
  }

  /** Persistent sideways shift of the nose (object-space centimetres) once the bridge has gone. */
  setNoseShift(shift: number): void {
    const index = this.index.get("nose");
    if (index === undefined) return;
    const site = this.uniforms.uInjurySite.value[index]!;
    this.uniforms.uInjuryNose.value.set(site.x, site.y, site.z, THREE.MathUtils.clamp(shift, -1.4, 1.4) || 0);
  }

  update(dt: number): void {
    const push = this.uniforms.uInjuryImpactPush.value;
    if (push.lengthSq() < 1e-6) return;
    push.multiplyScalar(Math.exp(-IMPACT_RELEASE_RATE * dt));
    if (push.lengthSq() < 1e-4) push.set(0, 0, 0);
  }

  get impactDepth(): number {
    return this.uniforms.uInjuryImpactPush.value.length();
  }

  /** Removes everything above a cut through the neck, leaving a torn, bloodied edge. */
  setSevered(severed: boolean): void {
    this.uniforms.uInjurySever.value = severed ? NECK_CUT_HEIGHT : UNCUT;
    this.uniforms.uInjurySeverShape.value.set(NECK_CUT_SLOPE, 1);
  }

  /** Removes everything above the mouth in a ragged tear, as when the head bursts. */
  setBurst(burst: boolean): void {
    this.uniforms.uInjurySever.value = burst ? BURST_CUT_HEIGHT : UNCUT;
    this.uniforms.uInjurySeverShape.value.set(burst ? 0 : NECK_CUT_SLOPE, burst ? BURST_RAGGED : 1);
  }

  /** Shadow pass material for the same mesh, so a severed head casts no shadow from the shoulders. */
  shadowMaterial(): THREE.MeshDepthMaterial {
    const material = new THREE.MeshDepthMaterial();
    const uniforms = { uInjurySever: this.uniforms.uInjurySever, uInjurySeverShape: this.uniforms.uInjurySeverShape };
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vInjuryPos;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvInjuryPos = transformed;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\nvarying vec3 vInjuryPos;\n${SEVER}`)
        .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>\nif (uInjurySever < ${UNCUT}.0 && vInjuryPos.y > injuryCutLine(vInjuryPos)) discard;`);
    };
    material.customProgramCacheKey = () => "hands-injury-shadow";
    return material;
  }

  /** How open and raw the cuts are drawn, from 1 (gashes between raw lips) to 0 (closed dark lines, for blood off). */
  setRawCuts(raw: number): void {
    this.uniforms.uInjuryRaw.value = THREE.MathUtils.clamp(raw, 0, 1) || 0;
  }

  setJaw(amount: number): void {
    this.uniforms.uInjuryJaw.value = THREE.MathUtils.clamp(amount, 0, 1);
  }

  /** How far each eye has swollen shut, 0 open to 1 closed: left, then right. */
  setEyesShut(left: number, right: number): void {
    const [leftLid, rightLid] = this.uniforms.uInjuryLid.value;
    if (leftLid!.y > -500) leftLid!.w = THREE.MathUtils.clamp(left, 0, 1) || 0;
    if (rightLid!.y > -500) rightLid!.w = THREE.MathUtils.clamp(right, 0, 1) || 0;
  }

  /** Hollows a socket whose eye has been forced out: `side` is the fighter's own. */
  setEyeOut(side: "left" | "right" | null): void {
    const lids = this.uniforms.uInjuryLid.value;
    const left = side === "left" && lids[0]!.y > -500;
    const right = side === "right" && lids[1]!.y > -500;
    this.uniforms.uInjuryEyeOut.value.set(left ? 1 : 0, right ? 1 : 0);
    // The empty socket runs with blood down the cheek.
    if (this.index.has("leftEye")) this.set("leftEye", { blood: left ? 1.3 : 0 });
    if (this.index.has("rightEye")) this.set("rightEye", { blood: right ? 1.3 : 0 });
  }

  get eyeOut(): "left" | "right" | null {
    const out = this.uniforms.uInjuryEyeOut.value;
    return out.x > 0 ? "left" : out.y > 0 ? "right" : null;
  }

  get eyesShut(): readonly [number, number] {
    return [this.uniforms.uInjuryLid.value[0]!.w, this.uniforms.uInjuryLid.value[1]!.w];
  }

  clear(): void {
    this.uniforms.uInjuryBruise.value.fill(0);
    this.uniforms.uInjurySwell.value.fill(0);
    this.uniforms.uInjuryBlood.value.fill(0);
    for (const cut of this.uniforms.uInjuryCut.value) cut.y = 0;
    this.uniforms.uInjuryJaw.value = 0;
    for (const lid of this.uniforms.uInjuryLid.value) lid.w = 0;
    this.uniforms.uInjuryEyeOut.value.set(0, 0);
  }

  level(name: string): { bruise: number; swell: number; cut: number; blood: number } {
    const index = this.slot(name);
    return {
      bruise: this.uniforms.uInjuryBruise.value[index]!,
      swell: this.uniforms.uInjurySwell.value[index]!,
      cut: this.uniforms.uInjuryCut.value[index]!.y,
      blood: this.uniforms.uInjuryBlood.value[index]!,
    };
  }
}

const bloodScale = (blood: BloodLevel): number => (blood === "off" ? 0 : blood === "reduced" ? 0.35 : 1);

/** Eye damage at which an eye is swollen fully shut, whatever the rest of the face: the engine's blind side starts there too. */
export { EYE_SHUT_TRAUMA };
/** Eye damage at which the lids start to swell together. */
const EYE_CLOSING_TRAUMA = 330;

/** An eye starts to close once it has taken a beating, sooner as the face swells, and is shut at `EYE_SHUT_TRAUMA`. */
export function eyeShut(eyeTrauma: number, swelling: number): number {
  return THREE.MathUtils.clamp((eyeTrauma - EYE_CLOSING_TRAUMA) / (EYE_SHUT_TRAUMA - EYE_CLOSING_TRAUMA) + Math.max(0, swelling - 200) / 1600, 0, 1);
}

/**
 * The most an eye and a cheek swell, in bind-space centimetres pushed out from inside the skull: an eye
 * beaten shut stands out two centimetres in a grotesque mound. The push is radial from the skull's core,
 * so even this much folds no triangle of the face.
 */
export const EYE_SWELL = 2;
export const CHEEK_SWELL = 1.8;
/** A cheek cut is wide open by this much cut damage, short of the 800 at which the doctor stops the bout. */
const CHEEK_CUT_OPEN = 750;
/** Swelling at which the forehead splits: a face battered for a round or two, where 520 was all but out of reach. */
const FOREHEAD_SPLITS = 380;

/** Maps authoritative trauma onto head injury sites. */
export function applyHeadTrauma(shading: InjuryShading, trauma: TraumaSnapshot, blood: BloodLevel): void {
  const bleed = bloodScale(blood);
  const graphic = blood === "full" ? 1 : 0.6;
  shading.setRawCuts(blood === "full" ? 1 : blood === "reduced" ? 0.6 : 0);
  const eye = (value: number): number => Math.min(1.2, value / 380 + trauma.swelling / 900);
  const swell = (value: number): number => Math.min(EYE_SWELL, (value / 600 + trauma.swelling / 900) * graphic);
  shading.set("leftEye", { bruise: eye(trauma.left_eye), swell: swell(trauma.left_eye) });
  shading.set("rightEye", { bruise: eye(trauma.right_eye), swell: swell(trauma.right_eye) });
  shading.setEyesShut(eyeShut(trauma.left_eye, trauma.swelling), eyeShut(trauma.right_eye, trauma.swelling));
  const browCut = (cut: number): number => Math.min(1, cut / 220);
  const browBlood = (cut: number): number => Math.min(1.4, (cut / 260 + trauma.bleeding / 520) * bleed);
  shading.set("leftBrow", { bruise: Math.min(1, trauma.left_eye / 700), swell: Math.min(1.2, trauma.left_eye / 900) * graphic, cut: browCut(trauma.left_cut), blood: browBlood(trauma.left_cut) });
  shading.set("rightBrow", { bruise: Math.min(1, trauma.right_eye / 700), swell: Math.min(1.2, trauma.right_eye / 900) * graphic, cut: browCut(trauma.right_cut), blood: browBlood(trauma.right_cut) });
  const cheek = Math.min(1, trauma.head / 950 + trauma.swelling / 1100);
  const cheekSwell = Math.min(CHEEK_SWELL, trauma.swelling / 520) * graphic;
  const cheekCut = (cut: number): number => Math.min(1, Math.max(0, cut - 350) / (CHEEK_CUT_OPEN - 350));
  shading.set("leftCheek", { bruise: cheek * 0.9, swell: cheekSwell, cut: cheekCut(trauma.left_cut), blood: Math.min(1, Math.max(0, trauma.left_cut - 350) / 400) * bleed });
  shading.set("rightCheek", { bruise: cheek * 0.85, swell: cheekSwell, cut: cheekCut(trauma.right_cut), blood: Math.min(1, Math.max(0, trauma.right_cut - 350) / 400) * bleed });
  shading.set("nose", { bruise: Math.min(1, trauma.head / 800), swell: Math.min(0.8, trauma.head / 1400) * graphic, blood: Math.min(1.4, (Math.max(0, trauma.head - 160) / 520 + trauma.bleeding / 420) * bleed) });
  shading.set("mouth", { bruise: Math.min(0.8, trauma.head / 1100), cut: Math.min(1, Math.max(0, trauma.head - 420) / 700), blood: Math.min(1.2, (Math.max(0, trauma.head - 280) / 650 + trauma.bleeding / 500) * bleed) });
  shading.set("chin", { bruise: Math.min(0.7, trauma.head / 1300) });
  const noseSide = trauma.left_eye >= trauma.right_eye ? -1 : 1;
  shading.setNoseShift(noseSide * Math.min(1.1, Math.max(0, trauma.head - 520) / 450) * graphic);
  shading.set("leftJaw", { bruise: Math.min(0.9, trauma.left_eye / 900 + trauma.head / 1600) });
  shading.set("rightJaw", { bruise: Math.min(0.9, trauma.right_eye / 900 + trauma.head / 1600) });
  shading.set("forehead", { bruise: Math.min(0.6, trauma.swelling / 1200), cut: Math.min(1, Math.max(0, trauma.swelling - FOREHEAD_SPLITS) / 400), blood: Math.min(1.2, Math.max(0, trauma.swelling - FOREHEAD_SPLITS) / 360) * bleed });
}

/** How far a fighter's own blood has run down into the front of the trunks, 0 to 1. */
export function trunksBloodFor(trauma: TraumaSnapshot, blood: BloodLevel): number {
  return Math.min(1, (Math.max(0, trauma.bleeding - 40) / 420 + Math.max(0, trauma.left_cut + trauma.right_cut - 150) / 1300) * bloodScale(blood));
}

/** Maps authoritative trauma onto torso injury sites. Head bleeding smears down the neck and chest. */
export function applyBodyTrauma(shading: InjuryShading, trauma: TraumaSnapshot, blood: BloodLevel): void {
  const bleed = bloodScale(blood);
  const ribs = Math.min(1.1, trauma.body / 620);
  shading.set("leftRibs", { bruise: ribs, swell: Math.min(1, trauma.body / 1300) });
  shading.set("rightRibs", { bruise: ribs * 0.9, swell: Math.min(1, trauma.body / 1400) });
  shading.set("solarPlexus", { bruise: Math.min(1, trauma.body / 800) });
  shading.set("leftPec", { bruise: Math.min(0.8, trauma.body / 1100) });
  shading.set("rightPec", { bruise: Math.min(0.8, trauma.body / 1150) });
  const smear = Math.min(1.4, (trauma.bleeding / 380 + (trauma.left_cut + trauma.right_cut) / 900) * bleed);
  shading.set("neckSmear", { blood: smear });
  shading.set("leftShoulderSmear", { blood: Math.min(1, trauma.left_cut / 600) * bleed });
  shading.set("rightShoulderSmear", { blood: Math.min(1, trauma.right_cut / 600) * bleed });
}
