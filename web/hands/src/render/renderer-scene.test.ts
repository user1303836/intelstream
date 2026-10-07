import * as THREE from "three";
import { fighter, snapshot } from "../test/fixtures";
import type { EngineSnapshot, FighterSnapshot } from "../types";
import { CameraDirector, FighterCam } from "./camera";
import { cameraOnPlatform } from "./crowd";
import { RoundStatsTracker } from "./hud";
import { BODY_SITES, BODY_SWELL_CORE, InjuryShading, applyBodyTrauma } from "./injury";
import { FightRenderer } from "./renderer";
import { worldMapping } from "./world";

/**
 * Runs the renderer's real frame (draw) against stand-ins for the GPU and the scene, for what the frame
 * does with the stands and the blood on the canvas.
 */
const SIMULATION = { tick_rate: 30, ring_half_width: 500, ring_half_height: 500 };

type Settings = { reducedMotion: boolean; blood: "full" | "reduced" | "off"; camera: "broadcast" | "close" | "fighter"; commentary: boolean; announcer: boolean; volume: number; haptics: boolean };

function graph() {
  return {
    boxer: { root: new THREE.Object3D(), bone: () => null, setLook: vi.fn(), metrics: { headRestY: 1.52 }, rig: { bones: { gloveL: new THREE.Object3D(), gloveR: new THREE.Object3D() } } },
    setResting: vi.fn(),
    setCountdown: vi.fn(),
    setObstacle: vi.fn(),
    stayDown: vi.fn(),
    update: vi.fn(),
    fallBody: null,
    isDown: false,
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
    updateRocked: vi.fn(),
    finishSeen: false,
    finishSlowMotion: 0,
    ovationUntil: 0,
    arena: { excite: vi.fn(), update: vi.fn(), makeRoomForCamera: vi.fn() },
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

describe("blood from a fighter held on the ropes", () => {
  it("leaves from where he is drawn, not from his place in the engine past the ropes", () => {
    const event = { event_id: 9, tick: 40, kind: "hit", actor_id: "one", target_id: "two", amount: 80, detail: "straight:head", blood: 30, direction: 1, action_id: null };
    const engine = { ...snapshot(), fighters: [fighter("one", 345), fighter("two", 462)] as [FighterSnapshot, FighterSnapshot] };
    const addEvent = vi.fn();
    const stub = Object.assign(Object.create(FightRenderer.prototype) as Record<string, unknown>, {
      pendingContacts: [{ event, presentationEvent: event, presentImpact: true, reactAmount: null, contactTick: 40, recipientIndex: 1, puncherIndex: 0, injury: null }],
      buffer: { latest: () => engine }, presentFightEvent: vi.fn(), mapping: worldMapping(SIMULATION), contactPoint: new THREE.Vector3(), mouthPoint: new THREE.Vector3(),
      effects: { addEvent, spawnTeeth: vi.fn() }, settings: () => ({ reducedMotion: false, blood: "full" }), arena: { excite: vi.fn() }, viewerId: null,
      arcadeInjuries: [null, null], graphs: [{ currentRoot: { x: 1.6, z: 0 }, landedHit: vi.fn() }, { currentRoot: { x: 2.33, z: 0.05 }, react: vi.fn() }], headWorldPose: () => null, knockOutMouthpiece: vi.fn(), onContact: null, viewerHitFlash: 0,
    });
    (FightRenderer.prototype as unknown as { fireContacts(this: unknown, tick: number): void }).fireContacts.call(stub, 50);
    const [, at] = addEvent.mock.calls[0]! as [unknown, THREE.Vector3];
    expect(at.x).toBeCloseTo(2.33, 6);
    expect(at.z).toBeCloseTo(0.05, 6);
  });
});

describe("ribs caved in by the knockout punch", () => {
  const punch = { event_id: 31, tick: 40, kind: "hit", actor_id: "one", target_id: "two", amount: 72, detail: "straight:body", blood: 20, direction: 1, action_id: null };
  const apply = (chestHeight: number) => {
    const chest = new THREE.Object3D();
    chest.position.y = chestHeight;
    chest.updateMatrixWorld(true);
    const addEvent = vi.fn();
    const onArcadeInjury = vi.fn();
    const stub = Object.assign(Object.create(FightRenderer.prototype) as Record<string, unknown>, {
      graphs: [{ currentRoot: { x: -0.6, z: 0 } }, { currentRoot: { x: 0.62, z: 0.1 }, boxer: { rig: { bones: { upperChest: chest } } } }],
      buffer: { latest: () => snapshot() }, mapping: worldMapping(SIMULATION), contactPoint: new THREE.Vector3(), tmpPart: new THREE.Vector3(),
      effects: { addEvent }, arcadeInjuries: [null, null], arcadeInjuryEvents: [null, null], observedInjuryDown: [false, false],
      syncInjuryPresentation: vi.fn(), onArcadeInjury,
    });
    const applied = (FightRenderer.prototype as unknown as { applyArcadeInjury(this: unknown, index: number, injury: string, event: unknown, spray?: unknown): boolean }).applyArcadeInjury.call(stub, 1, "ribs_left", punch, { x: 1, z: 0 });
    return { applied, addEvent, onArcadeInjury, stub };
  };

  it("burst blood from his side as the punch lands, and are kept for the rest of the bout", () => {
    const { applied, addEvent, onArcadeInjury, stub } = apply(1.3);
    expect(applied).toBe(true);
    expect((stub.arcadeInjuries as unknown[])[1]).toBe("ribs_left");
    expect(onArcadeInjury).toHaveBeenCalledWith("ribs_left", punch);
    const [burst, at, reducedMotion, spray] = addEvent.mock.calls[0]! as [{ kind: string; detail: string; amount: number; blood: number; event_id: number }, THREE.Vector3, boolean, unknown];
    // A body burst as big as any blow throws, from where he is drawn, along the punch.
    expect(burst).toMatchObject({ kind: "counter_hit", detail: "hook:body", blood: 100 });
    expect(burst.amount).toBeGreaterThanOrEqual(95);
    expect(burst.event_id).not.toBe(punch.event_id);
    expect([at.x, at.z]).toEqual([0.62, 0.1]);
    expect(reducedMotion).toBe(false);
    expect(spray).toEqual({ x: 1, z: 0 });
  });

  it("throw no blood from rib height over a man already lying on the canvas", () => {
    const { applied, addEvent } = apply(0.25);
    expect(applied).toBe(true);
    expect(addEvent).not.toHaveBeenCalled();
  });

  it("stay caved in every frame over the engine's own bruising", () => {
    const bodyInjury = new InjuryShading(null, BODY_SITES, { core: BODY_SWELL_CORE, wash: true });
    const { run, graphs } = frame(fighting({}, { is_downed: true }, { phase: "knockdown" }), { arcadeInjuries: [null, "ribs_left"] });
    (graphs[1]!.boxer as Record<string, unknown>).bodyInjury = bodyInjury;
    // The graph's own update springs a punch's dent back and paints the engine's trauma.
    graphs[1]!.update.mockImplementation(() => {
      bodyInjury.update(1 / 60);
      applyBodyTrauma(bodyInjury, fighter("two").trauma, "full");
    });
    run(30);
    expect(bodyInjury.impactDepth).toBeGreaterThan(5);
    expect(bodyInjury.level("leftRibs").blood).toBeCloseTo(1.4, 6);
    expect(bodyInjury.level("rightRibs").blood).toBe(0);
  });
});

describe("blood on the canvas", () => {
  const cut = { ...fighter("two").trauma, bleeding: 200, left_cut: 60 };
  const pools = (renderer: Record<string, unknown>): number[][] => (renderer.effects as { pool: ReturnType<typeof vi.fn> }).pool.mock.calls as number[][];
  const drips = (renderer: Record<string, unknown>): unknown[][] => (renderer.effects as { drip: ReturnType<typeof vi.fn> }).drip.mock.calls.filter((call) => call[3] === 1);

  it("pools under a flash knockout's loser, whom the engine never puts down, instead of raining on his old spot", () => {
    const result = { match_id: "m", activity_instance_id: "a", guild_id: "g", player_one_id: "one", player_two_id: "two", winner_id: "one", finish_method: "flash_ko" as const, round_number: 1, tick: 40, scorecards: [], player_one_knockdowns: 0, player_two_knockdowns: 0, player_one_damage: 0, player_two_damage: 500 };
    const { renderer, run, graphs } = frame(fighting({}, { trauma: cut }, { phase: "complete", result }), { flashKnockout: { hitEventId: 3, loserId: "two" } });
    graphs[1]!.isDown = true;
    // The finish plays in slow motion for its first seconds.
    run(300);
    expect(drips(renderer)).toHaveLength(0);
    expect(pools(renderer).length).toBeGreaterThan(0);
  });

  it("drips from under the chin of the head as it is drawn: seated on his stool, not at standing height over his spot", () => {
    const root = new THREE.Object3D();
    const head = new THREE.Bone();
    root.add(head);
    // Seated in his corner, his head forward of his place and 40 cm below a standing man's.
    head.position.set(0.25, 1.12, 0.3);
    head.rotation.y = 0.6;
    const { renderer, run, graphs } = frame(fighting({}, { trauma: cut }, { phase: "rest", phase_ticks_remaining: 600 }), {
      tmpHeadQuaternion: new THREE.Quaternion(), tmpStumpOffset: new THREE.Vector3(),
    });
    Object.assign(graphs[1]!.boxer, { root, bone: (name: string) => (name === "head" ? head : null) });
    run(2);
    const [at] = drips(renderer).at(-1)! as [THREE.Vector3];
    root.updateMatrixWorld(true);
    const skull = new THREE.Vector3(0, 0.12, 0.02).applyQuaternion(head.quaternion).add(head.getWorldPosition(new THREE.Vector3()));
    const chin = skull.add(new THREE.Vector3(0, -0.1, 0.08).applyQuaternion(head.quaternion));
    expect(at.distanceTo(chin)).toBeLessThan(1e-6);
  });

  it("pools from a finisher's open wound however little the engine says he was cut, and further than any cut", () => {
    const { renderer, run, graphs } = frame(fighting({}, { is_downed: true }, { phase: "knockdown" }), { arcadeInjuries: [null, "decapitation"] });
    graphs[1]!.isDown = true;
    Object.assign(renderer, { headCacheValid: [false, true], headCache: [new THREE.Vector3(), new THREE.Vector3(0.6, 0.15, -0.2)] });
    // Ten seconds on the canvas with no cuts in the engine at all.
    run(600);
    const calls = pools(renderer);
    expect(calls.length).toBeGreaterThan(50);
    const widest = Math.max(...calls.map((call) => call[2]!));
    expect(widest).toBeGreaterThan(0.55);
    expect(widest).toBeLessThanOrEqual(0.8);
    for (const [x, z] of calls) expect(Math.hypot(x! - 0.6, z! + 0.2)).toBeLessThan(0.25);
  });

  it("leaves a dislocation, which opens no wound, to the engine's cuts", () => {
    const { renderer, run, graphs } = frame(fighting({}, { is_downed: true }, { phase: "knockdown" }), { arcadeInjuries: [null, "jaw_dislocation"] });
    graphs[1]!.isDown = true;
    run(120);
    expect(pools(renderer)).toHaveLength(0);
  });

  it("lays a flash knockout's loser's shadow out flat with him", () => {
    const blobs = [new THREE.Mesh(), new THREE.Mesh(), new THREE.Mesh()];
    const stub = Object.assign(Object.create(FightRenderer.prototype) as Record<string, unknown>, {
      blobShadows: blobs, tmpA: new THREE.Vector3(-0.5, 0, 0), tmpB: new THREE.Vector3(0.5, 0, 0), refereePosition: new THREE.Vector3(0, 0, -2), bodyPoint: new THREE.Vector3(),
      graphs: [{ fallBody: null, isDown: false, boxer: { root: { visible: false } } }, { fallBody: null, isDown: true, boxer: { root: { visible: false } } }],
      buffer: { latest: () => snapshot() }, flashKnockout: { hitEventId: 3, loserId: "two" },
    });
    (FightRenderer.prototype as unknown as { updateBlobShadows(this: unknown): void }).updateBlobShadows.call(stub);
    expect(blobs[1]!.scale.x).toBeCloseTo(2.1, 6);
    expect(blobs[0]!.scale.x).toBeCloseTo(1.25, 6);
    // The engine's word alone, as before: the loser of a flash knockout, never put down by it.
    stub.graphs = [{ fallBody: null, isDown: false, boxer: { root: { visible: false } } }, { fallBody: null, isDown: false, boxer: { root: { visible: false } } }];
    (FightRenderer.prototype as unknown as { updateBlobShadows(this: unknown): void }).updateBlobShadows.call(stub);
    expect(blobs[1]!.scale.x).toBeCloseTo(2.1, 6);
  });
});

describe("the stands in a rendered frame", () => {
  it("make room for the broadcast camera only while it stands on its platform", () => {
    const placed = (camera: Settings["camera"], portraitPull = 1): boolean => {
      const { renderer, settings, camera: lens, run } = frame(fighting(), { portraitPull });
      settings.camera = camera;
      run(30);
      const call = (renderer.arena as { makeRoomForCamera: ReturnType<typeof vi.fn> }).makeRoomForCamera.mock.calls.at(-1)![0] as THREE.Vector3;
      // Asked once the frame's camera is in place, with where it stands.
      expect(call.x).toBe(lens.position.x);
      expect(call.z).toBe(lens.position.z);
      return cameraOnPlatform(call.x, call.z);
    };
    // The broadcast camera on a tall phone stands among the first rows; over the player's shoulder it is inside the ring.
    expect(placed("broadcast", 2.2)).toBe(true);
    expect(placed("fighter")).toBe(false);
  });
});
