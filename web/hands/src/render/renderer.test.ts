import * as THREE from "three";
import { fighter, mockHudContext, snapshot, type DrawnPicture } from "../test/fixtures";
import { Avatars } from "./avatars";
import { RoundClock } from "./hud";
import type { CombatEvent, EngineSnapshot, MatchResult } from "../types";
import { arcadeInjuryFor, canStartPunch, CEREMONY_MARKS, ceremonyStep, contactParticipants, contactPresentationPlan, cornersAtWork, FightRenderer, isArcadeInjuryCandidate, presentationTickFor, refereeSpacing, replayCameraSide, replayReattaches, visualSeparation } from "./renderer";
import { worldMapping } from "./world";

const event = (kind: string, detail: string): CombatEvent => ({
  event_id: 1,
  tick: 10,
  kind,
  actor_id: "one",
  target_id: "two",
  amount: 500,
  detail,
  blood: 100,
  direction: 1,
  action_id: "punch-1",
});

const flashKo: MatchResult = {
  match_id: "match",
  activity_instance_id: "activity",
  guild_id: "guild",
  player_one_id: "one",
  player_two_id: "two",
  winner_id: "one",
  finish_method: "flash_ko",
  round_number: 1,
  tick: 10,
  scorecards: [],
  player_one_knockdowns: 1,
  player_two_knockdowns: 0,
  player_one_damage: 0,
  player_two_damage: 500,
};

describe("contact presentation tick", () => {
  it("holds live contact events for interpolation but presents terminal contacts on the authoritative frame", () => {
    expect(presentationTickFor(snapshot(50))).toBe(49);
    expect(presentationTickFor({ ...snapshot(50), result: flashKo })).toBe(50);
  });

  it("routes hit recipients and block defenders without swapping the puncher", () => {
    const frame = snapshot(10);
    expect(contactParticipants(event("hit", "straight:head"), frame)).toEqual({ recipientIndex: 1, puncherIndex: 0 });
    expect(contactParticipants(event("block", "straight:head"), frame)).toEqual({ recipientIndex: 0, puncherIndex: 1 });
    expect(contactParticipants(event("perfect_block", "straight:head"), frame)).toEqual({ recipientIndex: 0, puncherIndex: 1 });
  });

  it("coalesces an engine-shaped block, leaking hit, and knockdown without changing event order", () => {
    const frame = {
      ...snapshot(10),
      fighters: [
        fighter("one"),
        { ...fighter("two"), facing: -1, action_key: "straight:left:body:light", action_contact_tick: 10 },
      ] as const,
    };
    const block = { ...event("block", ""), amount: 30, blood: 0, direction: 0 };
    const hit = {
      ...event("hit", "straight:body"),
      actor_id: "two",
      target_id: "one",
      amount: 18,
      blood: 12,
      direction: -1,
    };
    const knockdown = { ...event("knockdown", ""), actor_id: "two", target_id: "one", blood: 0, direction: 0, action_id: null };
    const plan = contactPresentationPlan([block, hit, knockdown], frame);
    expect(plan.map((entry) => entry.event.kind)).toEqual(["block", "hit", "knockdown"]);
    expect(plan.map((entry) => entry.presentImpact)).toEqual([true, false, true]);
    expect(plan[0]!.presentationEvent).toMatchObject({ kind: "block", detail: "straight:body", direction: -1, blood: 12 });
    expect(plan[2]!.presentationEvent).toMatchObject({ kind: "knockdown", detail: "straight:body", direction: -1, blood: 12 });
  });
});

describe("arcade injury candidate routing", () => {
  it("accepts authoritative downing anatomical hits and winning flash KOs", () => {
    expect(isArcadeInjuryCandidate(event("hit", "straight:head"), { ...fighter("two"), is_downed: true }, null)).toBe(true);
    expect(isArcadeInjuryCandidate(event("hit", "hook:body"), { ...fighter("two"), is_downed: true }, null)).toBe(true);
    expect(isArcadeInjuryCandidate(event("counter_hit", "hook:head"), fighter("two"), flashKo)).toBe(true);
  });

  it("routes head trauma to head injuries and body trauma to the struck-side limbs", () => {
    const downed = { ...fighter("two"), is_downed: true };
    const leftPunch = { ...fighter("one"), action_key: "hook:left:body:heavy" };
    const rightPunch = { ...fighter("one"), action_key: "hook:right:body:heavy" };
    expect(arcadeInjuryFor({ ...event("hit", "hook:head"), event_id: 0 }, downed, null, leftPunch)).toBe("decapitation");
    expect(arcadeInjuryFor({ ...event("hit", "hook:head"), event_id: 1 }, downed, null, leftPunch)).toBe("jaw_dislocation");
    expect(arcadeInjuryFor({ ...event("hit", "hook:body"), event_id: 0 }, downed, null, leftPunch)).toBe("dismember_right");
    expect(arcadeInjuryFor({ ...event("hit", "hook:body"), event_id: 1 }, downed, null, leftPunch)).toBe("shoulder_right");
    expect(arcadeInjuryFor({ ...event("hit", "hook:body"), event_id: 0 }, downed, null, rightPunch)).toBe("dismember_left");
    expect(arcadeInjuryFor({ ...event("hit", "hook:body"), event_id: 1 }, downed, null, rightPunch)).toBe("shoulder_left");
  });

  it.each([
    ["standing hit", event("hit", "left:jab:head"), fighter("two"), null],
    ["unknown target", event("hit", "straight:arm"), { ...fighter("two"), is_downed: true }, null],
    ["block", event("block", "left:straight:head"), { ...fighter("two"), is_downed: true }, null],
    ["bleed", event("bleed", "left:straight:head"), { ...fighter("two"), is_downed: true }, null],
    ["wrong winner", event("counter_hit", "right:hook:head"), fighter("two"), { ...flashKo, winner_id: "two" }],
  ] as const)("rejects %s", (_name, combatEvent, target, result) => {
    expect(isArcadeInjuryCandidate(combatEvent, target, result)).toBe(false);
  });
});

describe("referee spacing", () => {
  it("stands off during the action, steps in for a clinch and tightest over a count", () => {
    expect(refereeSpacing(false, false).standoff).toBeGreaterThan(refereeSpacing(false, true).standoff);
    expect(refereeSpacing(false, true).standoff).toBeGreaterThan(refereeSpacing(true, true).standoff - 0.2);
    expect(refereeSpacing(true, false).clearance).toBeLessThan(refereeSpacing(false, false).clearance);
    expect(refereeSpacing(false, true).clearance).toBeLessThan(refereeSpacing(false, false).clearance);
  });
});

describe("knockout replay injuries", () => {
  it("reattaches severed parts for the replay but leaves dislocations in place", () => {
    expect(replayReattaches("decapitation")).toBe(true);
    expect(replayReattaches("dismember_left")).toBe(true);
    expect(replayReattaches("dismember_right")).toBe(true);
    expect(replayReattaches("jaw_dislocation")).toBe(false);
    expect(replayReattaches("shoulder_left")).toBe(false);
  });
});

describe("replay camera side", () => {
  it("shoots from the broadcast side with room to spare and switches when the ropes would crowd it", () => {
    expect(replayCameraSide(0, 0, 0, 1, 2.5, 2.2)).toBe(1);
    expect(replayCameraSide(0, 0, 0, -1, 2.5, 2.2)).toBe(-1);
    expect(replayCameraSide(0, 1.2, 0, 1, 2.5, 2.2)).toBe(-1);
    expect(replayCameraSide(0, 2.4, 0, 1, 2.5, 2.2)).toBe(-1);
    expect(replayCameraSide(0, -1.5, 0, 1, 2.5, 2.2)).toBe(1);
  });
});

describe("punch prediction gate", () => {
  it("only predicts a punch the server would start", () => {
    const ready = fighter("one");
    expect(canStartPunch(ready)).toBe(true);
    expect(canStartPunch({ ...ready, is_downed: true })).toBe(false);
    expect(canStartPunch({ ...ready, stunned_ticks: 3 })).toBe(false);
    expect(canStartPunch({ ...ready, clinch_ticks: 10 })).toBe(false);
    expect(canStartPunch({ ...ready, taunt_ticks: 10 })).toBe(false);
    expect(canStartPunch({ ...ready, is_foul_recovery_target: true })).toBe(false);
  });
});

describe("replay injuries", () => {
  it("does not sever again when reduced motion or a lower blood level was chosen during the replay", () => {
    const event = { event_id: 5, tick: 10, kind: "knockdown", actor_id: "one", target_id: "two", amount: 400, detail: "", blood: 60, direction: 1, action_id: null };
    const apply = (settings: { blood: string; reducedMotion: boolean }): number => {
      const applied: unknown[] = [];
      const stub = { replayInjuries: [{ injury: "decapitation", event }, null], settings: () => settings, applyArcadeInjury: (...args: unknown[]) => { applied.push(args); return true; } };
      (FightRenderer.prototype as unknown as { reapplyReplayInjuries: () => void }).reapplyReplayInjuries.call(stub);
      expect(stub.replayInjuries[0]).toBeNull();
      return applied.length;
    };
    expect(apply({ blood: "full", reducedMotion: false })).toBe(1);
    expect(apply({ blood: "full", reducedMotion: true })).toBe(0);
    expect(apply({ blood: "reduced", reducedMotion: false })).toBe(0);
  });
});

describe("drawn separation", () => {
  it("leaves fighters alone at punching range", () => {
    expect(visualSeparation(-60, 0, 60, 0, 104, 462, 462)).toBeNull();
    expect(visualSeparation(0, 0, 104, 0, 104, 462, 462)).toBeNull();
  });

  it("steps both back evenly along the line between them", () => {
    const apart = visualSeparation(-38, 10, 38, 10, 104, 462, 462)!;
    expect(apart.bx - apart.ax).toBeCloseTo(104, 6);
    expect(apart.ax + apart.bx).toBeCloseTo(0, 6);
    expect(apart.ay).toBe(10);
    expect(apart.by).toBe(10);
    const angled = visualSeparation(0, 0, 30, 40, 104, 462, 462)!;
    expect(Math.hypot(angled.bx - angled.ax, angled.by - angled.ay)).toBeCloseTo(104, 6);
    expect((angled.ax + angled.bx) / 2).toBeCloseTo(15, 6);
    expect((angled.ay + angled.by) / 2).toBeCloseTo(20, 6);
  });

  it("keeps a fighter on the ropes where they are and moves the other the whole way", () => {
    const apart = visualSeparation(386, 0, 462, 0, 104, 462, 462)!;
    expect(apart.bx).toBe(462);
    expect(apart.ax).toBeCloseTo(358, 6);
  });

  it("separates fighters standing on one spot", () => {
    const apart = visualSeparation(10, 10, 10, 10, 104, 462, 462)!;
    expect(apart.bx - apart.ax).toBeCloseTo(104, 6);
    expect(apart.ay).toBe(10);
  });
});

describe("decision ceremony", () => {
  type Staged = { positions: { x: number; y: number }[] | null; winnerSeat: 0 | 1 | null; refereeArrived: boolean; arrivedAt: number | null; announced: boolean };
  const methods = FightRenderer.prototype as unknown as {
    ceremonyFor: (final: unknown) => Staged | null;
    ceremonyFighters: (ceremony: Staged, fighters: unknown, dt: number, seconds: number) => ReturnType<typeof fighter>[];
  };
  const final = (method: string, winner: string | null) => ({ version: 3, type: "final", match_id: "m", winner_id: winner, method, round: 3, scorecards: [], ratings: {} });
  const standing = () => [{ ...fighter("one"), x: -300, y: 200 }, { ...fighter("two"), x: 250, y: -120, action: "jab" as const, action_id: "late", defense: "guard_high" as const }];

  it("walks at no more than the step it is given and stops on the mark", () => {
    expect(ceremonyStep(0, 0, { x: 30, y: 40 }, 10)).toEqual({ x: 6, y: 8, arrived: false });
    expect(ceremonyStep(27, 36, { x: 30, y: 40 }, 10)).toEqual({ x: 30, y: 40, arrived: true });
    expect(ceremonyStep(30, 40, { x: 30, y: 40 }, 0)).toEqual({ x: 30, y: 40, arrived: true });
    expect(ceremonyStep(0, 0, { x: 30, y: 40 }, 0)).toEqual({ x: 0, y: 0, arrived: false });
  });

  it("is held for a bout that went to the cards, with both fighters on their feet", () => {
    const stub = (fighters: unknown) => ({ buffer: { latest: () => ({ fighters }) } });
    expect(methods.ceremonyFor.call(stub(standing()), final("decision", "two"))).toMatchObject({ winnerSeat: 1, positions: null, announced: false });
    expect(methods.ceremonyFor.call(stub(standing()), final("draw", null))).toMatchObject({ winnerSeat: null });
    expect(methods.ceremonyFor.call(stub(standing()), final("ko", "one"))).toBeNull();
    expect(methods.ceremonyFor.call(stub(standing()), final("forfeit", "one"))).toBeNull();
    expect(methods.ceremonyFor.call(stub(standing()), null)).toBeNull();
    expect(methods.ceremonyFor.call(stub([{ ...fighter("one"), is_downed: true }, fighter("two")]), final("decision", "two"))).toBeNull();
    expect(methods.ceremonyFor.call({ buffer: { latest: () => null } }, final("decision", "two"))).toBeNull();
  });

  it("walks both fighters to their marks, turns them to the camera and then raises the winner's arm", () => {
    const calls: string[] = [];
    const graph = (seat: number) => ({
      awaitVerdict: (side: number) => { if (!calls.includes(`await ${seat} ${side}`)) calls.push(`await ${seat} ${side}`); },
      announce: (verdict: string) => calls.push(`announce ${seat} ${verdict}`),
      boxer: { rig: { bones: { gloveL: { getWorldPosition: (out: { set: (x: number, y: number, z: number) => unknown }) => out.set(-0.3, 2, 0.1) }, gloveR: { getWorldPosition: (out: { set: (x: number, y: number, z: number) => unknown }) => out.set(0.3, 2, 0.1) } } } },
    });
    const raised: unknown[][] = [];
    const stub = {
      drawnFighters: [fighter("a"), fighter("b")],
      simulation: { tick_rate: 30 },
      graphs: [graph(0), graph(1)],
      referee: { raise: (...wrists: unknown[]) => raised.push(wrists.map((wrist) => (wrist === null ? null : (wrist as { x: number }).x))) },
      arena: { excite: (amount: number) => calls.push(`excite ${amount}`) },
      ceremonyWrists: [{ x: 0, set(x: number) { this.x = x; return this; } }, { x: 0, set(x: number) { this.x = x; return this; } }],
      frameSeconds: 0,
      finalRevealAt: 99,
      commentary: { verdict: () => {} },
    };
    const ceremony: Staged = { winnerSeat: 0, positions: null, refereeArrived: true, arrivedAt: null, announced: false };
    let drawn = methods.ceremonyFighters.call(stub, ceremony, standing(), 1 / 60, 0);
    expect(drawn[0]!.x).toBeGreaterThan(-300);
    expect(Math.hypot(drawn[0]!.x + 300, drawn[0]!.y - 200)).toBeCloseTo(200 / 60, 6);
    expect(Math.hypot(drawn[0]!.velocity_x, drawn[0]!.velocity_y)).toBeCloseTo(200 / 30, 6);
    expect(drawn[0]!.facing_x).toBeGreaterThan(0);
    expect(drawn[1]!).toMatchObject({ action: null, action_id: null, defense: "none" });
    let seconds = 0;
    let arrivedAt: number | null = null;
    for (let frame = 0; frame < 400 && !ceremony.announced; frame += 1) {
      seconds += 1 / 60;
      stub.frameSeconds = seconds;
      drawn = methods.ceremonyFighters.call(stub, ceremony, standing(), 1 / 60, seconds);
      if (ceremony.arrivedAt !== null) arrivedAt ??= seconds;
    }
    expect(drawn.map(({ x, y }) => ({ x, y }))).toEqual(CEREMONY_MARKS.map(({ x, y }) => ({ x, y })));
    for (const stood of drawn) expect(stood).toMatchObject({ velocity_x: 0, velocity_y: 0, facing_x: 0, facing_y: -1000 });
    expect(arrivedAt).not.toBeNull();
    expect(seconds - arrivedAt!).toBeGreaterThanOrEqual(0.7 - 1e-9);
    expect(seconds - arrivedAt!).toBeLessThan(0.75);
    expect(calls).toEqual(["await 0 1", "await 1 -1", "announce 0 winner", "announce 1 loser", "excite 1"]);
    expect(stub.finalRevealAt).toBeCloseTo(seconds + 0.35, 6);
    expect(raised.at(-1)).toEqual([null, -0.3]);
  });

  it("waits for the referee, and raises both arms after a draw", () => {
    const raised: unknown[][] = [];
    const announced: string[] = [];
    const graph = () => ({ awaitVerdict: () => {}, announce: (verdict: string) => announced.push(verdict), boxer: { rig: { bones: { gloveL: { getWorldPosition: (out: unknown) => out }, gloveR: { getWorldPosition: (out: unknown) => out } } } } });
    const stub = { drawnFighters: [fighter("a"), fighter("b")], simulation: { tick_rate: 30 }, graphs: [graph(), graph()], referee: { raise: (...wrists: unknown[]) => raised.push(wrists) }, arena: { excite: () => {} }, ceremonyWrists: ["blue", "red"], frameSeconds: 0, finalRevealAt: 99, commentary: { verdict: () => {} } };
    const ceremony: Staged = { winnerSeat: null, positions: CEREMONY_MARKS.map(({ x, y }) => ({ x, y })), refereeArrived: false, arrivedAt: null, announced: false };
    for (let frame = 0; frame < 120; frame += 1) methods.ceremonyFighters.call(stub, ceremony, standing(), 1 / 60, frame / 60);
    expect(ceremony.arrivedAt).toBeNull();
    expect(announced).toEqual([]);
    ceremony.refereeArrived = true;
    for (let frame = 120; frame < 200; frame += 1) methods.ceremonyFighters.call(stub, ceremony, standing(), 1 / 60, frame / 60);
    expect(announced).toEqual(["level", "level"]);
    expect(raised.at(-1)).toEqual(["red", "blue"]);
  });
});

describe("early punches", () => {
  const anticipate = (FightRenderer.prototype as unknown as { anticipatePunches: (latest: unknown, sampledTick: number) => void }).anticipatePunches;
  const watch = (replay: unknown = null) => {
    const calls: { seat: number; id: string | null; lead: number }[] = [];
    const graph = (seat: number) => ({ anticipate: (ahead: { action_id: string | null }, lead: number) => calls.push({ seat, id: ahead.action_id, lead }) });
    return { stub: { replay, graphs: [graph(0), graph(1)] }, calls };
  };
  const newest = (phase: string, downed = false) => ({
    ...snapshot(40), phase,
    fighters: [{ ...fighter("one"), action_id: "a", action_start_tick: 40 }, { ...fighter("two"), action_id: "b", action_start_tick: 39, is_downed: downed }],
  });

  it("are offered to both fighters with the time the delayed clock needs to reach them", () => {
    const { stub, calls } = watch();
    anticipate.call(stub, newest("fight"), 37.5);
    expect(calls).toEqual([{ seat: 0, id: "a", lead: 2.5 }, { seat: 1, id: "b", lead: 1.5 }]);
  });

  it("are left alone outside the fight, during the replay, and for a fighter on the canvas", () => {
    for (const phase of ["countdown", "knockdown", "rest", "complete", "foul_recovery"]) {
      const { stub, calls } = watch();
      anticipate.call(stub, newest(phase), 37.5);
      expect(calls).toEqual([]);
    }
    const replaying = watch({ plan: {} });
    anticipate.call(replaying.stub, newest("fight"), 37.5);
    expect(replaying.calls).toEqual([]);
    const downed = watch();
    anticipate.call(downed.stub, newest("fight", true), 37.5);
    expect(downed.calls.map((call) => call.seat)).toEqual([0]);
    const waiting = watch();
    anticipate.call(waiting.stub, null, 37.5);
    expect(waiting.calls).toEqual([]);
  });
});

describe("ovation", () => {
  const methods = FightRenderer.prototype as unknown as { setFinal: (final: unknown) => void; cheer: (seconds: number, dt: number) => void };
  const hall = (frameSeconds: number) => {
    const excited: number[] = [];
    return { excited, stub: { frameSeconds, buffer: { latest: () => null }, graphs: null, referee: null, arena: { excite: (amount: number) => excited.push(amount) }, ovationUntil: 0, finalRevealAt: 0, ceremony: null, final: null, ceremonyFor: () => null, endCeremony: () => {}, commentary: { finish: () => {} } } };
  };
  const decision = { version: 3, type: "final", match_id: "m", winner_id: "one", method: "forfeit", round: 3, scorecards: [], ratings: {} };

  it("keeps the crowd up for sixteen seconds after the result and then lets it sit", () => {
    const { stub, excited } = hall(10);
    methods.cheer.call(stub, 10, 1 / 60);
    expect(excited).toEqual([]);
    methods.setFinal.call(stub, decision);
    methods.cheer.call(stub, 10.5, 0.5);
    methods.cheer.call(stub, 25.9, 0.5);
    expect(excited).toHaveLength(2);
    expect(excited[0]).toBeGreaterThan(0.5 * 0.3);
    methods.cheer.call(stub, 26.1, 0.5);
    methods.cheer.call(stub, 400, 0.5);
    expect(excited).toHaveLength(2);
  });

  it("ends when the result is withdrawn", () => {
    const { stub, excited } = hall(10);
    methods.setFinal.call(stub, decision);
    methods.setFinal.call(stub, null);
    methods.cheer.call(stub, 11, 0.5);
    expect(excited).toEqual([]);
  });
});

describe("players' pictures", () => {
  it("come from Discord by way of the renderer, which draws them once they have arrived", () => {
    const made: Array<{ src: string; naturalWidth: number; onload: (() => void) | null }> = [];
    const avatars = new Avatars(() => {
      const image = { src: "", naturalWidth: 0, onload: null };
      made.push(image);
      return image as unknown as HTMLImageElement;
    });
    const drawn: DrawnPicture[] = [];
    const context = mockHudContext([], drawn);
    const self = {
      hudCanvas: { width: 0, height: 0, getBoundingClientRect: () => ({ width: 1280, height: 720 }), getContext: () => context },
      hudViewport: { width: 0, height: 0 },
      viewerHitFlash: 0,
      settings: () => ({ reducedMotion: false }),
      players: { one: { id: "123456789012345678", name: "Alpha", avatar: "abc123", rating: 1500, connected: true }, two: { id: "two", name: "Bravo", avatar: null, rating: 1500, connected: true } },
      viewerId: "one",
      frameSeconds: 0,
      finalRevealAt: Infinity,
      final: null,
      reconnectMs: 0,
      simulation: { tick_rate: 30 },
      roundStats: null,
      replay: null,
      inputLatencyMs: null,
      roundCalloutUntil: 0,
      roundCalloutRound: 1,
      roundClock: new RoundClock(),
      avatars,
      drawCaption: () => {},
    };
    const overlay = (FightRenderer.prototype as unknown as { drawHudOverlay(this: unknown, frame: unknown): void }).drawHudOverlay;
    overlay.call(self, snapshot());
    expect(self.hudViewport).toEqual({ width: 1280, height: 720 });
    expect(made.map((image) => image.src)).toEqual(["https://cdn.discordapp.com/avatars/123456789012345678/abc123.png?size=128"]);
    expect(drawn).toHaveLength(0);
    made[0]!.naturalWidth = 128;
    made[0]!.onload!();
    overlay.call(self, snapshot());
    expect(drawn.map((picture) => picture.image)).toEqual([made[0]]);
    expect(made).toHaveLength(1);
  });
});

describe("the rest between rounds", () => {
  it("clears the corners three seconds before the bell", () => {
    const rest = (remaining: number) => ({ phase: "rest" as const, phase_ticks_remaining: remaining });
    expect(cornersAtWork(rest(450), 30)).toBe(true);
    expect(cornersAtWork(rest(91), 30)).toBe(true);
    expect(cornersAtWork(rest(90), 30)).toBe(false);
    expect(cornersAtWork(rest(0), 30)).toBe(false);
    expect(cornersAtWork(rest(61), 20)).toBe(true);
    expect(cornersAtWork(rest(60), 20)).toBe(false);
    expect(cornersAtWork({ phase: "fight", phase_ticks_remaining: 450 }, 30)).toBe(false);
    expect(cornersAtWork(null, 30)).toBe(false);
  });

  const shot = (FightRenderer.prototype as unknown as { cornerShotFrame(this: unknown, seconds: number, frame: unknown, reducedMotion: boolean): { position: THREE.Vector3; lookAt: THREE.Vector3 } | null }).cornerShotFrame;
  const crew = (progress: [number, number], cutmen: unknown = [{}, {}]) => ({
    graphs: [{ stoolVisible: true }, { stoolVisible: true }],
    cutmen,
    cutmanProgress: progress,
    viewerId: "one",
    restStartedAt: 10,
    simulation: { tick_rate: 30 },
    mapping: worldMapping({ tick_rate: 30, ring_half_width: 500, ring_half_height: 500 }),
    cornerPosition: new THREE.Vector3(),
    cornerLookAt: new THREE.Vector3(),
  });
  const resting = { ...snapshot(), phase: "rest" as const, phase_ticks_remaining: 300 };

  it("stays on the wide shot until the cutman has got down to his work", () => {
    expect(shot.call(crew([0.6, 1]), 13, resting, false)).toBeNull();
    expect(shot.call(crew([0.97, 1]), 13, resting, false)).toBeNull();
    const close = shot.call(crew([1, 0]), 13, resting, false);
    expect(close).not.toBeNull();
    expect(close!.lookAt.x).toBeLessThan(-1);
    expect(shot.call(crew([1, 0.5]), 13 + 5.5, resting, false)).toBeNull();
    expect(shot.call(crew([1, 1]), 13 + 5.5, resting, false)!.lookAt.x).toBeGreaterThan(1);
  });

  it("does not wait for a crew that was never loaded", () => {
    expect(shot.call(crew([0, 0], null), 13, resting, false)).not.toBeNull();
  });

  it("is back on the wide shot once the seconds are out", () => {
    expect(shot.call(crew([1, 1]), 13, { ...resting, phase_ticks_remaining: 91 }, false)).not.toBeNull();
    expect(shot.call(crew([1, 1]), 13, { ...resting, phase_ticks_remaining: 89 }, false)).toBeNull();
  });
});

describe("the broadcast caption", () => {
  const draw = (FightRenderer.prototype as unknown as { drawCaption(this: unknown, ctx: CanvasRenderingContext2D, width: number, height: number, state: EngineSnapshot): void }).drawCaption;
  const scene = (overrides: Record<string, unknown> = {}) => {
    const commentary = { resultShown: vi.fn(), current: vi.fn(() => ({ line: { speaker: "play", text: "Down goes Two!", priority: 95, urgent: true, hold: 3, card: null }, opacity: 1, entering: 0 })) };
    return {
      commentary,
      final: null,
      finalRevealAt: 0,
      frameSeconds: 10,
      resultAnnounced: false,
      captionText: "",
      hudCanvas: { dataset: {} as Record<string, string> },
      viewerId: "one",
      players: {},
      roundStats: { total: () => ({ thrown: 0, landed: 0 }) },
      touchControls: false,
      replay: null,
      settings: () => ({ commentary: true, reducedMotion: false }),
      ...overrides,
    };
  };

  it("draws the line on screen and mirrors it for automation", () => {
    const texts: string[] = [];
    const self = scene();
    draw.call(self, mockHudContext(texts), 1280, 720, snapshot());
    expect(texts).toEqual(["CALLAHAN", "Down goes Two!"]);
    expect(self.hudCanvas.dataset.caption).toBe("Down goes Two!");
  });

  it("draws nothing when captions are switched off", () => {
    const texts: string[] = [];
    const self = scene({ settings: () => ({ commentary: false, reducedMotion: false }) });
    draw.call(self, mockHudContext(texts), 1280, 720, snapshot());
    expect(texts).toEqual([]);
    expect(self.hudCanvas.dataset.caption).toBeUndefined();
  });

  it("tells the announcer once that the result card is up", () => {
    const final = { version: 3, type: "final", match_id: "m", winner_id: "one", method: "ko", round: 2, scorecards: [], ratings: {} };
    const self = scene({ final, finalRevealAt: 12 });
    draw.call(self, mockHudContext([]), 1280, 720, snapshot());
    expect(self.commentary.resultShown).not.toHaveBeenCalled();
    self.frameSeconds = 12.5;
    draw.call(self, mockHudContext([]), 1280, 720, snapshot());
    draw.call(self, mockHudContext([]), 1280, 720, snapshot());
    expect(self.commentary.resultShown).toHaveBeenCalledOnce();
  });
});
