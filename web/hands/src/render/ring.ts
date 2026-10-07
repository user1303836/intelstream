import * as THREE from "three";
import { CANVAS_TOP, CORNER_COLORS, PLATFORM_HALF, POST_RADIUS, RING_APRON_HALF, RING_FIGHT_HALF, ROPE_HEIGHTS, ROPE_LINE } from "./world";

export interface BuiltRing {
  readonly group: THREE.Group;
  readonly materials: readonly THREE.Material[];
  readonly geometries: readonly THREE.BufferGeometry[];
  readonly textures: readonly THREE.Texture[];
  /** Feeds the two fighters' world positions to the rope flex shader. */
  readonly setRopeContacts: (a: { x: number; z: number } | null, b: { x: number; z: number } | null) => void;
  readonly ropeContacts: readonly [THREE.Vector4, THREE.Vector4];
  /** Fades the ropes between the broadcast camera and the ring so they do not hide the fighters. */
  readonly setNearRopeOpacity: (opacity: number) => void;
  readonly nearRopeOpacity: () => number;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** The side of the ring that faces the broadcast camera. */
const NEAR_SIDE = 3;

/** How solid the near ropes are drawn for fighters whose nearest point to the camera is `z` metres from the centre. */
export function nearRopeOpacityFor(z: number): number {
  return 1 - 0.74 * smoothstep(-0.6, 1.4, z);
}

export interface RopePress {
  readonly pressX: number;
  readonly pressZ: number;
}

/** The ropes run behind a fighter's back, this far from the middle of the body. */
const ROPE_BACK = 0.2;
/** Along the rope, the give is full across the back and gone this far from the fighter. */
const ROPE_GIVE_FLAT = 0.22;
const ROPE_GIVE_REACH = 1.15;
/** The rope is tied at the post and gives nothing there. */
const ROPE_TIE = 0.5;
/** The bottom rope is pushed by the legs, which lean back less than the shoulders. */
const ROPE_LOW_GIVE = 0.6;

/**
 * How far, in metres, a fighter at (x, z) pushes the ropes on the x and z sides outward. The engine
 * lets a fighter's middle pass the line of the ropes, so they give way to stay behind the back.
 */
export function ropePress(x: number, z: number): RopePress {
  return {
    pressX: Math.max(0, Math.abs(x) + ROPE_BACK - ROPE_LINE),
    pressZ: Math.max(0, Math.abs(z) + ROPE_BACK - ROPE_LINE),
  };
}

/**
 * The share of that push a point of the rope takes: `along` the rope from the fighter, at `position`
 * along the rope and at `height`. It is the shader's own function, and a test runs this text.
 */
export const ROPE_GIVE_GLSL = `
float ropeGive(float along, float position, float height) {
  float near = 1.0 - smoothstep(${ROPE_GIVE_FLAT.toFixed(2)}, ${ROPE_GIVE_REACH.toFixed(2)}, abs(along));
  float tied = smoothstep(0.0, ${ROPE_TIE.toFixed(2)}, ${ROPE_LINE.toFixed(4)} - abs(position));
  return near * tied * (${ROPE_LOW_GIVE.toFixed(2)} + ${(1 - ROPE_LOW_GIVE).toFixed(2)} * smoothstep(0.5, 0.88, height));
}
`;

export const ROPE_FLEX_GLSL = `
vec3 ropeWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
bool ropeSideX = abs(ropeWorld.x) > abs(ropeWorld.z);
vec3 ropeOut = ropeSideX ? vec3(sign(ropeWorld.x), 0.0, 0.0) : vec3(0.0, 0.0, sign(ropeWorld.z));
float ropeAlong = ropeSideX ? ropeWorld.z : ropeWorld.x;
float ropeFlex = 0.0;
for (int ropeIndex = 0; ropeIndex < 2; ropeIndex += 1) {
  vec4 contact = ropeIndex == 0 ? uRopeContactA : uRopeContactB;
  float along = ropeSideX ? contact.y : contact.x;
  float press = ropeSideX ? contact.z : contact.w;
  float sameSide = ropeSideX ? step(0.0, ropeOut.x * contact.x) : step(0.0, ropeOut.z * contact.y);
  ropeFlex = max(ropeFlex, press * sameSide * ropeGive(ropeAlong - along, ropeAlong, ropeWorld.y));
}
transformed += ropeOut * ropeFlex;
`;

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) draw(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function ringCanvasTexture(): THREE.CanvasTexture {
  return canvasTexture(1024, (ctx, size) => {
    ctx.fillStyle = "#9d968a";
    ctx.fillRect(0, 0, size, size);
    const noise = ctx.createLinearGradient(0, 0, size, size);
    noise.addColorStop(0, "rgba(255,255,255,0.08)");
    noise.addColorStop(0.5, "rgba(60,50,40,0.06)");
    noise.addColorStop(1, "rgba(255,255,255,0.04)");
    ctx.fillStyle = noise;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 2600; i += 1) {
      const x = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      const y = (Math.sin(i * 78.233) * 12543.1234) % 1;
      ctx.fillStyle = `rgba(${i % 3 === 0 ? "255,255,255" : "70,55,45"},${0.02 + (i % 5) * 0.006})`;
      ctx.fillRect(Math.abs(x) * size, Math.abs(y) * size, 2 + (i % 4), 1 + (i % 3));
    }
    for (let i = 0; i < 40; i += 1) {
      const x = Math.abs((Math.sin(i * 91.7) * 7919.3) % 1) * size;
      const y = Math.abs((Math.sin(i * 47.1) * 4271.9) % 1) * size;
      ctx.fillStyle = `rgba(80,60,50,${0.05 + (i % 4) * 0.02})`;
      ctx.beginPath();
      ctx.ellipse(x, y, 18 + (i % 7) * 6, 6 + (i % 5) * 3, (i * 0.7) % Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(30,60,140,0.85)";
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(30,60,140,0.9)";
    ctx.font = `800 ${Math.round(size * 0.062)}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("H A N D S", size / 2, size / 2 - size * 0.012);
    ctx.font = `600 ${Math.round(size * 0.024)}px Inter, system-ui, sans-serif`;
    ctx.fillText("CHAMPIONSHIP BOXING", size / 2, size / 2 + size * 0.052);
    ctx.strokeStyle = "rgba(30,60,140,0.6)";
    ctx.lineWidth = 6;
    ctx.strokeRect(size * 0.035, size * 0.035, size * 0.93, size * 0.93);
  });
}

export function buildRing(): BuiltRing {
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const group = new THREE.Group();
  group.name = "ring";

  const canvasMap = ringCanvasTexture();
  textures.push(canvasMap);
  const canvasMat = new THREE.MeshStandardMaterial({ map: canvasMap, roughness: 0.88, metalness: 0 });
  materials.push(canvasMat);
  const canvasGeo = new THREE.PlaneGeometry(RING_FIGHT_HALF * 2, RING_FIGHT_HALF * 2);
  geometries.push(canvasGeo);
  const canvasMesh = new THREE.Mesh(canvasGeo, canvasMat);
  canvasMesh.rotation.x = -Math.PI / 2;
  canvasMesh.position.y = CANVAS_TOP + 0.002;
  canvasMesh.receiveShadow = true;
  group.add(canvasMesh);

  const apronMat = new THREE.MeshStandardMaterial({ color: "#1c2b52", roughness: 0.85 });
  materials.push(apronMat);
  const apronGeo = new THREE.RingGeometry(RING_FIGHT_HALF * 0.98, RING_APRON_HALF, 4, 1);
  geometries.push(apronGeo);
  const apron = new THREE.Mesh(apronGeo, apronMat);
  apron.rotation.x = -Math.PI / 2;
  apron.rotation.z = Math.PI / 4;
  apron.position.y = CANVAS_TOP + 0.001;
  apron.receiveShadow = true;
  group.add(apron);

  const platformMat = new THREE.MeshStandardMaterial({ color: "#0c1424", roughness: 0.9 });
  materials.push(platformMat);
  const platformGeo = new THREE.BoxGeometry(PLATFORM_HALF * 2, 1.0, PLATFORM_HALF * 2);
  geometries.push(platformGeo);
  const platform = new THREE.Mesh(platformGeo, platformMat);
  platform.position.y = -0.5;
  platform.receiveShadow = true;
  group.add(platform);

  const skirtMat = new THREE.MeshStandardMaterial({ color: "#101b33", roughness: 0.95 });
  materials.push(skirtMat);
  for (let side = 0; side < 4; side += 1) {
    const skirtGeo = new THREE.PlaneGeometry(PLATFORM_HALF * 2, 0.95);
    geometries.push(skirtGeo);
    const skirt = new THREE.Mesh(skirtGeo, skirtMat);
    const angle = (side * Math.PI) / 2;
    skirt.position.set(Math.sin(angle) * (PLATFORM_HALF - 0.001), -0.48, Math.cos(angle) * (PLATFORM_HALF - 0.001));
    skirt.rotation.y = angle;
    group.add(skirt);
  }

  const steelMat = new THREE.MeshStandardMaterial({ color: "#9aa7b5", roughness: 0.35, metalness: 0.75 });
  materials.push(steelMat);
  const cornerColors = [CORNER_COLORS.blue, CORNER_COLORS.neutral, CORNER_COLORS.red, CORNER_COLORS.neutral];
  const postGeo = new THREE.CylinderGeometry(0.055, 0.055, 1.55, 12);
  geometries.push(postGeo);
  const padGeo = new THREE.BoxGeometry(0.34, 0.52, 0.13);
  geometries.push(padGeo);
  const buckleGeo = new THREE.BoxGeometry(0.16, 0.07, 0.1);
  geometries.push(buckleGeo);
  const corners: THREE.Vector3[] = [];
  for (let corner = 0; corner < 4; corner += 1) {
    const angle = Math.PI / 4 + (corner * Math.PI) / 2;
    const x = Math.sin(angle) * POST_RADIUS * Math.SQRT2 * 0.72;
    const z = Math.cos(angle) * POST_RADIUS * Math.SQRT2 * 0.72;
    corners.push(new THREE.Vector3(x, 0, z));
    const post = new THREE.Mesh(postGeo, steelMat);
    post.position.set(x, 0.78, z);
    post.castShadow = true;
    group.add(post);
    const padMat = new THREE.MeshStandardMaterial({ color: cornerColors[corner]!, roughness: 0.55 });
    materials.push(padMat);
    for (const height of [0.62, 1.12]) {
      const pad = new THREE.Mesh(padGeo, padMat);
      pad.position.set(x * 0.985, height, z * 0.985);
      pad.lookAt(0, height, 0);
      pad.castShadow = true;
      group.add(pad);
    }
  }

  const ropeContacts: [THREE.Vector4, THREE.Vector4] = [new THREE.Vector4(0, 0, 0, 0), new THREE.Vector4(0, 0, 0, 0)];
  const ropeUniforms = { uRopeContactA: { value: ropeContacts[0] }, uRopeContactB: { value: ropeContacts[1] } };
  const ropeColors = [0xb91c1c, 0xe5e7eb, 0x1d4ed8];
  const flexMaterial = (parameters: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial => {
    const material = new THREE.MeshStandardMaterial(parameters);
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uRopeContactA = ropeUniforms.uRopeContactA;
      shader.uniforms.uRopeContactB = ropeUniforms.uRopeContactB;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\nuniform vec4 uRopeContactA;\nuniform vec4 uRopeContactB;\n${ROPE_GIVE_GLSL}`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>${ROPE_FLEX_GLSL}`);
    };
    materials.push(material);
    return material;
  };
  const ropeMaterial = (color: number): THREE.MeshStandardMaterial => flexMaterial({ color, roughness: 0.42, metalness: 0.05 });
  const ropeMats = ropeColors.map(ropeMaterial);
  const nearMaterials: THREE.MeshStandardMaterial[] = ropeColors.map(ropeMaterial);
  // The straps tie the ropes together, so they give with them where a fighter presses into the ropes.
  const tieMat = flexMaterial({ color: 0xd8dee8, roughness: 0.6 });
  const nearTieMat = flexMaterial({ color: 0xd8dee8, roughness: 0.6 });
  nearMaterials.push(nearTieMat);
  const tieGeo = new THREE.BoxGeometry(0.035, 0.82, 0.012);
  geometries.push(tieGeo);
  const setRopeContacts = (a: { x: number; z: number } | null, b: { x: number; z: number } | null): void => {
    for (const [index, contact] of [a, b].entries()) {
      const target = ropeContacts[index]!;
      if (contact === null) {
        target.set(0, 0, 0, 0);
        continue;
      }
      const press = ropePress(contact.x, contact.z);
      target.set(contact.x, contact.z, press.pressX, press.pressZ);
    }
  };
  for (let side = 0; side < 4; side += 1) {
    const from = corners[side]!;
    const to = corners[(side + 1) % 4]!;
    for (const [ropeIndex, height] of ROPE_HEIGHTS.entries()) {
      const middle = from.clone().add(to).multiplyScalar(0.5);
      middle.y = height - 0.045;
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(from.x, height, from.z),
        middle,
        new THREE.Vector3(to.x, height, to.z),
      );
      // Enough segments for the rope to curve round a fighter's back rather than kink.
      const ropeGeo = new THREE.TubeGeometry(curve, 72, 0.028, 8, false);
      geometries.push(ropeGeo);
      const rope = new THREE.Mesh(ropeGeo, (side === NEAR_SIDE ? nearMaterials : ropeMats)[ropeIndex]!);
      rope.castShadow = true;
      group.add(rope);
      for (const t of [0.33, 0.66]) {
        const point = curve.getPoint(t);
        const tie = new THREE.Mesh(tieGeo, side === NEAR_SIDE ? nearTieMat : tieMat);
        tie.position.set(point.x, height - 0.36, point.z);
        tie.lookAt(0, height - 0.36, 0);
        group.add(tie);
      }
    }
  }

  for (const material of nearMaterials) material.transparent = true;
  const setNearRopeOpacity = (opacity: number): void => {
    for (const material of nearMaterials) {
      material.opacity = THREE.MathUtils.clamp(opacity, 0, 1);
      // Faded right out they are not drawn at all, or they would still write depth and catch the bloom.
      material.visible = material.opacity > 0.03;
    }
  };

  return { group, materials, geometries, textures, setRopeContacts, ropeContacts, setNearRopeOpacity, nearRopeOpacity: () => nearMaterials[0]!.opacity };
}

export function disposeRing(ring: BuiltRing): void {
  for (const geometry of ring.geometries) geometry.dispose();
  for (const material of ring.materials) material.dispose();
  for (const texture of ring.textures) texture.dispose();
}
