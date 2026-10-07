import type { CombatEvent, EngineSnapshot, FighterSnapshot, FinalMessage, PublicPlayer } from "../types";
import { decisionLabel } from "./hud";

export type Speaker = "play" | "colour" | "announcer";

/** An announcer's card: a small kicker over a name or a verdict, in a corner's colour when it presents a fighter. */
export interface AnnouncerCard {
  readonly kicker: string;
  readonly title: string;
  readonly detail: string;
  readonly corner: 0 | 1 | null;
}

export interface BroadcastLine {
  readonly speaker: Speaker;
  readonly text: string;
  readonly priority: number;
  /** Cuts in over a lesser line and skips the pause between lines. */
  readonly urgent: boolean;
  /** Seconds on screen. */
  readonly hold: number;
  readonly card: AnnouncerCard | null;
}

export interface Caption {
  readonly line: BroadcastLine;
  /** 0 to 1 through the fade in and out. */
  readonly opacity: number;
  /** 1 on the first frame of the entrance, 0 once it has settled. */
  readonly entering: number;
}

export type CrowdCue = "chant";

export interface CommentaryHooks {
  /** Lines for the announcer's voice, in order. */
  readonly speak?: (lines: readonly string[]) => void;
  readonly cue?: (cue: CrowdCue) => void;
}

/** The broadcast team (fictional) as named on the caption. */
export const BROADCAST_VOICES: Readonly<Record<Speaker, string>> = { play: "CALLAHAN", colour: "OKAFOR", announcer: "RING ANNOUNCER" };

/** Lines appear a beat after the action, as a commentator reacts. */
const REACTION_SECONDS = 0.3;
const GAP_SECONDS = 0.9;
const FADE_SECONDS = 0.25;
const STALE_SECONDS = 2.6;
const URGENT_STALE_SECONDS = 4.5;
/** An urgent line may cut in once the line on screen has been up this long. */
const PREEMPT_AFTER_SECONDS = 0.8;
const MAX_QUEUE = 6;
const ANNOUNCER_HOLD_SECONDS = 9;
const SCORECARDS_HOLD_SECONDS = 6;

const COMBO_GAP_TICKS = 42;
const JAB_WINDOW_SECONDS = 8;
const TAKEOVER_WINDOW_SECONDS = 15;
const EVASION_WINDOW_SECONDS = 10;
const CUT_MARKS = [60, 420, 560] as const;
const EYE_SHUT = 640;
const TIRED_RATIO = 0.2;
const RECOVERED_RATIO = 0.3;
const HURT_POISE = 120;

const LINES = {
  knockdown: ["Down goes {b}!", "{a} drops {b}!", "{b} is down! What a shot from {a}!", "Down goes {b}! {a} found the chin!"],
  knockdownAgain: ["{b} is down again!", "Down for the second time! {b} is in deep trouble!", "{a} puts {b} down again!"],
  knockdownCounter: ["Down goes {b}, off a perfect counter!", "{a} times it, and {b} is down!"],
  struggle: ["{b} is struggling to get up...", "{b} is trying to beat the count...", "Can {b} get up?"],
  upLate: ["{b} beats the count at {n}!", "Up at {n}! {b} is still in this!", "{b} makes it up at {n}, but the legs look heavy."],
  upEarly: ["{b} is up at {n}.", "{b} is back up at the count of {n}.", "Up at {n}. {b} wants to keep fighting."],
  finishCall: ["{a} has to go for the finish now.", "{b} needs to survive the next minute.", "{b} has to hold and clear the head."],
  hurt: ["{b} is hurt!", "{a} has {b} in trouble!", "{b}'s legs just buckled!", "Big shot! {b} is wobbled!", "{b} is rocked! Keep the pressure on, {a}!"],
  hurtBadly: ["{b} is out on their feet!", "{b} is in all sorts of trouble!", "{b} is badly hurt!"],
  guardBreak: ["{a} blasts right through the guard!", "The guard is gone! {b} can't keep those hands up!", "{a} breaks the guard down!"],
  counter: ["What a counter from {a}!", "{a} times it perfectly! A {punch} on the counter!", "{b} walked right into that {punch}!", "Counter {punch} from {a}! Beautiful timing."],
  bigShot: ["Big {punch} from {a}!", "{a} lands a thudding {punch}!", "That {punch} landed flush!", "Huge {punch}! {b} felt that one."],
  cut: ["{b} is cut over the {side} eye.", "There's blood now. A cut over {b}'s {side} eye.", "That's opened a cut over the {side} eye of {b}."],
  cutWorse: ["That cut over {b}'s {side} eye is getting worse.", "The blood is pouring from that {side} eye now.", "{b} is bleeding badly from the {side} eye."],
  cutDoctor: ["The doctor will be watching that cut very closely.", "If that cut gets any worse, the doctor could stop this."],
  eyeShut: ["{b}'s {side} eye is swelling shut.", "{b} can barely see out of that {side} eye."],
  combo: ["A three-punch combination from {a}!", "{a} puts it together beautifully.", "Lovely combination from {a}!"],
  unanswered: ["Five unanswered punches from {a}!", "{a} is unloading! {b} has to fire back!", "{b} is just covering up as {a} lets the hands go!"],
  jab: ["{a}'s jab is finding a home.", "Stiff jab from {a}, and another.", "{a} keeps popping that jab in {b}'s face."],
  body: ["{a} is going to work on the body.", "{a} keeps digging to the body.", "Another one downstairs from {a}."],
  payoff: ["The body work is paying off. {b} is slowing down.", "Those body shots are taking it out of {b}.", "{a} has invested in the body, and {b} is paying for it now."],
  tiring: ["{b} is running on empty.", "{b} is breathing hard. Those punches have nothing on them.", "{b} has punched out. The tank is empty."],
  takeover: ["{a} is taking over this round.", "This is all {a} right now.", "{a} is in complete control."],
  clinch: ["{a} ties {b} up.", "{a} grabs hold.", "They're tied up in the clinch."],
  holdingOn: ["{a} is hurt and holding on!", "{a} grabs on for dear life!", "Smart from {a}, holding on to clear the head."],
  refBreak: ["The referee breaks them.", "The referee steps in to separate them.", "Break! The referee pulls them apart."],
  taunt: ["{a} drops the hands and invites {b} in!", "Showboating from {a}! The crowd loves it.", "{a} is taunting {b} now!", "{a} sticks the chin out. Come and get it!"],
  lowBlow: ["Low blow from {a}! The referee steps in.", "That's below the belt! {b} is doubled over.", "{a} goes low, and the referee calls time."],
  headbutt: ["Headbutt from {a}! The referee calls time.", "{a} leads with the head! That's a foul."],
  warning: ["A warning for {a}. One more and it costs a point.", "The referee warns {a}. That can't happen again."],
  deduction: ["The referee takes a point from {a}!", "That costs {a} a point!", "Point deduction! {a} has been warned enough."],
  resume: ["And we're back underway.", "Time in. Let's box."],
  evade: ["{a} slips it! Lovely head movement.", "{b} misses, and {a} was never there.", "Great defence from {a}."],
  parry: ["{a} picks that off with the gloves.", "{a} parries it away.", "Tight defence from {a}."],
  whiff: ["{a} misses wildly with the {punch}.", "Big swing and a miss from {a}.", "{a} throws everything into that {punch} and hits nothing but air."],
  southpaw: ["{a} switches to southpaw.", "{a} turns southpaw now."],
  orthodox: ["{a} goes back to orthodox.", "{a} switches back to orthodox."],
  roundStart: ["Round {r}. Here we go.", "We're underway in round {r}.", "Round {r} is on."],
  roundEnd: ["That's the bell to end round {r}.", "The bell ends round {r}.", "And that's round {r} in the books."],
  savedByBell: ["Saved by the bell! {b} was in real trouble.", "{b} is saved by the bell!", "The bell rescues {b}!"],
  finalBell: ["That's the final bell!", "The final bell! We go to the scorecards."],
  summary: ["Round {r}: {a} landed {x} of {y}, {b} {z} of {w}."],
  roundFor: ["I had that round for {a}.", "{a} took that round.", "That was {a}'s round."],
  roundBig: ["The knockdown makes that a big round for {a}.", "{a} wins that round big with the knockdown."],
  roundClose: ["Close round. That one could go either way.", "Tough round to score.", "Nothing between them in that round."],
  pullingAway: ["{a} is pulling away on the cards.", "{b} needs something big. {a} is building a lead."],
  doctor: ["The ringside doctor is taking a close look at {b}.", "The doctor is in {b}'s corner checking that cut."],
  ko: ["It's all over! {a} wins by knockout!", "{b} can't beat the count! {a} wins it!", "That's it! {a} has knocked out {b}!"],
  flashKo: ["Lights out! {b} is out cold!", "One punch, and it's over! {a} wins!", "Good night! {a} ends it with one shot!"],
  tko: ["Three knockdowns, and it's over! {a} wins!", "The referee waves it off! {a} wins by stoppage!"],
  doctorStop: ["The doctor has seen enough! It's stopped on the cut!", "The doctor stops it! {b} can't continue!"],
  disqualified: ["{b} is disqualified!", "That's it! {b} has been thrown out!"],
  forfeit: ["{b} has left the ring. {a} wins by forfeit."],
  replay: ["Here it is again.", "Let's see that one more time.", "Watch {a} set it up..."],
} as const satisfies Record<string, readonly string[]>;

type LineKey = keyof typeof LINES;

const RESULT_LINES: Readonly<Partial<Record<string, LineKey>>> = { ko: "ko", flash_ko: "flashKo", tko: "tko", doctor_stoppage: "doctorStop", disqualification: "disqualified", forfeit: "forfeit" };

const URGENT: ReadonlySet<LineKey> = new Set<LineKey>(["knockdown", "knockdownAgain", "knockdownCounter", "upLate", "upEarly", "hurt", "hurtBadly", "lowBlow", "headbutt", "deduction", "ko", "flashKo", "tko", "doctorStop", "disqualified", "forfeit", "replay", "savedByBell", "finalBell", "roundEnd", "roundStart"]);

/** Knockdowns over hurt fighters over big counters over cuts over combinations over colour. */
const PRIORITY: Readonly<Record<LineKey, number>> = {
  ko: 98, flashKo: 98, tko: 98, doctorStop: 98, disqualified: 98, forfeit: 98,
  knockdown: 95, knockdownAgain: 95, knockdownCounter: 95, upLate: 90, upEarly: 90, replay: 88,
  deduction: 84, lowBlow: 82, headbutt: 82, hurt: 80, hurtBadly: 80, holdingOn: 76, savedByBell: 74, finalBell: 72, struggle: 70,
  guardBreak: 65, counter: 60, bigShot: 55, roundEnd: 52, cut: 50, cutWorse: 50, summary: 50, cutDoctor: 48, doctor: 48, eyeShut: 48,
  roundFor: 46, roundBig: 46, roundClose: 46, pullingAway: 46, unanswered: 45, finishCall: 44, warning: 42,
  combo: 40, payoff: 40, takeover: 38, body: 35, jab: 30, tiring: 30, roundStart: 28, taunt: 25, parry: 22, evade: 20, clinch: 20,
  whiff: 18, refBreak: 12, southpaw: 10, orthodox: 10, resume: 10,
};

const SPEAKER: Readonly<Partial<Record<LineKey, Speaker>>> = {
  finishCall: "colour", payoff: "colour", tiring: "colour", takeover: "colour", holdingOn: "colour", taunt: "colour", parry: "colour", evade: "colour",
  warning: "colour", roundFor: "colour", roundBig: "colour", roundClose: "colour", pullingAway: "colour", doctor: "colour", cutDoctor: "colour", jab: "colour",
};

/** Seconds before the same kind of line about the same fighter may come again. */
const COOLDOWN: Readonly<Partial<Record<LineKey, number>>> = {
  combo: 6, jab: 20, body: 18, evade: 12, parry: 15, whiff: 12, clinch: 15, refBreak: 20, taunt: 10, southpaw: 15, orthodox: 15, bigShot: 4, counter: 3, unanswered: 15, takeover: 25,
};

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen"] as const;
const numberWord = (value: number): string => NUMBER_WORDS[value] ?? String(value);

type Vars = Partial<Record<"a" | "b" | "n" | "side" | "punch" | "r" | "x" | "y" | "z" | "w", string | number>>;

export function fillLine(template: string, vars: Vars): string {
  const text = template.replace(/\{(a|b|n|side|punch|r|x|y|z|w)\}/gu, (_match, key: keyof Vars) => String(vars[key] ?? ""));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const mix = (seed: number, salt: number): number => {
  let value = Math.imul((seed | 0) ^ Math.imul(salt, 0x9e3779b1), 0x85ebca6b);
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2ae35);
  return (value ^ (value >>> 16)) >>> 0;
};

/** Class and target from a hit's detail ("hook:head"), ignoring any leading hand. */
export function punchParts(detail: string): [string | undefined, string | undefined] {
  const parts = detail.split(":");
  return [parts.at(-2), parts.at(-1)];
}

/** The punch as a commentator names it: "jab", "right hook", "left hand to the body". */
export function punchName(detail: string, puncher: FighterSnapshot | undefined): string {
  const [punchClass = "punch", target = "head"] = punchParts(detail);
  const hand = puncher !== undefined && puncher.action === punchClass ? puncher.action_hand : null;
  const base = punchClass === "jab"
    ? "jab"
    : punchClass === "straight"
      ? hand === null ? "straight" : `${hand} hand`
      : hand === null ? punchClass : `${hand} ${punchClass}`;
  return target === "body" ? `${base} to the body` : base;
}

/** How loud the crowd should murmur: a fighter hurt, a fighter pinned on the ropes, a count running. */
export function crowdTension(snapshot: EngineSnapshot): number {
  if (snapshot.phase === "knockdown") {
    const count = Math.max(...snapshot.fighters.map((fighter) => fighter.get_up_count));
    return Math.min(1, 0.3 + count * 0.07);
  }
  if (snapshot.phase !== "fight") return 0;
  let tension = 0;
  for (const [index, fighter] of snapshot.fighters.entries()) {
    const other = snapshot.fighters[1 - index]!;
    if (fighter.is_downed) continue;
    if (fighter.stunned_ticks > 0) tension = Math.max(tension, 0.75);
    else if (fighter.poise < HURT_POISE + 30) tension = Math.max(tension, 0.45);
    const onRopes = Math.max(Math.abs(fighter.x), Math.abs(fighter.y)) > 400 || Math.abs(fighter.x) + Math.abs(fighter.y) > 640;
    if (onRopes && Math.hypot(fighter.x - other.x, fighter.y - other.y) < 150) tension = Math.max(tension, 0.4);
  }
  return tension;
}

interface Queued {
  line: BroadcastLine;
  at: number;
  expires: number;
  moment: string | null;
}

interface Showing {
  line: BroadcastLine;
  start: number;
  end: number;
  moment: string | null;
}

interface RoundTally {
  thrown: number;
  landed: number;
  damage: number;
  knockdowns: number;
  body: number;
}

interface FighterNotes {
  jabs: number[];
  window: number[];
  evasions: number[];
  run: number;
  runTick: number;
  unanswered: number;
  stunnedAt: number;
  knockedDownAt: number;
  lowSince: number | null;
  tiredRound: number;
  takeoverRound: number;
  payoffRound: number;
  cutMarks: [number, number];
  eyeShut: [boolean, boolean];
  rounds: number;
}

const blankTally = (): RoundTally => ({ thrown: 0, landed: 0, damage: 0, knockdowns: 0, body: 0 });
const blankNotes = (): FighterNotes => ({ jabs: [], window: [], evasions: [], run: 0, runTick: -1000, unanswered: 0, stunnedAt: -1000, knockedDownAt: -100_000, lowSince: null, tiredRound: 0, takeoverRound: 0, payoffRound: 0, cutMarks: [0, 0], eyeShut: [false, false], rounds: 0 });

/**
 * The broadcast team: turns the fight's events into a paced stream of lines from a play-by-play caller,
 * a colour analyst and the ring announcer. Deterministic for the same events and clock.
 */
export class CommentaryDirector {
  private readonly queue: Queued[] = [];
  private showing: Showing | null = null;
  private lastEnd = -Infinity;
  private readonly lastChoice = new Map<string, number>();
  private readonly cooldowns = new Map<string, number>();
  private readonly notes = new Map<string, FighterNotes>();
  private readonly tallies = new Map<string, RoundTally>();
  private players: Readonly<Record<string, PublicPlayer>> = {};
  private fighters: readonly [FighterSnapshot, FighterSnapshot] | null = null;
  private tickRate = 30;
  private introduced = false;
  private lastPhase: string | null = null;
  private round = 0;
  private roundLength: { round: number; ticks: number } | null = null;
  private fightRemaining = 0;
  private struggleCalled = -1;
  private lastKnockdown: { actor: string | null; target: string | null; tick: number } | null = null;
  private final: FinalMessage | null = null;
  private verdictGiven = false;
  private resultCalled = false;
  private readonly caption = { line: null as unknown as BroadcastLine, opacity: 0, entering: 0 };

  constructor(private readonly hooks: CommentaryHooks = {}) {}

  /** Takes a snapshot and the events it brought that have not been seen before. */
  observe(snapshot: EngineSnapshot, events: readonly CombatEvent[], players: Readonly<Record<string, PublicPlayer>>, tickRate: number, now: number): void {
    this.players = players;
    this.fighters = snapshot.fighters;
    this.tickRate = tickRate;
    this.trackClock(snapshot);
    if (!this.introduced) {
      this.introduced = true;
      if (snapshot.phase === "countdown" && snapshot.round_number === 1) this.introduce(snapshot, now);
    }
    const result = events.find((event) => event.kind === "result") ?? null;
    for (const event of events) this.consider(event, snapshot, result, now);
    this.inspect(snapshot, now);
    this.lastPhase = snapshot.phase;
  }

  /** The bout's result has arrived. A decision opens with the announcer going to the scorecards. */
  finish(final: FinalMessage, players: Readonly<Record<string, PublicPlayer>>, ceremony: boolean, now: number): void {
    this.players = players;
    this.final = final;
    if (ceremony) {
      this.enqueue(this.announcement("Ladies and gentlemen, we go to the scorecards.", { kicker: "LADIES AND GENTLEMEN", title: "WE GO TO THE SCORECARDS", detail: "", corner: null }, SCORECARDS_HOLD_SECONDS, 99), now, null, 30);
      this.hooks.speak?.(["Ladies and gentlemen, we go to the scorecards."]);
    }
    if (final.method === "forfeit" && !this.resultCalled && final.winner_id !== null) {
      this.resultCalled = true;
      this.say("forfeit", final.round, now, { a: this.nameOf(final.winner_id), b: this.nameOf(this.otherId(final.winner_id)) }, "result", 0);
    }
  }

  /** The referee raises the winner's arm (or both arms after a draw). */
  verdict(now: number): void {
    const final = this.final;
    if (final === null || this.verdictGiven) return;
    this.verdictGiven = true;
    const label = decisionLabel(final);
    if (final.winner_id === null) {
      const text = `After ${numberWord(final.round)} rounds, this bout is scored a ${label.toLowerCase()}.`;
      this.enqueue(this.announcement(text, { kicker: `AFTER ${numberWord(final.round).toUpperCase()} ROUNDS`, title: label, detail: "", corner: null }, ANNOUNCER_HOLD_SECONDS, 100), now, "verdict", 30);
      this.hooks.speak?.([text]);
      return;
    }
    const name = this.nameOf(final.winner_id);
    const method = label.toLowerCase();
    this.enqueue(this.announcement(`The winner, by ${method}: ${name}!`, { kicker: `THE WINNER, BY ${label}`, title: name.toUpperCase(), detail: "", corner: this.seatOf(final.winner_id) }, ANNOUNCER_HOLD_SECONDS, 100), now, "verdict", 30);
    this.hooks.speak?.([`And the winner, by ${method}... ${name}!`]);
  }

  /** The result card is on screen. A bout that did not go to the cards gets its announcement now. */
  resultShown(now: number): void {
    const final = this.final;
    if (final === null || this.verdictGiven) return;
    if (final.method === "decision" || final.method === "draw") {
      this.verdict(now);
      return;
    }
    this.verdictGiven = true;
    if (final.winner_id === null) return;
    const name = this.nameOf(final.winner_id);
    const how = ({ ko: "knockout", flash_ko: "knockout", tko: "technical knockout", doctor_stoppage: "doctor stoppage", disqualification: "disqualification", forfeit: "forfeit" } as Partial<Record<string, string>>)[final.method] ?? final.method.replaceAll("_", " ");
    const clock = this.stoppageClock(final.round);
    const stopped = final.method === "ko" || final.method === "flash_ko" || final.method === "tko" || final.method === "doctor_stoppage";
    const kicker = stopped && clock !== null ? `STOPPED AT ${clock} OF ROUND ${final.round}` : `ROUND ${final.round}`;
    const text = stopped && clock !== null ? `${name} wins by ${how} at ${clock} of round ${final.round}.` : `${name} wins by ${how} in round ${final.round}.`;
    this.enqueue(this.announcement(text, { kicker, title: name.toUpperCase(), detail: `WINS BY ${how.toUpperCase()}`, corner: this.seatOf(final.winner_id) }, ANNOUNCER_HOLD_SECONDS, 100), now, "verdict", 30);
    const opening = stopped && clock !== null ? `The referee stops the contest at ${clock} of round ${numberWord(final.round)}. ` : "";
    this.hooks.speak?.([`${opening}Your winner, by ${how}... ${name}!`]);
  }

  /** The knockout replay has started. */
  replay(now: number): void {
    const knockdown = this.lastKnockdown;
    this.say("replay", knockdown?.tick ?? 0, now, { a: this.nameOf(knockdown?.actor ?? null), b: this.nameOf(knockdown?.target ?? null) }, "replay", 0.6, 6);
  }

  /** The line on screen at `now`, or null. Reuses one object, so read it before the next call. */
  current(now: number): Caption | null {
    for (let index = this.queue.length - 1; index >= 0; index -= 1) if (this.queue[index]!.expires <= now) this.queue.splice(index, 1);
    if (this.showing !== null && now >= this.showing.end) {
      this.lastEnd = this.showing.end;
      this.showing = null;
    }
    let best: Queued | null = null;
    for (const entry of this.queue) {
      if (entry.at > now) continue;
      if (best === null || entry.line.priority > best.line.priority || (entry.line.priority === best.line.priority && entry.at < best.at)) best = entry;
    }
    if (best !== null) {
      const showing = this.showing;
      const start = showing === null
        ? best.line.urgent || now >= this.lastEnd + GAP_SECONDS
        : best.line.urgent && best.line.priority > showing.line.priority && now - showing.start >= PREEMPT_AFTER_SECONDS;
      if (start) {
        this.queue.splice(this.queue.indexOf(best), 1);
        this.showing = { line: best.line, start: now, end: now + best.line.hold, moment: best.moment };
      }
    }
    const showing = this.showing;
    if (showing === null) return null;
    this.caption.line = showing.line;
    this.caption.opacity = Math.max(0, Math.min(1, (now - showing.start) / FADE_SECONDS, (showing.end - now) / FADE_SECONDS));
    this.caption.entering = Math.max(0, 1 - (now - showing.start) / FADE_SECONDS);
    return this.caption;
  }

  private trackClock(snapshot: EngineSnapshot): void {
    if (snapshot.phase === "fight") {
      if (this.lastPhase === "countdown" || this.lastPhase === "rest") this.roundLength = { round: snapshot.round_number, ticks: snapshot.phase_ticks_remaining + 1 };
      this.fightRemaining = snapshot.phase_ticks_remaining;
    }
    if (snapshot.round_number !== this.round) {
      this.round = snapshot.round_number;
      this.tallies.clear();
    }
  }

  /** "m:ss" into the round when the bout was stopped, when this client saw the round begin. */
  private stoppageClock(round: number): string | null {
    const length = this.roundLength;
    if (length === null || length.round !== round) return null;
    const seconds = Math.max(0, Math.floor((length.ticks - this.fightRemaining) / this.tickRate));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  private introduce(snapshot: EngineSnapshot, now: number): void {
    const seconds = snapshot.phase_ticks_remaining / this.tickRate;
    if (seconds < 1.2) return;
    const hold = Math.max(1.4, seconds / 2);
    const names = snapshot.fighters.map((fighter) => this.nameOf(fighter.player_id));
    for (const seat of [0, 1] as const) {
      const corner = seat === 0 ? "blue" : "red";
      const player = this.players[snapshot.fighters[seat].player_id];
      this.enqueue(this.announcement(`In the ${corner} corner, ${names[seat]}.`, { kicker: `IN THE ${corner.toUpperCase()} CORNER`, title: names[seat]!.toUpperCase(), detail: player === undefined ? "" : `RATED ${player.rating}`, corner: seat }, hold, 97), now + seat * hold, null, 30);
    }
    this.hooks.speak?.([`In the blue corner... ${names[0]}!`, `And in the red corner... ${names[1]}!`]);
  }

  private consider(event: CombatEvent, snapshot: EngineSnapshot, result: CombatEvent | null, now: number): void {
    const actor = event.actor_id;
    const target = event.target_id;
    const moment = `${event.tick}:${target ?? actor ?? ""}`;
    const names = { a: this.nameOf(actor), b: this.nameOf(target) };
    switch (event.kind) {
      case "punch_start":
        if (actor !== null) this.tally(actor).thrown += 1;
        return;
      case "hit":
      case "counter_hit":
        if (actor !== null && target !== null) this.landed(event, actor, target, snapshot, now);
        return;
      case "stun": {
        if (target === null) return;
        this.notesFor(target).stunnedAt = event.tick;
        const hurt = this.fighter(target);
        const badly = hurt !== undefined && (hurt.poise < HURT_POISE || hurt.stunned_ticks >= 45);
        this.say(badly ? "hurtBadly" : "hurt", event.event_id, now, names, moment);
        return;
      }
      case "guard_break":
        this.say("guardBreak", event.event_id, now, names, moment);
        return;
      case "knockdown": {
        if (target === null) return;
        this.lastKnockdown = { actor, target, tick: event.tick };
        this.notesFor(target).knockedDownAt = event.tick;
        if (actor !== null) this.tally(actor).knockdowns += 1;
        if (result !== null) return;
        const countered = snapshot.events.some((other) => other.kind === "counter_hit" && other.tick === event.tick && other.target_id === target);
        this.say(event.amount >= 2 ? "knockdownAgain" : countered ? "knockdownCounter" : "knockdown", event.event_id, now, names, moment);
        return;
      }
      case "count":
        if (event.amount >= 6 && this.struggleCalled !== this.lastKnockdown?.tick) {
          this.struggleCalled = this.lastKnockdown?.tick ?? event.tick;
          this.say("struggle", event.event_id, now, { a: this.nameOf(this.otherId(target)), b: this.nameOf(target) }, moment);
        }
        return;
      case "get_up": {
        const up = { a: this.nameOf(this.otherId(actor)), b: this.nameOf(actor), n: numberWord(event.amount) };
        this.say(event.amount >= 8 ? "upLate" : "upEarly", event.event_id, now, up, moment);
        this.say("finishCall", event.event_id, now, up, null, 3.4, 4);
        return;
      }
      case "perfect_block":
        this.say("parry", event.event_id, now, names, moment, REACTION_SECONDS, undefined, actor);
        return;
      case "evade": {
        if (actor === null) return;
        const notes = this.notesFor(actor);
        notes.evasions = notes.evasions.filter((tick) => tick > event.tick - EVASION_WINDOW_SECONDS * this.tickRate);
        notes.evasions.push(event.tick);
        if (this.fighter(target)?.action_power === "power" || notes.evasions.length >= 3) {
          if (this.say("evade", event.event_id, now, names, moment, REACTION_SECONDS, undefined, actor)) notes.evasions.length = 0;
        }
        return;
      }
      case "whiff": {
        const puncher = this.fighter(actor);
        if (puncher?.action_power !== "power" || puncher.action === null) return;
        this.say("whiff", event.event_id, now, { ...names, punch: punchName(`${puncher.action}:${puncher.action_target ?? "head"}`, puncher) }, moment, REACTION_SECONDS, undefined, actor);
        return;
      }
      case "clinch": {
        if (actor === null) return;
        const holder = this.fighter(actor);
        const hurt = event.tick - this.notesFor(actor).stunnedAt <= 3 * this.tickRate || (holder !== undefined && holder.poise < HURT_POISE + 30);
        this.say(hurt ? "holdingOn" : "clinch", event.event_id, now, names, moment, REACTION_SECONDS, undefined, actor);
        return;
      }
      case "referee_break":
        this.say("refBreak", event.event_id, now, names, null, REACTION_SECONDS, undefined, "referee");
        return;
      case "taunt":
        this.say("taunt", event.event_id, now, { a: names.a, b: this.nameOf(this.otherId(actor)) }, moment, REACTION_SECONDS, undefined, actor);
        return;
      case "foul": {
        this.say(event.detail === "headbutt" ? "headbutt" : "lowBlow", event.event_id, now, names, moment);
        if (this.fighter(actor)?.warnings === 1) this.say("warning", event.event_id, now, names, null, 3.6, 4);
        return;
      }
      case "point_deduction":
        this.say("deduction", event.event_id, now, names, `deduction:${event.tick}`);
        return;
      case "resume":
        this.say("resume", event.event_id, now, names, null);
        return;
      case "stance":
        this.say(event.detail === "southpaw" ? "southpaw" : "orthodox", event.event_id, now, names, null, REACTION_SECONDS, undefined, actor);
        return;
      case "exhausted":
        if (actor !== null) this.tired(actor, event.event_id, now);
        return;
      case "bell":
        if (event.detail === "round_start") {
          this.tallies.clear();
          if (snapshot.round_number >= 2) this.say("roundStart", event.event_id, now, { r: snapshot.round_number }, null);
        } else if (event.detail === "round_end") {
          this.roundEnded(event, snapshot, result, now);
        }
        return;
      case "result":
        this.resulted(event, now);
        return;
      default:
        return;
    }
  }

  private landed(event: CombatEvent, actor: string, target: string, snapshot: EngineSnapshot, now: number): void {
    const [punchClass, area] = punchParts(event.detail);
    const tally = this.tally(actor);
    tally.landed += 1;
    tally.damage += event.amount;
    if (area === "body") tally.body += 1;
    const notes = this.notesFor(actor);
    const other = this.notesFor(target);
    other.run = 0;
    other.unanswered = 0;
    notes.run = event.tick - notes.runTick <= COMBO_GAP_TICKS ? notes.run + 1 : 1;
    notes.runTick = event.tick;
    notes.unanswered += 1;
    notes.window = notes.window.filter((tick) => tick > event.tick - TAKEOVER_WINDOW_SECONDS * this.tickRate);
    notes.window.push(event.tick);
    const moment = `${event.tick}:${target}`;
    const puncher = snapshot.fighters.find((fighter) => fighter.player_id === actor);
    const names = { a: this.nameOf(actor), b: this.nameOf(target), punch: punchName(event.detail, puncher) };
    const powered = puncher?.action_power === "power" && puncher.action === punchClass;
    if (event.kind === "counter_hit" && event.amount >= 40) this.say("counter", event.event_id, now, names, moment, REACTION_SECONDS, undefined, actor);
    else if (event.amount >= 85 || (powered && area === "head" && event.amount >= 60)) this.say("bigShot", event.event_id, now, names, moment, REACTION_SECONDS, undefined, actor);
    if (notes.unanswered === 5) this.say("unanswered", event.event_id, now, names, moment, REACTION_SECONDS, undefined, actor);
    else if (notes.run === 3) this.say("combo", event.event_id, now, names, moment, REACTION_SECONDS, undefined, actor);
    if (punchClass === "jab") {
      notes.jabs = notes.jabs.filter((tick) => tick > event.tick - JAB_WINDOW_SECONDS * this.tickRate);
      notes.jabs.push(event.tick);
      if (notes.jabs.length >= 3 && this.say("jab", event.event_id, now, names, null, REACTION_SECONDS, undefined, actor)) notes.jabs.length = 0;
    }
    if (area === "body") {
      const struck = this.fighter(target);
      if (struck !== undefined && tally.body >= 5 && struck.stamina < struck.maximum_stamina * 0.35 && notes.payoffRound !== snapshot.round_number) {
        notes.payoffRound = snapshot.round_number;
        this.say("payoff", event.event_id, now, names, null);
      } else if (tally.body === 4 || tally.body === 8) {
        this.say("body", event.event_id, now, names, null, REACTION_SECONDS, undefined, actor);
      }
    }
    const theirs = other.window.filter((tick) => tick > event.tick - TAKEOVER_WINDOW_SECONDS * this.tickRate).length;
    if (notes.window.length >= 7 && theirs <= 2 && notes.takeoverRound !== snapshot.round_number) {
      notes.takeoverRound = snapshot.round_number;
      if (this.say("takeover", event.event_id, now, names, null, REACTION_SECONDS, undefined, actor)) this.hooks.cue?.("chant");
    }
  }

  private roundEnded(event: CombatEvent, snapshot: EngineSnapshot, result: CombatEvent | null, now: number): void {
    const round = snapshot.round_number;
    if (result !== null) {
      if (result.detail === "decision" || result.detail === "draw") this.say("finalBell", event.event_id, now, {}, "bell");
      return;
    }
    const saved = snapshot.fighters.find((fighter) => {
      const notes = this.notesFor(fighter.player_id);
      return fighter.stunned_ticks > 0 || fighter.poise < HURT_POISE || event.tick - notes.knockedDownAt <= 12 * this.tickRate;
    });
    if (saved !== undefined) this.say("savedByBell", event.event_id, now, { b: this.nameOf(saved.player_id) }, "bell");
    else this.say("roundEnd", event.event_id, now, { r: round }, "bell");
    const [one, two] = snapshot.fighters.map((fighter) => ({ id: fighter.player_id, tally: this.tally(fighter.player_id) })) as [{ id: string; tally: RoundTally }, { id: string; tally: RoundTally }];
    const [lead, trail] = one.tally.landed >= two.tally.landed ? [one, two] : [two, one];
    if (lead.tally.thrown + trail.tally.thrown > 0) this.sayAt("summary", event.event_id, now + 2.4, { r: round, a: this.nameOf(lead.id), x: lead.tally.landed, y: lead.tally.thrown, b: this.nameOf(trail.id), z: trail.tally.landed, w: trail.tally.thrown }, 5);
    const edge = (one.tally.knockdowns - two.tally.knockdowns) * 1000 + (one.tally.damage - two.tally.damage) + 6 * (one.tally.landed - two.tally.landed);
    const close = Math.abs(edge) < Math.max(20, 0.12 * (one.tally.damage + two.tally.damage));
    const winner = close ? null : edge > 0 ? one : two;
    if (winner !== null) this.notesFor(winner.id).rounds += 1;
    const loser = winner === null ? null : winner === one ? two : one;
    const margin = winner === null || loser === null ? 0 : this.notesFor(winner.id).rounds - this.notesFor(loser.id).rounds;
    const opinion: LineKey = winner === null ? "roundClose" : one.tally.knockdowns !== two.tally.knockdowns ? "roundBig" : round >= 2 && margin >= 2 ? "pullingAway" : "roundFor";
    this.sayAt(opinion, event.event_id, now + 6.4, { a: this.nameOf(winner?.id ?? null), b: this.nameOf(loser?.id ?? null) }, 5);
    const cut = snapshot.fighters.find((fighter) => Math.max(fighter.trauma.left_cut, fighter.trauma.right_cut) >= 450 || fighter.trauma.swelling >= 650);
    if (cut !== undefined) this.sayAt("doctor", event.event_id, now + 10, { b: this.nameOf(cut.player_id) }, 4);
  }

  private resulted(event: CombatEvent, now: number): void {
    const key = RESULT_LINES[event.detail];
    if (key === undefined || this.resultCalled) return;
    this.resultCalled = true;
    const winner = event.actor_id;
    this.say(key, event.event_id, now, { a: this.nameOf(winner), b: this.nameOf(this.otherId(winner)) }, "result", 0);
  }

  /** Cuts, swelling and fatigue show in the fighters' state rather than in events. */
  private inspect(snapshot: EngineSnapshot, now: number): void {
    if (snapshot.phase !== "fight") return;
    for (const fighter of snapshot.fighters) {
      const notes = this.notesFor(fighter.player_id);
      const name = { a: this.nameOf(this.otherId(fighter.player_id)), b: this.nameOf(fighter.player_id) };
      for (const [eye, side] of [[0, "left"], [1, "right"]] as const) {
        const cut = eye === 0 ? fighter.trauma.left_cut : fighter.trauma.right_cut;
        const mark = notes.cutMarks[eye];
        if (mark < CUT_MARKS.length && cut >= CUT_MARKS[mark]!) {
          notes.cutMarks[eye] = CUT_MARKS.filter((threshold) => cut >= threshold).length;
          this.say(mark === 0 ? "cut" : mark === 1 ? "cutWorse" : "cutDoctor", snapshot.tick + eye, now, { ...name, side }, null);
        }
        const swelling = eye === 0 ? fighter.trauma.left_eye : fighter.trauma.right_eye;
        if (!notes.eyeShut[eye] && swelling >= EYE_SHUT) {
          notes.eyeShut[eye] = true;
          this.say("eyeShut", snapshot.tick + eye, now, { ...name, side }, null);
        }
      }
      const ratio = fighter.stamina / Math.max(1, fighter.maximum_stamina);
      if (ratio < TIRED_RATIO) {
        notes.lowSince ??= snapshot.tick;
        if (snapshot.tick - notes.lowSince >= 2 * this.tickRate) this.tired(fighter.player_id, snapshot.tick, now);
      } else if (ratio >= RECOVERED_RATIO) {
        notes.lowSince = null;
      }
    }
  }

  private tired(playerId: string, seed: number, now: number): void {
    const notes = this.notesFor(playerId);
    if (notes.tiredRound === this.round) return;
    notes.tiredRound = this.round;
    this.say("tiring", seed, now, { a: this.nameOf(this.otherId(playerId)), b: this.nameOf(playerId) }, null);
  }

  /** Queues a line unless it is cooling down; true when queued. */
  private say(key: LineKey, seed: number, now: number, vars: Vars, moment: string | null, delay = REACTION_SECONDS, expiresAfter?: number, subject?: string | null): boolean {
    const cooldown = COOLDOWN[key];
    const coolKey = `${key}:${subject ?? ""}`;
    if (cooldown !== undefined) {
      if (now < (this.cooldowns.get(coolKey) ?? -Infinity)) return false;
      this.cooldowns.set(coolKey, now + cooldown);
    }
    const text = fillLine(this.choose(key, seed), vars);
    const line: BroadcastLine = { speaker: SPEAKER[key] ?? "play", text, priority: PRIORITY[key], urgent: URGENT.has(key), hold: holdFor(text), card: null };
    return this.enqueue(line, now + delay, moment, expiresAfter);
  }

  private sayAt(key: LineKey, seed: number, at: number, vars: Vars, expiresAfter: number): void {
    const text = fillLine(this.choose(key, seed), vars);
    this.enqueue({ speaker: SPEAKER[key] ?? "play", text, priority: PRIORITY[key], urgent: URGENT.has(key), hold: holdFor(text), card: null }, at, null, expiresAfter);
  }

  private announcement(text: string, card: AnnouncerCard, hold: number, priority: number): BroadcastLine {
    return { speaker: "announcer", text, priority, urgent: true, hold, card };
  }

  /** A different phrasing each time, chosen from the event so every viewer hears the same call. */
  private choose(key: LineKey, seed: number): string {
    const options: readonly string[] = LINES[key];
    let index = mix(seed, key.length * 31 + key.charCodeAt(0)) % options.length;
    if (options.length > 1 && this.lastChoice.get(key) === index) index = (index + 1) % options.length;
    this.lastChoice.set(key, index);
    return options[index]!;
  }

  private enqueue(line: BroadcastLine, at: number, moment: string | null, expiresAfter?: number): boolean {
    if (moment !== null) {
      if (this.queue.some((entry) => entry.moment === moment && entry.line.priority >= line.priority)) return false;
      if (this.showing?.moment === moment && this.showing.line.priority >= line.priority) return false;
      for (let index = this.queue.length - 1; index >= 0; index -= 1) if (this.queue[index]!.moment === moment) this.queue.splice(index, 1);
    }
    this.queue.push({ line, at, expires: at + (expiresAfter ?? (line.urgent ? URGENT_STALE_SECONDS : STALE_SECONDS)), moment });
    if (this.queue.length > MAX_QUEUE) {
      let lowest = 0;
      for (let index = 1; index < this.queue.length; index += 1) if (this.queue[index]!.line.priority < this.queue[lowest]!.line.priority) lowest = index;
      this.queue.splice(lowest, 1);
    }
    return true;
  }

  private tally(playerId: string): RoundTally {
    let tally = this.tallies.get(playerId);
    if (tally === undefined) {
      tally = blankTally();
      this.tallies.set(playerId, tally);
    }
    return tally;
  }

  private notesFor(playerId: string): FighterNotes {
    let notes = this.notes.get(playerId);
    if (notes === undefined) {
      notes = blankNotes();
      this.notes.set(playerId, notes);
    }
    return notes;
  }

  private fighter(playerId: string | null): FighterSnapshot | undefined {
    return playerId === null ? undefined : this.fighters?.find((fighter) => fighter.player_id === playerId);
  }

  private otherId(playerId: string | null): string | null {
    const fighters = this.fighters;
    if (fighters === null || playerId === null) return null;
    return fighters[0].player_id === playerId ? fighters[1].player_id : fighters[1].player_id === playerId ? fighters[0].player_id : null;
  }

  private seatOf(playerId: string): 0 | 1 | null {
    const seat = this.fighters?.findIndex((fighter) => fighter.player_id === playerId) ?? -1;
    return seat === 0 || seat === 1 ? seat : null;
  }

  private nameOf(playerId: string | null): string {
    if (playerId === null) return "the fighter";
    const name = this.players[playerId]?.name;
    if (name !== undefined && name.trim().length > 0) return name.trim();
    const seat = this.seatOf(playerId);
    return seat === 0 ? "the blue corner" : seat === 1 ? "the red corner" : "the fighter";
  }
}

/** Long enough to read: a little over a second plus a beat per word. */
export function holdFor(text: string): number {
  return Math.min(5.2, Math.max(2.2, 1.4 + text.length * 0.05));
}
