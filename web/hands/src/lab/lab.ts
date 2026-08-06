import * as THREE from "three";
import { HURTBOXES } from "../manifest";
import { BONE_ADAPTER, loadBoxerGlb } from "../render/graph";
import { FightRenderer } from "../render/renderer";
import markerData from "../assets/fighter-markers.json";
import type { BloodLevel } from "../settings";
import type { EngineSnapshot } from "../types";

interface ReplayTick {
  readonly tick: number;
  readonly snapshot: { readonly payload: EngineSnapshot };
  readonly attack_one: ReplayAttack | null;
  readonly attack_two: ReplayAttack | null;
}

interface ReplayAttack {
  readonly class: string;
  readonly hand: string;
  readonly target: string;
  readonly age: number;
  readonly startup: number;
  readonly active: number;
  readonly recovery: number;
  readonly resolved: boolean;
}

interface ReplayDocument {
  readonly format: number;
  readonly seed: number;
  readonly tick_rate: number;
  readonly markers: readonly { marker: string; tick: number }[];
  readonly ticks: readonly ReplayTick[];
}

interface LabMetrics {
  contactAlignment: { tick: number; gloveToHeadMeters: number; gloveToTorsoMeters: number; kind: string }[];
  maxRootStepMeters: number;
  footSlideMeters: number;
  phaseDriftTicks: number;
}

const CAMERAS: Record<string, { position: [number, number, number]; lookAt: [number, number, number] }> = {
  broadcast: { position: [0, 1.88, 7.15], lookAt: [0, 1.12, 0] },
  side: { position: [7.4, 1.6, 0], lookAt: [0, 1.1, 0] },
  top: { position: [0.01, 8.5, 0.01], lookAt: [0, 0, 0] },
  ringside: { position: [1.6, 1.5, 4.1], lookAt: [0.2, 1.25, 0] },
};

const JOINT_PAIRS: readonly (readonly [string, string])[] = [
  ["hips", "spine"], ["spine", "head"],
  ["chest", "shoulderL"], ["shoulderL", "elbowL"], ["elbowL", "gloveL"],
  ["chest", "shoulderR"], ["shoulderR", "elbowR"], ["elbowR", "gloveR"],
  ["hips", "hipL"], ["hipL", "kneeL"], ["kneeL", "ankleL"],
  ["hips", "hipR"], ["hipR", "kneeR"], ["kneeR", "ankleR"],
];

export class LabApp {
  private renderer: FightRenderer | null = null;
  private replay: ReplayDocument | null = null;
  private raf = 0;
  private playing = false;
  private speed = 1;
  private virtualTick = 0;
  private carry = 0;
  private latencyMs = 0;
  private readonly pendingQueue: Array<{ at: number; tick: ReplayTick }> = [];
  private destroyed = false;
  private overlays = { skeleton: false, hurtbox: false, hitbox: false };
  private trajectoryLine: THREE.Line | null = null;
  private readonly skeletonLines: THREE.LineSegments[] = [];
  private readonly hurtboxMeshes: THREE.Mesh[] = [];
  private readonly hitboxMeshes: THREE.Mesh[] = [];
  private readonly statusEl: HTMLElement;
  private readonly metricsEl: HTMLElement;
  private readonly canvas: HTMLCanvasElement;

  constructor(private readonly root: HTMLElement) {
    root.innerHTML = `<section class="activity lab">
<canvas class="fight"></canvas>
<header class="topbar"><strong>HANDS LAB</strong><span data-lab-status>loading replay…</span></header>
<section class="lab-controls" data-lab-controls>
<button type="button" data-lab="play">Pause</button>
<button type="button" data-lab="step">Step tick</button>
<select data-lab="speed"><option value="1">1×</option><option value="0.5">0.5×</option><option value="0.25">0.25×</option><option value="0.1">0.1×</option></select>
<select data-lab="camera"><option value="broadcast">broadcast</option><option value="side">side</option><option value="top">top</option><option value="ringside">ringside</option></select>
<label><input type="checkbox" data-lab="skeleton"> skeleton</label>
<label><input type="checkbox" data-lab="hurtbox"> hurtboxes</label>
<label><input type="checkbox" data-lab="hitbox"> hitboxes</label>
<label>latency ms <input type="number" data-lab="latency" value="0" min="0" max="500" step="10"></label>
<button type="button" data-lab="metrics">Export metrics</button>
<span data-lab-metrics></span>
</section></section>`;
    this.canvas = root.querySelector("canvas")!;
    this.statusEl = root.querySelector("[data-lab-status]")!;
    this.metricsEl = root.querySelector("[data-lab-metrics]")!;
    this.bindControls();
  }

  async start(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    const replayName = params.get("replay") ?? "golden";
    let response = await fetch(`/replays/${replayName}.json`);
    if (!response.ok) response = await fetch(`/hands/replays/${replayName}.json`);
    if (!response.ok) throw new Error(`replay_load_failed:${response.status}`);
    this.replay = (await response.json()) as ReplayDocument;
    await loadBoxerGlb();
    this.renderer = new FightRenderer(
      this.canvas,
      { tick_rate: this.replay.tick_rate, ring_half_width: 500, ring_half_height: 330 },
      () => ({ volume: 0, haptics: false, reducedMotion: false, blood: "full" as BloodLevel }),
      { manualClock: true },
    );
    const players = Object.fromEntries(this.replay.ticks[0]!.snapshot.payload.fighters.map((fighter) => [
      fighter.player_id,
      { id: fighter.player_id, name: fighter.player_id === "one" ? "Azure Vector" : "Crimson Geometry", avatar: null, rating: 1500, connected: true },
    ]));
    this.renderer.setPlayers(players, "one");
    this.buildOverlays();

    const filmstripTick = params.get("tick");
    if (params.get("metrics") === "1") {
      await this.renderer.ready;
      this.exportMetrics();
      this.setStatus("metrics done");
      return;
    }
    if (filmstripTick !== null) {
      const tick = Number(filmstripTick);
      await this.renderer.ready;
      this.seek(tick);
      const camera = CAMERAS[params.get("camera") ?? ""] ?? CAMERAS.broadcast!;
      this.renderer.labSetCameraOverride(camera.position, camera.lookAt);
      this.overlays.skeleton = params.get("skeleton") === "1";
      this.overlays.hurtbox = params.get("hurtbox") === "1";
      this.overlays.hitbox = params.get("hitbox") === "1";
      this.syncOverlayVisibility();
      this.renderCurrentTick();
      (window as unknown as Record<string, unknown>).__labDebug = {
        roots: this.renderer.labRigs.map((root) => root.position.toArray().map((v) => Number(v.toFixed(3)))),
        heads: this.renderer.labRigs.map((root) => {
          const head = root.getObjectByName(BONE_ADAPTER.head ?? "head");
          return head === undefined ? null : head.getWorldPosition(new THREE.Vector3()).toArray().map((v) => Number(v.toFixed(3)));
        }),
        gloves: this.renderer.labRigs.map((root) => {
          const glove = root.getObjectByName(BONE_ADAPTER.gloveL ?? "gloveL");
          return glove === undefined ? null : glove.getWorldPosition(new THREE.Vector3()).toArray().map((v) => Number(v.toFixed(3)));
        }),
        material: (() => {
          let info: unknown = null;
          this.renderer!.labRigs[0]?.traverse((object) => {
            if (info === null && object instanceof THREE.SkinnedMesh) {
              const material = object.material as THREE.MeshPhysicalMaterial;
              info = { colorHex: material.color.getHexString(), hasMap: material.map !== null, mapImage: (material.map?.image as HTMLImageElement | undefined)?.width ?? "none", mapVersion: material.map?.version, clearcoat: material.clearcoat, opacity: material.opacity };
            }
          });
          return info;
        })(),
      };
      this.setStatus(`filmstrip tick ${tick}`);
      return;
    }

    this.playing = true;
    const loop = (): void => {
      if (this.destroyed) return;
      this.advance();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private bindControls(): void {
    this.root.querySelector("[data-lab='play']")!.addEventListener("click", (event) => {
      this.playing = !this.playing;
      (event.target as HTMLButtonElement).textContent = this.playing ? "Pause" : "Play";
    });
    this.root.querySelector("[data-lab='step']")!.addEventListener("click", () => {
      this.playing = false;
      this.root.querySelector<HTMLButtonElement>("[data-lab='play']")!.textContent = "Play";
      this.virtualTick = Math.min(this.virtualTick + 1, (this.replay?.ticks.length ?? 1) - 1);
      this.pushUpTo(this.virtualTick);
      this.renderCurrentTick();
    });
    this.root.querySelector<HTMLSelectElement>("[data-lab='speed']")!.addEventListener("change", (event) => {
      this.speed = Number((event.target as HTMLSelectElement).value);
    });
    this.root.querySelector<HTMLSelectElement>("[data-lab='camera']")!.addEventListener("change", (event) => {
      const camera = CAMERAS[(event.target as HTMLSelectElement).value]!;
      this.renderer?.labSetCameraOverride(camera.position, camera.lookAt);
    });
    for (const name of ["skeleton", "hurtbox", "hitbox"] as const) {
      this.root.querySelector<HTMLInputElement>(`[data-lab='${name}']`)!.addEventListener("change", (event) => {
        this.overlays[name] = (event.target as HTMLInputElement).checked;
        this.syncOverlayVisibility();
      });
    }
    this.root.querySelector<HTMLInputElement>("[data-lab='latency']")!.addEventListener("change", (event) => {
      this.latencyMs = Math.max(0, Math.min(500, Number((event.target as HTMLInputElement).value)));
    });
    this.root.querySelector("[data-lab='metrics']")!.addEventListener("click", () => this.exportMetrics());
  }

  private advance(): void {
    if (!this.playing || this.replay === null) return;
    const last = this.replay.ticks.length - 1;
    if (this.virtualTick >= last) return;
    this.carry += this.speed;
    while (this.carry >= 1 && this.virtualTick < last) {
      this.carry -= 1;
      this.virtualTick += 1;
      this.pushUpTo(this.virtualTick);
    }
    this.renderCurrentTick();
  }

  private pushUpTo(tickIndex: number): void {
    if (this.replay === null) return;
    const tick = this.replay.ticks[tickIndex];
    if (tick === undefined) return;
    if (this.latencyMs > 0) {
      this.pendingQueue.push({ at: performance.now() + this.latencyMs, tick });
    } else {
      this.renderer?.push(tick.snapshot.payload);
    }
  }

  private drainLatencyQueue(): void {
    const now = performance.now();
    for (let i = this.pendingQueue.length - 1; i >= 0; i -= 1) {
      const entry = this.pendingQueue[i]!;
      if (entry.at <= now) {
        this.renderer?.push(entry.tick.snapshot.payload);
        this.pendingQueue.splice(i, 1);
      }
    }
  }

  private seek(tickIndex: number, render = true): void {
    if (this.replay === null || this.renderer === null) return;
    const clamped = Math.max(0, Math.min(tickIndex, this.replay.ticks.length - 1));
    for (let i = 0; i <= clamped; i += 1) {
      this.renderer.push(this.replay.ticks[i]!.snapshot.payload);
      if (i >= clamped - 15) this.renderer.labEffects.update(1 / 30);
    }
    this.virtualTick = clamped;
    this.renderOnSeek = render;
  }

  private renderOnSeek = true;

  private renderCurrentTick(render?: boolean): void {
    if (this.replay === null || this.renderer === null) return;
    this.drainLatencyQueue();
    this.renderer.labFrame(this.virtualTick / this.replay.tick_rate, render ?? this.renderOnSeek);
    this.renderer.labFrame((this.virtualTick + 0.5) / this.replay.tick_rate, render ?? this.renderOnSeek);
    this.updateOverlays();
    this.updateTrajectory();
    const tick = this.replay.ticks[this.virtualTick];
    const phase = tick?.snapshot.payload.phase ?? "";
    this.setStatus(`tick ${this.virtualTick}/${this.replay.ticks.length - 1} · ${phase} · ${this.speed}×`);
  }

  private buildOverlays(): void {
    const renderer = this.renderer;
    if (renderer === null) return;
    const skeletonMat = new THREE.LineBasicMaterial({ color: 0x7dffa8, depthTest: false, transparent: true, opacity: 0.9 });
    for (const rigRoot of renderer.labRigs) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(JOINT_PAIRS.length * 6), 3));
      const lines = new THREE.LineSegments(geometry, skeletonMat);
      lines.frustumCulled = false;
      lines.renderOrder = 20;
      renderer.labScene.add(lines);
      this.skeletonLines.push(lines);

      const headBox = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.13, 0.16, 4, 8),
        new THREE.MeshBasicMaterial({ color: 0xff5d5d, wireframe: true, transparent: true, opacity: 0.85, depthTest: false }),
      );
      headBox.renderOrder = 21;
      headBox.position.y = 0.12;
      (rigRoot.getObjectByName(BONE_ADAPTER.head ?? "head") ?? rigRoot).add(headBox);
      this.hurtboxMeshes.push(headBox);
      const torsoBox = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.21, 0.34, 4, 8),
        new THREE.MeshBasicMaterial({ color: 0xffb85d, wireframe: true, transparent: true, opacity: 0.7, depthTest: false }),
      );
      torsoBox.renderOrder = 21;
      torsoBox.position.y = 0.16;
      (rigRoot.getObjectByName(BONE_ADAPTER.chest ?? "chest") ?? rigRoot).add(torsoBox);
      this.hurtboxMeshes.push(torsoBox);

      for (const gloveName of ["gloveL", "gloveR"]) {
        const hitbox = new THREE.Mesh(
          new THREE.SphereGeometry(0.11, 10, 8),
          new THREE.MeshBasicMaterial({ color: 0x5db4ff, wireframe: true, transparent: true, opacity: 0.85, depthTest: false }),
        );
        hitbox.renderOrder = 22;
        (rigRoot.getObjectByName(BONE_ADAPTER[gloveName] ?? gloveName) ?? rigRoot).add(hitbox);
        this.hitboxMeshes.push(hitbox);
      }
    }
    this.syncOverlayVisibility();
  }

  private syncOverlayVisibility(): void {
    for (const lines of this.skeletonLines) lines.visible = this.overlays.skeleton;
    for (const mesh of this.hurtboxMeshes) mesh.visible = this.overlays.hurtbox;
    for (const mesh of this.hitboxMeshes) mesh.visible = this.overlays.hitbox;
    this.updateTrajectory();
  }

  private updateTrajectory(): void {
    if (this.trajectoryLine !== null) {
      this.trajectoryLine.removeFromParent();
      this.trajectoryLine.geometry.dispose();
      (this.trajectoryLine.material as THREE.Material).dispose();
      this.trajectoryLine = null;
    }
    if (!this.overlays.hitbox || this.replay === null || this.renderer === null) return;
    const entry = this.replay.ticks[this.virtualTick];
    const fighter = entry?.snapshot.payload.fighters[0];
    const key = fighter?.action_key;
    if (key === undefined || key === null) return;
    const parts = key.split(":");
    const trajectory = (markerData.trajectories as Record<string, { left: number[][]; right: number[][] }>)[`${parts[0]}:${parts[1]}`];
    if (trajectory === undefined) return;
    const fighterRoot = this.renderer.labRigs[0]!;
    const fighterModel = fighterRoot.children[0] ?? fighterRoot;
    fighterModel.updateMatrixWorld(true);
    const points = (parts[1] === "right" ? trajectory.right : trajectory.left).map(
      (point) => fighterModel.localToWorld(new THREE.Vector3(point[0] ?? 0, point[1] ?? 0, point[2] ?? 0)),
    );
    if (points.length < 2) return;
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    this.trajectoryLine = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color: 0x5db4ff, transparent: true, opacity: 0.75, depthTest: false }),
    );
    this.trajectoryLine.renderOrder = 23;
    this.trajectoryLine.frustumCulled = false;
    this.renderer.labScene.add(this.trajectoryLine);
  }

  private updateOverlays(): void {
    const renderer = this.renderer;
    if (renderer === null) return;
    for (const [index, rigRootEntry] of renderer.labRigs.entries()) {
      const lines = this.skeletonLines[index];
      if (lines === undefined || !lines.visible) continue;
      const positions = lines.geometry.getAttribute("position") as THREE.BufferAttribute;
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      JOINT_PAIRS.forEach(([from, to], pairIndex) => {
        const jointFrom = rigRootEntry.getObjectByName(from);
        const jointTo = rigRootEntry.getObjectByName(to);
        if (jointFrom === undefined || jointTo === undefined) return;
        jointFrom.getWorldPosition(a);
        jointTo.getWorldPosition(b);
        positions.setXYZ(pairIndex * 2, a.x, a.y, a.z);
        positions.setXYZ(pairIndex * 2 + 1, b.x, b.y, b.z);
      });
      positions.needsUpdate = true;
    }
  }

  private jointWorld(rigIndex: number, joint: string): THREE.Vector3 | null {
    const rig = this.renderer?.labRigs[rigIndex];
    const found = rig?.getObjectByName(BONE_ADAPTER[joint] ?? joint);
    return found === undefined || found === null ? null : found.getWorldPosition(new THREE.Vector3());
  }

  private exportMetrics(): void {
    if (this.replay === null) return;
    const metrics: LabMetrics = {
      contactAlignment: [],
      maxRootStepMeters: 0,
      footSlideMeters: 0,
      phaseDriftTicks: 0,
    };
    for (const entry of this.replay.ticks) {
      const contact = entry.snapshot.payload.events.find((event) => ["hit", "counter_hit", "block"].includes(event.kind));
      const actionHand = entry.snapshot.payload.fighters[0]!.action_hand;
      if (contact === undefined || actionHand === null) continue;
      const displayTick = Math.min(entry.tick + 1, this.replay.ticks.length - 1);
      this.seek(displayTick, false);
      this.renderCurrentTick(false);
      const glove = this.jointWorld(0, actionHand === "left" ? "gloveL" : "gloveR");
      const head = this.jointWorld(1, "head");
      const torso = this.jointWorld(1, "chest");
      if (glove !== null && head !== null && torso !== null) {
        metrics.contactAlignment.push({
          tick: entry.tick,
          kind: contact.kind,
          gloveToHeadMeters: Number(Math.max(0, glove.distanceTo(head) - HURTBOXES.head.radius).toFixed(4)),
          gloveToTorsoMeters: Number(Math.max(0, glove.distanceTo(torso) - HURTBOXES.torso.radius).toFixed(4)),
        });
      }
    }
    this.seek(0, false);
    let previousFeet: THREE.Vector3[] | null = null;
    let previousRootX: number | null = null;
    for (const entry of this.replay.ticks) {
      this.seek(entry.tick, false);
      this.renderCurrentTick(false);
      const rootX = this.renderer!.labRigs[0]!.position.x;
      if (previousRootX !== null) metrics.maxRootStepMeters = Math.max(metrics.maxRootStepMeters, Math.abs(rootX - previousRootX));
      previousRootX = rootX;
      const fighter = entry.snapshot.payload.fighters[0]!;
      const speed = Math.hypot(fighter.velocity_x, fighter.velocity_y);
      const wasDowned = this.replay.ticks.slice(Math.max(0, entry.tick - 30), entry.tick + 1).some((past) => past.snapshot.payload.fighters[0]!.is_downed);
      if (speed === 0 && !fighter.is_downed && !wasDowned && entry.snapshot.payload.phase === "fight") {
        const feet = [this.jointWorld(0, "ankleL"), this.jointWorld(0, "ankleR")].filter((v): v is THREE.Vector3 => v !== null);
        if (previousFeet !== null && feet.length === 2) {
          metrics.footSlideMeters = Math.max(
            metrics.footSlideMeters,
            Number(Math.max(feet[0]!.distanceTo(previousFeet[0]!), feet[1]!.distanceTo(previousFeet[1]!)).toFixed(4)),
          );
        }
        previousFeet = feet;
      } else {
        previousFeet = null;
      }
    }
    this.metricsEl.textContent = ` contacts: ${metrics.contactAlignment.map((c) => `${c.kind}@t${c.tick} glove-head ${c.gloveToHeadMeters}m`).join(" · ")} · max root step ${metrics.maxRootStepMeters.toFixed(3)}m · foot slide ${metrics.footSlideMeters}m`;
    (window as unknown as Record<string, unknown>).__labDebug = {
      roots: this.renderer!.labRigs.map((root) => root.position.toArray().map((v) => Number(v.toFixed(3)))),
      graphsActive: (this.renderer as unknown as { graphs: unknown }).graphs !== null,
      heads: this.renderer!.labRigs.map((root) => {
        const head = root.getObjectByName(BONE_ADAPTER.head ?? "head");
        return head === undefined ? null : head.getWorldPosition(new THREE.Vector3()).toArray().map((v) => Number(v.toFixed(3)));
      }),
    };
    const blob = new Blob([JSON.stringify(metrics, null, 1)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "hands-lab-metrics.json";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  private setStatus(text: string): void {
    if (this.statusEl.textContent !== text) this.statusEl.textContent = text;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.renderer?.destroy();
    this.root.replaceChildren();
  }
}

export function runLab(root: HTMLElement): () => void {
  const lab = new LabApp(root);
  lab.start().catch((error: unknown) => {
    root.querySelector("[data-lab-status]")!.textContent = `lab failed: ${String(error)}`;
  });
  return () => lab.destroy();
}
