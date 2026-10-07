import * as THREE from "three";
import { Effects3D } from "../render/effects";
import { eyeSocket, measureBurstStump } from "../render/renderer";
import { BoxingGraph, SkinnedBoxer, loadBoxerGlb } from "../render/graph";
import { OFFICIAL_LOOKS, lookFor, type FighterLook } from "../render/looks";
import { BLUE_CORNER_OUTFIT, CUTMAN_OUTFIT, RED_CORNER_OUTFIT, REFEREE_OUTFIT, type OfficialOutfit } from "../render/outfit";
import { GloveTrail } from "../render/trails";
import { worldMapping } from "../render/world";
import type { FighterSnapshot, Hand, PunchClass, Target } from "../types";

/**
 * Pose lab: drives the runtime animation graph with synthetic fighter state so
 * every authored pose can be inspected from any angle without a match.
 * Query parameters: pose (idle, guard_high, guard_low, slip_left, slip_right,
 * weave, pull, jab_left, straight_right, hook_left, uppercut_right, ...,
 * hit_head, hit_body, block, knockdown, getup, stunned, taunt, clinch, seated, celebrate, wave_off, break, touch_gloves, walk),
 * t (seconds into the pose), stance (orthodox|southpaw), cam (front|side|
 * three-quarter|top|back), skeleton (1), outfit (referee|corner_blue|corner_red|cutman) to
 * show a ring official, whose poses are idle, count, attend, treat, wave_off and break, and
 * player (any id) to show the fighter that player gets.
 */

const OUTFITS: Readonly<Record<string, { readonly outfit: OfficialOutfit; readonly look: FighterLook }>> = {
  referee: { outfit: REFEREE_OUTFIT, look: OFFICIAL_LOOKS.referee },
  corner_blue: { outfit: BLUE_CORNER_OUTFIT, look: OFFICIAL_LOOKS.blueCorner },
  corner_red: { outfit: RED_CORNER_OUTFIT, look: OFFICIAL_LOOKS.redCorner },
  cutman: { outfit: CUTMAN_OUTFIT, look: OFFICIAL_LOOKS.blueCutman },
};

type Draft = { -readonly [K in keyof FighterSnapshot]: FighterSnapshot[K] };

const base = (): Draft => ({
  player_id: "lab", x: 0, y: 0, facing: 1, facing_x: 0, facing_y: -1000, velocity_x: 0, velocity_y: 0,
  stance: "orthodox", defense: "none", stamina: 1000, maximum_stamina: 1000, conditioning: 1000, guard: 700, poise: 600,
  trauma: { head: 0, body: 0, left_eye: 0, right_eye: 0, left_cut: 0, right_cut: 0, swelling: 0, bleeding: 0 },
  knockdowns: 0, warnings: 0, deductions: 0, stunned_ticks: 0, is_downed: false,
  action: null, action_hand: null, action_target: null, action_power: null, action_id: null, action_key: null,
  action_start_tick: 0, action_startup_ticks: 0, action_active_ticks: 0, action_recovery_ticks: 0, action_contact_tick: null,
  queued_actions: 0, clinch_startup_ticks: 0, clinch_ticks: 0, is_foul_recovery_target: false, taunt_ticks: 0, corner_choice: null,
  get_up_prompt: null, get_up_meter: 0, get_up_required: 0, get_up_count: 0, get_up_window_start_tick: 0, get_up_window_end_tick: 0,
  last_input_sequence: -1,
});

const KNEEL_WINDED_SECONDS = 0.45;
const CAMERAS: Record<string, [number, number, number]> = {
  face: [0.25, 1.55, 1.0],
  portrait: [0.12, 1.62, 0.62],
  eyes: [-0.2, 1.65, 0.44],
  floor: [1.62, 0.3, 0.18],
  hand: [0.55, 1.05, 0.75],
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
  private trails: GloveTrail[] = [];
  private readonly trailGlove = new THREE.Vector3();
  private readonly treatEye = new THREE.Vector3(0, 1.22, 0.78);
  private readonly treatFacing = new THREE.Vector3(0, 0, -1);
  private readonly treatTarget = new THREE.Vector3();
  private skeletonHelper: THREE.SkeletonHelper | null = null;
  /** `mouthpiece=1` knocks the gum shield out of the mouth every few seconds. */
  private effects: Effects3D | null = null;
  private shieldClock = Infinity;
  private shieldEvent = 0;
  private readonly mouth = new THREE.Vector3();
  private readonly headTurn = new THREE.Quaternion();
  /** `burst=1` shows what a burst leaves on the neck. */
  private burstRim = new Float32Array(0);
  private readonly burstStump = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), across: new THREE.Vector3(), scratch: new THREE.Vector3() };
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
    if (this.params.get("cam") === "hand") this.camera.lookAt(0.27, 0.84, 0.12);
    else if (this.params.get("cam") === "portrait") this.camera.lookAt(0, 1.6, 0.05);
    else if (this.params.get("cam") === "eyes") this.camera.lookAt(0.01, 1.6, 0.06);
    else if (this.params.get("cam") === "floor") this.camera.lookAt(1.3, 0.0, -0.24);
    else this.camera.lookAt(0, this.params.get("cam") === "face" ? 1.5 : 1.0, 0);
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
    const trauma = this.params.get("trauma");
    if (trauma === "light") fighter.trauma = { head: 220, body: 260, left_eye: 190, right_eye: 60, left_cut: 40, right_cut: 0, swelling: 120, bleeding: 60 };
    if (trauma === "heavy") fighter.trauma = { head: 900, body: 700, left_eye: 720, right_eye: 380, left_cut: 520, right_cut: 190, swelling: 620, bleeding: 520 };
    if (trauma === "cut") fighter.trauma = { head: 420, body: 120, left_eye: 380, right_eye: 120, left_cut: 300, right_cut: 0, swelling: 260, bleeding: 380 };
    // `trauma=head,body,left_eye,right_eye,left_cut,right_cut,swelling,bleeding` sets every value.
    const values = trauma?.split(",").map(Number) ?? [];
    if (values.length === 8 && values.every(Number.isFinite)) {
      const [head, body, leftEye, rightEye, leftCut, rightCut, swelling, bleeding] = values as [number, number, number, number, number, number, number, number];
      fighter.trauma = { head, body, left_eye: leftEye, right_eye: rightEye, left_cut: leftCut, right_cut: rightCut, swelling, bleeding };
    }
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
    } else if (pose === "kneel") {
      // Folded over a body shot for a moment, then down on one knee, then back up.
      const phase = seconds % 6;
      fighter.is_downed = phase >= KNEEL_WINDED_SECONDS && phase < 3.4;
      fighter.stunned_ticks = phase < KNEEL_WINDED_SECONDS ? 11 : 0;
    } else if (pose === "winded" || pose === "stagger") {
      fighter.stunned_ticks = 18;
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
      const official = OUTFITS[this.params.get("outfit") ?? ""];
      const player = this.params.get("player");
      this.boxer = new SkinnedBoxer(gltf, official === undefined
        ? { skin: 0xa9744f, gear: 0x1d4ed8, ...(player === null ? {} : { look: lookFor(player) }) }
        : { skin: 0xa9744f, gear: 0x1b2230, ...official });
      this.graph = new BoxingGraph(this.boxer, worldMapping({ tick_rate: 30, ring_half_width: 500, ring_half_height: 500 }), { referee: official !== undefined });
      this.scene.add(this.boxer.root);
      this.trails = [new GloveTrail(new THREE.Color(0xdbe4ff)), new GloveTrail(new THREE.Color(0xdbe4ff))];
      for (const trail of this.trails) this.scene.add(trail.mesh);
      if (this.params.get("skeleton") === "1") {
        this.skeletonHelper = new THREE.SkeletonHelper(this.boxer.root);
        this.scene.add(this.skeletonHelper);
      }
      if (this.params.get("mouthpiece") === "1" || this.params.get("burst") === "1" || this.params.has("eye")) this.effects = new Effects3D(this.scene);
      if (this.params.get("burst") === "1") this.boxer.setHeadBurst(true);
      const dislocation = this.params.get("dislocation");
      if (dislocation === "jaw" || dislocation === "shoulder_left" || dislocation === "shoulder_right") this.graph.setArcadeDislocation(dislocation);
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
    if (this.params.get("pose") === "knockdown" && this.params.get("fall") === "prone" && this.elapsed % 6 < dt * 1.5) {
      graph.react("hit", "head", 1, "hook", "left", 420);
    }
    const struck = this.params.get("side") === "left" ? 1 : -1;
    if (this.params.get("pose") === "kneel") {
      graph.fallToKnee(true);
      const phase = this.elapsed % 6;
      if (phase < KNEEL_WINDED_SECONDS) graph.windedFor(KNEEL_WINDED_SECONDS - phase, struck);
    }
    if (this.params.get("pose") === "winded") graph.windedFor(1, struck);
    if (this.params.get("pose") === "stagger" && (this.params.has("freeze") ? !this.reactionFired && this.elapsed >= 0.02 : this.elapsed % 1.6 < dt * 1.5)) {
      this.reactionFired = true;
      graph.stagger();
    }
    graph.debugHoldImpact = this.params.get("dent") === "hold";
    graph.setResting(this.params.get("pose") === "seated");
    if (this.params.get("pose") === "celebrate") graph.celebrate(60);
    if (this.params.get("pose") === "wave_off") graph.waveOff(60);
    if (this.params.get("pose") === "break") graph.breakClinch(60);
    graph.setCountdown(this.params.get("pose") === "touch_gloves" ? 30 : null);
    graph.setRefereeCount(this.params.get("pose") === "count", 3);
    graph.attend(this.params.get("pose") === "attend");
    const bottle = this.params.get("prop") === "bottle";
    graph.treat(this.params.get("pose") === "treat" ? this.treatTarget.copy(this.treatEye).setY(this.treatEye.y - (bottle ? 0.075 : 0)) : null, this.treatFacing, 1, bottle ? "bottle" : "enswell");
    graph.update(fighter, opponent, dt, this.elapsed, false, "full", sampledTick, head);
    if (this.effects !== null && this.params.get("burst") === "1") {
      const rim = measureBurstStump(this.boxer!, this.burstRim, this.burstStump);
      if (rim !== null) {
        this.burstRim = rim;
        if (!this.effects.headBurst(0)) this.effects.burstHead(0, this.burstStump.position, 1, 7);
        this.effects.anchorStump(0, this.burstStump.position, this.burstStump.quaternion, rim, this.burstStump.across);
      }
    }
    // `eye=left|right` forces that eye out and lets it hang.
    const eye = this.params.get("eye");
    if (this.effects !== null && (eye === "left" || eye === "right") && eyeSocket(this.boxer!, eye, this.mouth, this.burstStump.scratch, this.headTurn)) {
      this.boxer!.headInjury.setEyeOut(eye);
      if (!this.effects.eyeOut(0)) this.effects.gougeEye(0, this.mouth, this.burstStump.scratch, 1, 9);
      this.effects.anchorEye(0, this.mouth, this.burstStump.scratch, this.boxer!.bone("head")!.getWorldPosition(this.burstStump.position).add(new THREE.Vector3(0, 0.12, 0.02).applyQuaternion(this.headTurn)), this.headTurn);
    }
    if (this.effects !== null && this.params.get("mouthpiece") === "1") {
      this.shieldClock += dt;
      if (this.shieldClock > 3) {
        this.shieldClock = 0;
        this.shieldEvent += 1;
        const head = this.boxer!.bone("head")!;
        head.getWorldQuaternion(this.headTurn);
        head.getWorldPosition(this.mouth).add(new THREE.Vector3(0, 0.045, 0.12).applyQuaternion(this.headTurn));
        this.effects.ejectMouthpiece(0, this.mouth, this.headTurn, 1, this.shieldEvent, 0x1d4ed8, true);
      }
    }
    this.effects?.update(dt);
    for (const [index, bone] of (["gloveL", "gloveR"] as const).entries()) {
      this.boxer!.rig.bones[bone].getWorldPosition(this.trailGlove);
      this.trails[index]?.update(this.trailGlove, dt, this.camera.position, dt > 0);
    }
    (window as unknown as Record<string, unknown>).__poseLab = {
      head: this.boxer!.bone("head")!.getWorldPosition(new THREE.Vector3()).toArray().map((v) => Number(v.toFixed(3))),
      gloveL: this.boxer!.bone("gloveL")!.getWorldPosition(new THREE.Vector3()).toArray().map((v) => Number(v.toFixed(3))),
      gloveR: this.boxer!.bone("gloveR")!.getWorldPosition(new THREE.Vector3()).toArray().map((v) => Number(v.toFixed(3))),
      ankleL: this.boxer!.bone("ankleL")!.getWorldPosition(new THREE.Vector3()).toArray().map((v) => Number(v.toFixed(3))),
      ankleR: this.boxer!.bone("ankleR")!.getWorldPosition(new THREE.Vector3()).toArray().map((v) => Number(v.toFixed(3))),
      kneeL: this.boxer!.bone("kneeL")!.getWorldPosition(new THREE.Vector3()).toArray().map((v) => Number(v.toFixed(3))),
      kneeR: this.boxer!.bone("kneeR")!.getWorldPosition(new THREE.Vector3()).toArray().map((v) => Number(v.toFixed(3))),
      metrics: this.boxer!.rig.metrics,
      mouthpiece: this.effects !== null && this.effects.mouthpiecePosition(0, this.mouth) ? this.mouth.toArray().map((v) => Number(v.toFixed(3))) : null,
    };
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.effects?.dispose();
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
