import * as THREE from "three";
import { fighter, snapshot } from "../test/fixtures";
import type { EngineSnapshot, FighterSnapshot } from "../types";
import { CameraDirector, FighterCam } from "./camera";
import { cameraOnPlatform } from "./crowd";
import { RoundStatsTracker } from "./hud";
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
