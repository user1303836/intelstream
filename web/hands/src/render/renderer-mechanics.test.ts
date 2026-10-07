import * as THREE from "three";
import { EventDeduplicator, SnapshotBuffer } from "../interpolation";
import { fighter, snapshot } from "../test/fixtures";
import type { CombatEvent, EngineSnapshot } from "../types";
import { RoundStatsTracker } from "./hud";
import { bodySideStruck, contactPresentationPlan, cutmanWork, FightRenderer, isDelayedBodyKnockdown } from "./renderer";
import { worldMapping } from "./world";

const combat = (kind: string, overrides: Partial<CombatEvent> = {}): CombatEvent => ({
  event_id: 1, tick: 10, kind, actor_id: "one", target_id: "two", amount: 0, detail: "", blood: 0, direction: 1, action_id: null, ...overrides,
});

interface FakeGraph { stagger: ReturnType<typeof vi.fn>; windedFor: ReturnType<typeof vi.fn>; fallToKnee: ReturnType<typeof vi.fn>; resetTransient: ReturnType<typeof vi.fn>; primeReplayFall: ReturnType<typeof vi.fn> }
const fakeGraphs = (): [FakeGraph, FakeGraph] => [0, 1].map(() => ({ stagger: vi.fn(), windedFor: vi.fn(), fallToKnee: vi.fn(), resetTransient: vi.fn(), primeReplayFall: vi.fn() })) as [FakeGraph, FakeGraph];

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
    mapping: worldMapping({ tick_rate: 30, ring_half_width: 500, ring_half_height: 500 }),
    tmpA: new THREE.Vector3(),
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
      };
      startReplay.call(stub, { snapshots: [snapshot(20), snapshot(40)], impact: hit, durationSeconds: 3 });
      return graphs;
    };
    const body = replayFor("body");
    expect(body[1].fallToKnee).toHaveBeenCalledWith(true);
    expect(body[0].fallToKnee).not.toHaveBeenCalled();
    expect(replayFor("")[1].fallToKnee).not.toHaveBeenCalled();
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
