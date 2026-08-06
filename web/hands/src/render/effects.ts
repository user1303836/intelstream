import * as THREE from "three";
import type { BloodLevel } from "../settings";
import type { CombatEvent } from "../types";
import { CANVAS_TOP, RING_FIGHT_HALF } from "./world";

const MAX_DROPLETS = 900;
const MAX_MIST = 90;
const MAX_DECALS = 48;
const MAX_GIBS = 48;
const MAX_HEADS = 2;
const GIBS_PER_DECAPITATION = 24;
const HEAD_RADIUS = 0.12;
const MAX_STEP = 0.05;

interface Droplet {
  alive: boolean;
  blood: boolean;
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

interface Gib {
  alive: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  rx: number; ry: number; rz: number;
  vrx: number; vry: number; vrz: number;
  life: number;
  scale: number;
  bounces: number;
  stained: boolean;
}

interface SeveredHead {
  readonly mesh: THREE.Mesh;
  active: boolean;
  moving: boolean;
  eventId: number | null;
  vx: number; vy: number; vz: number;
  vrx: number; vry: number; vrz: number;
  bounces: number;
  stained: boolean;
}

interface Stump {
  readonly mesh: THREE.Mesh;
  active: boolean;
  fountainLife: number;
  accumulator: number;
  seed: number;
  direction: number;
}

const seeded = (seed: number): (() => number) => () => {
  seed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed);
  return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
};

const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;
const safeStep = (dt: number): number => Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, MAX_STEP) : 0;
const IMPACT_KINDS = new Set(["hit", "counter_hit", "block", "knockdown", "bleed"]);

function copyFiniteQuaternion(target: THREE.Quaternion, source: THREE.Quaternion): void {
  target.set(finite(source.x), finite(source.y), finite(source.z), finite(source.w, 1));
  if (target.lengthSq() < 0.000001) target.identity();
  else target.normalize();
}

function mistTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    gradient.addColorStop(0, "rgba(120,10,16,0.72)");
    gradient.addColorStop(0.5, "rgba(90,8,14,0.36)");
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
  private dropletIndex = 0;

  readonly mistPoints: THREE.Points;
  private readonly mists: Mist[] = [];
  private readonly mistPositions: Float32Array;
  private readonly mistColors: Float32Array;
  private readonly mistGeometry: THREE.BufferGeometry;
  private readonly mistMaterial: THREE.PointsMaterial;
  private readonly mistMap: THREE.CanvasTexture;
  private mistIndex = 0;

  private readonly decals: THREE.Mesh[] = [];
  private readonly decalGeometry: THREE.CircleGeometry;
  private decalIndex = 0;

  private readonly gibGeometry: THREE.IcosahedronGeometry;
  private readonly gibMaterial: THREE.MeshStandardMaterial;
  private readonly gibMesh: THREE.InstancedMesh;
  private readonly gibs: Gib[] = [];
  private gibIndex = 0;
  private readonly gibMatrix = new THREE.Matrix4();
  private readonly gibPosition = new THREE.Vector3();
  private readonly gibQuaternion = new THREE.Quaternion();
  private readonly gibEuler = new THREE.Euler();
  private readonly gibScale = new THREE.Vector3();

  private readonly headGeometry: THREE.DodecahedronGeometry;
  private readonly headMaterial: THREE.MeshStandardMaterial;
  private readonly heads: SeveredHead[] = [];
  private readonly stumpGeometry: THREE.CylinderGeometry;
  private readonly stumpMaterial: THREE.MeshStandardMaterial;
  private readonly stumps: Stump[] = [];
  private readonly lastDecapitationEvent = [null, null] as Array<number | null>;

  private dripAccumulator = 0;
  private shake = 0;
  private bloodLevel: BloodLevel = "full";

  constructor(private readonly scene: THREE.Scene) {
    this.dropletPositions = new Float32Array(MAX_DROPLETS * 3);
    this.dropletColors = new Float32Array(MAX_DROPLETS * 3);
    this.dropletGeometry = new THREE.BufferGeometry();
    this.dropletGeometry.setAttribute("position", new THREE.BufferAttribute(this.dropletPositions, 3));
    this.dropletGeometry.setAttribute("color", new THREE.BufferAttribute(this.dropletColors, 3));
    this.dropletMaterial = new THREE.PointsMaterial({ size: 0.038, vertexColors: true, transparent: true, opacity: 0.96, depthWrite: false, sizeAttenuation: true });
    this.points = new THREE.Points(this.dropletGeometry, this.dropletMaterial);
    this.points.frustumCulled = false;
    scene.add(this.points);
    for (let i = 0; i < MAX_DROPLETS; i += 1) {
      this.droplets.push({ alive: false, blood: false, x: 0, y: -50, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, r: 1, g: 1, b: 1 });
      this.dropletPositions[i * 3 + 1] = -50;
    }

    this.mistPositions = new Float32Array(MAX_MIST * 3);
    this.mistColors = new Float32Array(MAX_MIST * 3);
    this.mistGeometry = new THREE.BufferGeometry();
    this.mistGeometry.setAttribute("position", new THREE.BufferAttribute(this.mistPositions, 3));
    this.mistGeometry.setAttribute("color", new THREE.BufferAttribute(this.mistColors, 3));
    this.mistMap = mistTexture();
    this.mistMaterial = new THREE.PointsMaterial({ size: 0.42, map: this.mistMap, transparent: true, opacity: 0.68, depthWrite: false, sizeAttenuation: true });
    this.mistPoints = new THREE.Points(this.mistGeometry, this.mistMaterial);
    this.mistPoints.frustumCulled = false;
    scene.add(this.mistPoints);
    for (let i = 0; i < MAX_MIST; i += 1) {
      this.mists.push({ alive: false, x: 0, y: -50, z: 0, life: 0, maxLife: 1, scale: 1 });
      this.mistPositions[i * 3 + 1] = -50;
    }

    this.decalGeometry = new THREE.CircleGeometry(0.09, 12);
    for (let i = 0; i < MAX_DECALS; i += 1) {
      const decal = new THREE.Mesh(this.decalGeometry, new THREE.MeshBasicMaterial({ color: 0x6e0d13, transparent: true, opacity: 0.42, depthWrite: false }));
      decal.rotation.x = -Math.PI / 2;
      decal.position.y = CANVAS_TOP + 0.004 + i * 0.00015;
      decal.visible = false;
      this.decals.push(decal);
      scene.add(decal);
    }

    this.gibGeometry = new THREE.IcosahedronGeometry(0.04, 0);
    this.gibMaterial = new THREE.MeshStandardMaterial({ color: 0x650a10, roughness: 0.82, metalness: 0 });
    this.gibMesh = new THREE.InstancedMesh(this.gibGeometry, this.gibMaterial, MAX_GIBS);
    this.gibMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.gibMesh.frustumCulled = false;
    scene.add(this.gibMesh);
    for (let i = 0; i < MAX_GIBS; i += 1) {
      const gib: Gib = { alive: false, x: 0, y: -50, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, vrx: 0, vry: 0, vrz: 0, life: 0, scale: 0, bounces: 0, stained: false };
      this.gibs.push(gib);
      this.writeGibMatrix(i, gib);
    }
    this.gibMesh.instanceMatrix.needsUpdate = true;

    this.headGeometry = new THREE.DodecahedronGeometry(HEAD_RADIUS, 1);
    this.headMaterial = new THREE.MeshStandardMaterial({ color: 0x8a4d32, roughness: 0.76, metalness: 0 });
    this.stumpGeometry = new THREE.CylinderGeometry(0.072, 0.09, 0.035, 12);
    this.stumpMaterial = new THREE.MeshStandardMaterial({ color: 0x56070c, roughness: 0.88, metalness: 0 });
    for (let i = 0; i < MAX_HEADS; i += 1) {
      const headMesh = new THREE.Mesh(this.headGeometry, this.headMaterial);
      headMesh.castShadow = true;
      headMesh.visible = false;
      scene.add(headMesh);
      this.heads.push({ mesh: headMesh, active: false, moving: false, eventId: null, vx: 0, vy: 0, vz: 0, vrx: 0, vry: 0, vrz: 0, bounces: 0, stained: false });

      const stumpMesh = new THREE.Mesh(this.stumpGeometry, this.stumpMaterial);
      stumpMesh.visible = false;
      scene.add(stumpMesh);
      this.stumps.push({ mesh: stumpMesh, active: false, fountainLife: 0, accumulator: 0, seed: 1, direction: 1 });
    }
  }

  setBloodLevel(level: BloodLevel): void {
    if (level === this.bloodLevel) return;
    const previous = this.bloodLevel;
    this.bloodLevel = level;
    if (level === "off" || (previous === "full" && level === "reduced")) this.clearArcadeGore();
  }

  get shakeAmount(): number {
    return this.shake;
  }

  get liveParticles(): number {
    return this.droplets.filter((droplet) => droplet.alive).length;
  }

  get liveBloodParticles(): number {
    return this.droplets.filter((droplet) => droplet.alive && droplet.blood).length;
  }

  get liveMist(): number {
    return this.mists.filter((mist) => mist.alive).length;
  }

  get visibleDecals(): number {
    return this.decals.filter((decal) => decal.visible).length;
  }

  get liveGibs(): number {
    return this.gibs.filter((gib) => gib.alive).length;
  }

  get activeHeads(): number {
    return this.heads.filter((head) => head.active).length;
  }

  get activeStumps(): number {
    return this.stumps.filter((stump) => stump.active).length;
  }

  private spawnDroplet(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: { r: number; g: number; b: number }, life: number, blood: boolean): void {
    const index = this.dropletIndex % MAX_DROPLETS;
    this.dropletIndex += 1;
    const droplet = this.droplets[index]!;
    droplet.alive = true;
    droplet.blood = blood;
    droplet.x = finite(x);
    droplet.y = finite(y, 1);
    droplet.z = finite(z);
    droplet.vx = finite(vx);
    droplet.vy = finite(vy);
    droplet.vz = finite(vz);
    droplet.maxLife = Math.max(0.05, finite(life, 0.5));
    droplet.life = droplet.maxLife;
    droplet.r = finite(color.r, 0.5);
    droplet.g = finite(color.g, 0.04);
    droplet.b = finite(color.b, 0.06);
    this.dropletPositions[index * 3] = droplet.x;
    this.dropletPositions[index * 3 + 1] = droplet.y;
    this.dropletPositions[index * 3 + 2] = droplet.z;
    this.dropletColors[index * 3] = droplet.r;
    this.dropletColors[index * 3 + 1] = droplet.g;
    this.dropletColors[index * 3 + 2] = droplet.b;
    this.dropletGeometry.attributes.position!.needsUpdate = true;
    this.dropletGeometry.attributes.color!.needsUpdate = true;
  }

  private spawnMist(x: number, y: number, z: number, scale: number, life: number): void {
    const index = this.mistIndex % MAX_MIST;
    this.mistIndex += 1;
    const mist = this.mists[index]!;
    mist.alive = true;
    mist.x = finite(x);
    mist.y = finite(y, 1);
    mist.z = finite(z);
    mist.maxLife = Math.max(0.05, finite(life, 0.5));
    mist.life = mist.maxLife;
    mist.scale = Math.max(0.1, finite(scale, 1));
    this.mistPositions[index * 3] = mist.x;
    this.mistPositions[index * 3 + 1] = mist.y;
    this.mistPositions[index * 3 + 2] = mist.z;
    this.mistColors[index * 3] = 0.6 * mist.scale;
    this.mistColors[index * 3 + 1] = 0.07 * mist.scale;
    this.mistColors[index * 3 + 2] = 0.08 * mist.scale;
    this.mistGeometry.attributes.position!.needsUpdate = true;
    this.mistGeometry.attributes.color!.needsUpdate = true;
  }

  private placeDecal(x: number, z: number, scaleX: number, scaleZ: number, rotation: number, opacity: number, color: number): void {
    const decal = this.decals[this.decalIndex % MAX_DECALS]!;
    this.decalIndex += 1;
    decal.visible = true;
    decal.position.x = finite(x);
    decal.position.z = finite(z);
    decal.rotation.z = finite(rotation);
    decal.scale.set(Math.max(0.01, finite(scaleX, 0.2)), Math.max(0.01, finite(scaleZ, 0.15)), 1);
    const material = decal.material as THREE.MeshBasicMaterial;
    material.opacity = THREE.MathUtils.clamp(finite(opacity, 0.4), 0, 1);
    material.color.setHex(color);
  }

  splatter(x: number, z: number, scale: number, rand: () => number = Math.random): void {
    if (this.bloodLevel === "off") return;
    const reduced = this.bloodLevel === "reduced";
    const drops = reduced ? 3 : 12;
    const modeScale = reduced ? 0.35 : 1;
    for (let i = 0; i < drops; i += 1) {
      const angle = rand() * Math.PI * 2;
      const radius = rand() * (reduced ? 0.22 : 0.48) * scale;
      this.placeDecal(
        x + Math.sin(angle) * radius,
        z + Math.cos(angle) * radius,
        (0.35 + rand() * 0.9) * scale * modeScale,
        (0.2 + rand() * 0.65) * scale * modeScale,
        rand() * Math.PI,
        (0.34 + rand() * 0.24) * modeScale,
        i === 0 ? 0x4c070b : 0x6e0d13,
      );
    }
  }

  pool(x: number, z: number, scale: number): void {
    if (this.bloodLevel === "off") return;
    const reduced = this.bloodLevel === "reduced";
    const modeScale = reduced ? 0.35 : 1;
    this.placeDecal(x, z, 2.8 * scale * modeScale, 2.0 * scale * modeScale, Math.random() * Math.PI, 0.56 * modeScale, 0x450609);
    if (reduced) return;
    for (let i = 0; i < 3; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.18 + Math.random() * 0.32;
      this.placeDecal(x + Math.sin(angle) * radius, z + Math.cos(angle) * radius, 0.45 + Math.random() * 0.55, 0.22 + Math.random() * 0.38, Math.random() * Math.PI, 0.38 + Math.random() * 0.18, 0x620a10);
    }
  }

  addEvent(event: CombatEvent, targetWorld: THREE.Vector3, reducedMotion: boolean): void {
    if (!IMPACT_KINDS.has(event.kind)) return;
    const rand = seeded(event.event_id * 7919 + 17);
    const blocked = event.kind === "block";
    const origin = { x: finite(targetWorld.x), y: event.detail.endsWith(":body") ? 1.05 : 1.58, z: finite(targetWorld.z) };
    const sweatCount = reducedMotion ? 0 : Math.round((blocked ? 6 : 16) + Math.min(20, Math.max(0, event.amount) / 20));
    const bloodCount = reducedMotion || event.blood <= 0 || this.bloodLevel === "off"
      ? 0
      : this.bloodLevel === "reduced"
        ? Math.min(24, Math.round(event.blood * 0.24))
        : Math.min(160, Math.round(event.blood * 1.4));
    this.shake = Math.min(0.09, this.shake + (blocked ? 0.008 : Math.max(0.012, event.amount / 2600)));
    if (event.kind === "knockdown") this.shake = Math.min(0.14, this.shake + 0.06);

    for (let i = 0; i < sweatCount; i += 1) {
      const angle = rand() * Math.PI * 2;
      const outward = 0.4 + rand() * 0.9;
      this.spawnDroplet(
        origin.x + (rand() - 0.5) * 0.12,
        origin.y + (rand() - 0.5) * 0.14,
        origin.z + (rand() - 0.5) * 0.12,
        Math.sin(angle) * outward + event.direction * (0.5 + rand() * 0.9),
        0.6 + rand() * 1.5,
        Math.cos(angle) * outward,
        { r: 0.82, g: 0.9, b: 1.0 },
        0.5 + rand() * 0.5,
        false,
      );
    }
    for (let i = 0; i < bloodCount; i += 1) {
      const arterial = i % 4 === 0;
      const spread = arterial ? 0.2 : 0.72;
      const angle = (rand() - 0.5) * Math.PI * spread;
      const speed = arterial ? 2.2 + rand() * 1.8 : 0.9 + rand() * 1.5;
      const shade = rand();
      this.spawnDroplet(
        origin.x + (rand() - 0.5) * 0.12,
        origin.y + (rand() - 0.5) * 0.14,
        origin.z + (rand() - 0.5) * 0.12,
        event.direction * speed * Math.cos(angle) + (rand() - 0.5) * 0.4,
        arterial ? 1.3 + rand() * 1.6 : 0.5 + rand() * 1.25,
        event.direction * speed * Math.sin(angle) + (rand() - 0.5) * 0.4,
        shade < 0.3 ? { r: 0.72, g: 0.055, b: 0.08 } : shade < 0.7 ? { r: 0.5, g: 0.025, b: 0.045 } : { r: 0.3, g: 0.012, b: 0.025 },
        0.65 + rand() * 0.85,
        true,
      );
    }
    if (!reducedMotion && event.blood > 0 && this.bloodLevel !== "off" && (event.amount > 190 || event.kind === "knockdown" || event.kind === "counter_hit")) {
      const puffs = this.bloodLevel === "reduced" ? (event.kind === "knockdown" ? 3 : 2) : (event.kind === "knockdown" ? 14 : 10);
      const scale = this.bloodLevel === "reduced" ? 0.35 : 1;
      for (let i = 0; i < puffs; i += 1) {
        this.spawnMist(origin.x + (rand() - 0.5) * 0.34, origin.y + (rand() - 0.5) * 0.26, origin.z + (rand() - 0.5) * 0.34, (0.9 + rand() * 1.2) * scale, 0.55 + rand() * 0.55);
      }
    }
    if (event.blood > 6 && this.bloodLevel !== "off") {
      this.splatter(origin.x + (rand() - 0.5) * 0.6, origin.z + (rand() - 0.5) * 0.6, 1 + Math.min(2, event.blood / 55), rand);
    }
    if (
      this.bloodLevel === "full"
      && !reducedMotion
      && event.blood >= 40
      && ["hit", "counter_hit", "knockdown"].includes(event.kind)
    ) {
      const chunks = Math.min(12, Math.max(4, Math.round(event.blood / 9)));
      for (let index = 0; index < chunks; index += 1) {
        const angle = rand() * Math.PI * 2;
        const speed = 0.5 + rand() * 1.8;
        this.spawnGib(
          origin.x + (rand() - 0.5) * 0.12,
          origin.y + (rand() - 0.5) * 0.14,
          origin.z + (rand() - 0.5) * 0.12,
          event.direction * (0.5 + rand() * 1.4) + Math.sin(angle) * speed * 0.5,
          0.5 + rand() * 1.7,
          Math.cos(angle) * speed,
          rand,
        );
      }
    }
  }

  decapitate(fighterIndex: number, position: THREE.Vector3, quaternion: THREE.Quaternion, direction: number, eventId: number): void {
    if (this.bloodLevel !== "full" || fighterIndex < 0 || fighterIndex >= MAX_HEADS) return;
    const index = Math.trunc(fighterIndex);
    const safeEventId = Number.isSafeInteger(eventId) ? eventId : 0;
    const head = this.heads[index]!;
    if (head.active || this.lastDecapitationEvent[index] === safeEventId) return;
    const rand = seeded(safeEventId * 104729 + index * 8191 + 23);
    const launchDirection = direction < 0 ? -1 : 1;
    this.lastDecapitationEvent[index] = safeEventId;

    head.active = true;
    head.moving = true;
    head.eventId = safeEventId;
    head.vx = launchDirection * (1.8 + rand() * 1.1);
    head.vy = 2.3 + rand() * 1.1;
    head.vz = (rand() - 0.5) * 2.2;
    head.vrx = (rand() - 0.5) * 12;
    head.vry = (rand() - 0.5) * 12;
    head.vrz = (rand() - 0.5) * 12;
    head.bounces = 0;
    head.stained = false;
    head.mesh.position.set(finite(position.x), finite(position.y, 1.55), finite(position.z));
    copyFiniteQuaternion(head.mesh.quaternion, quaternion);
    head.mesh.visible = true;

    const stump = this.stumps[index]!;
    stump.active = true;
    stump.fountainLife = 1.25;
    stump.accumulator = 0;
    stump.seed = safeEventId | 1;
    stump.direction = launchDirection;
    stump.mesh.position.copy(head.mesh.position);
    stump.mesh.quaternion.copy(head.mesh.quaternion);
    stump.mesh.visible = true;

    for (let i = 0; i < GIBS_PER_DECAPITATION; i += 1) {
      const angle = rand() * Math.PI * 2;
      const speed = 0.8 + rand() * 2.4;
      this.spawnGib(
        head.mesh.position.x + (rand() - 0.5) * 0.12,
        head.mesh.position.y + (rand() - 0.5) * 0.12,
        head.mesh.position.z + (rand() - 0.5) * 0.12,
        launchDirection * (0.7 + rand() * 1.8) + Math.sin(angle) * speed * 0.55,
        0.8 + rand() * 2.4,
        Math.cos(angle) * speed,
        rand,
      );
    }
    for (let i = 0; i < 120; i += 1) {
      const angle = rand() * Math.PI * 2;
      const speed = 1 + rand() * 2.6;
      const shade = rand();
      this.spawnDroplet(
        head.mesh.position.x + (rand() - 0.5) * 0.12,
        head.mesh.position.y + (rand() - 0.5) * 0.1,
        head.mesh.position.z + (rand() - 0.5) * 0.12,
        launchDirection * (1.2 + rand() * 2.2) + Math.sin(angle) * speed * 0.35,
        0.7 + rand() * 2.7,
        Math.cos(angle) * speed,
        shade < 0.5 ? { r: 0.64, g: 0.035, b: 0.055 } : { r: 0.36, g: 0.015, b: 0.03 },
        0.75 + rand() * 1.1,
        true,
      );
    }
    for (let i = 0; i < 14; i += 1) {
      this.spawnMist(head.mesh.position.x + (rand() - 0.5) * 0.35, head.mesh.position.y + (rand() - 0.5) * 0.25, head.mesh.position.z + (rand() - 0.5) * 0.35, 1 + rand() * 1.4, 0.65 + rand() * 0.55);
    }
    this.splatter(head.mesh.position.x, head.mesh.position.z, 1.5, rand);
  }

  anchorStump(fighterIndex: number, position: THREE.Vector3, quaternion: THREE.Quaternion): void {
    if (this.bloodLevel !== "full" || fighterIndex < 0 || fighterIndex >= MAX_HEADS) return;
    const stump = this.stumps[Math.trunc(fighterIndex)]!;
    if (!stump.active) return;
    stump.mesh.position.set(finite(position.x), finite(position.y, 1.5), finite(position.z));
    copyFiniteQuaternion(stump.mesh.quaternion, quaternion);
  }

  restoreFighter(fighterIndex: number): void {
    if (fighterIndex < 0 || fighterIndex >= MAX_HEADS) return;
    const index = Math.trunc(fighterIndex);
    const head = this.heads[index]!;
    head.active = false;
    head.moving = false;
    head.mesh.visible = false;
    head.mesh.position.y = -50;
    const stump = this.stumps[index]!;
    stump.active = false;
    stump.fountainLife = 0;
    stump.accumulator = 0;
    stump.mesh.visible = false;
    stump.mesh.position.y = -50;
  }

  drip(headWorld: THREE.Vector3, severity: number, dt: number, reducedMotion: boolean): void {
    if (this.bloodLevel === "off" || reducedMotion || severity <= 0.05) return;
    const step = safeStep(dt);
    const rate = this.bloodLevel === "reduced" ? Math.min(3, severity * 3) : Math.min(18, severity * 14);
    this.dripAccumulator += step * rate;
    while (this.dripAccumulator >= 1) {
      this.dripAccumulator -= 1;
      this.spawnDroplet(
        finite(headWorld.x) + (Math.random() - 0.5) * 0.14,
        finite(headWorld.y, 1.5) - 0.04,
        finite(headWorld.z) + (Math.random() - 0.5) * 0.1,
        (Math.random() - 0.5) * 0.08,
        -0.25 - Math.random() * 0.4,
        (Math.random() - 0.5) * 0.08,
        { r: 0.5, g: 0.04, b: 0.06 },
        1.1,
        true,
      );
    }
  }

  private spawnGib(x: number, y: number, z: number, vx: number, vy: number, vz: number, rand: () => number): void {
    const index = this.gibIndex % MAX_GIBS;
    this.gibIndex += 1;
    const gib = this.gibs[index]!;
    gib.alive = true;
    gib.x = finite(x);
    gib.y = finite(y, 1.5);
    gib.z = finite(z);
    gib.vx = finite(vx);
    gib.vy = finite(vy);
    gib.vz = finite(vz);
    gib.rx = rand() * Math.PI * 2;
    gib.ry = rand() * Math.PI * 2;
    gib.rz = rand() * Math.PI * 2;
    gib.vrx = (rand() - 0.5) * 18;
    gib.vry = (rand() - 0.5) * 18;
    gib.vrz = (rand() - 0.5) * 18;
    gib.life = 1.8 + rand() * 1.2;
    gib.scale = 0.55 + rand() * 1.2;
    gib.bounces = 0;
    gib.stained = false;
    this.writeGibMatrix(index, gib);
    this.gibMesh.instanceMatrix.needsUpdate = true;
  }

  private writeGibMatrix(index: number, gib: Gib): void {
    if (!gib.alive) {
      this.gibPosition.set(0, -50, 0);
      this.gibQuaternion.identity();
      this.gibScale.setScalar(0);
    } else {
      this.gibPosition.set(gib.x, gib.y, gib.z);
      this.gibEuler.set(gib.rx, gib.ry, gib.rz);
      this.gibQuaternion.setFromEuler(this.gibEuler);
      this.gibScale.setScalar(gib.scale);
    }
    this.gibMatrix.compose(this.gibPosition, this.gibQuaternion, this.gibScale);
    this.gibMesh.setMatrixAt(index, this.gibMatrix);
  }

  private updateGibs(dt: number): void {
    let changed = false;
    for (const [index, gib] of this.gibs.entries()) {
      if (!gib.alive) continue;
      changed = true;
      gib.life -= dt;
      if (gib.life <= 0) {
        gib.alive = false;
        this.writeGibMatrix(index, gib);
        continue;
      }
      gib.vy -= 6.4 * dt;
      gib.x += gib.vx * dt;
      gib.y += gib.vy * dt;
      gib.z += gib.vz * dt;
      gib.rx += gib.vrx * dt;
      gib.ry += gib.vry * dt;
      gib.rz += gib.vrz * dt;
      this.confineGib(gib);
      if (gib.y <= CANVAS_TOP + 0.015) {
        gib.y = CANVAS_TOP + 0.015;
        if (!gib.stained && this.bloodLevel === "full") {
          gib.stained = true;
          this.placeDecal(gib.x, gib.z, 0.24 + gib.scale * 0.16, 0.14 + gib.scale * 0.1, gib.rz, 0.42, 0x620a10);
        }
        if (gib.bounces === 0 && Math.abs(gib.vy) > 0.35) {
          gib.bounces = 1;
          gib.vy = Math.abs(gib.vy) * 0.3;
          gib.vx *= 0.68;
          gib.vz *= 0.68;
          gib.vrx *= 0.7;
          gib.vry *= 0.7;
          gib.vrz *= 0.7;
        } else {
          gib.alive = false;
        }
      }
      this.writeGibMatrix(index, gib);
    }
    if (changed) this.gibMesh.instanceMatrix.needsUpdate = true;
  }

  private confineGib(gib: Gib): void {
    if (Math.abs(gib.x) > RING_FIGHT_HALF) {
      gib.x = Math.sign(gib.x) * RING_FIGHT_HALF;
      gib.vx *= -0.45;
    }
    if (Math.abs(gib.z) > RING_FIGHT_HALF) {
      gib.z = Math.sign(gib.z) * RING_FIGHT_HALF;
      gib.vz *= -0.45;
    }
  }

  private updateHeads(dt: number): void {
    for (const head of this.heads) {
      if (!head.active || !head.moving) continue;
      head.vy -= 5.8 * dt;
      head.mesh.position.x += head.vx * dt;
      head.mesh.position.y += head.vy * dt;
      head.mesh.position.z += head.vz * dt;
      head.mesh.rotation.x += head.vrx * dt;
      head.mesh.rotation.y += head.vry * dt;
      head.mesh.rotation.z += head.vrz * dt;
      if (Math.abs(head.mesh.position.x) > RING_FIGHT_HALF) {
        head.mesh.position.x = Math.sign(head.mesh.position.x) * RING_FIGHT_HALF;
        head.vx *= -0.42;
      }
      if (Math.abs(head.mesh.position.z) > RING_FIGHT_HALF) {
        head.mesh.position.z = Math.sign(head.mesh.position.z) * RING_FIGHT_HALF;
        head.vz *= -0.42;
      }
      if (head.mesh.position.y <= CANVAS_TOP + HEAD_RADIUS) {
        head.mesh.position.y = CANVAS_TOP + HEAD_RADIUS;
        if (!head.stained && this.bloodLevel === "full") {
          head.stained = true;
          this.placeDecal(head.mesh.position.x, head.mesh.position.z, 1.3, 0.9, head.mesh.rotation.z, 0.58, 0x430507);
        }
        if (head.bounces < 2 && Math.abs(head.vy) > 0.42) {
          head.bounces += 1;
          head.vy = Math.abs(head.vy) * 0.32;
          head.vx *= 0.62;
          head.vz *= 0.62;
          head.vrx *= 0.65;
          head.vry *= 0.65;
          head.vrz *= 0.65;
        } else {
          head.moving = false;
          head.vx = 0;
          head.vy = 0;
          head.vz = 0;
          head.vrx = 0;
          head.vry = 0;
          head.vrz = 0;
        }
      }
      if (!Number.isFinite(head.mesh.position.x) || !Number.isFinite(head.mesh.position.y) || !Number.isFinite(head.mesh.position.z) || !Number.isFinite(head.mesh.quaternion.x) || !Number.isFinite(head.mesh.quaternion.y) || !Number.isFinite(head.mesh.quaternion.z) || !Number.isFinite(head.mesh.quaternion.w)) {
        head.mesh.position.set(0, CANVAS_TOP + HEAD_RADIUS, 0);
        head.mesh.quaternion.identity();
        head.moving = false;
        head.vx = 0;
        head.vy = 0;
        head.vz = 0;
      }
    }
  }

  private stumpRandom(stump: Stump): number {
    let seed = stump.seed | 0;
    seed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed);
    stump.seed = seed | 0;
    return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
  }

  private updateStumpFountains(dt: number): void {
    if (this.bloodLevel !== "full") return;
    for (const stump of this.stumps) {
      if (!stump.active || stump.fountainLife <= 0) continue;
      stump.fountainLife = Math.max(0, stump.fountainLife - dt);
      stump.accumulator += dt * 36;
      while (stump.accumulator >= 1) {
        stump.accumulator -= 1;
        const first = this.stumpRandom(stump);
        const second = this.stumpRandom(stump);
        const third = this.stumpRandom(stump);
        this.spawnDroplet(
          stump.mesh.position.x + (first - 0.5) * 0.08,
          stump.mesh.position.y + 0.015,
          stump.mesh.position.z + (second - 0.5) * 0.08,
          stump.direction * (0.35 + first * 0.55),
          1.3 + second * 1.45,
          (third - 0.5) * 0.85,
          { r: 0.58, g: 0.025, b: 0.045 },
          0.65 + third * 0.5,
          true,
        );
      }
    }
  }

  update(dt: number): void {
    const step = safeStep(dt);
    this.shake *= Math.pow(0.02, step);
    this.updateStumpFountains(step);
    this.updateHeads(step);
    this.updateGibs(step);

    let dropletsChanged = false;
    for (const [i, droplet] of this.droplets.entries()) {
      if (!droplet.alive) continue;
      dropletsChanged = true;
      droplet.life -= step;
      if (droplet.life <= 0 || droplet.y < CANVAS_TOP) {
        if (droplet.y < CANVAS_TOP && droplet.blood && this.bloodLevel !== "off" && Math.random() < (this.bloodLevel === "full" ? 0.48 : 0.18)) {
          const scale = this.bloodLevel === "full" ? 1 : 0.35;
          this.placeDecal(droplet.x, droplet.z, (0.22 + Math.random() * 0.38) * scale, (0.14 + Math.random() * 0.24) * scale, Math.random() * Math.PI, 0.38 * scale, 0x6e0d13);
        }
        droplet.alive = false;
        this.dropletPositions[i * 3 + 1] = -50;
        continue;
      }
      droplet.vy -= 4.6 * step;
      droplet.x += droplet.vx * step;
      droplet.y += droplet.vy * step;
      droplet.z += droplet.vz * step;
      const fade = Math.min(1, droplet.life / (droplet.maxLife * 0.4));
      this.dropletPositions[i * 3] = droplet.x;
      this.dropletPositions[i * 3 + 1] = droplet.y;
      this.dropletPositions[i * 3 + 2] = droplet.z;
      this.dropletColors[i * 3] = droplet.r * fade;
      this.dropletColors[i * 3 + 1] = droplet.g * fade;
      this.dropletColors[i * 3 + 2] = droplet.b * fade;
    }
    if (dropletsChanged) {
      this.dropletGeometry.attributes.position!.needsUpdate = true;
      this.dropletGeometry.attributes.color!.needsUpdate = true;
    }

    let mistChanged = false;
    for (const [i, mist] of this.mists.entries()) {
      if (!mist.alive) continue;
      mistChanged = true;
      mist.life -= step;
      if (mist.life <= 0) {
        mist.alive = false;
        this.mistPositions[i * 3 + 1] = -50;
        continue;
      }
      const progress = 1 - mist.life / mist.maxLife;
      const fade = Math.max(0, 1 - progress) * 0.7 * mist.scale;
      this.mistPositions[i * 3] = mist.x;
      this.mistPositions[i * 3 + 1] = mist.y + progress * 0.14;
      this.mistPositions[i * 3 + 2] = mist.z;
      this.mistColors[i * 3] = fade;
      this.mistColors[i * 3 + 1] = fade * 0.1;
      this.mistColors[i * 3 + 2] = fade * 0.12;
    }
    if (mistChanged) {
      this.mistGeometry.attributes.position!.needsUpdate = true;
      this.mistGeometry.attributes.color!.needsUpdate = true;
    }
  }

  private clearDroplets(bloodOnly: boolean): void {
    let changed = false;
    for (const [index, droplet] of this.droplets.entries()) {
      if (!droplet.alive || (bloodOnly && !droplet.blood)) continue;
      droplet.alive = false;
      this.dropletPositions[index * 3 + 1] = -50;
      changed = true;
    }
    if (changed) {
      this.dropletGeometry.attributes.position!.needsUpdate = true;
      this.dropletGeometry.attributes.color!.needsUpdate = true;
    }
  }

  private clearMists(): void {
    let changed = false;
    for (const [index, mist] of this.mists.entries()) {
      if (!mist.alive) continue;
      mist.alive = false;
      this.mistPositions[index * 3 + 1] = -50;
      changed = true;
    }
    if (changed) {
      this.mistGeometry.attributes.position!.needsUpdate = true;
      this.mistGeometry.attributes.color!.needsUpdate = true;
    }
  }

  private clearGibs(): void {
    let changed = false;
    for (const [index, gib] of this.gibs.entries()) {
      if (!gib.alive) continue;
      gib.alive = false;
      this.writeGibMatrix(index, gib);
      changed = true;
    }
    if (changed) this.gibMesh.instanceMatrix.needsUpdate = true;
  }

  clearDynamic(): void {
    this.clearDroplets(false);
    this.clearMists();
    this.clearGibs();
    for (let index = 0; index < MAX_HEADS; index += 1) this.restoreFighter(index);
    this.shake = 0;
    this.dripAccumulator = 0;
  }

  clearArcadeGore(): void {
    this.clearDroplets(true);
    this.clearMists();
    this.clearGibs();
    for (let index = 0; index < MAX_HEADS; index += 1) this.restoreFighter(index);
    this.clearDecals();
    this.dripAccumulator = 0;
  }

  clearDecals(): void {
    for (const decal of this.decals) decal.visible = false;
    this.decalIndex = 0;
  }

  dispose(): void {
    this.scene.remove(this.points);
    this.scene.remove(this.mistPoints);
    this.scene.remove(this.gibMesh);
    this.dropletGeometry.dispose();
    this.dropletMaterial.dispose();
    this.mistGeometry.dispose();
    this.mistMaterial.dispose();
    this.mistMap.dispose();
    this.gibGeometry.dispose();
    this.gibMaterial.dispose();
    this.headGeometry.dispose();
    this.headMaterial.dispose();
    this.stumpGeometry.dispose();
    this.stumpMaterial.dispose();
    for (const head of this.heads) this.scene.remove(head.mesh);
    for (const stump of this.stumps) this.scene.remove(stump.mesh);
    this.decalGeometry.dispose();
    for (const decal of this.decals) {
      this.scene.remove(decal);
      (decal.material as THREE.Material).dispose();
    }
  }
}
