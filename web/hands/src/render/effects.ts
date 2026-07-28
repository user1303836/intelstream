import * as THREE from "three";
import type { BloodLevel } from "../settings";
import type { CombatEvent } from "../types";
import { CANVAS_TOP } from "./world";

const MAX_DROPLETS = 900;
const MAX_MIST = 90;
const MAX_DECALS = 48;

interface Droplet {
  alive: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number;
  maxLife: number;
  r: number; g: number; b: number;
}

interface Mist {
  alive: boolean;
  x: number; y: number; z: number;
  life: number;
  maxLife: number;
  scale: number;
}

const seeded = (seed: number): (() => number) => () => {
  seed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed);
  return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
};

const IMPACT_KINDS = new Set(["hit", "counter_hit", "block", "knockdown", "bleed"]);

function mistTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    gradient.addColorStop(0, "rgba(120,10,16,0.55)");
    gradient.addColorStop(0.5, "rgba(90,8,14,0.28)");
    gradient.addColorStop(1, "rgba(70,6,10,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(canvas);
}

export class Effects3D {
  readonly points: THREE.Points;
  private readonly droplets: Droplet[] = [];
  private readonly dropletPositions: Float32Array;
  private readonly dropletColors: Float32Array;
  private readonly dropletGeometry: THREE.BufferGeometry;
  private readonly dropletMaterial: THREE.PointsMaterial;

  readonly mistPoints: THREE.Points;
  private readonly mists: Mist[] = [];
  private readonly mistPositions: Float32Array;
  private readonly mistColors: Float32Array;
  private readonly mistGeometry: THREE.BufferGeometry;
  private readonly mistMaterial: THREE.PointsMaterial;
  private readonly mistMap: THREE.CanvasTexture;

  private readonly decals: THREE.Mesh[] = [];
  private readonly decalGeometry: THREE.CircleGeometry;
  private decalIndex = 0;
  private dripAccumulator = 0;
  private shake = 0;
  private bloodLevel: BloodLevel = "full";

  constructor(private readonly scene: THREE.Scene) {
    this.dropletPositions = new Float32Array(MAX_DROPLETS * 3);
    this.dropletColors = new Float32Array(MAX_DROPLETS * 3);
    this.dropletGeometry = new THREE.BufferGeometry();
    this.dropletGeometry.setAttribute("position", new THREE.BufferAttribute(this.dropletPositions, 3));
    this.dropletGeometry.setAttribute("color", new THREE.BufferAttribute(this.dropletColors, 3));
    this.dropletMaterial = new THREE.PointsMaterial({ size: 0.032, vertexColors: true, transparent: true, opacity: 0.92, depthWrite: false, sizeAttenuation: true });
    this.points = new THREE.Points(this.dropletGeometry, this.dropletMaterial);
    this.points.frustumCulled = false;
    scene.add(this.points);
    for (let i = 0; i < MAX_DROPLETS; i += 1) this.droplets.push({ alive: false, x: 0, y: -50, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, r: 1, g: 1, b: 1 });

    this.mistPositions = new Float32Array(MAX_MIST * 3);
    this.mistColors = new Float32Array(MAX_MIST * 3);
    this.mistGeometry = new THREE.BufferGeometry();
    this.mistGeometry.setAttribute("position", new THREE.BufferAttribute(this.mistPositions, 3));
    this.mistGeometry.setAttribute("color", new THREE.BufferAttribute(this.mistColors, 3));
    this.mistMap = mistTexture();
    this.mistMaterial = new THREE.PointsMaterial({ size: 0.34, map: this.mistMap, transparent: true, opacity: 0.55, depthWrite: false, sizeAttenuation: true });
    this.mistPoints = new THREE.Points(this.mistGeometry, this.mistMaterial);
    this.mistPoints.frustumCulled = false;
    scene.add(this.mistPoints);
    for (let i = 0; i < MAX_MIST; i += 1) this.mists.push({ alive: false, x: 0, y: -50, z: 0, life: 0, maxLife: 1, scale: 1 });

    this.decalGeometry = new THREE.CircleGeometry(0.09, 12);
    for (let i = 0; i < MAX_DECALS; i += 1) {
      const decal = new THREE.Mesh(this.decalGeometry, new THREE.MeshBasicMaterial({ color: 0x6e0d13, transparent: true, opacity: 0.42, depthWrite: false }));
      decal.rotation.x = -Math.PI / 2;
      decal.position.y = CANVAS_TOP + 0.004 + i * 0.00015;
      decal.visible = false;
      this.decals.push(decal);
      scene.add(decal);
    }
  }

  setBloodLevel(level: BloodLevel): void {
    if (level !== this.bloodLevel) {
      this.bloodLevel = level;
      if (level === "off") this.clearDecals();
    }
  }

  get shakeAmount(): number {
    return this.shake;
  }

  get liveParticles(): number {
    return this.droplets.filter((droplet) => droplet.alive).length;
  }

  get liveMist(): number {
    return this.mists.filter((mist) => mist.alive).length;
  }

  get visibleDecals(): number {
    return this.decals.filter((decal) => decal.visible).length;
  }

  private bloodScale(): number {
    return this.bloodLevel === "off" ? 0 : this.bloodLevel === "reduced" ? 0.35 : 1;
  }

  private spawnDroplet(rand: () => number, x: number, y: number, z: number, vx: number, vy: number, vz: number, color: { r: number; g: number; b: number }, life: number): void {
    const droplet = this.droplets.find((entry) => !entry.alive);
    if (droplet === undefined) return;
    droplet.alive = true;
    droplet.x = x;
    droplet.y = y;
    droplet.z = z;
    droplet.vx = vx;
    droplet.vy = vy;
    droplet.vz = vz;
    droplet.maxLife = life;
    droplet.life = life;
    droplet.r = color.r;
    droplet.g = color.g;
    droplet.b = color.b;
  }

  private spawnMist(x: number, y: number, z: number, scale: number, life: number): void {
    const mist = this.mists.find((entry) => !entry.alive);
    if (mist === undefined) return;
    mist.alive = true;
    mist.x = x;
    mist.y = y;
    mist.z = z;
    mist.maxLife = life;
    mist.life = life;
    mist.scale = scale;
  }

  private placeDecal(x: number, z: number, scaleX: number, scaleZ: number, rotation: number, opacity: number, color: number): void {
    const decal = this.decals[this.decalIndex % MAX_DECALS]!;
    this.decalIndex += 1;
    decal.visible = true;
    decal.position.x = x;
    decal.position.z = z;
    decal.rotation.z = rotation;
    decal.scale.set(scaleX, scaleZ, 1);
    const material = decal.material as THREE.MeshBasicMaterial;
    material.opacity = opacity;
    material.color.setHex(color);
  }

  splatter(x: number, z: number, scale: number, rand: () => number = Math.random): void {
    const bloodScale = this.bloodScale();
    if (bloodScale === 0) return;
    const drops = Math.round(4 * bloodScale) + 2;
    for (let i = 0; i < drops; i += 1) {
      const angle = rand() * Math.PI * 2;
      const radius = rand() * 0.32 * scale;
      this.placeDecal(
        x + Math.sin(angle) * radius,
        z + Math.cos(angle) * radius,
        (0.35 + rand() * 0.8) * scale * bloodScale,
        (0.2 + rand() * 0.5) * scale * bloodScale,
        rand() * Math.PI,
        (0.32 + rand() * 0.2) * bloodScale,
        i === 0 ? 0x5a090e : 0x6e0d13,
      );
    }
  }

  pool(x: number, z: number, scale: number): void {
    const bloodScale = this.bloodScale();
    if (bloodScale === 0) return;
    this.placeDecal(x, z, 2.6 * scale * bloodScale, 1.9 * scale * bloodScale, Math.random() * Math.PI, 0.5 * bloodScale, 0x4c070b);
  }

  addEvent(event: CombatEvent, targetWorld: THREE.Vector3, reducedMotion: boolean): void {
    if (!IMPACT_KINDS.has(event.kind)) return;
    const rand = seeded(event.event_id * 7919 + 17);
    const blocked = event.kind === "block";
    const origin = { x: targetWorld.x, y: 1.58, z: targetWorld.z };
    const bloodScale = this.bloodScale();
    const sweatCount = reducedMotion ? 0 : Math.round((blocked ? 6 : 16) + Math.min(20, event.amount / 20));
    const bloodCount = reducedMotion ? 0 : Math.round(Math.min(70, event.blood / 2.2) * bloodScale);
    this.shake = Math.min(0.09, this.shake + (blocked ? 0.008 : Math.max(0.012, event.amount / 2600)));
    if (event.kind === "knockdown") this.shake = Math.min(0.14, this.shake + 0.06);

    for (let i = 0; i < sweatCount; i += 1) {
      const angle = rand() * Math.PI * 2;
      const outward = 0.4 + rand() * 0.9;
      this.spawnDroplet(rand, origin.x + (rand() - 0.5) * 0.12, origin.y + (rand() - 0.5) * 0.14, origin.z + (rand() - 0.5) * 0.12,
        Math.sin(angle) * outward + event.direction * (0.5 + rand() * 0.9), 0.6 + rand() * 1.5, Math.cos(angle) * outward,
        { r: 0.82, g: 0.9, b: 1.0 }, 0.5 + rand() * 0.5);
    }
    for (let i = 0; i < bloodCount; i += 1) {
      const arterial = i % 4 === 0;
      const spread = arterial ? 0.16 : 0.55;
      const angle = (rand() - 0.5) * Math.PI * spread;
      const speed = arterial ? 1.9 + rand() * 1.4 : 0.7 + rand() * 1.1;
      const shade = rand();
      this.spawnDroplet(rand, origin.x + (rand() - 0.5) * 0.1, origin.y + (rand() - 0.5) * 0.12, origin.z + (rand() - 0.5) * 0.1,
        event.direction * speed * Math.cos(angle) + (rand() - 0.5) * 0.3,
        (arterial ? 1.1 + rand() * 1.2 : 0.4 + rand() * 1.0),
        event.direction * speed * Math.sin(angle) + (rand() - 0.5) * 0.3,
        shade < 0.3 ? { r: 0.62, g: 0.05, b: 0.08 } : shade < 0.7 ? { r: 0.42, g: 0.03, b: 0.05 } : { r: 0.28, g: 0.02, b: 0.04 },
        0.55 + rand() * 0.65);
    }
    if (!reducedMotion && bloodScale > 0 && (event.amount > 190 || event.kind === "knockdown" || event.kind === "counter_hit")) {
      const puffs = event.kind === "knockdown" ? 7 : 5;
      for (let i = 0; i < puffs; i += 1) {
        this.spawnMist(origin.x + (rand() - 0.5) * 0.26, origin.y + (rand() - 0.5) * 0.2, origin.z + (rand() - 0.5) * 0.26, (0.8 + rand() * 1.0) * bloodScale, 0.5 + rand() * 0.45);
      }
    }
    if (event.blood > 6 && bloodScale > 0) {
      this.splatter(origin.x + (rand() - 0.5) * 0.6, origin.z + (rand() - 0.5) * 0.6, 0.9 + Math.min(1.8, event.blood / 70) * bloodScale, rand);
    }
  }

  drip(headWorld: THREE.Vector3, severity: number, dt: number, reducedMotion: boolean): void {
    const bloodScale = this.bloodScale();
    if (bloodScale === 0 || reducedMotion || severity <= 0.05) return;
    this.dripAccumulator += dt * Math.min(9, severity * 8) * bloodScale;
    while (this.dripAccumulator >= 1) {
      this.dripAccumulator -= 1;
      this.spawnDroplet(Math.random, headWorld.x + (Math.random() - 0.5) * 0.14, headWorld.y - 0.04, headWorld.z + (Math.random() - 0.5) * 0.1,
        (Math.random() - 0.5) * 0.05, -0.25 - Math.random() * 0.3, (Math.random() - 0.5) * 0.05,
        { r: 0.5, g: 0.04, b: 0.06 }, 1.1);
    }
  }

  update(dt: number): void {
    this.shake *= Math.pow(0.02, dt);
    let dropletsAlive = false;
    for (const [i, droplet] of this.droplets.entries()) {
      if (!droplet.alive) {
        this.dropletPositions[i * 3 + 1] = -50;
        continue;
      }
      dropletsAlive = true;
      droplet.life -= dt;
      if (droplet.life <= 0 || droplet.y < CANVAS_TOP) {
        if (droplet.y < CANVAS_TOP && droplet.r < 0.85 && this.bloodScale() > 0 && Math.random() < 0.3) {
          this.placeDecal(droplet.x, droplet.z, 0.22 + Math.random() * 0.3, 0.14 + Math.random() * 0.2, Math.random() * Math.PI, 0.34 * this.bloodScale(), 0x6e0d13);
        }
        droplet.alive = false;
        this.dropletPositions[i * 3 + 1] = -50;
        continue;
      }
      droplet.vy -= 4.6 * dt;
      droplet.x += droplet.vx * dt;
      droplet.y += droplet.vy * dt;
      droplet.z += droplet.vz * dt;
      const fade = Math.min(1, droplet.life / (droplet.maxLife * 0.4));
      this.dropletPositions[i * 3] = droplet.x;
      this.dropletPositions[i * 3 + 1] = droplet.y;
      this.dropletPositions[i * 3 + 2] = droplet.z;
      this.dropletColors[i * 3] = droplet.r * fade;
      this.dropletColors[i * 3 + 1] = droplet.g * fade;
      this.dropletColors[i * 3 + 2] = droplet.b * fade;
    }
    if (dropletsAlive) {
      this.dropletGeometry.attributes.position!.needsUpdate = true;
      this.dropletGeometry.attributes.color!.needsUpdate = true;
    }
    let mistAlive = false;
    for (const [i, mist] of this.mists.entries()) {
      if (!mist.alive) {
        this.mistPositions[i * 3 + 1] = -50;
        continue;
      }
      mistAlive = true;
      mist.life -= dt;
      if (mist.life <= 0) {
        mist.alive = false;
        this.mistPositions[i * 3 + 1] = -50;
        continue;
      }
      const progress = 1 - mist.life / mist.maxLife;
      const fade = Math.max(0, 1 - progress) * 0.6;
      this.mistPositions[i * 3] = mist.x;
      this.mistPositions[i * 3 + 1] = mist.y + progress * 0.12;
      this.mistPositions[i * 3 + 2] = mist.z;
      this.mistColors[i * 3] = fade;
      this.mistColors[i * 3 + 1] = fade * 0.12;
      this.mistColors[i * 3 + 2] = fade * 0.14;
    }
    if (mistAlive) {
      this.mistGeometry.attributes.position!.needsUpdate = true;
      this.mistGeometry.attributes.color!.needsUpdate = true;
    }
  }

  clearDynamic(): void {
    for (const droplet of this.droplets) droplet.alive = false;
    for (const mist of this.mists) mist.alive = false;
    this.shake = 0;
    this.dripAccumulator = 0;
  }

  clearDecals(): void {
    for (const decal of this.decals) decal.visible = false;
  }

  dispose(): void {
    this.scene.remove(this.points);
    this.scene.remove(this.mistPoints);
    this.dropletGeometry.dispose();
    this.dropletMaterial.dispose();
    this.mistGeometry.dispose();
    this.mistMaterial.dispose();
    this.mistMap.dispose();
    this.decalGeometry.dispose();
    for (const decal of this.decals) {
      this.scene.remove(decal);
      (decal.material as THREE.Material).dispose();
    }
  }
}
