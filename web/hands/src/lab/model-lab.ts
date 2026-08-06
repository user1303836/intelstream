import * as THREE from "three";
import { BONE_ADAPTER, applyFighterSkin, loadBoxerGlb } from "../render/graph";

interface ClipRow {
  readonly name: string;
  readonly duration: string;
  readonly tracks: number;
}

export class ModelLab {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private skeletonHelper: THREE.SkeletonHelper | null = null;
  private model: THREE.Object3D | null = null;
  private raf = 0;
  private previous = performance.now();
  private playing = true;
  private loop = true;
  private readonly warnings: string[] = [];
  private readonly inventoryEl: HTMLElement;
  private readonly clipsEl: HTMLElement;
  private readonly warningsEl: HTMLElement;
  private readonly timeSlider: HTMLInputElement;

  constructor(private readonly root: HTMLElement) {
    root.innerHTML = `<section class="activity model-lab">
<canvas class="fight" data-canvas></canvas>
<header class="topbar"><strong>HANDS MODEL LAB</strong><span data-status>loading…</span></header>
<aside class="panel model-panel" data-panel>
<h2>Clips</h2>
<div class="model-clips" data-clips></div>
<div class="model-row">
<button type="button" data-play>Pause</button>
<label><input type="checkbox" data-loop checked> Loop</label>
<label><input type="checkbox" data-skeleton> Skeleton</label>
</div>
<div class="model-row"><input type="range" data-seek min="0" max="1000" value="0" step="1"></div>
<h2>Transform</h2>
<div class="model-row"><label>Scale <input type="range" data-scale min="30" max="200" value="78"></label></div>
<div class="model-row"><label>Rotate Y <input type="range" data-rotate min="-180" max="180" value="0"></label></div>
<div class="model-row"><label>Offset X <input type="range" data-offx min="-200" max="200" value="0"></label>
<label>Z <input type="range" data-offz min="-200" max="200" value="0"></label></div>
<h2>Inventory</h2>
<pre class="model-inventory" data-inventory></pre>
<h2>Warnings</h2>
<pre class="model-warnings" data-warnings>none</pre>
</aside>
</section>`;
    this.inventoryEl = root.querySelector("[data-inventory]")!;
    this.clipsEl = root.querySelector("[data-clips]")!;
    this.warningsEl = root.querySelector("[data-warnings]")!;
    this.timeSlider = root.querySelector("[data-seek]")!;
    const canvas = root.querySelector<HTMLCanvasElement>("[data-canvas]")!;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);
    this.camera.position.set(0.4, 1.5, 3.6);
    this.camera.lookAt(0, 1.0, 0);
    this.setupGameLighting();
    this.bindControls();
  }

  private setupGameLighting(): void {
    this.scene.background = new THREE.Color("#04060b");
    if (new URLSearchParams(window.location.search).get("fog") === "1") this.scene.fog = new THREE.FogExp2("#04060b", 0.042);
    this.scene.add(new THREE.HemisphereLight("#33415e", "#05060a", 0.5));
    this.scene.add(new THREE.AmbientLight("#2b3450", 0.55));
    const key = new THREE.SpotLight("#fff4e0", 115, 26, 0.68, 0.6, 1.6);
    key.position.set(0, 7.4, 0.9);
    key.castShadow = true;
    key.target.position.set(0, 0, 0);
    this.scene.add(key, key.target);
    const fills: Array<[string, number, number, number]> = [
      ["#b9cdff", -6.5, 4.4, -5.2],
      ["#ffd9b9", 6.2, 4.1, -5.6],
      ["#9fb8ff", -5.4, 3.6, 6.0],
      ["#c9d8ff", 5.8, 3.9, 5.7],
    ];
    for (const [color, x, y, z] of fills) {
      const fill = new THREE.SpotLight(color, 60, 30, 0.7, 0.8, 1.8);
      fill.position.set(x, y, z);
      fill.target.position.set(0, 1, 0);
      this.scene.add(fill, fill.target);
    }
    const rim = new THREE.DirectionalLight("#dfe9ff", 0.7);
    rim.position.set(0, 3.4, -6.5);
    this.scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(4, 32), new THREE.MeshStandardMaterial({ color: "#2c4386", roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  async start(): Promise<void> {
    const status = this.root.querySelector("[data-status]")!;
    try {
      const gltf = await loadBoxerGlb();
      this.model = gltf.scene;
      applyFighterSkin(this.model);
      this.scene.add(this.model);
      this.model.traverse((object) => {
        if (object instanceof THREE.SkinnedMesh) {
          object.castShadow = true;
          object.frustumCulled = false;
        }
      });
      this.mixer = new THREE.AnimationMixer(this.model);
      const clipRows: ClipRow[] = [];
      for (const clip of gltf.animations) {
        const action = this.mixer.clipAction(clip);
        this.actions.set(clip.name, action);
        clipRows.push({ name: clip.name, duration: clip.duration.toFixed(3), tracks: clip.tracks.length });
        if (clip.name === "" || clip.name.startsWith("unnamed")) this.warnings.push(`unnamed clip at index ${clipRows.length - 1}`);
      }
      this.buildClipList(clipRows);
      this.buildInventory();
      const requested = new URLSearchParams(window.location.search).get("clip");
      this.playClip(requested !== null && this.actions.has(requested) ? requested : "idle");
      this.skeletonHelper = new THREE.SkeletonHelper(this.model);
      this.skeletonHelper.visible = false;
      this.scene.add(this.skeletonHelper);
      status.textContent = "ready";
    } catch (error) {
      status.textContent = `load failed: ${String(error).slice(0, 120)}`;
      this.warnings.push(String(error));
      this.warningsEl.textContent = this.warnings.join("\n");
      throw error;
    }
    const loop = (time: number): void => {
      const dt = Math.min(0.05, (time - this.previous) / 1000);
      this.previous = time;
      if (this.mixer !== null && this.playing) this.mixer.update(dt);
      if (this.current !== null && !this.playing) {
        // seek mode: hold the slider time
      }
      this.syncSeek();
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private buildClipList(rows: readonly ClipRow[]): void {
    const list = document.createElement("div");
    list.className = "model-clip-list";
    for (const row of rows) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${row.name} (${row.duration}s, ${row.tracks} tracks)`;
      button.dataset.clip = row.name;
      button.addEventListener("click", () => this.playClip(row.name));
      list.append(button);
    }
    this.clipsEl.replaceChildren(list);
  }

  private buildInventory(): void {
    if (this.model === null) return;
    this.model.updateMatrixWorld(true);
    const lines: string[] = [];
    let triangles = 0;
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    this.model.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh || object instanceof THREE.Mesh) {
        const geometry = object.geometry;
        const index = geometry.getIndex();
        triangles += (index !== null ? index.count : geometry.getAttribute("position").count) / 3;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          materials.add(material);
          const standard = material as THREE.MeshStandardMaterial;
          if (standard.map !== null && standard.map !== undefined) textures.add(standard.map);
        }
      }
    });
    lines.push(`triangles: ${Math.round(triangles)}`);
    lines.push(`materials: ${materials.size}`);
    lines.push(`textures: ${textures.size}`);
    for (const texture of textures) {
      const image = texture.image as { width?: number; height?: number } | undefined;
      lines.push(`texture: ~${image?.width ?? "?"}×${image?.height ?? "?"}`);
    }
    lines.push("");
    lines.push("bone hierarchy:");
    const bones: THREE.Bone[] = [];
    this.model.traverse((object) => {
      if (object instanceof THREE.Bone) bones.push(object);
    });
    const roots = bones.filter((bone) => !(bone.parent instanceof THREE.Bone));
    const walk = (bone: THREE.Bone, depth: number): void => {
      lines.push(`${"  ".repeat(depth)}${bone.name || "(unnamed)"}`);
      if (bone.name === "") this.warnings.push("unnamed bone found");
      for (const child of bone.children) if (child instanceof THREE.Bone) walk(child, depth + 1);
    };
    for (const rootBone of roots) walk(rootBone, 0);
    lines.push("");
    lines.push("adapter mapping:");
    for (const [canonical, model] of Object.entries(BONE_ADAPTER)) lines.push(`  ${canonical} → ${model}`);
    this.inventoryEl.textContent = lines.join("\n");
    const missing = Object.values(BONE_ADAPTER).filter((name) => this.model!.getObjectByName(name) === undefined);
    for (const name of missing) this.warnings.push(`missing mapped bone: ${name}`);
    if (this.warnings.length > 0) this.warningsEl.textContent = this.warnings.join("\n");
  }

  private playClip(name: string): void {
    const next = this.actions.get(name);
    if (next === undefined || this.mixer === null) return;
    const previous = this.current;
    next.reset();
    next.setLoop(this.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    next.clampWhenFinished = true;
    if (previous !== null && previous !== next) {
      next.crossFadeFrom(previous, 0.25, true);
    }
    next.play();
    this.current = next;
    for (const button of this.clipsEl.querySelectorAll("button")) {
      button.classList.toggle("active", button.dataset.clip === name);
    }
  }

  private syncSeek(): void {
    if (this.current === null) return;
    const duration = this.current.getClip().duration;
    if (this.playing) {
      this.timeSlider.value = String(Math.round((this.current.time / duration) * 1000));
    } else {
      this.current.time = (Number(this.timeSlider.value) / 1000) * duration;
      this.mixer?.update(0);
    }
  }

  private bindControls(): void {
    this.root.querySelector("[data-play]")!.addEventListener("click", (event) => {
      this.playing = !this.playing;
      (event.target as HTMLButtonElement).textContent = this.playing ? "Pause" : "Play";
    });
    this.root.querySelector<HTMLInputElement>("[data-loop]")!.addEventListener("change", (event) => {
      this.loop = (event.target as HTMLInputElement).checked;
      if (this.current !== null) {
        const name = this.current.getClip().name;
        this.playClip(name);
      }
    });
    this.root.querySelector<HTMLInputElement>("[data-skeleton]")!.addEventListener("change", (event) => {
      if (this.skeletonHelper !== null) this.skeletonHelper.visible = (event.target as HTMLInputElement).checked;
    });
    this.root.querySelector<HTMLInputElement>("[data-scale]")!.addEventListener("input", (event) => {
      this.model?.scale.setScalar(Number((event.target as HTMLInputElement).value) / 100);
    });
    this.root.querySelector<HTMLInputElement>("[data-rotate]")!.addEventListener("input", (event) => {
      if (this.model !== null) this.model.rotation.y = (Number((event.target as HTMLInputElement).value) * Math.PI) / 180;
    });
    this.root.querySelector<HTMLInputElement>("[data-offx]")!.addEventListener("input", (event) => {
      if (this.model !== null) this.model.position.x = Number((event.target as HTMLInputElement).value) / 100;
    });
    this.root.querySelector<HTMLInputElement>("[data-offz]")!.addEventListener("input", (event) => {
      if (this.model !== null) this.model.position.z = Number((event.target as HTMLInputElement).value) / 100;
    });
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
    this.root.replaceChildren();
  }
}

export function runModelLab(root: HTMLElement): () => void {
  const lab = new ModelLab(root);
  lab.start().catch(() => undefined);
  return () => lab.destroy();
}
