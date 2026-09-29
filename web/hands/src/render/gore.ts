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
