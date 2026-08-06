import { fighter } from "../test/fixtures";
import type { CombatEvent, MatchResult } from "../types";
import { isArcadeDecapitationCandidate } from "./renderer";

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

describe("arcade decapitation candidate routing", () => {
  it("accepts authoritative downing head hits and winning flash KOs", () => {
    expect(isArcadeDecapitationCandidate(event("hit", "left:straight:head"), { ...fighter("two"), is_downed: true }, null)).toBe(true);
    expect(isArcadeDecapitationCandidate(event("counter_hit", "right:hook:head"), fighter("two"), flashKo)).toBe(true);
  });

  it.each([
    ["standing hit", event("hit", "left:jab:head"), fighter("two"), null],
    ["body hit", event("hit", "left:straight:body"), { ...fighter("two"), is_downed: true }, null],
    ["block", event("block", "left:straight:head"), { ...fighter("two"), is_downed: true }, null],
    ["bleed", event("bleed", "left:straight:head"), { ...fighter("two"), is_downed: true }, null],
    ["wrong winner", event("counter_hit", "right:hook:head"), fighter("two"), { ...flashKo, winner_id: "two" }],
  ] as const)("rejects %s", (_name, combatEvent, target, result) => {
    expect(isArcadeDecapitationCandidate(combatEvent, target, result)).toBe(false);
  });
});
