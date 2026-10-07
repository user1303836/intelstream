import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** A lump of torn flesh: an irregular, smooth, slightly flattened blob about 6 cm across before scaling. */
export function buildChunkGeometry(): THREE.BufferGeometry {
  const source = new THREE.IcosahedronGeometry(1, 2);
  source.deleteAttribute("normal");
  source.deleteAttribute("uv");
  const geometry = mergeVertices(source, 1e-4);
  source.dispose();
  const position = geometry.getAttribute("position");
  const vertex = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 1) {
    vertex.fromBufferAttribute(position, index).normalize();
    const lump = 1
      + 0.3 * Math.sin(3.1 * vertex.x + 1.3) * Math.sin(2.7 * vertex.y + 0.7)
      + 0.2 * Math.sin(5.3 * vertex.z + 2.1) * Math.sin(4.1 * vertex.x - 0.4)
      + 0.12 * Math.sin(7.7 * vertex.y + 0.9);
    vertex.multiplyScalar(0.03 * lump);
    position.setXYZ(index, vertex.x, vertex.y * 0.62, vertex.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Engine damage of a landed punch: most deal 30 to 80, a hard shot 70 or more and a big counter
 * 95 or more (the largest, a power counter, about 150). A knockdown event carries the count, not damage.
 */
export const HARD_SHOT = 70;
export const BIG_SHOT = 95;

/** Teeth a blow to the head knocks out: two more as the punch floors a man, one or two by a big counter or a huge shot, none otherwise. */
export function teethFor(kind: string, amount: number, head: boolean): number {
  if (!head) return 0;
  if (kind === "knockdown") return 2;
  if (kind === "counter_hit" && amount >= BIG_SHOT) return amount >= 120 ? 2 : 1;
  if (kind === "hit" && amount >= 115) return 1;
  return 0;
}

/** Drops of blood a blow throws at full blood: more from an open wound, and more from a harder punch. */
export function bloodDropsFor(blood: number, amount: number): number {
  return Math.min(140, Math.round(Math.max(0, blood) * 1.4 + Math.max(0, amount - 50) * 0.5));
}

const DROPLET_TAIL = 2;
const DROPLET_TAIL_TAPER = 0.45;
const DROPLET_STRETCH_RATE = 0.6;
const DROPLET_MAX_STRETCH = 3;

/** A drop in flight, travelling along +Y: a round head of unit radius and a tail that thins out behind it. */
export function buildDropletGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(1, 8, 6);
  const position = geometry.getAttribute("position");
  for (let index = 0; index < position.count; index += 1) {
    const back = -position.getY(index);
    if (back <= 0) continue;
    const thin = 1 - DROPLET_TAIL_TAPER * back;
    position.setXYZ(index, position.getX(index) * thin, -back * DROPLET_TAIL, position.getZ(index) * thin);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * How a drop of `radius` moving at `speed` is drawn: smeared along its path as a camera would catch it,
 * and thinner the longer the smear, so a fast drop is a streak and not a bigger drop.
 */
export function dropletShape(radius: number, speed: number, out: { width: number; length: number }): { width: number; length: number } {
  const stretch = 1 + Math.min(DROPLET_MAX_STRETCH, Math.max(0, speed) * DROPLET_STRETCH_RATE);
  out.width = radius / Math.sqrt(stretch);
  out.length = radius * stretch;
  return out;
}

/** Blood in the air, from freshly lit to nearly black. Linear colour. */
export const BLOOD_SHADES = [
  { r: 0.4, g: 0.012, b: 0.016 },
  { r: 0.26, g: 0.006, b: 0.01 },
  { r: 0.15, g: 0.003, b: 0.006 },
] as const;

export function bloodShade(pick: number): { r: number; g: number; b: number } {
  return BLOOD_SHADES[Math.min(BLOOD_SHADES.length - 1, Math.max(0, Math.floor(pick * BLOOD_SHADES.length)))]!;
}

/**
 * The exposed surface of a cut through a limb or the neck: an ellipse in the XZ plane facing +Y,
 * level with the skin at the rim and rising to uneven flesh in the middle.
 */
export function buildWoundGeometry(radiusX: number, radiusZ: number, rise = 0.012): THREE.BufferGeometry {
  const rings = 6;
  const segments = 28;
  const positions: number[] = [0, rise, 0];
  const uvs: number[] = [0.5, 0.5];
  const index: number[] = [];
  for (let ring = 1; ring <= rings; ring += 1) {
    const reach = ring / rings;
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      const lump = Math.sin(angle * 3 + reach * 5) * Math.sin(angle * 7 + 1.3);
      positions.push(Math.cos(angle) * reach * radiusX, rise * (1 - reach * reach) + rise * 0.3 * lump * (1 - reach), Math.sin(angle) * reach * radiusZ);
      uvs.push(0.5 + 0.5 * reach * Math.cos(angle), 0.5 + 0.5 * reach * Math.sin(angle));
    }
  }
  const at = (ring: number, segment: number): number => 1 + (ring - 1) * segments + (segment % segments);
  for (let segment = 0; segment < segments; segment += 1) index.push(0, at(1, segment + 1), at(1, segment));
  for (let ring = 1; ring < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      index.push(at(ring, segment), at(ring, segment + 1), at(ring + 1, segment));
      index.push(at(ring, segment + 1), at(ring + 1, segment + 1), at(ring + 1, segment));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The open edge a cut leaves, as the two vertices of each of its edges in turn: the edges of the
 * kept triangles that the whole mesh closes. Vertices that share a position count as one, so a seam
 * is not an edge.
 */
export function cutRim(geometry: THREE.BufferGeometry, keep: (position: THREE.Vector3) => boolean): number[] {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  if (index === null) return [];
  const first = new Map<string, number>();
  const shared = new Int32Array(position.count);
  const kept = new Uint8Array(position.count);
  const vertex = new THREE.Vector3();
  for (let at = 0; at < position.count; at += 1) {
    vertex.fromBufferAttribute(position, at);
    const key = `${Math.round(vertex.x * 1000)},${Math.round(vertex.y * 1000)},${Math.round(vertex.z * 1000)}`;
    const known = first.get(key);
    if (known === undefined) first.set(key, at);
    shared[at] = known ?? at;
    kept[at] = keep(vertex) ? 1 : 0;
  }
  // Per edge: how many triangles of the whole mesh use it, and how many of the kept ones.
  const edges = new Map<number, [number, number]>();
  for (let at = 0; at < index.count; at += 3) {
    const corners = [index.getX(at), index.getX(at + 1), index.getX(at + 2)];
    const whole = corners.every((corner) => kept[corner] === 1);
    for (let edge = 0; edge < 3; edge += 1) {
      const a = shared[corners[edge]!]!;
      const b = shared[corners[(edge + 1) % 3]!]!;
      const key = a < b ? a * position.count + b : b * position.count + a;
      const uses = edges.get(key) ?? [0, 0];
      uses[0] += 1;
      if (whole) uses[1] += 1;
      edges.set(key, uses);
    }
  }
  const rim: number[] = [];
  for (const [key, [all, held]] of edges) if (held === 1 && all >= 2) rim.push(Math.floor(key / position.count), key % position.count);
  return rim;
}

/** How far the shading of the flesh leans outward at its rim. */
const CUT_ROUNDING = 0.5;
const cutAcross = new THREE.Vector3();
const cutAlong = new THREE.Vector3();
const cutA = new THREE.Vector3();
const cutB = new THREE.Vector3();
const cutFace = new THREE.Vector3();

/**
 * Closes the opening a cut leaves with flesh: a fan from the middle of the cut, raised a little, to
 * every edge of its rim, so it meets the skin all the way round. `rim` holds both ends of each edge
 * in turn. The surface is written into `geometry`, measured from `centre`, and faces `outward`.
 */
export function closeCut(geometry: THREE.BufferGeometry, rim: ArrayLike<number>, centre: THREE.Vector3, outward: THREE.Vector3, rise = 0.01): void {
  const edges = Math.floor(rim.length / 6);
  let position = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  let normal = geometry.getAttribute("normal") as THREE.BufferAttribute | undefined;
  let uv = geometry.getAttribute("uv") as THREE.BufferAttribute | undefined;
  if (position === undefined || normal === undefined || uv === undefined || position.count !== edges * 3) {
    position = new THREE.BufferAttribute(new Float32Array(edges * 9), 3).setUsage(THREE.DynamicDrawUsage);
    normal = new THREE.BufferAttribute(new Float32Array(edges * 9), 3).setUsage(THREE.DynamicDrawUsage);
    uv = new THREE.BufferAttribute(new Float32Array(edges * 6), 2).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("position", position);
    geometry.setAttribute("normal", normal);
    geometry.setAttribute("uv", uv);
  }
  cutAcross.set(1, 0, 0);
  if (Math.abs(outward.x) > 0.9) cutAcross.set(0, 0, 1);
  cutAlong.crossVectors(outward, cutAcross).normalize();
  cutAcross.crossVectors(cutAlong, outward).normalize();
  let reach = 1e-6;
  for (let at = 0; at < edges * 6; at += 3) reach = Math.max(reach, Math.hypot(rim[at]! - centre.x, rim[at + 1]! - centre.y, rim[at + 2]! - centre.z));
  for (let edge = 0; edge < edges; edge += 1) {
    cutA.set(rim[edge * 6]!, rim[edge * 6 + 1]!, rim[edge * 6 + 2]!).sub(centre);
    cutB.set(rim[edge * 6 + 3]!, rim[edge * 6 + 4]!, rim[edge * 6 + 5]!).sub(centre);
    const flipped = cutFace.crossVectors(cutA, cutB).dot(outward) < 0;
    const first = flipped ? cutB : cutA;
    const second = flipped ? cutA : cutB;
    position.setXYZ(edge * 3, outward.x * rise, outward.y * rise, outward.z * rise);
    position.setXYZ(edge * 3 + 1, first.x, first.y, first.z);
    position.setXYZ(edge * 3 + 2, second.x, second.y, second.z);
    // Shaded as one rounded surface: the rim of a cut is ragged, and its own faces would glint like an umbrella.
    normal.setXYZ(edge * 3, outward.x, outward.y, outward.z);
    for (const [corner, end] of [[1, first], [2, second]] as const) {
      cutFace.copy(end).addScaledVector(outward, -end.dot(outward)).multiplyScalar(CUT_ROUNDING / reach).add(outward).normalize();
      normal.setXYZ(edge * 3 + corner, cutFace.x, cutFace.y, cutFace.z);
    }
    uv.setXY(edge * 3, 0.5, 0.5);
    uv.setXY(edge * 3 + 1, 0.5 + (0.5 * first.dot(cutAcross)) / reach, 0.5 + (0.5 * first.dot(cutAlong)) / reach);
    uv.setXY(edge * 3 + 2, 0.5 + (0.5 * second.dot(cutAcross)) / reach, 0.5 + (0.5 * second.dot(cutAlong)) / reach);
  }
  position.needsUpdate = true;
  normal.needsUpdate = true;
  uv.needsUpdate = true;
  geometry.computeBoundingSphere();
}

/** Cross-section of a neck: muscle around the windpipe, the spine at the back and the great vessels either side. */
export function woundTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    const base = ctx.createRadialGradient(64, 64, 6, 64, 64, 64);
    base.addColorStop(0, "#6e0d12");
    base.addColorStop(0.7, "#4a070b");
    base.addColorStop(1, "#2a0306");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    let seed = 0x9e3779b9;
    const rand = (): number => {
      seed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed);
      return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
    };
    for (let bundle = 0; bundle < 46; bundle += 1) {
      const angle = rand() * Math.PI * 2;
      const distance = 14 + rand() * 42;
      ctx.fillStyle = rand() < 0.5 ? "rgba(150,28,30,0.55)" : "rgba(40,4,8,0.5)";
      ctx.beginPath();
      ctx.ellipse(64 + Math.cos(angle) * distance, 64 + Math.sin(angle) * distance, 3 + rand() * 6, 2 + rand() * 3, angle, 0, Math.PI * 2);
      ctx.fill();
    }
    const disc = (x: number, y: number, radius: number, fill: string): void => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    };
    disc(64, 38, 10, "#8f7c64");
    disc(61, 36, 4.5, "#6a2a25");
    disc(66, 78, 7, "#7a3c34");
    disc(66, 78, 4.5, "#150203");
    disc(41, 64, 3, "#1d0204");
    disc(90, 69, 2.6, "#1d0204");
    for (let fleck = 0; fleck < 70; fleck += 1) {
      const angle = rand() * Math.PI * 2;
      const distance = rand() * 60;
      disc(64 + Math.cos(angle) * distance, 64 + Math.sin(angle) * distance, 0.6 + rand() * 1.6, rand() < 0.4 ? "rgba(190,60,50,0.5)" : "rgba(20,2,4,0.55)");
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
