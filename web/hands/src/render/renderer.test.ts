import { fighter, snapshot } from "../test/fixtures";
import type { CombatEvent, MatchResult } from "../types";
import {
  arcadeInjuryFor,
  contactParticipants,
  contactPresentationPlan,
  isArcadeInjuryCandidate,
  presentationTickFor,
} from "./renderer";

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
