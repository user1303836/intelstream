import * as THREE from "three";

/** The colour of a power punch's heat, on the glove and where it lands. */
export const POWER_HEAT_COLOR = new THREE.Color(1, 0.5, 0.12);
/** Width of a glove's glow at full heat, in metres, and how much wider its flare at the target makes it. */
const GLOW_SIZE = 0.42;
const FLARE_GROWTH = 1.3;
/** A flare fades in this many seconds. */
const FLARE_SECONDS = 0.18;
/** A landed power punch's flash and ring: how long each lasts and how wide each grows, in metres. */
const FLASH_SECONDS = 0.16;
const FLASH_SIZE = 1.1;
const RING_SECONDS = 0.28;
const RING_SIZE = 1.5;

/** White in the middle fading to nothing at the edge, for additive glows. */
export function glowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.25, "rgba(255,255,255,0.75)");
    gradient.addColorStop(0.6, "rgba(255,255,255,0.18)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(canvas);
}

/** A square facing the camera, glowing additively with `texture`. */
function glowCard(texture: THREE.Texture, color: THREE.Color): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  return new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: texture, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide }));
}

/**
 * The glow on a glove throwing a power punch: it builds with the punch's heat through the load and flares as the glove
 * reaches the target, unless motion is reduced, when it only glows.
 */
export class GloveGlow {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private flare = 0;
  private lastHeat = 0;

  constructor(texture: THREE.Texture) {
    this.mesh = glowCard(texture, POWER_HEAT_COLOR);
    // A rear glove loads behind its own shoulder: the glow shows through the body that hides it.
    this.mesh.material.depthTest = false;
    this.mesh.material.opacity = 0;
    this.mesh.visible = false;
    this.mesh.renderOrder = 5;
  }

  update(glove: THREE.Vector3, heat: number, dt: number, reducedMotion: boolean, camera: THREE.Camera): void {
    if (heat >= 1 && this.lastHeat < 1 && !reducedMotion) this.flare = 1;
    this.lastHeat = heat;
    this.flare = Math.max(0, this.flare - dt / FLARE_SECONDS);
    const material = this.mesh.material;
    material.opacity = Math.min(1, heat * 0.8 + this.flare * 0.6);
    this.mesh.visible = material.opacity > 0.01;
    if (!this.mesh.visible) return;
    this.mesh.position.copy(glove);
    this.mesh.quaternion.copy(camera.quaternion);
    const size = GLOW_SIZE * (0.55 + 0.45 * heat) * (1 + this.flare * FLARE_GROWTH);
    this.mesh.scale.set(size, size, 1);
  }

  /** Whether it shows this frame. */
  get active(): boolean {
    return this.mesh.visible;
  }

  /** A visible copy sharing its geometry and material, for compiling its shader before it is first needed. */
  standIn(): THREE.Object3D {
    return new THREE.Mesh(this.mesh.geometry, this.mesh.material);
  }

  reset(): void {
    this.flare = 0;
    this.lastHeat = 0;
    this.mesh.material.opacity = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/** Where a power punch lands: a white-hot flash and a ring of heat thrown out from it. */
export class ImpactFlash {
  readonly group = new THREE.Group();
  private readonly flash: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private age = Infinity;

  constructor(texture: THREE.Texture) {
    this.flash = glowCard(texture, new THREE.Color(1, 0.86, 0.62));
    this.flash.material.depthTest = false;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 40), new THREE.MeshBasicMaterial({ color: POWER_HEAT_COLOR, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide }));
    this.flash.renderOrder = 6;
    this.ring.renderOrder = 6;
    this.group.add(this.flash, this.ring);
    this.group.visible = false;
  }

  fire(at: THREE.Vector3): void {
    this.age = 0;
    this.group.position.copy(at);
  }

  /** Faces the ring to `camera` and plays the flash out. */
  update(dt: number, camera: THREE.Camera): void {
    this.age += dt;
    const flash = this.age / FLASH_SECONDS;
    const ring = this.age / RING_SECONDS;
    this.group.visible = ring < 1;
    if (!this.group.visible) return;
    this.group.quaternion.copy(camera.quaternion);
    this.flash.visible = flash < 1;
    const flashSize = FLASH_SIZE * (0.35 + 0.65 * Math.sqrt(Math.min(1, flash)));
    this.flash.scale.set(flashSize, flashSize, 1);
    this.flash.material.opacity = (1 - Math.min(1, flash)) ** 2;
    const ringSize = RING_SIZE * (0.15 + 0.85 * (1 - (1 - ring) ** 3));
    this.ring.scale.set(ringSize, ringSize, ringSize);
    this.ring.material.opacity = 0.9 * (1 - ring);
  }

  get active(): boolean {
    return this.group.visible;
  }

  /** Visible copies sharing its materials, for compiling their shaders before they are first needed. */
  standIns(): THREE.Object3D[] {
    return [new THREE.Mesh(this.flash.geometry, this.flash.material), new THREE.Mesh(this.ring.geometry, this.ring.material)];
  }

  reset(): void {
    this.age = Infinity;
    this.group.visible = false;
  }

  dispose(): void {
    this.flash.geometry.dispose();
    this.flash.material.dispose();
    this.ring.geometry.dispose();
    this.ring.material.dispose();
  }
}
