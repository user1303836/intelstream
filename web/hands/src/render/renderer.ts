import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { EventDeduplicator, SnapshotBuffer } from "../interpolation";
import { coarsePointer } from "../input/touch";
import { FIGHTER_RADIUS, REST_CORNER_OFFSET, RING_HALF_HEIGHT, RING_HALF_WIDTH, punchTiming, styleTiming } from "../manifest";
import { EVASION_STAMINA, EVASION_TICKS, EvasionPrediction, MovementPrediction, attackTicksRemaining, constrainPrediction, isEvasion, predictedDefense, predictedPunchTiming, type HeldInput } from "../prediction";
import type { BloodLevel, Settings } from "../settings";
import type { CombatEvent, EngineSnapshot, FighterSnapshot, FinalMessage, Hand, MatchResult, PublicPlayer, PunchClass, SemanticAction, SimulationInfo } from "../types";
import { buildArena, type BuiltArena } from "./arena";
import { CameraDirector, CUTMAN_WORK_DEGREES, CUTMAN_WORK_DISTANCE, FIGHTER_CAM_FOV_SCALE, FighterCam, SECONDS_OUT, ceremonyShot, cornerFrame, cornerPoint, cornerShot, cornerShotProgress } from "./camera";
import { Avatars } from "./avatars";
import { captionSlot, drawCaption } from "./caption";
import { CommentaryDirector, type CrowdCue } from "./commentary";
import { Effects3D, type BakedPart, type SprayDirection } from "./effects";
import { BoxingGraph, SkinnedBoxer, loadBoxerGlb, releaseFighterGpu, type ArcadeDislocation, type CutmanProp } from "./graph";
import { drawHud, finalRevealDelay, hudScale, resultCard, resultCardLayout, RoundStatsTracker, STOPPAGE_METHODS, RoundClock, type RoundPunchStats } from "./hud";
import { BURST_CUT_HEIGHT, EYE_LIDS, NECK_CUT_DEPTH, NECK_CUT_HEIGHT, NECK_CUT_SLOPE } from "./injury";
import { BIG_SHOT, closeCut, cutRim, teethFor } from "./gore";
import { mouthpieceFlies } from "./mouthpiece";
import { OFFICIAL_LOOKS, lookFor, lookShape, type FighterLook } from "./looks";
import { BLUE_CORNER_OUTFIT, CUTMAN_OUTFIT, RED_CORNER_OUTFIT, REFEREE_OUTFIT } from "./outfit";
import { ResolutionScaler } from "./quality";
import { RockedVision, rockedLevel } from "./rocked";
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

/** Phases the player's own over-the-shoulder camera is used in; counts, rests and the finish go to the broadcast. */
export function ownViewPhase(snapshot: Pick<EngineSnapshot, "phase"> | null): boolean {
  return snapshot !== null && (snapshot.phase === "countdown" || snapshot.phase === "fight" || snapshot.phase === "foul_recovery");
}

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

/** EffectComposer.dispose frees only its own targets; each pass (bloom keeps a chain of them) is freed too. */
export function disposeComposer(composer: { readonly passes: readonly { dispose?: () => void }[]; dispose(): void }): void {
  for (const pass of composer.passes) pass.dispose?.();
  composer.dispose();
}

/**
 * Compiles a scene's shaders for the composer's own target (linear, without tone mapping), which is
 * what the scene is drawn into; compiled for the screen they would be variants the frame never uses.
 */
export function compileForComposer(
  renderer: Pick<THREE.WebGLRenderer, "setRenderTarget" | "compileAsync">,
  composer: { readonly readBuffer: THREE.WebGLRenderTarget },
  staging: THREE.Object3D,
  camera: THREE.Camera,
  scene: THREE.Scene,
): Promise<unknown> {
  renderer.setRenderTarget(composer.readBuffer);
  // compileAsync builds the programs before it returns, so the target can be let go at once.
  const compiled = renderer.compileAsync(staging, camera, scene);
  renderer.setRenderTarget(null);
  return compiled;
}

const KEY_SHADOW_BIAS = -0.0004;
/** Past the shadow camera's far plane, so every lit pixel skips the shadow lookups. */
const SKIPPED_SHADOW_BIAS = 10;

/**
 * Sets the key light's shadow for a quality tier without touching castShadow, which is part of every
 * material's program key: flipping it would recompile every shader in one frame on the slowest
 * devices. Turned off, the shadow stops being drawn, its depth target is freed, and it is hidden.
 */
export function setKeyShadowTier(shadow: THREE.LightShadow, off: boolean, size: number): void {
  shadow.autoUpdate = !off;
  shadow.intensity = off ? 0 : 1;
  shadow.bias = off ? SKIPPED_SHADOW_BIAS : KEY_SHADOW_BIAS;
  if ((off && shadow.map !== null) || shadow.mapSize.x !== size) {
    shadow.mapSize.set(size, size);
    shadow.map?.dispose();
    shadow.map = null;
  }
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

/**
 * The way a punch travelled in the world, from the puncher to the recipient, for its blood, teeth and
 * severed parts. Hit events only carry the sign of the puncher's world-x facing, which is wrong
 * whenever the fighters exchange along any other line of the square ring; undefined leaves effects
 * to that sign, when a fighter is missing or the two stand on the same spot.
 */
export function sprayDirection(puncher: FighterSnapshot | undefined, recipient: FighterSnapshot | undefined, mapping: WorldMapping): SprayDirection | undefined {
  if (puncher === undefined || recipient === undefined) return undefined;
  const x = mapping.x(recipient.x) - mapping.x(puncher.x);
  const z = mapping.z(recipient.y) - mapping.z(puncher.y);
  const length = Math.hypot(x, z);
  return Number.isFinite(length) && length > 1e-3 ? { x: x / length, z: z / length } : undefined;
}

export interface ContactPresentation {
  readonly event: CombatEvent;
  readonly presentationEvent: CombatEvent;
  readonly presentImpact: boolean;
  /** How hard the recipient reacts, or null when the punch's own entry already reacts to it. */
  readonly reactAmount: number | null;
}

const isHit = (event: CombatEvent): boolean => event.kind === "hit" || event.kind === "counter_hit";
const isBlock = (event: CombatEvent): boolean => event.kind === "block" || event.kind === "perfect_block";
const HISTORY_LIMIT = 480;
const LOW_TIER_SCALE = 0.56;
const ROUND_CALLOUT_SECONDS = 1.8;
const FINISH_CLOSE_UP_SECONDS = 1.7;
/** On a screen narrower than this (as a pull), the rest's wide shot looks down the ring's diagonal, from this far behind the near fighter and this high. */
const REST_DIAGONAL_PULL = 1.6;
const REST_DIAGONAL_BACK = 5;
const REST_DIAGONAL_HEIGHT = 3.4;
/** After a stoppage the winner celebrates until the bout is gone, and the referee lifts his arm once the fight is waved off. */
const WINNER_CELEBRATION_SECONDS = 600;
const STOPPAGE_RAISE_DELAY_SECONDS = 2.8;
const STOPPAGE_RAISE_SPACING = 0.6;
/** Longest a finish waits for its punch to be shown (the render clock runs at most 6 ticks behind). */
const FINISH_WAIT_LIMIT_SECONDS = 0.5;
const CORNERMAN_APRON_DISTANCE = 3.42;
/** Close cameras stay inside the rope line (posts stand at 2.46 m) so a rope never fills the lens. */
const TIGHT_SHOT_LIMIT = 2.2;
/** How far the referee keeps from a head on the canvas. */
const HEAD_CLEARANCE = 0.9;
/** Knockdown detail for a body shot that drops a fighter to one knee. */
const BODY_KNOCKDOWN = "body";
/** The referee keeps this far from any part of a fighter lying on the canvas. */
const BODY_CLEARANCE = 0.55;
/** How far the standing fighter's middle keeps from any part of a body on the canvas, so his feet are off it. */
const STANDING_BODY_CLEARANCE = 0.5;
/** How far from someone on their feet a close-up has to pass to see past them. */
const STANDING_BLOCK_RADIUS = 0.5;
/** Parts of a body lying on the canvas that a close-up of its head does not shoot across. */
const FALLEN_BLOCK_RADIUS = 0.28;
/** The engine lets fighters stand 76 units apart, which puts two drawn bodies inside each other. */
const DRAWN_MINIMUM_GAP = 104;
const CORNERMAN_WORK_DISTANCE = 2.95;
/** Metres per second the referee steps in at to break a clinch. */
const REFEREE_BREAK_SPEED = 2.4;
const CUTMAN_WALK_SECONDS = 1.6;
const CUTMAN_IN_PLACE = 0.98;
// Broadcast finish: a soft vignette and a whisper of grain, applied before tone mapping.
const BROADCAST_FINISH_SHADER = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVignette: { value: 0.32 }, uGrain: { value: 0.035 }, uRocked: { value: 0 } },
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
uniform float uRocked;
varying vec2 vUv;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7)) + uTime * 43.7) * 43758.5453);
}
void main() {
  vec4 color = texture2D(tDiffuse, vUv);
  vec2 centered = vUv - 0.5;
  if (uRocked > 0.001) {
    // Hurt vision: a softened picture with a second image drifting off it, drained of colour.
    vec2 spread = vec2(0.0035, 0.0) * uRocked;
    vec3 soft = (texture2D(tDiffuse, vUv + spread).rgb + texture2D(tDiffuse, vUv - spread).rgb + texture2D(tDiffuse, vUv + spread.yx * 1.6).rgb + texture2D(tDiffuse, vUv - spread.yx * 1.6).rgb) * 0.25;
    vec3 ghost = texture2D(tDiffuse, vUv + vec2(sin(uTime * 2.3), cos(uTime * 1.7)) * 0.011 * uRocked).rgb;
    color.rgb = mix(color.rgb, mix(soft, ghost, 0.5), 0.75 * uRocked);
    color.rgb = mix(color.rgb, vec3(dot(color.rgb, vec3(0.299, 0.587, 0.114))), 0.65 * uRocked);
  }
  float falloff = smoothstep(0.35, 0.95, dot(centered, centered) * 2.2);
  color.rgb *= 1.0 - falloff * uVignette;
  color.rgb *= mix(vec3(1.0), vec3(0.5, 0.1, 0.08), smoothstep(0.08, 0.9, dot(centered, centered) * 2.2) * uRocked * 0.85);
  float grain = (hash(floor(vUv * vec2(960.0, 540.0))) - 0.5) * uGrain;
  color.rgb += grain * (0.15 + color.rgb);
  gl_FragColor = color;
}`,
};
/** Where the fighters stand for the decision, in engine units: either side of the referee, facing the camera. */
export const CEREMONY_MARKS = [{ x: -102, y: -16 }, { x: 102, y: -16 }] as const;
const SEAT_MARKS = [0, 1] as const;
/** While he walks to his mark the referee keeps this far from the fighters, who stand 0.62 m either side of it. */
const CEREMONY_WALK_CLEARANCE = 0.5;
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
  /** The mark each seat walks to: the one on his own side, so fighters who ended the bout on each other's side never cross. */
  marks?: readonly [0 | 1, 0 | 1];
  refereeArrived: boolean;
  arrivedAt: number | null;
  announced: boolean;
}

/** The crowd stays on its feet from the result until the replay and the verdict have played out. */
const CROWD_OVATION_SECONDS = 16;
const CROWD_OVATION_RATE = 0.6;
const CROWD_EXCITEMENT: Readonly<Record<string, number>> = { hit: 0.18, counter_hit: 0.3, guard_break: 0.25, knockdown: 1, block: 0.04, perfect_block: 0.1, parry: 0.22, body_collapse: 0.45 };
/** Events presented on the contact tick of the punch they belong to, alongside its impact. */
const CONTACT_KINDS = new Set(["hit", "counter_hit", "block", "perfect_block", "guard_break", "knockdown", "parry", "body_collapse", "eye_shut"]);
/** Events that change how a fighter moves or what the broadcast says, but carry no impact of their own. */
const UNIMPACTFUL_KINDS = new Set(["parry", "body_collapse", "eye_shut"]);
const BOX_CALLOUT_SECONDS = 1.2;
const EVENT_CALLOUTS: Readonly<Record<string, { readonly text: string; readonly seconds: number }>> = {
  parry: { text: "PARRIED", seconds: 1 },
  eye_shut: { text: "EYE SWOLLEN SHUT", seconds: 1.6 },
};

/** A knockdown from a body shot that put him down a moment after it landed, with no punch of its own to show. */
export const isDelayedBodyKnockdown = (presentation: CombatEvent): boolean => presentation.kind === "knockdown" && presentation.detail === "body";

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
    if (UNIMPACTFUL_KINDS.has(event.kind)) return { event, presentationEvent: event, presentImpact: false, reactAmount: null };
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
        reactAmount: event.amount,
      };
    }
    if (pairedBlock(event, events) !== undefined) {
      return { event, presentationEvent: event, presentImpact: false, reactAmount: event.amount };
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
          // A knockdown's amount is its count. The punch reacts in its own entry, unless a block took its place.
          reactAmount: pairedBlock(hitEvent, events) === undefined ? null : hitEvent.amount,
        };
      }
    }
    return { event, presentationEvent: event, presentImpact: true, reactAmount: event.amount };
  });
}

/**
 * Where the cutman works and with what, from the corner's instruction: the brow of the worse cut, the
 * worse eye, or the mouth with a bottle. `side` is 1 for the fighter's left, `lift` is metres above the head bone.
 */
export function cutmanWork(fighter: FighterSnapshot | undefined): { readonly side: number; readonly lift: number; readonly lateral: number; readonly prop: CutmanProp } {
  const trauma = fighter?.trauma;
  if (trauma === undefined) return { side: 1, lift: 0.08, lateral: 0.035, prop: "enswell" };
  switch (fighter?.corner_choice) {
    case "cut":
      return { side: trauma.right_cut > trauma.left_cut ? -1 : 1, lift: 0.11, lateral: 0.04, prop: "enswell" };
    case "swelling":
      return { side: trauma.right_eye > trauma.left_eye ? -1 : 1, lift: 0.08, lateral: 0.035, prop: "enswell" };
    case "breath":
      return { side: 1, lift: -0.015, lateral: 0, prop: "bottle" };
    default:
      return { side: trauma.right_eye + trauma.right_cut > trauma.left_eye + trauma.left_cut ? -1 : 1, lift: 0.08, lateral: 0.035, prop: "enswell" };
  }
}

/** The side of the body a punch lands on, from the puncher's action key: a left hand lands on his right side (-1). */
export function bodySideStruck(actionKey: string | null): number {
  return actionKey?.split(":")[1] === "right" ? 1 : -1;
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
  out.position.set(0, 0, 0);
  for (const [at, corner] of edges.entries()) {
    posedHeadVertex(boxer, corner, out.scratch);
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

const cardTops = new WeakMap<FinalMessage, { readonly width: number; readonly height: number; readonly top: number }>();

/**
 * The top of the result card on a screen this size. The caption and the announcement shot ask on every
 * frame, and the card cannot change once the result is in, so it is laid out once per result and screen size.
 */
export function resultCardTop(
  final: FinalMessage,
  width: number,
  height: number,
  fighters: readonly [FighterSnapshot, FighterSnapshot],
  players: Readonly<Record<string, PublicPlayer>>,
  roundStats: Pick<RoundStatsTracker, "total">,
  viewerId: string | null,
): number {
  const known = cardTops.get(final);
  if (known !== undefined && known.width === width && known.height === height) return known.top;
  const punches = fighters.map((fighter) => roundStats.total(fighter.player_id)) as [RoundPunchStats, RoundPunchStats];
  const top = resultCardLayout(width, height, resultCard(final, fighters, players, punches), fighters.some((fighter) => fighter.player_id === viewerId)).y;
  cardTops.set(final, { width, height, top });
  return top;
}

/** A head vertex in world space as the GPU draws it: reshaped by the fighter's look, then posed. */
function posedHeadVertex(boxer: SkinnedBoxer, vertex: number, out: THREE.Vector3): THREE.Vector3 {
  const mesh = boxer.headMesh;
  lookShape(out.fromBufferAttribute(mesh.geometry.getAttribute("position"), vertex), boxer.look, out);
  return mesh.applyBoneTransform(vertex, out).applyMatrix4(mesh.matrixWorld);
}

/** True for the part of the head mesh that leaves with the head. */
export function aboveNeckCut(bind: THREE.Vector3): boolean {
  return bind.y > NECK_CUT_HEIGHT - NECK_CUT_SLOPE * (bind.z - NECK_CUT_DEPTH) - 0.3;
}

const DEFAULT_SIM: SimulationInfo = { tick_rate: 30, ring_half_width: 500, ring_half_height: 500 };

/**
 * Freezes a skinned mesh's current deformed surface into a static geometry
 * expressed relative to `pivot` so it can fly as a rigid severed part. With `rigid`, every vertex
 * follows that bone alone, so skin the part shares with the next bone keeps the part's own shape. A part
 * cut out of its mesh by `keep` (a severed head) keeps the mesh's numbering, which its cut's rim uses; a
 * whole part keeps only the vertices its triangles use: each glove of the model indexes its own half of a
 * vertex buffer the two gloves share.
 */
export function bakeSkinnedPart(
  mesh: THREE.SkinnedMesh,
  pivotPosition: THREE.Vector3,
  pivotQuaternion: THREE.Quaternion,
  keep?: (bind: THREE.Vector3) => boolean,
  look?: FighterLook,
  rigid?: THREE.Bone,
): BakedPart {
  const source = mesh.geometry;
  const positions = source.getAttribute("position");
  const index = source.getIndex();
  // The source vertex behind each baked vertex, and for a whole part its triangles renumbered to them.
  const kept: number[] = [];
  const triangles: number[] | null = index !== null && keep === undefined ? [] : null;
  if (index === null || triangles === null) {
    for (let vertex = 0; vertex < positions.count; vertex += 1) kept.push(vertex);
  } else {
    const renumbered = new Int32Array(positions.count).fill(-1);
    for (let corner = 0; corner < index.count; corner += 1) {
      const vertex = index.getX(corner);
      if (renumbered[vertex]! < 0) renumbered[vertex] = kept.push(vertex) - 1;
      triangles.push(renumbered[vertex]!);
    }
  }
  const baked = new Float32Array(kept.length * 3);
  const vertex = new THREE.Vector3();
  const inverse = pivotQuaternion.clone().invert();
  mesh.updateMatrixWorld(true);
  const bone = rigid === undefined ? -1 : mesh.skeleton.bones.indexOf(rigid);
  const follow = bone < 0 ? null : new THREE.Matrix4().multiplyMatrices(mesh.bindMatrixInverse, new THREE.Matrix4().multiplyMatrices(mesh.skeleton.bones[bone]!.matrixWorld, mesh.skeleton.boneInverses[bone]!)).multiply(mesh.bindMatrix);
  for (const [target, from] of kept.entries()) {
    vertex.fromBufferAttribute(positions, from);
    // A head is drawn reshaped by its owner's look; the severed head keeps that shape.
    if (look !== undefined) lookShape(vertex, look, vertex);
    if (follow !== null) vertex.applyMatrix4(follow);
    else mesh.applyBoneTransform(from, vertex);
    vertex.applyMatrix4(mesh.matrixWorld).sub(pivotPosition).applyQuaternion(inverse);
    baked[target * 3] = vertex.x;
    baked[target * 3 + 1] = vertex.y;
    baked[target * 3 + 2] = vertex.z;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(baked, 3));
  // The shading of a baked part reads its bind positions, numbered as the baked vertices are.
  if (triangles === null) geometry.setAttribute("bindPosition", positions.clone());
  else {
    const bind = new Float32Array(kept.length * 3);
    for (const [target, from] of kept.entries()) bind.set([positions.getX(from), positions.getY(from), positions.getZ(from)], target * 3);
    geometry.setAttribute("bindPosition", new THREE.BufferAttribute(bind, 3));
  }
  const uv = source.getAttribute("uv");
  if (uv !== undefined && triangles === null) geometry.setAttribute("uv", uv.clone());
  else if (uv !== undefined) {
    const uvs = new Float32Array(kept.length * 2);
    for (const [target, from] of kept.entries()) {
      uvs[target * 2] = uv.getX(from);
      uvs[target * 2 + 1] = uv.getY(from);
    }
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  }
  if (index !== null && keep !== undefined) {
    const held = new Uint8Array(positions.count);
    for (let at = 0; at < positions.count; at += 1) held[at] = keep(vertex.fromBufferAttribute(positions, at)) ? 1 : 0;
    const whole: number[] = [];
    for (let at = 0; at < index.count; at += 3) {
      const a = index.getX(at), b = index.getX(at + 1), c = index.getX(at + 2);
      if (held[a] === 1 && held[b] === 1 && held[c] === 1) whole.push(a, b, c);
    }
    geometry.setIndex(whole);
  } else if (triangles !== null) geometry.setIndex(triangles);
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

/** A severed head as it leaves the neck: the head bone's own shape of it, in its owner's look, measured from the given pivot. */
export function bakeSeveredHead(boxer: SkinnedBoxer, pivotPosition: THREE.Vector3, pivotQuaternion: THREE.Quaternion): BakedPart {
  return { ...bakeSkinnedPart(boxer.headMesh, pivotPosition, pivotQuaternion, aboveNeckCut, boxer.look, boxer.bone("head") ?? undefined), look: boxer.look };
}

function blankFighter(playerId: string): FighterSnapshot {
  return {
    player_id: playerId, x: 0, y: 0, facing: 1, facing_x: 1000, facing_y: 0, velocity_x: 0, velocity_y: 0,
    stance: "orthodox", style: "balanced", defense: "guard_high", stamina: 1000, maximum_stamina: 1000, conditioning: 1000, guard: 700, poise: 600,
    trauma: { head: 0, body: 0, left_eye: 0, right_eye: 0, left_cut: 0, right_cut: 0, swelling: 0, bleeding: 0 },
    knockdowns: 0, warnings: 0, deductions: 0, stunned_ticks: 0, is_downed: false,
    action: null, action_hand: null, action_target: null, action_power: null, action_id: null, action_key: null,
    action_start_tick: 0, action_startup_ticks: 0, action_active_ticks: 0, action_recovery_ticks: 0, action_contact_tick: null,
    queued_actions: 0, clinch_startup_ticks: 0, clinch_ticks: 0, is_foul_recovery_target: false, taunt_ticks: 0, corner_choice: null,
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
  posedHeadVertex(boxer, eyeVertex(mesh.geometry, side), position);
  head.getWorldQuaternion(turn);
  forward.set(0, 0, 1).applyQuaternion(turn);
  position.addScaledVector(forward, -0.004);
  return true;
}

/** How far the referee stands from the action and how close he may get to a fighter: tight over a count, in close for a clinch, between the two to break it, otherwise out of the way. */
export function refereeSpacing(downed: boolean, clinched: boolean, breaking = false): { standoff: number; clearance: number } {
  if (downed) return { standoff: 1.25, clearance: 1.0 };
  if (breaking) return { standoff: 0.45, clearance: 0.5 };
  if (clinched) return { standoff: 1.15, clearance: 0.9 };
  return { standoff: 2.05, clearance: 1.45 };
}

function refereeSnapshot(position: THREE.Vector3, yaw: number, velocity: THREE.Vector3, mapping: WorldMapping): { self: FighterSnapshot; focus: FighterSnapshot } {
  const simX = position.x / mapping.x(1);
  const simY = position.z / mapping.z(1);
  const base: FighterSnapshot = {
    player_id: "referee", x: simX, y: simY, facing: 1, facing_x: Math.round(Math.sin(yaw) * 1000), facing_y: Math.round(-Math.cos(yaw) * 1000),
    velocity_x: velocity.x / mapping.x(1) / 30, velocity_y: velocity.z / mapping.z(1) / 30,
    stance: "orthodox", style: "balanced", defense: "none", stamina: 1000, maximum_stamina: 1000, conditioning: 1000, guard: 700, poise: 600,
    trauma: { head: 0, body: 0, left_eye: 0, right_eye: 0, left_cut: 0, right_cut: 0, swelling: 0, bleeding: 0 },
    knockdowns: 0, warnings: 0, deductions: 0, stunned_ticks: 0, is_downed: false,
    action: null, action_hand: null, action_target: null, action_power: null, action_id: null, action_key: null,
    action_start_tick: 0, action_startup_ticks: 0, action_active_ticks: 0, action_recovery_ticks: 0, action_contact_tick: null,
    queued_actions: 0, clinch_startup_ticks: 0, clinch_ticks: 0, is_foul_recovery_target: false, taunt_ticks: 0, corner_choice: null,
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
  private readonly fighterCam = new FighterCam();
  private ownViewActive = false;
  private readonly ownForward = { x: 0, z: -1 };
  private baseFov = 36;
  private readonly mapping: WorldMapping;
  private readonly buffer: SnapshotBuffer;
  private readonly localInput: (() => HeldInput | null) | null;
  /** Sequence of the input frame that carried a press, once it has gone out; null before then. */
  private readonly inputSequenceOf: ((actionId: string) => number | null) | null;
  private readonly movement = new MovementPrediction();
  private readonly evasion = new EvasionPrediction();
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
  private readonly pixelRatioCap = coarsePointer() ? 1.5 : 2;
  private basePixelRatio = Math.min(this.pixelRatioCap, window.devicePixelRatio || 1);
  private players: Readonly<Record<string, PublicPlayer>> = {};
  private playerOrder: readonly string[] = [];
  private viewerId: string | null = null;
  /** Until this tick the player's own fighter is folding over a body shot and cannot move. */
  private ownCollapseUntil = 0;
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
  private pendingFinish: { readonly final: FinalMessage; readonly tick: number; readonly latestAt: number } | null = null;
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
  /** The seat whose arm the referee lifts after a stoppage, from `stoppageRaiseAt`; -1 for none. */
  private stoppageWinner = -1;
  private stoppageRaiseAt = Number.POSITIVE_INFINITY;
  private readonly stoppageWrist = new THREE.Vector3();
  private readonly stoppageOtherWrist = new THREE.Vector3();
  private readonly closeUpPosition = new THREE.Vector3();
  private roundCalloutUntil = 0;
  private roundCalloutRound = 0;
  private eventCallout: { text: string; until: number } | null = null;
  private readonly tmpCamera = new THREE.Vector3();
  private readonly roundStats = new RoundStatsTracker();
  private readonly history: EngineSnapshot[] = [];
  private lastKnockdown: { readonly knockdown: CombatEvent; readonly hit: CombatEvent | null; readonly finisher: ArcadeInjury | null } | null = null;
  /** A flash knockout ends the bout without a knockdown: the punch that did it and the fighter it put down. */
  private flashKnockout: { readonly hitEventId: number; readonly loserId: string } | null = null;
  private readonly bodyPoint = new THREE.Vector3();
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
    reactAmount: number | null;
    contactTick: number;
    recipientIndex: number;
    puncherIndex: number;
    injury: ArcadeInjury | null;
  }> = [];
  onContact: ((event: CombatEvent) => void) | null = null;
  onArcadeInjury: ((injury: ArcadeInjury, event: CombatEvent) => void) | null = null;
  /** The ring announcer's lines for a voice to read. */
  onAnnouncement: ((lines: readonly string[]) => void) | null = null;
  onCrowdCue: ((cue: CrowdCue) => void) | null = null;
  private readonly commentary = new CommentaryDirector({ speak: (lines) => this.onAnnouncement?.(lines), cue: (cue) => this.onCrowdCue?.(cue) });
  private readonly touchControls = coarsePointer();
  private resultAnnounced = false;
  private captionText = "";
  private readonly rocked = new RockedVision();
  /** The two fighters' places on the canvas for this frame: written by the frame setup only, read by the cameras, the follow spot and the officials. */
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  /** Where a contact's effects go, and the mouth teeth and a gum shield fly from; kept apart from the fighters' places above. */
  private readonly contactPoint = new THREE.Vector3();
  private cornerPanelTop: number | null = null;
  private readonly mouthPoint = new THREE.Vector3();
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
    options: { manualClock?: boolean; localInput?: () => HeldInput | null; inputSequenceOf?: (actionId: string) => number | null } = {},
  ) {
    this.manualClock = options.manualClock === true;
    this.localInput = options.localInput ?? null;
    this.inputSequenceOf = options.inputSequenceOf ?? null;
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
    this.effects = new Effects3D(this.scene, coarsePointer() ? 1024 : 2048);
    this.effects.useUploader(this.renderer);

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
        this.trails = [0x1d4ed8, 0xb91c1c].flatMap((gear) => [0, 1].map(() => new GloveTrail(new THREE.Color(gear).lerp(new THREE.Color(0xffffff), 0.55))));
        // Compile the skinned materials, and the effects that start hidden (glove trails, blood on the
        // canvas, severed parts), off the critical path (parallel shader compile where available) so
        // neither the first frame with fighters nor the first bloody hit stalls the page.
        const staging = new THREE.Group();
        staging.add(first.root, second.root, official.root, blueCorner.root, redCorner.root, blueCutman.root, redCutman.root, ...this.trails.map((trail) => trail.mesh), ...this.effects.compileStandIns());
        try {
          await compileForComposer(this.renderer, this.composer, staging, this.camera, this.scene);
        } catch {
          // Fall back to compiling on the first draw.
        }
        if (this.destroyed) return;
        this.scene.add(first.root, second.root, official.root, blueCorner.root, redCorner.root, blueCutman.root, redCutman.root);
        for (const trail of this.trails) this.scene.add(trail.mesh);
        this.compileShadowsOf(staging);
      })
      .catch((error: unknown) => {
        this.glbLoading = false;
        console.error("boxer_glb_load_failed", error);
      });
  }

  /**
   * The key light's shadow pass draws every caster with one depth material, which compiling the scene's
   * materials does not build, and which only picks its program again when the kind of mesh it draws changes
   * (skinned, instanced or neither): the first severed head or glove drawn after a fighter would compile its
   * variant (its side, its texture) there and then. Each stand-in is drawn into the shadow once here, asking
   * for its own variant as it is drawn, and into the composer's target so the screen never shows them.
   */
  private compileShadowsOf(standIns: THREE.Group): void {
    const key = this.keyLight;
    if (key === null || standIns.children.length === 0) return;
    for (const standIn of standIns.children) {
      standIn.frustumCulled = false;
      standIn.onBeforeShadow = (_renderer, _scene, _camera, _shadowCamera, _geometry, depthMaterial) => {
        depthMaterial.needsUpdate = true;
      };
    }
    this.scene.add(standIns);
    key.shadow.needsUpdate = true;
    this.renderer.setRenderTarget(this.composer.readBuffer);
    try {
      this.renderer.render(this.scene, this.camera);
    } catch {
      // Compiled on first use instead.
    } finally {
      this.renderer.setRenderTarget(null);
      this.scene.remove(standIns);
    }
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

  /** Where the fighter's corner panel starts down the screen while it is up, so the captions keep above it. */
  setCornerPanelTop(top: number | null): void {
    this.cornerPanelTop = top;
  }

  /** The way the player's own camera faces along the canvas while it is in use, so the controls can turn with it. */
  viewForward(): { readonly x: number; readonly z: number } | null {
    if (!this.ownViewActive) return null;
    this.ownForward.x = this.fighterCam.forwardX;
    this.ownForward.z = this.fighterCam.forwardZ;
    return this.ownForward;
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
    this.stoppageWinner = -1;
    this.stoppageRaiseAt = Number.POSITIVE_INFINITY;
    this.ceremony = this.ceremonyFor(final);
    this.finalRevealAt = this.frameSeconds + (this.ceremony === null ? finalRevealDelay(final) : CEREMONY_REVEAL_LIMIT_SECONDS);
    this.ovationUntil = final === null ? 0 : this.frameSeconds + CROWD_OVATION_SECONDS;
    if (final !== null) this.commentary.finish(final, this.players, this.ceremony !== null, this.frameSeconds);
    if (this.ceremony === null) this.endCeremony();
    this.pendingFinish = null;
    if (final === null || !STOPPAGE_METHODS.has(final.method)) return;
    const plan = this.lastKnockdown === null ? null : planKnockoutReplay(this.history, this.lastKnockdown.hit ?? this.lastKnockdown.knockdown, this.simulation.tick_rate);
    const finisher = this.finishingInjury(final);
    if (plan !== null && this.graphs !== null && !this.settings().reducedMotion) {
      // The blow that floored him for the count does its damage at the impact of the replay.
      if (finisher !== null) this.replayInjuries[finisher.index] = { injury: finisher.injury, event: finisher.event };
      this.startReplay(plan);
      return;
    }
    if (finisher !== null) {
      // A finisher whose punch the clock has not shown yet goes with that punch, never ahead of it.
      const waiting = this.pendingContacts.find((contact) => contact.event.event_id === finisher.event.event_id);
      if (waiting !== undefined) waiting.injury ??= finisher.injury;
      else this.applyArcadeInjury(finisher.index, finisher.injury, finisher.event);
    }
    // The result arrives while the screen is still a few ticks behind it, so the finish waits for the
    // punch that ended the bout to be shown.
    const resultTick = this.buffer.latest()?.result?.tick;
    if (resultTick === undefined) this.presentFinish(final);
    else this.pendingFinish = { final, tick: resultTick, latestAt: this.frameSeconds + FINISH_WAIT_LIMIT_SECONDS };
  }

  /** Presents a finish waiting for its punch once the presented tick reaches the result (or the wait runs out). */
  private presentFinishWhenShown(sampledTick: number): void {
    const pending = this.pendingFinish;
    if (pending === null || (sampledTick < pending.tick && this.frameSeconds < pending.latestAt)) return;
    this.pendingFinish = null;
    this.presentFinish(pending.final);
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
    if (ceremony.positions === null) {
      ceremony.positions = [{ x: fighters[0].x, y: fighters[0].y }, { x: fighters[1].x, y: fighters[1].y }];
      ceremony.marks = fighters[0].x <= fighters[1].x ? [0, 1] : [1, 0];
    }
    const marks = ceremony.marks ?? SEAT_MARKS;
    let arrived = ceremony.refereeArrived;
    for (const seat of [0, 1] as const) {
      const from = ceremony.positions[seat];
      const mark = marks[seat];
      const step = ceremonyStep(from.x, from.y, CEREMONY_MARKS[mark], CEREMONY_WALK_SPEED * dt);
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
      this.graphs?.[seat]?.awaitVerdict(mark === 0 ? 1 : -1);
    }
    if (arrived) ceremony.arrivedAt ??= seconds;
    if (!ceremony.announced && ceremony.arrivedAt !== null && seconds - ceremony.arrivedAt >= CEREMONY_PAUSE_SECONDS) {
      ceremony.announced = true;
      this.commentary.verdict(this.frameSeconds);
      for (const seat of [0, 1] as const) this.graphs?.[seat]?.announce(ceremony.winnerSeat === null ? "level" : ceremony.winnerSeat === seat ? "winner" : "loser");
      this.finalRevealAt = Math.min(this.finalRevealAt, this.frameSeconds + 0.35);
      this.arena.excite(1);
    }
    if (ceremony.announced) {
      // The referee holds the wrist where the last frame left it; the fighter on the left mark stands on the referee's right.
      const wrist = (mark: 0 | 1): THREE.Vector3 | null => {
        const seat = marks[0] === mark ? 0 : 1;
        const raised = ceremony.winnerSeat === null || ceremony.winnerSeat === seat;
        const bone = this.graphs?.[seat]?.boxer.rig.bones[mark === 0 ? "gloveL" : "gloveR"];
        return raised && bone !== undefined ? bone.getWorldPosition(this.ceremonyWrists[mark]) : null;
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
    const top = resultCardTop(this.final, width, height, latest.fighters, this.players, this.roundStats, this.viewerId);
    const shot = ceremonyShot(this.camera.aspect, this.camera.fov, (height - top) / Math.max(1, height));
    const drift = this.settings().reducedMotion ? 0 : Math.sin((seconds - ceremony.arrivedAt) * 0.35) * 0.06 * shot.distance;
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
    if (index < 0) return;
    this.graphs?.[index]?.celebrate(WINNER_CELEBRATION_SECONDS);
    this.stoppageWinner = index;
    this.stoppageRaiseAt = this.frameSeconds + STOPPAGE_RAISE_DELAY_SECONDS;
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

  /**
   * Between rounds the fighters sit in opposite corners, too far apart across a phone held upright for
   * any shot from the side. The wide shot there looks down the diagonal from behind the blue corner,
   * the near fighter low in the picture and the far one above him.
   */
  private restWideFrame(snapshot: EngineSnapshot | null): { position: THREE.Vector3; lookAt: THREE.Vector3; framed: boolean } | null {
    if (snapshot?.phase !== "rest" || this.portraitPull <= REST_DIAGONAL_PULL) return null;
    const near = this.tmpA;
    const far = this.tmpB;
    const dx = near.x - far.x;
    const dz = near.z - far.z;
    const apart = Math.hypot(dx, dz);
    if (apart < 1e-3) return null;
    this.cornerPosition.set(near.x + (dx / apart) * REST_DIAGONAL_BACK, REST_DIAGONAL_HEIGHT, near.z + (dz / apart) * REST_DIAGONAL_BACK);
    this.cornerLookAt.set((near.x + far.x) / 2, 0.75, (near.z + far.z) / 2);
    return { position: this.cornerPosition, lookAt: this.cornerLookAt, framed: true };
  }

  /** A short high three-quarter close-up on the beaten fighter's face, or on the head where it came to rest, before the result panel. */
  private closeUpFrame(seconds: number): { position: THREE.Vector3; lookAt: THREE.Vector3; tight: boolean } | null {
    if (seconds >= this.finishCloseUpUntil || this.finishCloseUpIndex < 0 || !this.headCacheValid[this.finishCloseUpIndex]) return null;
    const injury = this.arcadeInjuries[this.finishCloseUpIndex];
    const severed = injury === "decapitation" && this.effects.severedHeadPosition(this.finishCloseUpIndex, this.closeUpTarget);
    // An eye out of its socket is shot close, on the side the face points to; one hanging under a face on
    // the canvas cannot be seen from any side, and the shot is the head's own.
    const hanging = !severed && (injury === "eye_left" || injury === "eye_right") && this.effects.eyePosition(this.finishCloseUpIndex, this.closeUpTarget)
      && this.eyeInSight(this.closeUpTarget);
    const head = severed || hanging ? this.closeUpTarget : this.headCache[this.finishCloseUpIndex]!;
    const reach = severed ? 0.8 : hanging ? 0.45 : 1.05;
    const drift = (seconds - (this.finishCloseUpUntil - FINISH_CLOSE_UP_SECONDS)) * 0.25 - 0.2;
    // Shoot from the ring-centre side of the fighter so the ropes stay behind the face.
    const toCentre = Math.atan2(-head.x, -head.z);
    // The side is chosen once: a head still tumbling would swing the camera round it.
    if (this.finishCloseUpBearing === null) {
      const skull = hanging ? this.headWorldPose(this.finishCloseUpIndex) : null;
      // A hanging eye is shot from the side of the head it hangs on.
      // A head on the canvas is shot from the side its face turns to, and never across its own body.
      const fallen = severed ? null : this.graphs?.[this.finishCloseUpIndex]?.fallBody ?? null;
      const facing = severed && this.effects.severedHeadFacing(this.finishCloseUpIndex, this.closeUpFacing)
        ? this.closeUpFacing
        : skull !== null
          ? this.closeUpFacing.copy(head).sub(skull.position).normalize()
          : fallen?.faceDirection(this.closeUpFacing) ?? null;
      const winner = this.finishCloseUpIndex === 0 ? this.tmpB : this.tmpA;
      const blockers = [{ x: winner.x, z: winner.z, radius: STANDING_BLOCK_RADIUS }, { x: this.refereePosition.x, z: this.refereePosition.z, radius: STANDING_BLOCK_RADIUS }];
      if (fallen !== null) {
        for (const point of [1, 2, 3, 4] as const) {
          fallen.bodyPoint(point, this.bodyPoint);
          blockers.push({ x: this.bodyPoint.x, z: this.bodyPoint.z, radius: FALLEN_BLOCK_RADIUS });
        }
      }
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

  /** The winner's glove nearer the referee, in world space. */
  private nearerGlove(left: THREE.Bone, right: THREE.Bone): THREE.Vector3 {
    left.getWorldPosition(this.stoppageWrist);
    right.getWorldPosition(this.stoppageOtherWrist);
    const reach = (glove: THREE.Vector3): number => Math.hypot(glove.x - this.refereePosition.x, glove.z - this.refereePosition.z);
    return reach(this.stoppageOtherWrist) < reach(this.stoppageWrist) ? this.stoppageOtherWrist : this.stoppageWrist;
  }

  /** Whether an eye hanging at `eye` is clear of the beaten fighter's skull from above, rather than under his face. */
  private eyeInSight(eye: THREE.Vector3): boolean {
    const skull = this.headWorldPose(this.finishCloseUpIndex);
    if (skull === null) return false;
    const fromSkull = this.closeUpFacing.copy(eye).sub(skull.position);
    return fromSkull.y > -0.5 * fromSkull.length();
  }

  /** Replays the recorded snapshots around the knockdown from a close camera before the result panel. */
  private startReplay(plan: ReplayPlan): void {
    const buffer = new SnapshotBuffer(plan.snapshots.length + 2, this.simulation.tick_rate);
    for (const snapshot of plan.snapshots) buffer.push(snapshot);
    this.replay = { plan, buffer, startedAt: this.frameSeconds, impactFired: false, side: null };
    this.commentary.replay(this.frameSeconds);
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
    // The replay shows the punch that ended the bout. A contact still waiting for the live clock is not
    // shown live as well; the injury it carried lands at the replay's impact instead.
    for (const pending of this.pendingContacts.splice(0)) {
      const index = pending.recipientIndex;
      if (pending.injury !== null && (index === 0 || index === 1) && this.replayInjuries[index] === null && this.arcadeInjuries[index] === null) {
        this.replayInjuries[index] = { injury: pending.injury, event: pending.event };
      }
    }
    const victim = plan.snapshots[0]?.fighters.findIndex((fighter) => fighter.player_id === plan.impact.target_id) ?? -1;
    // The replay's punch knocks the gum shield out again, so it is back in his mouth for the lead-up.
    if (victim >= 0 && plan.impact.detail.endsWith(":head")) this.effects.returnMouthpiece(victim);
    // The impact is the body punch itself, so the knockdown it caused says whether he went to one knee.
    const kneels = this.lastKnockdown?.knockdown.detail === BODY_KNOCKDOWN;
    for (const [index, graph] of (this.graphs ?? []).entries()) {
      graph.resetTransient(false);
      graph.primeReplayFall();
      if (index === victim && kneels) graph.fallToKnee(true);
    }
    this.finalRevealAt = this.frameSeconds + plan.durationSeconds + finalRevealDelay(this.final);
  }

  private endReplay(): void {
    this.replay = null;
    this.reapplyReplayInjuries();
    const live = this.buffer.latest();
    for (const [index, graph] of (this.graphs ?? []).entries()) {
      const fighter = live?.fighters[index];
      const knockedOut = fighter !== undefined && fighter.player_id === this.flashKnockout?.loserId;
      graph.resetTransient(fighter?.is_downed === true || knockedOut);
      if (knockedOut) graph.knockOut();
    }
    if (this.final !== null) this.presentFinish(this.final);
  }

  private fireReplayImpact(snapshot: EngineSnapshot): void {
    const record = this.lastKnockdown;
    if (record === null) return;
    const event = record.hit ?? { ...record.knockdown, kind: "hit", amount: 420, blood: 60 };
    const { recipientIndex, puncherIndex } = contactParticipants(event, snapshot);
    const recipient = snapshot.fighters[recipientIndex];
    if (recipient === undefined) return;
    this.contactPoint.set(this.mapping.x(recipient.x), 0, this.mapping.z(recipient.y));
    const spray = sprayDirection(snapshot.fighters[puncherIndex], recipient, this.mapping);
    this.effects.addEvent(event, this.contactPoint, this.settings().reducedMotion, spray);
    const puncher = puncherIndex >= 0 ? snapshot.fighters[puncherIndex] : undefined;
    const keyParts = puncher?.action_key?.split(":") ?? [];
    const punchClass = (keyParts[0] ?? null) as PunchClass | null;
    const hand = (keyParts[1] ?? null) as Hand | null;
    this.graphs?.[recipientIndex]?.react("hit", event.detail.endsWith(":body") ? "body" : "head", event.direction, punchClass, hand, event.amount);
    if (record.knockdown.detail === "body" && record.knockdown.tick > event.tick) {
      this.graphs?.[recipientIndex]?.windedFor((record.knockdown.tick - event.tick) / this.simulation.tick_rate + 0.15, bodySideStruck(puncher?.action_key ?? null));
    }
    if (recipient.player_id === this.flashKnockout?.loserId) this.graphs?.[recipientIndex]?.knockOut();
    if (puncherIndex >= 0) this.graphs?.[puncherIndex]?.landedHit(false);
    // The punch that floored him knocks the gum shield out again, in slow motion.
    if (event.detail.endsWith(":head") && !this.settings().reducedMotion) this.knockOutMouthpiece(recipientIndex, spray ?? event.direction, event.event_id + REPLAY_EVENT_ID_OFFSET, true);
    this.onContact?.(event);
    this.reapplyReplayInjuries(spray);
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
    // Once he is falling, the shot follows his head wherever the fall takes it.
    const victimX = falling ? this.headCache[victim]!.x : victim === 1 ? bx : ax;
    const victimZ = falling ? this.headCache[victim]!.z : victim === 1 ? bz : az;
    const midX = (ax + bx) / 2 + (victimX - (ax + bx) / 2) * favour;
    const midZ = (az + bz) / 2 + (victimZ - (az + bz) / 2) * favour;
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

  /** The server clock starts over after a new connection or a paused bout, so the render clock relearns it. */
  resyncClock(): void {
    this.buffer.resync();
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

  /**
   * Severs the head or a hand from the fighter's current pose, flying the way the punch travelled, or
   * sets a dislocation, and records it.
   */
  private applyArcadeInjury(index: number, injury: ArcadeInjury, event: CombatEvent, spray?: SprayDirection): boolean {
    let applied = this.graphs !== null
      && (injury === "jaw_dislocation" || injury === "shoulder_left" || injury === "shoulder_right");
    if (injury === "decapitation") {
      const pose = this.headWorldPose(index);
      if (pose !== null) {
        const graph = this.graphs?.[index];
        const baked = graph === undefined ? undefined : bakeSeveredHead(graph.boxer, pose.position, pose.quaternion);
        this.effects.decapitate(
          index,
          pose.position,
          pose.quaternion,
          spray ?? event.direction,
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
        this.effects.burstHead(index, pose.position, spray ?? event.direction, event.event_id);
        const jaw = this.burstStumpPose(index);
        if (jaw !== null) this.effects.anchorStump(index, jaw.position, jaw.quaternion, jaw.rim, jaw.across);
        applied = true;
      }
    } else if (injury === "eye_left" || injury === "eye_right") {
      const boxer = this.graphs?.[index]?.boxer;
      if (boxer !== undefined && eyeSocket(boxer, injury === "eye_left" ? "left" : "right", this.tmpPart, this.tmpStumpOffset, this.tmpPartQuaternion)) {
        this.effects.gougeEye(index, this.tmpPart, this.tmpStumpOffset, spray ?? event.direction, event.event_id);
        applied = true;
      }
    } else if (injury === "dismember_left" || injury === "dismember_right") {
      const side = injury === "dismember_left" ? "left" : "right";
      const pose = this.handWorldPose(index, side);
      if (pose !== null) {
        const graph = this.graphs?.[index];
        const baked = graph === undefined ? undefined : { ...bakeSkinnedPart(graph.boxer.gloveMesh(side), pose.position, pose.quaternion), gloveBlood: graph.boxer.gloveBloodLevel };
        this.effects.dismemberHand(
          index,
          side,
          pose.position,
          pose.quaternion,
          spray ?? event.direction,
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
  private reapplyReplayInjuries(spray?: SprayDirection): void {
    for (const index of [0, 1] as const) {
      const stash = this.replayInjuries[index];
      if (stash === null) continue;
      this.replayInjuries[index] = null;
      const settings = this.settings();
      if (settings.blood !== "full" || settings.reducedMotion) continue;
      this.applyArcadeInjury(index, stash.injury, { ...stash.event, event_id: stash.event.event_id + REPLAY_EVENT_ID_OFFSET }, spray);
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
    this.tmpStump.set(0, 0, 0);
    for (const [at, corner] of rim.entries()) {
      posedHeadVertex(boxer, corner, this.tmpStumpOffset);
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
    // The server turns a punch or an evasion down outside the fight phase and while the fighter cannot act.
    const fighter = latest.fighters[index]!;
    if (latest.phase !== "fight" || !canStartPunch(fighter)) return;
    const leadTicks = ((this.inputLatencyMs ?? 60) / 1000) * this.simulation.tick_rate + this.buffer.interpolationDelayTicks;
    if (isEvasion(action.kind)) {
      // Behind a punch the server holds it, so it is shown at once only when the fighter is free.
      const busy = this.graphs?.[index]?.ownPunchActive === true || attackTicksRemaining(fighter, latest.tick) > 0 || fighter.queued_actions > 0;
      if (!busy && action.id !== undefined && fighter.stamina >= EVASION_STAMINA) {
        this.evasion.press(action.kind, action.id, this.manualClock ? this.lastManualTime : performance.now(), leadTicks, this.simulation.tick_rate, EVASION_TICKS + styleTiming(fighter.style).evasionTicks);
      }
      return;
    }
    // A fighter who cannot pay for it in full still throws it, as a slow arm punch (see predictedPunchTiming).
    if (action.kind !== "punch") return;
    this.graphs?.[index]?.predict(action, performance.now() / 1000, this.simulation.tick_rate, leadTicks, predictedPunchTiming(fighter, action, latest.tick + 1));
  }

  /**
   * Every snapshot, as it arrives, tells the viewer's own punches whether the server took them (matching
   * each press to the input frame that carried it), and both fighters' punches how they met the opponent.
   */
  private acknowledgeActions(snapshot: EngineSnapshot, events: readonly CombatEvent[]): void {
    for (const [index, fighter] of snapshot.fighters.entries()) {
      const viewer = fighter.player_id === this.viewerId;
      if (viewer) this.evasion.acknowledge(fighter, snapshot.phase === "fight", this.inputSequenceOf);
      const contacts = events.filter((event) => contactParticipants(event, snapshot).puncherIndex === index);
      this.graphs?.[index]?.acknowledge(fighter, snapshot.phase === "fight", contacts, viewer ? this.inputSequenceOf : null);
    }
  }

  push(snapshot: EngineSnapshot): void {
    if (!this.buffer.push(snapshot, this.manualClock ? this.lastManualTime : performance.now())) return;
    const accepted = this.dedupe.accept(snapshot.events);
    this.acknowledgeActions(snapshot, accepted);
    this.history.push(snapshot);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    for (const event of accepted) {
      this.roundStats.record(event, accepted);
      if (event.kind === "knockdown") {
        const hit = accepted.find((candidate) => (candidate.kind === "hit" || candidate.kind === "counter_hit") && candidate.target_id === event.target_id)
          ?? (event.detail === "body" ? this.recordedHit(event) : null);
        this.lastKnockdown = { knockdown: event, hit, finisher: knockdownFinisher(hit, snapshot) };
        const downed = snapshot.fighters.findIndex((fighter) => fighter.player_id === event.target_id);
        this.graphs?.[downed]?.fallToKnee(event.detail === BODY_KNOCKDOWN);
      }
      if (event.kind === "result" && event.detail === "flash_ko") {
        const hit = accepted.findLast((candidate) => (candidate.kind === "hit" || candidate.kind === "counter_hit") && candidate.actor_id === event.actor_id) ?? null;
        if (hit !== null && hit.target_id !== null) {
          this.flashKnockout = { hitEventId: hit.event_id, loserId: hit.target_id };
          // The replay shows the knockout punch and the fall as it would a knockdown.
          // Its injury, if any, is done live by the punch itself, so nothing is left for the replay to apply.
          this.lastKnockdown = { knockdown: { ...hit, kind: "knockdown" }, hit, finisher: null };
        }
      }
      if (event.kind === "referee_break") this.referee?.breakClinch();
      // The fighter who beat the count is ready and the referee sends them back to it.
      if (event.kind === "box") this.eventCallout = { text: "BOX!", until: this.frameSeconds + BOX_CALLOUT_SECONDS };
      if (event.kind === "body_collapse" && event.target_id === this.viewerId) this.ownCollapseUntil = event.tick + event.amount;
    }
    this.commentary.observe(snapshot, accepted, this.players, this.simulation.tick_rate, this.frameSeconds);
    for (const { event, presentationEvent, presentImpact, reactAmount } of contactPresentationPlan(accepted, snapshot)) {
      const targetIndex = snapshot.fighters.findIndex((fighter) => fighter.player_id === event.target_id);
      const actorIndex = snapshot.fighters.findIndex((fighter) => fighter.player_id === event.actor_id);
      const { recipientIndex, puncherIndex } = contactParticipants(event, snapshot);
      const recipient = snapshot.fighters[recipientIndex]
        ?? snapshot.fighters[targetIndex]
        ?? snapshot.fighters[actorIndex]
        ?? snapshot.fighters[0];
      this.contactPoint.set(this.mapping.x(recipient.x), 0, this.mapping.z(recipient.y));
      if (CONTACT_KINDS.has(event.kind)) {
        const puncher = puncherIndex >= 0 ? snapshot.fighters[puncherIndex]! : null;
        this.pendingContacts.push({
          event,
          presentationEvent,
          presentImpact,
          reactAmount,
          contactTick: puncher?.action_contact_tick ?? event.tick,
          recipientIndex,
          puncherIndex,
          injury: arcadeInjuryFor(event, snapshot.fighters[recipientIndex], snapshot.result, puncher ?? undefined),
        });
      } else if (event.kind === "bleed") {
        this.effects.addEvent(event, this.contactPoint, this.settings().reducedMotion);
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
      const { event, presentationEvent, reactAmount, recipientIndex, puncherIndex, injury } = pending;
      // A body shot that dropped him a moment later has already been shown landing.
      const presentImpact = pending.presentImpact && !isDelayedBodyKnockdown(presentationEvent);
      const target = this.buffer.latest()?.fighters[recipientIndex];
      // Blood, teeth and severed parts fly the way the punch travelled.
      const spray = sprayDirection(this.buffer.latest()?.fighters[puncherIndex], target, this.mapping);
      this.presentFightEvent(event, recipientIndex, puncherIndex);
      if (presentImpact && target !== undefined) {
        this.contactPoint.set(this.mapping.x(target.x), 0, this.mapping.z(target.y));
        this.effects.addEvent(presentationEvent, this.contactPoint, this.settings().reducedMotion, spray);
      }
      const currentSettings = this.settings();
      if (pending.presentImpact || UNIMPACTFUL_KINDS.has(event.kind)) this.arena.excite(CROWD_EXCITEMENT[event.kind] ?? 0);
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
        this.applyArcadeInjury(recipientIndex, injury, event, spray);
      }
      const graphs = this.graphs;
      if (presentImpact && recipientIndex >= 0 && !currentSettings.reducedMotion && mouthpieceFlies(event.kind, event.amount, presentationEvent.detail.endsWith(":head"))) {
        this.knockOutMouthpiece(recipientIndex, spray ?? presentationEvent.direction, event.event_id, false);
      }
      const teeth = presentImpact && recipientIndex >= 0 ? teethFor(event.kind, event.amount, presentationEvent.detail.endsWith(":head")) : 0;
      if (teeth > 0 && !currentSettings.reducedMotion && currentSettings.blood !== "off") {
        const pose = this.headWorldPose(recipientIndex);
        if (pose !== null) {
          this.mouthPoint.set(0, -0.07, 0.1).applyQuaternion(pose.quaternion).add(pose.position);
          this.effects.spawnTeeth(this.mouthPoint, spray ?? presentationEvent.direction, teeth, event.event_id);
        }
      }
      if (
        presentImpact
        && recipientIndex >= 0
        && reactAmount !== null
        && ["hit", "counter_hit", "block", "perfect_block", "knockdown"].includes(event.kind)
      ) {
        const blocked = event.kind === "block" || event.kind === "perfect_block";
        const targetKind = presentationEvent.detail.endsWith(":body") ? "body" : "head";
        if (graphs !== null) {
          const puncher = puncherIndex >= 0 ? this.buffer.latest()?.fighters[puncherIndex] : undefined;
          const keyParts = puncher?.action_key?.split(":") ?? [];
          const punchClass = (keyParts[0] ?? presentationEvent.detail.split(":")[0] ?? null) as PunchClass | null;
          const punchHand = (keyParts[1] ?? null) as Hand | null;
          graphs[recipientIndex]!.react(blocked ? "block" : "hit", targetKind, presentationEvent.direction, punchClass, punchHand, reactAmount);
          if (this.flashKnockout?.hitEventId === event.event_id) graphs[recipientIndex]!.knockOut();
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

  /** The parry's stagger, the body shot that is putting a fighter down, and the broadcast's callouts. */
  private presentFightEvent(event: CombatEvent, recipientIndex: number, puncherIndex: number): void {
    const callout = EVENT_CALLOUTS[event.kind];
    if (callout !== undefined) this.eventCallout = { text: callout.text, until: this.frameSeconds + callout.seconds };
    const graphs = this.graphs;
    if (graphs === null || recipientIndex < 0) return;
    if (event.kind === "parry") graphs[recipientIndex]?.stagger();
    if (event.kind === "body_collapse") {
      const puncher = puncherIndex >= 0 ? this.buffer.latest()?.fighters[puncherIndex] : undefined;
      graphs[recipientIndex]?.windedFor(event.amount / this.simulation.tick_rate + 0.15, bodySideStruck(puncher?.action_key ?? null));
    }
  }

  /** The punch that landed with this knockdown's action id, from the recorded snapshots. */
  private recordedHit(knockdown: CombatEvent): CombatEvent | null {
    if (knockdown.action_id === null) return null;
    for (let index = this.history.length - 1; index >= 0; index -= 1) {
      const hit = this.history[index]!.events.find((candidate) => (candidate.kind === "hit" || candidate.kind === "counter_hit") && candidate.action_id === knockdown.action_id && candidate.target_id === knockdown.target_id);
      if (hit !== undefined) return hit;
    }
    return null;
  }

  /** The bell ends the round: the rest starts and the corners put the gum shields back in. */
  private enterRest(seconds: number): void {
    this.restStartedAt = seconds;
    this.effects.clearMouthpieces();
  }

  /** The gum shield flies out of the mouth along the punch, from the head as it is posed. */
  private knockOutMouthpiece(index: number, direction: number | SprayDirection, eventId: number, again: boolean): void {
    const pose = this.headWorldPose(index);
    if (pose === null) return;
    this.mouthPoint.set(0, -0.075, 0.1).applyQuaternion(pose.quaternion).add(pose.position);
    this.effects.ejectMouthpiece(index, this.mouthPoint, pose.quaternion, direction, eventId, this.gearColor(index), again);
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
    if (this.keyLight !== null) setKeyShadowTier(this.keyLight.shadow, low, this.scaler.scale < 0.8 ? 1024 : 2048);
    this.arena.setLowTier(low);
    this.effects.setLowTier(low);
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
    key.shadow.bias = KEY_SHADOW_BIAS;
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
    // Zooming or moving the window to another monitor changes the pixel ratio, often without a resize.
    const pixelRatio = Math.min(this.pixelRatioCap, window.devicePixelRatio || 1);
    if (pixelRatio !== this.basePixelRatio) {
      this.basePixelRatio = pixelRatio;
      this.applyResolutionScale();
    }

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
        this.baseFov = 36 * Math.min(1.3, Math.sqrt(this.portraitPull));
        this.camera.fov = this.baseFov;
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
    this.updateRocked(latest, dt, current.reducedMotion);
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
    let snapshot = latest === null ? null : this.applyLocalPrediction(this.buffer.sample(sampledTick), dt, time);
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
    let downedAt: { x: number; z: number } | null = null;
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
        // Counted out, or replayed going down, a fighter stays where the fall left him whatever his meter says.
        const overOnTheCanvas = this.replay !== null || snapshot.phase === "complete";
        graphs[0].stayDown(overOnTheCanvas);
        graphs[1].stayDown(overOnTheCanvas);
        if (snapshot.phase === "fight" && this.lastPhase === "rest" && this.replay === null) {
          this.roundCalloutUntil = seconds + ROUND_CALLOUT_SECONDS;
          this.roundCalloutRound = snapshot.round_number;
        }
        if (snapshot.phase === "rest" && this.lastPhase !== "rest") this.enterRest(seconds);
        this.lastPhase = snapshot.phase;
        this.anticipatePunches(latest, sampledTick);
        // A fighter going down falls against his standing opponent, not through him.
        graphs[0].setObstacle(graphs[1].boxer.root.position.x, graphs[1].boxer.root.position.z);
        graphs[1].setObstacle(graphs[0].boxer.root.position.x, graphs[0].boxer.root.position.z);
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
      const fallenA = this.graphs?.[0]?.fallBody?.centre(this.bodyPoint) ?? null;
      const contactA = fallenA === null ? { x: ax, z: az } : { x: fallenA.x, z: fallenA.z };
      const fallenB = this.graphs?.[1]?.fallBody?.centre(this.bodyPoint) ?? null;
      const contactB = fallenB === null ? { x: bx, z: bz } : { x: fallenB.x, z: fallenB.z };
      downedAt = a.is_downed ? contactA : b.is_downed ? contactB : null;
      this.ring.setRopeContacts(contactA, contactB);
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
    this.presentFinishWhenShown(sampledTick);
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
      current.camera === "close",
      downedAt,
    );
    const viewerIndex = snapshot === null ? -1 : snapshot.fighters.findIndex((fighter) => fighter.player_id === this.viewerId);
    const ownView = current.camera === "fighter" && viewerIndex >= 0 && ownViewPhase(snapshot)
      ? this.fighterCam.update(dt, seconds, viewerIndex === 0 ? this.tmpA : this.tmpB, viewerIndex === 0 ? this.tmpB : this.tmpA, this.effects.shakeAmount, current.reducedMotion, this.camera.aspect)
      : null;
    if (ownView === null) this.fighterCam.reset();
    const replaying = this.replay;
    const frame: { position: THREE.Vector3; lookAt: THREE.Vector3; tight?: boolean; framed?: boolean } = this.cameraOverride ?? (replaying !== null && snapshot !== null ? this.replayFrame(snapshot, seconds - replaying.startedAt) : (this.closeUpFrame(seconds) ?? this.cornerShotFrame(seconds, snapshot, current.reducedMotion) ?? this.restWideFrame(snapshot) ?? this.ceremonyFrame(seconds) ?? ownView ?? directed));
    this.ownViewActive = ownView !== null && frame === ownView;
    const fov = this.ownViewActive ? this.baseFov * FIGHTER_CAM_FOV_SCALE : this.baseFov;
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    // The player's own camera frames itself for the screen (FighterCam) and may stand over the apron, so it
    // is neither pulled back nor kept inside the ropes like the broadcast's shots.
    if (this.cameraOverride === null && this.portraitPull > 1 && frame.framed !== true && !this.ownViewActive) {
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

  private applyLocalPrediction(snapshot: EngineSnapshot | null, dt: number, timeMs: number): EngineSnapshot | null {
    if (snapshot === null || this.localInput === null || this.viewerId === null) return snapshot;
    const index = snapshot.fighters.findIndex((fighter) => fighter.player_id === this.viewerId);
    const held = this.localInput() ?? { moveX: 0, moveY: 0, defense: "none" };
    // Shown as far ahead of the snapshot on screen as an input pressed now takes to show up in it: the
    // round trip plus the interpolation delay. The player's own punch starts here before the server
    // has it, and holds the feet from then on. A body shot that is putting the player's own fighter down
    // freezes him until he drops.
    const leadTicks = ((this.inputLatencyMs ?? 60) / 1000) * this.simulation.tick_rate + this.buffer.interpolationDelayTicks;
    const collapsing = this.ownCollapseUntil > snapshot.tick;
    const fighting = index >= 0 && snapshot.phase === "fight" && !collapsing ? snapshot.fighters[index]! : null;
    const holdFeet = this.graphs?.[index]?.ownPunchActive === true || this.evasion.holdsFeet(timeMs, this.simulation.tick_rate);
    const local = this.movement.update(fighting, held, holdFeet, timeMs, leadTicks, snapshot.tick, dt, this.simulation.tick_rate);
    // The guard is the most latency-sensitive thing the player controls: it is shown as held, and a
    // slip, weave or pull on the press, wherever the server is not overriding it.
    const evading = this.evasion.pose(timeMs);
    if (index < 0) return snapshot;
    const viewer = snapshot.fighters[index]!;
    const defense = fighting !== null ? predictedDefense(fighting, held, evading) : viewer.defense;
    if (Math.abs(local.dx) < 0.01 && Math.abs(local.dy) < 0.01 && defense === viewer.defense) return snapshot;
    const offset = constrainPrediction(viewer, local, snapshot.fighters[index === 0 ? 1 : 0] ?? null);
    const predicted = { ...viewer, x: viewer.x + offset.dx, y: viewer.y + offset.dy, defense };
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

  /** The fighters as drawn: eased apart when the engine has them closer than two bodies can stand, and off a fighter lying on the canvas. */
  private standApart(fighters: readonly [FighterSnapshot, FighterSnapshot]): readonly [FighterSnapshot, FighterSnapshot] {
    const [a, b] = fighters;
    const tied = [a, b].some((fighter) => fighter.clinch_ticks > 0 || fighter.clinch_startup_ticks > 0 || fighter.is_downed);
    const apart = tied ? null : visualSeparation(a.x, a.y, b.x, b.y, DRAWN_MINIMUM_GAP, RING_HALF_WIDTH - FIGHTER_RADIUS, RING_HALF_HEIGHT - FIGHTER_RADIUS);
    const drawn: readonly [FighterSnapshot, FighterSnapshot] = apart === null ? fighters : [Object.assign(this.drawnFighters[0], a, { x: apart.ax, y: apart.ay }), Object.assign(this.drawnFighters[1], b, { x: apart.bx, y: apart.by })];
    return this.replay === null ? this.clearOfTheFallen(drawn) : drawn;
  }

  /** Whoever is still on his feet stands off the body of a fighter lying where the fall took him, never in it. */
  private clearOfTheFallen(fighters: readonly [FighterSnapshot, FighterSnapshot]): readonly [FighterSnapshot, FighterSnapshot] {
    for (const lying of [0, 1] as const) {
      const body = this.graphs?.[lying]?.fallBody ?? null;
      const seat = lying === 0 ? 1 : 0;
      const standing = fighters[seat];
      if (body === null || standing.is_downed || (this.graphs?.[seat]?.fallBody ?? null) !== null) continue;
      let x = this.mapping.x(standing.x);
      let z = this.mapping.z(standing.y);
      for (const point of [0, 1, 2, 3, 4] as const) {
        body.bodyPoint(point, this.bodyPoint);
        ({ x, z } = keepClear(x, z, this.bodyPoint.x, this.bodyPoint.z, STANDING_BODY_CLEARANCE));
      }
      if (x === this.mapping.x(standing.x) && z === this.mapping.z(standing.y)) continue;
      const moved = Object.assign(this.drawnFighters[seat], standing, { x: x / this.mapping.x(1), y: z / this.mapping.z(1) });
      return seat === 0 ? [moved, fighters[1]] : [fighters[0], moved];
    }
    return fighters;
  }

  private headHeightOf(index: number): number {
    return (this.graphs?.[index]?.boxer.metrics.headRestY ?? 1.52) + 0.04;
  }

  private updateBlobShadows(): void {
    const anchors = [this.tmpA, this.tmpB, this.refereePosition];
    for (const [index, blob] of this.blobShadows.entries()) {
      // A fighter's blob sits under his body on the canvas, or under the rendered fighter, who walks in from
      // his mark for the glove touch.
      const graph = index < 2 ? this.graphs?.[index] : undefined;
      const fallen = graph?.fallBody?.centre(this.bodyPoint) ?? null;
      const anchor = fallen ?? (graph?.boxer.root.visible === true ? graph.currentRoot : anchors[index]!);
      blob.position.x = anchor.x;
      blob.position.z = anchor.z;
      const downed = index < 2 && this.buffer.latest()?.fighters[index]?.is_downed === true;
      blob.scale.set(downed ? 2.1 : 1.25, downed ? 0.9 : 0.85, 1);
    }
  }

  private updateReferee(dt: number, time: number, snapshot: EngineSnapshot | null, sampledTick: number): void {
    const referee = this.referee;
    if (referee === null) return;
    // The replay isolates the two fighters: the referee, who would stand in its close shot, is left out of it.
    referee.boxer.root.visible = this.replay === null;
    const shadow = this.blobShadows[2];
    if (shadow !== undefined) shadow.visible = this.replay === null;
    const downed = snapshot?.fighters.find((fighter) => fighter.is_downed) ?? null;
    const clinched = snapshot?.fighters.some((fighter) => fighter.clinch_ticks > 0 || fighter.clinch_startup_ticks > 0) ?? false;
    const breaking = downed === null && referee.breaking;
    const focusX = downed !== null ? this.mapping.x(downed.x) : (this.tmpA.x + this.tmpB.x) / 2;
    const focusZ = downed !== null ? this.mapping.z(downed.y) : (this.tmpA.z + this.tmpB.z) / 2;
    const away = this.refereeAway.set(this.refereePosition.x - focusX, 0, this.refereePosition.z - focusZ);
    if (away.lengthSq() < 0.01) away.set(0, 0, -1);
    away.normalize();
    if (breaking) {
      // He steps in square to the line between the two, on his side of it, so a hand reaches each chest.
      const acrossX = this.tmpB.z - this.tmpA.z;
      const acrossZ = this.tmpA.x - this.tmpB.x;
      const across = Math.hypot(acrossX, acrossZ);
      const side = acrossX * away.x + acrossZ * away.z >= 0 ? 1 : -1;
      if (across > 0.01) away.set((acrossX / across) * side, 0, (acrossZ / across) * side);
    }
    const { standoff, clearance } = refereeSpacing(downed !== null, clinched, breaking);
    const targetX = THREE.MathUtils.clamp(focusX + away.x * standoff, -2.4, 2.4);
    const targetZ = THREE.MathUtils.clamp(focusZ + away.z * standoff, -2.4, 2.4);
    const previousX = this.refereePosition.x;
    const previousZ = this.refereePosition.z;
    const ceremony = this.replay === null && this.ceremony?.positions !== null ? this.ceremony : null;
    // Once the fight is waved off, the referee goes to the winner's side, the side nearer the middle of the ring.
    const winner = ceremony === null && this.replay === null && this.stoppageWinner >= 0 && this.frameSeconds >= this.stoppageRaiseAt
      ? (this.stoppageWinner === 0 ? this.tmpA : this.tmpB)
      : null;
    const side = winner !== null && winner.x > 0 ? -1 : 1;
    let beside = false;
    if (winner !== null) {
      const step = ceremonyStep(this.refereePosition.x, this.refereePosition.z, { x: winner.x + side * STOPPAGE_RAISE_SPACING, y: winner.z }, CEREMONY_REFEREE_SPEED * dt);
      this.refereePosition.x = step.x;
      this.refereePosition.z = step.y;
      beside = step.arrived;
    } else if (ceremony !== null) {
      // The referee walks to the mark between the fighters and turns to the camera.
      const step = ceremonyStep(this.refereePosition.x, this.refereePosition.z, { x: CEREMONY_REFEREE.x, y: CEREMONY_REFEREE.z }, CEREMONY_REFEREE_SPEED * dt);
      this.refereePosition.x = step.x;
      this.refereePosition.z = step.y;
      ceremony.refereeArrived = step.arrived;
    } else {
      // A break is a brisk step in, never faster than REFEREE_BREAK_SPEED; otherwise he drifts into place.
      const rate = 1 - Math.exp(-(breaking ? 8 : 1.6) * dt);
      const pace = breaking ? Math.min(1, (REFEREE_BREAK_SPEED * dt) / Math.max(1e-6, Math.hypot(targetX - this.refereePosition.x, targetZ - this.refereePosition.z) * rate)) : 1;
      this.refereePosition.x += (targetX - this.refereePosition.x) * rate * pace;
      this.refereePosition.z += (targetZ - this.refereePosition.z) * rate * pace;
    }
    const keepOff = winner !== null ? STOPPAGE_RAISE_SPACING * 0.85 : ceremony === null ? clearance : ceremony.refereeArrived ? 0 : CEREMONY_WALK_CLEARANCE;
    for (const fighter of keepOff > 0 ? [this.tmpA, this.tmpB] : []) {
      const dx = this.refereePosition.x - fighter.x;
      const dz = this.refereePosition.z - fighter.z;
      const distance = Math.hypot(dx, dz);
      if (distance < keepOff && distance > 0.001) {
        this.refereePosition.x = fighter.x + (dx / distance) * keepOff;
        this.refereePosition.z = fighter.z + (dz / distance) * keepOff;
      }
    }
    // Nor on a fighter lying where the fall took him.
    for (const graph of ceremony !== null ? [] : this.graphs ?? []) {
      const body = graph.fallBody;
      if (body === null) continue;
      for (const point of [0, 1, 2, 3, 4] as const) {
        body.bodyPoint(point, this.bodyPoint);
        const step = keepClear(this.refereePosition.x, this.refereePosition.z, this.bodyPoint.x, this.bodyPoint.z, BODY_CLEARANCE);
        this.refereePosition.x = step.x;
        this.refereePosition.z = step.z;
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
    const yaw = winner !== null ? (beside ? 0 : Math.atan2(winner.x - this.refereePosition.x, winner.z - this.refereePosition.z))
      : ceremony === null ? Math.atan2(focusX - this.refereePosition.x, focusZ - this.refereePosition.z)
        : walking ? Math.atan2(CEREMONY_REFEREE.x - this.refereePosition.x, CEREMONY_REFEREE.z - this.refereePosition.z) : 0;
    if (winner !== null) {
      // Facing the camera, the referee's left hand is the one on the +x side.
      const gloves = this.graphs?.[this.stoppageWinner]?.boxer.rig.bones;
      const wrist = beside && gloves !== undefined ? this.nearerGlove(gloves.gloveL, gloves.gloveR) : null;
      referee.raise(side < 0 ? wrist : null, side > 0 ? wrist : null);
    }
    const yawDelta = ((yaw - this.refereeYaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    this.refereeYaw += yawDelta * (1 - Math.exp(-(breaking ? 8 : 3) * dt));
    const state = refereeSnapshot(this.refereePosition, this.refereeYaw, this.refereeVelocity, this.mapping);
    referee.setRefereeCount(downed !== null, downed?.get_up_count ?? 0);
    referee.aimBreak(this.tmpA, this.tmpB);
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
        trail.update(this.trailGlove, dt, this.camera.position, !reducedMotion && this.replay === null && !graph.isDown);
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
      const work = cutmanWork(snapshot?.fighters[index]);
      if (next >= CUTMAN_IN_PLACE && head !== null) {
        const fighterYaw = graphs[index]!.boxer.root.rotation.y;
        this.cutmanFacing.set(Math.sin(fighterYaw), 0, Math.cos(fighterYaw));
        this.cutmanEye.copy(head).addScaledVector(this.cutmanFacing, 0.09);
        this.cutmanEye.x += Math.cos(fighterYaw) * work.side * work.lateral;
        this.cutmanEye.z -= Math.sin(fighterYaw) * work.side * work.lateral;
        this.cutmanEye.y += work.lift;
        graph.treat(this.cutmanEye, this.cutmanFacing, work.side, work.prop);
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
    drawHud(ctx, viewport.width, viewport.height, snapshot, this.players, this.viewerId, this.frameSeconds >= this.finalRevealAt ? this.final : null, this.reconnectMs, this.simulation.tick_rate, this.roundStats, this.replay !== null ? "KNOCKOUT REPLAY" : null, this.inputLatencyMs, this.frameSeconds < this.roundCalloutUntil ? `ROUND ${this.roundCalloutRound}` : this.eventCallout !== null && this.frameSeconds < this.eventCallout.until ? this.eventCallout.text : null, this.roundClock.ticks(snapshot), (player) => this.avatars.get(player));
    this.drawCaption(ctx, viewport.width, viewport.height, snapshot);
  }

  /** Hurt vision while the viewer's own fighter is rocked; never for a spectator, in a replay or with reduced motion. */
  private updateRocked(latest: EngineSnapshot | null, dt: number, reducedMotion: boolean): void {
    const viewer = latest?.fighters.find((fighter) => fighter.player_id === this.viewerId);
    const target = latest === null || this.replay !== null || this.final !== null || reducedMotion ? 0 : rockedLevel(viewer, latest.phase);
    const level = this.rocked.update(target, dt);
    this.finishPass.uniforms.uRocked!.value = reducedMotion ? 0 : level;
  }

  /** The broadcast caption: commentary, the ring announcer and the decision read-out. */
  private drawCaption(ctx: CanvasRenderingContext2D, width: number, height: number, snapshot: EngineSnapshot): void {
    const final = this.final !== null && this.frameSeconds >= this.finalRevealAt ? this.final : null;
    if (final !== null && !this.resultAnnounced) {
      this.resultAnnounced = true;
      this.commentary.resultShown(this.frameSeconds);
    }
    const caption = this.commentary.current(this.frameSeconds);
    const settings = this.settings();
    const text = caption === null || !settings.commentary ? "" : caption.line.text;
    if (text !== this.captionText) {
      this.captionText = text;
      this.hudCanvas.dataset.caption = text;
    }
    if (caption === null || !settings.commentary) return;
    const viewer = snapshot.fighters.find((fighter) => fighter.player_id === this.viewerId);
    // Laid out like the rest of the HUD for a 1280 x 720 screen and drawn larger on a bigger one.
    const scale = hudScale(width, height);
    const resultTop = final === null ? null : resultCardTop(final, width, height, snapshot.fighters, this.players, this.roundStats, this.viewerId) / scale;
    const callout = this.frameSeconds < this.roundCalloutUntil || (this.eventCallout !== null && this.frameSeconds < this.eventCallout.until);
    const cornerPanelTop = this.cornerPanelTop === null ? null : this.cornerPanelTop / scale;
    const slot = captionSlot({ width: width / scale, height: height / scale, phase: snapshot.phase, resultTop, touch: this.touchControls && viewer !== undefined, hint: snapshot.phase === "countdown" && viewer !== undefined, viewerDown: viewer?.is_downed === true, replay: this.replay !== null, cornerPanelTop, callout });
    if (slot === null) return;
    ctx.save();
    ctx.scale(scale, scale);
    drawCaption(ctx, caption, slot, settings.reducedMotion);
    ctx.restore();
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
    this.blobTexture.dispose();
    for (const blob of this.blobShadows) {
      this.scene.remove(blob);
      blob.geometry.dispose();
      (blob.material as THREE.Material).dispose();
    }
    this.renderer.renderLists.dispose();
    disposeComposer(this.composer);
    // three's UnrealBloomPass.dispose leaves its bright-pass filter out.
    this.bloomPass.materialHighPassFilter.dispose();
    releaseFighterGpu();
    // Last: a disposed renderer forgets what it allocated, so anything freed after it stays on the card.
    this.renderer.dispose();
    this.hudCanvas.remove();
  }
}
