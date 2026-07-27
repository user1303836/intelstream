import * as THREE from "three";
import { CANVAS_TOP, CORNER_COLORS, PLATFORM_HALF, POST_RADIUS, RING_APRON_HALF, RING_FIGHT_HALF, ROPE_HEIGHTS } from "./world";

export interface BuiltRing {
  readonly group: THREE.Group;
  readonly materials: readonly THREE.Material[];
  readonly geometries: readonly THREE.BufferGeometry[];
  readonly textures: readonly THREE.Texture[];
}

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
    ctx.fillStyle = "#2c4386";
    ctx.fillRect(0, 0, size, size);
    const noise = ctx.createLinearGradient(0, 0, size, size);
    noise.addColorStop(0, "rgba(255,255,255,0.05)");
    noise.addColorStop(0.5, "rgba(0,0,0,0.04)");
    noise.addColorStop(1, "rgba(255,255,255,0.03)");
    ctx.fillStyle = noise;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 900; i += 1) {
      const x = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      const y = (Math.sin(i * 78.233) * 12543.1234) % 1;
      ctx.fillStyle = `rgba(${i % 2 === 0 ? "255,255,255" : "10,20,50"},${0.015 + (i % 5) * 0.004})`;
      ctx.fillRect(Math.abs(x) * size, Math.abs(y) * size, 2 + (i % 3), 1 + (i % 2));
    }
    ctx.strokeStyle = "rgba(235,240,255,0.9)";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(235,240,255,0.92)";
    ctx.font = `800 ${Math.round(size * 0.062)}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("H A N D S", size / 2, size / 2 - size * 0.012);
    ctx.font = `600 ${Math.round(size * 0.024)}px Inter, system-ui, sans-serif`;
    ctx.fillText("AUTHORITATIVE BOXING", size / 2, size / 2 + size * 0.052);
    ctx.strokeStyle = "rgba(235,240,255,0.55)";
    ctx.lineWidth = 5;
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
  const canvasMat = new THREE.MeshStandardMaterial({ map: canvasMap, roughness: 0.92, metalness: 0 });
  materials.push(canvasMat);
  const canvasGeo = new THREE.PlaneGeometry(RING_FIGHT_HALF * 2, RING_FIGHT_HALF * 2);
  geometries.push(canvasGeo);
  const canvasMesh = new THREE.Mesh(canvasGeo, canvasMat);
  canvasMesh.rotation.x = -Math.PI / 2;
  canvasMesh.position.y = CANVAS_TOP + 0.002;
  canvasMesh.receiveShadow = true;
  group.add(canvasMesh);

  const apronMat = new THREE.MeshStandardMaterial({ color: "#16233f", roughness: 0.85 });
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

  const ropeColors = [0xb91c1c, 0xe5e7eb, 0x1d4ed8];
  const ropeMats = ropeColors.map((color) => {
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.05 });
    materials.push(material);
    return material;
  });
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
      const ropeGeo = new THREE.TubeGeometry(curve, 24, 0.028, 8, false);
      geometries.push(ropeGeo);
      const rope = new THREE.Mesh(ropeGeo, ropeMats[ropeIndex]!);
      rope.castShadow = true;
      group.add(rope);
      for (const t of [0.33, 0.66]) {
        const point = curve.getPoint(t);
        const tieGeo = new THREE.BoxGeometry(0.035, 0.82, 0.012);
        geometries.push(tieGeo);
        const tieMat = new THREE.MeshStandardMaterial({ color: 0xd8dee8, roughness: 0.6 });
        materials.push(tieMat);
        const tie = new THREE.Mesh(tieGeo, tieMat);
        tie.position.set(point.x, height - 0.36, point.z);
        tie.lookAt(0, height - 0.36, 0);
        group.add(tie);
      }
    }
  }

  return { group, materials, geometries, textures };
}

export function disposeRing(ring: BuiltRing): void {
  for (const geometry of ring.geometries) geometry.dispose();
  for (const material of ring.materials) material.dispose();
  for (const texture of ring.textures) texture.dispose();
}
