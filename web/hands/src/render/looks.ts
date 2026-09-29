import * as THREE from "three";

/**
 * What makes one fighter look unlike another. Every character is the same scanned man, so the look
 * recolours his hair, shaves it or grows a beard, reshapes the face a little and tints the skin.
 * A player's look comes from their id, so they are the same fighter in every bout and on every screen.
 */
export interface FighterLook {
  /** Multiplies the skin textures; white is the scanned tone. */
  readonly tint: number;
  readonly hair: number;
  /** 0 keeps the hair, 1 shaves the head. */
  readonly shaved: number;
  /** 0 clean shaven, 1 a full beard. */
  readonly beard: number;
  /** Each -1..1. */
  readonly jaw: number;
  readonly nose: number;
  readonly brow: number;
  readonly skull: number;
}

export const SCANNED_LOOK: FighterLook = { tint: 0xffffff, hair: 0x4a3323, shaved: 0, beard: 0, jaw: 0, nose: 0, brow: 0, skull: 0 };

export const OFFICIAL_LOOKS = {
  referee: { tint: 0xf2dccb, hair: 0x8c8a86, shaved: 0, beard: 0, jaw: -0.4, nose: 0.3, brow: -0.2, skull: 0.2 },
  blueCorner: { tint: 0xa98468, hair: 0x15100c, shaved: 1, beard: 0.8, jaw: 0.7, nose: 0.5, brow: 0.6, skull: 0.4 },
  redCorner: { tint: 0xffeedd, hair: 0x7a2f1c, shaved: 0, beard: 0.6, jaw: 0.2, nose: -0.5, brow: 0.1, skull: -0.3 },
  blueCutman: { tint: 0xd8b498, hair: 0x221710, shaved: 0, beard: 0, jaw: -0.6, nose: 0.8, brow: -0.5, skull: -0.5 },
  redCutman: { tint: 0x8a6650, hair: 0x15100c, shaved: 1, beard: 0.45, jaw: 0.5, nose: 0.2, brow: 0.8, skull: 0.6 },
} as const satisfies Record<string, FighterLook>;

const TINTS = [0xffffff, 0xf4dccb, 0xd9b699, 0xbf9678, 0xa38a7c, 0x8a6c5c, 0x6f5548];
const HAIR = [0x15100c, 0x221710, 0x3a2416, 0x5a3a20, 0x8a6a3c, 0xa88c58, 0x6e3420, 0x8c8a86];

function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

function seeded(seed: number): () => number {
  return () => {
    seed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed);
    return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
  };
}

export function lookFor(id: string): FighterLook {
  const rand = seeded(hash(id) || 1);
  const pick = <T>(from: readonly T[]): T => from[Math.floor(rand() * from.length)]!;
  const spread = (): number => Math.round((rand() * 2 - 1) * 100) / 100;
  const tint = pick(TINTS);
  const hair = pick(HAIR);
  const shaved = rand() < 0.28 ? 1 : 0;
  const beard = rand() < 0.45 ? 0 : Math.round((0.35 + rand() * 0.65) * 100) / 100;
  return { tint, hair, shaved, beard, jaw: spread(), nose: spread(), brow: spread(), skull: spread() };
}

/** The scanned face in linear light: what a shaved scalp is painted with. */
const SKIN = "vec3(0.84, 0.39, 0.175)";

const MASKS = /* glsl */ `
uniform vec3 uLookHair;
uniform vec4 uLookFace;
uniform vec2 uLookGroom;
varying vec3 vLookPos;
/** Where the scanned man has hair: above a hairline that runs from the forehead past the ear to the nape. */
float lookHairZone(vec3 p) {
  float behind = mix(115.3, 120.6, smoothstep(-6.8, -4.6, p.z));
  float line = mix(behind, 125.5, smoothstep(-4.6, 1.6, p.z));
  float nape = smoothstep(116.0, 121.0, p.y);
  float reach = mix(3.8, 9.0, nape);
  return smoothstep(line - 0.5, line + 0.5, p.y) * (1.0 - smoothstep(reach, reach + 1.0, abs(p.x)) * (1.0 - nape));
}
`;

const VERTEX_SHAPE = /* glsl */ `
{
  vec3 p = position;
  vLookPos = p;
  float jaw = (1.0 - smoothstep(113.5, 118.0, p.y)) * smoothstep(108.5, 112.0, p.y) * smoothstep(-7.0, -2.0, p.z);
  transformed.x += p.x * 0.12 * uLookFace.x * jaw;
  float nose = 1.0 - smoothstep(0.0, 2.6, distance(p, vec3(0.0, 117.2, 5.0)));
  transformed.x += p.x * 0.4 * uLookFace.y * nose;
  transformed.z += 0.5 * uLookFace.y * nose;
  float brow = (1.0 - smoothstep(0.0, 2.2, abs(p.y - 123.2))) * smoothstep(1.5, 3.5, p.z);
  transformed.z += 0.55 * uLookFace.z * brow;
  transformed.x += p.x * 0.06 * uLookFace.w * smoothstep(112.0, 116.0, p.y);
  // A shaved head loses the thickness of the scanned hair.
  float crown = lookHairZone(p) * uLookGroom.x;
  float fringe = smoothstep(-1.0, 3.0, p.z) * smoothstep(123.5, 126.0, p.y);
  transformed -= normalize(vec3(p.x, (p.y - 120.0) * 1.1, p.z + 2.5)) * mix(0.9, 1.9, fringe) * crown;
}
`;

const VERTEX_BAKED = /* glsl */ `
vLookPos = bindPosition;
`;

const FRAGMENT_GROOM = /* glsl */ `
#ifdef USE_MAP
{
  vec3 p = vLookPos;
  float scanned = dot(sampledDiffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  float hair = lookHairZone(p) * max(1.0 - smoothstep(0.13, 0.26, scanned), smoothstep(126.2, 127.4, p.y));
  vec3 dyed = uLookHair * clamp(scanned / 0.075, 0.45, 1.7);
  vec3 scalp = mix(${SKIN}, uLookHair, 0.1) * clamp(scanned / 0.075, 0.85, 1.12) * 0.9;
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(dyed, scalp, uLookGroom.x) * diffuse, hair);
  // The beard covers the chin and runs back along the jaw to the ear, clear of the neck beneath it.
  float front = mix(1.4, -4.8, smoothstep(111.2, 114.6, p.y));
  float jaw = (1.0 - smoothstep(115.4, 116.8, p.y)) * smoothstep(109.6, 110.6, p.y) * smoothstep(front - 0.6, front + 0.6, p.z);
  float lips = 1.0 - smoothstep(0.8, 2.0, length((p - vec3(0.0, 114.3, 4.8)) * vec3(0.55, 1.0, 0.4)));
  float grain = 0.8 + 0.2 * sin(p.x * 41.0 + p.z * 13.0) * sin(p.y * 47.0 + p.z * 29.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(uLookHair, ${SKIN}, 0.12) * 0.8 * diffuse, jaw * (1.0 - lips) * uLookGroom.y * grain * 0.88);
}
#endif
`;

export class LookShading {
  private readonly uniforms = {
    uLookHair: { value: new THREE.Color(SCANNED_LOOK.hair) },
    uLookFace: { value: new THREE.Vector4() },
    uLookGroom: { value: new THREE.Vector2() },
  };
  private current: FighterLook = SCANNED_LOOK;

  /**
   * Composes with a shader patch already on the material. A `baked` material draws geometry that is
   * no longer in bind space, which must carry its bind positions in a `bindPosition` attribute.
   */
  constructor(private readonly material: THREE.MeshStandardMaterial, baked = false) {
    const uniforms = this.uniforms;
    const before = material.onBeforeCompile;
    const beforeKey = Object.hasOwn(material, "customProgramCacheKey") ? material.customProgramCacheKey() : "plain";
    material.onBeforeCompile = (shader, renderer) => {
      before.call(material, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${baked ? "attribute vec3 bindPosition;" : ""}\n${MASKS}`)
        .replace("#include <morphtarget_vertex>", `${baked ? VERTEX_BAKED : VERTEX_SHAPE}\n#include <morphtarget_vertex>`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${MASKS}`)
        .replace("#include <map_fragment>", `#include <map_fragment>\n${FRAGMENT_GROOM}`);
    };
    material.customProgramCacheKey = () => `${beforeKey}-look-${baked ? "baked" : "live"}`;
    material.needsUpdate = true;
  }

  set(look: FighterLook): void {
    this.current = look;
    this.material.color.setHex(look.tint);
    this.uniforms.uLookHair.value.setHex(look.hair);
    this.uniforms.uLookFace.value.set(look.jaw, look.nose, look.brow, look.skull);
    this.uniforms.uLookGroom.value.set(look.shaved, look.beard);
  }

  get look(): FighterLook {
    return this.current;
  }
}
