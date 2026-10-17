import * as THREE from "three";
import { fighter, referee as engineReferee, snapshot } from "../test/fixtures";
import type { CombatEvent, EngineSnapshot } from "../types";
import { CommentaryDirector } from "./commentary";
import { Effects3D, REFEREE_GUSH } from "./effects";
import { BoxingGraph, SkinnedBoxer, loadBoxerGlb } from "./graph";
import { OFFICIAL_LOOKS } from "./looks";
import { BLUE_CORNER_OUTFIT, REFEREE_OUTFIT } from "./outfit";
import { RoundClock } from "./hud";
import { FightRenderer, REFEREE_ID, REFEREE_REPLAY_DELAY_SECONDS, punchGush } from "./renderer";
import { SnapshotBuffer } from "../interpolation";
import { planKnockoutReplay, REFEREE_REPLAY } from "./replay";
import { worldPosition } from "./rig";
import { worldMapping } from "./world";

const mapping = worldMapping({ tick_rate: 30, ring_half_width: 500, ring_half_height: 500 });
const gltf = await loadBoxerGlb();
const referee = (): SkinnedBoxer => new SkinnedBoxer(gltf, { skin: 0xc79b76, gear: 0x3b57b8, look: OFFICIAL_LOOKS.referee, outfit: REFEREE_OUTFIT, wounds: true });
const event = (kind: string, tick: number, extra: Partial<CombatEvent> = {}): CombatEvent => ({ event_id: tick, tick, kind, actor_id: "one", target_id: REFEREE_ID, amount: 80, detail: "hook:head", blood: 30, direction: 1, action_id: `one@${tick - 8}`, ...extra });

describe("a referee who can be punched", () => {
  it("shades his injuries like a fighter, while the corner's officials still never take a mark", () => {
    const official = referee();
    const head = official.headMesh.material as THREE.MeshStandardMaterial;
    expect(head.customProgramCacheKey()).toContain("hands-injury");
    // Still an official: matte cloth and skin, and no shadow.
    expect(head).not.toBeInstanceOf(THREE.MeshPhysicalMaterial);
    const corner = new SkinnedBoxer(gltf, { skin: 0x8a5a3b, gear: 0x1b2230, look: OFFICIAL_LOOKS.blueCorner, outfit: BLUE_CORNER_OUTFIT });
    expect((corner.headMesh.material as THREE.MeshStandardMaterial).customProgramCacheKey()).not.toContain("hands-injury");
  });

  it("snaps away from a punch on top of his own posture", () => {
    const hit = referee();
    const still = referee();
    const graphs = [new BoxingGraph(hit, mapping, { referee: true, knockout: true }), new BoxingGraph(still, mapping, { referee: true, knockout: true })];
    const self = { ...fighter("referee"), x: 0, y: 160, facing_x: 0, facing_y: -1000 };
    const focus = { ...fighter("focus"), x: 0, y: -140 };
    const step = (frames: number, from: number): void => {
      for (let frame = 0; frame < frames; frame += 1) for (const graph of graphs) graph.update(self, focus, 1 / 60, (from + frame) / 60, false, "full", (from + frame) / 2);
    };
    step(30, 0);
    graphs[0]!.react("hit", "head", 1, "hook", "left", 120);
    step(8, 30);
    for (const boxer of [hit, still]) boxer.root.updateMatrixWorld(true);
    const moved = worldPosition(hit.rig.bones.head, new THREE.Vector3()).distanceTo(worldPosition(still.rig.bones.head, new THREE.Vector3()));
    expect(moved).toBeGreaterThan(0.04);
  });

  it("goes down for good when knocked out, which the corner's officials never are", () => {
    const official = referee();
    const graph = new BoxingGraph(official, mapping, { referee: true, knockout: true });
    const self = { ...fighter("referee"), x: 0, y: 160, facing_x: 0, facing_y: -1000 };
    const focus = { ...fighter("focus"), x: 0, y: -140 };
    graph.update(self, focus, 1 / 60, 0, false, "full", 0);
    graph.react("hit", "head", 1, "uppercut", "right", 150);
    graph.knockOut();
    for (let frame = 1; frame < 600; frame += 1) graph.update(self, focus, 1 / 60, frame / 60, false, "full", frame / 2);
    // Ten seconds on, he has not got up.
    expect(graph.isDown).toBe(true);
    official.root.updateMatrixWorld(true);
    expect(worldPosition(official.rig.bones.head, new THREE.Vector3()).y).toBeLessThan(0.5);
    const corner = new BoxingGraph(new SkinnedBoxer(gltf, { skin: 0x8a5a3b, gear: 0x1b2230, look: OFFICIAL_LOOKS.blueCorner, outfit: BLUE_CORNER_OUTFIT }), mapping, { referee: true });
    expect(corner.fallBody).toBeNull();
  });
});

describe("the renderer's referee", () => {
  type Stub = Record<string, unknown> & { refereePosition: THREE.Vector3 };
  const updateReferee = (FightRenderer.prototype as unknown as { updateReferee: (dt: number, time: number, snapshot: EngineSnapshot | null, tick: number) => void }).updateReferee;
  const placement = (): Stub => {
    const graph = new BoxingGraph(referee(), mapping, { referee: true, knockout: true });
    return Object.assign(Object.create(FightRenderer.prototype) as Record<string, unknown>, {
      referee: graph, mapping, tmpA: new THREE.Vector3(-0.6, 0, 0), tmpB: new THREE.Vector3(0.6, 0, 0),
      refereePosition: new THREE.Vector3(0, 0, -2), refereeAway: new THREE.Vector3(), refereeVelocity: new THREE.Vector3(), refereeYaw: 0,
      replay: null, ceremony: null, stoppageWinner: -1, stoppageRaiseAt: Number.POSITIVE_INFINITY, frameSeconds: 0, blobShadows: [], graphs: null,
      effects: { severedHeadPosition: () => false, gushing: () => false, pool: vi.fn() }, closeUpTarget: new THREE.Vector3(), bodyPoint: new THREE.Vector3(), pendingRefereeEvents: [], settings: () => ({ reducedMotion: false, blood: "full" }),
      refereeHead: new THREE.Vector3(), refereePoolAccumulator: 0, refereePoolCount: 0,
    });
  };
  const at = (state: EngineSnapshot, stub: Stub, frames: number): void => {
    for (let frame = 0; frame < frames; frame += 1) updateReferee.call(stub, 1 / 60, frame / 60, state, state.tick);
  };

  it("stands where the engine has him while punches can land, so they land on him where he is drawn", () => {
    const stub = placement();
    at({ ...snapshot(40), referee: engineReferee(30, 62) }, stub, 30);
    expect(stub.refereePosition.x).toBeCloseTo(mapping.x(30), 2);
    expect(stub.refereePosition.z).toBeCloseTo(mapping.z(62), 2);
  });

  it("goes where the picture needs him over a count, and stays where he fell once down", () => {
    const counting = placement();
    at({ ...snapshot(40), phase: "knockdown", fighters: [fighter("one", -100), { ...fighter("two", 100), is_downed: true }], referee: engineReferee(-300, -300) }, counting, 30);
    expect(Math.hypot(counting.refereePosition.x - mapping.x(-300), counting.refereePosition.z - mapping.z(-300))).toBeGreaterThan(0.5);

    const fallen = placement();
    at({ ...snapshot(40), referee: engineReferee(30, 62) }, fallen, 30);
    const where = fallen.refereePosition.clone();
    at({ ...snapshot(80), phase: "referee_down", referee: { ...engineReferee(200, 200), alive: false } }, fallen, 60);
    at({ ...snapshot(120), referee: { ...engineReferee(-200, 100), alive: false } }, fallen, 60);
    expect(fallen.refereePosition.distanceTo(where)).toBeLessThan(1e-9);
  });

  it("keeps his pouring mouth on him as he moves, and leaves it alone when nothing pours", () => {
    const stub = placement();
    const anchorGush = vi.fn();
    stub.effects = { severedHeadPosition: () => false, gushing: (index: number) => index === REFEREE_GUSH, anchorGush, pool: vi.fn() };
    Object.assign(stub, { tmpHead: new THREE.Vector3(), tmpHeadQuaternion: new THREE.Quaternion(), tmpStumpOffset: new THREE.Vector3(), woundPoint: new THREE.Vector3(), woundAxis: new THREE.Vector3() });
    at({ ...snapshot(40), referee: engineReferee(30, 62) }, stub, 30);
    expect(anchorGush).toHaveBeenCalledTimes(30);
    const [index, position] = anchorGush.mock.calls.at(-1)! as [number, THREE.Vector3];
    expect(index).toBe(REFEREE_GUSH);
    const head = (stub.referee as BoxingGraph).boxer.rig.bones.head.getWorldPosition(new THREE.Vector3());
    expect(position.distanceTo(head)).toBeLessThan(0.3);
    stub.effects = { ...(stub.effects as object), gushing: () => false };
    anchorGush.mockClear();
    at({ ...snapshot(40), referee: engineReferee(30, 62) }, stub, 5);
    expect(anchorGush).not.toHaveBeenCalled();
  });

  it("bleeds out dead into a pool under his head, which spreads as wide as an open wound's and stops, and starts afresh in a new bout", () => {
    const stub = placement();
    const pool = (stub.effects as { pool: ReturnType<typeof vi.fn> }).pool;
    at({ ...snapshot(40), referee: engineReferee(30, 62) }, stub, 30);
    expect(pool).not.toHaveBeenCalled();
    const dead = { ...snapshot(80), referee: { ...engineReferee(30, 62), alive: false } };
    at(dead, stub, 60 * 30);
    const radii = pool.mock.calls.map((call) => call[2] as number);
    expect(radii.length).toBeGreaterThan(100);
    for (let index = 1; index < radii.length; index += 1) expect(radii[index]!).toBeGreaterThanOrEqual(radii[index - 1]!);
    expect(radii.at(-1)!).toBeGreaterThan(1.5);
    const head = (stub.referee as BoxingGraph).boxer.rig.bones.head.getWorldPosition(new THREE.Vector3());
    const last = pool.mock.calls.at(-1)! as number[];
    expect(Math.hypot(last[0]! - head.x, last[1]! - head.z)).toBeLessThan(0.6);
    // As wide as it goes, it stops spilling.
    const spilled = pool.mock.calls.length;
    at(dead, stub, 60 * 10);
    expect(pool.mock.calls.length).toBe(spilled);
    // On his feet in a new bout and dead again: a new pool from nothing.
    at({ ...snapshot(200), referee: engineReferee(30, 62) }, stub, 5);
    pool.mockClear();
    at({ ...snapshot(260), referee: { ...engineReferee(30, 62), alive: false } }, stub, 60);
    expect(pool.mock.calls[0]![2] as number).toBeLessThan(radii.at(-1)! / 4);

    // Not with blood off, nor while his death is replayed.
    for (const change of [{ settings: () => ({ reducedMotion: false, blood: "off" }) }, { replay: { plan: { impact: { kind: "referee_down" } } } }]) {
      const quiet = Object.assign(placement(), change);
      at(dead, quiet, 120);
      expect((quiet.effects as { pool: ReturnType<typeof vi.fn> }).pool).not.toHaveBeenCalled();
    }
  });

  const moments = (): { renderer: Record<string, unknown>; react: ReturnType<typeof vi.fn>; knockOut: ReturnType<typeof vi.fn>; addEvent: ReturnType<typeof vi.fn>; gush: ReturnType<typeof vi.fn>; onContact: ReturnType<typeof vi.fn>; landedHit: ReturnType<typeof vi.fn> } => {
    const react = vi.fn();
    const gush = vi.fn();
    const knockOut = vi.fn();
    const addEvent = vi.fn();
    const onContact = vi.fn();
    const landedHit = vi.fn();
    const head = new THREE.Object3D();
    head.position.set(0.1, 1.6, -0.4);
    const live = { ...snapshot(60), referee: engineReferee(0, 62) };
    const renderer = Object.assign(Object.create(FightRenderer.prototype) as Record<string, unknown>, {
      pendingRefereeEvents: [] as CombatEvent[], refereeReplayAt: null, eventCallout: null, frameSeconds: 10, history: [] as EngineSnapshot[],
      buffer: { latest: () => live }, referee: { react, knockOut, boxer: { rig: { bones: { head } } } }, effects: { addEvent, gush },
      settings: () => ({ reducedMotion: false, blood: "full" }), mapping, graphs: [{ landedHit }, { landedHit: vi.fn() }], onContact, refereeHead: new THREE.Vector3(),
      tmpHead: new THREE.Vector3(), tmpHeadQuaternion: new THREE.Quaternion(), tmpStumpOffset: new THREE.Vector3(), woundPoint: new THREE.Vector3(), woundAxis: new THREE.Vector3(),
    });
    return { renderer, react, knockOut, addEvent, gush, onContact, landedHit };
  };
  const fire = (renderer: Record<string, unknown>, tick: number): void => (FightRenderer.prototype as unknown as { fireRefereeEvents: (tick: number) => void }).fireRefereeEvents.call(renderer, tick);

  it("shows a punch on him when the render clock reaches it: he reels, he bleeds and the puncher feels it land", () => {
    const { renderer, react, addEvent, onContact, landedHit } = moments();
    const hit = event("referee_hit", 40);
    (renderer.pendingRefereeEvents as CombatEvent[]).push(hit);
    fire(renderer, 39.5);
    expect(react).not.toHaveBeenCalled();
    fire(renderer, 40);
    expect(react).toHaveBeenCalledWith("hit", "head", 1, "hook", null, 80);
    expect(addEvent).toHaveBeenCalledTimes(1);
    expect(addEvent.mock.calls[0]![0]).toMatchObject({ kind: "hit", blood: 30 });
    // The blood comes off his head.
    expect((addEvent.mock.calls[0]![1] as THREE.Vector3).y).toBeCloseTo(1.6);
    expect(landedHit).toHaveBeenCalledWith(hit.action_id, false, false);
    expect(onContact).toHaveBeenCalledWith(hit, false);
    expect(renderer.pendingRefereeEvents).toEqual([]);
  });

  it("lands a power punch on him as one, held longest and heard as one", () => {
    const { renderer, landedHit, onContact } = moments();
    const hit = event("referee_hit", 40);
    // The snapshot the punch arrived in has the puncher throwing it as a power punch.
    renderer.history = [{ ...snapshot(40), fighters: [{ ...fighter("one"), action_id: hit.action_id, action_power: "power" }, fighter("two")] }];
    (renderer.pendingRefereeEvents as CombatEvent[]).push(hit);
    fire(renderer, 40);
    expect(landedHit).toHaveBeenCalledWith(hit.action_id, false, true);
    expect(onContact).toHaveBeenCalledWith(hit, true);
  });

  it("knocks him out cold on his fall, says so, and replays it once it has played live", () => {
    const { renderer, knockOut, addEvent, onContact } = moments();
    const down = event("referee_down", 50, { amount: 0, blood: 0, detail: "" });
    (renderer.pendingRefereeEvents as CombatEvent[]).push(down);
    fire(renderer, 50);
    expect(knockOut).toHaveBeenCalledTimes(1);
    // Heard as it is shown, not as its snapshot arrives.
    expect(onContact).toHaveBeenCalledWith(down, false);
    expect(addEvent.mock.calls[0]![0]).toMatchObject({ kind: "knockdown" });
    expect(renderer.eventCallout).toMatchObject({ text: "THE REFEREE IS DEAD!" });
    expect(renderer.refereeReplayAt).toMatchObject({ impact: down });
    expect((renderer.refereeReplayAt as { at: number }).at).toBeGreaterThan(10);
  });

  it("spurts from his face when a solid punch lands on him, as a fighter's does, but not from a light one or with reduced motion", () => {
    const solid = moments();
    (solid.renderer.pendingRefereeEvents as CombatEvent[]).push(event("referee_hit", 40, { amount: 90 }));
    fire(solid.renderer, 40);
    const expected = punchGush({ kind: "hit", amount: 90, blood: 30, detail: "hook:head" })!;
    expect(solid.gush).toHaveBeenCalledWith(REFEREE_GUSH, expect.any(THREE.Vector3), expect.any(THREE.Vector3), expected.seconds, expected.rate, 40);
    // From his mouth, at his head.
    expect((solid.gush.mock.calls[0]![1] as THREE.Vector3).distanceTo(new THREE.Vector3(0.1, 1.6, -0.4))).toBeLessThan(0.3);

    const light = moments();
    (light.renderer.pendingRefereeEvents as CombatEvent[]).push(event("referee_hit", 40, { amount: 20 }));
    fire(light.renderer, 40);
    expect(light.gush).not.toHaveBeenCalled();

    const calm = moments();
    calm.renderer.settings = () => ({ reducedMotion: true, blood: "full" });
    (calm.renderer.pendingRefereeEvents as CombatEvent[]).push(event("referee_hit", 40, { amount: 90 }));
    fire(calm.renderer, 40);
    expect(calm.gush).not.toHaveBeenCalled();
  });

  it("pours blood from his mouth as he dies, longer than any spurt, and pours it again when his death is replayed", () => {
    const { renderer, gush } = moments();
    const down = event("referee_down", 50, { amount: 0, blood: 0, detail: "" });
    (renderer.pendingRefereeEvents as CombatEvent[]).push(down);
    fire(renderer, 50);
    expect(gush).toHaveBeenCalledWith(REFEREE_GUSH, expect.any(THREE.Vector3), expect.any(THREE.Vector3), expect.any(Number), expect.any(Number), 50);
    expect(gush.mock.calls[0]![3] as number).toBeGreaterThan(punchGush({ kind: "hit", amount: 200, blood: 50, detail: "hook:head" })!.seconds);

    // The replay stands him up with his live gush stopped, so its fall starts it again.
    const effects = new Effects3D(new THREE.Scene());
    effects.gush(REFEREE_GUSH, new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(0, -0.3, 1), 3, 300, 50);
    const replaying = Object.assign(Object.create(FightRenderer.prototype) as Record<string, unknown>, { simulation: { tick_rate: 30 }, frameSeconds: 0, commentary: { replay: vi.fn() }, referee: { resetTransient: vi.fn(), primeReplayFall: vi.fn() }, effects });
    (FightRenderer.prototype as unknown as { startReplay(this: unknown, plan: unknown): void }).startReplay.call(replaying, { snapshots: [snapshot(40)], impact: down, durationSeconds: 3 });
    expect(effects.gushing(REFEREE_GUSH)).toBe(false);
    // The physics runs his recorded fall again, so the replay leaves him where the live fall did.
    expect((replaying.referee as { primeReplayFall: ReturnType<typeof vi.fn> }).primeReplayFall).toHaveBeenCalledOnce();
    effects.gush(REFEREE_GUSH, new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(0, -0.3, 1), 3, 300, 50);
    expect(effects.gushing(REFEREE_GUSH)).toBe(true);
    effects.dispose();
  });

  it("keeps a gush of his own after the fighters', which clearing the ring stops", () => {
    for (const clear of ["clearDynamic", "clearArcadeGore"] as const) {
      const effects = new Effects3D(new THREE.Scene());
      effects.gush(REFEREE_GUSH, new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(0, -0.3, 1), 3, 300, 7);
      expect(effects.gushing(REFEREE_GUSH)).toBe(true);
      expect(effects.gushing(0) || effects.gushing(1)).toBe(false);
      effects.gush(REFEREE_GUSH + 1, new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(0, -0.3, 1), 3, 300, 8);
      expect(effects.gushing(REFEREE_GUSH + 1)).toBe(false);
      effects[clear]();
      expect(effects.gushing(REFEREE_GUSH)).toBe(false);
      effects.dispose();
    }
  });

  it("lands the punch that killed him again in his replay, as hard as a fall needs, and is heard again", () => {
    const { renderer, react, onContact } = moments();
    const blow = event("referee_hit", 50, { amount: 80, action_id: "one@42" });
    const down = event("referee_down", 50, { amount: 0, blood: 0, detail: "", action_id: "one@42" });
    renderer.history = [{ ...snapshot(50), events: [blow, down] }];
    (FightRenderer.prototype as unknown as { fireRefereeFall(this: unknown, event: CombatEvent, live: EngineSnapshot, replayed: boolean): void }).fireRefereeFall.call(renderer, down, { ...snapshot(50), referee: engineReferee(0, 62) }, true);
    expect(react).toHaveBeenCalledWith("hit", "head", 1, "hook", null, 140);
    expect(onContact).toHaveBeenCalledWith(blow, false);
    expect(onContact).toHaveBeenCalledWith(down, false);
  });

  it("neither waves off nor walks over to raise the winner's arm once he is dead, and the winner still celebrates", () => {
    const finish = (alive: boolean) => {
      const waveOff = vi.fn();
      const celebrate = vi.fn();
      const stub = Object.assign(Object.create(FightRenderer.prototype) as Record<string, unknown>, {
        buffer: { latest: () => ({ ...snapshot(400), phase: "complete", referee: { ...engineReferee(0, 62), alive } }) }, referee: { waveOff },
        headCacheValid: [false, false], settings: () => ({ reducedMotion: false }), frameSeconds: 10, graphs: [{ celebrate }, { celebrate: vi.fn() }],
        stoppageWinner: -1, stoppageRaiseAt: Number.POSITIVE_INFINITY,
      });
      (FightRenderer.prototype as unknown as { presentFinish(this: unknown, final: unknown): void }).presentFinish.call(stub, { version: 1, type: "final", match_id: "m", winner_id: "one", method: "ko", round: 2, scorecards: [], ratings: {} });
      return { waveOff, celebrate, raising: stub.stoppageWinner as number };
    };
    const living = finish(true);
    expect(living.waveOff).toHaveBeenCalledOnce();
    expect(living.raising).toBe(0);
    const dead = finish(false);
    expect(dead.waveOff).not.toHaveBeenCalled();
    expect(dead.raising).toBe(-1);
    expect(dead.celebrate).toHaveBeenCalledOnce();
  });

  it("drips his blood from his head while he bleeds", () => {
    const { renderer, addEvent, react } = moments();
    (renderer.pendingRefereeEvents as CombatEvent[]).push(event("bleed", 70, { actor_id: REFEREE_ID, target_id: null, detail: "", amount: 30, blood: 25 }));
    fire(renderer, 70);
    expect(react).not.toHaveBeenCalled();
    expect(addEvent.mock.calls[0]![0]).toMatchObject({ kind: "bleed" });
    expect((addEvent.mock.calls[0]![1] as THREE.Vector3).y).toBeCloseTo(1.6);
  });
});

describe("the commentary on the referee", () => {
  const players = { one: { id: "one", name: "Azure Vector", avatar: null, rating: 1500, connected: true }, two: { id: "two", name: "Crimson Geometry", avatar: null, rating: 1500, connected: true } };
  const said = (events: CombatEvent[]): string[] => {
    const director = new CommentaryDirector();
    director.observe(snapshot(events[0]!.tick), events, players, 30, 0);
    const lines: string[] = [];
    for (let at = 0; at < 6; at += 0.25) {
      const text = director.current(at)?.line.text;
      if (text !== undefined && !lines.includes(text)) lines.push(text);
    }
    return lines;
  };

  it("calls a punch on the referee, and calls his death above everything", () => {
    expect(said([event("referee_hit", 40)]).some((text) => /referee/u.test(text))).toBe(true);
    expect(said([event("referee_down", 40)])[0]).toMatch(/killed|dead|for good/u);
  });

  it("says the referee bled out when no punch put him down", () => {
    expect(said([event("referee_down", 40, { action_id: null, amount: 0, detail: "" })])[0]).toMatch(/bled out|blood/u);
    expect(said([event("referee_down", 40)])[0]).not.toMatch(/bled out|blood/u);
  });

  it("names the man who killed him in the replay of his fall, not the last man knocked down", () => {
    const lines = new Set<string>();
    for (let tick = 40; tick < 70; tick += 1) {
      const director = new CommentaryDirector();
      director.observe(snapshot(tick - 20), [event("knockdown", tick - 20, { actor_id: "one", target_id: "two", detail: "knockdown" })], players, 30, 0);
      director.replay(30, { kind: "referee_down", actor_id: "two", tick });
      for (let at = 30; at < 36; at += 0.25) {
        const text = director.current(at)?.line.text;
        if (text !== undefined && /Watch/u.test(text)) lines.add(text);
      }
    }
    expect([...lines].some((text) => text.includes("Crimson Geometry"))).toBe(true);
    expect([...lines].some((text) => text.includes("Azure Vector"))).toBe(false);
  });

  it("notices nobody is left to break a clinch", () => {
    expect(said([event("clinch_break", 40, { actor_id: "one", target_id: "two", detail: "", amount: 0 })]).some((text) => /break|part/u.test(text))).toBe(true);
  });
});

describe("the referee's death on screen, from the punch to the next bout", () => {
  type Stub = Record<string, unknown> & { refereePosition: THREE.Vector3 };
  const updateReferee = (FightRenderer.prototype as unknown as { updateReferee: (dt: number, time: number, snapshot: EngineSnapshot | null, tick: number) => void }).updateReferee;
  const placed = (graph = new BoxingGraph(referee(), mapping, { referee: true, knockout: true }), a = -100, b = 100): Stub => Object.assign(Object.create(FightRenderer.prototype) as Record<string, unknown>, {
    referee: graph, mapping, tmpA: new THREE.Vector3(mapping.x(a), 0, 0), tmpB: new THREE.Vector3(mapping.x(b), 0, 0),
    refereePosition: new THREE.Vector3(0, 0, -2), refereeAway: new THREE.Vector3(), refereeVelocity: new THREE.Vector3(), refereeYaw: 0,
    replay: null, ceremony: null, stoppageWinner: -1, stoppageRaiseAt: Number.POSITIVE_INFINITY, frameSeconds: 0, blobShadows: [], graphs: null,
    effects: { severedHeadPosition: () => false, gushing: () => false, pool: vi.fn() }, closeUpTarget: new THREE.Vector3(), bodyPoint: new THREE.Vector3(),
    pendingRefereeEvents: [], refereeReplayAt: null, settings: () => ({ reducedMotion: false, blood: "full" }),
    refereeHead: new THREE.Vector3(), refereePoolAccumulator: 0, refereePoolCount: 0, lastKnockdown: null,
  });
  /** Runs `frames` frames of `state` and returns the longest single-frame step he took. */
  const run = (stub: Stub, state: EngineSnapshot, frames: number, dt = 1 / 60, from = 0): number => {
    let longest = 0;
    for (let frame = 0; frame < frames; frame += 1) {
      const before = stub.refereePosition.clone();
      updateReferee.call(stub, dt, (from + frame) * dt, state, state.tick);
      longest = Math.max(longest, before.distanceTo(stub.refereePosition));
    }
    return longest;
  };
  const down = (tick: number) => ({ event_id: 1, tick, kind: "referee_down", actor_id: "one", target_id: REFEREE_ID, amount: 0, detail: "", blood: 0, direction: 0, action_id: "x" });

  it("replays his fall inside the engine's pause, with half a second to spare for the playback delay and a stalled frame", () => {
    const history = Array.from({ length: 120 }, (_, index) => ({ ...snapshot(40 + index) }));
    const plan = planKnockoutReplay(history, down(100), 30, REFEREE_REPLAY.speed, REFEREE_REPLAY.before, REFEREE_REPLAY.after)!;
    expect(REFEREE_REPLAY_DELAY_SECONDS + plan.durationSeconds).toBeLessThanOrEqual(150 / 30 - 0.5);
  });

  it("starts the replay only while the bout still waits for it", () => {
    const history = Array.from({ length: 200 }, (_, index) => ({ ...snapshot(40 + index) }));
    const attempt = (live: EngineSnapshot): ReturnType<typeof vi.fn> => {
      const startReplay = vi.fn();
      const stub = Object.assign(Object.create(FightRenderer.prototype) as Record<string, unknown>, {
        pendingContacts: [], replay: null, pendingRefereeEvents: [], refereeReplayAt: { at: 5, impact: down(100) }, frameSeconds: 9, history,
        simulation: { tick_rate: 30 }, settings: () => ({ reducedMotion: false, blood: "full" }), startReplay, buffer: { latest: () => live },
      });
      (FightRenderer.prototype as unknown as { fireContacts(this: unknown, tick: number): void }).fireContacts.call(stub, live.tick);
      expect(stub.refereeReplayAt).toBeNull();
      return startReplay;
    };
    expect(attempt({ ...snapshot(124), phase: "referee_down", phase_ticks_remaining: 126 })).toHaveBeenCalledOnce();
    // A frame stall that leaves less of the pause than the whole replay costs only its closing hold.
    expect(attempt({ ...snapshot(150), phase: "referee_down", phase_ticks_remaining: 100 })).toHaveBeenCalledOnce();
    // Long resumed (a hidden tab, a reconnect), or too little of the pause left: no replay over the fight.
    expect(attempt({ ...snapshot(239), phase: "fight" })).not.toHaveBeenCalled();
    expect(attempt({ ...snapshot(230), phase: "referee_down", phase_ticks_remaining: 20 })).not.toHaveBeenCalled();
  });

  it("stands in the killing punch's path in his replay until it lands, through the tick the recording says he died", () => {
    const stub = placed(undefined, -130, 150);
    const fightAt = (tick: number): EngineSnapshot => ({ ...snapshot(tick), fighters: [fighter("one", -130), fighter("two", 150)], referee: engineReferee(-55, 8) });
    run(stub, fightAt(80), 60);
    expect(stub.refereePosition.x).toBeCloseTo(mapping.x(-55), 2);
    const buffer = new SnapshotBuffer(8, 30);
    buffer.push(fightAt(82));
    buffer.push(fightAt(83));
    buffer.push({ ...fightAt(84), phase: "referee_down", referee: { ...engineReferee(-55, 8), alive: false } });
    const sampled = buffer.sample(83.4)!;
    expect(sampled.referee.alive).toBe(false);
    stub.replay = { plan: { impact: { kind: "referee_down" } }, impactFired: false };
    expect(run(stub, sampled, 1, 0.5 / 60, 60)).toBeLessThan(0.01);
    expect(stub.refereePosition.x).toBeCloseTo(mapping.x(-55), 2);
  });

  it("never jumps or dashes when the fight stops or starts again: at a bell, a count or a foul", () => {
    for (const phase of ["rest", "knockdown", "foul_recovery"] as const) {
      const stub = placed();
      const fight = { ...snapshot(80), referee: engineReferee(0, 62) };
      run(stub, fight, 60);
      const fighters = phase === "knockdown" ? [fighter("one", -100), { ...fighter("two", 100), is_downed: true }] : fight.fighters;
      expect(run(stub, { ...fight, tick: 81, phase, fighters: fighters as EngineSnapshot["fighters"] }, 30)).toBeLessThan(3 / 60);
    }
    const stub = placed();
    run(stub, { ...snapshot(80), phase: "rest", referee: engineReferee(0, 0) }, 60 * 4);
    expect(run(stub, { ...snapshot(90), referee: engineReferee(0, 62) }, 60)).toBeLessThan(3 / 60);
    // And he does get back to where the engine stands him.
    expect(stub.refereePosition.distanceTo(new THREE.Vector3(mapping.x(0), 0, mapping.z(62)))).toBeLessThan(0.02);
  });

  it("is lying where the engine has him for a spectator who joins after he died", () => {
    const graph = new BoxingGraph(referee(), mapping, { referee: true, knockout: true });
    const stub = placed(graph);
    // Already lying there on the first frame he is drawn, not falling in front of the newcomer.
    run(stub, { ...snapshot(4000), referee: { ...engineReferee(30, 62), alive: false } }, 1);
    expect(graph.isDown).toBe(true);
    graph.boxer.root.updateMatrixWorld(true);
    expect(graph.boxer.rig.bones.head.getWorldPosition(new THREE.Vector3()).y).toBeLessThan(0.6);
    expect(stub.refereePosition.x).toBeCloseTo(mapping.x(30), 2);
    expect(stub.refereePosition.z).toBeCloseTo(mapping.z(62), 2);
  });

  it("follows the recording exactly in his replay, cutting to wherever it has him, and lies still once the punch has landed", () => {
    const stub = placed();
    run(stub, { ...snapshot(80), referee: engineReferee(0, 62) }, 30);
    // The replay cuts to a moment the recording has him well away from where he lay.
    stub.replay = { plan: { impact: { kind: "referee_down" } }, impactFired: false };
    run(stub, { ...snapshot(60), referee: engineReferee(-250, -200) }, 1);
    expect(stub.refereePosition.x).toBeCloseTo(mapping.x(-250), 2);
    expect(stub.refereePosition.z).toBeCloseTo(mapping.z(-200), 2);
    // Once the punch has landed he goes where the fall takes him, not where the recording drifts, and his pool spreads.
    (stub.replay as { impactFired: boolean }).impactFired = true;
    const lying = stub.refereePosition.clone();
    const pool = (stub.effects as { pool: ReturnType<typeof vi.fn> }).pool;
    run(stub, { ...snapshot(70), phase: "referee_down", referee: { ...engineReferee(150, 100), alive: false } }, 60);
    expect(stub.refereePosition.distanceTo(lying)).toBeLessThan(1e-9);
    expect(pool).toHaveBeenCalled();
  });

  it("is laid down where the engine has him after a reconnect that missed his fall", () => {
    const graph = new BoxingGraph(referee(), mapping, { referee: true, knockout: true });
    const stub = placed(graph);
    run(stub, { ...snapshot(80), referee: engineReferee(0, 62) }, 30);
    expect(graph.isDown).toBe(false);
    run(stub, { ...snapshot(400), referee: { ...engineReferee(-120, -80), alive: false } }, 1);
    expect(graph.isDown).toBe(true);
    expect(stub.refereePosition.x).toBeCloseTo(mapping.x(-120), 2);
    expect(stub.refereePosition.z).toBeCloseTo(mapping.z(-80), 2);
    graph.boxer.root.updateMatrixWorld(true);
    expect(graph.boxer.rig.bones.head.getWorldPosition(new THREE.Vector3()).y).toBeLessThan(0.6);
  });

  it("keeps his pool through the replay of his death rather than starting another", () => {
    const stub = placed();
    const pool = (stub.effects as { pool: ReturnType<typeof vi.fn> }).pool;
    const dead = { ...snapshot(90), phase: "referee_down" as const, referee: { ...engineReferee(30, 62), alive: false } };
    run(stub, dead, 60);
    const live = pool.mock.calls.map((call) => call[2] as number);
    stub.replay = { plan: { impact: { kind: "referee_down" } }, impactFired: false };
    run(stub, { ...snapshot(70), referee: engineReferee(30, 62) }, 30);
    stub.replay = null;
    pool.mockClear();
    run(stub, dead, 10);
    expect(pool.mock.calls[0]![2] as number).toBeGreaterThanOrEqual(live.at(-1)!);
  });

  it("stays where he lies after a stoppage, raising nobody's arm, and a ceremony goes on without him", () => {
    const graph = new BoxingGraph(referee(), mapping, { referee: true, knockout: true });
    const raise = vi.spyOn(graph, "raise");
    const stub = placed(graph);
    graph.knockOut();
    const dead = { ...snapshot(4000), phase: "complete" as const, referee: { ...engineReferee(30, 62), alive: false } };
    run(stub, dead, 30);
    const lying = stub.refereePosition.clone();
    Object.assign(stub, { stoppageWinner: 0, stoppageRaiseAt: 0, frameSeconds: 10, stoppageSpot: null, raiseSpot: () => ({ x: 0.6, z: 0 }) });
    run(stub, dead, 60 * 4);
    expect(lying.distanceTo(stub.refereePosition)).toBeLessThan(1e-9);
    expect(raise).not.toHaveBeenCalled();
    const ceremony = { winnerSeat: 0, positions: [{ x: -102, y: -16 }, { x: 102, y: -16 }], marks: [0, 1], refereeArrived: false, arrivedAt: null, announced: false };
    Object.assign(stub, { stoppageWinner: -1, ceremony });
    run(stub, dead, 5);
    expect(ceremony.refereeArrived).toBe(true);
    expect(lying.distanceTo(stub.refereePosition)).toBeLessThan(1e-9);
  });

  it("stands up again for the next bout", () => {
    const graph = new BoxingGraph(referee(), mapping, { referee: true, knockout: true });
    const stub = placed(graph);
    run(stub, { ...snapshot(4000), referee: { ...engineReferee(30, 62), alive: false } }, 30);
    expect(graph.isDown).toBe(true);
    run(stub, { ...snapshot(10), referee: engineReferee(0, 62) }, 5);
    expect(graph.isDown).toBe(false);
  });

  it("staggers where he stands while he reels from a punch", () => {
    const reeling = new BoxingGraph(referee(), mapping, { referee: true });
    const steady = new BoxingGraph(referee(), mapping, { referee: true });
    const self = { ...fighter("referee"), x: 0, y: 160, facing_x: 0, facing_y: -1000 };
    const focus = { ...fighter("focus"), x: 0, y: -140 };
    for (let frame = 0; frame < 40; frame += 1) {
      reeling.update({ ...self, stunned_ticks: 12 }, focus, 1 / 60, frame / 60, false, "full", frame / 2);
      steady.update(self, focus, 1 / 60, frame / 60, false, "full", frame / 2);
    }
    for (const graph of [reeling, steady]) graph.boxer.root.updateMatrixWorld(true);
    expect(worldPosition(reeling.boxer.rig.bones.head, new THREE.Vector3()).distanceTo(worldPosition(steady.boxer.rig.bones.head, new THREE.Vector3()))).toBeGreaterThan(0.04);
  });

  it("puts his blob shadow under his body once he is down", () => {
    const graph = new BoxingGraph(referee(), mapping, { referee: true, knockout: true });
    const stub = placed(graph);
    run(stub, { ...snapshot(4000), referee: { ...engineReferee(30, 62), alive: false } }, 30);
    const body = graph.fallBody;
    expect(body).not.toBeNull();
    const shadows = [new THREE.Object3D(), new THREE.Object3D(), new THREE.Object3D()];
    Object.assign(stub, { blobShadows: shadows, buffer: { latest: () => null }, flashKnockout: null, refereePosition: new THREE.Vector3(2, 0, 2) });
    (FightRenderer.prototype as unknown as { updateBlobShadows(this: unknown): void }).updateBlobShadows.call(stub);
    const centre = body!.centre(new THREE.Vector3());
    expect(shadows[2]!.position.x).toBeCloseTo(centre.x, 5);
    expect(shadows[2]!.position.z).toBeCloseTo(centre.z, 5);
    expect(shadows[2]!.scale.x).toBeGreaterThan(1.5);
  });

  it("holds the round clock through his five seconds, as it does through a count", () => {
    const clock = new RoundClock();
    expect(clock.ticks({ ...snapshot(100), phase: "fight", phase_ticks_remaining: 4000 })).toBe(4000);
    expect(clock.ticks({ ...snapshot(102), phase: "referee_down", phase_ticks_remaining: 150 })).toBe(4000);
  });
});
