import * as THREE from "three";
import { punchTiming, totalTicks } from "../manifest";
import { buildArena } from "./arena";
import { CameraDirector } from "./camera";
import { bloodPatternFor, Effects3D } from "./effects";
import { drawHud, HUD_MAX_GUARD, HUD_MAX_POISE, scoreTotal } from "./hud";
import { buildRing } from "./ring";
import { resizeHighDpi } from "./viewport";
import { PALETTES, worldMapping } from "./world";
import { fighter, publicPlayers, snapshot } from "../test/fixtures";

const mapping = worldMapping({ tick_rate: 30, ring_half_width: 500, ring_half_height: 500 });

const withAction = (
  base: ReturnType<typeof fighter>,
  action: "jab" | "straight" | "hook" | "uppercut",
  hand: "left" | "right",
  target: "head" | "body" = "head",
  power: "normal" | "power" = "normal",
  startup = 5,
  active = 2,
  recovery = 10,
) => ({
  ...base,
  action,
  action_hand: hand,
  action_target: target,
  action_power: power,
  action_id: `${action}-${hand}-${target}-${power}-1`,
  action_key: `${action}:${hand}:${target}:${power}`,
  action_start_tick: 0,
  action_startup_ticks: startup,
  action_active_ticks: active,
  action_recovery_ticks: recovery,
  action_contact_tick: null,
});

describe("world mapping", () => {
  it("maps sim up (W/stick-up) away from the broadcast camera and sim right to screen right", () => {
    const map = worldMapping({ tick_rate: 30, ring_half_width: 500, ring_half_height: 500 });
    expect(map.z(500)).toBeLessThan(0);
    expect(map.z(-500)).toBeGreaterThan(0);
    expect(map.x(500)).toBeGreaterThan(0);
    expect(map.x(-500)).toBeLessThan(0);
    expect(Math.abs(map.x(500))).toBeCloseTo(Math.abs(map.z(500)), 5);
  });
});

describe("scene construction", () => {
  it("builds a ring with four posts, twelve ropes and a branded canvas", () => {
    const ring = buildRing();
    const tubes = ring.geometries.filter((geometry) => geometry.type === "TubeGeometry");
    expect(tubes).toHaveLength(12);
    expect(ring.textures.length).toBeGreaterThanOrEqual(1);
    expect(ring.group.getObjectByName("ring")).toBeTruthy();
    expect(ring.geometries.some((geometry) => geometry.type === "PlaneGeometry")).toBe(true);
  });

  it("builds and animates the arena crowd deterministically", () => {
    const arena = buildArena();
    arena.update(1.5, 1 / 60, false);
    arena.update(2.5, 1 / 60, true);
    expect(arena.group.children.length).toBeGreaterThan(5);
    arena.dispose();
  });
});

describe("camera direction", () => {
  it("follows the fighters midpoint and pushes in on knockdowns", () => {
    const director = new CameraDirector();
    for (let i = 0; i < 300; i += 1) director.update(1 / 60, i / 60, { x: -1.5, z: 0 }, { x: 1.5, z: 0 }, 3, false, 0, true);
    const farDistance = director.update(1 / 60, 6, { x: -1.5, z: 0 }, { x: 1.5, z: 0 }, 3, false, 0, true).position.z;
    for (let i = 0; i < 300; i += 1) director.update(1 / 60, 7 + i / 60, { x: -0.5, z: 0 }, { x: 0.5, z: 0 }, 1, false, 0, true);
    const nearDistance = director.update(1 / 60, 12, { x: -0.5, z: 0 }, { x: 0.5, z: 0 }, 1, false, 0, true).position.z;
    expect(nearDistance).toBeLessThan(farDistance);
    for (let i = 0; i < 300; i += 1) director.update(1 / 60, 13 + i / 60, { x: -0.5, z: 0 }, { x: 0.5, z: 0 }, 1, true, 0, true);
    const knockdown = director.update(1 / 60, 18, { x: -0.5, z: 0 }, { x: 0.5, z: 0 }, 1, true, 0, true);
    expect(knockdown.lookAt.y).toBeLessThan(1.12);
  });

  it("never applies shake under reduced motion", () => {
    const director = new CameraDirector();
    const calm = director.update(1 / 60, 1, { x: 0, z: 0 }, { x: 1, z: 0 }, 1, false, 0.1, true);
    expect(calm.position.y).toBeLessThan(2.2);
  });
});

describe("effects", () => {
  const severeHit = (eventId: number) => ({
    event_id: eventId,
    tick: 1,
    kind: "counter_hit",
    actor_id: "one",
    target_id: "two",
    amount: 220,
    detail: "uppercut:head",
    blood: 100,
    direction: 1,
    action_id: null,
  });

  it("selects anatomically distinct deterministic blood patterns", () => {
    expect(bloodPatternFor({ ...severeHit(1), detail: "jab:head" })).toBe("jet");
    expect(bloodPatternFor({ ...severeHit(2), detail: "right:hook:head" })).toBe("fan");
    expect(bloodPatternFor({ ...severeHit(3), detail: "uppercut:head" })).toBe("plume");
    expect(bloodPatternFor({ ...severeHit(4), detail: "straight:body" })).toBe("body_burst");
    expect(bloodPatternFor({ ...severeHit(5), kind: "bleed", detail: "left_cut" })).toBe("ooze");
    expect(bloodPatternFor({ ...severeHit(6), kind: "knockdown", detail: "" })).toBe("impact");

    const averageBloodHeight = (detail: string): number => {
      const effects = new Effects3D(new THREE.Scene());
      effects.addEvent({ ...severeHit(20), detail }, new THREE.Vector3(), false);
      effects.update(0.1);
      const positions = effects.dropletBuffers.position;
      const colors = effects.dropletBuffers.color;
      const heights: number[] = [];
      for (let index = 0; index < positions.count; index += 1) {
        if (colors.getY(index) < 0.2 && positions.getY(index) > -10) heights.push(positions.getY(index));
      }
      effects.dispose();
      return heights.reduce((sum, height) => sum + height, 0) / heights.length;
    };
    expect(averageBloodHeight("uppercut:head")).toBeGreaterThan(averageBloodHeight("straight:body") + 0.6);
  });

  it("makes full blood dramatically heavier than reduced while off remains bloodless", () => {
    const origin = new THREE.Vector3();

    const full = new Effects3D(new THREE.Scene());
    full.addEvent(severeHit(1), origin, false);
    expect(full.liveBloodParticles).toBe(110);
    expect(full.liveMist).toBe(10);
    expect(full.liveGibs).toBe(11);
    expect(full.visibleDecals).toBe(12);
    full.dispose();

    const reduced = new Effects3D(new THREE.Scene());
    reduced.setBloodLevel("reduced");
    reduced.addEvent(severeHit(2), origin, false);
    expect(reduced.liveBloodParticles).toBe(24);
    expect(reduced.liveMist).toBe(2);
    expect(reduced.liveGibs).toBe(0);
    expect(reduced.visibleDecals).toBe(3);
    reduced.decapitate(0, new THREE.Vector3(0, 1.5, 0), new THREE.Quaternion(), 1, 2);
    expect(reduced.activeHeads).toBe(0);
    expect(reduced.activeStumps).toBe(0);
    expect(reduced.liveGibs).toBe(0);
    reduced.dispose();

    const off = new Effects3D(new THREE.Scene());
    off.setBloodLevel("off");
    off.addEvent(severeHit(3), origin, false);
    expect(off.liveParticles).toBeGreaterThan(0);
    expect(off.liveBloodParticles).toBe(0);
    expect(off.liveMist).toBe(0);
    expect(off.liveGibs).toBe(0);
    expect(off.visibleDecals).toBe(0);
    off.dispose();
  });

  it("accumulates ongoing drips independently for both fighters", () => {
    const effects = new Effects3D(new THREE.Scene());
    const left = new THREE.Vector3(-1, 1.5, 0);
    const right = new THREE.Vector3(1, 1.5, 0);
    for (let frame = 0; frame < 5; frame += 1) {
      effects.drip(left, 1, false, 0);
      effects.drip(right, 1, false, 1);
      effects.update(1 / 60);
    }
    expect(effects.liveBloodParticles).toBe(2);
    const positions = effects.dropletBuffers.position;
    const liveX = Array.from({ length: positions.count }, (_unused, index) => positions.getX(index))
      .filter((_x, index) => positions.getY(index) > -10);
    expect(liveX.some((x) => x < 0)).toBe(true);
    expect(liveX.some((x) => x > 0)).toBe(true);
    effects.dispose();
  });

  it("immediately clears every red effect when blood is turned off while retaining sweat", () => {
    const scene = new THREE.Scene();
    const effects = new Effects3D(scene);
    const origin = new THREE.Vector3(0, 1.5, 0);
    effects.addEvent(severeHit(10), origin, false);
    effects.decapitate(0, origin, new THREE.Quaternion(), 1, 10);
    const sweat = effects.liveParticles - effects.liveBloodParticles;
    expect(sweat).toBeGreaterThan(0);
    expect(effects.liveGibs).toBe(35);
    expect(effects.activeHeads).toBe(1);
    expect(effects.activeStumps).toBe(1);
    expect(effects.visibleDecals).toBeGreaterThan(0);

    effects.setBloodLevel("off");
    expect(effects.liveParticles).toBe(sweat);
    expect(effects.liveBloodParticles).toBe(0);
    expect(effects.liveMist).toBe(0);
    expect(effects.liveGibs).toBe(0);
    expect(effects.activeHeads).toBe(0);
    expect(effects.activeStumps).toBe(0);
    expect(effects.visibleDecals).toBe(0);

    effects.addEvent(severeHit(11), origin, false);
    expect(effects.liveParticles).toBeGreaterThan(sweat);
    expect(effects.liveBloodParticles).toBe(0);
    expect(effects.visibleDecals).toBe(0);
    effects.dispose();
  });

  it("uses preallocated idempotent head, stump, and gib pools", () => {
    const scene = new THREE.Scene();
    const effects = new Effects3D(scene);
    const childCount = scene.children.length;
    const position = new THREE.Vector3(0, 1.55, 0);
    const quaternion = new THREE.Quaternion();

    effects.decapitate(0, position, quaternion, 1, 42, 0xb0703f);
    expect(effects.activeHeads).toBe(1);
    const visibleHead = scene.children.find((child) =>
      child instanceof THREE.Mesh && !(child instanceof THREE.InstancedMesh) && child.visible && child.geometry instanceof THREE.SphereGeometry,
    ) as THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
    expect(visibleHead.material.color.getHex()).toBe(0xb0703f);
    expect(effects.activeStumps).toBe(1);
    expect(effects.liveGibs).toBe(24);
    expect(effects.liveBloodParticles).toBe(120);
    expect(scene.children).toHaveLength(childCount);

    effects.decapitate(0, position, quaternion, 1, 42);
    expect(effects.activeHeads).toBe(1);
    expect(effects.activeStumps).toBe(1);
    expect(effects.liveGibs).toBe(24);
    expect(effects.liveBloodParticles).toBe(120);

    effects.decapitate(1, position, quaternion, -1, 43, 0x6e4128);
    expect(effects.activeHeads).toBe(2);
    const visibleHeadColors = scene.children
      .filter((child) => child instanceof THREE.Mesh && !(child instanceof THREE.InstancedMesh) && child.visible && child.geometry instanceof THREE.SphereGeometry)
      .map((child) => ((child as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHex());
    expect(visibleHeadColors).toEqual([0xb0703f, 0x6e4128]);
    expect(effects.activeStumps).toBe(2);
    expect(effects.liveGibs).toBe(48);
    expect(scene.children).toHaveLength(childCount);

    effects.restoreFighter(0);
    expect(effects.activeHeads).toBe(1);
    expect(effects.activeStumps).toBe(1);
    effects.clearArcadeGore();
    expect(effects.activeHeads).toBe(0);
    expect(effects.activeStumps).toBe(0);
    expect(effects.liveGibs).toBe(0);
    expect(effects.liveBloodParticles).toBe(0);
    expect(effects.liveMist).toBe(0);
    expect(effects.visibleDecals).toBe(0);

    effects.decapitate(0, position, quaternion, 1, 42);
    expect(effects.activeHeads).toBe(0);
    effects.decapitate(0, position, quaternion, 1, 44);
    expect(effects.activeHeads).toBe(1);
    expect(scene.children).toHaveLength(childCount);
    effects.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it("uses independent fixed pools for left and right hand dismemberments", () => {
    const scene = new THREE.Scene();
    const effects = new Effects3D(scene);
    const childCount = scene.children.length;
    const position = new THREE.Vector3(0, 1.3, 0);
    const quaternion = new THREE.Quaternion();
    effects.dismemberHand(0, "left", position, quaternion, 1, 60, 0x1d4ed8);
    expect(effects.activeHands).toBe(1);
    expect(effects.activeStumps).toBe(1);
    expect(effects.liveGibs).toBe(16);
    expect(effects.liveBloodParticles).toBe(80);
    expect(scene.children).toHaveLength(childCount);

    effects.dismemberHand(0, "left", position, quaternion, 1, 60, 0x1d4ed8);
    expect(effects.activeHands).toBe(1);
    expect(effects.liveGibs).toBe(16);
    effects.dismemberHand(0, "right", position, quaternion, -1, 61, 0x1d4ed8);
    expect(effects.activeHands).toBe(2);
    expect(effects.activeStumps).toBe(2);
    expect(effects.liveGibs).toBe(32);
    effects.anchorHandStump(0, "left", new THREE.Vector3(0.1, 1.2, 0), quaternion);

    effects.restoreFighter(0);
    expect(effects.activeHands).toBe(0);
    expect(effects.activeStumps).toBe(0);
    effects.setBloodLevel("reduced");
    effects.dismemberHand(1, "left", position, quaternion, 1, 62, 0xb91c1c);
    expect(effects.activeHands).toBe(0);
    effects.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it("keeps ballistic updates finite, bounded to the ring, and stains the floor", () => {
    const scene = new THREE.Scene();
    const effects = new Effects3D(scene);
    effects.decapitate(0, new THREE.Vector3(2.9, 0.2, 2.9), new THREE.Quaternion(), 1, 70);
    const initialBlood = effects.liveBloodParticles;
    const initialDecals = effects.visibleDecals;
    effects.anchorStump(0, new THREE.Vector3(0.4, 1.4, -0.2), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4));
    for (let i = 0; i < 10; i += 1) effects.update(1 / 60);
    expect(effects.liveBloodParticles).toBeGreaterThan(initialBlood);

    for (let i = 0; i < 360; i += 1) effects.update(1 / 60);
    expect(effects.liveGibs).toBe(0);
    expect(effects.liveBloodParticles).toBe(0);
    expect(effects.liveMist).toBe(0);
    expect(effects.activeHeads).toBe(1);
    expect(effects.activeStumps).toBe(1);
    expect(effects.visibleDecals).toBeGreaterThan(initialDecals);
    expect(effects.visibleDecals).toBeLessThanOrEqual(48);

    effects.decapitate(
      1,
      new THREE.Vector3(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
      new THREE.Quaternion(Number.NaN, Number.NaN, Number.NaN, Number.NaN),
      Number.NaN,
      71,
    );
    effects.update(Number.NaN);
    effects.update(Number.POSITIVE_INFINITY);
    effects.update(-1);
    const matrix = new THREE.Matrix4();
    scene.traverse((object) => {
      expect(object.position.toArray().every(Number.isFinite)).toBe(true);
      expect(object.quaternion.toArray().every(Number.isFinite)).toBe(true);
      if (object instanceof THREE.Points) {
        const positions = (object.geometry.getAttribute("position") as THREE.BufferAttribute).array;
        expect(Array.from(positions).every(Number.isFinite)).toBe(true);
      }
      if (object instanceof THREE.InstancedMesh) {
        for (let index = 0; index < object.count; index += 1) {
          object.getMatrixAt(index, matrix);
          expect(matrix.elements.every(Number.isFinite)).toBe(true);
        }
      }
    });
    effects.dispose();
  });

  it("keeps seeded gore simulation identical at 30 and 60 FPS", () => {
    const simulate = (dt: number): { head: number[]; gib: number[]; particles: number[]; decals: number } => {
      const scene = new THREE.Scene();
      const effects = new Effects3D(scene);
      effects.decapitate(0, new THREE.Vector3(0, 1.55, 0), new THREE.Quaternion(), 1, 77);
      for (let elapsed = 0; elapsed < 1 - 1e-9; elapsed += dt) {
        effects.drip(new THREE.Vector3(-1, 1.5, 0), 1.4, false, 0);
        effects.drip(new THREE.Vector3(1, 1.45, 0), 0.9, false, 1);
        effects.update(dt);
      }
      const head = scene.children.find((child) =>
        child instanceof THREE.Mesh && !(child instanceof THREE.InstancedMesh) && child.visible && child.geometry instanceof THREE.SphereGeometry,
      )!;
      const gibMesh = scene.children.find((child) => child instanceof THREE.InstancedMesh) as THREE.InstancedMesh;
      const matrix = new THREE.Matrix4();
      gibMesh.getMatrixAt(0, matrix);
      const gibPosition = new THREE.Vector3().setFromMatrixPosition(matrix);
      const result = {
        head: head.position.toArray(),
        gib: gibPosition.toArray(),
        particles: Array.from(effects.dropletBuffers.position.array),
        decals: effects.visibleDecals,
      };
      effects.dispose();
      return result;
    };
    expect(simulate(1 / 30)).toEqual(simulate(1 / 60));
  });

  it("never exceeds any fixed pool under repeated production-valid events", () => {
    const scene = new THREE.Scene();
    const effects = new Effects3D(scene);
    const position = new THREE.Vector3(0, 1.5, 0);
    const quaternion = new THREE.Quaternion();
    for (let eventId = 0; eventId < 100; eventId += 1) {
      effects.addEvent(severeHit(1000 + eventId), position, false);
    }
    for (let eventId = 0; eventId < 100; eventId += 1) {
      const fighterIndex = eventId % 2;
      effects.restoreFighter(fighterIndex);
      effects.decapitate(fighterIndex, position, quaternion, fighterIndex === 0 ? 1 : -1, 2000 + eventId);
    }
    expect(effects.liveParticles).toBeLessThanOrEqual(900);
    expect(effects.liveBloodParticles).toBeLessThanOrEqual(900);
    expect(effects.liveMist).toBeLessThanOrEqual(90);
    expect(effects.visibleDecals).toBeLessThanOrEqual(48);
    expect(effects.liveGibs).toBe(48);
    expect(effects.activeHeads).toBeLessThanOrEqual(2);
    expect(effects.activeStumps).toBeLessThanOrEqual(2);

    const stains = effects.visibleDecals;
    effects.clearDynamic();
    expect(effects.liveParticles).toBe(0);
    expect(effects.liveBloodParticles).toBe(0);
    expect(effects.liveMist).toBe(0);
    expect(effects.liveGibs).toBe(0);
    expect(effects.activeHeads).toBe(0);
    expect(effects.activeStumps).toBe(0);
    expect(effects.visibleDecals).toBe(stains);
    effects.dispose();
    expect(scene.children).toHaveLength(0);
  });
});

describe("viewport and broadcast HUD", () => {
  it("caps high-DPI canvas allocation", () => {
    const canvas = document.createElement("canvas");
    const resized = resizeHighDpi(canvas, 2);
    expect(resized?.dpr).toBeLessThanOrEqual(2);
    expect(canvas.width).toBe(1600);
  });

  it("keeps opponent get-up timing private while exposing the viewer prompt", () => {
    const texts: string[] = [];
    const ctx = mockHudContext(texts);
    const players = Object.fromEntries(publicPlayers.map((p) => [p.id, p]));
    const base = snapshot();
    const opponentPrompt = { ...base, phase: "knockdown" as const, fighters: [base.fighters[0], { ...base.fighters[1], is_downed: true, get_up_prompt: "get_up_left" as const, get_up_count: 4 }] as const };
    drawHud(ctx, 800, 600, opponentPrompt, players, "one", null, 0);
    expect(texts.join(" ")).not.toContain("NOW!");
    expect(texts.join(" ")).not.toContain("GET READY");
    texts.length = 0;
    const ownPrompt = { ...opponentPrompt, fighters: [{ ...base.fighters[0], is_downed: true, get_up_prompt: "get_up_right" as const, get_up_meter: 2, get_up_required: 4 }, opponentPrompt.fighters[1]] as const };
    drawHud(ctx, 800, 600, ownPrompt, players, "one", null, 0);
    expect(texts.join(" ")).toContain("GET READY →");
    texts.length = 0;
    const inWindow = { ...ownPrompt, fighters: [{ ...base.fighters[0], is_downed: true, get_up_prompt: "get_up_right" as const, get_up_meter: 2, get_up_required: 4, get_up_window_start_tick: 5, get_up_window_end_tick: 15 }, opponentPrompt.fighters[1]] as const };
    drawHud(ctx, 800, 600, inWindow, players, "one", null, 0);
    expect(texts.join(" ")).toContain("NOW!");
  });

  it("renders broadcast plates, round card and totals", () => {
    const texts: string[] = [];
    const ctx = mockHudContext(texts);
    const players = Object.fromEntries(publicPlayers.map((p) => [p.id, p]));
    drawHud(ctx, 1280, 720, snapshot(), players, "one", null, 0, 30);
    expect(texts).toContain("ONE");
    expect(texts).toContain("TWO");
    expect(texts).toContain("ROUND 1");
    expect(texts.some((text) => text.startsWith("STAMINA"))).toBe(true);
    expect(texts.some((text) => text.startsWith("HEALTH"))).toBe(true);
    expect(scoreTotal([10, 9, 10])).toBe(29);
    expect(HUD_MAX_GUARD).toBe(700);
    expect(HUD_MAX_POISE).toBe(600);
  });

  it("uses the bootstrap tick rate for the authoritative HUD clock", () => {
    const texts: string[] = [];
    const ctx = mockHudContext(texts);
    const state = { ...snapshot(), phase_ticks_remaining: 1205 };
    drawHud(ctx, 800, 600, state, Object.fromEntries(publicPlayers.map((player) => [player.id, player])), "one", null, 0, 20);
    expect(texts).toContain("1:00");
  });
});

function mockHudContext(texts: string[]): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} };
  return {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    fill: () => {},
    stroke: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    clearRect: () => {},
    fillText: (text: string) => texts.push(text),
    strokeText: () => undefined,
    measureText: (text: string) => ({ width: text.length * 7 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    set fillStyle(_value: unknown) {},
    set strokeStyle(_value: unknown) {},
    set font(_value: string) {},
    set lineWidth(_value: number) {},
    set textAlign(_value: CanvasTextAlign) {},
    set textBaseline(_value: CanvasTextBaseline) {},
  } as unknown as CanvasRenderingContext2D;
}
