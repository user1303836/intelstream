import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { EventDeduplicator, SnapshotBuffer } from "../interpolation";
import { coarsePointer } from "../input/touch";
import { FIGHTER_RADIUS, REST_CORNER_OFFSET, RING_HALF_HEIGHT, RING_HALF_WIDTH, punchTiming } from "../manifest";
import { canAffordPunch, predictMovement, predictedPunchTiming, type HeldInput } from "../prediction";
import type { BloodLevel, Settings } from "../settings";
import type { CombatEvent, EngineSnapshot, FighterSnapshot, FinalMessage, Hand, MatchResult, PublicPlayer, PunchClass, SemanticAction, SimulationInfo } from "../types";
import { buildArena, type BuiltArena } from "./arena";
import { CameraDirector, CUTMAN_WORK_DEGREES, CUTMAN_WORK_DISTANCE, SECONDS_OUT, ceremonyShot, cornerFrame, cornerPoint, cornerShot, cornerShotProgress } from "./camera";
import { Avatars } from "./avatars";
import { Effects3D, type BakedPart } from "./effects";
import { BoxingGraph, SkinnedBoxer, loadBoxerGlb, type ArcadeDislocation } from "./graph";
import { drawHud, finalRevealDelay, resultCard, resultCardLayout, RoundStatsTracker, STOPPAGE_METHODS, RoundClock, type RoundPunchStats } from "./hud";
import { BURST_CUT_HEIGHT, EYE_LIDS, NECK_CUT_DEPTH, NECK_CUT_HEIGHT, NECK_CUT_SLOPE } from "./injury";
import { BIG_SHOT, closeCut, cutRim, teethFor } from "./gore";
import { mouthpieceFlies } from "./mouthpiece";
import { OFFICIAL_LOOKS, lookFor } from "./looks";
import { BLUE_CORNER_OUTFIT, CUTMAN_OUTFIT, RED_CORNER_OUTFIT, REFEREE_OUTFIT } from "./outfit";
import { ResolutionScaler } from "./quality";
import { planKnockoutReplay, replayTick, type ReplayPlan } from "./replay";
import { GloveTrail } from "./trails";

export type ArcadeInjury =
  | "decapitation"
  | "head_burst"
  | "eye_left"
  | "eye_right"
  | "dismember_left"
  | "dismember_right"
  | "jaw_dislocation"
  | "shoulder_left"
  | "shoulder_right";

/** Whether the corners are at work: through the rest until the seconds are called out before the bell. */
export function cornersAtWork(snapshot: Pick<EngineSnapshot, "phase" | "phase_ticks_remaining"> | null, tickRate: number): boolean {
  return snapshot !== null && snapshot.phase === "rest" && snapshot.phase_ticks_remaining > SECONDS_OUT * tickRate;
}

export type BoutEnding = Pick<MatchResult, "finish_method" | "winner_id">;

/**
 * Whether a blow earns an arcade finisher: only the one that ends the bout. A fighter who is going to
 * get up keeps his head; the punch that floors a man for the count earns it in the knockout replay.
 */
export function isArcadeInjuryCandidate(
  event: CombatEvent,
  target: FighterSnapshot | undefined,
  result: BoutEnding | null,
): boolean {
  const anatomicalTarget = event.detail.endsWith(":head") || event.detail.endsWith(":body");
  if (target === undefined || !["hit", "counter_hit"].includes(event.kind) || !anatomicalTarget) return false;
  if (result === null || result.winner_id === null || result.winner_id !== event.actor_id) return false;
  if (result.finish_method === "flash_ko") return true;
  return (result.finish_method === "ko" || result.finish_method === "tko") && target.is_downed;
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
const HISTORY_LIMIT = 480;
const LOW_TIER_SCALE = 0.56;
const ROUND_CALLOUT_SECONDS = 1.8;
const FINISH_CLOSE_UP_SECONDS = 1.7;
const CORNERMAN_APRON_DISTANCE = 3.42;
/** Close cameras stay inside the rope line (posts stand at 2.46 m) so a rope never fills the lens. */
const TIGHT_SHOT_LIMIT = 2.2;
/** How far the referee keeps from a head on the canvas. */
const HEAD_CLEARANCE = 0.9;
/** How far from someone on their feet a close-up has to pass to see past them. */
const STANDING_BLOCK_RADIUS = 0.5;
/** The engine lets fighters stand 76 units apart, which puts two drawn bodies inside each other. */
const DRAWN_MINIMUM_GAP = 104;
const CORNERMAN_WORK_DISTANCE = 2.95;
const CUTMAN_WALK_SECONDS = 1.6;
const CUTMAN_IN_PLACE = 0.98;
// Broadcast finish: a soft vignette and a whisper of grain, applied before tone mapping.
const BROADCAST_FINISH_SHADER = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVignette: { value: 0.32 }, uGrain: { value: 0.035 } },
  vertexShader: `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
  fragmentShader: `
uniform sampler2D tDiffuse;
uniform float uTime;
uniform float uVignette;
uniform float uGrain;
varying vec2 vUv;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7)) + uTime * 43.7) * 43758.5453);
}
void main() {
  vec4 color = texture2D(tDiffuse, vUv);
  vec2 centered = vUv - 0.5;
  float falloff = smoothstep(0.35, 0.95, dot(centered, centered) * 2.2);
  color.rgb *= 1.0 - falloff * uVignette;
  float grain = (hash(floor(vUv * vec2(960.0, 540.0))) - 0.5) * uGrain;
  color.rgb += grain * (0.15 + color.rgb);
  gl_FragColor = color;
}`,
};
/** Where the fighters stand for the decision, in engine units: either side of the referee, facing the camera. */
export const CEREMONY_MARKS = [{ x: -102, y: -16 }, { x: 102, y: -16 }] as const;
const CEREMONY_REFEREE = { x: 0, z: -0.2 } as const;
const ANNOUNCEMENT_ROPE_OPACITY = 0;
const CEREMONY_WALK_SPEED = 200;
const CEREMONY_REFEREE_SPEED = 1.3;
const CEREMONY_PAUSE_SECONDS = 0.7;
/** The card comes up with the raised arm, and no later than this after the final bell. */
const CEREMONY_REVEAL_LIMIT_SECONDS = 4.5;

/** One step of a walk to a mark at no more than `reach`; `arrived` once it is on the mark. */
export function ceremonyStep(x: number, y: number, mark: { readonly x: number; readonly y: number }, reach: number): { x: number; y: number; arrived: boolean } {
  const dx = mark.x - x;
  const dy = mark.y - y;
  const distance = Math.hypot(dx, dy);
  if (distance <= Math.max(reach, 1e-6)) return { x: mark.x, y: mark.y, arrived: true };
  return { x: x + (dx / distance) * reach, y: y + (dy / distance) * reach, arrived: false };
}

interface Ceremony {
  readonly winnerSeat: 0 | 1 | null;
  /** Where the fighters are drawn, once the walk to the marks has begun. */
  positions: [{ x: number; y: number }, { x: number; y: number }] | null;
  refereeArrived: boolean;
  arrivedAt: number | null;
  announced: boolean;
}

/** The crowd stays on its feet from the result until the replay and the verdict have played out. */
const CROWD_OVATION_SECONDS = 16;
const CROWD_OVATION_RATE = 0.6;
const CROWD_EXCITEMENT: Readonly<Record<string, number>> = { hit: 0.18, counter_hit: 0.3, guard_break: 0.25, knockdown: 1, block: 0.04, perfect_block: 0.1 };

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
  result: BoutEnding | null,
  puncher?: FighterSnapshot,
): ArcadeInjury | null {
  if (!isArcadeInjuryCandidate(event, target, result)) return null;
  const selection = Math.abs(event.event_id);
  if (event.detail.endsWith(":head")) {
    // A flash knockout or a big counter bursts the head.
    if (result?.finish_method === "flash_ko" || (event.kind === "counter_hit" && event.amount >= BIG_SHOT)) return "head_burst";
    const key = puncher?.action_key?.split(":");
    const punch = event.detail.split(":").find((part) => ["jab", "straight", "hook", "uppercut"].includes(part)) ?? key?.[0];
    if (punch === "hook" && selection % 2 === 1) {
      // A hook drives the eye on the side it lands out of its socket.
      const struck = key?.[1] === "left" ? "right" : key?.[1] === "right" ? "left" : Math.floor(selection / 2) % 2 === 0 ? "left" : "right";
      return `eye_${struck}`;
    }
    return selection % 2 === 0 ? "decapitation" : "jaw_dislocation";
  }
  const hand = puncher?.action_key?.split(":")[1];
  const recipientSide = hand === "left" ? "right" : hand === "right" ? "left" : Math.floor(selection / 2) % 2 === 0 ? "left" : "right";
  return selection % 2 === 0 ? `dismember_${recipientSide}` : `shoulder_${recipientSide}`;
}
import { buildRing, disposeRing, nearRopeOpacityFor, type BuiltRing } from "./ring";
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

/** A severed head turns about the middle of the skull: this far from the head bone, in the bone's frame. */
const HEAD_PIVOT_OFFSET = new THREE.Vector3(0, 0.12, 0.02);
const UP = new THREE.Vector3(0, 1, 0);
const neckRims = new WeakMap<THREE.BufferGeometry, number[]>();

/** The edges of a head mesh along the cut through the neck. Every fighter shares the one mesh. */
function neckRim(geometry: THREE.BufferGeometry): number[] {
  let rim = neckRims.get(geometry);
  if (rim === undefined) {
    rim = cutRim(geometry, aboveNeckCut);
    neckRims.set(geometry, rim);
  }
  return rim;
}

/** True for the part of the head mesh a burst takes away: everything above the jaw, below the deepest dip of its ragged edge. */
export function aboveBurstCut(bind: THREE.Vector3): boolean {
  return bind.y > BURST_CUT_HEIGHT - 1.4;
}

const burstRims = new WeakMap<THREE.BufferGeometry, number[]>();

/** The edges of a head mesh round what a burst leaves on the neck. */
function burstRim(geometry: THREE.BufferGeometry): number[] {
  let rim = burstRims.get(geometry);
  if (rim === undefined) {
    rim = cutRim(geometry, aboveBurstCut);
    burstRims.set(geometry, rim);
  }
  return rim;
}

/**
 * What a burst leaves on the neck, measured on the skin as it is posed: the middle of the opening,
 * facing up the head, the head's own sideways axis so the jaw's teeth stay at the front, and the
 * edge, both ends of each of its edges in turn, written into `rim` (or a new array of the right size).
 */
export function measureBurstStump(
  boxer: SkinnedBoxer,
  rim: Float32Array<ArrayBuffer>,
  out: { readonly position: THREE.Vector3; readonly quaternion: THREE.Quaternion; readonly across: THREE.Vector3; readonly scratch: THREE.Vector3 },
): Float32Array<ArrayBuffer> | null {
  const head = boxer.bone("head");
  if (head === null) return null;
  boxer.root.updateMatrixWorld(true);
  const mesh = boxer.headMesh;
  const edges = burstRim(mesh.geometry);
  if (edges.length === 0) return null;
  const written = rim.length === edges.length * 3 ? rim : new Float32Array(edges.length * 3);
  const bind = mesh.geometry.getAttribute("position");
  out.position.set(0, 0, 0);
  for (const [at, corner] of edges.entries()) {
    mesh.applyBoneTransform(corner, out.scratch.fromBufferAttribute(bind, corner)).applyMatrix4(mesh.matrixWorld);
    out.scratch.toArray(written, at * 3);
    out.position.add(out.scratch);
  }
  out.position.multiplyScalar(1 / edges.length);
  head.getWorldQuaternion(out.quaternion);
  out.across.set(1, 0, 0).applyQuaternion(out.quaternion);
  out.scratch.set(0, 1, 0).applyQuaternion(out.quaternion);
  out.quaternion.setFromUnitVectors(UP, out.scratch);
  return written;
}

/** The place nearest to (x, z) that is at least `clearance` from (fromX, fromZ). */
export function keepClear(x: number, z: number, fromX: number, fromZ: number, clearance: number): { x: number; z: number } {
  const distance = Math.hypot(x - fromX, z - fromZ);
  if (distance >= clearance) return { x, z };
  if (distance < 1e-6) return { x: fromX, z: fromZ - clearance };
  return { x: fromX + ((x - fromX) / distance) * clearance, z: fromZ + ((z - fromZ) / distance) * clearance };
}

export interface Blocker {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

const CLOSE_UP_TURNS = [0, 1.05, -1.05, 2.1, -2.1, Math.PI] as const;

/**
 * Bearing from a head to the camera for its close-up. The camera goes to the side the face points
 * to when the face points sideways, and otherwise to `fallback`. A side is passed over when the
 * ropes leave no room to stand back, or when someone stands in it or in the way of the shot.
 */
export function closeUpAngle(
  x: number,
  z: number,
  facing: { readonly x: number; readonly y: number; readonly z: number } | null,
  reach: number,
  limit: number,
  fallback: number,
  blockers: readonly Blocker[] = [],
): number {
  const level = facing === null ? 0 : Math.hypot(facing.x, facing.z);
  const sides = facing !== null && level >= 0.35 ? [Math.atan2(facing.x, facing.z)] : [];
  for (const turn of CLOSE_UP_TURNS) sides.push(fallback + turn);
  for (const side of sides) {
    const cameraX = THREE.MathUtils.clamp(x + Math.sin(side) * reach, -limit, limit);
    const cameraZ = THREE.MathUtils.clamp(z + Math.cos(side) * reach, -limit, limit);
    const length = Math.hypot(cameraX - x, cameraZ - z);
    if (length < reach * 0.7) continue;
    const blocked = blockers.some((blocker) => {
      // Nearest point of the shot to the blocker, from just off the head to the camera.
      const along = THREE.MathUtils.clamp(((blocker.x - x) * (cameraX - x) + (blocker.z - z) * (cameraZ - z)) / (length * length), 0.25, 1);
      return Math.hypot(x + (cameraX - x) * along - blocker.x, z + (cameraZ - z) * along - blocker.z) < blocker.radius;
    });
    if (!blocked) return side;
  }
  return fallback;
}

/**
 * Positions for drawing two fighters the engine has closer than `minimum`: both step back along the
 * line between them. One held by the ropes stays, and the other gives the whole way. Null when they
 * are already far enough apart.
 */
export function visualSeparation(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  minimum: number,
  limitX: number,
  limitY: number,
): { ax: number; ay: number; bx: number; by: number } | null {
  const gap = Math.hypot(bx - ax, by - ay);
  if (gap >= minimum) return null;
  const ux = gap < 1e-6 ? 1 : (bx - ax) / gap;
  const uy = gap < 1e-6 ? 0 : (by - ay) / gap;
  const inside = (x: number, y: number): boolean => Math.abs(x) <= limitX && Math.abs(y) <= limitY;
  const back = (minimum - gap) / 2;
  const aFree = inside(ax - ux * back, ay - uy * back);
  const bFree = inside(bx + ux * back, by + uy * back);
  const aBack = aFree ? (bFree ? back : back * 2) : 0;
  const bBack = bFree ? (aFree ? back : back * 2) : 0;
  const clamp = THREE.MathUtils.clamp;
  return {
    ax: clamp(ax - ux * aBack, -limitX, limitX),
    ay: clamp(ay - uy * aBack, -limitY, limitY),
    bx: clamp(bx + ux * bBack, -limitX, limitX),
    by: clamp(by + uy * bBack, -limitY, limitY),
  };
}

/** True for the part of the head mesh that leaves with the head. */
export function aboveNeckCut(bind: THREE.Vector3): boolean {
  return bind.y > NECK_CUT_HEIGHT - NECK_CUT_SLOPE * (bind.z - NECK_CUT_DEPTH) - 0.3;
}

const DEFAULT_SIM: SimulationInfo = { tick_rate: 30, ring_half_width: 500, ring_half_height: 500 };

/**
 * Freezes a skinned mesh's current deformed surface into a static geometry
 * expressed relative to `pivot` so it can fly as a rigid severed part.
 */
export function bakeSkinnedPart(
  mesh: THREE.SkinnedMesh,
  pivotPosition: THREE.Vector3,
  pivotQuaternion: THREE.Quaternion,
  keep?: (bind: THREE.Vector3) => boolean,
): BakedPart {
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
  geometry.setAttribute("bindPosition", positions.clone());
  const uv = source.getAttribute("uv");
  if (uv !== undefined) geometry.setAttribute("uv", uv.clone());
  const index = source.getIndex();
  if (index !== null && keep !== undefined) {
    const kept: number[] = [];
    const held = new Uint8Array(positions.count);
    for (let at = 0; at < positions.count; at += 1) held[at] = keep(vertex.fromBufferAttribute(positions, at)) ? 1 : 0;
    for (let at = 0; at < index.count; at += 3) {
      const a = index.getX(at), b = index.getX(at + 1), c = index.getX(at + 2);
      if (held[a] === 1 && held[b] === 1 && held[c] === 1) kept.push(a, b, c);
    }
    geometry.setIndex(kept);
  } else if (index !== null) geometry.setIndex(index.clone());
  geometry.computeVertexNormals();
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const map = material instanceof THREE.MeshStandardMaterial ? material.map : null;
  const color = material instanceof THREE.MeshStandardMaterial ? material.color.getHex() : 0xffffff;
  const rim = keep === undefined ? [] : keep === aboveNeckCut ? neckRim(source) : cutRim(source, keep);
  if (rim.length === 0) return { geometry, map, color };
  // The skin of the neck follows the neck as well as the head, so the cut is measured on the part as it was posed.
  const edge = new Float32Array(rim.length * 3);
  const position = new THREE.Vector3();
  for (const [at, corner] of rim.entries()) {
    edge.set(baked.subarray(corner * 3, corner * 3 + 3), at * 3);
    position.add(vertex.fromArray(baked, corner * 3));
  }
  position.multiplyScalar(1 / rim.length);
  const middle = new THREE.Vector3();
  const used = geometry.getIndex()!;
  for (let at = 0; at < used.count; at += 1) middle.add(vertex.fromArray(baked, used.getX(at) * 3));
  middle.multiplyScalar(1 / Math.max(1, used.count));
  const flesh = new THREE.BufferGeometry();
  closeCut(flesh, edge, position, position.clone().sub(middle).normalize());
  return { geometry, map, color, cut: { position, flesh } };
}

function blankFighter(playerId: string): FighterSnapshot {
  return {
    player_id: playerId, x: 0, y: 0, facing: 1, facing_x: 1000, facing_y: 0, velocity_x: 0, velocity_y: 0,
    stance: "orthodox", defense: "guard_high", stamina: 1000, maximum_stamina: 1000, conditioning: 1000, guard: 700, poise: 600,
    trauma: { head: 0, body: 0, left_eye: 0, right_eye: 0, left_cut: 0, right_cut: 0, swelling: 0, bleeding: 0 },
    knockdowns: 0, warnings: 0, deductions: 0, stunned_ticks: 0, is_downed: false,
    action: null, action_hand: null, action_target: null, action_power: null, action_id: null, action_key: null,
    action_start_tick: 0, action_startup_ticks: 0, action_active_ticks: 0, action_recovery_ticks: 0, action_contact_tick: null,
    queued_actions: 0, clinch_startup_ticks: 0, clinch_ticks: 0, is_foul_recovery_target: false, taunt_ticks: 0,
    get_up_prompt: null, get_up_meter: 0, get_up_required: 0, get_up_count: 0, get_up_window_start_tick: 0, get_up_window_end_tick: 0,
    last_input_sequence: -1,
  };
}

const SHADOW_BOXING_CYCLE_TICKS = 126;
const SHADOW_BOXING: readonly { readonly start: number; readonly punchClass: PunchClass; readonly hand: Hand }[] = [
  { start: 0, punchClass: "jab", hand: "left" },
  { start: 16, punchClass: "jab", hand: "left" },
  { start: 33, punchClass: "straight", hand: "right" },
  { start: 78, punchClass: "hook", hand: "left" },
];

/** A lone fighter shadow boxes while waiting: a jab-jab-straight then a hook every few seconds. */
function shadowBoxing(idleTick: number): Partial<FighterSnapshot> {
  const cycleTick = idleTick % SHADOW_BOXING_CYCLE_TICKS;
  const cycle = Math.floor(idleTick / SHADOW_BOXING_CYCLE_TICKS);
  for (const [index, punch] of SHADOW_BOXING.entries()) {
    const timing = punchTiming(punch.punchClass, "head", "normal");
    const total = timing.startup + timing.active + timing.recovery;
    if (cycleTick < punch.start || cycleTick >= punch.start + total) continue;
    return {
      action: punch.punchClass, action_hand: punch.hand, action_target: "head", action_power: "normal",
      action_id: `idle-${cycle}-${index}`, action_key: `${punch.punchClass}:${punch.hand}:head:normal`,
      action_start_tick: idleTick - (cycleTick - punch.start), action_startup_ticks: timing.startup, action_active_ticks: timing.active, action_recovery_ticks: timing.recovery,
      action_contact_tick: idleTick - (cycleTick - punch.start) + timing.startup,
    };
  }
  return {};
}

const REPLAY_EVENT_ID_OFFSET = 1_000_003;
const REPLAY_MINIMUM_DISTANCE = 1.6;

/**
 * Which side of the fighters' line the replay camera shoots from: the broadcast side, unless the
 * ropes would crowd it there and the other side has more room.
 */
export function replayCameraSide(midX: number, midZ: number, nx: number, nz: number, distance: number, limit: number): 1 | -1 {
  const preferred = nz < 0 ? -1 : 1;
  const room = (side: number): number => Math.hypot(
    THREE.MathUtils.clamp(midX + nx * side * distance, -limit, limit) - midX,
    THREE.MathUtils.clamp(midZ + nz * side * distance, -limit, limit) - midZ,
  );
  return room(preferred) >= distance * 0.8 || room(preferred) >= room(-preferred) ? preferred : (-preferred as 1 | -1);
}

/** Whether the server would start a punch for this fighter now. */
export function canStartPunch(fighter: FighterSnapshot): boolean {
  return !fighter.is_downed
    && fighter.stunned_ticks === 0
    && fighter.clinch_ticks === 0
    && fighter.clinch_startup_ticks === 0
    && fighter.taunt_ticks === 0
    && !fighter.is_foul_recovery_target;
}

/** The finisher the punch that floored a fighter earns him if he does not beat the count. */
export function knockdownFinisher(hit: CombatEvent | null, snapshot: EngineSnapshot): ArcadeInjury | null {
  if (hit === null) return null;
  const target = snapshot.fighters.find((fighter) => fighter.player_id === hit.target_id);
  const puncher = snapshot.fighters.find((fighter) => fighter.player_id === hit.actor_id);
  return arcadeInjuryFor(hit, target === undefined ? undefined : { ...target, is_downed: true }, { finish_method: "ko", winner_id: hit.actor_id }, puncher);
}

const POOL_SEVERITY = 0.2;
const POOL_RATE = 2;

/** How far the pool under a downed fighter has spread after `count` spills, in metres: fast at first, then slower, wider the worse he bleeds. */
export function poolRadius(count: number, severity: number): number {
  return Math.min(0.42, 0.05 + 0.045 * Math.sqrt(Math.max(0, count)) * Math.min(1.6, Math.max(0, severity)));
}

/** Whether the knockout replay puts this injury back so it can happen again on screen. */
export function replayReattaches(injury: ArcadeInjury): boolean {
  return injury === "decapitation" || injury === "head_burst" || injury === "eye_left" || injury === "eye_right" || injury === "dismember_left" || injury === "dismember_right";
}

const eyeVertices = new WeakMap<THREE.BufferGeometry, readonly [number, number]>();

/** The vertex of a head mesh nearest the middle of each eye: left, then right. */
function eyeVertex(geometry: THREE.BufferGeometry, side: "left" | "right"): number {
  let found = eyeVertices.get(geometry);
  if (found === undefined) {
    const position = geometry.getAttribute("position");
    const vertex = new THREE.Vector3();
    const target = new THREE.Vector3();
    const nearest = EYE_LIDS.map((lid) => {
      let best = 0;
      let bestDistance = Infinity;
      target.set(lid[0], lid[1], lid[2]);
      for (let index = 0; index < position.count; index += 1) {
        const distance = vertex.fromBufferAttribute(position, index).distanceToSquared(target);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      }
      return best;
    });
    found = [nearest[0]!, nearest[1]!];
    eyeVertices.set(geometry, found);
  }
  return found[side === "left" ? 0 : 1];
}

/**
 * Where an eye sits in its socket, on the skin as it is posed, and the way the face points. False when
 * the fighter has no head bone.
 */
export function eyeSocket(boxer: SkinnedBoxer, side: "left" | "right", position: THREE.Vector3, forward: THREE.Vector3, turn: THREE.Quaternion): boolean {
  const head = boxer.bone("head");
  if (head === null) return false;
  boxer.root.updateMatrixWorld(true);
  const mesh = boxer.headMesh;
  const vertex = eyeVertex(mesh.geometry, side);
  mesh.applyBoneTransform(vertex, position.fromBufferAttribute(mesh.geometry.getAttribute("position"), vertex)).applyMatrix4(mesh.matrixWorld);
  head.getWorldQuaternion(turn);
  forward.set(0, 0, 1).applyQuaternion(turn);
  position.addScaledVector(forward, -0.004);
  return true;
}

/** How far the referee stands from the action and how close he may get to a fighter: tight over a count, in close for a clinch, otherwise out of the way. */
export function refereeSpacing(downed: boolean, clinched: boolean): { standoff: number; clearance: number } {
  if (downed) return { standoff: 1.25, clearance: 1.0 };
  if (clinched) return { standoff: 1.15, clearance: 0.9 };
  return { standoff: 2.05, clearance: 1.45 };
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
  private cornermen: [BoxingGraph, BoxingGraph] | null = null;
  private trails: GloveTrail[] = [];
  private readonly trailGlove = new THREE.Vector3();
  private readonly cornermanPosition = new THREE.Vector3();
  private readonly cornermanVelocity = new THREE.Vector3();
  private cutmen: [BoxingGraph, BoxingGraph] | null = null;
  private readonly cutmanProgress = [0, 0];
  private readonly cutmanFrom = new THREE.Vector3();
  private readonly cutmanTo = new THREE.Vector3();
  private readonly cutmanEye = new THREE.Vector3();
  private readonly cutmanFacing = new THREE.Vector3();
  private readonly cutmanLast = [new THREE.Vector3(), new THREE.Vector3()];
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
  private readonly scaler = new ResolutionScaler();
  private readonly basePixelRatio = Math.min(coarsePointer() ? 1.5 : 2, window.devicePixelRatio || 1);
  private players: Readonly<Record<string, PublicPlayer>> = {};
  private playerOrder: readonly string[] = [];
  private viewerId: string | null = null;
  private final: FinalMessage | null = null;
  private reconnectMs = 0;
  private destroyed = false;
  private graphs: [BoxingGraph, BoxingGraph] | null = null;
  private glbLoading = false;
  private graphsReady: Promise<void> = Promise.resolve();
  private readonly headCache = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly headCacheValid = [false, false];
  private readonly arcadeInjuries: [ArcadeInjury | null, ArcadeInjury | null] = [null, null];
  private readonly observedInjuryDown: [boolean, boolean] = [false, false];
  private readonly arcadeInjuryEvents: [CombatEvent | null, CombatEvent | null] = [null, null];
  private readonly replayInjuries: [{ injury: ArcadeInjury; event: CombatEvent } | null, { injury: ArcadeInjury; event: CombatEvent } | null] = [null, null];
  private readonly closeUpTarget = new THREE.Vector3();
  private readonly closeUpFacing = new THREE.Vector3();
  private readonly drawnFighters: [FighterSnapshot, FighterSnapshot] = [blankFighter("a"), blankFighter("b")];
  private readonly lookIds: [string | null, string | null] = [null, null];
  private readonly downedPoolAccumulators: [number, number] = [0, 0];
  private readonly downedPoolCounts: [number, number] = [0, 0];
  private bloodLevel: BloodLevel = "full";
  private viewerHitFlash = 0;
  private finishSlowMotion = 0;
  private finishSeen = false;
  private ceremony: Ceremony | null = null;
  private readonly hudViewport = { width: 1280, height: 720 };
  private readonly ceremonyWrists = [new THREE.Vector3(), new THREE.Vector3()] as const;
  private stumpRim = new Float32Array(0);
  private readonly burstStump = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), across: new THREE.Vector3(), scratch: new THREE.Vector3() };
  private ovationUntil = 0;
  private finalRevealAt = 0;
  private portraitPull = 1;
  private lastPhase: string | null = null;
  private restStartedAt = 0;
  private readonly roundClock = new RoundClock();
  private replayFollow = 0;
  private replayFollowAt = 0;
  private readonly cornerPosition = new THREE.Vector3();
  private readonly cornerLookAt = new THREE.Vector3();
  private finishCloseUpUntil = 0;
  private finishCloseUpIndex = -1;
  private finishCloseUpBearing: number | null = null;
  private readonly closeUpPosition = new THREE.Vector3();
  private roundCalloutUntil = 0;
  private roundCalloutRound = 0;
  private readonly tmpCamera = new THREE.Vector3();
  private readonly roundStats = new RoundStatsTracker();
  private readonly history: EngineSnapshot[] = [];
  private lastKnockdown: { readonly knockdown: CombatEvent; readonly hit: CombatEvent | null; readonly finisher: ArcadeInjury | null } | null = null;
  private replay: { readonly plan: ReplayPlan; readonly buffer: SnapshotBuffer; readonly startedAt: number; impactFired: boolean; side: 1 | -1 | null } | null = null;
  private readonly finishPass: ShaderPass;
  private readonly bloomPass: UnrealBloomPass;
  private readonly avatars = new Avatars();
  private inputLatencyMs: number | null = null;
  private frameMsAverage = 16.7;
  private readonly replayCameraPosition = new THREE.Vector3();
  private readonly replayLookAt = new THREE.Vector3();
  private frameSeconds = 0;
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
    this.renderer.setPixelRatio(this.basePixelRatio);

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
    this.effects = new Effects3D(this.scene, coarsePointer() ? 512 : 1024);

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
    this.bloomPass = bloom;
    this.composer.addPass(bloom);
    this.finishPass = new ShaderPass(BROADCAST_FINISH_SHADER);
    this.composer.addPass(this.finishPass);
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
      .then(async (gltf) => {
        if (this.destroyed) return;
        const first = new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8 });
        const second = new SkinnedBoxer(gltf, { skin: 0x6e4128, gear: 0xb91c1c });
        this.graphs = [new BoxingGraph(first, this.mapping), new BoxingGraph(second, this.mapping)];
        this.lookIds.fill(null);
        this.syncInjuryPresentation(0);
        this.syncInjuryPresentation(1);
        const official = new SkinnedBoxer(gltf, { skin: 0xc79b76, gear: 0x3b57b8, look: OFFICIAL_LOOKS.referee, outfit: REFEREE_OUTFIT });
        this.referee = new BoxingGraph(official, this.mapping, { referee: true });
        const blueCorner = new SkinnedBoxer(gltf, { skin: 0x8a5a3b, gear: 0x1b2230, look: OFFICIAL_LOOKS.blueCorner, outfit: BLUE_CORNER_OUTFIT });
        const redCorner = new SkinnedBoxer(gltf, { skin: 0xd9a77c, gear: 0x1b2230, look: OFFICIAL_LOOKS.redCorner, outfit: RED_CORNER_OUTFIT });
        this.cornermen = [new BoxingGraph(blueCorner, this.mapping, { referee: true }), new BoxingGraph(redCorner, this.mapping, { referee: true })];
        const blueCutman = new SkinnedBoxer(gltf, { skin: 0xb98c66, gear: 0x1b2230, look: OFFICIAL_LOOKS.blueCutman, outfit: CUTMAN_OUTFIT });
        const redCutman = new SkinnedBoxer(gltf, { skin: 0x5a3a26, gear: 0x1b2230, look: OFFICIAL_LOOKS.redCutman, outfit: CUTMAN_OUTFIT });
        this.cutmen = [new BoxingGraph(blueCutman, this.mapping, { referee: true }), new BoxingGraph(redCutman, this.mapping, { referee: true })];
        blueCutman.root.visible = false;
        redCutman.root.visible = false;
        // Compile the skinned materials off the critical path (parallel shader compile where
        // available) so the first frame with fighters does not stall the page.
        const staging = new THREE.Group();
        staging.add(first.root, second.root, official.root, blueCorner.root, redCorner.root, blueCutman.root, redCutman.root);
        try {
          await this.renderer.compileAsync(staging, this.camera, this.scene);
        } catch {
          // Fall back to compiling on the first draw.
        }
        if (this.destroyed) return;
        this.scene.add(first.root, second.root, official.root, blueCorner.root, redCorner.root, blueCutman.root, redCutman.root);
        this.trails = [0x1d4ed8, 0xb91c1c].flatMap((gear) => [0, 1].map(() => new GloveTrail(new THREE.Color(gear).lerp(new THREE.Color(0xffffff), 0.55))));
        for (const trail of this.trails) this.scene.add(trail.mesh);
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

  setPlayers(players: Readonly<Record<string, PublicPlayer>>, viewerId: string | null, order: readonly string[] = Object.keys(players)): void {
    this.players = players;
    this.viewerId = viewerId;
    this.playerOrder = order;
  }

  /** Before the first snapshot the known fighters wait in guard instead of overlapping at the origin. */
  private updateIdleFighters(dt: number, time: number, sampledTick: number): void {
    const graphs = this.graphs;
    if (graphs === null) return;
    const known = this.playerOrder.filter((id) => this.players[id] !== undefined);
    const alone = known.length < 2;
    for (const [index, graph] of graphs.entries()) {
      const id = this.playerOrder[index] ?? `seat-${index}`;
      const present = alone ? id === this.viewerId || (this.viewerId === null && index === 0) : true;
      graph.boxer.root.visible = present;
      if (!present) continue;
      this.wearLook(index === 0 ? 0 : 1, id);
      const sign = index === 0 ? -1 : 1;
      const idleTick = Math.floor(time * this.simulation.tick_rate);
      const self = { ...blankFighter(id), x: alone ? 0 : sign * 180, y: alone ? -70 : 0, facing: alone ? 1 : -sign, facing_x: alone ? 0 : -sign * 1000, facing_y: alone ? -1000 : 0, ...(alone ? shadowBoxing(idleTick) : {}) };
      const other = { ...blankFighter(this.playerOrder[1 - index] ?? "opponent"), x: alone ? 0 : -sign * 180, y: alone ? -150 : 0 };
      graph.setResting(false);
      graph.update(self, other, dt, time, this.settings().reducedMotion, this.bloodLevel, alone ? idleTick : sampledTick);
    }
  }

  /** A stoppage's result panel waits for the slow-motion fall; decisions show at once. */
  setFinal(final: FinalMessage | null): void {
    this.final = final;
    this.ceremony = this.ceremonyFor(final);
    this.finalRevealAt = this.frameSeconds + (this.ceremony === null ? finalRevealDelay(final) : CEREMONY_REVEAL_LIMIT_SECONDS);
    this.ovationUntil = final === null ? 0 : this.frameSeconds + CROWD_OVATION_SECONDS;
    if (this.ceremony === null) this.endCeremony();
    if (final === null || !STOPPAGE_METHODS.has(final.method)) return;
    const plan = this.lastKnockdown === null ? null : planKnockoutReplay(this.history, this.lastKnockdown.knockdown, this.simulation.tick_rate);
    const finisher = this.finishingInjury(final);
    if (plan !== null && this.graphs !== null && !this.settings().reducedMotion) {
      // The blow that floored him for the count does its damage at the impact of the replay.
      if (finisher !== null) this.replayInjuries[finisher.index] = { injury: finisher.injury, event: finisher.event };
      this.startReplay(plan);
      return;
    }
    if (finisher !== null) this.applyArcadeInjury(finisher.index, finisher.injury, finisher.event);
    this.presentFinish(final);
  }

  /** The finisher earned by a knockout whose blow was not yet known to end the bout when it landed. */
  private finishingInjury(final: FinalMessage): { index: number; injury: ArcadeInjury; event: CombatEvent } | null {
    const record = this.lastKnockdown;
    const settings = this.settings();
    if (record === null || record.hit === null || record.finisher === null || settings.blood !== "full" || settings.reducedMotion) return null;
    if ((final.method !== "ko" && final.method !== "tko") || final.winner_id !== record.hit.actor_id) return null;
    const index = this.buffer.latest()?.fighters.findIndex((fighter) => fighter.player_id === record.hit!.target_id) ?? -1;
    if (index < 0 || this.arcadeInjuries[index] !== null) return null;
    return { index, injury: record.finisher, event: record.hit };
  }

  /** A bout that went to the cards ends with both fighters beside the referee for the decision. */
  private ceremonyFor(final: FinalMessage | null): Ceremony | null {
    const fighters = this.buffer.latest()?.fighters;
    if (final === null || fighters === undefined || (final.method !== "decision" && final.method !== "draw")) return null;
    if (fighters.some((fighter) => fighter.is_downed)) return null;
    const seat = fighters.findIndex((fighter) => fighter.player_id === final.winner_id);
    return { winnerSeat: seat === 0 || seat === 1 ? seat : null, positions: null, refereeArrived: false, arrivedAt: null, announced: false };
  }

  private endCeremony(): void {
    for (const graph of this.graphs ?? []) graph.awaitVerdict(null);
    this.referee?.raise(null, null);
  }

  /** The fighters as drawn during the decision: walking to their marks, then standing square to the camera. */
  private ceremonyFighters(ceremony: Ceremony, fighters: readonly [FighterSnapshot, FighterSnapshot], dt: number, seconds: number): readonly [FighterSnapshot, FighterSnapshot] {
    ceremony.positions ??= [{ x: fighters[0].x, y: fighters[0].y }, { x: fighters[1].x, y: fighters[1].y }];
    let arrived = ceremony.refereeArrived;
    for (const seat of [0, 1] as const) {
      const from = ceremony.positions[seat];
      const step = ceremonyStep(from.x, from.y, CEREMONY_MARKS[seat], CEREMONY_WALK_SPEED * dt);
      const moved = Math.hypot(step.x - from.x, step.y - from.y);
      const perTick = dt > 0 ? 1 / (dt * this.simulation.tick_rate) : 0;
      const walking = !step.arrived && moved > 1e-6;
      Object.assign(this.drawnFighters[seat], fighters[seat], {
        x: step.x,
        y: step.y,
        velocity_x: (step.x - from.x) * perTick,
        velocity_y: (step.y - from.y) * perTick,
        facing_x: walking ? Math.round(((step.x - from.x) / moved) * 1000) : 0,
        facing_y: walking ? Math.round(((step.y - from.y) / moved) * 1000) : -1000,
        facing: walking && step.x < from.x ? -1 : 1,
        action: null, action_id: null, action_key: null, queued_actions: 0,
        defense: "none", stunned_ticks: 0, taunt_ticks: 0, clinch_ticks: 0, clinch_startup_ticks: 0,
      } satisfies Partial<FighterSnapshot>);
      from.x = step.x;
      from.y = step.y;
      arrived &&= step.arrived;
      this.graphs?.[seat]?.awaitVerdict(seat === 0 ? 1 : -1);
    }
    if (arrived) ceremony.arrivedAt ??= seconds;
    if (!ceremony.announced && ceremony.arrivedAt !== null && seconds - ceremony.arrivedAt >= CEREMONY_PAUSE_SECONDS) {
      ceremony.announced = true;
      for (const seat of [0, 1] as const) this.graphs?.[seat]?.announce(ceremony.winnerSeat === null ? "level" : ceremony.winnerSeat === seat ? "winner" : "loser");
      this.finalRevealAt = Math.min(this.finalRevealAt, this.frameSeconds + 0.35);
      this.arena.excite(1);
    }
    if (ceremony.announced) {
      // The referee holds the wrist where the last frame left it; the blue corner stands on the referee's right.
      const wrist = (seat: 0 | 1): THREE.Vector3 | null => {
        const raised = ceremony.winnerSeat === null || ceremony.winnerSeat === seat;
        const bone = this.graphs?.[seat]?.boxer.rig.bones[seat === 0 ? "gloveL" : "gloveR"];
        return raised && bone !== undefined ? bone.getWorldPosition(this.ceremonyWrists[seat]) : null;
      };
      this.referee?.raise(wrist(1), wrist(0));
    }
    return this.drawnFighters;
  }

  /** The announcement is shot from the front, in the part of the screen the result card leaves free. */
  private ceremonyFrame(seconds: number): { position: THREE.Vector3; lookAt: THREE.Vector3; framed: boolean } | null {
    const ceremony = this.ceremony;
    const latest = this.buffer.latest();
    if (ceremony === null || ceremony.arrivedAt === null || this.replay !== null || this.final === null || latest === null) return null;
    const { width, height } = this.hudViewport;
    const punches = latest.fighters.map((fighter) => this.roundStats.total(fighter.player_id)) as [RoundPunchStats, RoundPunchStats];
    const layout = resultCardLayout(width, height, resultCard(this.final, latest.fighters, this.players, punches), latest.fighters.some((fighter) => fighter.player_id === this.viewerId));
    const shot = ceremonyShot(this.camera.aspect, this.camera.fov, (height - layout.y) / Math.max(1, height));
    const drift = Math.sin((seconds - ceremony.arrivedAt) * 0.35) * 0.06 * shot.distance;
    this.cornerPosition.set(drift, shot.height + 0.05 * shot.distance, shot.distance);
    this.cornerLookAt.set(0, shot.height, 0);
    return { position: this.cornerPosition, lookAt: this.cornerLookAt, framed: true };
  }

  private presentFinish(final: FinalMessage): void {
    this.referee?.waveOff();
    const fighters = this.buffer.latest()?.fighters;
    const loserIndex = fighters?.findIndex((fighter) => fighter.player_id !== final.winner_id && fighter.player_id !== null) ?? -1;
    if (loserIndex >= 0 && this.headCacheValid[loserIndex] && !this.settings().reducedMotion) {
      this.finishCloseUpIndex = loserIndex;
      this.finishCloseUpUntil = this.frameSeconds + FINISH_CLOSE_UP_SECONDS;
      this.finishCloseUpBearing = null;
    }
    if (final.winner_id === null) return;
    const index = fighters?.findIndex((fighter) => fighter.player_id === final.winner_id) ?? -1;
    if (index >= 0) this.graphs?.[index]?.celebrate();
  }

  /** Between rounds the broadcast cuts to each corner in turn, the viewer's own first, once its fighter is seated. */
  private cornerShotFrame(seconds: number, snapshot: EngineSnapshot | null, reducedMotion: boolean): { position: THREE.Vector3; lookAt: THREE.Vector3 } | null {
    if (snapshot === null || snapshot.phase !== "rest" || reducedMotion || this.graphs === null) return null;
    const viewer = snapshot.fighters.findIndex((fighter) => fighter.player_id === this.viewerId);
    const elapsed = seconds - this.restStartedAt;
    const index = cornerShot(elapsed, snapshot.phase_ticks_remaining / this.simulation.tick_rate, viewer === 1 ? 1 : 0);
    if (index === null || !this.graphs[index].stoolVisible) return null;
    // The shot waits for the cutman to get down to his work, or he walks across it.
    if (this.cutmen !== null && this.cutmanProgress[index]! < CUTMAN_IN_PLACE) return null;
    cornerFrame(index, this.mapping.x(REST_CORNER_OFFSET), cornerShotProgress(elapsed), this.cornerPosition, this.cornerLookAt);
    return { position: this.cornerPosition, lookAt: this.cornerLookAt };
  }

  /** A short high three-quarter close-up on the beaten fighter's face, or on the head where it came to rest, before the result panel. */
  private closeUpFrame(seconds: number): { position: THREE.Vector3; lookAt: THREE.Vector3; tight: boolean } | null {
    if (seconds >= this.finishCloseUpUntil || this.finishCloseUpIndex < 0 || !this.headCacheValid[this.finishCloseUpIndex]) return null;
    const injury = this.arcadeInjuries[this.finishCloseUpIndex];
    const severed = injury === "decapitation" && this.effects.severedHeadPosition(this.finishCloseUpIndex, this.closeUpTarget);
    // An eye out of its socket is shot close, on the side the face points to.
    const hanging = !severed && (injury === "eye_left" || injury === "eye_right") && this.effects.eyePosition(this.finishCloseUpIndex, this.closeUpTarget);
    const head = severed || hanging ? this.closeUpTarget : this.headCache[this.finishCloseUpIndex]!;
    const reach = severed ? 0.8 : hanging ? 0.45 : 1.05;
    const drift = (seconds - (this.finishCloseUpUntil - FINISH_CLOSE_UP_SECONDS)) * 0.25 - 0.2;
    // Shoot from the ring-centre side of the fighter so the ropes stay behind the face.
    const toCentre = Math.atan2(-head.x, -head.z);
    // The side is chosen once: a head still tumbling would swing the camera round it.
    if (this.finishCloseUpBearing === null) {
      const skull = hanging ? this.headWorldPose(this.finishCloseUpIndex) : null;
      // A hanging eye is shot from the side of the head it hangs on.
      const facing = severed && this.effects.severedHeadFacing(this.finishCloseUpIndex, this.closeUpFacing)
        ? this.closeUpFacing
        : skull !== null
          ? this.closeUpFacing.copy(head).sub(skull.position).normalize()
          : null;
      const winner = this.finishCloseUpIndex === 0 ? this.tmpB : this.tmpA;
      const blockers = [{ x: winner.x, z: winner.z, radius: STANDING_BLOCK_RADIUS }, { x: this.refereePosition.x, z: this.refereePosition.z, radius: STANDING_BLOCK_RADIUS }];
      this.finishCloseUpBearing = closeUpAngle(head.x, head.z, facing, reach, TIGHT_SHOT_LIMIT, Math.hypot(head.x, head.z) > 0.4 ? toCentre : 0.9, blockers);
    }
    const angle = this.finishCloseUpBearing + drift;
    this.closeUpPosition.set(
      THREE.MathUtils.clamp(head.x + Math.sin(angle) * reach, -TIGHT_SHOT_LIMIT, TIGHT_SHOT_LIMIT),
      head.y + (severed ? 0.42 : hanging ? 0.5 : 0.75),
      THREE.MathUtils.clamp(head.z + Math.cos(angle) * reach, -TIGHT_SHOT_LIMIT, TIGHT_SHOT_LIMIT),
    );
    this.replayLookAt.copy(head);
    return { position: this.closeUpPosition, lookAt: this.replayLookAt, tight: true };
  }

  /** Replays the recorded snapshots around the knockdown from a close camera before the result panel. */
  private startReplay(plan: ReplayPlan): void {
    const buffer = new SnapshotBuffer(plan.snapshots.length + 2, this.simulation.tick_rate);
    for (const snapshot of plan.snapshots) buffer.push(snapshot);
    this.replay = { plan, buffer, startedAt: this.frameSeconds, impactFired: false, side: null };
    this.replayFollow = 0;
    this.replayFollowAt = 0;
    for (const index of [0, 1] as const) {
      const injury = this.arcadeInjuries[index];
      const event = this.arcadeInjuryEvents[index];
      if (injury !== null && event !== null && replayReattaches(injury)) {
        this.replayInjuries[index] = { injury, event };
        this.restoreInjury(index);
      }
    }
    for (const graph of this.graphs ?? []) graph.resetTransient(false);
    this.finalRevealAt = this.frameSeconds + plan.durationSeconds + finalRevealDelay(this.final);
  }

  private endReplay(): void {
    this.replay = null;
    this.reapplyReplayInjuries();
    const live = this.buffer.latest();
    for (const [index, graph] of (this.graphs ?? []).entries()) graph.resetTransient(live?.fighters[index]?.is_downed === true);
    if (this.final !== null) this.presentFinish(this.final);
  }

  private fireReplayImpact(snapshot: EngineSnapshot): void {
    const record = this.lastKnockdown;
    if (record === null) return;
    const event = record.hit ?? { ...record.knockdown, kind: "hit", amount: 420, blood: 60 };
    const { recipientIndex, puncherIndex } = contactParticipants(event, snapshot);
    const recipient = snapshot.fighters[recipientIndex];
    if (recipient === undefined) return;
    this.tmpA.set(this.mapping.x(recipient.x), 0, this.mapping.z(recipient.y));
    this.effects.addEvent(event, this.tmpA, this.settings().reducedMotion);
    const puncher = puncherIndex >= 0 ? snapshot.fighters[puncherIndex] : undefined;
    const keyParts = puncher?.action_key?.split(":") ?? [];
    const punchClass = (keyParts[0] ?? null) as PunchClass | null;
    const hand = (keyParts[1] ?? null) as Hand | null;
    this.graphs?.[recipientIndex]?.react("hit", event.detail.endsWith(":body") ? "body" : "head", event.direction, punchClass, hand, Math.max(300, event.amount));
    if (puncherIndex >= 0) this.graphs?.[puncherIndex]?.landedHit(false);
    // The punch that floored him knocks the gum shield out again, in slow motion.
    if (event.detail.endsWith(":head") && !this.settings().reducedMotion) this.knockOutMouthpiece(recipientIndex, event.direction, event.event_id + REPLAY_EVENT_ID_OFFSET, true);
    this.onContact?.(event);
    this.reapplyReplayInjuries();
  }

  private replayFrame(snapshot: EngineSnapshot, elapsed: number): { position: THREE.Vector3; lookAt: THREE.Vector3; tight: boolean } {
    const [a, b] = snapshot.fighters;
    const ax = this.mapping.x(a.x);
    const az = this.mapping.z(a.y);
    const bx = this.mapping.x(b.x);
    const bz = this.mapping.z(b.y);
    // A portrait screen is too narrow for both fighters up close, so it favours the one being hit;
    // after the impact every screen follows that fighter down to the canvas.
    const victim = snapshot.fighters.findIndex((fighter) => fighter.player_id === this.replay?.plan.impact.target_id);
    const falling = this.replay?.impactFired === true && victim >= 0 && this.headCacheValid[victim] === true;
    const follow = 1 - Math.exp(-3 * Math.max(0, elapsed - this.replayFollowAt));
    this.replayFollowAt = elapsed;
    this.replayFollow += ((falling ? 1 : 0) - this.replayFollow) * follow;
    const favour = victim < 0 ? 0 : Math.max(this.portraitPull > 1.3 ? 0.7 : 0, this.replayFollow * 0.8);
    const midX = (ax + bx) / 2 + ((victim === 1 ? bx : ax) - (ax + bx) / 2) * favour;
    const midZ = (az + bz) / 2 + ((victim === 1 ? bz : az) - (az + bz) / 2) * favour;
    let nx = -(bz - az);
    let nz = bx - ax;
    const length = Math.hypot(nx, nz) || 1;
    nx /= length;
    nz /= length;
    const distance = 2.5;
    const replay = this.replay;
    // The side is chosen once so the shot never cuts across the fighters mid-replay.
    if (replay !== null && replay.side === null) replay.side = replayCameraSide(midX, midZ, nx, nz, distance, TIGHT_SHOT_LIMIT);
    const side = replay?.side ?? (nz < 0 ? -1 : 1);
    nx *= side;
    nz *= side;
    const orbit = 0.35 * Math.sin(elapsed * 0.7);
    const dx = nx * Math.cos(orbit) - nz * Math.sin(orbit);
    const dz = nx * Math.sin(orbit) + nz * Math.cos(orbit);
    this.replayCameraPosition.set(
      THREE.MathUtils.clamp(midX + dx * distance, -TIGHT_SHOT_LIMIT, TIGHT_SHOT_LIMIT),
      1.38 - Math.min(0.25, elapsed * 0.05),
      THREE.MathUtils.clamp(midZ + dz * distance, -TIGHT_SHOT_LIMIT, TIGHT_SHOT_LIMIT),
    );
    // In a corner both sides are short of room; back off toward the ring centre instead of crowding the fighters.
    const room = Math.hypot(this.replayCameraPosition.x - midX, this.replayCameraPosition.z - midZ);
    const centre = Math.hypot(midX, midZ);
    if (room < REPLAY_MINIMUM_DISTANCE && centre > 0.01) {
      const push = REPLAY_MINIMUM_DISTANCE - room;
      this.replayCameraPosition.x = THREE.MathUtils.clamp(this.replayCameraPosition.x - (midX / centre) * push, -TIGHT_SHOT_LIMIT, TIGHT_SHOT_LIMIT);
      this.replayCameraPosition.z = THREE.MathUtils.clamp(this.replayCameraPosition.z - (midZ / centre) * push, -TIGHT_SHOT_LIMIT, TIGHT_SHOT_LIMIT);
    }
    const headHeight = falling ? THREE.MathUtils.clamp(this.headCache[victim]!.y, 0.45, 1.28) : 1.28;
    this.replayLookAt.set(midX, 1.28 + (headHeight - 1.28) * this.replayFollow, midZ);
    return { position: this.replayCameraPosition, lookAt: this.replayLookAt, tight: true };
  }

  setInputLatency(milliseconds: number | null): void {
    this.inputLatencyMs = milliseconds;
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
      if (injury === "head_burst") graph.boxer.setHeadBurst(true);
      else graph.boxer.setDecapitated(injury === "decapitation");
      graph.boxer.headInjury.setEyeOut(injury === "eye_left" ? "left" : injury === "eye_right" ? "right" : null);
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

  /** Severs the head or a hand from the fighter's current pose, or sets a dislocation, and records it. */
  private applyArcadeInjury(index: number, injury: ArcadeInjury, event: CombatEvent): boolean {
    let applied = this.graphs !== null
      && (injury === "jaw_dislocation" || injury === "shoulder_left" || injury === "shoulder_right");
    if (injury === "decapitation") {
      const pose = this.headWorldPose(index);
      if (pose !== null) {
        const graph = this.graphs?.[index];
        const baked = graph === undefined ? undefined : { ...bakeSkinnedPart(graph.boxer.headMesh, pose.position, pose.quaternion, aboveNeckCut), look: graph.boxer.look };
        this.effects.decapitate(
          index,
          pose.position,
          pose.quaternion,
          event.direction,
          event.event_id,
          this.skinColor(index),
          baked,
        );
        const stumpPose = this.stumpWorldPose(index);
        if (stumpPose !== null) this.effects.anchorStump(index, stumpPose.position, stumpPose.quaternion, stumpPose.rim);
        applied = true;
      }
    } else if (injury === "head_burst") {
      const pose = this.headWorldPose(index);
      if (pose !== null) {
        this.effects.burstHead(index, pose.position, event.direction, event.event_id);
        const jaw = this.burstStumpPose(index);
        if (jaw !== null) this.effects.anchorStump(index, jaw.position, jaw.quaternion, jaw.rim, jaw.across);
        applied = true;
      }
    } else if (injury === "eye_left" || injury === "eye_right") {
      const boxer = this.graphs?.[index]?.boxer;
      if (boxer !== undefined && eyeSocket(boxer, injury === "eye_left" ? "left" : "right", this.tmpPart, this.tmpStumpOffset, this.tmpPartQuaternion)) {
        this.effects.gougeEye(index, this.tmpPart, this.tmpStumpOffset, event.direction, event.event_id);
        applied = true;
      }
    } else if (injury === "dismember_left" || injury === "dismember_right") {
      const side = injury === "dismember_left" ? "left" : "right";
      const pose = this.handWorldPose(index, side);
      if (pose !== null) {
        const graph = this.graphs?.[index];
        const baked = graph === undefined ? undefined : bakeSkinnedPart(graph.boxer.gloveMesh(side), pose.position, pose.quaternion);
        this.effects.dismemberHand(
          index,
          side,
          pose.position,
          pose.quaternion,
          event.direction,
          event.event_id,
          this.gearColor(index),
          baked,
        );
        this.effects.anchorHandStump(index, side, pose.position, pose.quaternion);
        applied = true;
      }
    }
    if (!applied) return false;
    this.arcadeInjuries[index] = injury;
    this.arcadeInjuryEvents[index] = event;
    this.observedInjuryDown[index] = false;
    this.syncInjuryPresentation(index);
    this.onArcadeInjury?.(injury, event);
    return true;
  }

  /** Severed parts go back on for the replay and come off again, from the replayed pose, at its impact. */
  private reapplyReplayInjuries(): void {
    for (const index of [0, 1] as const) {
      const stash = this.replayInjuries[index];
      if (stash === null) continue;
      this.replayInjuries[index] = null;
      const settings = this.settings();
      if (settings.blood !== "full" || settings.reducedMotion) continue;
      this.applyArcadeInjury(index, stash.injury, { ...stash.event, event_id: stash.event.event_id + REPLAY_EVENT_ID_OFFSET });
    }
  }

  private restoreInjury(index: number): void {
    if (this.arcadeInjuries[index] === null) return;
    this.arcadeInjuries[index] = null;
    this.arcadeInjuryEvents[index] = null;
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
    this.tmpStumpOffset.copy(HEAD_PIVOT_OFFSET).applyQuaternion(this.tmpHeadQuaternion);
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

  /**
   * The exposed cut through the neck, measured on the skin as it is posed: its middle, facing up the
   * neck, and its edge, both ends of each of its edges in turn.
   */
  private stumpWorldPose(index: number): { position: THREE.Vector3; quaternion: THREE.Quaternion; rim: Float32Array } | null {
    const boxer = this.graphs?.[index]?.boxer;
    const head = boxer?.bone("head");
    if (boxer === undefined || head === undefined || head === null) return null;
    boxer.root.updateMatrixWorld(true);
    const mesh = boxer.headMesh;
    const rim = neckRim(mesh.geometry);
    if (rim.length === 0) return null;
    if (this.stumpRim.length !== rim.length * 3) this.stumpRim = new Float32Array(rim.length * 3);
    const bind = mesh.geometry.getAttribute("position");
    this.tmpStump.set(0, 0, 0);
    for (const [at, corner] of rim.entries()) {
      mesh.applyBoneTransform(corner, this.tmpStumpOffset.fromBufferAttribute(bind, corner)).applyMatrix4(mesh.matrixWorld);
      this.tmpStumpOffset.toArray(this.stumpRim, at * 3);
      this.tmpStump.add(this.tmpStumpOffset);
    }
    this.tmpStump.multiplyScalar(1 / rim.length);
    head.getWorldPosition(this.tmpStumpOffset).sub(this.tmpStump).normalize();
    this.tmpStumpQuaternion.setFromUnitVectors(UP, this.tmpStumpOffset);
    return { position: this.tmpStump, quaternion: this.tmpStumpQuaternion, rim: this.stumpRim };
  }

  private burstStumpPose(index: number): { position: THREE.Vector3; quaternion: THREE.Quaternion; rim: Float32Array; across: THREE.Vector3 } | null {
    const boxer = this.graphs?.[index]?.boxer;
    if (boxer === undefined) return null;
    const rim = measureBurstStump(boxer, this.stumpRim, this.burstStump);
    if (rim === null) return null;
    this.stumpRim = rim;
    return { position: this.burstStump.position, quaternion: this.burstStump.quaternion, rim, across: this.burstStump.across };
  }

  predictAction(action: SemanticAction): void {
    const latest = this.buffer.latest();
    if (latest === null || this.viewerId === null || this.replay !== null) return;
    const index = latest.fighters.findIndex((fighter) => fighter.player_id === this.viewerId);
    if (index < 0) return;
    // The server turns a punch down outside the fight phase and while the fighter cannot act or pay for it.
    const fighter = latest.fighters[index]!;
    if (action.kind !== "punch" || latest.phase !== "fight" || !canStartPunch(fighter) || !canAffordPunch(fighter, action)) return;
    const leadTicks = ((this.inputLatencyMs ?? 60) / 1000) * this.simulation.tick_rate + this.buffer.interpolationDelayTicks;
    this.graphs?.[index]?.predict(action, performance.now() / 1000, this.simulation.tick_rate, leadTicks, predictedPunchTiming(fighter, action));
  }

  push(snapshot: EngineSnapshot): void {
    if (!this.buffer.push(snapshot, this.manualClock ? this.lastManualTime : performance.now())) return;
    const accepted = this.dedupe.accept(snapshot.events);
    this.history.push(snapshot);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    for (const event of accepted) {
      this.roundStats.record(event);
      if (event.kind === "knockdown") {
        const hit = accepted.find((candidate) => (candidate.kind === "hit" || candidate.kind === "counter_hit") && candidate.target_id === event.target_id) ?? null;
        this.lastKnockdown = { knockdown: event, hit, finisher: knockdownFinisher(hit, snapshot) };
      }
      if (event.kind === "referee_break") this.referee?.breakClinch();
    }
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
      if (presentImpact) this.arena.excite(CROWD_EXCITEMENT[event.kind] ?? 0);
      if (
        presentImpact
        && recipientIndex >= 0
        && this.viewerId !== null
        && this.buffer.latest()?.fighters[recipientIndex]?.player_id === this.viewerId
        && ["hit", "counter_hit", "knockdown"].includes(event.kind)
      ) {
        this.viewerHitFlash = Math.max(this.viewerHitFlash, Math.min(1, 0.35 + event.amount / 400));
      }
      if (
        injury !== null
        && recipientIndex >= 0
        && this.arcadeInjuries[recipientIndex] === null
        && currentSettings.blood === "full"
        && !currentSettings.reducedMotion
      ) {
        this.applyArcadeInjury(recipientIndex, injury, event);
      }
      const graphs = this.graphs;
      if (presentImpact && recipientIndex >= 0 && !currentSettings.reducedMotion && mouthpieceFlies(event.kind, event.amount, presentationEvent.detail.endsWith(":head"))) {
        this.knockOutMouthpiece(recipientIndex, presentationEvent.direction, event.event_id, false);
      }
      const teeth = presentImpact && recipientIndex >= 0 ? teethFor(event.kind, event.amount, presentationEvent.detail.endsWith(":head")) : 0;
      if (teeth > 0 && !currentSettings.reducedMotion && currentSettings.blood !== "off") {
        const pose = this.headWorldPose(recipientIndex);
        if (pose !== null) {
          this.tmpB.set(0, -0.07, 0.1).applyQuaternion(pose.quaternion).add(pose.position);
          this.effects.spawnTeeth(this.tmpB, presentationEvent.direction, teeth, event.event_id);
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

  /** The bell ends the round: the rest starts and the corners put the gum shields back in. */
  private enterRest(seconds: number): void {
    this.restStartedAt = seconds;
    this.effects.clearMouthpieces();
  }

  /** The gum shield flies out of the mouth along the punch, from the head as it is posed. */
  private knockOutMouthpiece(index: number, direction: number, eventId: number, again: boolean): void {
    const pose = this.headWorldPose(index);
    if (pose === null) return;
    this.tmpB.set(0, -0.075, 0.1).applyQuaternion(pose.quaternion).add(pose.position);
    this.effects.ejectMouthpiece(index, this.tmpB, pose.quaternion, direction, eventId, this.gearColor(index), again);
  }

  /** True once the result panel is on screen, after any knockout replay and close-up. */
  get resultVisible(): boolean {
    return this.final !== null && this.frameSeconds >= this.finalRevealAt;
  }

  get resolutionScale(): number {
    return this.scaler.scale;
  }

  /** Snapshot for the diagnostics panel: smoothed frame time, render scale, GPU objects and the graphics adapter. */
  get diagnostics(): { frameMs: number; resolutionScale: number; gpu: { geometries: number; textures: number; programs: number }; graphics: string } {
    const gl = this.renderer.getContext();
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const graphics = info === null ? gl.getParameter(gl.RENDERER) : gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
    return { frameMs: this.frameMsAverage, resolutionScale: this.scaler.scale, gpu: this.memoryInfo, graphics: String(graphics) };
  }

  /** Live GPU object counts from three, for leak checks across rematches. */
  get memoryInfo(): { geometries: number; textures: number; programs: number } {
    return { geometries: this.renderer.info.memory.geometries, textures: this.renderer.info.memory.textures, programs: this.renderer.info.programs?.length ?? 0 };
  }

  private applyResolutionScale(): void {
    const ratio = this.basePixelRatio * this.scaler.scale;
    this.renderer.setPixelRatio(ratio);
    this.composer.setPixelRatio(ratio);
    // At the bottom of the scale the client is struggling: drop bloom and the key shadow entirely.
    const low = this.scaler.scale <= LOW_TIER_SCALE;
    this.bloomPass.enabled = !low;
    if (this.keyLight !== null) this.keyLight.castShadow = !low;
    const shadowSize = this.scaler.scale < 0.8 ? 1024 : 2048;
    const shadow = this.keyLight?.shadow;
    if (shadow !== undefined && shadow.mapSize.x !== shadowSize) {
      shadow.mapSize.set(shadowSize, shadowSize);
      shadow.map?.dispose();
      shadow.map = null;
    }
  }

  private setupLights(): void {
    const hemisphere = new THREE.HemisphereLight("#3c4a72", "#07080c", 0.55);
    this.scene.add(hemisphere);
    this.lights.push(hemisphere);

    const key = new THREE.SpotLight("#fff1dc", 150, 24, 0.56, 0.55, 1.7);
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
    const frameMs = time - this.previous;
    let dt = manual ? 1 / 60 : Math.min(0.05, Math.max(0.001, frameMs / 1000));
    this.previous = time;
    if (!manual && this.scaler.record(frameMs)) this.applyResolutionScale();
    if (!manual && frameMs > 0 && frameMs < 1000) this.frameMsAverage += (frameMs - this.frameMsAverage) * 0.05;

    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width > 0 && height > 0) {
      this.renderer.getSize(this.sizeCheck);
      if (this.sizeCheck.x !== width || this.sizeCheck.y !== height) {
        this.renderer.setSize(width, height, false);
        this.composer.setSize(width, height);
        this.camera.aspect = width / height;
        // Narrow viewports widen the lens a little and pull the camera back (see the frame step below).
        this.portraitPull = THREE.MathUtils.clamp(1.2 / this.camera.aspect, 1, 2.2);
        this.camera.fov = 36 * Math.min(1.3, Math.sqrt(this.portraitPull));
        this.camera.updateProjectionMatrix();
      }
    }

    const seconds = time / 1000;
    this.frameSeconds = seconds;
    this.finishPass.uniforms.uTime!.value = seconds % 1000;
    if (manual) this.lastManualTime = time;
    const current = this.settings();
    this.setBloodLevel(current.blood);

    const latest = this.buffer.latest();
    const finishing = latest?.result !== null && latest?.result !== undefined
      && STOPPAGE_METHODS.has(latest.result.finish_method);
    this.cheer(seconds, dt);
    if (finishing && !this.finishSeen) {
      this.finishSeen = true;
      this.finishSlowMotion = 2.2;
      this.arena.excite(1);
    }
    if (this.finishSlowMotion > 0 && !current.reducedMotion) {
      this.finishSlowMotion = Math.max(0, this.finishSlowMotion - dt);
      const eased = Math.min(1, this.finishSlowMotion / 0.5);
      dt *= 0.3 + 0.7 * (1 - eased);
    }
    this.viewerHitFlash = Math.max(0, this.viewerHitFlash - dt * 3.2);
    let sampledTick = latest === null ? 0 : manual ? presentationTickFor(latest) : this.buffer.renderTick(time);
    let snapshot = latest === null ? null : this.applyLocalPrediction(this.buffer.sample(sampledTick), dt);
    const replay = this.replay;
    if (replay !== null) {
      const elapsed = seconds - replay.startedAt;
      if (elapsed >= replay.plan.durationSeconds) {
        this.endReplay();
      } else {
        sampledTick = replayTick(replay.plan, elapsed, this.simulation.tick_rate);
        snapshot = replay.buffer.sample(sampledTick) ?? snapshot;
        if (!replay.impactFired && sampledTick >= replay.plan.impact.tick && snapshot !== null) {
          replay.impactFired = true;
          this.fireReplayImpact(snapshot);
        }
      }
    }
    // Everyone in the ring moves in slow motion with the replayed snapshots.
    const actorDt = this.replay !== null ? dt * this.replay.plan.speed : dt;
    let separation = 1.8;
    let knockdown = false;
    if (snapshot !== null) {
      const ceremony = this.replay === null ? this.ceremony : null;
      const [a, b] = ceremony !== null ? this.ceremonyFighters(ceremony, snapshot.fighters, actorDt, seconds) : this.standApart(snapshot.fighters);
      for (const [index, fighter] of snapshot.fighters.entries()) {
        if (this.arcadeInjuries[index] === null || this.replay !== null) continue;
        if (fighter.is_downed) this.observedInjuryDown[index] = true;
        else if (this.observedInjuryDown[index] && snapshot.result === null) this.restoreInjury(index);
      }
      const graphs = this.graphs;
      if (graphs !== null) {
        this.wearLook(0, a.player_id);
        this.wearLook(1, b.player_id);
        const headA = this.headCacheValid[0] ? this.headCache[0] : undefined;
        const headB = this.headCacheValid[1] ? this.headCache[1] : undefined;
        graphs[0].boxer.root.visible = true;
        graphs[1].boxer.root.visible = true;
        const resting = cornersAtWork(snapshot, this.simulation.tick_rate);
        graphs[0].setResting(resting);
        graphs[1].setResting(resting);
        const countdown = snapshot.phase === "countdown" ? snapshot.phase_ticks_remaining : null;
        graphs[0].setCountdown(countdown);
        graphs[1].setCountdown(countdown);
        if (snapshot.phase === "fight" && this.lastPhase === "rest" && this.replay === null) {
          this.roundCalloutUntil = seconds + ROUND_CALLOUT_SECONDS;
          this.roundCalloutRound = snapshot.round_number;
        }
        if (snapshot.phase === "rest" && this.lastPhase !== "rest") this.enterRest(seconds);
        this.lastPhase = snapshot.phase;
        this.anticipatePunches(latest, sampledTick);
        graphs[0].update(a, b, actorDt, seconds, current.reducedMotion, current.blood, sampledTick, headB);
        graphs[1].update(b, a, actorDt, seconds, current.reducedMotion, current.blood, sampledTick, headA);
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
          if (pose !== null) this.effects.anchorStump(index, pose.position, pose.quaternion, pose.rim);
        } else if (injury === "head_burst") {
          const jaw = this.burstStumpPose(index);
          if (jaw !== null) this.effects.anchorStump(index, jaw.position, jaw.quaternion, jaw.rim, jaw.across);
        } else if (injury === "eye_left" || injury === "eye_right") {
          const boxer = this.graphs?.[index]?.boxer;
          const skull = this.headWorldPose(index);
          if (boxer !== undefined && skull !== null && eyeSocket(boxer, injury === "eye_left" ? "left" : "right", this.tmpPart, this.tmpStumpOffset, this.tmpPartQuaternion)) this.effects.anchorEye(index, this.tmpPart, this.tmpStumpOffset, skull.position, skull.quaternion);
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
      this.ring.setRopeContacts({ x: ax, z: az }, { x: bx, z: bz });
      this.tmpA.set(ax, 0, az);
      this.tmpB.set(bx, 0, bz);
      for (const [index, fighter] of snapshot.fighters.entries()) {
        const severity = (fighter.trauma.bleeding + fighter.trauma.left_cut + fighter.trauma.right_cut) / 380;
        if (severity > 0.05 && !fighter.is_downed) {
          this.downedPoolAccumulators[index] = 0;
          this.downedPoolCounts[index] = 0;
          const anchor = index === 0 ? this.tmpA : this.tmpB;
          this.tmpHead.set(anchor.x, this.headHeightOf(index), anchor.z);
          this.effects.drip(this.tmpHead, severity, current.reducedMotion, index);
        } else if (severity > POOL_SEVERITY && fighter.is_downed && current.blood !== "off") {
          // A pool spreads from under his head through the count.
          this.effects.stopDrip(index);
          this.downedPoolAccumulators[index]! += dt * POOL_RATE;
          const head = this.headCacheValid[index] ? this.headCache[index]! : index === 0 ? this.tmpA : this.tmpB;
          while (this.downedPoolAccumulators[index]! >= 1) {
            this.downedPoolAccumulators[index]! -= 1;
            const count = this.downedPoolCounts[index]!;
            this.downedPoolCounts[index] = count + 1;
            const spread = poolRadius(count, severity);
            const angle = count * 2.399_963 + index * Math.PI;
            this.effects.pool(head.x + Math.sin(angle) * spread * 0.25, head.z + Math.cos(angle) * spread * 0.25, spread, count + index * 7);
          }
        } else {
          this.effects.stopDrip(index);
          this.downedPoolAccumulators[index] = 0;
          if (!fighter.is_downed) this.downedPoolCounts[index] = 0;
        }
      }
    } else {
      this.tmpA.set(-0.9, 0, 0);
      this.tmpB.set(0.9, 0, 0);
      this.updateIdleFighters(dt, seconds, sampledTick);
    }

    this.arena.update(seconds, dt, current.reducedMotion);
    this.effects.update(actorDt);
    this.updateTrails(actorDt, current.reducedMotion);
    this.updateReferee(actorDt, seconds, snapshot, sampledTick);
    this.updateCornermen(actorDt, seconds, snapshot, sampledTick);
    this.updateCutmen(actorDt, seconds, snapshot, sampledTick);
    this.updateBlobShadows();
    this.fireContacts(sampledTick);
    if (this.followSpot !== null) {
      this.followSpot.target.position.set((this.tmpA.x + this.tmpB.x) / 2, 1.0, (this.tmpA.z + this.tmpB.z) / 2);
    }
    const directed = this.director.update(
      dt,
      seconds,
      { x: this.tmpA.x, z: this.tmpA.z },
      { x: this.tmpB.x, z: this.tmpB.z },
      separation,
      knockdown,
      this.effects.shakeAmount,
      current.reducedMotion,
    );
    const replaying = this.replay;
    const frame: { position: THREE.Vector3; lookAt: THREE.Vector3; tight?: boolean; framed?: boolean } = this.cameraOverride ?? (replaying !== null && snapshot !== null ? this.replayFrame(snapshot, seconds - replaying.startedAt) : (this.closeUpFrame(seconds) ?? this.cornerShotFrame(seconds, snapshot, current.reducedMotion) ?? this.ceremonyFrame(seconds) ?? directed));
    if (this.cameraOverride === null && this.portraitPull > 1 && frame.framed !== true) {
      const tight = frame.tight === true;
      const pull = this.portraitPull / Math.min(1.3, Math.sqrt(this.portraitPull));
      const distanceScale = tight ? Math.min(pull, 1.25) : pull;
      this.tmpCamera.subVectors(frame.position, frame.lookAt).multiplyScalar(distanceScale);
      this.camera.position.copy(frame.lookAt).add(this.tmpCamera);
      if (tight) {
        this.camera.position.x = THREE.MathUtils.clamp(this.camera.position.x, -TIGHT_SHOT_LIMIT, TIGHT_SHOT_LIMIT);
        this.camera.position.z = THREE.MathUtils.clamp(this.camera.position.z, -TIGHT_SHOT_LIMIT, TIGHT_SHOT_LIMIT);
      }
      this.camera.lookAt(frame.lookAt.x, frame.lookAt.y - (this.portraitPull - 1) * (tight ? 0.08 : 0.45), frame.lookAt.z);
    } else {
      this.camera.position.copy(frame.position);
      this.camera.lookAt(frame.lookAt);
    }
    this.effects.setViewDistance(this.camera.position.distanceTo(frame.lookAt));
    // The broadcast camera and the announcement look through the near ropes; every other shot is from inside them.
    const solid = frame === directed ? nearRopeOpacityFor(Math.max(this.tmpA.z, this.tmpB.z)) : frame.framed === true ? ANNOUNCEMENT_ROPE_OPACITY : 1;
    this.ring.setNearRopeOpacity(this.ring.nearRopeOpacity() + (solid - this.ring.nearRopeOpacity()) * (1 - Math.exp(-6 * dt)));

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
    // The player's own punch starts here before the server has it, and holds the feet from then on.
    if (index >= 0 && held !== null && snapshot.phase === "fight" && this.graphs?.[index]?.ownPunchActive !== true) {
      target = predictMovement(snapshot.fighters[index]!, held, this.buffer.interpolationDelayTicks + 2, snapshot.tick);
    }
    this.localOffset.dx += (target.dx - this.localOffset.dx) * rate;
    this.localOffset.dy += (target.dy - this.localOffset.dy) * rate;
    if (index < 0 || (Math.abs(this.localOffset.dx) < 0.01 && Math.abs(this.localOffset.dy) < 0.01)) return snapshot;
    const viewer = snapshot.fighters[index]!;
    const predicted = { ...viewer, x: viewer.x + this.localOffset.dx, y: viewer.y + this.localOffset.dy };
    const fighters: [FighterSnapshot, FighterSnapshot] = index === 0 ? [predicted, snapshot.fighters[1]] : [snapshot.fighters[0], predicted];
    return { ...snapshot, fighters };
  }

  /** The newest snapshot may already carry a punch the delayed clock has not reached; a fighter on the canvas throws none. */
  private anticipatePunches(latest: EngineSnapshot | null, sampledTick: number): void {
    if (this.replay !== null || latest === null || latest.phase !== "fight") return;
    for (const [index, graph] of (this.graphs ?? []).entries()) {
      const ahead = latest.fighters[index];
      if (ahead !== undefined && !ahead.is_downed) graph.anticipate(ahead, ahead.action_start_tick - sampledTick);
    }
  }

  /** Keeps the crowd on its feet for a while after the result. */
  private cheer(seconds: number, dt: number): void {
    if (seconds < this.ovationUntil) this.arena.excite(dt * CROWD_OVATION_RATE);
  }

  /** Gives the fighter in a seat the look of the player who holds it. */
  private wearLook(index: 0 | 1, playerId: string): void {
    if (this.lookIds[index] === playerId) return;
    this.lookIds[index] = playerId;
    this.graphs?.[index]?.boxer.setLook(lookFor(playerId));
  }

  /** The fighters as drawn: eased apart when the engine has them closer than two bodies can stand. */
  private standApart(fighters: readonly [FighterSnapshot, FighterSnapshot]): readonly [FighterSnapshot, FighterSnapshot] {
    const [a, b] = fighters;
    const tied = [a, b].some((fighter) => fighter.clinch_ticks > 0 || fighter.clinch_startup_ticks > 0 || fighter.is_downed);
    const apart = tied ? null : visualSeparation(a.x, a.y, b.x, b.y, DRAWN_MINIMUM_GAP, RING_HALF_WIDTH - FIGHTER_RADIUS, RING_HALF_HEIGHT - FIGHTER_RADIUS);
    if (apart === null) return fighters;
    return [Object.assign(this.drawnFighters[0], a, { x: apart.ax, y: apart.ay }), Object.assign(this.drawnFighters[1], b, { x: apart.bx, y: apart.by })];
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
    const clinched = snapshot?.fighters.some((fighter) => fighter.clinch_ticks > 0 || fighter.clinch_startup_ticks > 0) ?? false;
    const focusX = downed !== null ? this.mapping.x(downed.x) : (this.tmpA.x + this.tmpB.x) / 2;
    const focusZ = downed !== null ? this.mapping.z(downed.y) : (this.tmpA.z + this.tmpB.z) / 2;
    const away = this.refereeAway.set(this.refereePosition.x - focusX, 0, this.refereePosition.z - focusZ);
    if (away.lengthSq() < 0.01) away.set(0, 0, -1);
    away.normalize();
    const { standoff, clearance } = refereeSpacing(downed !== null, clinched);
    const targetX = THREE.MathUtils.clamp(focusX + away.x * standoff, -2.4, 2.4);
    const targetZ = THREE.MathUtils.clamp(focusZ + away.z * standoff, -2.4, 2.4);
    const previousX = this.refereePosition.x;
    const previousZ = this.refereePosition.z;
    const ceremony = this.replay === null && this.ceremony?.positions !== null ? this.ceremony : null;
    if (ceremony !== null) {
      // The referee walks to the mark between the fighters and turns to the camera.
      const step = ceremonyStep(this.refereePosition.x, this.refereePosition.z, { x: CEREMONY_REFEREE.x, y: CEREMONY_REFEREE.z }, CEREMONY_REFEREE_SPEED * dt);
      this.refereePosition.x = step.x;
      this.refereePosition.z = step.y;
      ceremony.refereeArrived = step.arrived;
    } else {
      const rate = 1 - Math.exp(-1.6 * dt);
      this.refereePosition.x += (targetX - this.refereePosition.x) * rate;
      this.refereePosition.z += (targetZ - this.refereePosition.z) * rate;
    }
    for (const fighter of ceremony !== null ? [] : [this.tmpA, this.tmpB]) {
      const dx = this.refereePosition.x - fighter.x;
      const dz = this.refereePosition.z - fighter.z;
      const distance = Math.hypot(dx, dz);
      if (distance < clearance && distance > 0.001) {
        this.refereePosition.x = fighter.x + (dx / distance) * clearance;
        this.refereePosition.z = fighter.z + (dz / distance) * clearance;
      }
    }
    // Nobody stands over a head on the canvas.
    for (const index of [0, 1]) {
      if (!this.effects.severedHeadPosition(index, this.closeUpTarget)) continue;
      const step = keepClear(this.refereePosition.x, this.refereePosition.z, this.closeUpTarget.x, this.closeUpTarget.z, HEAD_CLEARANCE);
      this.refereePosition.x = step.x;
      this.refereePosition.z = step.z;
    }
    if (dt > 0) {
      this.refereeVelocity.set((this.refereePosition.x - previousX) / dt, 0, (this.refereePosition.z - previousZ) / dt);
    }
    const walking = ceremony !== null && !ceremony.refereeArrived;
    const yaw = ceremony === null ? Math.atan2(focusX - this.refereePosition.x, focusZ - this.refereePosition.z)
      : walking ? Math.atan2(CEREMONY_REFEREE.x - this.refereePosition.x, CEREMONY_REFEREE.z - this.refereePosition.z) : 0;
    const yawDelta = ((yaw - this.refereeYaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    this.refereeYaw += yawDelta * (1 - Math.exp(-3 * dt));
    const state = refereeSnapshot(this.refereePosition, this.refereeYaw, this.refereeVelocity, this.mapping);
    referee.setRefereeCount(downed !== null, downed?.get_up_count ?? 0);
    referee.update(state.self, state.focus, dt, time, false, "off", sampledTick);
  }

  private updateTrails(dt: number, reducedMotion: boolean): void {
    const graphs = this.graphs;
    if (graphs === null || this.trails.length < 4) return;
    for (const [index, graph] of graphs.entries()) {
      for (const [gloveIndex, bone] of (["gloveL", "gloveR"] as const).entries()) {
        const trail = this.trails[index * 2 + gloveIndex]!;
        if (!graph.boxer.root.visible) {
          trail.reset();
          continue;
        }
        graph.boxer.rig.bones[bone].getWorldPosition(this.trailGlove);
        trail.update(this.trailGlove, dt, this.camera.position, !reducedMotion && this.replay === null);
      }
    }
  }

  /** Cornermen stand on the apron outside their fighter's corner and lean in during the rest. */
  private updateCornermen(dt: number, time: number, snapshot: EngineSnapshot | null, sampledTick: number): void {
    const cornermen = this.cornermen;
    if (cornermen === null) return;
    const resting = cornersAtWork(snapshot, this.simulation.tick_rate);
    for (const [index, graph] of cornermen.entries()) {
      const sign = index === 0 ? -1 : 1;
      const reach = resting ? CORNERMAN_WORK_DISTANCE : CORNERMAN_APRON_DISTANCE;
      this.cornermanPosition.set(sign * reach, 0, -sign * reach);
      const yaw = index === 0 ? (3 * Math.PI) / 4 : -Math.PI / 4;
      graph.attend(resting);
      const state = refereeSnapshot(this.cornermanPosition, yaw, this.cornermanVelocity, this.mapping);
      graph.update(state.self, state.focus, dt, time, false, "off", sampledTick);
    }
  }

  /** Between rounds each cutman climbs in from the apron, crouches before the seated fighter and works the worse eye, then climbs back out for the bell. */
  private updateCutmen(dt: number, time: number, snapshot: EngineSnapshot | null, sampledTick: number): void {
    const cutmen = this.cutmen;
    const graphs = this.graphs;
    if (cutmen === null || graphs === null) return;
    const resting = snapshot?.phase === "rest";
    const corner = this.mapping.x(REST_CORNER_OFFSET);
    for (const [index, graph] of cutmen.entries()) {
      const sign = index === 0 ? -1 : 1;
      const wanted = resting && graphs[index]!.stoolVisible ? 1 : 0;
      const progress = this.cutmanProgress[index]!;
      const next = progress + Math.sign(wanted - progress) * Math.min(Math.abs(wanted - progress), dt / CUTMAN_WALK_SECONDS);
      this.cutmanProgress[index] = next;
      const wasVisible = graph.boxer.root.visible;
      graph.boxer.root.visible = next > 0.005;
      if (!graph.boxer.root.visible) continue;
      this.cutmanFrom.set(sign * CORNERMAN_APRON_DISTANCE, 0, -sign * (CORNERMAN_APRON_DISTANCE - 1));
      cornerPoint(index === 0 ? 0 : 1, corner, CUTMAN_WORK_DISTANCE, CUTMAN_WORK_DEGREES, this.cutmanTo);
      const eased = next * next * (3 - 2 * next);
      this.cornermanPosition.copy(this.cutmanFrom).lerp(this.cutmanTo, eased);
      const last = this.cutmanLast[index]!;
      if (!wasVisible) last.copy(this.cornermanPosition);
      this.cornermanVelocity.copy(this.cornermanPosition).sub(last).divideScalar(Math.max(dt, 1e-3));
      last.copy(this.cornermanPosition);
      const travelling = next > 0.02 && next < CUTMAN_IN_PLACE;
      const head = this.headCacheValid[index] ? this.headCache[index]! : null;
      const yaw = travelling
        ? Math.atan2(this.cutmanTo.x - this.cutmanFrom.x, this.cutmanTo.z - this.cutmanFrom.z) + (wanted === 1 ? 0 : Math.PI)
        : next >= CUTMAN_IN_PLACE
          ? (head !== null ? Math.atan2(head.x - this.cutmanTo.x, head.z - this.cutmanTo.z) : Math.atan2(sign, -sign))
          : Math.atan2(-this.cutmanFrom.x, -this.cutmanFrom.z);
      const trauma = snapshot?.fighters[index]?.trauma;
      const side = trauma !== undefined && trauma.right_eye + trauma.right_cut > trauma.left_eye + trauma.left_cut ? -1 : 1;
      if (next >= CUTMAN_IN_PLACE && head !== null) {
        const fighterYaw = graphs[index]!.boxer.root.rotation.y;
        this.cutmanFacing.set(Math.sin(fighterYaw), 0, Math.cos(fighterYaw));
        this.cutmanEye.copy(head).addScaledVector(this.cutmanFacing, 0.09);
        this.cutmanEye.x += Math.cos(fighterYaw) * side * 0.035;
        this.cutmanEye.z -= Math.sin(fighterYaw) * side * 0.035;
        this.cutmanEye.y += 0.08;
        graph.treat(this.cutmanEye, this.cutmanFacing, side);
      } else {
        graph.treat(null);
      }
      const state = refereeSnapshot(this.cornermanPosition, yaw, this.cornermanVelocity, this.mapping);
      graph.update(state.self, state.focus, dt, time, false, "off", sampledTick);
    }
  }

  private drawHudOverlay(snapshot: EngineSnapshot | null): void {
    const resized = resizeHighDpi(this.hudCanvas);
    if (resized === null) return;
    const { context: ctx, viewport } = resized;
    this.hudViewport.width = viewport.width;
    this.hudViewport.height = viewport.height;
    ctx.clearRect(0, 0, viewport.width, viewport.height);
    if (snapshot === null) return;
    if (this.viewerHitFlash > 0.01 && !this.settings().reducedMotion) {
      const flash = ctx.createRadialGradient(viewport.width / 2, viewport.height / 2, viewport.width * 0.12, viewport.width / 2, viewport.height / 2, viewport.width * 0.7);
      flash.addColorStop(0, `rgba(255,235,225,${(this.viewerHitFlash * 0.18).toFixed(3)})`);
      flash.addColorStop(1, `rgba(140,0,10,${(this.viewerHitFlash * 0.55).toFixed(3)})`);
      ctx.fillStyle = flash;
      ctx.fillRect(0, 0, viewport.width, viewport.height);
    }
    const hurt = Math.max(...snapshot.fighters.map((fighter) => fighter.trauma.head + fighter.trauma.body));
    if (hurt > 350) {
      const vignette = ctx.createRadialGradient(viewport.width / 2, viewport.height / 2, viewport.width * 0.2, viewport.width / 2, viewport.height / 2, viewport.width * 0.72);
      vignette.addColorStop(0, "rgba(90,0,8,0)");
      vignette.addColorStop(1, `rgba(75,0,8,${Math.min(0.3, hurt / 4600)})`);
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, viewport.width, viewport.height);
    }
    drawHud(ctx, viewport.width, viewport.height, snapshot, this.players, this.viewerId, this.frameSeconds >= this.finalRevealAt ? this.final : null, this.reconnectMs, this.simulation.tick_rate, this.roundStats, this.replay !== null ? "KNOCKOUT REPLAY" : null, this.inputLatencyMs, this.frameSeconds < this.roundCalloutUntil ? `ROUND ${this.roundCalloutRound}` : null, this.roundClock.ticks(snapshot), (player) => this.avatars.get(player));
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
    this.avatars.dispose();
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
    for (const trail of this.trails) {
      this.scene.remove(trail.mesh);
      trail.dispose();
    }
    this.trails = [];
    if (this.cornermen !== null) {
      for (const graph of this.cornermen) {
        this.scene.remove(graph.boxer.root);
        graph.dispose();
      }
      this.cornermen = null;
    }
    if (this.cutmen !== null) {
      for (const graph of this.cutmen) {
        this.scene.remove(graph.boxer.root);
        graph.dispose();
      }
      this.cutmen = null;
    }
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
