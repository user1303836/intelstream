import manifest from "../../../../src/intelstream/hands/combat-manifest.json";
import { ROCKED_BASE_TICKS, ROCKED_MAX_TICKS } from "../manifest";
import { FIGHTER_STYLES } from "../protocol";
import { fighter } from "../test/fixtures";
import type { CombatEvent, EngineSnapshot, FighterSnapshot, FinalMessage, MatchPhase, PublicPlayer } from "../types";
import { CommentaryDirector, crowdTension, fillLine, holdFor, introductionScript, punchName, recordSpoken, spokenNumber, spokenSeconds, type CommentaryHooks } from "./commentary";

/** The opening countdown the room gives the introductions, in ticks. */
const OPENING_TICKS = manifest.countdown.opening_ticks;

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
  it("introduces both corners during the opening countdown, reading each one as its card comes up", () => {
    const speak = vi.fn();
    const director = new CommentaryDirector({ speak });
    feed(director, state(1, "countdown", [{}, {}], { phase_ticks_remaining: OPENING_TICKS }), [], 0);
    expect(speak).not.toHaveBeenCalled();
    const blue = director.current(0);
    expect(blue?.line.card).toEqual({ kicker: "IN THE BLUE CORNER", title: "AZURE VECTOR", detail: "RATED 1512", corner: 0 });
    expect(speak.mock.calls).toEqual([[["In the blue corner, Azure Vector!"]]]);
    // The red card comes up as the blue corner's line ends, and its line is read with it.
    const redAt = spokenSeconds("In the blue corner, Azure Vector!");
    expect(director.current(redAt - 0.05)?.line.card?.corner).toBe(0);
    expect(speak).toHaveBeenCalledOnce();
    const red = director.current(redAt + 0.01);
    expect(red?.line.card).toMatchObject({ kicker: "IN THE RED CORNER", title: "CRIMSON GEOMETRY", corner: 1 });
    expect(speak.mock.calls.at(-1)).toEqual([["And in the red corner, Crimson Geometry!"]]);
    // Both are read before the opening bell, with room to spare for a slower voice.
    expect(redAt + spokenSeconds("And in the red corner, Crimson Geometry!")).toBeLessThanOrEqual(OPENING_TICKS / 30 - 0.3);
  });

  it("keeps the records and styles on the cards, and reads them before the names only when the countdown has the time", () => {
    const speak = vi.fn();
    const director = new CommentaryDirector({ speak });
    const recorded = { one: { ...players.one!, record: { wins: 12, losses: 3, draws: 1, knockouts: 8 } }, two: { ...players.two!, record: { wins: 0, losses: 0, draws: 0, knockouts: 0 } } };
    director.observe({ ...state(1, "countdown", [{ style: "boxer" }, { style: "swarmer" }], { phase_ticks_remaining: OPENING_TICKS }), events: [] }, [], recorded, 30, 0);
    expect(watch(director, 0, 8)).toEqual(["In the blue corner, Azure Vector.", "In the red corner, Crimson Geometry."]);
    const cards = new CommentaryDirector();
    cards.observe({ ...state(1, "countdown", [{ style: "boxer" }, { style: "swarmer" }], { phase_ticks_remaining: OPENING_TICKS }), events: [] }, [], recorded, 30, 0);
    expect(cards.current(0.05)?.line.card?.detail).toBe("BOXER · 12-3-1 (8 KO) · RATED 1512");
    expect(cards.current(5)?.line.card?.detail).toBe("SWARMER · PRO DEBUT · RATED 1494");
    // Eight seconds hold the names; the bell would cut a record or a style off before them.
    expect(speak.mock.calls.flatMap((call) => call[0] as string[])).toEqual(["In the blue corner, Azure Vector!", "And in the red corner, Crimson Geometry!"]);
    const corners = [{ name: "Azure Vector", record: recorded.one.record, style: "boxer" }, { name: "Crimson Geometry", record: recorded.two.record, style: "swarmer" }] as const;
    expect(introductionScript(corners, 20)).toEqual([
      "In the blue corner, twelve, three and one, eight by knockout, the boxer... Azure Vector!",
      "And in the red corner, making a pro debut, the swarmer... Crimson Geometry!",
    ]);
    expect(introductionScript([{ ...corners[0], record: undefined, style: "slugger" }, { ...corners[1], record: undefined, style: "balanced" }], 10)).toEqual([
      "In the blue corner, the slugger... Azure Vector!",
      "And in the red corner, Crimson Geometry!",
    ]);
  });

  it("fits the spoken introductions inside the opening countdown, names and all, for every pairing the room can make", () => {
    const names = ["Kid Cole", "Azure Vector", "Crimson Geometry", "Viktor 'Iron' Volkov", "Marcus 'Hammer' Reed", "W".repeat(32)];
    const records = [undefined, { wins: 0, losses: 0, draws: 0, knockouts: 0 }, { wins: 12, losses: 3, draws: 1, knockouts: 8 }, { wins: 36, losses: 1, draws: 0, knockouts: 29 }];
    const styles = [undefined, ...FIGHTER_STYLES];
    const budget = OPENING_TICKS / 30 - 0.3;
    for (const blue of names) for (const red of names) for (const record of records) for (const style of styles) {
      const script = introductionScript([{ name: blue, record, style }, { name: red, record, style }], OPENING_TICKS / 30);
      expect(script.length).toBeGreaterThan(0);
      expect(script.reduce((total, line) => total + spokenSeconds(line), 0)).toBeLessThanOrEqual(budget);
      expect(script.join(" ")).toContain(`${blue}`);
      expect(script.join(" ")).toContain(`${red}!`);
    }
    // The computer is introduced from its own corner, from the first snapshot of the countdown a player sees.
    const contender = { name: "Marcus 'Hammer' Reed", record: { wins: 19, losses: 5, draws: 1, knockouts: 12 }, style: "swarmer" } as const;
    expect(introductionScript([{ name: "Azure Vector", record: records[1], style: "boxer" }, contender], (OPENING_TICKS - 1) / 30)).toEqual(["In the blue corner, Azure Vector!", "And in the red corner, Marcus 'Hammer' Reed!"]);
    // A late arrival with too little countdown left hears nothing rather than half a name.
    expect(introductionScript([{ name: "Azure Vector", record: undefined, style: undefined }, { name: "Crimson Geometry", record: undefined, style: undefined }], 3)).toEqual([]);
  });

  it("estimates the announcer's voice on the slow side", () => {
    // Seconds Windows' default voice (Microsoft David, SAPI rate 0) takes; the page reads at 0.96.
    const timed: Array<[string, number]> = [
      ["In the blue corner, Azure Vector!", 2.95],
      ["And in the red corner, Crimson Geometry!", 3.54],
      ["And in the red corner, Viktor 'Iron' Volkov!", 3.6],
      ["Azure Vector... versus Crimson Geometry!", 3.7],
      ["In the blue corner, twelve and three, eight by knockout, the boxer... Azure Vector!", 7.15],
      ["And in the red corner, thirty-six and one, twenty-nine by knockout, the counter-puncher... Viktor 'Iron' Volkov!", 8.76],
    ];
    for (const [line, seconds] of timed) expect(spokenSeconds(line)).toBeGreaterThanOrEqual(seconds / 0.96);
  });

  it("says a record the way a ring announcer does", () => {
    expect([7, 19, 20, 29, 36, 104, 120, 999, 1000].map(spokenNumber)).toEqual(["seven", "nineteen", "twenty", "twenty-nine", "thirty-six", "one hundred and four", "one hundred and twenty", "nine hundred and ninety-nine", "1000"]);
    expect(recordSpoken({ wins: 0, losses: 0, draws: 0, knockouts: 0 })).toBe("making a pro debut");
    expect(recordSpoken({ wins: 12, losses: 0, draws: 0, knockouts: 8 })).toBe("twelve and oh, eight by knockout");
    expect(recordSpoken({ wins: 19, losses: 5, draws: 1, knockouts: 12 })).toBe("nineteen, five and one, twelve by knockout");
    expect(recordSpoken({ wins: 36, losses: 1, draws: 0, knockouts: 29 }, false)).toBe("thirty-six and one");
    expect(recordSpoken({ wins: 3, losses: 4, draws: 0, knockouts: 0 })).toBe("three and four");
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

  it("leaves the bell unsaid rather than calling it seconds late", () => {
    const director = new CommentaryDirector();
    feed(director, state(3590), [hit(3590, "one", "hook:head", 120)], 0);
    const first = director.current(0.4)!.line;
    feed(director, state(3595, "knockdown", [{}, { is_downed: true }]), [event("knockdown", 3595, { actor_id: "one", target_id: "two", amount: 1 })], 0.45);
    feed(director, state(3600, "rest"), [event("bell", 3600, { detail: "round_end" })], 0.5);
    const lines = watch(director, 0.5, 12);
    expect(first.text).toMatch(/hook/u);
    expect(lines.some((text) => /round 1/u.test(text))).toBe(false);
  });

  it("drops the count lines once the fighter is up and the introductions at the bell", () => {
    const director = new CommentaryDirector();
    feed(director, state(100, "knockdown", [{}, { is_downed: true }]), [event("knockdown", 100, { actor_id: "one", target_id: "two", amount: 1 })], 0);
    feed(director, state(280, "knockdown", [{}, { is_downed: true }]), [event("count", 280, { target_id: "two", amount: 6 })], 6);
    feed(director, state(281, "fight"), [event("get_up", 281, { actor_id: "two", amount: 6 })], 6.05);
    expect(watch(director, 6, 14).some((text) => /beat the count|get up\?|trying to/u.test(text))).toBe(false);
    const intro = new CommentaryDirector();
    feed(intro, state(1, "countdown", [{}, {}], { phase_ticks_remaining: 240 }), [], 0);
    expect(intro.current(0.05)?.line.card).not.toBeNull();
    feed(intro, state(241, "fight"), [event("bell", 241, { detail: "round_start" })], 0.5);
    expect(intro.current(1)).toBeNull();
    expect(watch(intro, 1, 10).some((text) => text.startsWith("In the"))).toBe(false);
  });

  it("never asks whether a fighter who is up can beat the count while the referee counts on to the eight", () => {
    // The engine's order: a count a second, the rise, the mandatory count on to eight with the phase still the
    // knockdown's, two seconds for the referee's look, then the box. Snapshots at 30 Hz, the screen at 60 Hz.
    const struggle = /struggling to get up|trying to beat the count|get up\?/u;
    for (const rise of [1, 2, 3, 4, 5, 6, 7]) {
      for (const offset of [2, 12, 25]) {
        const director = new CommentaryDirector();
        const knockdown = 300;
        const risen = knockdown + rise * 30 + offset;
        const box = knockdown + 8 * 30 + 60;
        const afterRise: string[] = [];
        let called = false;
        for (let tick = knockdown; tick <= box + 90; tick += 1) {
          const now = (tick - knockdown) / 30;
          const count = Math.floor((tick - knockdown) / 30);
          const events: CombatEvent[] = [];
          if (tick === knockdown) events.push(event("knockdown", tick, { actor_id: "one", target_id: "two", amount: 1 }));
          if (tick > knockdown && (tick - knockdown) % 30 === 0 && count <= 8 && (tick < risen || count > rise)) events.push(event("count", tick, { target_id: "two", amount: count }));
          if (tick === risen) events.push(event("get_up", tick, { actor_id: "two", amount: rise }));
          if (tick === box) events.push(event("box", tick, { target_id: "two" }));
          feed(director, state(tick, tick < box ? "knockdown" : "fight", [{}, { is_downed: tick < risen }]), events, now);
          for (const at of [now, now + 1 / 60]) {
            const text = director.current(at)?.line.text ?? "";
            called ||= struggle.test(text);
            // A line on screen at the rise is given the fade to go.
            if (at >= (risen - knockdown) / 30 + 0.3 && struggle.test(text)) afterRise.push(text);
          }
        }
        expect(afterRise, `up at ${rise}`).toEqual([]);
        // Down for the six, he is still asked about while he is on the canvas.
        if (rise >= 6 && offset === 25) expect(called, `up at ${rise}`).toBe(true);
      }
    }
  });

  it("introduces the computer as the computer, not by a rating", () => {
    const director = new CommentaryDirector();
    const computer = { ...players, two: { ...players.two!, cpu: true, record: { wins: 19, losses: 5, draws: 1, knockouts: 12 } } };
    director.observe({ ...state(1, "countdown", [{}, {}], { phase_ticks_remaining: 90 }), events: [] }, [], computer, 30, 0);
    expect(director.current(0.05)?.line.card?.detail).toBe("RATED 1512");
    expect(director.current(1.6)?.line.card?.detail).toBe("19-5-1 (12 KO) · COMPUTER");
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

  it("does not call a big shot that the guard took", () => {
    const blocked = new CommentaryDirector();
    const block = event("block", 100, { actor_id: "two", target_id: "one", action_id: "p1" });
    const leaked = { ...hit(100, "one", "hook:head", 70, "counter_hit"), action_id: "p1" };
    feed(blocked, state(100), [block, leaked], 0);
    expect(watch(blocked, 0, 4).some((text) => /counter|Big|thudding|flush|felt/u.test(text))).toBe(false);
    const clean = new CommentaryDirector();
    feed(clean, state(100), [{ ...hit(100, "one", "hook:head", 70, "counter_hit"), action_id: "p2" }], 0);
    expect(watch(clean, 0, 4).some((text) => /counter|Big|thudding|flush|felt/u.test(text))).toBe(true);
  });

  it("notices an eye swelling and calls it shut only when the engine says it has closed", () => {
    const director = new CommentaryDirector();
    const eye = (left_eye: number): Partial<FighterSnapshot> => ({ trauma: { ...fighter("two").trauma, left_eye } });
    feed(director, state(100, "fight", [{}, eye(520)]), [], 0);
    const early = watch(director, 0, 4);
    expect(early.some((text) => /Crimson Geometry/u.test(text) && /left eye/u.test(text) && /swelling|trouble seeing/u.test(text))).toBe(true);
    feed(director, state(400, "fight", [{}, eye(760)]), [], 10);
    expect(watch(director, 10, 14).some((text) => /closed|shut|one eye/u.test(text))).toBe(false);
    feed(director, state(430, "fight", [{}, eye(780)]), [event("eye_shut", 430, { actor_id: "one", target_id: "two", detail: "left" })], 20);
    expect(watch(director, 20, 24).some((text) => /closed|shut|one eye/u.test(text))).toBe(true);
  });

  it("sends them back to it after the eight count", () => {
    const director = new CommentaryDirector();
    feed(director, state(200, "knockdown"), [event("box", 200, { target_id: "two" })], 0);
    const lines = watch(director, 0, 4);
    expect(lines.some((text) => /Crimson Geometry|Azure Vector/u.test(text) && /referee|Box|Here comes/u.test(text))).toBe(true);
  });

  it("calls the blind side, a parry and the corner's work", () => {
    const blind = new CommentaryDirector();
    feed(blind, state(100), [event("blind_side", 100, { actor_id: "one", target_id: "two", detail: "left" })], 0);
    expect(watch(blind, 0, 4).some((text) => /blind side|can't see|left eye/u.test(text))).toBe(true);
    const parry = new CommentaryDirector();
    feed(parry, state(100), [event("parry", 100, { actor_id: "one", target_id: "two", amount: 20 })], 0);
    expect(watch(parry, 0, 4).some((text) => /^(Azure Vector picks|Beautiful parry from Azure Vector|Azure Vector slaps)/u.test(text))).toBe(true);
    for (const [pick, pattern] of [["cut", /cut/u], ["swelling", /swelling|enswell/u], ["breath", /breath/u]] as const) {
      const corner = new CommentaryDirector();
      feed(corner, state(100, "rest"), [event("corner", 100, { actor_id: "two", detail: pick })], 0);
      expect(watch(corner, 0, 4).some((text) => /Crimson Geometry/u.test(text) && pattern.test(text))).toBe(true);
    }
  });

  it("calls a body shot folding a fighter and the knockdown it causes", () => {
    const director = new CommentaryDirector();
    feed(director, state(100), [event("body_collapse", 100, { actor_id: "one", target_id: "two", amount: 10 })], 0);
    expect(watch(director, 0, 3).some((text) => /body/iu.test(text) && /Crimson Geometry/u.test(text))).toBe(true);
    const down = new CommentaryDirector();
    feed(down, state(110, "knockdown", [{}, { is_downed: true }]), [event("knockdown", 110, { actor_id: "one", target_id: "two", amount: 1, detail: "body" })], 0);
    expect(watch(down, 0, 3).some((text) => /body shot|takes a knee|downstairs/u.test(text))).toBe(true);
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
