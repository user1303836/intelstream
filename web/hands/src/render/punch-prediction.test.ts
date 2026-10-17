import * as THREE from "three";
import { recoveryCancelAge, totalTicks } from "../manifest";
import { predictedPunchTiming } from "../prediction";
import { fighter as baseFighter } from "../test/fixtures";
import type { FighterSnapshot, PunchAction, PunchClass } from "../types";
import { BoxingGraph, SkinnedBoxer, loadBoxerGlb } from "./graph";
import { worldMapping } from "./world";

const mapping = worldMapping({ tick_rate: 30, ring_half_width: 500, ring_half_height: 500 });
const gltf = await loadBoxerGlb();

const idle: FighterSnapshot = { ...baseFighter("one"), facing_x: 0, facing_y: -1000, x: 0, y: 0, stance: "orthodox", last_input_sequence: 40 };
const opponent: FighterSnapshot = { ...baseFighter("two"), x: 0, y: -150, facing_x: 0, facing_y: 1000 };
const head = new THREE.Vector3(0, 1.5, mapping.z(-150));
/** The render clock trails the newest snapshot by this much, the rest of the lead being the input round trip. */
const INTERPOLATION_TICKS = 2;

interface PunchState { punchActive: boolean; punchAgeTicks: number; ownActionId: string | null; punchClass: PunchClass }
const state = (graph: BoxingGraph): PunchState => graph as unknown as PunchState;

function makeGraph(): BoxingGraph {
  const graph = new BoxingGraph(new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8 }), mapping);
  for (let frame = 0; frame < 10; frame += 1) graph.update(idle, opponent, 1 / 60, frame / 60, false, "full", frame / 2, head);
  return graph;
}

const press = (id: string, punchClass: PunchClass, hand: "left" | "right"): PunchAction => ({ kind: "punch", id, class: punchClass, hand, target: "head", power: "normal" });

/** The input frames presses went out in, looked up by press id as the network does once a frame is sent. */
function frames(): { sent: Map<string, number>; sequenceOf: (actionId: string) => number | null } {
  const sent = new Map<string, number>();
  return { sent, sequenceOf: (actionId) => sent.get(actionId) ?? null };
}

/** Steps the graph one 60 fps frame on the delayed snapshot `shown`, starting from tick `from`. */
function stepper(graph: BoxingGraph, from: number): (shown: FighterSnapshot) => number {
  let tick = from;
  return (shown) => {
    tick += 0.5;
    graph.update(shown, opponent, 1 / 60, tick / 30, false, "full", tick, head);
    return tick;
  };
}

describe("own punch the server refuses", () => {
  for (const [punchClass, hand] of [["jab", "left"], ["straight", "right"]] as const) {
    for (const lead of [2.6, 3.8, 8.6]) {
      it(`pulls a ${punchClass} back before contact once the frame that carried it is acknowledged, at a lead of ${lead} ticks`, () => {
        const graph = makeGraph();
        const { sent, sequenceOf } = frames();
        const action = press("own-1", punchClass, hand);
        const timing = predictedPunchTiming(idle, action);
        graph.predict(action, 0, 30, lead, timing);
        sent.set("own-1", 41);
        const step = stepper(graph, 100);
        const ackFrame = Math.round((lead - INTERPOLATION_TICKS) * 2);
        const ages: number[] = [];
        for (let frame = 0; state(graph).punchActive && frame < 120; frame += 1) {
          // The server took the frame but never started the punch: no action, nothing queued.
          graph.acknowledge({ ...idle, last_input_sequence: frame >= ackFrame ? 41 : 40 }, true, [], sequenceOf);
          step(idle);
          if (state(graph).punchActive) ages.push(state(graph).punchAgeTicks);
        }
        expect(state(graph).punchActive).toBe(false);
        expect(Math.max(...ages)).toBeLessThan(timing.startup);
        const peak = ages.indexOf(Math.max(...ages));
        expect(peak).toBeLessThanOrEqual(ackFrame + 1);
        for (let index = peak + 1; index < ages.length; index += 1) expect(ages[index]!).toBeLessThan(ages[index - 1]!);
      });
    }
  }

  it("keeps a punch the server has queued behind another, then lets it play once started", () => {
    const graph = makeGraph();
    const { sent, sequenceOf } = frames();
    const action = press("own-1", "jab", "left");
    graph.predict(action, 0, 30, 4, predictedPunchTiming(idle, action));
    sent.set("own-1", 41);
    const step = stepper(graph, 100);
    for (let frame = 0; frame < 4; frame += 1) {
      graph.acknowledge({ ...idle, last_input_sequence: 41, queued_actions: 1 }, true, [], sequenceOf);
      step(idle);
    }
    graph.acknowledge({ ...idle, last_input_sequence: 41, action: "jab", action_id: "own-1" }, true, [], sequenceOf);
    // The press started and finished there; later snapshots no longer show it.
    graph.acknowledge({ ...idle, last_input_sequence: 43 }, true, [], sequenceOf);
    for (let frame = 0; frame < 4; frame += 1) step(idle);
    expect(state(graph).punchActive).toBe(true);
    expect(state(graph).ownActionId).toBe("own-1");
    expect((graph as unknown as { ownPulled: boolean }).ownPulled).toBe(false);
  });

  it("does not judge a press before the frame carrying it has gone out", () => {
    const graph = makeGraph();
    const { sent, sequenceOf } = frames();
    const action = press("own-1", "jab", "left");
    graph.predict(action, 0, 30, 4, predictedPunchTiming(idle, action));
    const step = stepper(graph, 100);
    // Snapshots acknowledging earlier frames say nothing about this press.
    graph.acknowledge({ ...idle, last_input_sequence: 99 }, true, [], sequenceOf);
    step(idle);
    expect((graph as unknown as { ownPulled: boolean }).ownPulled).toBe(false);
    sent.set("own-1", 100);
    graph.acknowledge({ ...idle, last_input_sequence: 100 }, true, [], sequenceOf);
    expect((graph as unknown as { ownPulled: boolean }).ownPulled).toBe(true);
  });

  it("pulls the glove back at once when the server shows the fighter stunned", () => {
    const graph = makeGraph();
    const action = press("own-1", "jab", "left");
    const timing = predictedPunchTiming(idle, action);
    graph.predict(action, 0, 30, 6, timing);
    const step = stepper(graph, 100);
    step(idle);
    step(idle);
    const before = state(graph).punchAgeTicks;
    graph.acknowledge({ ...idle, last_input_sequence: 40, stunned_ticks: 12 }, true);
    step(idle);
    expect(state(graph).punchAgeTicks).toBeLessThan(before);
    let frames = 0;
    while (state(graph).punchActive && frames < 60) { step(idle); frames += 1; }
    expect(state(graph).punchActive).toBe(false);
  });

  it("pulls back a started punch a stun cuts off before contact, and the late confirmation does not throw it again", () => {
    const graph = makeGraph();
    const action = press("own-1", "jab", "left");
    const timing = predictedPunchTiming(idle, action);
    graph.predict(action, 0, 30, 6, timing);
    const step = stepper(graph, 100);
    for (let frame = 0; frame < 3; frame += 1) step(idle);
    const thrown: FighterSnapshot = {
      ...idle, last_input_sequence: 41, action: "jab", action_hand: "left", action_target: "head", action_power: "normal", action_id: "own-1", action_key: "jab:left:head:normal",
      action_start_tick: 101, action_startup_ticks: timing.startup, action_active_ticks: timing.active, action_recovery_ticks: timing.recovery,
    };
    graph.acknowledge(thrown, true);
    graph.acknowledge({ ...thrown, stunned_ticks: 40 }, true);
    const ages: number[] = [state(graph).punchAgeTicks];
    // The delayed snapshot on screen now shows the punch starting, before the stun reaches it.
    while (state(graph).punchActive && ages.length < 60) {
      step(thrown);
      if (state(graph).punchActive) ages.push(state(graph).punchAgeTicks);
    }
    expect(state(graph).punchActive).toBe(false);
    expect(Math.max(...ages)).toBeLessThan(timing.startup);
    for (let index = 1; index < ages.length; index += 1) expect(ages[index]!).toBeLessThanOrEqual(ages[index - 1]!);
    step(thrown);
    expect(state(graph).punchActive).toBe(false);
  });

  it("lets a started punch that already landed finish when a stun or the bell follows", () => {
    const graph = makeGraph();
    const action = press("own-1", "jab", "left");
    const timing = predictedPunchTiming(idle, action);
    graph.predict(action, 0, 30, 2, timing);
    const step = stepper(graph, 100);
    for (let frame = 0; frame < 4; frame += 1) step(idle);
    graph.acknowledge({ ...idle, last_input_sequence: 41, action: "jab", action_id: "own-1", action_contact_tick: 104, stunned_ticks: 30 }, false);
    expect((graph as unknown as { ownPulled: boolean }).ownPulled).toBe(false);
  });
});

const serverPunch = (base: FighterSnapshot, id: string, action: PunchAction, startTick: number): FighterSnapshot => {
  const timing = predictedPunchTiming(base, action);
  return {
    ...base, action: action.class, action_hand: action.hand, action_target: action.target, action_power: action.power, action_id: id,
    action_key: `${action.class}:${action.hand}:${action.target}:${action.power}`, action_start_tick: startTick,
    action_startup_ticks: timing.startup, action_active_ticks: timing.active, action_recovery_ticks: timing.recovery,
  };
};

describe("two presses inside one server tick", () => {
  const jab = press("own-1", "jab", "left");
  const straight = press("own-2", "straight", "right");

  it("switches to the newer press once it goes out in the frame the first never made, as the server only ever sees that one", () => {
    const graph = makeGraph();
    const { sent, sequenceOf } = frames();
    graph.predict(jab, 10, 30, 4, predictedPunchTiming(idle, jab));
    // Too long after the jab to replace it outright; both wait for the same flush, which sends only the straight.
    graph.predict(straight, 10 + 0.6 / 30, 30, 4, predictedPunchTiming(idle, straight));
    expect(state(graph).ownActionId).toBe("own-1");
    sent.set("own-2", 41);
    graph.acknowledge({ ...idle, last_input_sequence: 40 }, true, [], sequenceOf);
    expect(state(graph).punchClass).toBe("straight");
    expect(state(graph).ownActionId).toBe("own-2");
  });

  it("predicts the newer press when it comes less than half a tick after the first, in the next frame", () => {
    const graph = makeGraph();
    graph.predict(jab, 10, 30, 4, predictedPunchTiming(idle, jab));
    graph.predict(straight, 10 + 0.4 / 30, 30, 4, predictedPunchTiming(idle, straight));
    expect(state(graph).punchClass).toBe("straight");
    expect(state(graph).ownActionId).toBe("own-2");
  });

  it("keeps the first press once a tick has gone by, or once the server shows it started", () => {
    const later = makeGraph();
    later.predict(jab, 10, 30, 4, predictedPunchTiming(idle, jab));
    const step = stepper(later, 100);
    step(idle);
    step(idle);
    later.predict(straight, 10 + 1 / 30, 30, 4, predictedPunchTiming(idle, straight));
    expect(state(later).punchClass).toBe("jab");
    expect(state(later).ownActionId).toBe("own-1");
    const started = makeGraph();
    started.predict(jab, 10, 30, 4, predictedPunchTiming(idle, jab));
    started.acknowledge(serverPunch({ ...idle, last_input_sequence: 41 }, "own-1", jab, 100), true);
    started.predict(straight, 10 + 0.4 / 30, 30, 4, predictedPunchTiming(idle, straight));
    expect(state(started).ownActionId).toBe("own-1");
  });

  it("never snaps the glove back when the server confirms the newer press, and plays the first if the server threw it after all", () => {
    const graph = makeGraph();
    graph.predict(jab, 10, 30, 4, predictedPunchTiming(idle, jab));
    graph.predict(straight, 10.005, 30, 4, predictedPunchTiming(idle, straight));
    const step = stepper(graph, 100);
    const ages: number[] = [];
    for (let frame = 0; frame < 4; frame += 1) { step(idle); ages.push(state(graph).punchAgeTicks); }
    const confirmed = serverPunch(idle, "own-2", straight, 101);
    for (let frame = 0; frame < 10; frame += 1) {
      step(confirmed);
      expect(state(graph).ownActionId).toBe("own-2");
      expect((graph as unknown as { punchHand: string }).punchHand).toBe("right");
      ages.push(state(graph).punchAgeTicks);
    }
    for (let index = 1; index < ages.length; index += 1) expect(ages[index]!).toBeGreaterThanOrEqual(ages[index - 1]!);
    const other = makeGraph();
    other.predict(jab, 10, 30, 4, predictedPunchTiming(idle, jab));
    other.predict(straight, 10.005, 30, 4, predictedPunchTiming(idle, straight));
    stepper(other, 200)(serverPunch(idle, "own-1", jab, 199));
    expect(state(other).punchClass).toBe("jab");
    expect(state(other).punchActive).toBe(true);
  });
});

describe("follow-up pressed during a punch", () => {
  const straight = press("s1", "straight", "right");
  const hook = press("own-hook", "hook", "left");
  const straightTiming = predictedPunchTiming(idle, straight);
  const hookTiming = predictedPunchTiming(idle, hook);
  const T0 = 300;
  const thrown = serverPunch(idle, "s1", straight, T0);
  const contact = (kind: string, actionId = "s1") => ({ event_id: 7, tick: T0 + straightTiming.startup, kind, actor_id: kind.includes("block") ? "two" : "one", target_id: kind.includes("block") ? "one" : "two", amount: 30, detail: "straight:head", blood: 0, direction: 1, action_id: actionId });

  /**
   * Plays a straight from T0 and presses a hook at `pressAge` with a lead of 4 ticks; the snapshots
   * on screen show the server's hook from `serverStart`. Returns the tick at which the graph first
   * plays the hook and the tick at which it reaches contact.
   */
  function followUp(serverStart: number, options: { contacts?: ReturnType<typeof contact>[]; stunnedUntil?: number; pressAge?: number } = {}): { start: number; contact: number } {
    const graph = makeGraph();
    const pressAge = options.pressAge ?? 7;
    const served = serverPunch(idle, "own-hook", hook, serverStart);
    let tick = T0 - 0.5;
    let start = NaN;
    let reached = NaN;
    graph.acknowledge(thrown, true, options.contacts ?? []);
    for (let frame = 0; frame < 120 && Number.isNaN(reached); frame += 1) {
      tick += 0.5;
      const opposite = { ...opponent, stunned_ticks: tick < (options.stunnedUntil ?? -Infinity) ? 20 : 0 };
      graph.update(tick < serverStart ? thrown : served, opposite, 1 / 60, tick / 30, false, "full", tick, head);
      if (tick === T0 + pressAge) graph.predict(hook, tick / 30, 30, 4, hookTiming);
      if (state(graph).ownActionId !== "own-hook") continue;
      if (Number.isNaN(start)) start = tick;
      if (state(graph).punchAgeTicks >= hookTiming.startup) reached = tick;
    }
    return { start, contact: reached };
  }
  const near = (actual: number, expected: number): void => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);

  // The straight runs 12 ticks and a chained follow-up may cut its recovery short from age 9. A press
  // at age p with the lead of 4 reaches the server at T0 + p + 4.
  const ends = T0 + totalTicks(straightTiming);
  const cancels = T0 + recoveryCancelAge(straightTiming);

  it("waits for a whiffed straight to end and starts the hook on the tick it ends, as the engine does", () => {
    expect(straightTiming).toMatchObject({ startup: 4, active: 2, recovery: 6 });
    // Pressed at 58% of the straight, the engine starts the hook as it ends and lands it at the hook's startup.
    const { start, contact: reached } = followUp(ends);
    expect(start).toBeGreaterThanOrEqual(ends - 1.5);
    near(reached, ends + hookTiming.startup);
  });

  it("cuts a landed straight's recovery short at its cancel age, or when the press arrives after it", () => {
    // Pressed at age 4 the hook reaches the server before the cancel age and starts there.
    near(followUp(cancels, { contacts: [contact("hit")], pressAge: 4 }).contact, cancels + hookTiming.startup);
    // Pressed at age 6 with a lead of 4 it reaches the server after the cancel age and starts at once.
    near(followUp(T0 + 10, { contacts: [contact("hit")], pressAge: 6 }).contact, T0 + 10 + hookTiming.startup);
    // An ordinary block lets the combination through too.
    near(followUp(cancels, { contacts: [contact("block"), contact("hit")], pressAge: 4 }).contact, cancels + hookTiming.startup);
  });

  it("does not cut the recovery short for a parried straight or a contact that belongs to another punch", () => {
    for (const contacts of [[contact("perfect_block"), contact("hit")], [contact("hit", "s0")]]) {
      const { start, contact: reached } = followUp(ends, { contacts, pressAge: 4 });
      expect(start).toBeGreaterThanOrEqual(ends - 1.5);
      near(reached, ends + hookTiming.startup);
    }
  });

  it("holds the follow-up while the defender is stunned and cuts in once he is not", () => {
    const { start, contact: reached } = followUp(T0 + 11, { contacts: [contact("hit")], pressAge: 4, stunnedUntil: T0 + 11 });
    expect(start).toBeGreaterThanOrEqual(T0 + 11);
    near(reached, T0 + 11 + hookTiming.startup);
    const held = followUp(ends, { contacts: [contact("hit")], pressAge: 4, stunnedUntil: T0 + 40 });
    expect(held.start).toBeGreaterThanOrEqual(ends - 1.5);
    near(held.contact, ends + hookTiming.startup);
  });

  it("plays the held press from the server's timeline when the server starts it sooner than expected", () => {
    // No contact reached the client, so the graph expects the hook as the straight ends; the server cut in at T0 + 10.
    const { start, contact: reached } = followUp(T0 + 10, { pressAge: 6 });
    expect(start).toBe(T0 + 10);
    near(reached, T0 + 10 + hookTiming.startup);
  });

  it("keeps only the newest held press while the punch in front still holds it, and forgets one the server drops", () => {
    const graph = makeGraph();
    const step = stepper(graph, T0 - 0.5);
    let tick = T0;
    while (tick < ends - 7) tick = step(thrown);
    graph.predict(hook, tick / 30, 30, 4, hookTiming);
    const uppercut = press("own-upper", "uppercut", "right");
    graph.predict(uppercut, tick / 30 + 0.1, 30, 4, predictedPunchTiming(idle, uppercut));
    while (tick < ends - 3) tick = step(thrown);
    // Three ticks from the end, a press arrives after the held one has started: it is not predicted.
    graph.predict(press("own-late", "jab", "left"), tick / 30, 30, 4, predictedPunchTiming(idle, press("own-late", "jab", "left")));
    while (tick < ends + 0.5) tick = step(thrown);
    expect(state(graph).ownActionId).toBe("own-upper");
    expect(state(graph).punchClass).toBe("uppercut");
    const dropped = makeGraph();
    const next = stepper(dropped, T0 - 0.5);
    tick = T0;
    while (tick < ends - 7) tick = next(thrown);
    dropped.predict(hook, tick / 30, 30, 4, hookTiming);
    // The server got the frame and holds nothing: a guard raised in the same tick cleared it.
    dropped.acknowledge({ ...thrown, last_input_sequence: 51, queued_actions: 0 }, true, [], (actionId) => (actionId === "own-hook" ? 51 : null));
    while (tick < ends + 4) tick = next(thrown);
    expect(state(dropped).ownActionId).toBeNull();
    expect(state(dropped).punchClass).toBe("straight");
  });
});
