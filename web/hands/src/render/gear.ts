import * as THREE from "three";

/**
 * The scanned gloves and trunks are black with pale trim, so tinting them left both fighters in
 * black. The dark cloth is redrawn in the corner's colour with the scan's folds, and the trim in
 * white. Blood soaks a glove from the knuckles back, so the cuff keeps the corner's colour.
 */

const DECLARATIONS = /* glsl */ `
uniform float uGearBlood;
varying vec3 vGearPos;
`;

const FRAGMENT = /* glsl */ `
#ifdef USE_MAP
{
  float scanned = dot(sampledDiffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 cloth = diffuse * clamp(scanned / 0.035, 0.45, 1.5) * 0.85;
  vec3 piping = vec3(0.68) * clamp(scanned / 0.22, 0.6, 1.15);
  gearTrim = smoothstep(0.07, 0.12, scanned);
  diffuseColor.rgb = mix(cloth, piping, gearTrim);
  float ragged = 0.08 * sin(vGearPos.y * 1.9 + vGearPos.z * 2.3) * sin(vGearPos.z * 1.3 - vGearPos.x * 0.7);
#ifdef GEAR_TRUNKS
  // Blood runs down the chest into the front of the waistband and soaks down from there in runs.
  float runs = 0.5 + 0.5 * sin(vGearPos.x * 0.9 + 1.3) * sin(vGearPos.x * 2.3);
  float depth = mix(2.0, 22.0, uGearBlood) * (0.45 + 0.55 * runs) + ragged * 20.0;
  float front = smoothstep(-1.0, 3.0, vGearPos.z) * (1.0 - smoothstep(9.0, 15.0, abs(vGearPos.x)));
  gearSoaked = (1.0 - smoothstep(depth, depth + 3.0, 80.0 - vGearPos.y)) * front * min(1.0, uGearBlood * 2.5);
#else
  float knuckles = smoothstep(46.0, 55.0, abs(vGearPos.x));
  float reach = mix(1.05, 0.5, uGearBlood) + ragged;
  gearSoaked = smoothstep(reach, reach + 0.22, knuckles) * min(1.0, uGearBlood * 3.0);
#endif
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.11, 0.003, 0.005), gearSoaked * 0.9);
}
#endif
`;

const ROUGHNESS = /* glsl */ `
roughnessFactor = mix(mix(roughnessFactor, 0.8, gearTrim), 0.2, gearSoaked);
`;

/**
 * Returns the uniform that holds how bloodied the gear is, 0 to 1. A `baked` material draws geometry
 * that is no longer in bind space, which carries its bind positions in a `bindPosition` attribute.
 */
export function wearCornerColour(material: THREE.MeshStandardMaterial, baked = false, part: "gloves" | "trunks" = "gloves"): { value: number } {
  const blood = { value: 0 };
  if (part === "trunks") material.defines = { ...material.defines, GEAR_TRUNKS: "" };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGearBlood = blood;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${baked ? "attribute vec3 bindPosition;" : ""}\n${DECLARATIONS}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvGearPos = ${baked ? "bindPosition" : "position"};`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${DECLARATIONS}\nfloat gearSoaked = 0.0;\nfloat gearTrim = 0.0;`)
      .replace("#include <map_fragment>", `#include <map_fragment>\n${FRAGMENT}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n${ROUGHNESS}`);
  };
  material.customProgramCacheKey = () => `hands-gear-${baked ? "baked" : "live"}`;
  material.needsUpdate = true;
  return blood;
}
