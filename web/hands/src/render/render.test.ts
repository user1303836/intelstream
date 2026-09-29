import * as THREE from "three";
import { punchTiming, totalTicks } from "../manifest";
import { buildArena } from "./arena";
import { CameraDirector, cornerFrame, cornerPoint, cornerShot, cornerShotProgress, CUTMAN_WORK_DEGREES, CUTMAN_WORK_DISTANCE } from "./camera";
import { bloodPatternFor, Effects3D } from "./effects";
import { decisionLabel, drawHud, FINAL_REVEAL_DELAY_SECONDS, finalRevealDelay, fitFontSize, HUD_MAX_GUARD, HUD_MAX_POISE, RoundClock, RoundStatsTracker, scoreTotal, topPanelOffset } from "./hud";
import { buildRing, disposeRing, nearRopeOpacityFor, ropePress } from "./ring";
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

  it("reports where a severed head is, follows it as it falls, and can sever again after a restore", () => {
    const scene = new THREE.Scene();
    const effects = new Effects3D(scene);
    const where = new THREE.Vector3();
    expect(effects.severedHeadPosition(0, where)).toBe(false);
    effects.decapitate(0, new THREE.Vector3(0.2, 1.5, -0.1), new THREE.Quaternion(), 1, 77);
    expect(effects.severedHeadPosition(0, where)).toBe(true);
    expect(where.y).toBeCloseTo(1.5, 1);
    for (let frame = 0; frame < 240; frame += 1) effects.update(1 / 60);
    expect(effects.severedHeadPosition(0, where)).toBe(true);
    expect(where.y).toBeLessThan(0.6);
    expect(effects.severedHeadPosition(1, where)).toBe(false);
    effects.restoreFighter(0);
    expect(effects.severedHeadPosition(0, where)).toBe(false);
    effects.decapitate(0, new THREE.Vector3(0, 1.5, 0), new THREE.Quaternion(), 1, 77);
    expect(effects.activeHeads).toBe(0);
    effects.decapitate(0, new THREE.Vector3(0, 1.5, 0), new THREE.Quaternion(), 1, 77 + 1_000_003);
    expect(effects.activeHeads).toBe(1);
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
    expect(texts).toContain("COUNT 4");
    expect(texts.join(" ")).not.toContain("Waiting for");
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

describe("near ropes", () => {
  it("are solid while the fighters are across the ring and mostly clear when they are against them", () => {
    expect(nearRopeOpacityFor(-2)).toBe(1);
    expect(nearRopeOpacityFor(0)).toBeGreaterThan(0.75);
    expect(nearRopeOpacityFor(1.8)).toBeCloseTo(0.26, 6);
    expect(nearRopeOpacityFor(1)).toBeLessThan(nearRopeOpacityFor(0));
  });

  it("fade only on the side that faces the broadcast camera", () => {
    const ring = buildRing();
    ring.setNearRopeOpacity(0.3);
    expect(ring.nearRopeOpacity()).toBeCloseTo(0.3, 6);
    const faded = ring.materials.filter((material) => material.transparent && material.opacity < 1);
    expect(faded).toHaveLength(3 + 3 * 2);
    ring.group.updateMatrixWorld(true);
    const box = new THREE.Box3();
    ring.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !faded.includes(object.material as THREE.Material)) return;
      box.setFromObject(object);
      expect(box.min.z).toBeGreaterThan(2.3);
    });
    ring.setNearRopeOpacity(4);
    expect(ring.nearRopeOpacity()).toBe(1);
    disposeRing(ring);
  });
});

describe("rope flex", () => {
  it("presses into the nearest ropes only when a fighter is within reach of them", () => {
    expect(ropePress(0, 0)).toEqual({ pressX: 0, pressZ: 0 });
    expect(ropePress(2.82, 0).pressX).toBeGreaterThan(0.95);
    expect(ropePress(2.82, 0).pressZ).toBe(0);
    expect(ropePress(0, -2.82).pressZ).toBeGreaterThan(0.95);
    expect(ropePress(2.6, 0).pressX).toBeGreaterThan(0.1);
    expect(ropePress(2.6, 0).pressX).toBeLessThan(0.6);
  });

  it("writes fighter contacts into the rope shader uniforms and clears them", () => {
    const ring = buildRing();
    ring.setRopeContacts({ x: 2.82, z: 0.4 }, null);
    expect(ring.ropeContacts[0].x).toBeCloseTo(2.82);
    expect(ring.ropeContacts[0].y).toBeCloseTo(0.4);
    expect(ring.ropeContacts[0].z).toBeGreaterThan(0.95);
    expect(ring.ropeContacts[1].toArray()).toEqual([0, 0, 0, 0]);
    ring.setRopeContacts(null, null);
    expect(ring.ropeContacts[0].toArray()).toEqual([0, 0, 0, 0]);
  });
});

describe("round stats", () => {
  const event = (kind: string, actor: string, detail = ""): Parameters<RoundStatsTracker["record"]>[0] =>
    ({ event_id: 1, tick: 1, kind, actor_id: actor, target_id: null, amount: 0, detail, blood: 0, direction: 1, action_id: null });

  it("counts punches thrown and landed per fighter and resets on the round-start bell", () => {
    const tracker = new RoundStatsTracker();
    tracker.record(event("punch_start", "one"));
    tracker.record(event("punch_start", "one"));
    tracker.record(event("hit", "one"));
    tracker.record(event("punch_start", "two"));
    tracker.record(event("counter_hit", "two"));
    tracker.record(event("block", "two"));
    expect(tracker.get("one")).toEqual({ thrown: 2, landed: 1 });
    expect(tracker.get("two")).toEqual({ thrown: 1, landed: 1 });
    tracker.record(event("bell", "", "round_end"));
    expect(tracker.get("one")).toEqual({ thrown: 2, landed: 1 });
    tracker.record(event("bell", "", "round_start"));
    expect(tracker.get("one")).toEqual({ thrown: 0, landed: 0 });
  });

  it("keeps bout totals across rounds and prints them on the result panel", () => {
    const tracker = new RoundStatsTracker();
    tracker.record(event("punch_start", "one"));
    tracker.record(event("hit", "one"));
    tracker.record(event("bell", "", "round_start"));
    tracker.record(event("punch_start", "one"));
    tracker.record(event("punch_start", "two"));
    expect(tracker.get("one")).toEqual({ thrown: 1, landed: 0 });
    expect(tracker.total("one")).toEqual({ thrown: 2, landed: 1 });
    const texts: string[] = [];
    const ctx = mockHudContext(texts);
    const players = Object.fromEntries(publicPlayers.map((player) => [player.id, player]));
    const final = { version: 3 as const, type: "final" as const, match_id: "m", winner_id: "one", method: "decision" as const, round: 3, scorecards: [], ratings: {} };
    drawHud(ctx, 1280, 720, { ...snapshot(), phase: "complete" }, players, "one", final, 0, 30, tracker);
    expect(texts.some((text) => text.includes("One 1/2 landed") && text.includes("Two 0/1 landed"))).toBe(true);
  });

  it("draws the round callout only while the renderer asks for it", () => {
    const texts: string[] = [];
    const ctx = mockHudContext(texts);
    const players = Object.fromEntries(publicPlayers.map((player) => [player.id, player]));
    drawHud(ctx, 1280, 720, { ...snapshot(), phase: "fight", round_number: 2 }, players, "one", null, 0, 30, null, null, null, "ROUND 2");
    expect(texts.filter((text) => text === "ROUND 2").length).toBeGreaterThanOrEqual(2);
    texts.length = 0;
    drawHud(ctx, 1280, 720, { ...snapshot(), phase: "fight", round_number: 2 }, players, "one", null, 0, 30, null, null, null, null);
    expect(texts.filter((text) => text === "ROUND 2").length).toBe(1);
  });

  it("shows the local fighter's input latency readout", () => {
    const texts: string[] = [];
    const ctx = mockHudContext(texts);
    const players = Object.fromEntries(publicPlayers.map((player) => [player.id, player]));
    drawHud(ctx, 1280, 720, snapshot(), players, "one", null, 0, 30, null, null, 48.4);
    expect(texts).toContain("INPUT 48 ms");
    texts.length = 0;
    drawHud(ctx, 1280, 720, snapshot(), players, null, null, 0, 30, null, null, 48.4);
    expect(texts.some((text) => text.startsWith("INPUT"))).toBe(false);
  });

  it("shows the landed counts on the rest panel", () => {
    const texts: string[] = [];
    const ctx = mockHudContext(texts);
    const tracker = new RoundStatsTracker();
    tracker.record(event("punch_start", "one"));
    tracker.record(event("hit", "one"));
    drawHud(ctx, 1280, 720, { ...snapshot(), phase: "rest" }, Object.fromEntries(publicPlayers.map((player) => [player.id, player])), "one", null, 0, 30, tracker);
    expect(texts.some((text) => text.includes("One 1/1"))).toBe(true);
  });
});

describe("decision label", () => {
  const card = (one: number[], two: number[], judge = "J") => ({ judge, player_one: one, player_two: two });
  const final = (method: "decision" | "draw" | "ko" | "tko", scorecards: ReturnType<typeof card>[]) =>
    ({ version: 3 as const, type: "final" as const, match_id: "m", winner_id: method === "draw" ? null : "one", method, round: 3, scorecards, ratings: {} });

  it("names unanimous, split and majority decisions and draws from the scorecards", () => {
    expect(decisionLabel(final("decision", [card([10, 10, 10], [9, 9, 9]), card([10, 10, 9], [9, 9, 10]), card([10, 10, 10], [9, 9, 9])]))).toBe("UNANIMOUS DECISION");
    expect(decisionLabel(final("decision", [card([10, 10, 10], [9, 9, 9]), card([9, 9, 10], [10, 10, 9]), card([10, 10, 10], [9, 9, 9])]))).toBe("SPLIT DECISION");
    expect(decisionLabel(final("decision", [card([10, 10, 10], [9, 9, 9]), card([10, 9], [9, 10]), card([10, 10, 10], [9, 9, 9])]))).toBe("MAJORITY DECISION");
    expect(decisionLabel(final("draw", [card([10], [10]), card([10], [10]), card([10], [10])]))).toBe("UNANIMOUS DRAW");
    expect(decisionLabel(final("draw", [card([10], [9]), card([9], [10]), card([10], [10])]))).toBe("SPLIT DRAW");
    expect(decisionLabel(final("draw", [card([10], [9]), card([10], [10]), card([10], [10])]))).toBe("MAJORITY DRAW");
    expect(decisionLabel(final("tko", []))).toBe("TKO");
    expect(decisionLabel(final("decision", []))).toBe("DECISION");
  });
});

describe("final reveal", () => {
  const final = { version: 3 as const, type: "final" as const, match_id: "m", winner_id: "one", method: "ko" as const, round: 1, scorecards: [], ratings: {} };
  it("holds stoppage results back for the slow-motion fall and shows decisions at once", () => {
    expect(finalRevealDelay(final)).toBe(FINAL_REVEAL_DELAY_SECONDS);
    expect(finalRevealDelay({ ...final, method: "tko" })).toBe(FINAL_REVEAL_DELAY_SECONDS);
    expect(finalRevealDelay({ ...final, method: "flash_ko" })).toBe(FINAL_REVEAL_DELAY_SECONDS);
    expect(finalRevealDelay({ ...final, method: "decision" })).toBe(0);
    expect(finalRevealDelay(null)).toBe(0);
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

describe("fitFontSize", () => {
  it("returns the largest size that fits and the minimum when nothing does", () => {
    const measure = (size: number) => size * 10;
    expect(fitFontSize(measure, 160, 16, 11)).toBe(16);
    expect(fitFontSize(measure, 135, 16, 11)).toBe(13);
    expect(fitFontSize(measure, 50, 16, 11)).toBe(11);
  });
});

describe("topPanelOffset", () => {
  it("parks the panel under the top bar and lower on narrow screens", () => {
    const top = (width: number, height: number): number => height / 2 + topPanelOffset(width, height) - (height < 480 ? 25 : 39);
    expect(top(1280, 720)).toBeCloseTo(72);
    expect(top(844, 390)).toBeCloseTo(56);
    expect(top(390, 844)).toBeCloseTo(112);
  });
});

describe("corner shots", () => {
  it("stays wide while the fighters walk over and before the bell, then alternates corners starting with the viewer's", () => {
    expect(cornerShot(1, 14, 0)).toBeNull();
    expect(cornerShot(3, 12, 0)).toBe(0);
    expect(cornerShot(3, 12, 1)).toBe(1);
    expect(cornerShot(8.5, 6.5, 0)).toBe(1);
    expect(cornerShot(13.6, 1.4, 0)).toBeNull();
    expect(cornerShotProgress(3)).toBeCloseTo(0.5);
    expect(cornerShotProgress(8.5)).toBeCloseTo(0.5);
  });

  it("shoots each corner from inside the ropes, mirrored, looking at the stool", () => {
    const position = new THREE.Vector3();
    const lookAt = new THREE.Vector3();
    cornerFrame(1, 2.56, 0, position, lookAt);
    expect(Math.abs(position.x)).toBeLessThan(3.05);
    expect(Math.abs(position.z)).toBeLessThan(3.05);
    expect(position.distanceTo(new THREE.Vector3(2.56, 1, -2.56))).toBeGreaterThan(2);
    expect(position.distanceTo(new THREE.Vector3(2.56, 1, -2.56))).toBeLessThan(2.9);
    expect(lookAt.distanceTo(new THREE.Vector3(2.56, 1, -2.56))).toBeLessThan(0.8);
    const mirrored = new THREE.Vector3();
    cornerFrame(0, 2.56, 0, mirrored, lookAt);
    expect(mirrored.x).toBeCloseTo(-position.x);
    expect(mirrored.z).toBeCloseTo(-position.z);
  });
});

describe("corner staging", () => {
  it("puts the cutman on the fighter's left and the camera on the right, both inside the ropes", () => {
    const cutman = cornerPoint(1, 2.56, CUTMAN_WORK_DISTANCE, CUTMAN_WORK_DEGREES, new THREE.Vector3());
    const camera = new THREE.Vector3();
    const lookAt = new THREE.Vector3();
    cornerFrame(1, 2.56, 0, camera, lookAt);
    for (const point of [cutman, camera]) {
      expect(Math.abs(point.x)).toBeLessThan(2.6);
      expect(Math.abs(point.z)).toBeLessThan(2.6);
    }
    const stool = new THREE.Vector3(2.56, 0, -2.56);
    const forward = new THREE.Vector3(-1, 0, 1).normalize();
    const left = new THREE.Vector3(forward.z, 0, -forward.x);
    expect(cutman.clone().sub(stool).dot(left)).toBeGreaterThan(0.2);
    expect(camera.clone().setY(0).sub(stool).dot(left)).toBeLessThan(-0.8);
    expect(cutman.distanceTo(stool)).toBeCloseTo(CUTMAN_WORK_DISTANCE);
  });
});

describe("round clock", () => {
  it("holds the round time through a knockdown count and a foul timeout, and resets for a new round", () => {
    const clock = new RoundClock();
    const base = snapshot();
    expect(clock.ticks({ ...base, phase: "fight", round_number: 1, phase_ticks_remaining: 2400 })).toBe(2400);
    expect(clock.ticks({ ...base, phase: "knockdown", round_number: 1, phase_ticks_remaining: 270 })).toBe(2400);
    expect(clock.ticks({ ...base, phase: "fight", round_number: 1, phase_ticks_remaining: 2390 })).toBe(2390);
    expect(clock.ticks({ ...base, phase: "foul_recovery", round_number: 1, phase_ticks_remaining: 60 })).toBe(2390);
    expect(clock.ticks({ ...base, phase: "rest", round_number: 1, phase_ticks_remaining: 450 })).toBe(450);
    expect(clock.ticks({ ...base, phase: "knockdown", round_number: 2, phase_ticks_remaining: 250 })).toBe(250);
  });
});

describe("compact scoreboard labels", () => {
  it("abbreviates the bar labels on narrow screens so four-digit values do not collide", () => {
    const texts: string[] = [];
    const ctx = mockHudContext(texts);
    const players = Object.fromEntries(publicPlayers.map((p) => [p.id, p]));
    drawHud(ctx, 390, 844, snapshot(), players, "one", null, 0, 30);
    expect(texts.some((text) => text.startsWith("STA "))).toBe(true);
    expect(texts.some((text) => text.startsWith("HP "))).toBe(true);
    expect(texts.some((text) => text.startsWith("STAMINA"))).toBe(false);
  });
});

describe("result panel text", () => {
  it("keeps a long winner name whole on a narrow screen instead of cutting the verdict", () => {
    const texts: string[] = [];
    const ctx = mockHudContext(texts);
    const longName = "Anastasia-the-Great5";
    const players = { one: { id: "one", name: longName, avatar: null, rating: 1500, connected: true }, two: { id: "two", name: "Bo", avatar: null, rating: 1500, connected: true } };
    const final = { version: 3 as const, type: "final" as const, match_id: "m", winner_id: "one", method: "decision" as const, round: 2, scorecards: [{ judge: "Impact", player_one: [10, 10], player_two: [9, 10] }], ratings: { one: { before: 1000, after: 1016 }, two: { before: 1000, after: 984 } } };
    drawHud(ctx, 390, 844, { ...snapshot(), phase: "complete" }, players, "one", final, 0, 30);
    expect(texts).toContain(`${longName} WINS`);
    expect(texts.some((text) => text.startsWith(`${longName}  1000`))).toBe(true);
    expect(texts.some((text) => text.startsWith("INPUT"))).toBe(false);
  });
});
