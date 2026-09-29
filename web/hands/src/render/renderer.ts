import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { EventDeduplicator, SnapshotBuffer } from "../interpolation";
import { predictMovement, type HeldInput } from "../prediction";
import type { BloodLevel, Settings } from "../settings";
import type { CombatEvent, EngineSnapshot, FighterSnapshot, FinalMessage, Hand, MatchResult, PublicPlayer, PunchClass, SemanticAction, SimulationInfo } from "../types";
import { buildArena, type BuiltArena } from "./arena";
import { CameraDirector } from "./camera";
import { Effects3D, type BakedPart } from "./effects";
import { BoxingGraph, SkinnedBoxer, loadBoxerGlb, type ArcadeDislocation } from "./graph";
import { drawHud } from "./hud";

export type ArcadeInjury =
  | "decapitation"
  | "dismember_left"
  | "dismember_right"
  | "jaw_dislocation"
  | "shoulder_left"
  | "shoulder_right";

export function isArcadeInjuryCandidate(
  event: CombatEvent,
  target: FighterSnapshot | undefined,
  result: MatchResult | null,
): boolean {
  const anatomicalTarget = event.detail.endsWith(":head") || event.detail.endsWith(":body");
  if (target === undefined || !["hit", "counter_hit"].includes(event.kind) || !anatomicalTarget) return false;
  return target.is_downed || (
    result?.finish_method === "flash_ko"
    && result.winner_id !== null
    && result.winner_id === event.actor_id
  );
}

export function contactParticipants(event: CombatEvent, snapshot: EngineSnapshot): {
  recipientIndex: number;
  puncherIndex: number;
} {
  const targetIndex = snapshot.fighters.findIndex((fighter) => fighter.player_id === event.target_id);
  const actorIndex = snapshot.fighters.findIndex((fighter) => fighter.player_id === event.actor_id);
  const defenderIsActor = event.kind === "block" || event.kind === "perfect_block";
  return {
    recipientIndex: defenderIsActor ? actorIndex : targetIndex,
    puncherIndex: defenderIsActor ? targetIndex : actorIndex,
  };
}

export interface ContactPresentation {
  readonly event: CombatEvent;
  readonly presentationEvent: CombatEvent;
  readonly presentImpact: boolean;
}

const isHit = (event: CombatEvent): boolean => event.kind === "hit" || event.kind === "counter_hit";
const isBlock = (event: CombatEvent): boolean => event.kind === "block" || event.kind === "perfect_block";

function pairedBlock(event: CombatEvent, events: readonly CombatEvent[]): CombatEvent | undefined {
  if (!isHit(event) || event.action_id === null) return undefined;
  return events.find((candidate) => isBlock(candidate)
    && candidate.action_id === event.action_id
    && candidate.actor_id === event.target_id
    && candidate.target_id === event.actor_id);
}

function pairedHit(event: CombatEvent, events: readonly CombatEvent[]): CombatEvent | undefined {
  if (!isBlock(event) || event.action_id === null) return undefined;
  return events.find((candidate) => isHit(candidate)
    && candidate.action_id === event.action_id
    && candidate.actor_id === event.target_id
    && candidate.target_id === event.actor_id);
}

export function contactPresentationPlan(
  events: readonly CombatEvent[],
  snapshot: EngineSnapshot,
): readonly ContactPresentation[] {
  return events.map((event, eventIndex) => {
    const { puncherIndex } = contactParticipants(event, snapshot);
    const puncher = snapshot.fighters[puncherIndex];
    const actionParts = puncher?.action_key?.split(":") ?? [];
    const actionDetail = actionParts.length >= 3 ? `${actionParts[0]}:${actionParts[2]}` : event.detail;
    const hit = pairedHit(event, events);
    if (isBlock(event)) {
      return {
        event,
        presentationEvent: {
          ...event,
          detail: hit?.detail || actionDetail,
          direction: hit?.direction ?? puncher?.facing ?? event.direction,
          blood: hit?.blood ?? event.blood,
        },
        presentImpact: true,
      };
    }
    if (pairedBlock(event, events) !== undefined) {
      return { event, presentationEvent: event, presentImpact: false };
    }
    if (event.kind === "knockdown") {
      const hitEvent = events.slice(0, eventIndex).reverse().find((candidate) => isHit(candidate)
        && candidate.tick === event.tick
        && candidate.actor_id === event.actor_id
        && candidate.target_id === event.target_id);
      if (hitEvent !== undefined) {
        return {
          event,
          presentationEvent: {
            ...event,
            detail: hitEvent.detail,
            direction: hitEvent.direction,
            blood: hitEvent.blood,
            action_id: hitEvent.action_id,
          },
          presentImpact: true,
        };
      }
    }
    return { event, presentationEvent: event, presentImpact: true };
  });
}

export function presentationTickFor(snapshot: EngineSnapshot): number {
  return snapshot.result === null ? snapshot.tick - 1 : snapshot.tick;
}

export function arcadeInjuryFor(
  event: CombatEvent,
  target: FighterSnapshot | undefined,
  result: MatchResult | null,
  puncher?: FighterSnapshot,
): ArcadeInjury | null {
  if (!isArcadeInjuryCandidate(event, target, result)) return null;
  const selection = Math.abs(event.event_id);
  if (event.detail.endsWith(":head")) return selection % 2 === 0 ? "decapitation" : "jaw_dislocation";
  const hand = puncher?.action_key?.split(":")[1];
  const recipientSide = hand === "left" ? "right" : hand === "right" ? "left" : Math.floor(selection / 2) % 2 === 0 ? "left" : "right";
  return selection % 2 === 0 ? `dismember_${recipientSide}` : `shoulder_${recipientSide}`;
}
import { buildRing, disposeRing, type BuiltRing } from "./ring";
import { resizeHighDpi } from "./viewport";
import { worldMapping, type WorldMapping } from "./world";

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

const DEFAULT_SIM: SimulationInfo = { tick_rate: 30, ring_half_width: 500, ring_half_height: 500 };

/**
 * Freezes a skinned mesh's current deformed surface into a static geometry
 * expressed relative to `pivot` so it can fly as a rigid severed part.
 */
export function bakeSkinnedPart(mesh: THREE.SkinnedMesh, pivotPosition: THREE.Vector3, pivotQuaternion: THREE.Quaternion): BakedPart {
  const source = mesh.geometry;
  const positions = source.getAttribute("position");
  const baked = new Float32Array(positions.count * 3);
  const vertex = new THREE.Vector3();
  const inverse = pivotQuaternion.clone().invert();
  mesh.updateMatrixWorld(true);
  for (let index = 0; index < positions.count; index += 1) {
    vertex.fromBufferAttribute(positions, index);
    mesh.applyBoneTransform(index, vertex);
    vertex.applyMatrix4(mesh.matrixWorld).sub(pivotPosition).applyQuaternion(inverse);
    baked[index * 3] = vertex.x;
    baked[index * 3 + 1] = vertex.y;
    baked[index * 3 + 2] = vertex.z;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(baked, 3));
  const uv = source.getAttribute("uv");
  if (uv !== undefined) geometry.setAttribute("uv", uv.clone());
  const index = source.getIndex();
  if (index !== null) geometry.setIndex(index.clone());
  geometry.computeVertexNormals();
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const map = material instanceof THREE.MeshStandardMaterial ? material.map : null;
  const color = material instanceof THREE.MeshStandardMaterial ? material.color.getHex() : 0xffffff;
  return { geometry, map, color };
}

function refereeShirtTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    ctx.fillStyle = "#9fb4d8";
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    for (let x = 0; x < 256; x += 8) ctx.fillRect(x, 0, 2, 256);
    ctx.fillStyle = "#1b2230";
    ctx.fillRect(0, 0, 256, 18);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  return texture;
}

function refereeSnapshot(position: THREE.Vector3, yaw: number, velocity: THREE.Vector3, mapping: WorldMapping): { self: FighterSnapshot; focus: FighterSnapshot } {
  const simX = position.x / mapping.x(1);
  const simY = position.z / mapping.z(1);
  const base: FighterSnapshot = {
    player_id: "referee", x: simX, y: simY, facing: 1, facing_x: Math.round(Math.sin(yaw) * 1000), facing_y: Math.round(-Math.cos(yaw) * 1000),
    velocity_x: velocity.x / mapping.x(1) / 30, velocity_y: velocity.z / mapping.z(1) / 30,
    stance: "orthodox", defense: "none", stamina: 1000, maximum_stamina: 1000, conditioning: 1000, guard: 700, poise: 600,
    trauma: { head: 0, body: 0, left_eye: 0, right_eye: 0, left_cut: 0, right_cut: 0, swelling: 0, bleeding: 0 },
    knockdowns: 0, warnings: 0, deductions: 0, stunned_ticks: 0, is_downed: false,
    action: null, action_hand: null, action_target: null, action_power: null, action_id: null, action_key: null,
    action_start_tick: 0, action_startup_ticks: 0, action_active_ticks: 0, action_recovery_ticks: 0, action_contact_tick: null,
    queued_actions: 0, clinch_startup_ticks: 0, clinch_ticks: 0, is_foul_recovery_target: false, taunt_ticks: 0,
    get_up_prompt: null, get_up_meter: 0, get_up_required: 0, get_up_count: 0, get_up_window_start_tick: 0, get_up_window_end_tick: 0,
    last_input_sequence: -1,
  };
  const focus: FighterSnapshot = { ...base, player_id: "focus", x: simX + Math.sin(yaw) * 300, y: simY - Math.cos(yaw) * 300 };
  return { self: base, focus };
}

export class FightRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly composer: EffectComposer;
  private readonly ring: BuiltRing;
  private readonly arena: BuiltArena;
  private referee: BoxingGraph | null = null;
  private readonly refereePosition = new THREE.Vector3(0.4, 0, -2.1);
  private readonly refereeVelocity = new THREE.Vector3();
  private readonly effects: Effects3D;
  private readonly director = new CameraDirector();
  private readonly mapping: WorldMapping;
  private readonly buffer: SnapshotBuffer;
  private readonly localInput: (() => HeldInput | null) | null;
  private readonly localOffset = { dx: 0, dy: 0 };
  private lastManualTime = 0;
  private readonly dedupe = new EventDeduplicator();
  private readonly hudCanvas: HTMLCanvasElement;
  private cameraOverride: { position: THREE.Vector3; lookAt: THREE.Vector3 } | null = null;
  private readonly manualClock: boolean;
  private readonly blobShadows: THREE.Mesh[] = [];
  private readonly blobTexture: THREE.CanvasTexture;
  private readonly lights: THREE.Light[] = [];
  private keyLight: THREE.SpotLight | null = null;
  private followSpot: THREE.SpotLight | null = null;
  private readonly sizeCheck = new THREE.Vector2();
  private readonly refereeAway = new THREE.Vector3();
  private refereeYaw = 0;
  private raf = 0;
  private previous = performance.now();
  private players: Readonly<Record<string, PublicPlayer>> = {};
  private viewerId: string | null = null;
  private final: FinalMessage | null = null;
  private reconnectMs = 0;
  private destroyed = false;
  private graphs: [BoxingGraph, BoxingGraph] | null = null;
  private glbLoading = false;
  private refereeShirt: THREE.CanvasTexture | null = null;
  private graphsReady: Promise<void> = Promise.resolve();
  private readonly headCache = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly headCacheValid = [false, false];
  private readonly arcadeInjuries: [ArcadeInjury | null, ArcadeInjury | null] = [null, null];
  private readonly observedInjuryDown: [boolean, boolean] = [false, false];
  private readonly downedPoolAccumulators: [number, number] = [0, 0];
  private readonly downedPoolCounts: [number, number] = [0, 0];
  private bloodLevel: BloodLevel = "full";
  private readonly pendingContacts: Array<{
    event: CombatEvent;
    presentationEvent: CombatEvent;
    presentImpact: boolean;
    contactTick: number;
    recipientIndex: number;
    puncherIndex: number;
    injury: ArcadeInjury | null;
  }> = [];
  onContact: ((event: CombatEvent) => void) | null = null;
  onArcadeInjury: ((injury: ArcadeInjury, event: CombatEvent) => void) | null = null;
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly tmpHead = new THREE.Vector3();
  private readonly tmpHeadQuaternion = new THREE.Quaternion();
  private readonly tmpStump = new THREE.Vector3();
  private readonly tmpStumpOffset = new THREE.Vector3();
  private readonly tmpStumpQuaternion = new THREE.Quaternion();
  private readonly tmpPart = new THREE.Vector3();
  private readonly tmpPartQuaternion = new THREE.Quaternion();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly simulation: SimulationInfo = DEFAULT_SIM,
    private readonly settings: () => Settings,
    options: { manualClock?: boolean; localInput?: () => HeldInput | null } = {},
  ) {
    this.manualClock = options.manualClock === true;
    this.localInput = options.localInput ?? null;
    this.buffer = new SnapshotBuffer(8, simulation.tick_rate);
    this.mapping = worldMapping(simulation);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: options.manualClock === true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

    this.scene.background = new THREE.Color("#04060b");
    this.scene.fog = new THREE.FogExp2("#04060b", 0.042);
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 80);
    this.camera.position.set(0, 2.05, 5.9);
    this.camera.lookAt(0, 1.05, 0);

    this.setupLights();
    this.ring = buildRing();
    this.scene.add(this.ring.group);
    this.arena = buildArena();
    this.scene.add(this.arena.group);
    this.effects = new Effects3D(this.scene);

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
    const bloom = new UnrealBloomPass(new THREE.Vector2(1280, 720), 0.2, 0.45, 1.08);
    this.composer.addPass(bloom);
    this.composer.addPass(new OutputPass());

    this.hudCanvas = document.createElement("canvas");
    this.hudCanvas.className = "fight-hud";
    this.hudCanvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
    canvas.insertAdjacentElement("afterend", this.hudCanvas);

    this.bloodLevel = settings().blood;
    this.effects.setBloodLevel(this.bloodLevel);
    this.ensureGraphs();
    if (!this.manualClock) this.raf = requestAnimationFrame((time) => this.draw(time));
  }

  private ensureGraphs(): void {
    if (this.glbLoading || this.graphs !== null) return;
    this.glbLoading = true;
    this.graphsReady = loadBoxerGlb()
      .then((gltf) => {
        if (this.destroyed) return;
        const first = new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8 });
        const second = new SkinnedBoxer(gltf, { skin: 0x6e4128, gear: 0xb91c1c });
        this.graphs = [new BoxingGraph(first, this.mapping), new BoxingGraph(second, this.mapping)];
        this.syncInjuryPresentation(0);
        this.syncInjuryPresentation(1);
        this.scene.add(first.root, second.root);
        this.refereeShirt = refereeShirtTexture();
        const official = new SkinnedBoxer(gltf, { skin: 0xc79b76, gear: 0x3b57b8, pants: 0x14161c, bodyMap: this.refereeShirt });
        this.referee = new BoxingGraph(official, this.mapping, { referee: true });
        this.scene.add(official.root);
      })
      .catch((error: unknown) => {
        this.glbLoading = false;
        console.error("boxer_glb_load_failed", error);
      });
  }

  get ready(): Promise<void> {
    return this.graphsReady;
  }

  get labRigs(): THREE.Object3D[] {
    const graphs = this.graphs;
    if (graphs !== null) return [graphs[0].boxer.root, graphs[1].boxer.root];
    return [];
  }

  get labScene(): THREE.Scene {
    return this.scene;
  }

  get labEffects(): Effects3D {
    return this.effects;
  }

  labSetCameraOverride(position: [number, number, number], lookAt: [number, number, number]): void {
    this.cameraOverride = { position: new THREE.Vector3(...position), lookAt: new THREE.Vector3(...lookAt) };
  }

  labFrame(virtualSeconds: number, render = true): void {
    this.draw(virtualSeconds * 1000, true, render);
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
    if (level !== "full" && this.bloodLevel === "full") this.restoreAllInjuries();
    this.bloodLevel = level;
    if (level === "off") this.downedPoolAccumulators.fill(0);
    this.effects.setBloodLevel(level);
  }

  setReducedMotion(reduced: boolean): void {
    if (reduced) {
      this.restoreAllInjuries();
      this.effects.clearDynamic();
    }
  }

  private syncInjuryPresentation(index: number): void {
    const injury = this.arcadeInjuries[index];
    const graphs = this.graphs;
    if (graphs !== null) {
      const graph = graphs[index]!;
      graph.boxer.setDecapitated(injury === "decapitation");
      graph.boxer.setHandDismembered("left", injury === "dismember_left");
      graph.boxer.setHandDismembered("right", injury === "dismember_right");
      const dislocation: ArcadeDislocation | null = injury === "jaw_dislocation"
        ? "jaw"
        : injury === "shoulder_left" || injury === "shoulder_right"
          ? injury
          : null;
      graph.setArcadeDislocation(dislocation);
    }
  }

  private restoreInjury(index: number): void {
    if (this.arcadeInjuries[index] === null) return;
    this.arcadeInjuries[index] = null;
    this.observedInjuryDown[index] = false;
    this.syncInjuryPresentation(index);
    this.effects.restoreFighter(index);
  }

  private restoreAllInjuries(): void {
    this.restoreInjury(0);
    this.restoreInjury(1);
    this.effects.clearArcadeGore();
  }

  private headWorldPose(index: number): { position: THREE.Vector3; quaternion: THREE.Quaternion } | null {
    const graphs = this.graphs;
    const head = graphs !== null ? graphs[index]!.boxer.bone("head") : null;
    if (head === null || graphs === null) return null;
    graphs[index]!.boxer.root.updateMatrixWorld(true);
    head.getWorldPosition(this.tmpHead);
    head.getWorldQuaternion(this.tmpHeadQuaternion);
    this.tmpStumpOffset.set(0, 0.12, 0.02).applyQuaternion(this.tmpHeadQuaternion);
    this.tmpHead.add(this.tmpStumpOffset);
    return { position: this.tmpHead, quaternion: this.tmpHeadQuaternion };
  }

  private handWorldPose(
    index: number,
    side: "left" | "right",
  ): { position: THREE.Vector3; quaternion: THREE.Quaternion } | null {
    const graphs = this.graphs;
    const hand = graphs !== null ? graphs[index]!.boxer.bone(side === "left" ? "gloveL" : "gloveR") : null;
    if (hand === null || graphs === null) return null;
    graphs[index]!.boxer.root.updateMatrixWorld(true);
    hand.getWorldPosition(this.tmpPart);
    hand.getWorldQuaternion(this.tmpPartQuaternion);
    return { position: this.tmpPart, quaternion: this.tmpPartQuaternion };
  }

  private gearColor(index: number): number {
    return this.graphs?.[index]?.boxer.gearBaseColor.getHex() ?? 0x1d4ed8;
  }

  private skinColor(index: number): number {
    return this.graphs?.[index]?.boxer.skinBaseColor.getHex() ?? 0xb0703f;
  }

  private stumpWorldPose(index: number): { position: THREE.Vector3; quaternion: THREE.Quaternion } | null {
    const graphs = this.graphs;
    const anchor = graphs !== null ? graphs[index]!.boxer.bone("Neck_012") : null;
    if (anchor === null || graphs === null) return null;
    graphs[index]!.boxer.root.updateMatrixWorld(true);
    anchor.getWorldPosition(this.tmpStump);
    anchor.getWorldQuaternion(this.tmpStumpQuaternion);
    return { position: this.tmpStump, quaternion: this.tmpStumpQuaternion };
  }

  predictAction(action: SemanticAction): void {
    const latest = this.buffer.latest();
    if (latest === null || this.viewerId === null) return;
    const index = latest.fighters.findIndex((fighter) => fighter.player_id === this.viewerId);
    if (index < 0) return;
    this.graphs?.[index]?.predict(action, performance.now() / 1000, this.simulation.tick_rate);
  }

  push(snapshot: EngineSnapshot): void {
    if (!this.buffer.push(snapshot, this.manualClock ? this.lastManualTime : performance.now())) return;
    const accepted = this.dedupe.accept(snapshot.events);
    for (const { event, presentationEvent, presentImpact } of contactPresentationPlan(accepted, snapshot)) {
      const targetIndex = snapshot.fighters.findIndex((fighter) => fighter.player_id === event.target_id);
      const actorIndex = snapshot.fighters.findIndex((fighter) => fighter.player_id === event.actor_id);
      const { recipientIndex, puncherIndex } = contactParticipants(event, snapshot);
      const recipient = snapshot.fighters[recipientIndex]
        ?? snapshot.fighters[targetIndex]
        ?? snapshot.fighters[actorIndex]
        ?? snapshot.fighters[0];
      this.tmpA.set(this.mapping.x(recipient.x), 0, this.mapping.z(recipient.y));
      if (["hit", "counter_hit", "block", "perfect_block", "guard_break", "knockdown"].includes(event.kind)) {
        const puncher = puncherIndex >= 0 ? snapshot.fighters[puncherIndex]! : null;
        this.pendingContacts.push({
          event,
          presentationEvent,
          presentImpact,
          contactTick: puncher?.action_contact_tick ?? event.tick,
          recipientIndex,
          puncherIndex,
          injury: arcadeInjuryFor(event, snapshot.fighters[recipientIndex], snapshot.result, puncher ?? undefined),
        });
      } else if (event.kind === "bleed") {
        this.effects.addEvent(event, this.tmpA, this.settings().reducedMotion);
      }
    }
  }

  private fireContacts(sampledTick: number): void {
    for (let index = 0; index < this.pendingContacts.length;) {
      const pending = this.pendingContacts[index]!;
      if (pending.contactTick > sampledTick) {
        index += 1;
        continue;
      }
      this.pendingContacts.splice(index, 1);
      const { event, presentationEvent, presentImpact, recipientIndex, puncherIndex, injury } = pending;
      const target = this.buffer.latest()?.fighters[recipientIndex];
      if (presentImpact && target !== undefined) {
        this.tmpA.set(this.mapping.x(target.x), 0, this.mapping.z(target.y));
        this.effects.addEvent(presentationEvent, this.tmpA, this.settings().reducedMotion);
      }
      const currentSettings = this.settings();
      if (
        injury !== null
        && recipientIndex >= 0
        && this.arcadeInjuries[recipientIndex] === null
        && currentSettings.blood === "full"
        && !currentSettings.reducedMotion
      ) {
        let applied = this.graphs !== null
          && (injury === "jaw_dislocation" || injury === "shoulder_left" || injury === "shoulder_right");
        if (injury === "decapitation") {
          const pose = this.headWorldPose(recipientIndex);
          if (pose !== null) {
            const graph = this.graphs?.[recipientIndex];
            const baked = graph === undefined ? undefined : bakeSkinnedPart(graph.boxer.headMesh, pose.position, pose.quaternion);
            this.effects.decapitate(
              recipientIndex,
              pose.position,
              pose.quaternion,
              event.direction,
              event.event_id,
              this.skinColor(recipientIndex),
              baked,
            );
            const stumpPose = this.stumpWorldPose(recipientIndex);
            if (stumpPose !== null) this.effects.anchorStump(recipientIndex, stumpPose.position, stumpPose.quaternion);
            applied = true;
          }
        } else if (injury === "dismember_left" || injury === "dismember_right") {
          const side = injury === "dismember_left" ? "left" : "right";
          const pose = this.handWorldPose(recipientIndex, side);
          if (pose !== null) {
            const graph = this.graphs?.[recipientIndex];
            const baked = graph === undefined ? undefined : bakeSkinnedPart(graph.boxer.gloveMesh(side), pose.position, pose.quaternion);
            this.effects.dismemberHand(
              recipientIndex,
              side,
              pose.position,
              pose.quaternion,
              event.direction,
              event.event_id,
              this.gearColor(recipientIndex),
              baked,
            );
            this.effects.anchorHandStump(recipientIndex, side, pose.position, pose.quaternion);
            applied = true;
          }
        }
        if (applied) {
          this.arcadeInjuries[recipientIndex] = injury;
          this.observedInjuryDown[recipientIndex] = false;
          this.syncInjuryPresentation(recipientIndex);
          this.onArcadeInjury?.(injury, event);
        }
      }
      const graphs = this.graphs;
      if (
        presentImpact
        && recipientIndex >= 0
        && ["hit", "counter_hit", "knockdown"].includes(event.kind)
        && presentationEvent.detail.endsWith(":head")
        && event.amount >= 260
        && !currentSettings.reducedMotion
        && currentSettings.blood !== "off"
      ) {
        const pose = this.headWorldPose(recipientIndex);
        if (pose !== null) {
          this.tmpB.set(0, -0.07, 0.1).applyQuaternion(pose.quaternion).add(pose.position);
          this.effects.spawnTeeth(this.tmpB, presentationEvent.direction, event.kind === "knockdown" ? 3 : 1 + Math.floor((event.amount - 260) / 120), event.event_id);
        }
      }
      if (
        presentImpact
        && recipientIndex >= 0
        && ["hit", "counter_hit", "block", "perfect_block", "knockdown"].includes(event.kind)
      ) {
        const blocked = event.kind === "block" || event.kind === "perfect_block";
        const targetKind = presentationEvent.detail.endsWith(":body") ? "body" : "head";
        if (graphs !== null) {
          const puncher = puncherIndex >= 0 ? this.buffer.latest()?.fighters[puncherIndex] : undefined;
          const keyParts = puncher?.action_key?.split(":") ?? [];
          const punchClass = (keyParts[0] ?? presentationEvent.detail.split(":")[0] ?? null) as PunchClass | null;
          const punchHand = (keyParts[1] ?? null) as Hand | null;
          graphs[recipientIndex]!.react(blocked ? "block" : "hit", targetKind, presentationEvent.direction, punchClass, punchHand, event.amount);
        }
      }
      if (
        presentImpact
        && puncherIndex >= 0
        && ["hit", "counter_hit", "block", "perfect_block", "guard_break"].includes(event.kind)
      ) {
        graphs?.[puncherIndex]?.landedHit(event.kind === "block" || event.kind === "perfect_block");
      }
      this.onContact?.(event);
    }
  }

  private setupLights(): void {
    const hemisphere = new THREE.HemisphereLight("#3c4a72", "#07080c", 0.55);
    this.scene.add(hemisphere);
    this.lights.push(hemisphere);

    const key = new THREE.SpotLight("#fff1dc", 190, 24, 0.56, 0.55, 1.7);
    key.position.set(0.6, 7.4, 1.2);
    key.target.position.set(0, 0.6, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004;
    key.shadow.camera.near = 3;
    key.shadow.camera.far = 14;
    this.keyLight = key;
    this.scene.add(key, key.target);
    this.lights.push(key);

    const secondary = new THREE.SpotLight("#ffe6c8", 95, 24, 0.6, 0.6, 1.7);
    secondary.position.set(-2.6, 7.0, -2.2);
    secondary.target.position.set(0, 0.8, 0);
    this.scene.add(secondary, secondary.target);
    this.lights.push(secondary);

    const rims: Array<[string, number, number, number]> = [
      ["#8fa8ff", -5.5, 3.8, -5.4],
      ["#7f95e8", 5.6, 3.6, -5.6],
    ];
    for (const [color, x, y, z] of rims) {
      const rim = new THREE.SpotLight(color, 34, 30, 0.72, 0.9, 1.8);
      rim.position.set(x, y, z);
      rim.target.position.set(0, 1.2, 0);
      this.scene.add(rim, rim.target);
      this.lights.push(rim);
    }

    const follow = new THREE.SpotLight("#ffe8d0", 48, 22, 0.32, 0.8, 1.5);
    follow.position.set(0, 5.8, 5.4);
    follow.target.position.set(0, 1, 0);
    this.scene.add(follow, follow.target);
    this.lights.push(follow);
    this.followSpot = follow;
  }

  private draw(time: number, manual = false, render = true): void {
    if (this.destroyed) return;
    const dt = manual ? 1 / 60 : Math.min(0.05, Math.max(0.001, (time - this.previous) / 1000));
    this.previous = time;

    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width > 0 && height > 0) {
      this.renderer.getSize(this.sizeCheck);
      if (this.sizeCheck.x !== width || this.sizeCheck.y !== height) {
        this.renderer.setSize(width, height, false);
        this.composer.setSize(width, height);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
      }
    }

    const seconds = time / 1000;
    if (manual) this.lastManualTime = time;
    const current = this.settings();
    this.setBloodLevel(current.blood);

    const latest = this.buffer.latest();
    const sampledTick = latest === null ? 0 : manual ? presentationTickFor(latest) : this.buffer.renderTick(time);
    const snapshot = latest === null ? null : this.applyLocalPrediction(this.buffer.sample(sampledTick), dt);
    let separation = 1.8;
    let knockdown = false;
    if (snapshot !== null) {
      const [a, b] = snapshot.fighters;
      for (const [index, fighter] of snapshot.fighters.entries()) {
        if (this.arcadeInjuries[index] === null) continue;
        if (fighter.is_downed) this.observedInjuryDown[index] = true;
        else if (this.observedInjuryDown[index] && snapshot.result === null) this.restoreInjury(index);
      }
      const graphs = this.graphs;
      if (graphs !== null) {
        const headA = this.headCacheValid[0] ? this.headCache[0] : undefined;
        const headB = this.headCacheValid[1] ? this.headCache[1] : undefined;
        graphs[0].update(a, b, dt, seconds, current.reducedMotion, current.blood, sampledTick, headB);
        graphs[1].update(b, a, dt, seconds, current.reducedMotion, current.blood, sampledTick, headA);
        for (const [index, graph] of graphs.entries()) {
          const headBone = graph.boxer.bone("head");
          if (headBone !== null) {
            graph.boxer.root.updateMatrixWorld(true);
            headBone.getWorldPosition(this.headCache[index]!);
            this.headCacheValid[index] = true;
          }
        }
      }
      for (let index = 0; index < this.arcadeInjuries.length; index += 1) {
        const injury = this.arcadeInjuries[index];
        if (injury === "decapitation") {
          const pose = this.stumpWorldPose(index);
          if (pose !== null) this.effects.anchorStump(index, pose.position, pose.quaternion);
        } else if (injury === "dismember_left" || injury === "dismember_right") {
          const side = injury === "dismember_left" ? "left" : "right";
          const pose = this.handWorldPose(index, side);
          if (pose !== null) this.effects.anchorHandStump(index, side, pose.position, pose.quaternion);
        }
      }
      const ax = this.mapping.x(a.x);
      const az = this.mapping.z(a.y);
      const bx = this.mapping.x(b.x);
      const bz = this.mapping.z(b.y);
      separation = Math.hypot(ax - bx, az - bz);
      knockdown = a.is_downed || b.is_downed;
      this.tmpA.set(ax, 0, az);
      this.tmpB.set(bx, 0, bz);
      for (const [index, fighter] of snapshot.fighters.entries()) {
        const severity = (fighter.trauma.bleeding + fighter.trauma.left_cut + fighter.trauma.right_cut) / 380;
        if (severity > 0.05 && !fighter.is_downed) {
          this.downedPoolAccumulators[index] = 0;
          const anchor = index === 0 ? this.tmpA : this.tmpB;
          this.tmpHead.set(anchor.x, this.headHeightOf(index), anchor.z);
          this.effects.drip(this.tmpHead, severity, current.reducedMotion, index);
        } else if (severity > 0.3 && fighter.is_downed && current.blood !== "off") {
          this.effects.stopDrip(index);
          this.downedPoolAccumulators[index]! += dt * 0.8;
          while (this.downedPoolAccumulators[index]! >= 1) {
            this.downedPoolAccumulators[index]! -= 1;
            const count = this.downedPoolCounts[index]!;
            this.downedPoolCounts[index] = count + 1;
            const angle = count * 2.399_963 + index * Math.PI;
            const radius = 0.12 + ((count * 0.618_034) % 1) * 0.24;
            const anchor = index === 0 ? this.tmpA : this.tmpB;
            this.effects.pool(anchor.x + Math.sin(angle) * radius, anchor.z + Math.cos(angle) * radius, 0.8);
          }
        } else {
          this.effects.stopDrip(index);
          this.downedPoolAccumulators[index] = 0;
        }
      }
    } else {
      this.tmpA.set(-0.9, 0, 0);
      this.tmpB.set(0.9, 0, 0);
    }

    this.arena.update(seconds, dt, current.reducedMotion);
    this.effects.update(dt);
    this.updateReferee(dt, seconds, snapshot, sampledTick);
    this.updateBlobShadows();
    this.fireContacts(sampledTick);
    if (this.followSpot !== null) {
      this.followSpot.target.position.set((this.tmpA.x + this.tmpB.x) / 2, 1.0, (this.tmpA.z + this.tmpB.z) / 2);
    }
    const frame = this.cameraOverride ?? this.director.update(
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

    if (render) {
      this.composer.render();
      this.drawHudOverlay(snapshot);
    }

    if (!this.destroyed && !this.manualClock) this.raf = requestAnimationFrame((next) => this.draw(next));
  }

  private applyLocalPrediction(snapshot: EngineSnapshot | null, dt: number): EngineSnapshot | null {
    if (snapshot === null || this.localInput === null || this.viewerId === null) return snapshot;
    const index = snapshot.fighters.findIndex((fighter) => fighter.player_id === this.viewerId);
    const held = this.localInput();
    const rate = 1 - Math.exp(-14 * dt);
    let target = { dx: 0, dy: 0 };
    if (index >= 0 && held !== null && snapshot.phase === "fight") {
      target = predictMovement(snapshot.fighters[index]!, held, this.buffer.interpolationDelayTicks + 2);
    }
    this.localOffset.dx += (target.dx - this.localOffset.dx) * rate;
    this.localOffset.dy += (target.dy - this.localOffset.dy) * rate;
    if (index < 0 || (Math.abs(this.localOffset.dx) < 0.01 && Math.abs(this.localOffset.dy) < 0.01)) return snapshot;
    const viewer = snapshot.fighters[index]!;
    const predicted = { ...viewer, x: viewer.x + this.localOffset.dx, y: viewer.y + this.localOffset.dy };
    const fighters: [FighterSnapshot, FighterSnapshot] = index === 0 ? [predicted, snapshot.fighters[1]] : [snapshot.fighters[0], predicted];
    return { ...snapshot, fighters };
  }

  private headHeightOf(index: number): number {
    return (this.graphs?.[index]?.boxer.metrics.headRestY ?? 1.52) + 0.04;
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

  private updateReferee(dt: number, time: number, snapshot: EngineSnapshot | null, sampledTick: number): void {
    const referee = this.referee;
    if (referee === null) return;
    const downed = snapshot?.fighters.find((fighter) => fighter.is_downed) ?? null;
    const focusX = downed !== null ? this.mapping.x(downed.x) : (this.tmpA.x + this.tmpB.x) / 2;
    const focusZ = downed !== null ? this.mapping.z(downed.y) : (this.tmpA.z + this.tmpB.z) / 2;
    const away = this.refereeAway.set(this.refereePosition.x - focusX, 0, this.refereePosition.z - focusZ);
    if (away.lengthSq() < 0.01) away.set(0, 0, -1);
    away.normalize();
    const standoff = downed !== null ? 1.25 : 2.05;
    const targetX = THREE.MathUtils.clamp(focusX + away.x * standoff, -2.4, 2.4);
    const targetZ = THREE.MathUtils.clamp(focusZ + away.z * standoff, -2.4, 2.4);
    const previousX = this.refereePosition.x;
    const previousZ = this.refereePosition.z;
    const rate = 1 - Math.exp(-1.6 * dt);
    this.refereePosition.x += (targetX - this.refereePosition.x) * rate;
    this.refereePosition.z += (targetZ - this.refereePosition.z) * rate;
    for (const fighter of [this.tmpA, this.tmpB]) {
      const dx = this.refereePosition.x - fighter.x;
      const dz = this.refereePosition.z - fighter.z;
      const distance = Math.hypot(dx, dz);
      const clearance = downed !== null ? 1.0 : 1.45;
      if (distance < clearance && distance > 0.001) {
        this.refereePosition.x = fighter.x + (dx / distance) * clearance;
        this.refereePosition.z = fighter.z + (dz / distance) * clearance;
      }
    }
    if (dt > 0) {
      this.refereeVelocity.set((this.refereePosition.x - previousX) / dt, 0, (this.refereePosition.z - previousZ) / dt);
    }
    const yaw = Math.atan2(focusX - this.refereePosition.x, focusZ - this.refereePosition.z);
    const yawDelta = ((yaw - this.refereeYaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    this.refereeYaw += yawDelta * (1 - Math.exp(-3 * dt));
    const state = refereeSnapshot(this.refereePosition, this.refereeYaw, this.refereeVelocity, this.mapping);
    referee.setRefereeCount(downed !== null, downed?.get_up_count ?? 0);
    referee.update(state.self, state.focus, dt, time, false, "off", sampledTick);
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
    this.pendingContacts.length = 0;
    this.effects.dispose();
    this.arena.dispose();
    disposeRing(this.ring);
    if (this.graphs !== null) {
      for (const graph of this.graphs) {
        this.scene.remove(graph.boxer.root);
        graph.dispose();
      }
      this.graphs = null;
    }
    if (this.referee !== null) {
      this.scene.remove(this.referee.boxer.root);
      this.referee.dispose();
      this.referee = null;
    }
    this.refereeShirt?.dispose();
    for (const light of this.lights) this.scene.remove(light);
    this.keyLight?.shadow.map?.dispose();
    this.keyLight?.shadow.dispose();
    this.renderer.renderLists.dispose();
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
