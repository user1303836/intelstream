import * as THREE from "three";
import { BoxingGraph, SkinnedBoxer, loadBoxerGlb } from "../render/graph";
import { worldMapping } from "../render/world";
import type { FighterSnapshot, Hand, PunchClass, Target } from "../types";

/**
 * Pose lab: drives the runtime animation graph with synthetic fighter state so
 * every authored pose can be inspected from any angle without a match.
 * Query parameters: pose (idle, guard_high, guard_low, slip_left, slip_right,
 * weave, pull, jab_left, straight_right, hook_left, uppercut_right, ...,
 * hit_head, hit_body, block, knockdown, getup, stunned, taunt, clinch, walk),
 * t (seconds into the pose), stance (orthodox|southpaw), cam (front|side|
 * three-quarter|top|back), skeleton (1).
 */

type Draft = { -readonly [K in keyof FighterSnapshot]: FighterSnapshot[K] };

const base = (): Draft => ({
  player_id: "lab", x: 0, y: 0, facing: 1, facing_x: 0, facing_y: -1000, velocity_x: 0, velocity_y: 0,
  stance: "orthodox", defense: "none", stamina: 1000, maximum_stamina: 1000, conditioning: 1000, guard: 700, poise: 600,
  trauma: { head: 0, body: 0, left_eye: 0, right_eye: 0, left_cut: 0, right_cut: 0, swelling: 0, bleeding: 0 },
  knockdowns: 0, warnings: 0, deductions: 0, stunned_ticks: 0, is_downed: false,
  action: null, action_hand: null, action_target: null, action_power: null, action_id: null, action_key: null,
  action_start_tick: 0, action_startup_ticks: 0, action_active_ticks: 0, action_recovery_ticks: 0, action_contact_tick: null,
  queued_actions: 0, clinch_startup_ticks: 0, clinch_ticks: 0, is_foul_recovery_target: false, taunt_ticks: 0,
  get_up_prompt: null, get_up_meter: 0, get_up_required: 0, get_up_count: 0, get_up_window_start_tick: 0, get_up_window_end_tick: 0,
  last_input_sequence: -1,
});

const CAMERAS: Record<string, [number, number, number]> = {
  front: [0, 1.35, 3.4],
  side: [3.4, 1.3, 0.2],
  "three-quarter": [2.4, 1.5, 2.6],
  top: [0.01, 4.5, 0.6],
  back: [0.2, 1.4, -3.4],
  low: [1.8, 0.5, 2.6],
};

export class ModelLab {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private graph: BoxingGraph | null = null;
  private boxer: SkinnedBoxer | null = null;
  private skeletonHelper: THREE.SkeletonHelper | null = null;
  private raf = 0;
  private previous = performance.now();
  private elapsed = 0;
  private readonly params = new URLSearchParams(window.location.search);
  private reactionFired = false;
  private readonly statusEl: HTMLElement;

  constructor(private readonly root: HTMLElement) {
    root.innerHTML = `<section class="activity model-lab">
<canvas class="fight" data-canvas></canvas>
<header class="topbar"><strong>HANDS POSE LAB</strong><span data-status>loading…</span></header>
</section>`;
    this.statusEl = root.querySelector("[data-status]")!;
    const canvas = root.querySelector<HTMLCanvasElement>("[data-canvas]")!;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);
    const cam = CAMERAS[this.params.get("cam") ?? "three-quarter"] ?? CAMERAS["three-quarter"]!;
    this.camera.position.set(...cam);
    this.camera.lookAt(0, 1.0, 0);
    this.setupLighting();
  }

  private setupLighting(): void {
    this.scene.background = new THREE.Color("#101318");
    this.scene.add(new THREE.HemisphereLight("#8fa0c8", "#1a1c22", 1.4));
    const key = new THREE.DirectionalLight("#fff1dc", 2.6);
    key.position.set(2.5, 5, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight("#9fb8ff", 1.2);
    rim.position.set(-3, 3, -3);
    this.scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(4, 48), new THREE.MeshStandardMaterial({ color: "#3c4a7a", roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const grid = new THREE.GridHelper(4, 16, 0x8899bb, 0x33405a);
    grid.position.y = 0.002;
    this.scene.add(grid);
  }

  private synthesize(seconds: number): { fighter: FighterSnapshot; opponent: FighterSnapshot; sampledTick: number; head: THREE.Vector3 } {
    const pose = this.params.get("pose") ?? "idle";
    const stance = this.params.get("stance") === "southpaw" ? "southpaw" : "orthodox";
    const fighter: Draft = { ...base(), stance };
    const opponent = { ...base(), player_id: "other", x: 0, y: -150, facing_x: 0, facing_y: 1000 } as FighterSnapshot;
    const tick = Math.floor(seconds * 30);
    const punch = /^(jab|straight|hook|uppercut)_(left|right)(_body)?(_power)?$/.exec(pose);
    if (punch !== null) {
      const punchClass = punch[1] as PunchClass;
      const hand = punch[2] as Hand;
      const target: Target = punch[3] === "_body" ? "body" : "head";
      const power = punch[4] === "_power" ? "power" : "normal";
      const timing = { jab: [4, 2, 7], straight: [6, 2, 10], hook: [7, 3, 12], uppercut: [8, 2, 13] }[punchClass]!;
      const total = timing[0]! + timing[1]! + timing[2]!;
      const startTick = Math.floor(tick / (total + 12)) * (total + 12) + 6;
      if (tick >= startTick && tick < startTick + total) {
        fighter.action = punchClass;
        fighter.action_hand = hand;
        fighter.action_target = target;
        fighter.action_power = power;
        fighter.action_id = `lab-${startTick}`;
        fighter.action_key = `${punchClass}:${hand}:${target}:${power}`;
        fighter.action_start_tick = startTick;
        fighter.action_startup_ticks = timing[0]!;
        fighter.action_active_ticks = timing[1]!;
        fighter.action_recovery_ticks = timing[2]!;
      }
    } else if (["guard_high", "guard_low", "slip_left", "slip_right", "weave", "pull"].includes(pose)) {
      fighter.defense = pose as FighterSnapshot["defense"];
    } else if (pose === "knockdown") {
      fighter.is_downed = seconds % 6 < 3.2;
    } else if (pose === "stunned") {
      fighter.stunned_ticks = 40;
    } else if (pose === "taunt") {
      fighter.taunt_ticks = Math.max(1, 60 - (tick % 60));
    } else if (pose === "clinch") {
      fighter.clinch_ticks = 30;
    } else if (pose === "foul") {
      fighter.is_foul_recovery_target = true;
    } else if (pose === "exhausted") {
      fighter.stamina = 80;
    } else if (pose.startsWith("walk")) {
      const direction = pose.split("_")[1] ?? "forward";
      const speed = 6;
      fighter.velocity_x = direction === "left" ? -speed : direction === "right" ? speed : 0;
      fighter.velocity_y = direction === "forward" ? speed : direction === "back" ? -speed : 0;
      const mapping = worldMapping({ tick_rate: 30, ring_half_width: 500, ring_half_height: 500 });
      const travel = seconds * speed * 30;
      fighter.x = Math.round(Math.sin(seconds * 0.9) * 0);
      fighter.y = Math.round(((travel % 400) - 200) * (direction === "forward" ? 1 : direction === "back" ? -1 : 0));
      fighter.x = Math.round(((travel % 400) - 200) * (direction === "right" ? 1 : direction === "left" ? -1 : 0));
      void mapping;
    }
    const head = new THREE.Vector3(0, 1.5, 150 * (3.05 / 500));
    return { fighter, opponent, sampledTick: tick, head };
  }

  async start(): Promise<void> {
    try {
      const gltf = await loadBoxerGlb();
      this.boxer = new SkinnedBoxer(gltf, { skin: 0xa9744f, gear: 0x1d4ed8 });
      this.graph = new BoxingGraph(this.boxer, worldMapping({ tick_rate: 30, ring_half_width: 500, ring_half_height: 500 }));
      this.scene.add(this.boxer.root);
      if (this.params.get("skeleton") === "1") {
        this.skeletonHelper = new THREE.SkeletonHelper(this.boxer.root);
        this.scene.add(this.skeletonHelper);
      }
      this.statusEl.textContent = `pose ${this.params.get("pose") ?? "idle"}`;
    } catch (error) {
      this.statusEl.textContent = `load failed: ${String(error).slice(0, 120)}`;
      throw error;
    }
    const fixed = this.params.get("t");
    const freeze = this.params.get("freeze");
    if (freeze !== null) {
      const until = Number(freeze);
      while (this.elapsed < until) {
        this.elapsed += 1 / 60;
        this.step(1 / 60);
      }
    }
    const loop = (time: number): void => {
      const dt = Math.min(0.05, (time - this.previous) / 1000);
      this.previous = time;
      if (freeze !== null) {
        this.step(0);
      } else {
        this.elapsed = fixed !== null ? Number(fixed) : this.elapsed + dt;
        this.step(fixed !== null ? 1 / 60 : dt);
      }
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private step(dt: number): void {
    const graph = this.graph;
    if (graph === null) return;
    const width = this.renderer.domElement.clientWidth;
    const height = this.renderer.domElement.clientHeight;
    if (width > 0 && height > 0 && (this.renderer.domElement.width !== width || this.renderer.domElement.height !== height)) {
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
    const { fighter, opponent, sampledTick, head } = this.synthesize(this.elapsed);
    const reaction = this.params.get("pose") ?? "";
    if (/^(hit|block)_/.test(reaction)) {
      const period = 1.6;
      const phase = this.elapsed % period;
      const fire = this.params.has("freeze") ? !this.reactionFired && this.elapsed >= 0.02 : phase < dt * 1.5;
      if (fire) {
        this.reactionFired = true;
        const [kind, target, punchClass, hand] = reaction.split("_");
        graph.react(kind === "block" ? "block" : "hit", (target as Target) ?? "head", 1, (punchClass as PunchClass) ?? "straight", (hand as Hand) ?? "right", 320);
      }
    }
    graph.update(fighter, opponent, dt, this.elapsed, false, "full", sampledTick, head);
    (window as unknown as Record<string, unknown>).__poseLab = {
      head: this.boxer!.bone("head")!.getWorldPosition(new THREE.Vector3()).toArray().map((v) => Number(v.toFixed(3))),
      gloveL: this.boxer!.bone("gloveL")!.getWorldPosition(new THREE.Vector3()).toArray().map((v) => Number(v.toFixed(3))),
      gloveR: this.boxer!.bone("gloveR")!.getWorldPosition(new THREE.Vector3()).toArray().map((v) => Number(v.toFixed(3))),
      ankleL: this.boxer!.bone("ankleL")!.getWorldPosition(new THREE.Vector3()).toArray().map((v) => Number(v.toFixed(3))),
      ankleR: this.boxer!.bone("ankleR")!.getWorldPosition(new THREE.Vector3()).toArray().map((v) => Number(v.toFixed(3))),
    };
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.graph?.dispose();
    this.renderer.dispose();
    this.root.replaceChildren();
  }
}

export function runModelLab(root: HTMLElement): () => void {
  const lab = new ModelLab(root);
  lab.start().catch(() => undefined);
  return () => lab.destroy();
}
