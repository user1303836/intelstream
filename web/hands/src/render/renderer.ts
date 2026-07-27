import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { EventDeduplicator, SnapshotBuffer } from "../interpolation";
import type { BloodLevel, Settings } from "../settings";
import type { EngineSnapshot, FinalMessage, PublicPlayer, SimulationInfo } from "../types";
import { BoxerAnimator } from "./animation";
import { buildArena, type BuiltArena } from "./arena";
import { buildBoxer, buildReferee, disposeBoxer, type BoxerRig } from "./boxer";
import { CameraDirector } from "./camera";
import { Effects3D } from "./effects";
import { drawHud } from "./hud";
import { buildRing, disposeRing, type BuiltRing } from "./ring";
import { resizeHighDpi } from "./viewport";
import { PALETTES, worldMapping, type WorldMapping } from "./world";

function blobShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    const gradient = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
    gradient.addColorStop(0, "rgba(0,0,0,0.68)");
    gradient.addColorStop(0.6, "rgba(0,0,0,0.34)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(canvas);
}

const DEFAULT_SIM: SimulationInfo = { tick_rate: 30, ring_half_width: 500, ring_half_height: 330 };

export class FightRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly composer: EffectComposer;
  private readonly ring: BuiltRing;
  private readonly arena: BuiltArena;
  private readonly boxers: [BoxerRig, BoxerRig];
  private readonly referee: BoxerRig;
  private readonly refereePosition = new THREE.Vector3(0.4, 0, -2.1);
  private readonly animators: [BoxerAnimator, BoxerAnimator];
  private readonly effects: Effects3D;
  private readonly director = new CameraDirector();
  private readonly mapping: WorldMapping;
  private readonly buffer = new SnapshotBuffer();
  private readonly dedupe = new EventDeduplicator();
  private readonly hudCanvas: HTMLCanvasElement;
  private readonly blobShadows: THREE.Mesh[] = [];
  private readonly blobTexture: THREE.CanvasTexture;
  private readonly lights: THREE.Light[] = [];
  private raf = 0;
  private previous = performance.now();
  private players: Readonly<Record<string, PublicPlayer>> = {};
  private viewerId: string | null = null;
  private final: FinalMessage | null = null;
  private reconnectMs = 0;
  private destroyed = false;
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly simulation: SimulationInfo = DEFAULT_SIM,
    private readonly settings: () => Settings,
  ) {
    this.mapping = worldMapping(simulation);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

    this.scene.background = new THREE.Color("#04060b");
    this.scene.fog = new THREE.FogExp2("#04060b", 0.042);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);
    this.camera.position.set(0, 2.05, 7.6);
    this.camera.lookAt(0, 1.1, 0);

    this.setupLights();
    this.ring = buildRing();
    this.scene.add(this.ring.group);
    this.arena = buildArena();
    this.scene.add(this.arena.group);
    this.effects = new Effects3D(this.scene);

    this.boxers = [buildBoxer(PALETTES[0]), buildBoxer(PALETTES[1])];
    this.animators = [new BoxerAnimator(this.boxers[0], this.mapping), new BoxerAnimator(this.boxers[1], this.mapping)];
    this.boxers[0].root.position.set(-0.9, 0, 0);
    this.boxers[1].root.position.set(0.9, 0, 0);
    this.boxers[0].root.rotation.y = Math.PI / 2;
    this.boxers[1].root.rotation.y = -Math.PI / 2;
    this.scene.add(this.boxers[0].root, this.boxers[1].root);

    this.referee = buildReferee();
    this.referee.root.position.copy(this.refereePosition);
    this.referee.shoulderL.rotation.x = -0.42;
    this.referee.shoulderR.rotation.x = -0.42;
    this.referee.elbowL.rotation.x = -0.55;
    this.referee.elbowR.rotation.x = -0.55;
    this.scene.add(this.referee.root);

    this.blobTexture = blobShadowTexture();
    const blobGeometry = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 3; i += 1) {
      const blob = new THREE.Mesh(blobGeometry, new THREE.MeshBasicMaterial({ map: this.blobTexture, transparent: true, depthWrite: false }));
      blob.rotation.x = -Math.PI / 2;
      blob.position.y = 0.006 + i * 0.0004;
      blob.renderOrder = 1;
      this.blobShadows.push(blob);
      this.scene.add(blob);
    }

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1280, 720), 0.32, 0.5, 0.85);
    this.composer.addPass(bloom);
    this.composer.addPass(new OutputPass());

    this.hudCanvas = document.createElement("canvas");
    this.hudCanvas.className = "fight-hud";
    this.hudCanvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
    canvas.insertAdjacentElement("afterend", this.hudCanvas);

    this.effects.setBloodLevel(settings().blood);
    this.raf = requestAnimationFrame((time) => this.draw(time));
  }

  setPlayers(players: Readonly<Record<string, PublicPlayer>>, viewerId: string | null): void {
    this.players = players;
    this.viewerId = viewerId;
  }

  setFinal(final: FinalMessage | null): void {
    this.final = final;
  }

  setReconnect(milliseconds: number): void {
    this.reconnectMs = milliseconds;
  }

  setBloodLevel(level: BloodLevel): void {
    this.effects.setBloodLevel(level);
  }

  setReducedMotion(reduced: boolean): void {
    if (reduced) this.effects.clearDynamic();
  }

  push(snapshot: EngineSnapshot): void {
    if (!this.buffer.push(snapshot)) return;
    for (const event of this.dedupe.accept(snapshot.events)) {
      const target = snapshot.fighters.find((fighter) => fighter.player_id === event.target_id)
        ?? snapshot.fighters.find((fighter) => fighter.player_id === event.actor_id)
        ?? snapshot.fighters[0];
      this.tmpA.set(this.mapping.x(target.x), 0, this.mapping.z(target.y));
      this.effects.addEvent(event, this.tmpA, this.settings().reducedMotion);
      const targetIndex = snapshot.fighters.findIndex((fighter) => fighter.player_id === event.target_id);
      if (targetIndex >= 0 && ["hit", "counter_hit", "block", "knockdown"].includes(event.kind)) {
        this.animators[targetIndex]!.impact({
          direction: event.direction,
          amount: event.kind === "block" ? event.amount * 0.35 : event.amount,
          blocked: event.kind === "block",
        });
      }
    }
  }

  private setupLights(): void {
    const hemisphere = new THREE.HemisphereLight("#33415e", "#05060a", 0.5);
    this.scene.add(hemisphere);
    this.lights.push(hemisphere);

    const ambient = new THREE.AmbientLight("#2b3450", 0.55);
    this.scene.add(ambient);
    this.lights.push(ambient);

    const key = new THREE.SpotLight("#fff4e0", 115, 26, 0.68, 0.6, 1.6);
    key.position.set(0, 7.4, 0.9);
    key.target.position.set(0, 0, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004;
    key.shadow.camera.near = 3;
    key.shadow.camera.far = 14;
    this.scene.add(key, key.target);
    this.lights.push(key);

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
      this.lights.push(fill);
    }

    const rim = new THREE.DirectionalLight("#dfe9ff", 0.7);
    rim.position.set(0, 3.4, -6.5);
    this.scene.add(rim);
    this.lights.push(rim);
  }

  private draw(time: number): void {
    if (this.destroyed) return;
    const dt = Math.min(0.05, Math.max(0.001, (time - this.previous) / 1000));
    this.previous = time;

    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width > 0 && height > 0) {
      const size = new THREE.Vector2();
      this.renderer.getSize(size);
      if (size.x !== width || size.y !== height) {
        this.renderer.setSize(width, height, false);
        this.composer.setSize(width, height);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
      }
    }

    const seconds = time / 1000;
    const current = this.settings();
    this.effects.setBloodLevel(current.blood);

    const latest = this.buffer.latest();
    const snapshot = latest === null ? null : this.buffer.sample(latest.tick - 1);
    let separation = 1.8;
    let knockdown = false;
    if (snapshot !== null) {
      const [a, b] = snapshot.fighters;
      this.animators[0].update(a, b, dt, seconds, current.reducedMotion);
      this.animators[1].update(b, a, dt, seconds, current.reducedMotion);
      const ax = this.mapping.x(a.x);
      const az = this.mapping.z(a.y);
      const bx = this.mapping.x(b.x);
      const bz = this.mapping.z(b.y);
      separation = Math.hypot(ax - bx, az - bz);
      knockdown = a.is_downed || b.is_downed;
      this.tmpA.set(ax, 0, az);
      this.tmpB.set(bx, 0, bz);
    } else {
      this.tmpA.set(-0.9, 0, 0);
      this.tmpB.set(0.9, 0, 0);
    }

    this.arena.update(seconds, current.reducedMotion);
    this.effects.update(dt);
    this.updateReferee(dt, seconds, current.reducedMotion);
    this.updateBlobShadows();
    const frame = this.director.update(
      dt,
      seconds,
      { x: this.tmpA.x, z: this.tmpA.z },
      { x: this.tmpB.x, z: this.tmpB.z },
      separation,
      knockdown,
      this.effects.shakeAmount,
      current.reducedMotion,
    );
    this.camera.position.copy(frame.position);
    this.camera.lookAt(frame.lookAt);

    this.composer.render();
    this.drawHudOverlay(snapshot);

    if (!this.destroyed) this.raf = requestAnimationFrame((next) => this.draw(next));
  }

  private updateBlobShadows(): void {
    const anchors = [this.tmpA, this.tmpB, this.refereePosition];
    for (const [index, blob] of this.blobShadows.entries()) {
      const anchor = anchors[index]!;
      blob.position.x = anchor.x;
      blob.position.z = anchor.z;
      const downed = index < 2 && this.buffer.latest()?.fighters[index]?.is_downed === true;
      blob.scale.set(downed ? 2.1 : 1.25, downed ? 0.9 : 0.85, 1);
    }
  }

  private updateReferee(dt: number, time: number, reducedMotion: boolean): void {
    const midX = (this.tmpA.x + this.tmpB.x) / 2;
    const midZ = (this.tmpA.z + this.tmpB.z) / 2;
    const away = new THREE.Vector3(this.refereePosition.x - midX, 0, this.refereePosition.z - midZ);
    if (away.lengthSq() < 0.01) away.set(0, 0, -1);
    away.normalize();
    const targetX = THREE.MathUtils.clamp(midX + away.x * 2.05, -2.4, 2.4);
    const targetZ = THREE.MathUtils.clamp(midZ + away.z * 2.05, -2.4, 2.4);
    const rate = 1 - Math.exp(-1.6 * dt);
    this.refereePosition.x += (targetX - this.refereePosition.x) * rate;
    this.refereePosition.z += (targetZ - this.refereePosition.z) * rate;
    for (const fighter of [this.tmpA, this.tmpB]) {
      const dx = this.refereePosition.x - fighter.x;
      const dz = this.refereePosition.z - fighter.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 1.45 && distance > 0.001) {
        this.refereePosition.x = fighter.x + (dx / distance) * 1.45;
        this.refereePosition.z = fighter.z + (dz / distance) * 1.45;
      }
    }
    this.referee.root.position.set(this.refereePosition.x, 0, this.refereePosition.z);
    const yaw = Math.atan2(midX - this.refereePosition.x, midZ - this.refereePosition.z);
    this.referee.root.rotation.y += (yaw - this.referee.root.rotation.y) * (1 - Math.exp(-3 * dt));
    this.referee.hips.position.y = 0.98 + (reducedMotion ? 0 : Math.sin(time * 1.7) * 0.006);
  }

  private drawHudOverlay(snapshot: EngineSnapshot | null): void {
    const resized = resizeHighDpi(this.hudCanvas);
    if (resized === null) return;
    const { context: ctx, viewport } = resized;
    ctx.clearRect(0, 0, viewport.width, viewport.height);
    if (snapshot === null) return;
    const hurt = Math.max(...snapshot.fighters.map((fighter) => fighter.trauma.head + fighter.trauma.body));
    if (hurt > 350) {
      const vignette = ctx.createRadialGradient(viewport.width / 2, viewport.height / 2, viewport.width * 0.2, viewport.width / 2, viewport.height / 2, viewport.width * 0.72);
      vignette.addColorStop(0, "rgba(90,0,8,0)");
      vignette.addColorStop(1, `rgba(75,0,8,${Math.min(0.3, hurt / 4600)})`);
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, viewport.width, viewport.height);
    }
    drawHud(ctx, viewport.width, viewport.height, snapshot, this.players, this.viewerId, this.final, this.reconnectMs, this.simulation.tick_rate);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.buffer.clear();
    this.dedupe.reset();
    this.effects.dispose();
    this.arena.dispose();
    disposeRing(this.ring);
    for (const boxer of this.boxers) {
      this.scene.remove(boxer.root);
      disposeBoxer(boxer);
    }
    this.scene.remove(this.referee.root);
    disposeBoxer(this.referee);
    for (const light of this.lights) this.scene.remove(light);
    this.composer.dispose();
    this.renderer.dispose();
    this.blobTexture.dispose();
    for (const blob of this.blobShadows) {
      this.scene.remove(blob);
      blob.geometry.dispose();
      (blob.material as THREE.Material).dispose();
    }
    this.hudCanvas.remove();
  }
}
