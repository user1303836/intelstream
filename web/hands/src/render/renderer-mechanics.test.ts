import * as THREE from "three";
import { EventDeduplicator, SnapshotBuffer } from "../interpolation";
import { EvasionPrediction, MovementPrediction } from "../prediction";
import { fighter, snapshot } from "../test/fixtures";
import type { CombatEvent, EngineSnapshot } from "../types";
import { BoxingGraph, SkinnedBoxer, loadBoxerGlb } from "./graph";
import { RoundStatsTracker } from "./hud";
import { bodySideStruck, contactPresentationPlan, cutmanWork, FightRenderer, isDelayedBodyKnockdown } from "./renderer";
import { worldMapping } from "./world";

const combat = (kind: string, overrides: Partial<CombatEvent> = {}): CombatEvent => ({
  event_id: 1, tick: 10, kind, actor_id: "one", target_id: "two", amount: 0, detail: "", blood: 0, direction: 1, action_id: null, ...overrides,
});

interface FakeGraph { stagger: ReturnType<typeof vi.fn>; windedFor: ReturnType<typeof vi.fn>; fallToKnee: ReturnType<typeof vi.fn>; resetTransient: ReturnType<typeof vi.fn>; primeReplayFall: ReturnType<typeof vi.fn>; acknowledge: ReturnType<typeof vi.fn> }
const fakeGraphs = (): [FakeGraph, FakeGraph] => [0, 1].map(() => ({ stagger: vi.fn(), windedFor: vi.fn(), fallToKnee: vi.fn(), resetTransient: vi.fn(), primeReplayFall: vi.fn(), acknowledge: vi.fn() })) as [FakeGraph, FakeGraph];

const methods = FightRenderer.prototype as unknown as {
  push(this: unknown, snapshot: EngineSnapshot): void;
  presentFightEvent(this: unknown, event: CombatEvent, recipientIndex: number, puncherIndex: number): void;
  recordedHit(this: unknown, knockdown: CombatEvent): CombatEvent | null;
};

function pushStub(graphs: [FakeGraph, FakeGraph]): Record<string, unknown> {
  return {
    buffer: new SnapshotBuffer(64, 30),
    dedupe: new EventDeduplicator(),
    history: [] as EngineSnapshot[],
    roundStats: new RoundStatsTracker(),
    referee: null,
    graphs,
    acknowledgeActions: vi.fn(),
    mapping: worldMapping({ tick_rate: 30, ring_half_width: 500, ring_half_height: 500 }),
    contactPoint: new THREE.Vector3(),
    pendingContacts: [] as unknown[],
    effects: { addEvent: vi.fn() },
    manualClock: true,
    lastManualTime: 0,
    lastKnockdown: null,
    recordedHit: methods.recordedHit,
    settings: () => ({ reducedMotion: false, blood: "full" }),
    commentary: { observe: vi.fn() },
    simulation: { tick_rate: 30 },
    players: {},
    frameSeconds: 0,
    liveFallTicks: [null, null],
  };
}

describe("fight mechanics on screen", () => {
  it("presents a parry, a body shot that is putting a fighter down and a swollen eye without an impact of their own", () => {
    const frame = snapshot(10);
    const plan = contactPresentationPlan([combat("parry"), combat("body_collapse", { amount: 10 }), combat("eye_shut", { detail: "right" })], frame);
    expect(plan.map((entry) => entry.presentImpact)).toEqual([false, false, false]);
  });

  it("knows a knockdown a moment after a body shot from one that came with its punch", () => {
    const frame = snapshot(20);
    const late = combat("knockdown", { tick: 20, detail: "body", action_id: "liver" });
    expect(isDelayedBodyKnockdown(contactPresentationPlan([late], frame)[0]!.presentationEvent)).toBe(true);
    const hit = combat("hit", { tick: 20, detail: "hook:body", action_id: "dig" });
    const withPunch = combat("knockdown", { tick: 20, detail: "body", action_id: "dig" });
    const paired = contactPresentationPlan([hit, withPunch], frame)[1]!;
    expect(paired.presentationEvent.detail).toBe("hook:body");
    expect(isDelayedBodyKnockdown(paired.presentationEvent)).toBe(false);
  });

  it("staggers the puncher whose power shot was parried and calls it", () => {
    const graphs = fakeGraphs();
    const stub = { graphs, buffer: { latest: () => snapshot(10) }, simulation: { tick_rate: 30 }, frameSeconds: 5, eventCallout: null as { text: string; until: number } | null };
    methods.presentFightEvent.call(stub, combat("parry", { actor_id: "two", target_id: "one" }), 0, 1);
    expect(graphs[0].stagger).toHaveBeenCalledTimes(1);
    expect(graphs[1].stagger).not.toHaveBeenCalled();
    expect(stub.eventCallout).toEqual({ text: "PARRIED", until: 6 });
    methods.presentFightEvent.call(stub, combat("eye_shut", { detail: "left" }), 1, 0);
    expect(stub.eventCallout?.text).toBe("EYE SWOLLEN SHUT");
  });

  it("folds the fighter over the body shot on the side it landed until he goes down", () => {
    const graphs = fakeGraphs();
    const frame = { ...snapshot(10), fighters: [{ ...fighter("one"), action_key: "hook:left:body:normal" }, fighter("two")] as const };
    const stub = { graphs, buffer: { latest: () => frame }, simulation: { tick_rate: 30 }, frameSeconds: 0, eventCallout: null };
    methods.presentFightEvent.call(stub, combat("body_collapse", { amount: 9 }), 1, 0);
    expect(graphs[1].windedFor).toHaveBeenCalledWith(expect.closeTo(9 / 30 + 0.15, 5), -1);
    expect(bodySideStruck("hook:right:body:power")).toBe(1);
    expect(bodySideStruck(null)).toBe(-1);
  });

  it("puts a body-shot knockdown on one knee and replays it from the punch that caused it", () => {
    const graphs = fakeGraphs();
    const stub = pushStub(graphs);
    const hit = combat("hit", { event_id: 3, tick: 30, detail: "hook:body", amount: 70, action_id: "liver" });
    methods.push.call(stub, { ...snapshot(30), events: [hit] });
    const knockdown = combat("knockdown", { event_id: 9, tick: 40, detail: "body", amount: 1, action_id: "liver" });
    const downed = { ...snapshot(40), fighters: [fighter("one"), { ...fighter("two"), is_downed: true }] as const, events: [knockdown] };
    methods.push.call(stub, downed);
    expect(graphs[1].fallToKnee).toHaveBeenLastCalledWith(true);
    expect((stub.lastKnockdown as { hit: CombatEvent | null }).hit).toEqual(hit);

    const headHit = combat("hit", { event_id: 12, tick: 70, detail: "uppercut:head", amount: 300 });
    const headDown = combat("knockdown", { event_id: 13, tick: 70, amount: 2 });
    methods.push.call(stub, { ...snapshot(70), fighters: [fighter("one"), { ...fighter("two"), is_downed: true }] as const, events: [headHit, headDown] });
    expect(graphs[1].fallToKnee).toHaveBeenLastCalledWith(false);
    expect((stub.lastKnockdown as { hit: CombatEvent | null }).hit).toEqual(headHit);
  });

  it("replays a body-shot knockdown on one knee, as it was seen live", () => {
    const startReplay = (FightRenderer.prototype as unknown as { startReplay(this: unknown, plan: unknown): void }).startReplay;
    const replayFor = (detail: string) => {
      const graphs = fakeGraphs();
      const hit = combat("hit", { event_id: 3, tick: 30, detail: "hook:body", amount: 70, action_id: "liver" });
      const stub = {
        simulation: { tick_rate: 30 }, frameSeconds: 0, final: null, graphs,
        commentary: { replay: vi.fn() }, arcadeInjuries: [null, null], arcadeInjuryEvents: [null, null], replayInjuries: [null, null],
        lastKnockdown: { knockdown: combat("knockdown", { event_id: 9, tick: 40, detail, amount: 1, action_id: "liver" }), hit, finisher: null },
        pendingContacts: [], effects: { returnMouthpiece: vi.fn() }, liveFallTicks: [null, null],
      };
      startReplay.call(stub, { snapshots: [snapshot(20), snapshot(40)], impact: hit, durationSeconds: 3 });
      return graphs;
    };
    const body = replayFor("body");
    // The knee is the animation's, so there is no fall under the physics to run again.
    for (const replayed of body) expect(replayed.primeReplayFall).not.toHaveBeenCalled();
    expect(body[1].fallToKnee).toHaveBeenCalledWith(true);
    expect(body[0].fallToKnee).not.toHaveBeenCalled();
    expect(replayFor("")[1].fallToKnee).not.toHaveBeenCalled();
  });

  it("lets the commentary team see every snapshot and the events in it", () => {
    const stub = pushStub(fakeGraphs());
    const state = { ...snapshot(30), events: [combat("hit", { event_id: 6, tick: 30, detail: "jab:head", amount: 30 })] };
    methods.push.call(stub, state);
    const observe = (stub.commentary as { observe: ReturnType<typeof vi.fn> }).observe;
    expect(observe).toHaveBeenCalledOnce();
    expect(observe.mock.calls[0]![0]).toBe(state);
    expect((observe.mock.calls[0]![1] as CombatEvent[]).map((event) => event.event_id)).toEqual([6]);
  });

  it("calls BOX! when the referee sends them back to it after the eight", () => {
    const stub = { ...pushStub(fakeGraphs()), eventCallout: null as { text: string; until: number } | null };
    methods.push.call(stub, { ...snapshot(300), phase: "knockdown", events: [combat("box", { event_id: 7, tick: 300, actor_id: null, target_id: "two" })] });
    expect(stub.eventCallout).toMatchObject({ text: "BOX!" });
  });

  it("queues the parry and the body collapse to be shown with their punch", () => {
    const stub = pushStub(fakeGraphs());
    methods.push.call(stub, { ...snapshot(30), events: [combat("parry", { event_id: 4, actor_id: "two", target_id: "one" }), combat("body_collapse", { event_id: 5, amount: 10 })] });
    expect((stub.pendingContacts as { event: CombatEvent }[]).map((pending) => pending.event.kind)).toEqual(["parry", "body_collapse"]);
  });
});

describe("the cutman's work", () => {
  const treated = (corner_choice: "cut" | "swelling" | "breath" | null, trauma: Partial<ReturnType<typeof fighter>["trauma"]>) => ({ ...fighter("one"), corner_choice, trauma: { ...fighter("one").trauma, ...trauma } });

  it("follows the corner's instruction", () => {
    expect(cutmanWork(treated("cut", { left_cut: 100, right_cut: 400, left_eye: 900 }))).toMatchObject({ side: -1, prop: "enswell" });
    expect(cutmanWork(treated("swelling", { left_cut: 100, right_cut: 400, left_eye: 900 }))).toMatchObject({ side: 1, prop: "enswell" });
    expect(cutmanWork(treated("breath", { left_eye: 900 }))).toMatchObject({ lateral: 0, prop: "bottle" });
    expect(cutmanWork(treated("cut", {})).lift).toBeGreaterThan(cutmanWork(treated("swelling", {})).lift);
    expect(cutmanWork(treated(null, { right_eye: 300 }))).toMatchObject({ side: -1, prop: "enswell" });
    expect(cutmanWork(undefined)).toMatchObject({ prop: "enswell" });
  });
});

describe("a bout that ends on the punch itself", () => {
  const setFinal = (FightRenderer.prototype as unknown as { setFinal(this: unknown, final: unknown): void }).setFinal;
  const result = (method: "tko" | "flash_ko") => ({ match_id: "m", activity_instance_id: "i", guild_id: "g", player_one_id: "one", player_two_id: "two", winner_id: "one", finish_method: method, round_number: 2, tick: 160, scorecards: [], player_one_knockdowns: 0, player_two_knockdowns: 3, player_one_damage: 900, player_two_damage: 300 });

  /** The room's own sequence: a snapshot every tick, and none after the one that carries the result. */
  const fightTo = (method: "tko" | "flash_ko") => {
    const graphs = fakeGraphs().map((graph) => ({ ...graph, awaitVerdict: vi.fn(), knockOut: vi.fn() })) as unknown as [FakeGraph, FakeGraph];
    const spies = { presentFinish: vi.fn(), applyArcadeInjury: vi.fn(), returnMouthpiece: vi.fn() };
    const stub = Object.assign(Object.create(FightRenderer.prototype) as Record<string, unknown>, pushStub(graphs), {
      commentary: { observe: vi.fn(), finish: vi.fn(), replay: vi.fn() },
      effects: { addEvent: vi.fn(), returnMouthpiece: spies.returnMouthpiece },
      endCeremony: vi.fn(), presentFinish: spies.presentFinish, applyArcadeInjury: spies.applyArcadeInjury, restoreInjury: vi.fn(),
      arcadeInjuries: [null, null], arcadeInjuryEvents: [null, null], replayInjuries: [null, null],
      flashKnockout: null, replay: null, ceremony: null, finalRevealAt: 0, ovationUntil: 0,
    });
    for (let tick = 100; tick < 160; tick += 1) methods.push.call(stub, { ...snapshot(tick), fighters: [fighter("one", -60), fighter("two", 60)] });
    const punch = combat("counter_hit", { event_id: 900, tick: 160, detail: "uppercut:head", amount: 140, action_id: "upper" });
    const events = method === "tko" ? [punch, combat("knockdown", { event_id: 901, tick: 160, amount: 3 }), combat("result", { event_id: 902, tick: 160, target_id: null, detail: "tko" })] : [punch, combat("result", { event_id: 902, tick: 160, target_id: null, detail: "flash_ko" })];
    const downed = { ...fighter("two", 60), is_downed: method === "tko" };
    methods.push.call(stub, { ...snapshot(160), phase: "complete", fighters: [{ ...fighter("one", -60), action: "uppercut", action_key: "uppercut:right:head:power", action_contact_tick: 160 }, downed], events, result: result(method) });
    // The final follows at once, while the render clock is still a few ticks behind the punch.
    setFinal.call(stub, { version: 3, type: "final", match_id: "m", winner_id: "one", method, round: 2, scorecards: [], ratings: {} });
    return { stub, ...spies };
  };

  it("still gets its slow-motion replay, holding the last picture for the fall", () => {
    for (const method of ["tko", "flash_ko"] as const) {
      const { stub, presentFinish } = fightTo(method);
      const replay = stub.replay as { plan: { toTick: number; impact: CombatEvent } } | null;
      expect(replay).not.toBeNull();
      expect(replay!.plan.impact.event_id).toBe(900);
      expect(replay!.plan.toTick).toBeGreaterThan(160);
      expect(presentFinish).not.toHaveBeenCalled();
    }
  });

  it("does the finisher at the replay's impact, not before the punch is shown", () => {
    const { stub, applyArcadeInjury, returnMouthpiece } = fightTo("tko");
    expect(applyArcadeInjury).not.toHaveBeenCalled();
    // The punch is the replay's own; the knockdown that came with it waits for the replay's impact.
    expect((stub.pendingContacts as { event: CombatEvent; contactTick: number; injury: unknown }[]).map(({ event, contactTick, injury }) => ({ kind: event.kind, contactTick, injury }))).toEqual([{ kind: "knockdown", contactTick: Number.POSITIVE_INFINITY, injury: null }]);
    expect((stub.replayInjuries as unknown[])[1]).not.toBeNull();
    expect(returnMouthpiece).toHaveBeenCalledWith(1);
  });

  it("gives the knockdown that ended the bout its thud, roar and rumble at the replay's impact", () => {
    const { stub } = fightTo("tko");
    const heard: string[] = [];
    const excite = vi.fn();
    const splashed: THREE.Vector3[] = [];
    Object.assign(stub, {
      onContact: (event: CombatEvent) => heard.push(event.kind), arena: { excite }, viewerId: "two", viewerHitFlash: 0,
      knockOutMouthpiece: vi.fn(), headWorldPose: () => null, mouthPoint: new THREE.Vector3(), reapplyReplayInjuries: vi.fn(),
      // Where the frame draws them, eased apart: fighter two 0.6 m out, his engine place 0.37 m.
      tmpA: new THREE.Vector3(-0.6, 0, 0), tmpB: new THREE.Vector3(0.6, 0, 0),
      effects: { addEvent: (_event: CombatEvent, at: THREE.Vector3) => splashed.push(at.clone()), returnMouthpiece: vi.fn() },
    });
    // The graphs' rendered roots are where the frame draws the fighters.
    for (const [index, graph] of (stub.graphs as unknown as Record<string, unknown>[]).entries()) {
      Object.assign(graph, { react: vi.fn(), landedHit: vi.fn(), currentRoot: { x: index === 0 ? -0.6 : 0.6, z: 0 } });
    }
    const replay = stub.replay as unknown as { plan: { snapshots: EngineSnapshot[] } };
    const fireContacts = (FightRenderer.prototype as unknown as { fireContacts(this: unknown, tick: number): void }).fireContacts;
    const fireReplayImpact = (FightRenderer.prototype as unknown as { fireReplayImpact(this: unknown, snapshot: EngineSnapshot): void }).fireReplayImpact;
    // The replay's lead-up shows nothing of it.
    fireContacts.call(stub, 150);
    expect(heard).toEqual([]);
    fireReplayImpact.call(stub, replay.plan.snapshots.find((one) => one.tick === 160)!);
    fireContacts.call(stub, 160.3);
    // Before, the knockdown's contact was dropped when the replay began: no thud, no roar, no rumble.
    expect(heard).toEqual(["counter_hit", "knockdown"]);
    // The replayed punch's blood leaves the head where it is drawn.
    expect(splashed[0]!.x).toBeCloseTo(0.6, 6);
    expect(excite).toHaveBeenCalledWith(1);
    expect(stub.viewerHitFlash).toBeGreaterThan(0);
    expect(stub.pendingContacts).toEqual([]);
  });
});

describe("the knockout replay's fall", () => {
  const startReplay = (FightRenderer.prototype as unknown as { startReplay(this: unknown, plan: unknown): void }).startReplay;
  const impact = combat("counter_hit", { event_id: 30, tick: 400, detail: "hook:head", amount: 120 });
  const replayed = (graphs: unknown[], liveFallTicks: [number | null, number | null]) => startReplay.call({
    simulation: { tick_rate: 30 }, frameSeconds: 0, final: null, graphs, commentary: { replay: vi.fn() },
    arcadeInjuries: [null, null], arcadeInjuryEvents: [null, null], replayInjuries: [null, null], pendingContacts: [], effects: { returnMouthpiece: vi.fn() },
    lastKnockdown: { knockdown: combat("knockdown", { event_id: 31, tick: 400, amount: 3 }), hit: impact, finisher: null }, liveFallTicks,
  }, { snapshots: [snapshot(380), snapshot(400)], impact, durationSeconds: 3 });

  it("runs the recorded fall again only when it is this knockdown's", () => {
    const fallen = fakeGraphs();
    replayed(fallen, [null, 401]);
    expect(fallen[1].primeReplayFall).toHaveBeenCalledOnce();
    expect(fallen[0].primeReplayFall).not.toHaveBeenCalled();
    // The record is an earlier knockdown's: the bout ended on the punch before the render clock showed this fall.
    const earlier = fakeGraphs();
    replayed(earlier, [null, 120]);
    expect(earlier[1].primeReplayFall).not.toHaveBeenCalled();
  });

  it("falls where he stood when the bout ended on the punch, not where an earlier knockdown left him", async () => {
    const gltf = await loadBoxerGlb();
    const mapping = worldMapping({ tick_rate: 30, ring_half_width: 500, ring_half_height: 500 });
    const boxer = new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8 });
    const graph = new BoxingGraph(boxer, mapping);
    let time = 0;
    const frames = (self: ReturnType<typeof fighter>, other: ReturnType<typeof fighter>, count: number): void => {
      for (let frame = 0; frame < count; frame += 1) {
        time += 1 / 60;
        graph.update(self, other, 1 / 60, time, false, "full", time * 30);
      }
    };
    const facing = (x: number) => ({ ...fighter("two", x), y: 0, facing_x: 0, facing_y: -1000 });
    const opponent = (x: number) => ({ ...fighter("one", x), y: -150, facing_x: 0, facing_y: 1000 });
    frames(facing(0), opponent(0), 12);
    // An earlier knockdown under the physics at x = 0, beaten.
    graph.react("hit", "head", 1, "straight", "right", 140);
    frames({ ...facing(0), is_downed: true, get_up_required: 100 }, opponent(0), 120);
    frames(facing(0), opponent(0), 150);
    frames(facing(250), opponent(250), 60);
    // The final arrives before the render clock shows this knockdown's fall: the replay starts and replays it.
    replayed([fakeGraphs()[0], graph], [null, 120]);
    frames(facing(250), opponent(250), 10);
    graph.react("hit", "head", 1, "hook", "left", 120);
    frames({ ...facing(250), is_downed: true }, opponent(250), 2);
    const root = boxer.root.position.clone();
    const start = graph.fallBody!.pelvis(new THREE.Vector3());
    frames({ ...facing(250), is_downed: true }, opponent(250), 300);
    const rest = graph.fallBody!.pelvis(new THREE.Vector3());
    // Before, the replayed body started at x = 0.01, where the earlier knockdown fell, and lay 1.58 m from him.
    expect(Math.hypot(start.x - root.x, start.z - root.z)).toBeLessThan(0.35);
    expect(Math.hypot(rest.x - root.x, rest.z - root.z)).toBeLessThan(1.1);
  }, 30_000);
});

describe("the player's own fighter folding over a body shot", () => {
  const predict = (FightRenderer.prototype as unknown as { applyLocalPrediction(this: unknown, state: EngineSnapshot, dt: number, timeMs: number): EngineSnapshot }).applyLocalPrediction;

  it("is held still from the body shot until he drops, then moves with the controls again", () => {
    const stub = { ...pushStub(fakeGraphs()), viewerId: "two", ownCollapseUntil: 0 };
    methods.push.call(stub, { ...snapshot(30), events: [combat("body_collapse", { event_id: 5, tick: 30, actor_id: "one", target_id: "two", amount: 10 })] });
    expect(stub.ownCollapseUntil).toBe(40);

    const viewer = {
      localInput: () => ({ moveX: 1000, moveY: 0, defense: "none" as const }), viewerId: "two", graphs: null, buffer: { interpolationDelayTicks: 2 },
      movement: new MovementPrediction(), evasion: new EvasionPrediction(), simulation: { tick_rate: 30 }, inputLatencyMs: null, ownCollapseUntil: 40,
    };
    const held = { ...snapshot(35), phase: "fight" as const };
    expect(predict.call(viewer, held, 1 / 30, 1000).fighters[1].x).toBe(held.fighters[1].x);
    viewer.ownCollapseUntil = 0;
    expect(predict.call(viewer, held, 1 / 30, 1033).fighters[1].x).toBeGreaterThan(held.fighters[1].x);
  });

  it("is not set by a body shot folding the opponent", () => {
    const stub = { ...pushStub(fakeGraphs()), viewerId: "one", ownCollapseUntil: 0 };
    methods.push.call(stub, { ...snapshot(30), events: [combat("body_collapse", { event_id: 6, tick: 30, actor_id: "one", target_id: "two", amount: 10 })] });
    expect(stub.ownCollapseUntil).toBe(0);
  });
});
