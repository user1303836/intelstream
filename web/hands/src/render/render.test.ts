import * as THREE from "three";
import { punchTiming, totalTicks } from "../manifest";
import { buildArena } from "./arena";
import { CameraDirector, ceremonyShot, cornerFrame, cornerPoint, cornerShot, cornerShotProgress, CUTMAN_WORK_DEGREES, CUTMAN_WORK_DISTANCE } from "./camera";
import { bloodPatternFor, Effects3D } from "./effects";
import { CLOCK_PORTRAIT_RADIUS, decisionLabel, drawHud, FINAL_REVEAL_DELAY_SECONDS, finalRevealDelay, fitFontSize, HUD_MAX_GUARD, HUD_MAX_POISE, PLATE_PORTRAIT_RADIUS, RESULT_CARD_FOOTER, resultCard, resultCardLayout, RoundClock, RoundStatsTracker, scoreTotal, topPanelOffset } from "./hud";
import { buildRing, disposeRing, nearRopeOpacityFor, ropeGive, ropePress } from "./ring";
import { resizeHighDpi } from "./viewport";
import { PALETTES, ROPE_LINE, worldMapping } from "./world";
import { fighter, mockHudContext, publicPlayers, snapshot, type DrawnPicture } from "../test/fixtures";

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
    expect(full.liveBloodParticles).toBe(140);
    expect(full.liveMist).toBe(10);
    expect(full.liveGibs).toBe(11);
    expect(full.canvasStains).toBe(12);
    full.dispose();

    const reduced = new Effects3D(new THREE.Scene());
    reduced.setBloodLevel("reduced");
    reduced.addEvent(severeHit(2), origin, false);
    expect(reduced.liveBloodParticles).toBe(24);
    expect(reduced.liveMist).toBe(2);
    expect(reduced.liveGibs).toBe(0);
    expect(reduced.canvasStains).toBe(3);
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
    expect(off.canvasStains).toBe(0);
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
    expect(effects.canvasStains).toBeGreaterThan(0);

    effects.setBloodLevel("off");
    expect(effects.liveParticles).toBe(sweat);
    expect(effects.liveBloodParticles).toBe(0);
    expect(effects.liveMist).toBe(0);
    expect(effects.liveGibs).toBe(0);
    expect(effects.activeHeads).toBe(0);
    expect(effects.activeStumps).toBe(0);
    expect(effects.canvasStains).toBe(0);

    effects.addEvent(severeHit(11), origin, false);
    expect(effects.liveParticles).toBeGreaterThan(sweat);
    expect(effects.liveBloodParticles).toBe(0);
    expect(effects.canvasStains).toBe(0);
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
    expect(effects.canvasStains).toBe(0);

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
    const children = scene.children.length;
    effects.decapitate(0, new THREE.Vector3(2.9, 0.2, 2.9), new THREE.Quaternion(), 1, 70);
    const initialBlood = effects.liveBloodParticles;
    const initialDecals = effects.canvasStains;
    effects.anchorStump(0, new THREE.Vector3(0.4, 1.4, -0.2), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4));
    for (let i = 0; i < 10; i += 1) effects.update(1 / 60);
    expect(effects.liveBloodParticles).toBeGreaterThan(initialBlood);

    for (let i = 0; i < 360; i += 1) effects.update(1 / 60);
    expect(effects.liveGibs).toBe(0);
    expect(effects.liveBloodParticles).toBe(0);
    expect(effects.liveMist).toBe(0);
    expect(effects.activeHeads).toBe(1);
    expect(effects.activeStumps).toBe(1);
    expect(effects.canvasStains).toBeGreaterThan(initialDecals);
    // Stains are painted into the one canvas, so however many there are the scene holds no more objects.
    expect(scene.children.length).toBe(children);

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
        decals: effects.canvasStains,
      };
      effects.dispose();
      return result;
    };
    expect(simulate(1 / 30)).toEqual(simulate(1 / 60));
  });

  it("never exceeds any fixed pool under repeated production-valid events", () => {
    const scene = new THREE.Scene();
    const effects = new Effects3D(scene);
    const children = scene.children.length;
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
    expect(scene.children.length).toBe(children);
    expect(effects.liveGibs).toBe(48);
    expect(effects.activeHeads).toBeLessThanOrEqual(2);
    expect(effects.activeStumps).toBeLessThanOrEqual(2);

    const stains = effects.canvasStains;
    effects.clearDynamic();
    expect(effects.liveParticles).toBe(0);
    expect(effects.liveBloodParticles).toBe(0);
    expect(effects.liveMist).toBe(0);
    expect(effects.liveGibs).toBe(0);
    expect(effects.activeHeads).toBe(0);
    expect(effects.activeStumps).toBe(0);
    expect(effects.canvasStains).toBe(stains);
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

  it("tags the computer's plate instead of showing a rating for it", () => {
    const texts: string[] = [];
    const ctx = mockHudContext(texts);
    const players = Object.fromEntries(publicPlayers.map((p) => [p.id, p.id === "two" ? { ...p, cpu: true } : p]));
    drawHud(ctx, 1280, 720, snapshot(), players, "one", null, 0, 30);
    expect(texts.some((text) => text.startsWith("ELO ") && text.includes("KD"))).toBe(true);
    expect(texts.some((text) => text.startsWith("CPU · KD"))).toBe(true);
    expect(texts.filter((text) => text.startsWith("ELO "))).toHaveLength(1);
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
    expect(faded).toHaveLength(3 + 1);
    ring.group.updateMatrixWorld(true);
    const box = new THREE.Box3();
    ring.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !faded.includes(object.material as THREE.Material)) return;
      box.setFromObject(object);
      expect(box.min.z).toBeGreaterThan(2.3);
    });
    ring.setNearRopeOpacity(4);
    expect(ring.nearRopeOpacity()).toBe(1);
    expect(faded.every((material) => material.visible)).toBe(true);
    ring.setNearRopeOpacity(0);
    expect(faded.every((material) => !material.visible)).toBe(true);
    expect(ring.materials.filter((material) => !material.visible)).toHaveLength(faded.length);
    disposeRing(ring);
  });
});

describe("rope give", () => {
  it("leaves the ropes alone until a fighter's back reaches them", () => {
    expect(ropePress(0, 0)).toEqual({ pressX: 0, pressZ: 0 });
    expect(ropePress(ROPE_LINE - 0.21, 0.4)).toEqual({ pressX: 0, pressZ: 0 });
    expect(ropePress(-(ROPE_LINE - 0.1), 0).pressX).toBeCloseTo(0.1, 9);
    expect(ropePress(0, -2.82).pressZ).toBeCloseTo(2.82 + 0.2 - ROPE_LINE, 9);
    expect(ropePress(0, -2.82).pressX).toBe(0);
  });

  it("keeps the top ropes behind the back of a fighter anywhere the engine lets one stand", () => {
    for (const x of [2.3, 2.5, 2.7, 2.82]) {
      for (const along of [-1.6, 0, 1.2]) {
        for (const height of [0.88, 1.26]) {
          const rope = ROPE_LINE + ropePress(x, along).pressX * ropeGive(0, along, height);
          expect(rope).toBeGreaterThanOrEqual(x + 0.2 - 1e-9);
          const beside = ROPE_LINE + ropePress(x, along).pressX * ropeGive(0.2, along + 0.2, height);
          expect(beside).toBeGreaterThanOrEqual(x + 0.2 - 1e-9);
        }
      }
    }
  });

  it("gives less at the bottom rope, nothing at the posts and nothing away from the fighter", () => {
    expect(ropeGive(0, 0, 0.5)).toBeCloseTo(0.6, 9);
    expect(ropeGive(0, 0, 1.26)).toBe(1);
    expect(ropeGive(0, ROPE_LINE, 1.26)).toBe(0);
    expect(ropeGive(0, -ROPE_LINE, 1.26)).toBe(0);
    expect(ropeGive(1.2, 0, 1.26)).toBe(0);
    expect(ropeGive(0.6, 0, 1.26)).toBeGreaterThan(0.3);
    expect(ropeGive(0.6, 0, 1.26)).toBeLessThan(0.9);
  });

  it("gives the straps that tie the ropes together the ropes' own give", () => {
    const ring = buildRing();
    const ropes: THREE.Material[] = [];
    const straps: THREE.Mesh[] = [];
    ring.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object.geometry.type === "TubeGeometry") ropes.push(object.material as THREE.Material);
      if (object.geometry.type === "BoxGeometry" && (object.geometry as THREE.BoxGeometry).parameters.height === 0.82) straps.push(object);
    });
    expect(straps).toHaveLength(24);
    const flex = (ropes[0] as THREE.MeshStandardMaterial).onBeforeCompile.toString();
    for (const strap of straps) expect((strap.material as THREE.MeshStandardMaterial).onBeforeCompile.toString()).toBe(flex);
    expect(new Set(straps.map((strap) => strap.geometry)).size).toBe(1);
  });

  it("writes fighter contacts into the rope shader uniforms and clears them", () => {
    const ring = buildRing();
    ring.setRopeContacts({ x: 2.82, z: 0.4 }, null);
    expect(ring.ropeContacts[0].x).toBeCloseTo(2.82);
    expect(ring.ropeContacts[0].y).toBeCloseTo(0.4);
    expect(ring.ropeContacts[0].z).toBeCloseTo(2.82 + 0.2 - ROPE_LINE, 9);
    expect(ring.ropeContacts[0].w).toBe(0);
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
    expect(tracker.get("one")).toMatchObject({ thrown: 2, landed: 1 });
    expect(tracker.get("two")).toMatchObject({ thrown: 1, landed: 1 });
    tracker.record(event("bell", "", "round_end"));
    expect(tracker.get("one")).toMatchObject({ thrown: 2, landed: 1 });
    tracker.record(event("bell", "", "round_start"));
    expect(tracker.get("one")).toEqual({ thrown: 0, landed: 0, jabsThrown: 0, jabsLanded: 0 });
  });

  it("counts jabs apart from power punches", () => {
    const tracker = new RoundStatsTracker();
    tracker.record(event("punch_start", "one", "left:jab:head"));
    tracker.record(event("hit", "one", "jab:head"));
    tracker.record(event("punch_start", "one", "right:straight:head"));
    tracker.record(event("punch_start", "one", "left:hook:body"));
    tracker.record(event("counter_hit", "one", "hook:body"));
    expect(tracker.get("one")).toEqual({ thrown: 3, landed: 2, jabsThrown: 1, jabsLanded: 1 });
    expect(tracker.total("one")).toEqual({ thrown: 3, landed: 2, jabsThrown: 1, jabsLanded: 1 });
  });

  it("keeps bout totals across rounds and prints them on the result panel", () => {
    const tracker = new RoundStatsTracker();
    tracker.record(event("punch_start", "one"));
    tracker.record(event("hit", "one"));
    tracker.record(event("bell", "", "round_start"));
    tracker.record(event("punch_start", "one"));
    tracker.record(event("punch_start", "two"));
    expect(tracker.get("one")).toMatchObject({ thrown: 1, landed: 0 });
    expect(tracker.total("one")).toMatchObject({ thrown: 2, landed: 1 });
    const texts: string[] = [];
    const ctx = mockHudContext(texts);
    const players = Object.fromEntries(publicPlayers.map((player) => [player.id, player]));
    const final = { version: 3 as const, type: "final" as const, match_id: "m", winner_id: "one", method: "decision" as const, round: 3, scorecards: [], ratings: {} };
    drawHud(ctx, 1280, 720, { ...snapshot(), phase: "complete" }, players, "one", final, 0, 30, tracker);
    const row = texts.indexOf("TOTAL PUNCHES");
    expect(texts.slice(row + 1, row + 3)).toEqual(["1/2 (50%)", "0/1 (0%)"]);
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

describe("announcement shot", () => {
  const visible = (shot: { distance: number; height: number }, fov: number, fromTop: number): number =>
    shot.height + (0.5 - fromTop) * 2 * shot.distance * Math.tan(THREE.MathUtils.degToRad(fov) / 2);

  it("fits the three from the raised glove to the waist between the top bar and the card", () => {
    for (const covered of [0.2, 0.35, 0.5]) {
      const shot = ceremonyShot(16 / 9, 36, covered);
      expect(visible(shot, 36, 0.09)).toBeCloseTo(2.42, 6);
      expect(visible(shot, 36, 1 - covered)).toBeCloseTo(0.95, 6);
    }
  });

  it("stands further back the more of the screen the card covers", () => {
    expect(ceremonyShot(16 / 9, 36, 0.5).distance).toBeGreaterThan(ceremonyShot(16 / 9, 36, 0.3).distance);
  });

  it("stands back far enough on a tall screen to keep all three in the width", () => {
    const aspect = 390 / 844;
    const shot = ceremonyShot(aspect, 46.8, 0.45);
    const span = 2 * shot.distance * Math.tan(THREE.MathUtils.degToRad(46.8) / 2);
    expect(span * aspect).toBeCloseTo(2.4, 6);
    expect(visible(shot, 46.8, 0.09)).toBeGreaterThan(2.42);
    expect(visible(shot, 46.8, 0.55)).toBeLessThan(0.95);
    const middle = visible(shot, 46.8, 0.09 + (1 - 0.45 - 0.09) / 2);
    expect(middle).toBeCloseTo((2.42 + 0.95) / 2, 6);
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

describe("players' pictures", () => {
  const players = { one: { id: "one", name: "alpha", avatar: null, rating: 1500, connected: true }, two: { id: "two", name: "  ~bravo", avatar: null, rating: 1500, connected: true } };
  const picture = { of: "one" } as unknown as CanvasImageSource;
  const onlyOne = (player: { id: string }): CanvasImageSource | null => (player.id === "one" ? picture : null);

  it("are drawn on the plates, with the first letter of the name where there is none", () => {
    const texts: string[] = [];
    const drawn: DrawnPicture[] = [];
    const arcs: Array<{ x: number; y: number; radius: number }> = [];
    drawHud(mockHudContext(texts, drawn, arcs), 1280, 720, snapshot(), players, "one", null, 0, 30, null, null, null, null, null, onlyOne);
    expect(drawn).toEqual([{ image: picture, x: 35, y: 640, width: PLATE_PORTRAIT_RADIUS * 2, height: PLATE_PORTRAIT_RADIUS * 2 }]);
    expect(texts).toContain("B");
    expect(texts).not.toContain("A");
    const rings = arcs.filter((arc) => arc.radius === PLATE_PORTRAIT_RADIUS);
    expect(new Set(rings.map((arc) => arc.x))).toEqual(new Set([51, 1280 - 51]));
    expect(rings.every((arc) => arc.y === 656)).toBe(true);
  });

  it("are both letters when no pictures are on offer", () => {
    const texts: string[] = [];
    const drawn: DrawnPicture[] = [];
    drawHud(mockHudContext(texts, drawn), 1280, 720, snapshot(), players, "one", null, 0, 30);
    expect(drawn).toHaveLength(0);
    expect(texts).toContain("A");
    expect(texts).toContain("B");
  });

  it("stand beside the clock where the plates are too narrow for them", () => {
    const drawn: DrawnPicture[] = [];
    const arcs: Array<{ x: number; y: number; radius: number }> = [];
    drawHud(mockHudContext([], drawn, arcs), 390, 844, snapshot(), players, "one", null, 0, 30, null, null, null, null, null, onlyOne);
    expect(arcs.some((arc) => arc.radius === PLATE_PORTRAIT_RADIUS)).toBe(false);
    const rings = arcs.filter((arc) => arc.radius === CLOCK_PORTRAIT_RADIUS);
    expect(new Set(rings.map((arc) => arc.x))).toEqual(new Set([195 - 112, 195 + 112]));
    expect(rings.every((arc) => arc.y === 83)).toBe(true);
    expect(drawn).toEqual([{ image: picture, x: 195 - 112 - 20, y: 63, width: 40, height: 40 }]);
    for (const ring of rings) {
      expect(ring.x - ring.radius).toBeGreaterThan(0);
      expect(ring.x + ring.radius).toBeLessThan(390);
      expect(Math.abs(ring.x - 195) - ring.radius).toBeGreaterThan(84);
    }
  });

  it("head the columns of the result card", () => {
    const texts: string[] = [];
    const drawn: DrawnPicture[] = [];
    const final = { version: 3 as const, type: "final" as const, match_id: "m", winner_id: "one", method: "decision" as const, round: 3, scorecards: [], ratings: { one: { before: 1000, after: 1016 }, two: { before: 1000, after: 984 } } };
    drawHud(mockHudContext(texts, drawn), 1280, 720, { ...snapshot(), phase: "complete" }, players, "one", final, 0, 30, null, null, null, null, null, onlyOne);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.image).toBe(picture);
    const layout = resultCardLayout(1280, 720, resultCard(final, snapshot().fighters, players, [{ thrown: 0, landed: 0, jabsThrown: 0, jabsLanded: 0 }, { thrown: 0, landed: 0, jabsThrown: 0, jabsLanded: 0 }]), true);
    expect(drawn[0]!.x).toBeGreaterThan(layout.x + layout.width * 0.42);
    expect(drawn[0]!.x + drawn[0]!.width).toBeLessThan(layout.x + layout.width * 0.6);
    expect(drawn[0]!.y).toBeGreaterThanOrEqual(layout.y + 14);
    expect(drawn[0]!.y + drawn[0]!.height).toBeLessThanOrEqual(layout.y + 14 + layout.rowHeight);
    expect(texts).toContain("B");
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
    expect(texts).toContain("1016 (+16)");
    expect(texts).toContain("984 (−16)");
    expect(texts.some((text) => text.startsWith("INPUT"))).toBe(false);
  });
});

describe("result card", () => {
  const players = { one: { id: "one", name: "Alpha", avatar: null, rating: 1500, connected: true }, two: { id: "two", name: "Bravo", avatar: null, rating: 1500, connected: true } };
  const fighters = (downOne = 0, downTwo = 0): [ReturnType<typeof fighter>, ReturnType<typeof fighter>] => [{ ...fighter("one"), knockdowns: downOne }, { ...fighter("two"), knockdowns: downTwo }];
  const result = (method: "decision" | "draw" | "ko" | "flash_ko" | "tko" | "forfeit", winner: string | null, scorecards: { judge: string; player_one: number[]; player_two: number[] }[] = [], ratings: Record<string, { before: number; after: number }> = {}) =>
    ({ version: 3 as const, type: "final" as const, match_id: "m", winner_id: winner, method, round: 2, scorecards, ratings });
  const none = { thrown: 0, landed: 0, jabsThrown: 0, jabsLanded: 0 };

  it("lists each judge's total for a decision, with the fighter who took the card in the lead", () => {
    const card = resultCard(result("decision", "two", [{ judge: "Impact", player_one: [10, 9], player_two: [9, 10] }, { judge: "Craft", player_one: [9, 9], player_two: [10, 10] }]), fighters(), players, [none, none]);
    expect(card.headline).toBe("MAJORITY DECISION");
    expect(card.detail).toBe("ROUND 2");
    expect(card.verdict).toBe("Bravo WINS");
    expect(card.winnerSeat).toBe(1);
    expect(card.names).toEqual(["Alpha", "Bravo"]);
    expect(card.judges).toEqual([
      { label: "IMPACT", values: ["19", "19"], lead: null },
      { label: "CRAFT", values: ["18", "20"], lead: 1 },
    ]);
    expect(card.rows).toEqual([]);
  });

  it("leaves the unfinished scorecards off a stoppage and spells the method out", () => {
    const empty = [{ judge: "Impact", player_one: [], player_two: [] }];
    expect(resultCard(result("ko", "one", empty), fighters(0, 3), players, [none, none])).toMatchObject({ headline: "KNOCKOUT", verdict: "Alpha WINS", winnerSeat: 0, judges: [], rows: [{ label: "KNOCKDOWNS", values: ["3", "0"], lead: 0 }] });
    expect(resultCard(result("flash_ko", "one", empty), fighters(), players, [none, none]).headline).toBe("FLASH KNOCKOUT");
    expect(resultCard(result("tko", "one", empty), fighters(), players, [none, none]).headline).toBe("TECHNICAL KNOCKOUT");
    expect(resultCard(result("forfeit", "one", empty), fighters(), players, [none, none])).toMatchObject({ headline: "FORFEIT", rows: [] });
  });

  it("credits a knockdown to the fighter who scored it", () => {
    const card = resultCard(result("decision", "one"), fighters(1, 2), players, [none, none]);
    expect(card.rows).toEqual([{ label: "KNOCKDOWNS", values: ["2", "1"], lead: 0 }]);
  });

  it("shows the punch stats the way CompuBox counts them, and the rating changes", () => {
    const card = resultCard(result("decision", "one", [], { one: { before: 1000, after: 1016 }, two: { before: 1000, after: 984 } }), fighters(), players, [{ thrown: 9, landed: 6, jabsThrown: 4, jabsLanded: 1 }, none]);
    expect(card.rows).toEqual([
      { label: "TOTAL PUNCHES", values: ["6/9 (67%)", "0/0"], lead: 0 },
      { label: "JABS", values: ["1/4 (25%)", "0/0"], lead: 0 },
      { label: "POWER PUNCHES", values: ["5/5 (100%)", "0/0"], lead: 0 },
      { label: "RATING", values: ["1016 (+16)", "984 (−16)"], lead: null, news: [true, false] },
    ]);
  });

  it("never shows more punches landed than thrown", () => {
    const card = resultCard(result("decision", "one"), fighters(), players, [{ thrown: 2, landed: 3, jabsThrown: 2, jabsLanded: 0 }, none]);
    expect(card.rows.find((row) => row.label === "POWER PUNCHES")!.values[0]).toBe("0/0");
    expect(card.rows.find((row) => row.label === "TOTAL PUNCHES")!.values[0]).toBe("2/2 (100%)");
  });

  it("calls a bout against the computer unrated", () => {
    const computer = { ...players, two: { ...players.two, cpu: true } };
    const card = resultCard(result("decision", "one", [], { one: { before: 1000, after: 1000 }, two: { before: 1400, after: 1400 } }), fighters(), computer, [none, none]);
    expect(card.rows).toEqual([{ label: "RATING", values: ["Unrated", "Unrated"], lead: null }]);
  });

  it("calls a draw a draw and names a winner who is not in either seat", () => {
    expect(resultCard(result("draw", null, [{ judge: "Impact", player_one: [10], player_two: [10] }]), fighters(), players, [none, none])).toMatchObject({ headline: "UNANIMOUS DRAW", verdict: "DRAW", winnerSeat: null });
    expect(resultCard(result("forfeit", "three"), fighters(), { ...players, three: { id: "three", name: "Carol", avatar: null, rating: 1500, connected: true } }, [none, none])).toMatchObject({ verdict: "Carol WINS", winnerSeat: null });
  });

  const full = result("decision", "one", [{ judge: "Impact", player_one: [10, 10], player_two: [9, 9] }, { judge: "Craft", player_one: [10, 10], player_two: [9, 9] }, { judge: "Generalship", player_one: [10, 10], player_two: [9, 9] }], { one: { before: 1000, after: 1016 }, two: { before: 1000, after: 984 } });
  const fullCard = resultCard(full, fighters(0, 1), players, [{ thrown: 9, landed: 6, jabsThrown: 5, jabsLanded: 3 }, { thrown: 4, landed: 1, jabsThrown: 2, jabsLanded: 1 }]);

  it("sits along the bottom of the screen and leaves the ring in view above it", () => {
    for (const [width, height, clear] of [[1280, 720, 0.55], [1920, 1080, 0.6], [390, 844, 0.45], [844, 390, 0.15], [640, 360, 0.1]] as const) {
      const layout = resultCardLayout(width, height, fullCard, true);
      expect(layout.x).toBeGreaterThanOrEqual(12);
      expect(layout.x + layout.width).toBeLessThanOrEqual(width - 12);
      expect(layout.y + layout.height).toBe(height - 14);
      expect(layout.y).toBeGreaterThanOrEqual(height * clear);
      expect(layout.rowHeight).toBeGreaterThanOrEqual(16);
    }
  });

  it("puts the verdict beside the table on a wide or a short screen and above it on a tall one", () => {
    expect(resultCardLayout(1280, 720, fullCard, true).wide).toBe(true);
    expect(resultCardLayout(844, 390, fullCard, true).wide).toBe(true);
    expect(resultCardLayout(390, 844, fullCard, true).wide).toBe(false);
    expect(resultCardLayout(800, 900, fullCard, true).wide).toBe(false);
  });

  it("leaves room for the rematch button on a fighter's card only", () => {
    expect(resultCardLayout(1280, 720, fullCard, true).height - resultCardLayout(1280, 720, fullCard, false).height).toBe(RESULT_CARD_FOOTER - 14);
  });

  it("replaces the plates and the clock", () => {
    const texts: string[] = [];
    const tracker = new RoundStatsTracker();
    tracker.record({ event_id: 1, tick: 1, kind: "punch_start", actor_id: "one", target_id: "two", amount: 0, detail: "", blood: 0, direction: 1, action_id: null });
    drawHud(mockHudContext(texts), 1280, 720, { ...snapshot(), phase: "complete" }, players, "one", full, 0, 30, tracker);
    expect(texts.some((text) => /STAMINA|HEALTH|GUARD|POISE|COMPLETE/.test(text))).toBe(false);
    expect(texts).toEqual(expect.arrayContaining(["UNANIMOUS DECISION", "ROUND 2", "Alpha WINS", "IMPACT", "20 – 18", "Alpha", "Bravo", "TOTAL PUNCHES", "0/1 (0%)", "RATING"]));
  });
});
