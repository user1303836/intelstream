import * as THREE from "three";
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

export interface InjuryLevels {
  readonly bruise: Float32Array;
  readonly swell: Float32Array;
  readonly cut: Float32Array;
  readonly blood: Float32Array;
}

const VERTEX_DECLARATIONS = /* glsl */ `
uniform vec4 uInjurySite[${INJURY_SITE_COUNT}];
uniform float uInjurySwell[${INJURY_SITE_COUNT}];
uniform float uInjuryJaw;
uniform float uInjuryJawLevel;
uniform vec4 uInjuryImpact;
uniform vec3 uInjuryImpactPush;
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
  transformed += objectNormal * injurySwell;
  float impactDistance = distance(transformed, uInjuryImpact.xyz);
  float impactWeight = 1.0 - smoothstep(0.0, max(uInjuryImpact.w, 0.001), impactDistance);
  transformed += uInjuryImpactPush * (impactWeight * impactWeight);
  float jawMask = (1.0 - smoothstep(uInjuryJawLevel - 2.5, uInjuryJawLevel + 1.5, transformed.y)) * smoothstep(-6.0, 0.0, transformed.z);
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
varying vec3 vInjuryPos;
float injuryWet = 0.0;

float injuryHash(float n) { return fract(sin(n) * 43758.5453123); }
`;

const FRAGMENT_BODY = /* glsl */ `
{
  vec3 injuryPos = vInjuryPos;
  vec3 hematomaFresh = vec3(0.31, 0.05, 0.08);
  vec3 hematomaDeep = vec3(0.12, 0.035, 0.13);
  vec3 bloodColor = vec3(0.30, 0.008, 0.012);
  vec3 cutColor = vec3(0.13, 0.004, 0.005);
  for (int i = 0; i < ${INJURY_SITE_COUNT}; i++) {
    float radius = uInjurySite[i].w;
    if (radius <= 0.0) continue;
    vec3 site = uInjurySite[i].xyz;
    float d = distance(injuryPos, site);
    float bruise = uInjuryBruise[i];
    if (bruise > 0.001) {
      float mottle = 0.92 + 0.08 * sin(injuryPos.x * 3.1 + injuryPos.y * 2.3) * sin(injuryPos.z * 2.7 - injuryPos.y * 1.9);
      float w = (1.0 - smoothstep(radius * 0.2, radius, d)) * mottle;
      vec3 tone = mix(hematomaFresh, hematomaDeep, clamp(bruise * 1.2 - 0.2, 0.0, 1.0));
      vec3 stained = mix(diffuseColor.rgb * tone * 2.0, tone * 1.1, 0.35);
      diffuseColor.rgb = mix(diffuseColor.rgb, stained, clamp(bruise, 0.0, 1.0) * w * 0.8);
    }
    float cut = uInjuryCut[i].y;
    float halfLength = uInjuryCut[i].x;
    if (cut > 0.001 && halfLength > 0.0) {
      vec3 local = injuryPos - site;
      float along = clamp(local.x, -halfLength, halfLength);
      vec2 delta = vec2(local.x - along, local.y - 0.18 * sin(local.x * 3.0));
      float slit = length(delta) + abs(local.z) * 0.25;
      float w = 1.0 - smoothstep(0.06 + cut * 0.06, 0.24 + cut * 0.12, slit);
      float lip = (1.0 - smoothstep(0.24, 0.55, slit)) * 0.6;
      diffuseColor.rgb = mix(diffuseColor.rgb, hematomaFresh * 0.8, cut * lip);
      diffuseColor.rgb = mix(diffuseColor.rgb, cutColor, cut * w);
      injuryWet = max(injuryWet, cut * w);
    }
    float blood = uInjuryBlood[i];
    if (blood > 0.001) {
      vec3 origin = site + vec3(0.0, -radius * 0.35, 0.0);
      float length = 3.5 + blood * 9.0;
      float drop = origin.y - injuryPos.y;
      if (drop > -0.4 && drop < length && injuryPos.z > origin.z - 3.2) {
        float t = clamp(drop / length, 0.0, 1.0);
        float wander = 0.4 * sin(injuryPos.y * 1.6 + float(i) * 1.7) + 0.25 * sin(injuryPos.y * 4.3 + float(i));
        float dx = abs(injuryPos.x - origin.x - wander * t);
        float width = 0.28 + 0.28 * t + 0.25 * blood;
        float edge = width + 0.18;
        float stream = (1.0 - smoothstep(width * 0.6, edge, dx)) * (1.0 - t * t) * smoothstep(-0.4, 0.15, drop);
        float head = (1.0 - smoothstep(0.0, radius * 0.9, distance(injuryPos, origin))) * 0.7;
        float w = clamp(max(stream, head) * min(1.0, blood * 1.4), 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, bloodColor, w * 0.96);
        injuryWet = max(injuryWet, w);
      }
    }
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
    uInjuryWetness: { value: 1 },
  };
  private readonly index = new Map<string, number>();

  constructor(readonly material: THREE.MeshStandardMaterial, readonly sites: readonly InjurySite[]) {
    if (sites.length !== INJURY_SITE_COUNT) throw new Error(`injury shading requires ${INJURY_SITE_COUNT} sites`);
    for (const [index, site] of sites.entries()) {
      this.index.set(site.name, index);
      this.uniforms.uInjurySite.value.push(new THREE.Vector4(site.position[0], site.position[1], site.position[2], site.radius));
      this.uniforms.uInjuryCut.value.push(new THREE.Vector4(site.cutHalfLength, 0, 0, 0));
    }
    const uniforms = this.uniforms;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${VERTEX_DECLARATIONS}`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>\n${VERTEX_BODY}`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${FRAGMENT_DECLARATIONS}`)
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

  update(dt: number): void {
    const push = this.uniforms.uInjuryImpactPush.value;
    if (push.lengthSq() < 1e-6) return;
    push.multiplyScalar(Math.exp(-IMPACT_RELEASE_RATE * dt));
    if (push.lengthSq() < 1e-4) push.set(0, 0, 0);
  }

  get impactDepth(): number {
    return this.uniforms.uInjuryImpactPush.value.length();
  }

  setJaw(amount: number): void {
    this.uniforms.uInjuryJaw.value = THREE.MathUtils.clamp(amount, 0, 1);
  }

  clear(): void {
    this.uniforms.uInjuryBruise.value.fill(0);
    this.uniforms.uInjurySwell.value.fill(0);
    this.uniforms.uInjuryBlood.value.fill(0);
    for (const cut of this.uniforms.uInjuryCut.value) cut.y = 0;
    this.uniforms.uInjuryJaw.value = 0;
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

/** Maps authoritative trauma onto head injury sites. */
export function applyHeadTrauma(shading: InjuryShading, trauma: TraumaSnapshot, blood: BloodLevel): void {
  const bleed = bloodScale(blood);
  const graphic = blood === "full" ? 1 : 0.6;
  const eye = (value: number): number => Math.min(1.2, value / 380 + trauma.swelling / 900);
  const swell = (value: number): number => Math.min(2.2, (value / 520 + trauma.swelling / 700) * 1.6 * graphic);
  shading.set("leftEye", { bruise: eye(trauma.left_eye), swell: swell(trauma.left_eye) });
  shading.set("rightEye", { bruise: eye(trauma.right_eye), swell: swell(trauma.right_eye) });
  const browCut = (cut: number): number => Math.min(1, cut / 220);
  const browBlood = (cut: number): number => Math.min(1.4, (cut / 260 + trauma.bleeding / 520) * bleed);
  shading.set("leftBrow", { bruise: Math.min(1, trauma.left_eye / 700), swell: Math.min(1.2, trauma.left_eye / 900) * graphic, cut: browCut(trauma.left_cut), blood: browBlood(trauma.left_cut) });
  shading.set("rightBrow", { bruise: Math.min(1, trauma.right_eye / 700), swell: Math.min(1.2, trauma.right_eye / 900) * graphic, cut: browCut(trauma.right_cut), blood: browBlood(trauma.right_cut) });
  const cheek = Math.min(1, trauma.head / 950 + trauma.swelling / 1100);
  shading.set("leftCheek", { bruise: cheek * 0.9, swell: Math.min(1.4, trauma.swelling / 800) * graphic, cut: Math.min(1, Math.max(0, trauma.left_cut - 350) / 500), blood: Math.min(1, Math.max(0, trauma.left_cut - 350) / 400) * bleed });
  shading.set("rightCheek", { bruise: cheek * 0.85, swell: Math.min(1.4, trauma.swelling / 800) * graphic, cut: Math.min(1, Math.max(0, trauma.right_cut - 350) / 500), blood: Math.min(1, Math.max(0, trauma.right_cut - 350) / 400) * bleed });
  shading.set("nose", { bruise: Math.min(1, trauma.head / 800), swell: Math.min(0.8, trauma.head / 1400) * graphic, blood: Math.min(1.4, (Math.max(0, trauma.head - 160) / 520 + trauma.bleeding / 420) * bleed) });
  shading.set("mouth", { bruise: Math.min(0.8, trauma.head / 1100), cut: Math.min(1, Math.max(0, trauma.head - 420) / 700), blood: Math.min(1.2, (Math.max(0, trauma.head - 280) / 650 + trauma.bleeding / 500) * bleed) });
  shading.set("chin", { bruise: Math.min(0.7, trauma.head / 1300) });
  shading.set("leftJaw", { bruise: Math.min(0.9, trauma.left_eye / 900 + trauma.head / 1600) });
  shading.set("rightJaw", { bruise: Math.min(0.9, trauma.right_eye / 900 + trauma.head / 1600) });
  shading.set("forehead", { bruise: Math.min(0.6, trauma.swelling / 1200), cut: Math.min(1, Math.max(0, trauma.swelling - 520) / 480), blood: Math.min(1.2, Math.max(0, trauma.swelling - 520) / 420) * bleed });
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
