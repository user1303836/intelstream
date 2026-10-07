import * as THREE from "three";
import { CANVAS_TOP, RING_FIGHT_HALF } from "./world";

const STAMP_SIZE = 128;
const STAMP_COUNT = 4;
/** Seconds between uploads of the painted canvas to the GPU while blood keeps landing. */
export const CANVAS_BLOOD_UPLOAD_INTERVAL = 0.12;

const seeded = (seed: number): (() => number) => () => {
  seed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed);
  return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
};

/** An irregular splash: a main blot, satellite blots and flecks thrown clear of it, white on clear. */
function splatStamp(seed: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = STAMP_SIZE;
  canvas.height = STAMP_SIZE;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    const rand = seeded(seed);
    ctx.clearRect(0, 0, STAMP_SIZE, STAMP_SIZE);
    ctx.fillStyle = "rgba(255,255,255,1)";
    const blobs = 7 + Math.floor(rand() * 6);
    for (let i = 0; i < blobs; i += 1) {
      const angle = rand() * Math.PI * 2;
      const distance = i === 0 ? 0 : 8 + rand() * 40;
      const radius = i === 0 ? 24 + rand() * 12 : 3 + rand() * 12;
      ctx.globalAlpha = i === 0 ? 1 : 0.7 + rand() * 0.3;
      ctx.beginPath();
      ctx.ellipse(64 + Math.cos(angle) * distance, 64 + Math.sin(angle) * distance, radius, radius * (0.55 + rand() * 0.5), rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < 12; i += 1) {
      const angle = rand() * Math.PI * 2;
      const distance = 30 + rand() * 30;
      ctx.beginPath();
      ctx.arc(64 + Math.cos(angle) * distance, 64 + Math.sin(angle) * distance, 1 + rand() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return canvas;
}

/** Blood soaks into the canvas darker than it flies: stains are drawn at four fifths of their colour. */
const css = (color: number): string => {
  const shade = (shift: number): number => Math.round(((color >> shift) & 0xff) * 0.8);
  return `rgb(${shade(16)},${shade(8)},${shade(0)})`;
};

/** The part of the renderer that sends a painted region to the GPU without the rest of the texture. */
export interface RegionUploader {
  initTexture(texture: THREE.Texture): void;
  copyTextureToTexture(source: THREE.Texture, destination: THREE.Texture, region: THREE.Box2, position: THREE.Vector2): void;
}

/**
 * Blood on the canvas, painted into one texture that lies over the ring: a stain stays where it fell
 * for the whole bout, it darkens where stains overlap, and any number of them cost one draw. Only the
 * part painted since the last upload goes to the GPU.
 */
export class CanvasBlood {
  readonly mesh: THREE.Mesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D | null;
  private readonly texture: THREE.CanvasTexture;
  /** The same canvas as an upload source the renderer never draws, so copying from it reads the painted pixels. */
  private readonly source: THREE.Texture;
  private uploader: RegionUploader | null = null;
  private readonly region = new THREE.Box2();
  private readonly regionAt = new THREE.Vector2();
  private readonly material: THREE.MeshStandardMaterial;
  private readonly geometry: THREE.PlaneGeometry;
  private readonly stamps: HTMLCanvasElement[] = [];
  private readonly scratch: HTMLCanvasElement;
  private readonly scratchContext: CanvasRenderingContext2D | null;
  private readonly pixelsPerMetre: number;
  private dirty = false;
  private sinceUpload = 0;
  private uploadInterval = CANVAS_BLOOD_UPLOAD_INTERVAL;
  private painted = 0;

  constructor(private readonly scene: THREE.Scene, readonly size = 1024) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = size;
    this.canvas.height = size;
    this.context = this.canvas.getContext("2d");
    this.context?.clearRect(0, 0, size, size);
    this.scratch = document.createElement("canvas");
    this.scratch.width = STAMP_SIZE;
    this.scratch.height = STAMP_SIZE;
    this.scratchContext = this.scratch.getContext("2d");
    for (let index = 0; index < STAMP_COUNT; index += 1) this.stamps.push(splatStamp(0x3a1f_00d1 + index * 977));
    this.pixelsPerMetre = size / (RING_FIGHT_HALF * 2);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    // Rows go up the canvas as they go down the image, so a region copies without flipping; the plane's
    // texture coordinates turn the other way to match.
    this.texture.flipY = false;
    this.source = new THREE.Texture(this.canvas);
    this.region.makeEmpty();
    this.material = new THREE.MeshStandardMaterial({ map: this.texture, transparent: true, depthWrite: false, roughness: 0.32, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.geometry = new THREE.PlaneGeometry(RING_FIGHT_HALF * 2, RING_FIGHT_HALF * 2);
    const uv = this.geometry.getAttribute("uv");
    for (let index = 0; index < uv.count; index += 1) uv.setY(index, 1 - uv.getY(index));
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = CANVAS_TOP + 0.003;
    this.mesh.receiveShadow = true;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** Stains painted since the canvas was last cleaned. */
  get stains(): number {
    return this.painted;
  }

  get uploadPending(): boolean {
    return this.dirty;
  }

  /** Lets the canvas send only what has been painted; without it every upload is the whole texture. */
  useUploader(uploader: RegionUploader | null): void {
    this.uploader = uploader;
    uploader?.initTexture(this.texture);
  }

  /** A struggling client sends the canvas half as often. */
  setLowTier(low: boolean): void {
    this.uploadInterval = low ? CANVAS_BLOOD_UPLOAD_INTERVAL * 2 : CANVAS_BLOOD_UPLOAD_INTERVAL;
  }

  private grow(x: number, y: number, radius: number): void {
    this.region.expandByPoint(this.regionAt.set(x - radius - 1, y - radius - 1));
    this.region.expandByPoint(this.regionAt.set(x + radius + 1, y + radius + 1));
  }

  /** Where a point of the ring lands on the painted canvas, in pixels. */
  pixel(x: number, z: number): { x: number; y: number } {
    return { x: (x + RING_FIGHT_HALF) * this.pixelsPerMetre, y: (z + RING_FIGHT_HALF) * this.pixelsPerMetre };
  }

  /** A splash `width` by `depth` metres, turned by `rotation`, of the given colour and opacity. Blood off the canvas is lost. */
  stain(x: number, z: number, width: number, depth: number, rotation: number, opacity: number, color: number, stamp = this.painted): void {
    if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > RING_FIGHT_HALF || Math.abs(z) > RING_FIGHT_HALF) return;
    const ctx = this.context;
    const tint = this.scratchContext;
    this.painted += 1;
    this.dirty = true;
    this.mesh.visible = true;
    if (ctx === null || tint === null) return;
    tint.globalCompositeOperation = "copy";
    tint.drawImage(this.stamps[Math.abs(Math.trunc(stamp)) % STAMP_COUNT]!, 0, 0);
    tint.globalCompositeOperation = "source-in";
    tint.fillStyle = css(color);
    tint.fillRect(0, 0, STAMP_SIZE, STAMP_SIZE);
    tint.globalCompositeOperation = "source-over";
    const at = this.pixel(x, z);
    const w = Math.max(1, width * this.pixelsPerMetre);
    const h = Math.max(1, depth * this.pixelsPerMetre);
    this.grow(at.x, at.y, Math.hypot(w, h) / 2);
    ctx.save();
    ctx.globalAlpha = THREE.MathUtils.clamp(opacity, 0, 1);
    ctx.translate(at.x, at.y);
    ctx.rotate(Number.isFinite(rotation) ? rotation : 0);
    ctx.drawImage(this.scratch, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  /** A pool spreading from under a fighter: a ragged edge round a dark, thick middle, `radius` metres across. */
  pool(x: number, z: number, radius: number, opacity: number, stamp: number): void {
    this.stain(x, z, radius * 2.3, radius * 2.0, stamp * 1.7, opacity * 0.8, 0x4a070b, stamp);
    const ctx = this.context;
    if (ctx === null || Math.abs(x) > RING_FIGHT_HALF || Math.abs(z) > RING_FIGHT_HALF) return;
    const at = this.pixel(x, z);
    const core = Math.max(1, radius * 1.15 * this.pixelsPerMetre);
    this.grow(at.x, at.y, core);
    const gradient = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, core);
    gradient.addColorStop(0, "rgba(40,3,6,0.9)");
    gradient.addColorStop(0.65, "rgba(58,5,9,0.65)");
    gradient.addColorStop(1, "rgba(70,7,11,0)");
    ctx.save();
    ctx.globalAlpha = THREE.MathUtils.clamp(opacity, 0, 1);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(at.x, at.y, core, core * 0.86, stamp * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** Sends what has been painted to the GPU, no more often than every `CANVAS_BLOOD_UPLOAD_INTERVAL` seconds (twice that at the low tier). */
  update(dt: number): void {
    this.sinceUpload += Number.isFinite(dt) ? Math.max(0, dt) : 0;
    if (!this.dirty || this.sinceUpload < this.uploadInterval) return;
    const region = this.region;
    region.min.set(Math.max(0, Math.floor(region.min.x)), Math.max(0, Math.floor(region.min.y)));
    region.max.set(Math.min(this.size, Math.ceil(region.max.x)), Math.min(this.size, Math.ceil(region.max.y)));
    if (this.uploader !== null && !region.isEmpty() && region.max.x > region.min.x && region.max.y > region.min.y) {
      this.uploader.copyTextureToTexture(this.source, this.texture, region, this.regionAt.copy(region.min));
    } else {
      this.texture.needsUpdate = true;
    }
    region.makeEmpty();
    this.dirty = false;
    this.sinceUpload = 0;
  }

  clear(): void {
    this.context?.clearRect(0, 0, this.size, this.size);
    this.painted = 0;
    this.dirty = false;
    this.region.makeEmpty();
    this.texture.needsUpdate = true;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.texture.dispose();
    this.source.dispose();
    this.material.dispose();
    this.geometry.dispose();
  }
}
