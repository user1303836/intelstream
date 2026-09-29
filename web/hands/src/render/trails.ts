import * as THREE from "three";

const SAMPLES = 10;
const WIDTH = 0.055;
const MIN_SPEED = 3.2;

/**
 * Additive ribbon behind a fast-moving glove. Positions are sampled every
 * frame; the ribbon only shows while the glove moves faster than a punch
 * threshold and fades toward its tail.
 */
export class GloveTrail {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.BufferGeometry;
  private readonly positions = new Float32Array(SAMPLES * 2 * 3);
  private readonly colors = new Float32Array(SAMPLES * 2 * 4);
  private readonly history: THREE.Vector3[] = [];
  private readonly last = new THREE.Vector3();
  private hasLast = false;
  private readonly tangent = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly toCamera = new THREE.Vector3();
  private strength = 0;

  constructor(private readonly color: THREE.Color) {
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    const index: number[] = [];
    for (let i = 0; i < SAMPLES - 1; i += 1) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geometry.setIndex(index);
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 4;
  }

  /** Feeds the glove's world position for this frame. */
  update(glove: THREE.Vector3, dt: number, cameraPosition: THREE.Vector3, enabled: boolean): void {
    if (dt <= 0) return;
    const speed = this.hasLast ? glove.distanceTo(this.last) / dt : 0;
    this.last.copy(glove);
    this.hasLast = true;
    const target = enabled && speed > MIN_SPEED ? Math.min(1, (speed - MIN_SPEED) / 4) : 0;
    this.strength += (target - this.strength) * Math.min(1, dt * 18);
    if (this.history.length >= SAMPLES) this.history.shift()!.copy(glove);
    const sample = this.history.length < SAMPLES ? new THREE.Vector3() : this.history.pop()!;
    sample.copy(glove);
    this.history.push(sample);
    if (this.strength < 0.02 || this.history.length < 3) {
      this.mesh.visible = false;
      return;
    }
    const count = this.history.length;
    for (let i = 0; i < SAMPLES; i += 1) {
      const point = this.history[Math.max(0, count - SAMPLES + i)]!;
      const next = this.history[Math.min(count - 1, Math.max(1, count - SAMPLES + i + 1))]!;
      const previous = this.history[Math.max(0, count - SAMPLES + i - 1)]!;
      this.tangent.subVectors(next, previous);
      if (this.tangent.lengthSq() < 1e-8) this.tangent.set(0, 1, 0);
      this.toCamera.subVectors(cameraPosition, point);
      this.side.crossVectors(this.tangent, this.toCamera).normalize();
      const age = i / (SAMPLES - 1);
      const width = WIDTH * (0.35 + 0.65 * age);
      const alpha = this.strength * age * age;
      const offset = i * 6;
      this.positions[offset] = point.x - this.side.x * width;
      this.positions[offset + 1] = point.y - this.side.y * width;
      this.positions[offset + 2] = point.z - this.side.z * width;
      this.positions[offset + 3] = point.x + this.side.x * width;
      this.positions[offset + 4] = point.y + this.side.y * width;
      this.positions[offset + 5] = point.z + this.side.z * width;
      for (let corner = 0; corner < 2; corner += 1) {
        const c = (i * 2 + corner) * 4;
        this.colors[c] = this.color.r;
        this.colors[c + 1] = this.color.g;
        this.colors[c + 2] = this.color.b;
        this.colors[c + 3] = alpha;
      }
    }
    (this.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
    this.mesh.visible = true;
  }

  get active(): boolean {
    return this.mesh.visible;
  }

  reset(): void {
    this.history.length = 0;
    this.hasLast = false;
    this.strength = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
