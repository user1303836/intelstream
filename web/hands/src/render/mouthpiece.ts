import * as THREE from "three";
import { BIG_SHOT } from "./gore";

/** Half the width of the arch across the back teeth, and how far the front of it reaches forward of them. */
const ARCH_HALF_WIDTH = 0.026;
const ARCH_DEPTH = 0.038;
const ARCH_STEPS = 22;
/**
 * The shield's cross-section in centimetres, `[outward, up]` round the channel the upper teeth sit in:
 * a tall outer flange, a lower inner one and a floor between them.
 */
const PROFILE: readonly (readonly [number, number])[] = [
  [0.55, 0.85], [0.55, 0.1], [0.4, -0.12], [-0.4, -0.12], [-0.55, 0.05], [-0.55, 0.6], [-0.32, 0.62], [-0.3, 0.16], [0.3, 0.16], [0.32, 0.85],
];
export const SHIELD_RADIUS = 0.03;

/**
 * A gum shield: a horseshoe channel round the upper teeth, the open side up and the front of the arch
 * toward +Z, about 5 cm across and 4 cm deep, in metres.
 */
export function buildMouthpieceGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const index: number[] = [];
  const ring = PROFILE.length;
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const outward = new THREE.Vector3();
  for (let step = 0; step <= ARCH_STEPS; step += 1) {
    const s = (step / ARCH_STEPS) * 2 - 1;
    // The arch is a parabola: front at +Z, the back teeth at the two ends.
    point.set(s * ARCH_HALF_WIDTH, 0, ARCH_DEPTH * (1 - s * s) - ARCH_DEPTH * 0.5);
    tangent.set(ARCH_HALF_WIDTH, 0, -2 * ARCH_DEPTH * s).normalize();
    outward.set(tangent.z, 0, -tangent.x);
    if (outward.dot(point.clone().setY(0).add(new THREE.Vector3(0, 0, ARCH_DEPTH * 0.5))) < 0) outward.negate();
    for (const [across, up] of PROFILE) {
      positions.push(point.x + outward.x * across * 0.01, up * 0.01, point.z + outward.z * across * 0.01);
    }
  }
  for (let step = 0; step < ARCH_STEPS; step += 1) {
    for (let corner = 0; corner < ring; corner += 1) {
      const a = step * ring + corner;
      const b = step * ring + ((corner + 1) % ring);
      const c = a + ring;
      const d = b + ring;
      index.push(a, c, b, b, c, d);
    }
  }
  // Close both ends of the arch with a fan round the middle of the profile.
  for (const step of [0, ARCH_STEPS]) {
    const centre = positions.length / 3;
    let x = 0, y = 0, z = 0;
    for (let corner = 0; corner < ring; corner += 1) {
      x += positions[(step * ring + corner) * 3]!;
      y += positions[(step * ring + corner) * 3 + 1]!;
      z += positions[(step * ring + corner) * 3 + 2]!;
    }
    positions.push(x / ring, y / ring, z / ring);
    for (let corner = 0; corner < ring; corner += 1) {
      const a = step * ring + corner;
      const b = step * ring + ((corner + 1) % ring);
      if (step === 0) index.push(centre, a, b);
      else index.push(centre, b, a);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Whether a blow knocks the gum shield out: the punch that floors a man, a big counter or a huge shot, to the head. */
export function mouthpieceFlies(kind: string, amount: number, head: boolean): boolean {
  if (!head) return false;
  if (kind === "knockdown") return true;
  if (kind === "counter_hit") return amount >= BIG_SHOT;
  return kind === "hit" && amount >= 110;
}

const GRAVITY = 9.81;
const RESTITUTION = 0.32;
const SLIDE_FRICTION = 4.5;
const REST_SPEED = 0.04;
const MAX_BOUNCES = 3;

export interface ShieldState {
  out: boolean;
  moving: boolean;
  sliding: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** Tumbling, in radians per second about each axis. */
  wx: number; wy: number; wz: number;
  bounces: number;
  /** Seconds since it left the mouth, for the trail of spit and blood behind it. */
  age: number;
  /** Which way it lies once it settles. */
  restYaw: number;
}

export function idleShield(): ShieldState {
  return { out: false, moving: false, sliding: false, x: 0, y: -50, z: 0, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, bounces: 0, age: 0, restYaw: 0 };
}

/**
 * Advances a flying gum shield by `dt`: it falls, bounces lower each time it hits the canvas, then
 * slides to a stop and lies flat. `floor` is the canvas height. Returns true while it is still moving.
 */
export function stepShield(state: ShieldState, quaternion: THREE.Quaternion, dt: number, floor: number): boolean {
  if (!state.out || !state.moving) return false;
  state.age += dt;
  const settle = floor + 0.006;
  if (!state.sliding) {
    state.vy -= GRAVITY * dt;
    state.x += state.vx * dt;
    state.y += state.vy * dt;
    state.z += state.vz * dt;
    spin(quaternion, state.wx * dt, state.wy * dt, state.wz * dt);
    if (state.y <= settle) {
      state.y = settle;
      if (state.bounces < MAX_BOUNCES && -state.vy > 0.6) {
        state.bounces += 1;
        state.vy = -state.vy * RESTITUTION;
        state.vx *= 0.72;
        state.vz *= 0.72;
        state.wx *= 0.55;
        state.wy *= 0.7;
        state.wz *= 0.55;
      } else {
        state.vy = 0;
        state.sliding = true;
      }
    }
  } else {
    const speed = Math.hypot(state.vx, state.vz);
    const slowed = Math.max(0, speed - SLIDE_FRICTION * dt);
    if (slowed <= REST_SPEED) {
      state.vx = 0;
      state.vz = 0;
    } else {
      state.vx *= slowed / speed;
      state.vz *= slowed / speed;
    }
    state.x += state.vx * dt;
    state.z += state.vz * dt;
    state.y = settle;
    state.wy *= Math.exp(-4 * dt);
    // It drops flat on the canvas as it slides, turning slowly to a stop, and rests once it lies flat.
    state.restYaw += state.wy * dt;
    flat.setFromAxisAngle(UP, state.restYaw);
    quaternion.slerp(flat, 1 - Math.exp(-12 * dt));
    if (state.vx === 0 && state.vz === 0 && quaternion.angleTo(flat) < 0.02) {
      quaternion.copy(flat);
      state.moving = false;
    }
  }
  return state.moving;
}

const UP = new THREE.Vector3(0, 1, 0);
const flat = new THREE.Quaternion();
const turn = new THREE.Quaternion();
const turnEuler = new THREE.Euler();

function spin(quaternion: THREE.Quaternion, x: number, y: number, z: number): void {
  turn.setFromEuler(turnEuler.set(x, y, z));
  quaternion.multiply(turn).normalize();
}
