import * as THREE from "three";
import { fighter, snapshot } from "../test/fixtures";
import type { EngineSnapshot, FighterSnapshot, FinalMessage } from "../types";
import { CameraDirector, ceremonyShot, FIGHTER_CAM_FOV_SCALE, FighterCam } from "./camera";
import { RoundStatsTracker } from "./hud";
import { lookFor } from "./looks";
import { FightRenderer, resultCardTop } from "./renderer";
import { RockedVision } from "./rocked";
import { worldMapping } from "./world";

/**
 * Runs the renderer's real frame (draw) against stand-ins for the GPU and the scene, so that what the
 * frame decides and whether it calls each of its parts is tested, not only the parts on their own.
 */
const SIMULATION = { tick_rate: 30, ring_half_width: 500, ring_half_height: 500 };

type Settings = { reducedMotion: boolean; blood: "full" | "reduced" | "off"; camera: "broadcast" | "close" | "fighter"; commentary: boolean; announcer: boolean; volume: number; haptics: boolean };

function graph() {
  return {
    boxer: { root: new THREE.Object3D(), bone: () => null, setLook: vi.fn(), metrics: { headRestY: 1.52 }, rig: { bones: { gloveL: new THREE.Object3D(), gloveR: new THREE.Object3D() } } },
    awaitVerdict: vi.fn(),
    announce: vi.fn(),
    setResting: vi.fn(),
    setCountdown: vi.fn(),
    setObstacle: vi.fn(),
    stayDown: vi.fn(),
    update: vi.fn(),
    fallBody: null,
    stoolVisible: false,
  };
}

function frame(state: EngineSnapshot, overrides: Record<string, unknown> = {}) {
  const settings: Settings = { reducedMotion: false, blood: "full", camera: "broadcast", commentary: true, announcer: true, volume: 0, haptics: false };
  const latest = { current: state };
  const camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 100);
  const renderer = Object.assign(Object.create(FightRenderer.prototype) as Record<string, unknown>, {
    destroyed: false,
    previous: 0,
    canvas: { clientWidth: 1280, clientHeight: 720 },
    renderer: { getSize: (out: THREE.Vector2) => out.set(1280, 720), setSize: vi.fn() },
    composer: { setSize: vi.fn(), render: vi.fn() },
    camera,
    portraitPull: 1,
    baseFov: 36,
    sizeCheck: new THREE.Vector2(),
    frameSeconds: 0,
    finishPass: { uniforms: { uTime: { value: 0 } } },
    lastManualTime: 0,
    settings: () => settings,
    setBloodLevel: vi.fn(),
    buffer: { latest: () => latest.current, sample: () => latest.current, renderTick: () => latest.current.tick, interpolationDelayTicks: 2 },
    history: [state],
    updateRocked: vi.fn(),
    finishSeen: false,
    finishSlowMotion: 0,
    ovationUntil: 0,
    arena: { excite: vi.fn(), update: vi.fn() },
    viewerHitFlash: 0,
    localInput: null,
    replay: null,
    ceremony: null,
    drawnFighters: [fighter("one"), fighter("two")],
    arcadeInjuries: [null, null],
    observedInjuryDown: [false, false],
    restoreInjury: vi.fn(),
    graphs: [graph(), graph()],
    lookIds: [null, null],
    headCache: [new THREE.Vector3(), new THREE.Vector3()],
    headCacheValid: [false, false],
    liveFallTicks: [null, null],
    fallingLive: [false, false],
    simulation: SIMULATION,
    lastPhase: state.phase,
    roundCalloutUntil: 0,
    roundCalloutRound: 0,
    enterRest: vi.fn(),
    anticipatePunches: vi.fn(),
    mapping: worldMapping(SIMULATION),
    bodyPoint: new THREE.Vector3(),
    ring: { setRopeContacts: vi.fn(), setNearRopeOpacity: vi.fn(), nearRopeOpacity: () => 1 },
    tmpA: new THREE.Vector3(),
    tmpB: new THREE.Vector3(),
    tmpHead: new THREE.Vector3(),
    tmpCamera: new THREE.Vector3(),
    downedPoolAccumulators: [0, 0],
    downedPoolCounts: [0, 0],
    effects: { drip: vi.fn(), stopDrip: vi.fn(), pool: vi.fn(), update: vi.fn(), shakeAmount: 0, setViewDistance: vi.fn() },
    updateIdleFighters: vi.fn(),
    updateTrails: vi.fn(),
    updateReferee: vi.fn(),
    updateCornermen: vi.fn(),
    updateCutmen: vi.fn(),
    updateBlobShadows: vi.fn(),
    fireContacts: vi.fn(),
    followSpot: null,
    director: new CameraDirector(),
    viewerId: "one",
    fighterCam: new FighterCam(),
    ownViewActive: false,
    ownForward: { x: 0, z: -1 },
    cameraOverride: null,
    finishCloseUpUntil: 0,
    finishCloseUpIndex: -1,
    restStartedAt: 0,
    cutmen: null,
    cutmanProgress: [0, 0],
    cornerPosition: new THREE.Vector3(),
    cornerLookAt: new THREE.Vector3(),
    final: null,
    players: {},
    roundStats: new RoundStatsTracker(),
    hudViewport: { width: 1280, height: 720 },
    manualClock: true,
    pixelRatioCap: 2,
    basePixelRatio: 2,
    pendingFinish: null,
    ...overrides,
  });
  const draw = (FightRenderer.prototype as unknown as { draw(this: unknown, time: number, manual: boolean, render: boolean): void }).draw;
  let time = 1000;
  const run = (frames = 1): void => {
    for (let index = 0; index < frames; index += 1) {
      time += 1000 / 60;
      draw.call(renderer, time, true, false);
    }
  };
  return { renderer, settings, camera, latest, run, graphs: renderer.graphs as ReturnType<typeof graph>[] };
}

const fighting = (one: Partial<FighterSnapshot> = {}, two: Partial<FighterSnapshot> = {}, extra: Partial<EngineSnapshot> = {}): EngineSnapshot => {
  const base = snapshot(40);
  return { ...base, fighters: [{ ...base.fighters[0], ...one }, { ...base.fighters[1], ...two }], ...extra };
};

describe("a rendered frame", () => {
  it("keeps the cameras on the fighters on the frame a heavy punch lands", () => {
    const fireContacts = (FightRenderer.prototype as unknown as { fireContacts: unknown }).fireContacts;
    const opponentHead = new THREE.Vector3(0.67, 1.6, 0);
    const moved = (camera: Settings["camera"]): { quiet: number; contact: number } => {
      const state = fighting({ x: -110 }, { x: 110 });
      const effects = { drip: vi.fn(), stopDrip: vi.fn(), pool: vi.fn(), update: vi.fn(), shakeAmount: 0, setViewDistance: vi.fn(), addEvent: vi.fn(), spawnTeeth: vi.fn(), ejectMouthpiece: vi.fn() };
      const harness = frame(state, {
        fireContacts,
        effects,
        pendingContacts: [],
        contactPoint: new THREE.Vector3(),
        mouthPoint: new THREE.Vector3(),
        presentFightEvent: vi.fn(),
        applyArcadeInjury: vi.fn(),
        headWorldPose: () => ({ position: opponentHead, quaternion: new THREE.Quaternion() }),
        gearColor: () => 0xffffff,
        flashKnockout: null,
        onContact: null,
      });
      harness.settings.camera = camera;
      for (const graph of harness.graphs) Object.assign(graph, { react: vi.fn(), landedHit: vi.fn() });
      harness.run(240);
      const before = harness.camera.position.clone();
      harness.run(1);
      const quiet = harness.camera.position.distanceTo(before);
      const settled = harness.camera.position.clone();
      const counter = { event_id: 7, tick: 40, kind: "counter_hit", actor_id: "one", target_id: "two", amount: 130, detail: "straight:head", blood: 40, direction: 1, action_id: "p1" };
      (harness.renderer.pendingContacts as unknown[]).push({ event: counter, presentationEvent: counter, presentImpact: true, reactAmount: counter.amount, contactTick: 0, recipientIndex: 1, puncherIndex: 0, injury: null });
      harness.run(1);
      expect(effects.spawnTeeth).toHaveBeenCalled();
      expect(effects.ejectMouthpiece).toHaveBeenCalled();
      return { quiet, contact: harness.camera.position.distanceTo(settled) };
    };
    for (const camera of ["fighter", "broadcast"] as const) {
      const { quiet, contact } = moved(camera);
      expect(quiet).toBeLessThan(0.002);
      expect(contact).toBeLessThan(0.002);
    }
  });

  it("dresses each fighter in the look of the player in that seat", () => {
    const { run, graphs } = frame(fighting());
    run(3);
    expect(graphs[0]!.boxer.setLook).toHaveBeenCalledOnce();
    expect(graphs[0]!.boxer.setLook).toHaveBeenCalledWith(lookFor("one"));
    expect(graphs[1]!.boxer.setLook).toHaveBeenCalledWith(lookFor("two"));
  });

  it("eases apart fighters standing in each other, but not two in a clinch or one who is down", () => {
    const drawnGap = (one: Partial<FighterSnapshot>): number => {
      const { run, graphs } = frame(fighting({ x: -30, ...one }, { x: 30 }));
      run();
      const [a, b] = graphs[0]!.update.mock.calls[0]! as [FighterSnapshot, FighterSnapshot];
      return b.x - a.x;
    };
    expect(drawnGap({})).toBeGreaterThanOrEqual(103);
    expect(drawnGap({ clinch_ticks: 20 })).toBe(60);
    expect(drawnGap({ is_downed: true })).toBe(60);
  });

  it("seats the fighters through the rest until the seconds are called out", () => {
    const seated = (remaining: number): unknown => {
      const { run, graphs } = frame(fighting({}, {}, { phase: "rest", phase_ticks_remaining: remaining }));
      run();
      return graphs[0]!.setResting.mock.calls.at(-1)?.[0];
    };
    expect(seated(300)).toBe(true);
    expect(seated(60)).toBe(false);
  });

  it("offers each fighter's next punch from the newest snapshot every frame", () => {
    const { renderer, run, latest } = frame(fighting());
    run(2);
    expect(renderer.anticipatePunches).toHaveBeenCalledTimes(2);
    expect((renderer.anticipatePunches as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(latest.current);
  });

  it("keeps the crowd cheering through the ovation", () => {
    const { renderer, run } = frame(fighting(), { ovationUntil: 999 });
    run();
    expect((renderer.arena as { excite: ReturnType<typeof vi.fn> }).excite).toHaveBeenCalled();
  });

  it("tells the blood how far the camera is from what it looks at", () => {
    const { renderer, run } = frame(fighting());
    run();
    const [distance] = (renderer.effects as { setViewDistance: ReturnType<typeof vi.fn> }).setViewDistance.mock.calls.at(-1)! as [number];
    expect(distance).toBeGreaterThan(3);
    expect(distance).toBeLessThan(12);
  });

  it("hurts the viewer's own vision every frame it is due", () => {
    const { renderer, run } = frame(fighting());
    run(2);
    expect(renderer.updateRocked).toHaveBeenCalledTimes(2);
  });

  it("starts the hurt vision and the muffle with the punch that rocked him, not when its snapshot arrives", () => {
    const updateRocked = (FightRenderer.prototype as unknown as { updateRocked: unknown }).updateRocked;
    const calm = { ...fighting(), tick: 40 };
    const stunned = (tick: number): EngineSnapshot => ({ ...fighting({ stunned_ticks: 36 }), tick });
    const watch = (viewerId: string | null) => {
      const heard: number[] = [];
      const finishPass = { uniforms: { uTime: { value: 0 }, uRocked: { value: 0 } } };
      const harness = frame(calm, { viewerId, updateRocked, rocked: new RockedVision(), finishPass, onRocked: (level: number) => heard.push(level) });
      const arrive = (next: EngineSnapshot): void => {
        harness.latest.current = next;
        (harness.renderer.history as EngineSnapshot[]).push(next);
      };
      harness.run(3);
      // The snapshot carrying the stun arrives; the render clock is still a tick short of the punch.
      arrive(stunned(41));
      harness.run(3);
      const early = { vision: finishPass.uniforms.uRocked.value, sound: heard.at(-1) };
      // The clock reaches it.
      arrive(stunned(42));
      harness.run(3);
      return { early, vision: finishPass.uniforms.uRocked.value, sound: heard.at(-1), heard };
    };
    const own = watch("one");
    expect(own.early).toEqual({ vision: 0, sound: 0 });
    expect(own.vision).toBeGreaterThan(0.2);
    expect(own.sound).toBe(1);
    // A spectator's sound is never muffled.
    expect(watch(null).heard).toEqual([]);
  });

  it("fades the near ropes for the broadcast camera as the fighters come toward it", () => {
    const opacity = (y: number): number => {
      const { renderer, run } = frame(fighting({ y }, { y }));
      run();
      return (renderer.ring as { setNearRopeOpacity: ReturnType<typeof vi.fn> }).setNearRopeOpacity.mock.calls.at(-1)![0] as number;
    };
    expect(opacity(-420)).toBeLessThan(0.99);
    expect(opacity(420)).toBeCloseTo(1, 6);
  });

  it("uses the close broadcast camera when the player chose it", () => {
    const director = new CameraDirector();
    const update = vi.spyOn(director, "update");
    const { settings, run } = frame(fighting(), { director });
    settings.camera = "close";
    run();
    expect(update.mock.calls.at(-1)![8]).toBe(true);
    settings.camera = "broadcast";
    run();
    expect(update.mock.calls.at(-1)![8]).toBe(false);
  });

  it("puts the camera over the player's own shoulder when chosen, but never for a spectator", () => {
    const own = frame(fighting());
    own.settings.camera = "fighter";
    own.run(2);
    expect((own.renderer as unknown as FightRenderer).viewForward()).not.toBeNull();
    expect(own.camera.fov).toBeCloseTo(36 * FIGHTER_CAM_FOV_SCALE, 6);
    const watching = frame(fighting(), { viewerId: null });
    watching.settings.camera = "fighter";
    watching.run(2);
    expect((watching.renderer as unknown as FightRenderer).viewForward()).toBeNull();
    expect(watching.camera.fov).toBe(36);
  });

  it("keeps the player's own camera behind his back on a phone held upright", () => {
    const scale = 3.05 / 500;
    const portrait = { canvas: { clientWidth: 390, clientHeight: 844 }, renderer: { getSize: (out: THREE.Vector2) => out.set(1, 1), setSize: vi.fn() } };
    for (const z of [1, 1.5, 2, 2.4]) {
      // Facing -z, the opponent a metre ahead: his back is toward +z.
      const own = frame(fighting({ x: 0, y: -z / scale, facing_x: 0, facing_y: 1000 }, { x: 0, y: -(z - 1) / scale }), portrait);
      own.settings.camera = "fighter";
      own.run(240);
      const behind = own.camera.position.z - z;
      const offHisBack = THREE.MathUtils.radToDeg(Math.atan2(Math.abs(own.camera.position.x), behind));
      // Was 1.2 / 0.7 / 0.2 / -0.2 m behind and 60 / 71 / 84 / 96 degrees round: a side view, clamped inside the ropes.
      // Now 2.3 / 2.0 / 1.5 / 1.1 m behind and 19 degrees round throughout.
      expect(behind).toBeGreaterThan(z < 2.4 ? 1.4 : 1);
      expect(offHisBack).toBeLessThan(22);
      // His own chest and the opponent's head are on the screen.
      own.camera.updateMatrixWorld(true);
      for (const point of [new THREE.Vector3(0, 1.2, z), new THREE.Vector3(0, 1.55, z - 1)]) {
        const shown = point.project(own.camera);
        expect(Math.abs(shown.x)).toBeLessThan(0.9);
        expect(Math.abs(shown.y)).toBeLessThan(0.9);
      }
    }
  });

  it("spreads a pool of blood under a bleeding fighter who is down", () => {
    const bleeding = { ...fighter("two").trauma, bleeding: 500, left_cut: 300 };
    const { renderer, run } = frame(fighting({}, { is_downed: true, trauma: bleeding }, { phase: "knockdown" }));
    run(40);
    expect((renderer.effects as { pool: ReturnType<typeof vi.fn> }).pool).toHaveBeenCalled();
  });

  it("frames the decision above the result card, looking through the near ropes", () => {
    const final: FinalMessage = { version: 3, type: "final", match_id: "m", winner_id: "one", method: "decision", round: 3, scorecards: [], ratings: {} };
    const state = fighting({}, {}, { phase: "complete" });
    const ceremony = { winnerSeat: 0, positions: [{ x: -102, y: -16 }, { x: 102, y: -16 }], marks: [0, 1], refereeArrived: true, arrivedAt: 0.5, announced: true };
    const { renderer, run, camera } = frame(state, { ceremony, final, settings: () => ({ reducedMotion: true, blood: "full", camera: "broadcast" }), referee: { raise: vi.fn() }, ceremonyWrists: [new THREE.Vector3(), new THREE.Vector3()], commentary: { verdict: vi.fn() } });
    run();
    const top = resultCardTop(final, 1280, 720, state.fighters, {}, new RoundStatsTracker(), "one");
    const shot = ceremonyShot(16 / 9, 36, (720 - top) / 720);
    expect(camera.position.z).toBeCloseTo(shot.distance, 4);
    expect(camera.position.y).toBeCloseTo(shot.height + 0.05 * shot.distance, 4);
    expect((renderer.ring as { setNearRopeOpacity: ReturnType<typeof vi.fn> }).setNearRopeOpacity.mock.calls.at(-1)![0]).toBeLessThan(0.99);
  });
});

describe("around the fight", () => {
  const combat = (kind: string, fields: Record<string, unknown> = {}) => ({ event_id: 1, tick: 40, kind, actor_id: "one", target_id: "two", amount: 0, detail: "", blood: 0, direction: 1, action_id: null, ...fields });
  const prototypeOf = (fields: Record<string, unknown>) => Object.assign(Object.create(FightRenderer.prototype) as Record<string, unknown>, fields);
  const method = <T extends string>(name: T) => (FightRenderer.prototype as unknown as Record<T, (this: unknown, ...args: unknown[]) => unknown>)[name];

  it("draws the commentary caption on top of the HUD", async () => {
    const { mockHudContext } = await import("../test/fixtures");
    const drawCaption = vi.fn();
    const stub = prototypeOf({
      hudCanvas: { getBoundingClientRect: () => ({ width: 1280, height: 720 }), width: 0, height: 0, getContext: () => mockHudContext([]) },
      hudViewport: { width: 0, height: 0 }, viewerHitFlash: 0, settings: () => ({ reducedMotion: false }), players: {}, viewerId: "one", final: null,
      frameSeconds: 0, finalRevealAt: 0, reconnectMs: 0, simulation: SIMULATION, roundStats: new RoundStatsTracker(), replay: null, inputLatencyMs: null,
      roundCalloutUntil: 0, roundCalloutRound: 0, eventCallout: null, roundClock: { ticks: () => null }, avatars: { get: () => null }, drawCaption,
    });
    method("drawHudOverlay").call(stub, snapshot());
    expect(drawCaption).toHaveBeenCalledOnce();
  });

  it("does a knockout's finishing injury at once when there is no replay to show it in", () => {
    const hit = combat("counter_hit", { event_id: 7, detail: "right:uppercut:head", amount: 140 });
    const applyArcadeInjury = vi.fn(() => true);
    const presentFinish = vi.fn();
    const stub = prototypeOf({
      frameSeconds: 5, buffer: { latest: () => snapshot() }, commentary: { finish: vi.fn() }, endCeremony: vi.fn(), players: {}, history: [], simulation: SIMULATION,
      graphs: null, settings: () => ({ reducedMotion: false, blood: "full" }), arcadeInjuries: [null, null],
      lastKnockdown: { knockdown: combat("knockdown", { event_id: 8, amount: 1 }), hit, finisher: "decapitation" }, applyArcadeInjury, presentFinish, pendingContacts: [],
    });
    method("setFinal").call(stub, { version: 3, type: "final", match_id: "m", winner_id: "one", method: "ko", round: 2, scorecards: [], ratings: {} });
    expect(applyArcadeInjury).toHaveBeenCalledWith(1, "decapitation", hit);
    expect(presentFinish).toHaveBeenCalledOnce();
  });

  it("leaves a finishing injury to its punch while the clock has not shown that punch yet", () => {
    const hit = combat("counter_hit", { event_id: 7, detail: "right:uppercut:head", amount: 140 });
    const applyArcadeInjury = vi.fn(() => true);
    const waiting = { event: hit, presentationEvent: hit, presentImpact: true, reactAmount: hit.amount, contactTick: 160, recipientIndex: 1, puncherIndex: 0, injury: null as string | null };
    const stub = prototypeOf({
      frameSeconds: 5, buffer: { latest: () => snapshot() }, commentary: { finish: vi.fn() }, endCeremony: vi.fn(), players: {}, history: [], simulation: SIMULATION,
      graphs: null, settings: () => ({ reducedMotion: false, blood: "full" }), arcadeInjuries: [null, null],
      lastKnockdown: { knockdown: combat("knockdown", { event_id: 8, amount: 3 }), hit, finisher: "decapitation" }, applyArcadeInjury, presentFinish: vi.fn(), pendingContacts: [waiting],
    });
    method("setFinal").call(stub, { version: 3, type: "final", match_id: "m", winner_id: "one", method: "tko", round: 2, scorecards: [], ratings: {} });
    expect(applyArcadeInjury).not.toHaveBeenCalled();
    expect(waiting.injury).toBe("decapitation");
  });

  it("knocks the gum shield out with a big counter to the head", () => {
    const knockOutMouthpiece = vi.fn();
    const event = combat("counter_hit", { event_id: 9, detail: "hook:head", amount: 120 });
    const stub = prototypeOf({
      pendingContacts: [{ event, presentationEvent: event, presentImpact: true, reactAmount: event.amount, contactTick: 40, recipientIndex: 1, puncherIndex: 0, injury: null }],
      buffer: { latest: () => snapshot() }, presentFightEvent: vi.fn(), mapping: worldMapping(SIMULATION), contactPoint: new THREE.Vector3(), mouthPoint: new THREE.Vector3(),
      effects: { addEvent: vi.fn(), spawnTeeth: vi.fn() }, settings: () => ({ reducedMotion: false, blood: "full" }), arena: { excite: vi.fn() }, viewerId: null,
      arcadeInjuries: [null, null], graphs: null, headWorldPose: () => null, knockOutMouthpiece, onContact: null, viewerHitFlash: 0,
    });
    method("fireContacts").call(stub, 50);
    // It flies the way the punch travelled, from fighter one toward fighter two.
    expect(knockOutMouthpiece).toHaveBeenCalledWith(1, { x: 1, z: 0 }, 9, false);
  });

  it("has the winner celebrate when the bout is over", () => {
    const celebrate = [vi.fn(), vi.fn()];
    const stub = prototypeOf({
      referee: { waveOff: vi.fn() }, buffer: { latest: () => snapshot() }, headCacheValid: [false, false], settings: () => ({ reducedMotion: false }), frameSeconds: 0,
      graphs: [{ celebrate: celebrate[0] }, { celebrate: celebrate[1] }],
    });
    method("presentFinish").call(stub, { version: 3, type: "final", match_id: "m", winner_id: "two", method: "tko", round: 2, scorecards: [], ratings: {} });
    expect(celebrate[1]).toHaveBeenCalledOnce();
    expect(celebrate[0]).not.toHaveBeenCalled();
    // He celebrates for as long as the result is up, rather than going back into his guard.
    expect(celebrate[1]!.mock.calls[0]![0]).toBeGreaterThanOrEqual(60);
  });

  it("keeps both fighters in the wide shot of the rest on a phone held upright", () => {
    const mapping = worldMapping({ tick_rate: 30, ring_half_width: 500, ring_half_height: 500 });
    const corner = mapping.x(420);
    const stub = prototypeOf({
      portraitPull: THREE.MathUtils.clamp(1.2 / (390 / 844), 1, 2.2),
      tmpA: new THREE.Vector3(-corner, 0, corner), tmpB: new THREE.Vector3(corner, 0, -corner),
      cornerPosition: new THREE.Vector3(), cornerLookAt: new THREE.Vector3(),
    });
    const frame = method("restWideFrame").call(stub, { ...snapshot(), phase: "rest" }) as { position: THREE.Vector3; lookAt: THREE.Vector3 } | null;
    expect(frame).not.toBeNull();
    const camera = new THREE.PerspectiveCamera(36, 390 / 844, 0.1, 80);
    camera.position.copy(frame!.position);
    camera.lookAt(frame!.lookAt);
    camera.updateMatrixWorld(true);
    for (const fighter of [stub.tmpA as THREE.Vector3, stub.tmpB as THREE.Vector3]) {
      for (const height of [0.3, 1.3]) {
        const point = new THREE.Vector3(fighter.x, height, fighter.z).project(camera);
        expect(Math.abs(point.x)).toBeLessThan(0.85);
        expect(Math.abs(point.y)).toBeLessThan(0.85);
      }
    }
    // A landscape screen keeps the broadcast's own wide shot.
    expect(method("restWideFrame").call(prototypeOf({ ...stub, portraitPull: 1 }), { ...snapshot(), phase: "rest" })).toBeNull();
  });

  it("has the referee lift the winner's arm once he has waved the fight off", () => {
    const raise = vi.fn();
    const glove = (x: number): THREE.Object3D => {
      const bone = new THREE.Object3D();
      bone.position.set(x, 1.9, 0.3);
      bone.updateMatrixWorld(true);
      return bone;
    };
    const stub = prototypeOf({
      referee: { waveOff: vi.fn(), raise, setRefereeCount: vi.fn(), aimBreak: vi.fn(), update: vi.fn(), boxer: { root: new THREE.Object3D() } }, blobShadows: [], buffer: { latest: () => snapshot() }, headCacheValid: [false, false],
      settings: () => ({ reducedMotion: false }), frameSeconds: 0, finishCloseUpIndex: -1,
      graphs: [{ celebrate: vi.fn(), fallBody: null }, { celebrate: vi.fn(), fallBody: null, boxer: { rig: { bones: { gloveL: glove(1.2), gloveR: glove(0.8) } } } }],
      mapping: worldMapping({ tick_rate: 30, ring_half_width: 500, ring_half_height: 500 }),
      tmpA: new THREE.Vector3(-1.4, 0, -0.6), tmpB: new THREE.Vector3(1, 0, 0.3), refereePosition: new THREE.Vector3(-0.8, 0, -1.4),
      refereeVelocity: new THREE.Vector3(), refereeAway: new THREE.Vector3(), refereeYaw: 0, effects: { severedHeadPosition: () => false },
      closeUpTarget: new THREE.Vector3(), replay: null, ceremony: null, stoppageWrist: new THREE.Vector3(), stoppageOtherWrist: new THREE.Vector3(),
    });
    method("presentFinish").call(stub, { version: 3, type: "final", match_id: "m", winner_id: "two", method: "ko", round: 2, scorecards: [], ratings: {} });
    const step = method("updateReferee");
    for (let frame = 0; frame < 150; frame += 1) {
      (stub as { frameSeconds: number }).frameSeconds = frame / 60;
      step.call(stub, 1 / 60, frame / 60, null, frame / 2);
    }
    // While the fight is being waved off, nobody's arm goes up.
    expect(raise.mock.calls.every(([left, right]) => left === null && right === null)).toBe(true);
    for (let frame = 150; frame < 420; frame += 1) {
      (stub as { frameSeconds: number }).frameSeconds = frame / 60;
      step.call(stub, 1 / 60, frame / 60, null, frame / 2);
    }
    const referee = (stub as { refereePosition: THREE.Vector3 }).refereePosition;
    expect(Math.hypot(referee.x - 0.4, referee.z - 0.3)).toBeLessThan(0.05);
    // Beside the winner on his -x side, facing the camera: the referee's left hand holds the winner's nearer glove.
    const [left, right] = raise.mock.lastCall!;
    expect(right).toBeNull();
    expect((left as THREE.Vector3).distanceTo(new THREE.Vector3(0.8, 1.9, 0.3))).toBeLessThan(1e-6);
  });

  /** The referee's own stand-ins, with the winner (seat one) and the beaten fighter where they are drawn. */
  const officiating = (fields: Record<string, unknown>) => {
    const glove = (x: number): THREE.Object3D => {
      const bone = new THREE.Object3D();
      bone.position.set(x, 1.9, 0);
      bone.updateMatrixWorld(true);
      return bone;
    };
    const referee = { raise: vi.fn(), setRefereeCount: vi.fn(), aimBreak: vi.fn(), update: vi.fn(), breaking: false, boxer: { root: new THREE.Object3D() } };
    const stub = prototypeOf({
      referee, blobShadows: [], replay: null, ceremony: null, mapping: worldMapping(SIMULATION), frameSeconds: 0, stoppageWinner: -1, stoppageRaiseAt: Number.POSITIVE_INFINITY, stoppageSpot: null,
      graphs: [{ fallBody: null, boxer: { rig: { bones: { gloveL: glove(-0.35), gloveR: glove(-0.65) } } } }, { fallBody: null }],
      tmpA: new THREE.Vector3(), tmpB: new THREE.Vector3(), refereePosition: new THREE.Vector3(0.4, 0, -2.1), refereeVelocity: new THREE.Vector3(), refereeAway: new THREE.Vector3(),
      refereeYaw: 0, effects: { severedHeadPosition: () => false }, closeUpTarget: new THREE.Vector3(), bodyPoint: new THREE.Vector3(),
      stoppageWrist: new THREE.Vector3(), stoppageOtherWrist: new THREE.Vector3(), lastKnockdown: null,
      ...fields,
    });
    const step = (snapshot: EngineSnapshot | null, frames: number): void => {
      for (let frame = 0; frame < frames; frame += 1) {
        (stub as { frameSeconds: number }).frameSeconds += 1 / 60;
        method("updateReferee").call(stub, 1 / 60, (stub as { frameSeconds: number }).frameSeconds, snapshot, 0);
      }
    };
    return { stub, referee, step };
  };

  it("lifts the winner's arm when the beaten fighter or his body stands on the side he would walk to", () => {
    // The winner at x = -0.5, so the spot toward the middle of the ring is at x = +0.1: right where the loser stands.
    const lying = [new THREE.Vector3(1.4, 0, 0), new THREE.Vector3(1.05, 0, 0), new THREE.Vector3(0.7, 0, 0), new THREE.Vector3(0.35, 0, 0.12), new THREE.Vector3(0.35, 0, -0.12)];
    for (const body of [null, { bodyPoint: (index: number, out: THREE.Vector3) => out.copy(lying[index]!) }]) {
      const { stub, referee, step } = officiating({ stoppageWinner: 0, stoppageRaiseAt: 0 });
      (stub.tmpA as THREE.Vector3).set(-0.5, 0, 0);
      (stub.tmpB as THREE.Vector3).set(0.3, 0, 0);
      (stub.graphs as Array<{ fallBody: unknown }>)[1]!.fallBody = body;
      step(null, 300);
      // Before, he was pushed off the spot every frame and no arm ever went up.
      expect(referee.raise.mock.calls.some(([left, right]) => left !== null || right !== null)).toBe(true);
      const at = stub.refereePosition as THREE.Vector3;
      // Beside him, 0.6 m away.
      expect(Math.hypot(at.x + 0.5, at.z)).toBeCloseTo(0.6, 1);
      expect(Math.hypot(at.x - 0.3, at.z)).toBeGreaterThan(0.55);
      for (const point of body === null ? [] : lying) expect(Math.hypot(at.x - point.x, at.z - point.z)).toBeGreaterThan(0.55);
    }
  });

  it("goes on counting over a fighter who has beaten the count, to the mandatory eight", () => {
    const { stub, referee, step } = officiating({ lastKnockdown: { knockdown: { event_id: 4, tick: 30, kind: "knockdown", actor_id: "one", target_id: "two", amount: 1, detail: "", blood: 0, direction: 1, action_id: null }, hit: null, finisher: null } });
    (stub.tmpA as THREE.Vector3).set(-2.2, 0, 2.2);
    (stub.tmpB as THREE.Vector3).set(0.6, 0, 0);
    // Up at five: the engine no longer has him down, but the phase is still the knockdown's.
    const standingEight = { ...snapshot(60), phase: "knockdown" as const, fighters: [fighter("one", -360), { ...fighter("two", 100), get_up_count: 5 }] as const };
    step(standingEight, 120);
    expect(referee.setRefereeCount).toHaveBeenLastCalledWith(true, 5);
    const at = stub.refereePosition as THREE.Vector3;
    expect(Math.hypot(at.x - 0.61, at.z)).toBeLessThan(1.4);
    // Once they box on, the count is over.
    step({ ...standingEight, phase: "fight" }, 1);
    expect(referee.setRefereeCount).toHaveBeenLastCalledWith(false, 0);
  });
});
