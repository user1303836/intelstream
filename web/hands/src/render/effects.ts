import * as THREE from "three";
import type { BloodLevel } from "../settings";
import type { CombatEvent } from "../types";
import { CANVAS_TOP } from "./world";

const MAX_PARTICLES = 700;
const MAX_DECALS = 26;

interface Particle {
  alive: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number;
  maxLife: number;
  size: number;
  r: number; g: number; b: number;
}

const seeded = (seed: number): (() => number) => () => {
  seed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed);
  return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
};

const IMPACT_KINDS = new Set(["hit", "counter_hit", "block", "knockdown", "bleed"]);

export class Effects3D {
  readonly points: THREE.Points;
  private readonly particleData: Particle[] = [];
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly sizes: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.PointsMaterial;
  private readonly decals: THREE.Mesh[] = [];
  private readonly decalMaterial: THREE.MeshBasicMaterial;
  private readonly decalGeometry: THREE.CircleGeometry;
  private decalIndex = 0;
  private shake = 0;
  private bloodLevel: BloodLevel = "full";

  constructor(private readonly scene: THREE.Scene) {
    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.colors = new Float32Array(MAX_PARTICLES * 3);
    this.sizes = new Float32Array(MAX_PARTICLES);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute("size", new THREE.BufferAttribute(this.sizes, 1));
    this.material = new THREE.PointsMaterial({ size: 0.035, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, sizeAttenuation: true });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);
    for (let i = 0; i < MAX_PARTICLES; i += 1) this.particleData.push({ alive: false, x: 0, y: -50, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, size: 1, r: 1, g: 1, b: 1 });

    this.decalGeometry = new THREE.CircleGeometry(0.09, 12);
    this.decalMaterial = new THREE.MeshBasicMaterial({ color: 0x6e0d13, transparent: true, opacity: 0.42, depthWrite: false });
    for (let i = 0; i < MAX_DECALS; i += 1) {
      const decal = new THREE.Mesh(this.decalGeometry, this.decalMaterial.clone());
      decal.rotation.x = -Math.PI / 2;
      decal.position.y = CANVAS_TOP + 0.004 + i * 0.0002;
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
    return this.particleData.filter((particle) => particle.alive).length;
  }

  addEvent(event: CombatEvent, targetWorld: THREE.Vector3, reducedMotion: boolean): void {
    if (!IMPACT_KINDS.has(event.kind)) return;
    const rand = seeded(event.event_id * 7919 + 17);
    const blocked = event.kind === "block";
    const headHeight = 1.58;
    const origin = { x: targetWorld.x, y: headHeight, z: targetWorld.z };
    const bloodScale = this.bloodLevel === "off" ? 0 : this.bloodLevel === "reduced" ? 0.35 : 1;
    const sweatCount = reducedMotion ? 0 : Math.round((blocked ? 5 : 12) + Math.min(16, event.amount / 24));
    const bloodCount = reducedMotion ? 0 : Math.round(Math.min(20, event.blood / 5) * bloodScale);
    this.shake = Math.min(0.09, this.shake + (blocked ? 0.008 : Math.max(0.012, event.amount / 2600)));
    if (event.kind === "knockdown") this.shake = Math.min(0.14, this.shake + 0.06);

    const spawn = (count: number, color: () => { r: number; g: number; b: number }, speed: number, size: number): void => {
      for (let i = 0; i < count; i += 1) {
        const particle = this.particleData.find((entry) => !entry.alive);
        if (particle === undefined) return;
        const angle = rand() * Math.PI * 2;
        const outward = (0.4 + rand() * 0.9) * speed;
        particle.alive = true;
        particle.x = origin.x + (rand() - 0.5) * 0.12;
        particle.y = origin.y + (rand() - 0.5) * 0.14;
        particle.z = origin.z + (rand() - 0.5) * 0.12;
        particle.vx = Math.sin(angle) * outward + event.direction * (0.5 + rand() * 0.9) * speed;
        particle.vy = (0.6 + rand() * 1.5) * speed;
        particle.vz = Math.cos(angle) * outward;
        particle.maxLife = 0.5 + rand() * 0.5;
        particle.life = particle.maxLife;
        particle.size = size * (0.7 + rand() * 0.7);
        const c = color();
        particle.r = c.r; particle.g = c.g; particle.b = c.b;
      }
    };
    spawn(sweatCount, () => ({ r: 0.82, g: 0.9, b: 1.0 }), 0.85, 1);
    spawn(bloodCount, () => ({ r: 0.55 + rand() * 0.25, g: 0.05, b: 0.07 }), 1.0, 1.25);

    if (event.blood > 10 && bloodScale > 0) {
      const decal = this.decals[this.decalIndex % MAX_DECALS]!;
      this.decalIndex += 1;
      decal.visible = true;
      decal.position.x = origin.x + (rand() - 0.5) * 0.7;
      decal.position.z = origin.z + (rand() - 0.5) * 0.7;
      const scale = (0.6 + rand() * 1.3) * bloodScale;
      decal.scale.set(scale, scale, scale);
      (decal.material as THREE.MeshBasicMaterial).opacity = 0.45 * bloodScale;
    }
  }

  update(dt: number): void {
    this.shake *= Math.pow(0.02, dt);
    for (const [i, particle] of this.particleData.entries()) {
      if (!particle.alive) {
        this.positions[i * 3 + 1] = -50;
        continue;
      }
      particle.life -= dt;
      if (particle.life <= 0 || particle.y < CANVAS_TOP) {
        particle.alive = false;
        this.positions[i * 3 + 1] = -50;
        continue;
      }
      particle.vy -= 4.4 * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.z += particle.vz * dt;
      const fade = Math.min(1, particle.life / (particle.maxLife * 0.4));
      this.positions[i * 3] = particle.x;
      this.positions[i * 3 + 1] = particle.y;
      this.positions[i * 3 + 2] = particle.z;
      this.colors[i * 3] = particle.r * fade;
      this.colors[i * 3 + 1] = particle.g * fade;
      this.colors[i * 3 + 2] = particle.b * fade;
      this.sizes[i] = particle.size;
    }
    this.geometry.attributes.position!.needsUpdate = true;
    this.geometry.attributes.color!.needsUpdate = true;
    this.geometry.attributes.size!.needsUpdate = true;
  }

  clearDynamic(): void {
    for (const particle of this.particleData) particle.alive = false;
    this.shake = 0;
  }

  clearDecals(): void {
    for (const decal of this.decals) decal.visible = false;
  }

  dispose(): void {
    this.scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
    this.decalGeometry.dispose();
    for (const decal of this.decals) {
      this.scene.remove(decal);
      (decal.material as THREE.Material).dispose();
    }
    this.decalMaterial.dispose();
  }
}
