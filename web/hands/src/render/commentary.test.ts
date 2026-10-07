import { ROCKED_BASE_TICKS, ROCKED_MAX_TICKS } from "../manifest";
import { fighter } from "../test/fixtures";
import type { CombatEvent, EngineSnapshot, FighterSnapshot, FinalMessage, MatchPhase, PublicPlayer } from "../types";
import { CommentaryDirector, crowdTension, fillLine, holdFor, punchName, type CommentaryHooks } from "./commentary";

const players: Record<string, PublicPlayer> = {
  one: { id: "one", name: "Azure Vector", avatar: null, rating: 1512, connected: true },
  two: { id: "two", name: "Crimson Geometry", avatar: null, rating: 1494, connected: true },
};

let nextId = 1;
const event = (kind: string, tick: number, fields: Partial<CombatEvent> = {}): CombatEvent => ({ event_id: nextId++, tick, kind, actor_id: null, target_id: null, amount: 0, detail: "", blood: 0, direction: 0, action_id: null, ...fields });
const hit = (tick: number, actor: string, detail = "jab:head", amount = 30, kind = "hit"): CombatEvent => event(kind, tick, { actor_id: actor, target_id: actor === "one" ? "two" : "one", amount, detail });

const state = (tick: number, phase: MatchPhase = "fight", edits: [Partial<FighterSnapshot>, Partial<FighterSnapshot>] = [{}, {}], extra: Partial<EngineSnapshot> = {}): EngineSnapshot => ({
  tick,
  phase,
  round_number: 1,
  phase_ticks_remaining: 3000,
  fighters: [{ ...fighter("one", -100), ...edits[0] }, { ...fighter("two", 100), ...edits[1] }],
  events: [],
  result: null,
  checksum: "a".repeat(64),
  ...extra,
});

/** Runs the director's clock forward and returns every distinct line that reached the screen. */
function watch(director: CommentaryDirector, from: number, to: number, step = 1 / 30): string[] {
  const seen: string[] = [];
  for (let now = from; now <= to; now += step) {
    const caption = director.current(now);
    if (caption !== null && seen[seen.length - 1] !== caption.line.text) seen.push(caption.line.text);
  }
  return seen;
}

function feed(director: CommentaryDirector, snapshot: EngineSnapshot, events: CombatEvent[], now: number): void {
  director.observe({ ...snapshot, events }, events, players, 30, now);
}

beforeEach(() => {
  nextId = 1;
});

describe("commentary lines", () => {
  it("fills names and capitalises the start of a line", () => {
    expect(fillLine("{b} is hurt!", { b: "the blue corner" })).toBe("The blue corner is hurt!");
    expect(fillLine("Down goes {b}!", { b: "Crimson Geometry" })).toBe("Down goes Crimson Geometry!");
  });

  it("names punches the way a commentator does", () => {
    const puncher = (action: FighterSnapshot["action"], hand: FighterSnapshot["action_hand"]): FighterSnapshot => ({ ...fighter("one"), action, action_hand: hand });
    expect(punchName("hook:head", puncher("hook", "right"))).toBe("right hook");
    expect(punchName("straight:head", puncher("straight", "right"))).toBe("right hand");
    expect(punchName("uppercut:body", puncher("uppercut", "left"))).toBe("left uppercut to the body");
    expect(punchName("jab:head", puncher("jab", "left"))).toBe("jab");
    expect(punchName("hook:head", puncher("jab", "left"))).toBe("hook");
    expect(punchName("right:hook:body", puncher("hook", "right"))).toBe("right hook to the body");
  });

  it("holds a line long enough to read and no longer than five seconds", () => {
    expect(holdFor("Down goes Two!")).toBe(2.2);
    expect(holdFor("x".repeat(200))).toBe(5.2);
    expect(holdFor("x".repeat(40))).toBeCloseTo(3.4);
  });
});

describe("the commentary team", () => {
  it("calls the knockdown over the punch and the hurt fighter of the same moment", () => {
    const director = new CommentaryDirector();
    const tick = 600;
    feed(director, state(tick, "knockdown", [{}, { is_downed: true, poise: 0 }]), [
      hit(tick, "one", "hook:head", 120, "counter_hit"),
      event("stun", tick, { actor_id: "one", target_id: "two", amount: 120 }),
      event("knockdown", tick, { actor_id: "one", target_id: "two", amount: 1 }),
    ], 10);
    expect(director.current(10.1)).toBeNull();
    const lines = watch(director, 10.3, 20);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/Crimson Geometry/u);
    expect(lines[0]).toMatch(/down|drops/iu);
  });

  it("calls a man badly hurt only when the shot has rocked him about as long as one can", () => {
    const call = (stunned: number): string => {
      const director = new CommentaryDirector();
      feed(director, state(400, "fight", [{}, { stunned_ticks: stunned, poise: 400 }]), [
        event("stun", 400, { actor_id: "one", target_id: "two", amount: 80 }),
      ], 5);
      return watch(director, 5.2, 12)[0] ?? "";
    };
    const badly = /out on their feet|all sorts of trouble|badly hurt/u;
    expect(call(ROCKED_MAX_TICKS)).toMatch(badly);
    expect(call(ROCKED_BASE_TICKS)).not.toMatch(badly);
  });

  it("never shows two lines at once and leaves a pause between lines", () => {
    const director = new CommentaryDirector();
    feed(director, state(100), [hit(100, "one", "jab:head"), hit(110, "one", "straight:head"), hit(120, "one", "hook:head")], 1);
    const first = director.current(1.3)!;
    const end = 1.3 + first.line.hold;
    feed(director, state(300), [event("taunt", 300, { actor_id: "two" })], end - 0.6);
    const shown: Array<{ text: string; at: number }> = [];
    for (let now = 1.3; now <= 14; now += 1 / 60) {
      const caption = director.current(now);
      if (caption !== null && shown[shown.length - 1]?.text !== caption.line.text) shown.push({ text: caption.line.text, at: now });
    }
    expect(shown.map((entry) => entry.text)).toHaveLength(2);
    expect(shown[0]!.text).toMatch(/Azure Vector/u);
    expect(shown[1]!.text).toMatch(/Crimson Geometry/u);
    expect(shown[1]!.at - shown[0]!.at).toBeGreaterThanOrEqual(holdFor(shown[0]!.text) + 0.9 - 1e-6);
  });

  it("lets an urgent call cut in over colour, but not straight away", () => {
    const director = new CommentaryDirector();
    feed(director, state(100), [event("taunt", 100, { actor_id: "two" })], 0);
    expect(director.current(0.4)?.line.text).toMatch(/Crimson Geometry/u);
    feed(director, state(118), [event("stun", 118, { actor_id: "two", target_id: "one", amount: 80 })], 0.5);
    expect(director.current(0.85)?.line.speaker).toBe("colour");
    expect(director.current(1.25)?.line.text).toMatch(/Azure Vector/u);
    expect(director.current(1.25)?.line.urgent).toBe(true);
  });

  it("drops a line that could not be shown while the action was fresh", () => {
    const director = new CommentaryDirector();
    feed(director, state(100), [event("get_up", 100, { actor_id: "two", amount: 9 })], 0);
    feed(director, state(101), [event("taunt", 101, { actor_id: "one" })], 0.1);
    const lines = watch(director, 0.3, 30);
    expect(lines.some((text) => /nine/u.test(text))).toBe(true);
    expect(lines.some((text) => /taunt|showboat|invites|chin/iu.test(text))).toBe(false);
  });

  it("does not repeat the same phrasing back to back", () => {
    const director = new CommentaryDirector();
    const texts: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      const tick = 1000 + index * 300;
      const now = index * 10;
      feed(director, state(tick), [event("stun", tick, { actor_id: "one", target_id: "two", amount: 60 })], now);
      const text = director.current(now + 0.4)?.line.text;
      if (text !== undefined) texts.push(text);
    }
    expect(texts).toHaveLength(8);
    for (let index = 1; index < texts.length; index += 1) expect(texts[index]).not.toBe(texts[index - 1]);
  });

  it("gives every viewer the same call for the same fight", () => {
    const run = (): string[] => {
      nextId = 1;
      const director = new CommentaryDirector();
      feed(director, state(100), [hit(100, "one", "hook:head", 130, "counter_hit")], 0);
      feed(director, state(400), [event("stun", 400, { actor_id: "two", target_id: "one", amount: 70 })], 10);
      feed(director, state(700), [event("clinch", 700, { actor_id: "one", target_id: "two" })], 20);
      return watch(director, 0, 30);
    };
    expect(run()).toEqual(run());
  });

  it("falls back to the corner when a name is missing", () => {
    const director = new CommentaryDirector();
    director.observe({ ...state(50), events: [] }, [event("stun", 50, { actor_id: "two", target_id: "one", amount: 60 })], {}, 30, 0);
    expect(director.current(0.5)?.line.text).toMatch(/blue corner/iu);
  });
});

describe("the ring announcer", () => {
  it("introduces both corners during the opening countdown and reads them aloud", () => {
    const speak = vi.fn();
    const director = new CommentaryDirector({ speak });
    feed(director, state(1, "countdown", [{}, {}], { phase_ticks_remaining: 90 }), [], 0);
    const blue = director.current(0.05);
    expect(blue?.line.card).toEqual({ kicker: "IN THE BLUE CORNER", title: "AZURE VECTOR", detail: "RATED 1512", corner: 0 });
    const red = director.current(1.6);
    expect(red?.line.card).toMatchObject({ kicker: "IN THE RED CORNER", title: "CRIMSON GEOMETRY", corner: 1 });
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak.mock.calls[0]![0]).toEqual(["In the blue corner... Azure Vector!", "And in the red corner... Crimson Geometry!"]);
  });

  it("does not introduce the fighters to someone who arrives after the opening bell", () => {
    const speak = vi.fn();
    const director = new CommentaryDirector({ speak });
    feed(director, state(400, "fight"), [], 0);
    feed(director, state(400, "countdown", [{}, {}], { round_number: 1, phase_ticks_remaining: 90 }), [], 1);
    expect(watch(director, 0, 6)).toEqual([]);
    expect(speak).not.toHaveBeenCalled();
  });

  const decision = (winner: string | null, cards: Array<[number[], number[]]>): FinalMessage => ({
    version: 3, type: "final", match_id: "m", winner_id: winner, method: winner === null ? "draw" : "decision", round: 3,
    scorecards: cards.map(([one, two], index) => ({ judge: `J${index}`, player_one: one, player_two: two })), ratings: {},
  });

  it("goes to the scorecards and then names the winner with the judges' verdict", () => {
    const speak = vi.fn();
    const director = new CommentaryDirector({ speak });
    feed(director, state(5000, "complete"), [], 0);
    director.finish(decision("one", [[[10, 10, 10], [9, 9, 9]], [[10, 10, 9], [9, 9, 10]], [[10, 9, 10], [9, 10, 9]]]), players, true, 1);
    expect(director.current(1.1)?.line.card?.title).toBe("WE GO TO THE SCORECARDS");
    director.verdict(3);
    const verdict = director.current(3.9);
    expect(verdict?.line.card).toEqual({ kicker: "THE WINNER, BY UNANIMOUS DECISION", title: "AZURE VECTOR", detail: "", corner: 0 });
    expect(speak.mock.calls.map((call) => call[0])).toEqual([["Ladies and gentlemen, we go to the scorecards."], ["And the winner, by unanimous decision... Azure Vector!"]]);
  });

  it("scores a draw as a draw", () => {
    const director = new CommentaryDirector();
    feed(director, state(5000, "complete"), [], 0);
    director.finish(decision(null, [[[10, 10, 10], [9, 10, 10]], [[10, 10, 10], [10, 10, 10]], [[9, 10, 10], [10, 10, 9]]]), players, true, 0);
    director.verdict(1);
    expect(director.current(1.9)?.line.card).toMatchObject({ kicker: "AFTER THREE ROUNDS", title: "MAJORITY DRAW", corner: null });
  });

  it("announces a stoppage with the time it came in the round", () => {
    const speak = vi.fn();
    const director = new CommentaryDirector({ speak });
    feed(director, state(1, "countdown", [{}, {}], { phase_ticks_remaining: 90 }), [], 0);
    feed(director, state(91, "fight", [{}, {}], { phase_ticks_remaining: 3599 }), [], 3);
    feed(director, state(1350, "fight", [{}, {}], { phase_ticks_remaining: 2340 }), [], 45);
    feed(director, state(1351, "knockdown", [{}, { is_downed: true }], { phase_ticks_remaining: 300 }), [event("knockdown", 1351, { actor_id: "one", target_id: "two", amount: 1 })], 46);
    feed(director, state(1651, "complete", [{}, { is_downed: true }], { phase_ticks_remaining: 0 }), [event("result", 1651, { actor_id: "one", detail: "ko" })], 56);
    director.finish({ version: 3, type: "final", match_id: "m", winner_id: "one", method: "ko", round: 1, scorecards: [], ratings: {} }, players, false, 56.2);
    director.resultShown(70);
    expect(director.current(70.5)?.line.card).toEqual({ kicker: "STOPPED AT 0:42 OF ROUND 1", title: "AZURE VECTOR", detail: "WINS BY KNOCKOUT", corner: 0 });
    expect(speak.mock.calls.at(-1)![0]).toEqual(["The referee stops the contest at 0:42 of round one. Your winner, by knockout... Azure Vector!"]);
  });

  it("calls the knockout on the spot and the replay when it rolls", () => {
    const director = new CommentaryDirector();
    feed(director, state(900, "complete", [{}, { is_downed: true }]), [event("knockdown", 900, { actor_id: "one", target_id: "two", amount: 1 }), event("result", 900, { actor_id: "one", detail: "flash_ko" })], 0);
    const call = director.current(0.1);
    expect(call?.line.urgent).toBe(true);
    expect(call?.line.text).toMatch(/Lights out|One punch|Good night/u);
    director.replay(6);
    expect(watch(director, 6, 12).some((text) => /again|one more time|set it up/u.test(text))).toBe(true);
  });
});

describe("reading the fight", () => {
  it("sums up the round from the punch counts and gives the analyst's opinion", () => {
    const director = new CommentaryDirector();
    const events: CombatEvent[] = [];
    for (let index = 0; index < 12; index += 1) events.push(event("punch_start", 100 + index * 20, { actor_id: "one", detail: "left:jab:head" }));
    for (let index = 0; index < 9; index += 1) events.push(hit(105 + index * 20, "one", "straight:head", 50));
    for (let index = 0; index < 6; index += 1) events.push(event("punch_start", 110 + index * 20, { actor_id: "two", detail: "left:jab:head" }));
    events.push(hit(115, "two", "jab:head", 30));
    feed(director, state(400), events, 0);
    watch(director, 0, 30);
    feed(director, state(3600, "rest"), [event("bell", 3600, { detail: "round_end" })], 40);
    const lines = watch(director, 40, 55);
    expect(lines.some((text) => /round 1/u.test(text) && /bell|books/u.test(text))).toBe(true);
    expect(lines).toContain("Round 1: Azure Vector landed 9 of 12, Crimson Geometry 1 of 6.");
    expect(lines.some((text) => /Azure Vector/u.test(text) && /round/u.test(text) && !/landed/u.test(text))).toBe(true);
  });

  it("has no numbers to read out for a round in which nobody threw a punch", () => {
    const director = new CommentaryDirector();
    feed(director, state(3600, "rest"), [event("bell", 3600, { detail: "round_end" })], 0);
    expect(watch(director, 0, 15).some((text) => /landed/u.test(text))).toBe(false);
  });

  it("calls a close round close and a knockdown round big", () => {
    const close = new CommentaryDirector();
    feed(close, state(400), [hit(100, "one"), hit(130, "two")], 0);
    watch(close, 0, 10);
    feed(close, state(3600, "rest"), [event("bell", 3600, { detail: "round_end" })], 20);
    expect(watch(close, 20, 35).some((text) => /either way|Tough round|Nothing between/u.test(text))).toBe(true);

    const big = new CommentaryDirector();
    feed(big, state(400), [hit(100, "two", "hook:head", 90), event("knockdown", 100, { actor_id: "two", target_id: "one", amount: 1 })], 0);
    watch(big, 0, 20);
    feed(big, state(3600, "rest"), [event("bell", 3600, { detail: "round_end" })], 30);
    expect(watch(big, 30, 45).some((text) => /knockdown/u.test(text) && /Crimson Geometry/u.test(text))).toBe(true);
  });

  it("always calls the bell, straight after the line already on screen", () => {
    const director = new CommentaryDirector();
    feed(director, state(3590), [hit(3590, "one", "hook:head", 120)], 0);
    const shot = director.current(0.4)!.line;
    expect(shot.text).toMatch(/hook/u);
    feed(director, state(3600, "rest"), [event("bell", 3600, { detail: "round_end" })], 0.5);
    expect(director.current(0.4 + shot.hold + 0.05)?.line.text).toMatch(/round 1/u);
  });

  it("says a hurt fighter was saved by the bell", () => {
    const director = new CommentaryDirector();
    feed(director, state(3600, "rest", [{ stunned_ticks: 20 }, {}]), [event("bell", 3600, { detail: "round_end" })], 0);
    expect(director.current(0.4)?.line.text).toMatch(/Azure Vector/u);
    expect(director.current(0.4)?.line.text).toMatch(/bell/u);
  });

  it("says when a fighter beats the count late and what comes next", () => {
    const director = new CommentaryDirector();
    feed(director, state(800, "knockdown", [{}, { is_downed: true }]), [event("knockdown", 600, { actor_id: "one", target_id: "two", amount: 1 }), event("count", 780, { target_id: "two", amount: 6 })], 0);
    watch(director, 0, 6);
    feed(director, state(860, "fight"), [event("get_up", 860, { actor_id: "two", amount: 8 })], 8);
    const lines = watch(director, 8, 20);
    expect(lines[0]).toMatch(/eight/u);
    expect(lines.some((text) => /finish|survive|clear the head/u.test(text))).toBe(true);
  });

  it("hears the crowd start chanting when one fighter takes over", () => {
    const cue = vi.fn();
    const director = new CommentaryDirector({ cue } satisfies CommentaryHooks);
    const events = Array.from({ length: 8 }, (_, index) => hit(100 + index * 40, "one", index % 2 === 0 ? "jab:head" : "straight:head", 40));
    feed(director, state(500), events, 0);
    feed(director, state(900), [hit(900, "one", "hook:head", 50), hit(930, "one", "jab:head", 30)], 14);
    expect(cue).toHaveBeenCalledTimes(1);
    expect(cue).toHaveBeenCalledWith("chant");
  });

  it("notices a cut opening and getting worse", () => {
    const director = new CommentaryDirector();
    const cut = (left_cut: number): Partial<FighterSnapshot> => ({ trauma: { ...fighter("two").trauma, left_cut } });
    feed(director, state(100, "fight", [{}, cut(30)]), [], 0);
    feed(director, state(130, "fight", [{}, cut(70)]), [], 1);
    expect(watch(director, 1, 5).some((text) => /Crimson Geometry/u.test(text) && /left eye/u.test(text))).toBe(true);
    feed(director, state(900, "fight", [{}, cut(430)]), [], 20);
    expect(watch(director, 20, 25).some((text) => /worse|pouring|badly/u.test(text))).toBe(true);
  });

  it("says once a round that a fighter has run out of gas", () => {
    const director = new CommentaryDirector();
    const tired: [Partial<FighterSnapshot>, Partial<FighterSnapshot>] = [{ stamina: 150, maximum_stamina: 1000 }, {}];
    feed(director, state(100, "fight", tired), [], 0);
    feed(director, state(140, "fight", tired), [], 1);
    expect(watch(director, 1, 3)).toEqual([]);
    feed(director, state(170, "fight", tired), [], 2);
    feed(director, state(400, "fight", tired), [event("exhausted", 400, { actor_id: "one" })], 12);
    const lines = watch(director, 2, 20);
    expect(lines.filter((text) => /Azure Vector/u.test(text))).toHaveLength(1);
  });

  it("knows a hurt fighter who grabs hold is holding on", () => {
    const director = new CommentaryDirector();
    feed(director, state(100), [event("stun", 100, { actor_id: "two", target_id: "one", amount: 60 })], 0);
    watch(director, 0, 6);
    feed(director, state(140), [event("clinch", 140, { actor_id: "one", target_id: "two" })], 7);
    expect(watch(director, 7, 12).some((text) => /hold/u.test(text) && /Azure Vector/u.test(text))).toBe(true);
  });

  it("follows a low blow with a warning", () => {
    const director = new CommentaryDirector();
    feed(director, state(100, "foul_recovery", [{ warnings: 1 }, {}]), [event("foul", 100, { actor_id: "one", target_id: "two", detail: "low_blow" })], 0);
    const lines = watch(director, 0, 12);
    expect(lines[0]).toMatch(/low|below the belt/iu);
    expect(lines.some((text) => /warn/iu.test(text))).toBe(true);
  });

  it("fades a line in and out", () => {
    const director = new CommentaryDirector();
    feed(director, state(100), [event("stun", 100, { actor_id: "two", target_id: "one", amount: 60 })], 0);
    const first = director.current(0.3)!;
    expect(first.opacity).toBe(0);
    expect(first.entering).toBe(1);
    const settled = director.current(0.7)!;
    expect(settled.opacity).toBe(1);
    expect(settled.entering).toBe(0);
    const end = 0.3 + settled.line.hold;
    expect(director.current(end - 0.1)!.opacity).toBeCloseTo(0.4);
    expect(director.current(end + 0.01)).toBeNull();
  });
});

describe("crowd tension", () => {
  it("rises for a hurt fighter, a fighter pinned on the ropes and a long count", () => {
    expect(crowdTension(state(1))).toBe(0);
    expect(crowdTension(state(1, "fight", [{}, { stunned_ticks: 10 }]))).toBe(0.75);
    expect(crowdTension(state(1, "fight", [{}, { poise: 100 }]))).toBe(0.45);
    expect(crowdTension(state(1, "fight", [{ x: 360, y: 0 }, { x: 470, y: 0 }]))).toBe(0.4);
    expect(crowdTension(state(1, "fight", [{ x: 0, y: 0 }, { x: 470, y: 0 }]))).toBe(0);
    expect(crowdTension(state(1, "knockdown", [{}, { is_downed: true, get_up_count: 5 }]))).toBeCloseTo(0.65);
    expect(crowdTension(state(1, "rest", [{}, { stunned_ticks: 10 }]))).toBe(0);
  });
});
