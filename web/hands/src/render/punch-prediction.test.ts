import * as THREE from "three";
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
        const action = press("own-1", punchClass, hand);
        const timing = predictedPunchTiming(idle, action);
        graph.predict(action, 0, 30, lead, timing, 41);
        const step = stepper(graph, 100);
        const ackFrame = Math.round((lead - INTERPOLATION_TICKS) * 2);
        const ages: number[] = [];
        let frames = 0;
        while (state(graph).punchActive && frames < 120) {
          // The server took the frame but never started the punch: no action, nothing queued.
          graph.acknowledge({ ...idle, last_input_sequence: frames >= ackFrame ? 41 : 40 }, true);
          step(idle);
          if (state(graph).punchActive) ages.push(state(graph).punchAgeTicks);
          frames += 1;
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
    const action = press("own-1", "jab", "left");
    graph.predict(action, 0, 30, 4, predictedPunchTiming(idle, action), 41);
    const step = stepper(graph, 100);
    for (let frame = 0; frame < 4; frame += 1) {
      graph.acknowledge({ ...idle, last_input_sequence: 41, queued_actions: 1 }, true);
      step(idle);
    }
    graph.acknowledge({ ...idle, last_input_sequence: 41, action: "jab", action_id: "own-1" }, true);
    // The press started and finished there; later snapshots no longer show it.
    graph.acknowledge({ ...idle, last_input_sequence: 43 }, true);
    for (let frame = 0; frame < 4; frame += 1) step(idle);
    expect(state(graph).punchActive).toBe(true);
    expect(state(graph).ownActionId).toBe("own-1");
    expect((graph as unknown as { ownPulled: boolean }).ownPulled).toBe(false);
  });

  it("pulls the glove back at once when the server shows the fighter stunned", () => {
    const graph = makeGraph();
    const action = press("own-1", "jab", "left");
    const timing = predictedPunchTiming(idle, action);
    graph.predict(action, 0, 30, 6, timing, 41);
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
    graph.predict(action, 0, 30, 6, timing, 41);
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
    graph.predict(action, 0, 30, 2, timing, 41);
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

  it("predicts the newer press when both ride the same input frame, as the server only ever sees that one", () => {
    const graph = makeGraph();
    graph.predict(jab, 10, 30, 4, predictedPunchTiming(idle, jab), 41);
    graph.predict(straight, 10.005, 30, 4, predictedPunchTiming(idle, straight), 41);
    expect(state(graph).punchClass).toBe("straight");
    expect(state(graph).ownActionId).toBe("own-2");
  });

  it("predicts the newer press when it comes less than half a tick after the first, in the next frame", () => {
    const graph = makeGraph();
    graph.predict(jab, 10, 30, 4, predictedPunchTiming(idle, jab), 41);
    graph.predict(straight, 10 + 0.4 / 30, 30, 4, predictedPunchTiming(idle, straight), 42);
    expect(state(graph).punchClass).toBe("straight");
    expect(state(graph).ownActionId).toBe("own-2");
  });

  it("keeps the first press once a tick has gone by, or once the server shows it started", () => {
    const later = makeGraph();
    later.predict(jab, 10, 30, 4, predictedPunchTiming(idle, jab), 41);
    const step = stepper(later, 100);
    step(idle);
    step(idle);
    later.predict(straight, 10 + 1 / 30, 30, 4, predictedPunchTiming(idle, straight), 43);
    expect(state(later).punchClass).toBe("jab");
    expect(state(later).ownActionId).toBe("own-1");
    const started = makeGraph();
    started.predict(jab, 10, 30, 4, predictedPunchTiming(idle, jab), 41);
    started.acknowledge(serverPunch({ ...idle, last_input_sequence: 41 }, "own-1", jab, 100), true);
    started.predict(straight, 10 + 0.4 / 30, 30, 4, predictedPunchTiming(idle, straight), 42);
    expect(state(started).ownActionId).toBe("own-1");
  });

  it("never snaps the glove back when the server confirms the newer press, and plays the first if the server threw it after all", () => {
    const graph = makeGraph();
    graph.predict(jab, 10, 30, 4, predictedPunchTiming(idle, jab), 41);
    graph.predict(straight, 10.005, 30, 4, predictedPunchTiming(idle, straight), 41);
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
    other.predict(jab, 10, 30, 4, predictedPunchTiming(idle, jab), 41);
    other.predict(straight, 10.005, 30, 4, predictedPunchTiming(idle, straight), 41);
    stepper(other, 200)(serverPunch(idle, "own-1", jab, 199));
    expect(state(other).punchClass).toBe("jab");
    expect(state(other).punchActive).toBe(true);
  });
});
