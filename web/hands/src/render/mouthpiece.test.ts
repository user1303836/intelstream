import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { snapshot } from "../test/fixtures";
import { Effects3D } from "./effects";
import { BIG_SHOT } from "./gore";
import { buildMouthpieceGeometry, idleShield, mouthpieceFlies, stepShield } from "./mouthpiece";
import { FightRenderer } from "./renderer";
import { CANVAS_TOP, ROPE_LINE } from "./world";

const mouth = new THREE.Vector3(0.1, 1.5, 0.05);

describe("gum shield", () => {
  it("is a horseshoe about five centimetres across, four deep and under two tall, its front toward +Z", () => {
    const geometry = buildMouthpieceGeometry();
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    expect(box.max.x - box.min.x).toBeGreaterThan(0.05);
    expect(box.max.x - box.min.x).toBeLessThan(0.065);
    expect(box.max.z - box.min.z).toBeGreaterThan(0.035);
    expect(box.max.z - box.min.z).toBeLessThan(0.05);
    expect(box.max.y - box.min.y).toBeLessThan(0.02);
    // The arch closes at the front: nothing at the front corners, where a box would have them.
    const position = geometry.getAttribute("position");
    const vertex = new THREE.Vector3();
    for (let index = 0; index < position.count; index += 1) {
      vertex.fromBufferAttribute(position, index);
      expect(Math.abs(vertex.x) > 0.02 && vertex.z > box.max.z - 0.01).toBe(false);
    }
    geometry.dispose();
  });

  it("flies from the punch that floors a man and from big counters and huge shots to the head", () => {
    expect(mouthpieceFlies("knockdown", 1, true)).toBe(true);
    expect(mouthpieceFlies("knockdown", 1, false)).toBe(false);
    expect(mouthpieceFlies("counter_hit", BIG_SHOT, true)).toBe(true);
    expect(mouthpieceFlies("counter_hit", BIG_SHOT - 1, true)).toBe(false);
    expect(mouthpieceFlies("hit", 110, true)).toBe(true);
    expect(mouthpieceFlies("hit", 109, true)).toBe(false);
    expect(mouthpieceFlies("counter_hit", 150, false)).toBe(false);
    expect(mouthpieceFlies("block", 150, true)).toBe(false);
  });

  it("falls, bounces lower each time, slides to a stop and lies flat on the canvas", () => {
    const state = { ...idleShield(), out: true, moving: true, x: 0, y: 1.5, z: 0, vx: 1.2, vy: 1.2, vz: 0, wx: 9, wy: 4, wz: 7, restYaw: 0.4 };
    const quaternion = new THREE.Quaternion();
    const peaks: number[] = [];
    let rising = true;
    let last = state.y;
    for (let step = 0; step < 600 && state.moving; step += 1) {
      stepShield(state, quaternion, 1 / 60, CANVAS_TOP);
      if (rising && state.y < last) peaks.push(last);
      rising = state.y > last;
      last = state.y;
      expect(state.y).toBeGreaterThanOrEqual(CANVAS_TOP);
    }
    expect(state.moving).toBe(false);
    expect(state.bounces).toBeGreaterThan(0);
    for (let index = 2; index < peaks.length; index += 1) expect(peaks[index]!).toBeLessThan(peaks[index - 1]!);
    expect(state.y).toBeCloseTo(CANVAS_TOP + 0.006, 5);
    expect(state.x).toBeGreaterThan(0.5);
    expect(state.x).toBeLessThan(2);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);
    expect(up.y).toBeGreaterThan(0.98);
  });

  it("stays out until the round ends, unless the replay knocks it out again", () => {
    const effects = new Effects3D(new THREE.Scene());
    expect(effects.mouthpieceOut(1)).toBe(false);
    expect(effects.ejectMouthpiece(1, mouth, new THREE.Quaternion(), 1, 10, 0xb91c1c)).toBe(true);
    expect(effects.mouthpieceOut(1)).toBe(true);
    expect(effects.mouthpieceOut(0)).toBe(false);
    expect(effects.ejectMouthpiece(1, mouth, new THREE.Quaternion(), 1, 11, 0xb91c1c)).toBe(false);
    expect(effects.ejectMouthpiece(1, mouth, new THREE.Quaternion(), 1, 10, 0xb91c1c, true)).toBe(false);
    expect(effects.ejectMouthpiece(1, mouth, new THREE.Quaternion(), 1, 1_000_013, 0xb91c1c, true)).toBe(true);
    effects.clearMouthpieces();
    expect(effects.mouthpieceOut(1)).toBe(false);
    expect(effects.ejectMouthpiece(1, mouth, new THREE.Quaternion(), 1, 11, 0xb91c1c)).toBe(true);
    effects.dispose();
  });

  it("lands on the canvas inside the ropes and stays there, the same at any frame rate", () => {
    const land = (frame: number): THREE.Vector3 => {
      const effects = new Effects3D(new THREE.Scene());
      effects.ejectMouthpiece(0, new THREE.Vector3(ROPE_LINE - 0.2, 1.5, 0), new THREE.Quaternion(), 1, 77, 0x1d4ed8);
      for (let time = 0; time < 4; time += frame) effects.update(frame);
      const at = new THREE.Vector3();
      expect(effects.mouthpiecePosition(0, at)).toBe(true);
      effects.dispose();
      return at;
    };
    const smooth = land(1 / 60);
    expect(Math.abs(smooth.x)).toBeLessThan(ROPE_LINE);
    expect(smooth.y).toBeLessThan(CANVAS_TOP + 0.01);
    expect(land(1 / 30).distanceTo(smooth)).toBeLessThan(1e-6);
  });

  it("sprays spit, and blood only where blood is shown", () => {
    const sprayed = (blood: "full" | "off"): { all: number; blood: number } => {
      const effects = new Effects3D(new THREE.Scene());
      effects.setBloodLevel(blood);
      effects.ejectMouthpiece(0, mouth, new THREE.Quaternion(), -1, 4, 0x1d4ed8);
      const counts = { all: effects.liveParticles, blood: effects.liveBloodParticles };
      effects.dispose();
      return counts;
    };
    expect(sprayed("full").blood).toBeGreaterThan(8);
    expect(sprayed("off").all).toBeGreaterThan(5);
    expect(sprayed("off").blood).toBe(0);
  });

  it("leaves the mouth from where the head is, along the punch", () => {
    const calls: unknown[][] = [];
    const head = new THREE.Vector3(1, 1.5, -0.4);
    const stub = {
      mouthPoint: new THREE.Vector3(),
      headWorldPose: () => ({ position: head, quaternion: new THREE.Quaternion() }),
      gearColor: () => 0xb91c1c,
      effects: { ejectMouthpiece: (...args: unknown[]) => calls.push(args) },
    };
    (FightRenderer.prototype as unknown as { knockOutMouthpiece(this: unknown, index: number, direction: number, eventId: number, again: boolean): void }).knockOutMouthpiece.call(stub, 1, -1, 42, false);
    expect(calls).toHaveLength(1);
    const [index, at, , direction, eventId, color, again] = calls[0]!;
    expect(index).toBe(1);
    expect((at as THREE.Vector3).distanceTo(head)).toBeLessThan(0.15);
    expect((at as THREE.Vector3).y).toBeLessThan(head.y);
    expect([direction, eventId, color, again]).toEqual([-1, 42, 0xb91c1c, false]);
  });

  it("goes back in when the bell ends the round", () => {
    const effects = new Effects3D(new THREE.Scene());
    effects.ejectMouthpiece(0, mouth, new THREE.Quaternion(), 1, 3, 0x1d4ed8);
    const stub = { restStartedAt: 0, effects };
    (FightRenderer.prototype as unknown as { enterRest(this: unknown, seconds: number): void }).enterRest.call(stub, 42);
    expect(stub.restStartedAt).toBe(42);
    expect(effects.mouthpieceOut(0)).toBe(false);
    effects.dispose();
  });

  it("is knocked out again, in slow motion, when the replay reaches the punch that floored him", () => {
    const knocked: unknown[][] = [];
    const hit = { event_id: 9, tick: 40, kind: "counter_hit", actor_id: "one", target_id: "two", amount: 120, detail: "hook:head", blood: 20, direction: -1, action_id: null };
    const stub = {
      lastKnockdown: { knockdown: { ...hit, kind: "knockdown", amount: 1, detail: "" }, hit, finisher: null },
      contactPoint: new THREE.Vector3(),
      mapping: { x: (value: number) => value / 100, z: (value: number) => value / 100 },
      effects: { addEvent: () => undefined },
      settings: () => ({ reducedMotion: false }),
      graphs: null,
      onContact: null,
      reapplyReplayInjuries: () => undefined,
      knockOutMouthpiece: (...args: unknown[]) => knocked.push(args),
    };
    const fire = (FightRenderer.prototype as unknown as { fireReplayImpact(this: unknown, snapshot: unknown): void }).fireReplayImpact;
    fire.call(stub, snapshot());
    expect(knocked).toEqual([[1, -1, 9 + 1_000_003, true]]);
    fire.call({ ...stub, settings: () => ({ reducedMotion: true }) }, snapshot());
    fire.call({ ...stub, lastKnockdown: { ...stub.lastKnockdown, hit: { ...hit, detail: "hook:body" } } }, snapshot());
    expect(knocked).toHaveLength(1);
  });
});
