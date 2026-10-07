import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { CANVAS_BLOOD_UPLOAD_INTERVAL, CanvasBlood, splatRecipe } from "./canvas-blood";
import { Effects3D } from "./effects";
import { poolRadius } from "./renderer";
import { CANVAS_TOP, RING_FIGHT_HALF } from "./world";

interface Shape { x: number; y: number; rx: number; ry: number; turn: number }

/**
 * A 2D context that paints in software, alpha only, the shapes a blood stamp is drawn with: ellipses
 * and circles, filled (non-zero, so the shapes of one path fill as their union) or stroked, over what
 * is there or cutting it out.
 */
class PaintedAlpha {
  readonly alpha: Float32Array;
  globalAlpha = 1;
  globalCompositeOperation = "source-over";
  lineWidth = 1;
  fillStyle: unknown = "";
  strokeStyle: unknown = "";
  private path: Shape[] = [];

  constructor(readonly width: number, readonly height: number) {
    this.alpha = new Float32Array(width * height);
  }

  static inside(shape: Shape, x: number, y: number, grow: number): boolean {
    const dx = x - shape.x;
    const dy = y - shape.y;
    const u = dx * Math.cos(shape.turn) + dy * Math.sin(shape.turn);
    const v = -dx * Math.sin(shape.turn) + dy * Math.cos(shape.turn);
    const rx = shape.rx + grow;
    const ry = shape.ry + grow;
    return rx > 0 && ry > 0 && (u * u) / (rx * rx) + (v * v) / (ry * ry) <= 1;
  }

  clearRect(): void { this.alpha.fill(0); }
  beginPath(): void { this.path = []; }
  moveTo(): void {}
  ellipse(x: number, y: number, rx: number, ry: number, turn: number): void { this.path.push({ x, y, rx, ry, turn }); }
  arc(x: number, y: number, radius: number): void { this.path.push({ x, y, rx: radius, ry: radius, turn: 0 }); }
  fill(): void { this.paint(0, (shape, x, y) => PaintedAlpha.inside(shape, x, y, 0)); }
  stroke(): void {
    const half = this.lineWidth / 2;
    this.paint(half, (shape, x, y) => PaintedAlpha.inside(shape, x, y, half) && !PaintedAlpha.inside(shape, x, y, -half));
  }
  save(): void {}
  restore(): void {}
  translate(): void {}
  rotate(): void {}
  drawImage(): void {}
  fillRect(): void {}
  createRadialGradient(): { addColorStop(): void } { return { addColorStop: () => {} }; }

  /** Four by four samples a pixel over the path's bounds, composited at the global alpha. */
  private paint(grow: number, covers: (shape: Shape, x: number, y: number) => boolean): void {
    const reach = (shape: Shape): number => Math.max(shape.rx, shape.ry) + grow + 1;
    const left = Math.max(0, Math.floor(Math.min(...this.path.map((shape) => shape.x - reach(shape)))));
    const right = Math.min(this.width, Math.ceil(Math.max(...this.path.map((shape) => shape.x + reach(shape)))));
    const top = Math.max(0, Math.floor(Math.min(...this.path.map((shape) => shape.y - reach(shape)))));
    const bottom = Math.min(this.height, Math.ceil(Math.max(...this.path.map((shape) => shape.y + reach(shape)))));
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        let hits = 0;
        for (let sample = 0; sample < 16; sample += 1) {
          const px = x + ((sample % 4) + 0.5) / 4;
          const py = y + (Math.floor(sample / 4) + 0.5) / 4;
          if (this.path.some((shape) => covers(shape, px, py))) hits += 1;
        }
        const paint = (hits / 16) * this.globalAlpha;
        const index = y * this.width + x;
        this.alpha[index] = this.globalCompositeOperation === "destination-out" ? this.alpha[index]! * (1 - paint) : this.alpha[index]! + paint * (1 - this.alpha[index]!);
      }
    }
  }
}

/** Paints every canvas made inside `make` in software, and hands back what each one holds. */
function paintedCanvases<T>(make: () => T): { made: T; painted: Map<HTMLCanvasElement, PaintedAlpha> } {
  const painted = new Map<HTMLCanvasElement, PaintedAlpha>();
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    const context = painted.get(this) ?? new PaintedAlpha(this.width, this.height);
    painted.set(this, context);
    return context as unknown as CanvasRenderingContext2D;
  });
  const made = make();
  getContext.mockRestore();
  return { made, painted };
}

describe("blood on the canvas", () => {
  it("is painted over the whole canvas the fighters stand on, the ring's corners at the texture's", () => {
    const blood = new CanvasBlood(new THREE.Scene(), 512);
    expect(blood.pixel(-RING_FIGHT_HALF, -RING_FIGHT_HALF)).toEqual({ x: 0, y: 0 });
    expect(blood.pixel(RING_FIGHT_HALF, RING_FIGHT_HALF)).toEqual({ x: 512, y: 512 });
    expect(blood.pixel(0, 0)).toEqual({ x: 256, y: 256 });
    expect(blood.mesh.position.y).toBeGreaterThan(CANVAS_TOP);
    expect(blood.mesh.position.y).toBeLessThan(CANVAS_TOP + 0.01);
    blood.dispose();
  });

  it("soaks in as a lumpy blot, darker where it dries at the rim than in the middle, never a flat disc", () => {
    for (let seed = 0; seed < 8; seed += 1) {
      const recipe = splatRecipe(0x3a1f_00d1 + seed * 977);
      expect(recipe.lobes.length).toBeGreaterThanOrEqual(5);
      const sizes = recipe.lobes.map((lobe) => lobe.rx);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeGreaterThan(2);
      expect(recipe.lobes.some((lobe) => Math.hypot(lobe.x - 64, lobe.y - 64) > 5)).toBe(true);
      expect(recipe.rim).toBeGreaterThan(recipe.fill + 0.15);
    }
    expect(splatRecipe(7)).toEqual(splatRecipe(7));
  });

  it("is painted lighter in the middle than at the rim, however many of its lobes overlap there", () => {
    const { made: blood, painted } = paintedCanvases(() => new CanvasBlood(new THREE.Scene(), 256));
    const stamps = (blood as unknown as { stamps: HTMLCanvasElement[] }).stamps;
    expect(stamps).toHaveLength(4);
    for (const [index, stamp] of stamps.entries()) {
      const recipe = splatRecipe(0x3a1f_00d1 + index * 977);
      const alpha = painted.get(stamp)!.alpha;
      const within = (x: number, y: number, grow: number): boolean => recipe.lobes.some((lobe) => PaintedAlpha.inside(lobe, x, y, grow));
      let centre = 0;
      let centreCount = 0;
      let rim = 0;
      let rimCount = 0;
      for (let y = 0; y < stamp.height; y += 1) {
        for (let x = 0; x < stamp.width; x += 1) {
          const a = alpha[y * stamp.width + x]!;
          if (Math.hypot(x + 0.5 - 64, y + 0.5 - 64) <= 6) {
            centre += a;
            centreCount += 1;
          } else if (within(x + 0.5, y + 0.5, 1.75) && !within(x + 0.5, y + 0.5, -1.5)) {
            rim += a;
            rimCount += 1;
          }
        }
      }
      // Where four or five lobes lie over each other the middle is as light as anywhere inside the blot.
      expect(centre / centreCount).toBeCloseTo(recipe.fill, 2);
      expect(centre / centreCount).toBeLessThan(rim / rimCount - 0.15);
    }
    blood.dispose();
  });

  it("is matte, as blood soaked into canvas is, so the ring lights do not glaze it lavender", () => {
    const blood = new CanvasBlood(new THREE.Scene(), 256);
    expect((blood.mesh.material as THREE.MeshStandardMaterial).roughness).toBeGreaterThanOrEqual(0.75);
    blood.dispose();
  });

  it("keeps every stain for the bout, where the old decals recycled after 48", () => {
    const blood = new CanvasBlood(new THREE.Scene());
    for (let index = 0; index < 500; index += 1) blood.stain((index % 50) * 0.1 - 2.5, 0.3, 0.1, 0.08, index, 0.6, 0x6e0d13);
    expect(blood.stains).toBe(500);
    blood.stain(RING_FIGHT_HALF + 0.2, 0, 0.1, 0.1, 0, 0.5, 0x6e0d13);
    blood.stain(0, Number.NaN, 0.1, 0.1, 0, 0.5, 0x6e0d13);
    expect(blood.stains).toBe(500);
    blood.dispose();
  });

  it("sends what it has painted to the GPU at most every eighth of a second", () => {
    const blood = new CanvasBlood(new THREE.Scene());
    const texture = (blood.mesh.material as THREE.MeshStandardMaterial).map!;
    blood.update(1);
    const version = texture.version;
    blood.stain(0, 0, 0.2, 0.2, 0, 0.8, 0x6e0d13);
    expect(blood.uploadPending).toBe(true);
    blood.update(1);
    expect(texture.version).toBe(version + 1);
    blood.stain(0.1, 0, 0.2, 0.2, 0, 0.8, 0x6e0d13);
    blood.update(CANVAS_BLOOD_UPLOAD_INTERVAL / 2);
    expect(blood.uploadPending).toBe(true);
    expect(texture.version).toBe(version + 1);
    blood.update(CANVAS_BLOOD_UPLOAD_INTERVAL / 2);
    expect(blood.uploadPending).toBe(false);
    expect(texture.version).toBe(version + 2);
    blood.update(1);
    expect(texture.version).toBe(version + 2);
    blood.dispose();
  });

  it("sends only the part painted since the last upload once the renderer can take a region", () => {
    const blood = new CanvasBlood(new THREE.Scene(), 1024);
    const texture = (blood.mesh.material as THREE.MeshStandardMaterial).map!;
    const sent: { source: THREE.Texture; destination: THREE.Texture; min: THREE.Vector2; max: THREE.Vector2; at: THREE.Vector2 }[] = [];
    const uploader = {
      initTexture: vi.fn(),
      copyTextureToTexture: vi.fn((source: THREE.Texture, destination: THREE.Texture, region: THREE.Box2, at: THREE.Vector2) => {
        sent.push({ source, destination, min: region.min.clone(), max: region.max.clone(), at: at.clone() });
      }),
    };
    blood.useUploader(uploader);
    expect(uploader.initTexture).toHaveBeenCalledExactlyOnceWith(texture);
    const version = texture.version;
    blood.stain(0, 0, 0.2, 0.2, 0, 0.8, 0x6e0d13);
    blood.update(1);
    expect(sent).toHaveLength(1);
    const [first] = sent;
    expect(first!.destination).toBe(texture);
    expect(first!.source).not.toBe(texture);
    expect(first!.source.image).toBe(texture.image);
    expect(first!.at).toEqual(first!.min);
    const centre = blood.pixel(0, 0);
    expect(first!.min.x).toBeLessThan(centre.x);
    expect(first!.min.y).toBeLessThan(centre.y);
    expect(first!.max.x).toBeGreaterThan(centre.x);
    expect(first!.max.y).toBeGreaterThan(centre.y);
    expect((first!.max.x - first!.min.x) * (first!.max.y - first!.min.y)).toBeLessThan(1024 * 1024 * 0.01);
    expect(texture.version).toBe(version);

    blood.stain(RING_FIGHT_HALF - 0.01, -RING_FIGHT_HALF + 0.01, 0.3, 0.3, 1, 0.8, 0x6e0d13);
    blood.update(1);
    const [, edge] = sent;
    expect(edge!.min.x).toBeGreaterThan(centre.x);
    expect(edge!.max.y).toBeLessThan(centre.y);
    expect(edge!.max.x).toBe(1024);
    expect(edge!.min.y).toBe(0);
    expect(Number.isInteger(edge!.min.x) && Number.isInteger(edge!.max.y)).toBe(true);

    blood.update(1);
    expect(sent).toHaveLength(2);
    blood.clear();
    expect(texture.version).toBe(version + 1);
    blood.pool(-1, 1, 0.3, 0.9, 2);
    blood.update(1);
    expect(sent).toHaveLength(3);
    expect(sent[2]!.max.x).toBeLessThan(centre.x);
    expect(sent[2]!.min.y).toBeGreaterThan(centre.y);
    blood.dispose();
  });

  it("sends half as often on a struggling client, and as often again once it recovers", () => {
    const blood = new CanvasBlood(new THREE.Scene(), 256);
    const texture = (blood.mesh.material as THREE.MeshStandardMaterial).map!;
    blood.setLowTier(true);
    const version = texture.version;
    blood.stain(0, 0, 0.2, 0.2, 0, 0.8, 0x6e0d13);
    blood.update(CANVAS_BLOOD_UPLOAD_INTERVAL * 1.5);
    expect(texture.version).toBe(version);
    blood.update(CANVAS_BLOOD_UPLOAD_INTERVAL * 0.6);
    expect(texture.version).toBe(version + 1);
    blood.setLowTier(false);
    blood.stain(0, 0, 0.2, 0.2, 0, 0.8, 0x6e0d13);
    blood.update(CANVAS_BLOOD_UPLOAD_INTERVAL * 1.05);
    expect(texture.version).toBe(version + 2);
    blood.dispose();
  });

  it("lies over the ring the same way round as it is painted", () => {
    const blood = new CanvasBlood(new THREE.Scene(), 512);
    const texture = (blood.mesh.material as THREE.MeshStandardMaterial).map!;
    expect(texture.flipY).toBe(false);
    blood.mesh.updateMatrixWorld(true);
    const position = blood.mesh.geometry.getAttribute("position");
    const uv = blood.mesh.geometry.getAttribute("uv");
    const corner = new THREE.Vector3();
    for (let index = 0; index < position.count; index += 1) {
      corner.fromBufferAttribute(position, index).applyMatrix4(blood.mesh.matrixWorld);
      const painted = blood.pixel(corner.x, corner.z);
      expect(uv.getX(index)).toBeCloseTo(painted.x / 512, 6);
      expect(uv.getY(index)).toBeCloseTo(painted.y / 512, 6);
    }
    blood.dispose();
  });

  it("is hidden until blood lands and when the canvas is cleaned, and leaves nothing behind", () => {
    const scene = new THREE.Scene();
    const blood = new CanvasBlood(scene);
    expect(blood.mesh.visible).toBe(false);
    blood.pool(0.4, -0.2, 0.3, 0.9, 2);
    expect(blood.mesh.visible).toBe(true);
    expect(blood.stains).toBe(1);
    blood.clear();
    expect(blood.mesh.visible).toBe(false);
    expect(blood.stains).toBe(0);
    const material = blood.mesh.material as THREE.MeshStandardMaterial;
    const disposed = [vi.spyOn(material, "dispose"), vi.spyOn(material.map!, "dispose"), vi.spyOn(blood.mesh.geometry, "dispose")];
    blood.dispose();
    for (const spy of disposed) expect(spy).toHaveBeenCalledOnce();
    expect(scene.children).toHaveLength(0);
  });

  it("pools under a fighter on the canvas, smaller with reduced blood and never with blood off", () => {
    const pooled = (level: "full" | "reduced" | "off"): number => {
      const effects = new Effects3D(new THREE.Scene(), 256);
      effects.setBloodLevel(level);
      effects.pool(0.5, 0.5, 0.3, 1);
      const stains = effects.canvasStains;
      effects.dispose();
      return stains;
    };
    expect(pooled("full")).toBe(1);
    expect(pooled("reduced")).toBe(1);
    expect(pooled("off")).toBe(0);
  });

  it("spreads fast at first and then slower, wider the worse the fighter bleeds, to under half a metre", () => {
    expect(poolRadius(0, 1)).toBeCloseTo(0.05, 5);
    expect(poolRadius(4, 1) - poolRadius(0, 1)).toBeGreaterThan(poolRadius(16, 1) - poolRadius(12, 1));
    expect(poolRadius(16, 1.4)).toBeGreaterThan(poolRadius(16, 0.5));
    expect(poolRadius(20, 1)).toBeGreaterThan(0.2);
    expect(poolRadius(10_000, 10)).toBe(0.42);
  });
});
