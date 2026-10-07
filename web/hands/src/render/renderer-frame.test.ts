import * as THREE from "three";
import { REST_CORNER_OFFSET, RING_CORNER_REACH } from "../manifest";
import { fighter, snapshot } from "../test/fixtures";
import { PROTOCOL_VERSION, type EngineSnapshot, type FighterSnapshot, type FinalMessage } from "../types";
import { CameraDirector, ceremonyShot, cornerPoint, FIGHTER_CAM_FOV_SCALE, FighterCam } from "./camera";
import { RoundStatsTracker } from "./hud";
import { lookFor } from "./looks";
import { FightRenderer, resultCardTop } from "./renderer";
import { buildRing, disposeRing } from "./ring";
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
    drawnOffsets: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
    drawnTargets: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
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
    stoppageWinner: -1,
    stoppageRaiseAt: Number.POSITIVE_INFINITY,
    stoppageSpot: null,
    raiseCentre: new THREE.Vector3(),
    raiseFramed: false,
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

  it("shows the winner and the referee lifting his arm after a knockout, not the count's shot of the body", () => {
    const scale = 3.05 / 500;
    const final: FinalMessage = { version: PROTOCOL_VERSION, type: "final", match_id: "m", winner_id: "one", method: "ko", round: 2, scorecards: [], ratings: {} };
    const result = { match_id: "m", activity_instance_id: "i", guild_id: "g", player_one_id: "one", player_two_id: "two", winner_id: "one", finish_method: "ko" as const, round_number: 2, tick: 400, scorecards: [], player_one_knockdowns: 0, player_two_knockdowns: 1, player_one_damage: 1, player_two_damage: 1 };
    const lying = [new THREE.Vector3(1.8, 0, 0), new THREE.Vector3(1.4, 0, 0), new THREE.Vector3(1.05, 0, 0), new THREE.Vector3(0.7, 0, 0.12), new THREE.Vector3(0.7, 0, -0.12)];
    const screens = [{ width: 1280, height: 720, canvas: { clientWidth: 1280, clientHeight: 720 } }, { width: 390, height: 844, canvas: { clientWidth: 390, clientHeight: 844 } }];
    for (const screen of screens) {
      for (const camera of ["broadcast", "close"] as const) {
        // The winner at x = -0.5, the beaten fighter's spot at 0.3 and his body toward +x; the referee is to lift the arm.
        const knockedOut = fighting({ x: -0.5 / scale }, { x: 0.3 / scale, is_downed: true }, { phase: "complete", result });
        const view = frame(knockedOut, {
          final, stoppageWinner: 0, stoppageRaiseAt: 0, hudViewport: { width: screen.width, height: screen.height },
          canvas: screen.canvas, renderer: { getSize: (out: THREE.Vector2) => out.set(1, 1), setSize: vi.fn() },
        });
        (view.graphs[1] as { fallBody: unknown }).fallBody = { centre: (out: THREE.Vector3) => out.set(1.05, 0, 0), bodyPoint: (index: number, out: THREE.Vector3) => out.copy(lying[index]!) };
        view.settings.camera = camera;
        view.run(400);
        view.camera.updateMatrixWorld(true);
        const top = resultCardTop(final, screen.width, screen.height, knockedOut.fighters, {}, new RoundStatsTracker(), "one");
        const cardTop = 1 - (2 * top) / screen.height;
        // Before, the winner's head was at y 0.97 and his raised glove at 1.38 (16:9, close), or his head at
        // x -1.21 (390x844, close): above or past the edge of the picture.
        for (const height of [1.55, 1.95]) {
          const shown = new THREE.Vector3(-0.5, height, 0).project(view.camera);
          expect(Math.abs(shown.x)).toBeLessThan(0.85);
          expect(shown.y).toBeLessThan(0.82);
          expect(shown.y).toBeGreaterThan(cardTop);
        }
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

  it("waves a stoppage off and lets the winner celebrate only once the punch that ended it is on screen", () => {
    // A third knockdown on tick 30 ends the bout; with reduced motion there is no replay to wait for.
    const result = { match_id: "m", activity_instance_id: "i", guild_id: "g", player_one_id: "one", player_two_id: "two", winner_id: "one", finish_method: "tko" as const, round_number: 1, tick: 30, scorecards: [], player_one_knockdowns: 0, player_two_knockdowns: 3, player_one_damage: 0, player_two_damage: 900 };
    const ended = { ...snapshot(30), phase: "complete" as const, fighters: [fighter("one", -60), { ...fighter("two", 60), is_downed: true, knockdowns: 3 }] as const, result };
    const finish = (frameSeconds: number) => {
      const waveOff = vi.fn();
      const celebrate = vi.fn();
      const stub = prototypeOf({
        frameSeconds, buffer: { latest: () => ended }, commentary: { finish: vi.fn() }, endCeremony: vi.fn(), players: {}, history: [ended], simulation: SIMULATION,
        graphs: [{ celebrate }, { celebrate: vi.fn() }], settings: () => ({ reducedMotion: true, blood: "full" }), arcadeInjuries: [null, null], pendingContacts: [],
        lastKnockdown: null, referee: { waveOff }, headCacheValid: [false, false], stoppageWinner: -1,
      });
      method("setFinal").call(stub, { version: PROTOCOL_VERSION, type: "final", match_id: "m", winner_id: "one", method: "tko", round: 1, scorecards: [], ratings: {} });
      return { stub, waveOff, celebrate };
    };
    const { stub, waveOff, celebrate } = finish(5);
    // The final arrives while the screen is still two ticks short of the punch.
    method("presentFinishWhenShown").call(stub, 28);
    expect(waveOff).not.toHaveBeenCalled();
    expect(celebrate).not.toHaveBeenCalled();
    // The frame that shows the punch (contacts are presented first, in the same frame) calls the finish.
    method("presentFinishWhenShown").call(stub, 30);
    expect(waveOff).toHaveBeenCalledOnce();
    expect(celebrate).toHaveBeenCalledOnce();
    expect(stub.stoppageWinner).toBe(0);
    // Should the clock never get there, it waits half a second at most.
    const stuck = finish(5);
    (stuck.stub as { frameSeconds: number }).frameSeconds = 5.6;
    method("presentFinishWhenShown").call(stuck.stub, 25);
    expect(stuck.waveOff).toHaveBeenCalledOnce();
  });

  it("shows a result once, however many times it arrives", () => {
    const standing = { ...snapshot(400), phase: "complete" as const };
    const stub = prototypeOf({
      frameSeconds: 5, buffer: { latest: () => standing }, commentary: { finish: vi.fn() }, endCeremony: vi.fn(), players: {}, history: [], simulation: SIMULATION, final: null,
    });
    const decision = { version: PROTOCOL_VERSION, type: "final", match_id: "m", winner_id: "one", method: "decision", round: 3, scorecards: [], ratings: {} } as const;
    method("setFinal").call(stub, decision);
    const ceremony = stub.ceremony;
    (stub as { frameSeconds: number }).frameSeconds = 8;
    method("setFinal").call(stub, { ...decision });
    expect(stub.ceremony).toBe(ceremony);
    expect(stub.ovationUntil).toBe(5 + 16);
    expect((stub.commentary as { finish: ReturnType<typeof vi.fn> }).finish).toHaveBeenCalledOnce();
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

  it("keeps both fighters in the rest's wide shot on a phone held upright, steady as they cross and clear of the corner", () => {
    const mapping = worldMapping(SIMULATION);
    const corner = mapping.x(REST_CORNER_OFFSET);
    const pull = THREE.MathUtils.clamp(1.2 / (390 / 844), 1, 2.2);
    const shotFor = (one: number, two: number, viewerId: string | null = "one", portraitPull = pull) => {
      const stub = prototypeOf({
        portraitPull, viewerId, mapping, cornerPosition: new THREE.Vector3(), cornerLookAt: new THREE.Vector3(), tmpCamera: new THREE.Vector3(),
        tmpA: new THREE.Vector3(mapping.x(one), 0, 0), tmpB: new THREE.Vector3(mapping.x(two), 0, 0),
      });
      const shot = method("restWideFrame").call(stub, { ...snapshot(), phase: "rest", fighters: [fighter("one", one), fighter("two", two)] }) as { position: THREE.Vector3; lookAt: THREE.Vector3 } | null;
      return shot === null ? null : { position: shot.position.clone(), lookAt: shot.lookAt.clone() };
    };
    // They walk past each other to their corners: the shot holds still (it used to swing 173 degrees round).
    const passing = [-200, -60, -10, 10, 60, 200].map((x) => shotFor(x, -x)!);
    for (const shot of passing) {
      expect(shot.position.distanceTo(passing[0]!.position)).toBe(0);
      expect(shot.lookAt.distanceTo(passing[0]!.lookAt)).toBe(0);
    }
    const { position, lookAt } = passing[0]!;
    const camera = new THREE.PerspectiveCamera(36 * Math.min(1.3, Math.sqrt(pull)), 390 / 844, 0.1, 80);
    camera.position.copy(position);
    camera.lookAt(lookAt);
    camera.updateMatrixWorld(true);
    // Both in their corners, seated or standing, are on the screen.
    const stools = [cornerPoint(0, corner, 0, 0, new THREE.Vector3()), cornerPoint(1, corner, 0, 0, new THREE.Vector3())];
    for (const stool of stools) {
      for (const height of [0.5, 1.3, 1.65]) {
        const shown = new THREE.Vector3(stool.x, height, stool.z).project(camera);
        expect(Math.abs(shown.x)).toBeLessThan(0.85);
        expect(Math.abs(shown.y)).toBeLessThan(0.85);
      }
    }
    // Neither the near post and its pads nor the cornerman leaning over the ropes stands between the camera
    // and the near fighter's head and chest: before, every line to him ran through the post and both pads.
    const ring = buildRing();
    ring.group.updateMatrixWorld(true);
    const corners: THREE.Object3D[] = [];
    ring.group.traverse((object) => {
      if (object instanceof THREE.Mesh && (object.geometry.type === "CylinderGeometry" || (object.geometry.type === "BoxGeometry" && (object.geometry as THREE.BoxGeometry).parameters.height === 0.52))) corners.push(object);
    });
    const raycaster = new THREE.Raycaster();
    const cornerman = new THREE.Vector3(-2.95, 0, 2.95);
    for (const height of [1.3, 1.0]) {
      const target = new THREE.Vector3(stools[0]!.x, height, stools[0]!.z);
      raycaster.set(position, target.clone().sub(position).normalize());
      raycaster.far = position.distanceTo(target) - 0.15;
      expect(raycaster.intersectObjects(corners, false)).toEqual([]);
      for (const at of [1.2, 1.6]) {
        const leaning = new THREE.Vector3(cornerman.x, at, cornerman.z);
        expect(new THREE.Line3(position, target).closestPointToPoint(leaning, true, new THREE.Vector3()).distanceTo(leaning)).toBeGreaterThan(0.5);
      }
    }
    disposeRing(ring);
    // The red corner's fighter gets the same shot from behind his own corner.
    const red = shotFor(-60, 60, "two")!;
    expect(red.position.x).toBeCloseTo(-position.x, 6);
    expect(red.position.z).toBeCloseTo(-position.z, 6);
    // A landscape screen keeps the broadcast's own wide shot.
    expect(shotFor(-60, 60, "one", 1)).toBeNull();
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

  /** The two fighters as drawn, frame after frame, from where the engine has them. */
  const drawing = (graphs: unknown = null) => {
    const stub = prototypeOf({
      graphs, mapping: worldMapping(SIMULATION), replay: null, bodyPoint: new THREE.Vector3(),
      drawnFighters: [fighter("one"), fighter("two")], drawnOffsets: [{ x: 0, y: 0 }, { x: 0, y: 0 }], drawnTargets: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
    });
    return (one: Partial<FighterSnapshot>, two: Partial<FighterSnapshot>) => {
      const [a, b] = method("standApart").call(stub, [{ ...fighter("one"), ...one }, { ...fighter("two"), ...two }], 1 / 60) as [FighterSnapshot, FighterSnapshot];
      return [{ x: a.x, y: a.y }, { x: b.x, y: b.y }] as const;
    };
  };
  /** The most either fighter's drawn offset from his engine place changes in one frame, in metres, through a sequence of engine places. */
  const steadiest = (frames: readonly (readonly [Partial<FighterSnapshot>, Partial<FighterSnapshot>])[]) => {
    const draw = drawing();
    const offsets = (one: Partial<FighterSnapshot>, two: Partial<FighterSnapshot>) => {
      const drawn = draw(one, two);
      return [{ x: drawn[0].x - (one.x ?? 0), y: drawn[0].y - (one.y ?? 0) }, { x: drawn[1].x - (two.x ?? 0), y: drawn[1].y - (two.y ?? 0) }] as const;
    };
    let previous = offsets(...frames[0]!);
    let worst = 0;
    for (const [one, two] of frames.slice(1)) {
      const next = offsets(one, two);
      for (const seat of [0, 1] as const) worst = Math.max(worst, Math.hypot(next[seat].x - previous[seat].x, next[seat].y - previous[seat].y) * (3.05 / 500));
      previous = next;
    }
    return worst;
  };
  const hold = <T,>(count: number, frame: T): T[] => Array.from({ length: count }, () => frame);

  it("eases fighters apart and together rather than jumping them at a clinch, on the ropes or in a corner", () => {
    // Closing from 110 to the engine's 76 units, then holding on: the clinch drops the drawn gap.
    const clinch = [...hold(20, [{ x: -55 }, { x: 55 }] as const), ...hold(20, [{ x: -38 }, { x: 38 }] as const), ...hold(30, [{ x: -30, clinch_ticks: 9 }, { x: 30, clinch_ticks: 9 }] as const)];
    // Before: 8.5 cm in one frame for each fighter when the clinch began.
    expect(steadiest(clinch)).toBeLessThan(0.02);
    // Backed onto the ropes a unit at a time: before, both drawn fighters jumped 6.7 cm when the one on the
    // ropes ran out of room to step back.
    const ropes = Array.from({ length: 30 }, (_, step) => [{ x: 432 + step - 76 }, { x: 432 + step }] as const);
    expect(steadiest(ropes)).toBeLessThan(0.02);
    // Backed into a corner, drawn inside the corner pad's cut as the engine keeps him (before: 9 cm into it).
    const draw = drawing();
    let cornered = draw({ x: 382, y: 255 }, { x: 440, y: 293 });
    for (let frame = 0; frame < 60; frame += 1) cornered = draw({ x: 382, y: 255 }, { x: 440, y: 293 });
    expect(Math.abs(cornered[1].x) + Math.abs(cornered[1].y)).toBeLessThanOrEqual(RING_CORNER_REACH + 1e-6);
    expect(Math.hypot(cornered[1].x - cornered[0].x, cornered[1].y - cornered[0].y)).toBeGreaterThan(103);
  });

  it("starts the decision's walk to the marks from where the fighters were drawn at the bell", () => {
    // Engine places 60 units apart, drawn 104 apart.
    const { renderer, run, graphs } = frame(fighting({ x: -30 }, { x: 30 }));
    run(30);
    // The drawn fighters are reused objects: keep the number, not the fighter.
    const drawnApart = (graphs[0]!.update.mock.calls.at(-1)![0] as FighterSnapshot).x;
    expect(drawnApart).toBeCloseTo(-52, 0);
    (renderer as { ceremony: unknown }).ceremony = { winnerSeat: 0, positions: null, refereeArrived: false, arrivedAt: null, announced: false };
    run(1);
    // Before, the walk started from the engine's place (x = -30), 13 cm from where he stood a frame before.
    const walking = (graphs[0]!.update.mock.calls.at(-1)![0] as FighterSnapshot).x;
    expect(Math.abs(walking - drawnApart)).toBeLessThan(200 / 60 + 0.5);
  });

  it("keeps a fighter pushed off a body on the canvas inside the ropes, sliding along them", () => {
    const limit = 3.05 * (462 / 500);
    let seed = 2026;
    const random = (): number => {
      seed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed);
      return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
    };
    let outside = 0;
    let inside = 0;
    for (let trial = 0; trial < 3000; trial += 1) {
      const centre = { x: (random() * 2 - 1) * 2.6, z: (random() * 2 - 1) * 2.6 };
      const angle = random() * Math.PI * 2;
      const body = [0, 1, 2, 3, 4].map((point) => new THREE.Vector3(centre.x + Math.cos(angle) * (point - 2) * 0.4, 0, centre.z + Math.sin(angle) * (point - 2) * 0.4));
      const standing = { x: (random() * 2 - 1) * 2.6, z: (random() * 2 - 1) * 2.6 };
      const draw = drawing([{ fallBody: null }, { fallBody: { bodyPoint: (point: number, out: THREE.Vector3) => out.copy(body[point]!) } }]);
      const [drawn] = draw({ x: standing.x / (3.05 / 500), y: -standing.z / (3.05 / 500) }, { x: 300, y: 300, is_downed: true });
      const x = drawn.x * (3.05 / 500);
      const z = -drawn.y * (3.05 / 500);
      if (Math.abs(x) > limit + 1e-3 || Math.abs(z) > limit + 1e-3) outside += 1;
      if (body.some((point) => Math.hypot(x - point.x, z - point.z) < 0.5 - 1e-3)) inside += 1;
    }
    // Before, 33 in 20,000 such pushes left him outside the ropes' limit, by up to 0.37 m.
    expect(outside).toBe(0);
    expect(inside).toBe(0);
  });

  /** A close-up on fighter two, beaten, with the winner and the referee out of the way. */
  const closeUp = (fields: Record<string, unknown>) => prototypeOf({
    finishCloseUpUntil: 101.7, finishCloseUpAt: 100, finishCloseUpIndex: 1, finishCloseUpBearing: null, finishCloseUpHanging: false, headCacheValid: [true, true],
    headCache: [new THREE.Vector3(), new THREE.Vector3(0.4, 0.3, 0.1)], arcadeInjuries: [null, null], graphs: null,
    closeUpTarget: new THREE.Vector3(), closeUpFacing: new THREE.Vector3(), closeUpPosition: new THREE.Vector3(), replayLookAt: new THREE.Vector3(), bodyPoint: new THREE.Vector3(),
    tmpA: new THREE.Vector3(-1.6, 0, -1.2), tmpB: new THREE.Vector3(0.4, 0, 0.1), refereePosition: new THREE.Vector3(-0.6, 0, -1.9),
    effects: { severedHeadPosition: () => false, eyePosition: () => false },
    ...fields,
  });
  const shoot = (stub: Record<string, unknown>, seconds: number) => method("closeUpFrame").call(stub, seconds) as { position: THREE.Vector3; lookAt: THREE.Vector3 } | null;

  it("frames an eye out of its socket one way for the whole close-up, however it swings", () => {
    const skull = new THREE.Vector3(0.5, 0.3, 0.2);
    const eye = new THREE.Vector3(0.62, 0.3, 0.2);
    const stub = closeUp({
      arcadeInjuries: [null, "eye_right"],
      effects: { severedHeadPosition: () => false, eyePosition: (_index: number, out: THREE.Vector3) => { out.copy(eye); return true; } },
      headWorldPose: () => ({ position: skull, quaternion: new THREE.Quaternion() }),
    });
    const beside = shoot(stub, 100.2)!;
    const before = { position: beside.position.clone(), lookAt: beside.lookAt.clone() };
    // The eye swings under the skull, past the line where it would no longer be in sight.
    const swung = eye.distanceTo(new THREE.Vector3(0.5, 0.16, 0.2));
    eye.set(0.5, 0.16, 0.2);
    const under = shoot(stub, 100.2 + 1 / 60)!;
    // Before, the shot switched to the head's own framing there and the camera jumped 55 cm in one frame;
    // now it only goes with the eye.
    expect(under.position.distanceTo(before.position)).toBeLessThan(swung + 0.01);
    expect(under.position.y - under.lookAt.y).toBeCloseTo(before.position.y - before.lookAt.y, 6);
  });

  it("waits for a falling body to come to rest before it picks the side to shoot his face from", () => {
    const face = new THREE.Vector3(1, 0, 0);
    const body = { body: { asleep: false }, faceDirection: (out: THREE.Vector3) => out.copy(face), bodyPoint: (_point: number, out: THREE.Vector3) => out.set(0.4, 0, 1.2) };
    const stub = closeUp({ graphs: [{ fallBody: null }, { fallBody: body }] });
    // Still falling, face to +x: no close-up yet, and no side picked from a face that is still turning.
    let seconds = 100;
    for (; seconds < 100.8; seconds += 1 / 60) expect(shoot(stub, seconds)).toBeNull();
    expect(stub.finishCloseUpBearing).toBeNull();
    // He lands face to -z and comes to rest: the shot comes from there, for its full length.
    face.set(0, 0, -1);
    body.body.asleep = true;
    const shot = shoot(stub, seconds)!;
    expect(stub.finishCloseUpBearing).toBeCloseTo(Math.PI, 6);
    expect(shot.position.z).toBeLessThan(shot.lookAt.z);
    expect(stub.finishCloseUpUntil).toBeCloseTo(seconds + 1.7, 1);
    // A body that never comes to rest is not waited for past 1.2 s.
    const restless = closeUp({ graphs: [{ fallBody: null }, { fallBody: { ...body, body: { asleep: false } } }] });
    expect(shoot(restless, 101.25)).not.toBeNull();
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
