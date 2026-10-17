import * as THREE from "three";
import { fighter, referee as engineReferee, snapshot } from "../test/fixtures";
import type { CombatEvent, EngineSnapshot } from "../types";
import { CommentaryDirector } from "./commentary";
import { BoxingGraph, SkinnedBoxer, loadBoxerGlb } from "./graph";
import { OFFICIAL_LOOKS } from "./looks";
import { BLUE_CORNER_OUTFIT, REFEREE_OUTFIT } from "./outfit";
import { FightRenderer, REFEREE_ID } from "./renderer";
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
    return {
      referee: graph, mapping, tmpA: new THREE.Vector3(-0.6, 0, 0), tmpB: new THREE.Vector3(0.6, 0, 0),
      refereePosition: new THREE.Vector3(0, 0, -2), refereeAway: new THREE.Vector3(), refereeVelocity: new THREE.Vector3(), refereeYaw: 0,
      replay: null, ceremony: null, stoppageWinner: -1, stoppageRaiseAt: Number.POSITIVE_INFINITY, frameSeconds: 0, blobShadows: [], graphs: null,
      effects: { severedHeadPosition: () => false }, closeUpTarget: new THREE.Vector3(), bodyPoint: new THREE.Vector3(), pendingRefereeEvents: [], settings: () => ({ reducedMotion: false, blood: "full" }),
    };
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

  const moments = (): { renderer: Record<string, unknown>; react: ReturnType<typeof vi.fn>; knockOut: ReturnType<typeof vi.fn>; addEvent: ReturnType<typeof vi.fn>; onContact: ReturnType<typeof vi.fn>; landedHit: ReturnType<typeof vi.fn> } => {
    const react = vi.fn();
    const knockOut = vi.fn();
    const addEvent = vi.fn();
    const onContact = vi.fn();
    const landedHit = vi.fn();
    const head = new THREE.Object3D();
    head.position.set(0.1, 1.6, -0.4);
    const live = { ...snapshot(60), referee: engineReferee(0, 62) };
    const renderer = Object.assign(Object.create(FightRenderer.prototype) as Record<string, unknown>, {
      pendingRefereeEvents: [] as CombatEvent[], refereeReplayAt: null, eventCallout: null, frameSeconds: 10, history: [] as EngineSnapshot[],
      buffer: { latest: () => live }, referee: { react, knockOut, boxer: { rig: { bones: { head } } } }, effects: { addEvent },
      settings: () => ({ reducedMotion: false, blood: "full" }), mapping, graphs: [{ landedHit }, { landedHit: vi.fn() }], onContact, refereeHead: new THREE.Vector3(),
    });
    return { renderer, react, knockOut, addEvent, onContact, landedHit };
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
    expect(landedHit).toHaveBeenCalledWith(false);
    expect(onContact).toHaveBeenCalledWith(hit);
    expect(renderer.pendingRefereeEvents).toEqual([]);
  });

  it("knocks him out cold on his fall, says so, and replays it once it has played live", () => {
    const { renderer, knockOut, addEvent } = moments();
    const down = event("referee_down", 50, { amount: 0, blood: 0, detail: "" });
    (renderer.pendingRefereeEvents as CombatEvent[]).push(down);
    fire(renderer, 50);
    expect(knockOut).toHaveBeenCalledTimes(1);
    expect(addEvent.mock.calls[0]![0]).toMatchObject({ kind: "knockdown" });
    expect(renderer.eventCallout).toMatchObject({ text: "THE REFEREE IS DEAD!" });
    expect(renderer.refereeReplayAt).toMatchObject({ impact: down });
    expect((renderer.refereeReplayAt as { at: number }).at).toBeGreaterThan(10);
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

  it("notices nobody is left to break a clinch", () => {
    expect(said([event("clinch_break", 40, { actor_id: "one", target_id: "two", detail: "", amount: 0 })]).some((text) => /break|part/u.test(text))).toBe(true);
  });
});
