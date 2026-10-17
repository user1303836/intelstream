import * as THREE from "three";
import { fighter, snapshot } from "../test/fixtures";
import type { EngineSnapshot, FighterSnapshot } from "../types";
import { CameraDirector, FighterCam } from "./camera";
import { cameraOnPlatform } from "./crowd";
import { RoundStatsTracker } from "./hud";
import { BODY_SITES, BODY_SWELL_CORE, HEAD_SITES, InjuryShading, applyBodyTrauma } from "./injury";
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
    boxer: {
      root: new THREE.Object3D(), bone: () => null, setLook: vi.fn(), metrics: { headRestY: 1.52 },
      rig: { bones: { gloveL: new THREE.Object3D(), gloveR: new THREE.Object3D(), hips: new THREE.Object3D(), upperChest: new THREE.Object3D(), shoulderL: new THREE.Object3D(), shoulderR: new THREE.Object3D() } },
      headInjury: new InjuryShading(null, HEAD_SITES), bodyInjury: new InjuryShading(null, BODY_SITES, { core: BODY_SWELL_CORE, wash: true }),
    },
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
    tmpStump: new THREE.Vector3(),
    tmpStumpOffset: new THREE.Vector3(),
    tmpStumpAcross: new THREE.Vector3(),
    woundPoint: new THREE.Vector3(),
    woundAxis: new THREE.Vector3(),
    downedPoolAccumulators: [0, 0],
    downedPoolCounts: [0, 0],
    effects: { drip: vi.fn(), stopDrip: vi.fn(), pool: vi.fn(), update: vi.fn(), shakeAmount: 0, setViewDistance: vi.fn(), gushing: () => false },
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
    history: [],
    drawnOffsets: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
    drawnTargets: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
    liveFallTicks: [null, null],
    fallingLive: [false, false],
    stoppageSpot: null,
    raiseCentre: new THREE.Vector3(),
    raiseFramed: false,
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

describe("blood from the punch that lands", () => {
  const fire = (detail: string, overrides: Record<string, unknown>) => {
    const event = { event_id: 9, tick: 40, kind: "hit", actor_id: "one", target_id: "two", amount: 80, detail, blood: 30, direction: 1, action_id: null };
    const engine = { ...snapshot(), fighters: [fighter("one", -60), fighter("two", 60)] as [FighterSnapshot, FighterSnapshot] };
    const addEvent = vi.fn();
    const stub = Object.assign(Object.create(FightRenderer.prototype) as Record<string, unknown>, {
      pendingContacts: [{ event, presentationEvent: event, presentImpact: true, reactAmount: null, contactTick: 40, recipientIndex: 1, puncherIndex: 0, injury: null }],
      buffer: { latest: () => engine }, presentFightEvent: vi.fn(), mapping: worldMapping(SIMULATION), contactPoint: new THREE.Vector3(), mouthPoint: new THREE.Vector3(),
      effects: { addEvent, spawnTeeth: vi.fn() }, settings: () => ({ reducedMotion: false, blood: "full" }), arena: { excite: vi.fn() }, viewerId: null,
      arcadeInjuries: [null, null], headWorldPose: () => null, knockOutMouthpiece: vi.fn(), onContact: null, viewerHitFlash: 0,
      ...overrides,
    });
    (FightRenderer.prototype as unknown as { fireContacts(this: unknown, tick: number): void }).fireContacts.call(stub, 50);
    return (addEvent.mock.calls[0]! as [unknown, THREE.Vector3])[1].clone();
  };

  it("leaves the face where it is drawn, on the side that faced the punch, ducked low or lying on the canvas", () => {
    // Fighter one at -x punches fighter two at +x; two's skull is drawn low and off his spot, slipping the punch.
    const at = fire("straight:head", { graphs: [{ currentRoot: { x: -0.4, z: 0 }, landedHit: vi.fn() }, { currentRoot: { x: 0.4, z: 0 }, react: vi.fn() }], headWorldPose: (index: number) => (index === 1 ? { position: new THREE.Vector3(0.55, 1.22, 0.18), quaternion: new THREE.Quaternion() } : null) });
    expect(at.x).toBeCloseTo(0.47, 6);
    expect(at.y).toBeCloseTo(1.22, 6);
    expect(at.z).toBeCloseTo(0.18, 6);
  });

  it("leaves the chest where it is drawn for a body shot", () => {
    const chest = new THREE.Object3D();
    chest.position.set(0.5, 1.1, -0.1);
    chest.updateMatrixWorld(true);
    const at = fire("hook:body", { graphs: [{ currentRoot: { x: -0.4, z: 0 }, landedHit: vi.fn() }, { currentRoot: { x: 0.4, z: 0 }, react: vi.fn(), boxer: { rig: { bones: { upperChest: chest } } } }] });
    expect(at.x).toBeCloseTo(0.38, 6);
    expect(at.y).toBeCloseTo(1.1, 6);
    expect(at.z).toBeCloseTo(-0.1, 6);
  });
});

describe("a fighter torn open by the knockout punch", () => {
  const punch = { event_id: 31, tick: 40, kind: "hit", actor_id: "one", target_id: "two", amount: 72, detail: "straight:body", blood: 20, direction: 1, action_id: null };
  /** Fighter two's body standing at (0.6, 0) facing +z, his own left toward +x; `lying` lays him on his back. */
  const torso = (lying: boolean) => {
    const root = new THREE.Object3D();
    const place = (x: number, up: number): THREE.Object3D => {
      const bone = new THREE.Object3D();
      bone.position.set(0.6 + x, lying ? 0.18 : up, lying ? -up : 0);
      root.add(bone);
      return bone;
    };
    return { root, rig: { bones: { hips: place(0, 0.95), upperChest: place(0, 1.3), shoulderL: place(0.18, 1.42), shoulderR: place(-0.18, 1.42) } } };
  };
  const apply = (injury: string, lying = false, head: { position: THREE.Vector3; quaternion: THREE.Quaternion } | null = null) => {
    const tearOpen = vi.fn();
    const onArcadeInjury = vi.fn();
    const stub = Object.assign(Object.create(FightRenderer.prototype) as Record<string, unknown>, {
      graphs: [{ currentRoot: { x: -0.6, z: 0 } }, { currentRoot: { x: 0.62, z: 0.1 }, boxer: torso(lying) }],
      buffer: { latest: () => snapshot() }, mapping: worldMapping(SIMULATION), contactPoint: new THREE.Vector3(), tmpPart: new THREE.Vector3(),
      tmpStump: new THREE.Vector3(), tmpStumpOffset: new THREE.Vector3(), tmpStumpAcross: new THREE.Vector3(), woundPoint: new THREE.Vector3(), woundAxis: new THREE.Vector3(),
      headWorldPose: () => head, effects: { tearOpen }, arcadeInjuries: [null, null], arcadeInjuryEvents: [null, null], observedInjuryDown: [false, false],
      syncInjuryPresentation: vi.fn(), onArcadeInjury,
    });
    const applied = (FightRenderer.prototype as unknown as { applyArcadeInjury(this: unknown, index: number, injury: string, event: unknown, spray?: unknown): boolean }).applyArcadeInjury.call(stub, 1, injury, punch, { x: 1, z: 0 });
    const [index, at, axis, spray, eventId, teeth] = (tearOpen.mock.calls[0] ?? []) as [number, THREE.Vector3, THREE.Vector3, unknown, number, number | undefined];
    return { applied, tearOpen, onArcadeInjury, stub, index, at: at?.clone(), axis: axis?.clone(), spray, eventId, teeth };
  };

  it("bursts the ribs open at his side as the punch lands, standing or lying, and keeps them so for the rest of the bout", () => {
    const standing = apply("ribs_left");
    expect(standing.applied).toBe(true);
    expect((standing.stub.arcadeInjuries as unknown[])[1]).toBe("ribs_left");
    expect(standing.onArcadeInjury).toHaveBeenCalledWith("ribs_left", punch);
    // Out of his left side, a little below the chest bone, along the punch.
    expect([standing.index, standing.eventId, standing.teeth ?? 0]).toEqual([1, 31, 0]);
    expect(standing.at!.x).toBeCloseTo(0.73, 6);
    expect(standing.at!.y).toBeCloseTo(1.24, 6);
    expect(standing.axis!.x).toBeCloseTo(1, 6);
    expect(standing.spray).toEqual({ x: 1, z: 0 });
    const right = apply("ribs_right");
    expect(right.at!.x).toBeCloseTo(0.47, 6);
    expect(right.axis!.x).toBeCloseTo(-1, 6);
    // On his back on the canvas the wound is down there with him, where it once threw blood from standing height.
    const lying = apply("ribs_left", true);
    expect(lying.applied).toBe(true);
    expect(lying.at!.y).toBeCloseTo(0.18, 6);
  });

  it("tears a shoulder open at the joint, facing out and up, and breaks the jaw open at the mouth with its teeth", () => {
    const shoulder = apply("shoulder_right");
    expect(shoulder.applied).toBe(true);
    expect([shoulder.at!.x, shoulder.at!.y, shoulder.at!.z]).toEqual([0.42, 1.42, 0]);
    expect(shoulder.axis!.x).toBeLessThan(-0.8);
    expect(shoulder.axis!.y).toBeGreaterThan(0.3);
    const head = { position: new THREE.Vector3(0.6, 1.55, 0), quaternion: new THREE.Quaternion() };
    const jaw = apply("jaw_dislocation", false, head);
    expect(jaw.applied).toBe(true);
    expect(jaw.at!.distanceTo(new THREE.Vector3(0.6, 1.48, 0.1))).toBeLessThan(1e-6);
    expect(jaw.axis!.z).toBeGreaterThan(0.9);
    expect(jaw.teeth).toBe(8);
    // Without the head to tear open there is nothing to record.
    expect(apply("jaw_dislocation", false, null).applied).toBe(false);
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

  it("keeps the blood pouring from his mouth there as his head moves", () => {
    const root = new THREE.Object3D();
    const head = new THREE.Bone();
    root.add(head);
    head.position.set(0.4, 0.3, -0.2);
    head.rotation.x = -1.2;
    const anchorGush = vi.fn();
    const { run, graphs } = frame(fighting({}, { is_downed: true }, { phase: "knockdown" }), {
      tmpHeadQuaternion: new THREE.Quaternion(), tmpStumpOffset: new THREE.Vector3(), tmpPart: new THREE.Vector3(), mouthPoint: new THREE.Vector3(),
      effects: { drip: vi.fn(), stopDrip: vi.fn(), pool: vi.fn(), update: vi.fn(), shakeAmount: 0, setViewDistance: vi.fn(), gushing: (index: number) => index === 1, anchorGush },
    });
    Object.assign(graphs[1]!.boxer, { root, bone: (name: string) => (name === "head" ? head : null) });
    run(2);
    const [index, at] = anchorGush.mock.calls.at(-1)! as [number, THREE.Vector3];
    expect(index).toBe(1);
    root.updateMatrixWorld(true);
    const skull = new THREE.Vector3(0, 0.12, 0.02).applyQuaternion(head.quaternion).add(head.getWorldPosition(new THREE.Vector3()));
    expect(at.distanceTo(skull.add(new THREE.Vector3(0, -0.07, 0.1).applyQuaternion(head.quaternion)))).toBeLessThan(1e-6);
    expect(anchorGush.mock.calls.every((call) => call[0] === 1)).toBe(true);
  });

  it("keeps a torn shoulder pouring from the shoulder, not from his mouth", () => {
    const anchorGush = vi.fn();
    const { run, graphs } = frame(fighting({}, { is_downed: true }, { phase: "knockdown" }), {
      arcadeInjuries: [null, "shoulder_right"],
      effects: { drip: vi.fn(), stopDrip: vi.fn(), pool: vi.fn(), update: vi.fn(), shakeAmount: 0, setViewDistance: vi.fn(), gushing: (index: number) => index === 1, anchorGush },
    });
    graphs[1]!.boxer.rig.bones.shoulderR.position.set(-0.7, 0.25, 0.3);
    run(2);
    const [index, at] = anchorGush.mock.calls.at(-1)! as [number, THREE.Vector3];
    expect(index).toBe(1);
    expect(at.toArray()).toEqual([-0.7, 0.25, 0.3]);
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
    expect(widest).toBeGreaterThan(0.9);
    expect(widest).toBeLessThanOrEqual(1.3);
    for (const [x, z] of calls) expect(Math.hypot(x! - 0.6, z! + 0.2)).toBeLessThan(0.35);
  });

  it("pools from a broken jaw as from any finisher's wound, and from a torn shoulder at the shoulder", () => {
    const jaw = frame(fighting({}, { is_downed: true }, { phase: "knockdown" }), { arcadeInjuries: [null, "jaw_dislocation"] });
    jaw.graphs[1]!.isDown = true;
    jaw.run(120);
    expect(pools(jaw.renderer).length).toBeGreaterThan(10);
    // The broken jaw runs with blood down the chin, the neck and the chest over the engine's own trauma.
    expect((jaw.graphs[1]!.boxer.headInjury as InjuryShading).level("mouth").blood).toBeCloseTo(1.4, 6);
    expect((jaw.graphs[1]!.boxer.bodyInjury as InjuryShading).level("neckSmear").blood).toBeCloseTo(1.4, 6);
    const shoulder = frame(fighting({}, { is_downed: true }, { phase: "knockdown" }), { arcadeInjuries: [null, "shoulder_left"] });
    shoulder.graphs[1]!.isDown = true;
    shoulder.graphs[1]!.boxer.rig.bones.shoulderL.position.set(1.1, 0.2, -0.4);
    shoulder.run(120);
    const calls = pools(shoulder.renderer);
    expect(calls.length).toBeGreaterThan(10);
    for (const [x, z] of calls) expect(Math.hypot(x! - 1.1, z! + 0.4)).toBeLessThan(0.35);
    expect((shoulder.graphs[1]!.boxer.bodyInjury as InjuryShading).level("leftShoulderSmear").blood).toBeCloseTo(1.4, 6);
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
