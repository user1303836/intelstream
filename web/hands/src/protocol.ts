import {
  MAX_SERVER_FRAME_BYTES, PROTOCOL_VERSION,
  type BootstrapResponse, type CombatEvent, type DefensivePose, type EngineSnapshot,
  type FighterSnapshot, type FinalMessage, type FinishMethod, type Foul, type Hand,
  type HeldDefense, type JudgeCard, type MatchPhase, type MatchResult, type MovementKind,
  type Power, type PublicPlayer, type PunchClass, type SemanticAction, type ServerMessage,
  type Stance, type Target, type TokenResponse, type TraumaSnapshot,
} from "./types";

export class ProtocolError extends Error { override name = "ProtocolError" }
const MAX_INT = 2_147_483_647;
const encoder = new TextEncoder();
type Obj = Record<string, unknown>;

// JSON.parse accepts duplicate keys. This small grammar walk rejects them before parsing.
function rejectDuplicateKeys(text: string): void {
  let i = 0;
  const ws = (): void => { while (/\s/u.test(text[i] ?? "")) i += 1; };
  const string = (): string => {
    const start = i;
    if (text[i++] !== "\"") throw new ProtocolError("invalid JSON");
    while (i < text.length) {
      const c = text[i++];
      if (c === "\"") {
        try { return JSON.parse(text.slice(start, i)) as string; } catch { throw new ProtocolError("invalid JSON"); }
      }
      if (c === "\\") { i += 1; continue; }
      if (c !== undefined && c.charCodeAt(0) < 32) throw new ProtocolError("invalid JSON");
    }
    throw new ProtocolError("invalid JSON");
  };
  const value = (): void => {
    ws();
    const c = text[i];
    if (c === "{") {
      i += 1; ws(); const keys = new Set<string>();
      if (text[i] === "}") { i += 1; return; }
      while (true) {
        ws(); const key = string();
        if (keys.has(key)) throw new ProtocolError(`duplicate field ${key}`);
        keys.add(key); ws(); if (text[i++] !== ":") throw new ProtocolError("invalid JSON");
        value(); ws(); const end = text[i++]; if (end === "}") return; if (end !== ",") throw new ProtocolError("invalid JSON");
      }
    }
    if (c === "[") {
      i += 1; ws(); if (text[i] === "]") { i += 1; return; }
      while (true) { value(); ws(); const end = text[i++]; if (end === "]") return; if (end !== ",") throw new ProtocolError("invalid JSON"); }
    }
    if (c === "\"") { string(); return; }
    const tail = text.slice(i);
    const match = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/u.exec(tail);
    if (!match) throw new ProtocolError("invalid JSON");
    i += match[0].length;
  };
  value(); ws(); if (i !== text.length) throw new ProtocolError("invalid JSON");
}

export function parseStrictJson(frame: string | ArrayBuffer | Uint8Array): unknown {
  let bytes: Uint8Array;
  let text: string;
  if (typeof frame === "string") { bytes = encoder.encode(frame); text = frame; }
  else { bytes = frame instanceof Uint8Array ? frame : new Uint8Array(frame); text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  if (bytes.byteLength > MAX_SERVER_FRAME_BYTES) throw new ProtocolError("server frame too large");
  try { rejectDuplicateKeys(text); return JSON.parse(text) as unknown; }
  catch (error) { if (error instanceof ProtocolError) throw error; throw new ProtocolError("invalid JSON"); }
}
function object(value: unknown, name: string): Obj {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new ProtocolError(`${name} must be an object`);
  return value as Obj;
}
function exact(value: Obj, required: readonly string[], optional: readonly string[] = []): void {
  const allowed = new Set([...required, ...optional]); const keys = Object.keys(value);
  if (required.some((key) => !Object.hasOwn(value, key)) || keys.some((key) => !allowed.has(key))) throw new ProtocolError("schema mismatch");
}
function integer(value: unknown, name: string, min = 0, max = MAX_INT): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new ProtocolError(`${name} must be a bounded integer`);
  return value as number;
}
function bool(value: unknown, name: string): boolean { if (typeof value !== "boolean") throw new ProtocolError(`${name} must be boolean`); return value; }
function string(value: unknown, name: string, max = 255, min = 1): string { if (typeof value !== "string" || value.length < min || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) throw new ProtocolError(`${name} must be a bounded string`); return value; }
function nullableString(value: unknown, name: string, max = 255): string | null { return value === null ? null : string(value, name, max); }
function oneOf<T extends string>(value: unknown, values: readonly T[], name: string): T { if (typeof value !== "string" || !values.includes(value as T)) throw new ProtocolError(`invalid ${name}`); return value as T; }
function array(value: unknown, name: string, max: number): unknown[] { if (!Array.isArray(value) || value.length > max) throw new ProtocolError(`${name} must be a bounded array`); return value; }

const hands = ["left", "right"] as const; const classes = ["jab", "straight", "hook", "uppercut"] as const;
const targets = ["head", "body"] as const; const powers = ["normal", "power"] as const;
const stances = ["orthodox", "southpaw"] as const;
const defenses = ["none", "guard_high", "guard_low", "slip_left", "slip_right", "weave", "pull"] as const;
const heldDefenses = ["none", "guard_high", "guard_low"] as const;
const movementKinds = ["slip_left", "slip_right", "weave", "pull", "clinch", "switch_stance", "get_up_left", "get_up_right", "taunt"] as const;
const fouls = ["low_blow", "headbutt"] as const;
const phases = ["countdown", "fight", "knockdown", "foul_recovery", "rest", "complete"] as const;
const methods = ["ko", "flash_ko", "tko", "doctor_stoppage", "disqualification", "decision", "draw", "forfeit"] as const;

function publicPlayer(value: unknown): PublicPlayer {
  const o = object(value, "player"); exact(o, ["id", "name", "avatar", "rating", "connected"]);
  return { id: string(o.id, "player.id"), name: string(o.name, "player.name", 80), avatar: nullableString(o.avatar, "player.avatar", 128), rating: integer(o.rating, "rating"), connected: bool(o.connected, "connected") };
}
function players(value: unknown, exactLength?: number): PublicPlayer[] {
  const result = array(value, "players", 2).map(publicPlayer);
  if (result.length < 1 || (exactLength !== undefined && result.length !== exactLength) || new Set(result.map((p) => p.id)).size !== result.length) throw new ProtocolError("players must be present and distinct");
  return result;
}
function trauma(value: unknown): TraumaSnapshot {
  const o = object(value, "trauma");
  exact(o, ["head", "body", "left_eye", "right_eye", "left_cut", "right_cut", "swelling", "bleeding"]);
  return {
    head: integer(o.head, "head", 0, 1400), body: integer(o.body, "body", 0, 1200),
    left_eye: integer(o.left_eye, "left_eye", 0, 1000), right_eye: integer(o.right_eye, "right_eye", 0, 1000),
    left_cut: integer(o.left_cut, "left_cut", 0, 1000), right_cut: integer(o.right_cut, "right_cut", 0, 1000),
    swelling: integer(o.swelling, "swelling", 0, 1000), bleeding: integer(o.bleeding, "bleeding", 0, 1000),
  };
}
function fighter(value: unknown): FighterSnapshot {
  const o = object(value, "fighter");
  exact(o, [
    "player_id", "x", "y", "facing", "velocity_x", "velocity_y", "stance", "defense",
    "stamina", "maximum_stamina", "conditioning", "guard", "poise", "trauma", "knockdowns",
    "warnings", "deductions", "stunned_ticks", "is_downed", "action", "action_hand",
    "action_target", "action_power", "action_id", "action_key", "action_start_tick",
    "action_startup_ticks", "action_active_ticks", "action_recovery_ticks", "action_contact_tick",
    "queued_actions", "clinch_startup_ticks", "clinch_ticks",
    "is_foul_recovery_target", "taunt_ticks", "get_up_prompt", "get_up_meter", "get_up_required", "get_up_count",
    "get_up_window_start_tick", "get_up_window_end_tick",
  ]);
  const action = o.action === null ? null : oneOf<PunchClass>(o.action, classes, "action");
  const actionHand = o.action_hand === null ? null : oneOf<Hand>(o.action_hand, hands, "action hand");
  const actionTarget = o.action_target === null ? null : oneOf<Target>(o.action_target, targets, "action target");
  const actionPower = o.action_power === null ? null : oneOf<Power>(o.action_power, powers, "action power");
  if ([action, actionHand, actionTarget, actionPower].some((part) => part === null) && [action, actionHand, actionTarget, actionPower].some((part) => part !== null)) throw new ProtocolError("partial punch action");
  const actionId = o.action_id === null ? null : string(o.action_id, "action_id", 32);
  const actionKey = o.action_key === null ? null : string(o.action_key, "action_key", 64);
  if ([actionId, actionKey].some((part) => part === null) !== [actionId, actionKey].every((part) => part === null)) throw new ProtocolError("partial action instance");
  if (actionId !== null && action === null) throw new ProtocolError("action instance without class");
  const prompt = o.get_up_prompt === null ? null : oneOf(o.get_up_prompt, ["get_up_left", "get_up_right"] as const, "get-up prompt");
  const maximumStamina = integer(o.maximum_stamina, "maximum_stamina", 330, 1000);
  const stamina = integer(o.stamina, "stamina", 0, maximumStamina);
  const getUpRequired = integer(o.get_up_required, "get_up_required", 0, 169);
  const facing = integer(o.facing, "facing", -1, 1);
  if (facing === 0) throw new ProtocolError("invalid facing");
  if (getUpRequired !== 0 && getUpRequired < 34) throw new ProtocolError("invalid get-up requirement");
  return {
    player_id: string(o.player_id, "player_id"), x: integer(o.x, "x", -462, 462), y: integer(o.y, "y", -292, 292),
    facing, velocity_x: integer(o.velocity_x, "velocity_x", -7, 7), velocity_y: integer(o.velocity_y, "velocity_y", -7, 7),
    stance: oneOf<Stance>(o.stance, stances, "stance"), defense: oneOf<DefensivePose>(o.defense, defenses, "defense"),
    stamina, maximum_stamina: maximumStamina,
    conditioning: integer(o.conditioning, "conditioning", 0, 1000), guard: integer(o.guard, "guard", 0, 700), poise: integer(o.poise, "poise", 0, 600),
    trauma: trauma(o.trauma), knockdowns: integer(o.knockdowns, "knockdowns", 0, 3), warnings: integer(o.warnings, "warnings", 0, 3), deductions: integer(o.deductions, "deductions", 0, 1),
    stunned_ticks: integer(o.stunned_ticks, "stunned_ticks", 0, 90), is_downed: bool(o.is_downed, "is_downed"),
    action, action_hand: actionHand, action_target: actionTarget, action_power: actionPower,
    action_id: actionId,
    action_key: actionKey,
    action_start_tick: integer(o.action_start_tick, "action_start_tick", 0),
    action_startup_ticks: integer(o.action_startup_ticks, "action_startup_ticks", 0, 40),
    action_active_ticks: integer(o.action_active_ticks, "action_active_ticks", 0, 10),
    action_recovery_ticks: integer(o.action_recovery_ticks, "action_recovery_ticks", 0, 40),
    action_contact_tick: o.action_contact_tick === null ? null : integer(o.action_contact_tick, "action_contact_tick", 0),
    queued_actions: integer(o.queued_actions, "queued_actions", 0, 1), clinch_startup_ticks: integer(o.clinch_startup_ticks, "clinch_startup_ticks", 0, 8), clinch_ticks: integer(o.clinch_ticks, "clinch_ticks", 0, 45),
    is_foul_recovery_target: bool(o.is_foul_recovery_target, "is_foul_recovery_target"), taunt_ticks: integer(o.taunt_ticks, "taunt_ticks", 0, 60), get_up_prompt: prompt,
    get_up_meter: integer(o.get_up_meter, "get_up_meter", 0, 256), get_up_required: getUpRequired, get_up_count: integer(o.get_up_count, "get_up_count", 0, 10),
    get_up_window_start_tick: integer(o.get_up_window_start_tick, "get_up_window_start_tick"), get_up_window_end_tick: integer(o.get_up_window_end_tick, "get_up_window_end_tick"),
  };
}
function event(value: unknown): CombatEvent {
  const o = object(value, "event"); exact(o, ["event_id", "tick", "kind", "actor_id", "target_id", "amount", "detail", "blood", "direction", "action_id"]);
  return { event_id: integer(o.event_id, "event_id"), tick: integer(o.tick, "tick"), kind: string(o.kind, "event kind", 32), actor_id: nullableString(o.actor_id, "actor_id"), target_id: nullableString(o.target_id, "target_id"), amount: integer(o.amount, "amount", -10_000, 10_000), detail: string(o.detail, "detail", 96, 0), blood: integer(o.blood, "blood", 0, 100), direction: integer(o.direction, "direction", -1, 1), action_id: o.action_id === null ? null : string(o.action_id, "action_id", 32) };
}
function judgeCard(value: unknown): JudgeCard {
  const o = object(value, "judge card"); exact(o, ["judge", "player_one", "player_two"]);
  const scores = (raw: unknown): number[] => array(raw, "round scores", 15).map((v) => integer(v, "score", 6, 10));
  const one = scores(o.player_one), two = scores(o.player_two); if (one.length !== two.length) throw new ProtocolError("scorecard round mismatch");
  return { judge: string(o.judge, "judge", 80), player_one: one, player_two: two };
}
function scorecards(value: unknown): JudgeCard[] {
  const cards = array(value, "scorecards", 3).map(judgeCard);
  if (cards.length !== 3) throw new ProtocolError("exactly three scorecards required");
  return cards;
}
function coherentFinish(winner: string | null, method: FinishMethod): void {
  if ((method === "draw") !== (winner === null)) throw new ProtocolError("incoherent finish result");
}
function result(value: unknown): MatchResult {
  const o = object(value, "result"); exact(o, ["match_id", "activity_instance_id", "guild_id", "player_one_id", "player_two_id", "winner_id", "finish_method", "round_number", "tick", "scorecards", "player_one_knockdowns", "player_two_knockdowns", "player_one_damage", "player_two_damage"]);
  const p1 = string(o.player_one_id, "player_one_id"), p2 = string(o.player_two_id, "player_two_id"); if (p1 === p2) throw new ProtocolError("result players must be distinct");
  const winner = nullableString(o.winner_id, "winner_id"); if (winner !== null && winner !== p1 && winner !== p2) throw new ProtocolError("invalid winner");
  const method = oneOf<FinishMethod>(o.finish_method, methods, "finish method"); coherentFinish(winner, method);
  return { match_id: string(o.match_id, "match_id"), activity_instance_id: string(o.activity_instance_id, "activity_instance_id"), guild_id: string(o.guild_id, "guild_id"), player_one_id: p1, player_two_id: p2, winner_id: winner, finish_method: method, round_number: integer(o.round_number, "round", 1, 15), tick: integer(o.tick, "tick"), scorecards: scorecards(o.scorecards), player_one_knockdowns: integer(o.player_one_knockdowns, "knockdowns", 0, 3), player_two_knockdowns: integer(o.player_two_knockdowns, "knockdowns", 0, 3), player_one_damage: integer(o.player_one_damage, "damage"), player_two_damage: integer(o.player_two_damage, "damage") };
}
function snapshot(value: unknown): EngineSnapshot {
  const o = object(value, "snapshot"); exact(o, ["tick", "phase", "round_number", "phase_ticks_remaining", "fighters", "events", "result", "checksum"]);
  const fs = array(o.fighters, "fighters", 2).map(fighter); if (fs.length !== 2 || fs[0]?.player_id === fs[1]?.player_id) throw new ProtocolError("snapshot requires two distinct fighters");
  const checksum = string(o.checksum, "checksum", 64); if (!/^[a-f0-9]{64}$/u.test(checksum)) throw new ProtocolError("invalid checksum");
  return { tick: integer(o.tick, "tick"), phase: oneOf<MatchPhase>(o.phase, phases, "phase"), round_number: integer(o.round_number, "round", 1, 15), phase_ticks_remaining: integer(o.phase_ticks_remaining, "phase ticks"), fighters: [fs[0]!, fs[1]!], events: array(o.events, "events", 256).map(event), result: o.result === null ? null : result(o.result), checksum };
}

export function decodeServerFrame(frame: string | ArrayBuffer | Uint8Array): ServerMessage {
  const o = object(parseStrictJson(frame), "envelope");
  if (o.version !== PROTOCOL_VERSION) throw new ProtocolError("unsupported protocol version");
  const type = string(o.type, "type", 32);
  if (type === "welcome") {
    const role = oneOf(o.role, ["fighter", "spectator"] as const, "connection role");
    const playerId = string(o.player_id, "player_id");
    const reconnect = o.reconnect_ticket === undefined ? {} : { reconnect_ticket: string(o.reconnect_ticket, "reconnect_ticket", 4096) };
    if (role === "fighter") {
      exact(o, ["version", "type", "role", "player_id", "seat", "rating", "players", "server_tick", "next_sequence"], ["reconnect_ticket"]);
      const decodedPlayers = players(o.players);
      if (!decodedPlayers.some((player) => player.id === playerId)) throw new ProtocolError("welcome fighter is absent");
      return { version: 2, type, role, player_id: playerId, seat: integer(o.seat, "seat", 1, 2) as 1 | 2, rating: integer(o.rating, "rating"), players: decodedPlayers, server_tick: integer(o.server_tick, "server_tick"), next_sequence: integer(o.next_sequence, "next_sequence"), ...reconnect };
    }
    exact(o, ["version", "type", "role", "player_id", "players", "server_tick"], ["reconnect_ticket"]);
    const decodedPlayers = players(o.players, 2);
    if (decodedPlayers.some((player) => player.id === playerId)) throw new ProtocolError("spectator cannot be a fighter");
    return { version: 2, type, role, player_id: playerId, players: [decodedPlayers[0]!, decodedPlayers[1]!], server_tick: integer(o.server_tick, "server_tick"), ...reconnect };
  }
  if (type === "ticket") { exact(o, ["version", "type", "reconnect_ticket", "refresh_id"]); return { version: 2, type, reconnect_ticket: string(o.reconnect_ticket, "reconnect_ticket", 4096), refresh_id: string(o.refresh_id, "refresh_id", 128, 16) }; }
  if (type === "waiting") { exact(o, ["version", "type", "open_seats"]); if (o.open_seats !== 1) throw new ProtocolError("invalid open seats"); return { version: 2, type, open_seats: 1 }; }
  if (type === "ready") { exact(o, ["version", "type", "players"]); const ps = players(o.players, 2); return { version: 2, type, players: [ps[0]!, ps[1]!] }; }
  if (type === "paused") { exact(o, ["version", "type", "player_id", "grace_ms"]); return { version: 2, type, player_id: string(o.player_id, "player_id"), grace_ms: integer(o.grace_ms, "grace_ms", 0, 60_000) }; }
  if (type === "resumed") { exact(o, ["version", "type", "player_id"]); return { version: 2, type, player_id: string(o.player_id, "player_id") }; }
  if (type === "snapshot") { exact(o, ["version", "type", "payload"]); return { version: 2, type, payload: snapshot(o.payload) }; }
  if (type === "error") { exact(o, ["version", "type", "code"]); return { version: 2, type, code: string(o.code, "error code", 80) }; }
  if (type === "final") return decodeFinal(o, type);
  throw new ProtocolError("unsupported server message type");
}
function decodeFinal(o: Obj, type: "final"): FinalMessage {
  exact(o, ["version", "type", "match_id", "winner_id", "method", "round", "scorecards", "ratings"]);
  const ratingsRaw = object(o.ratings, "ratings"), entries = Object.entries(ratingsRaw); if (entries.length !== 2) throw new ProtocolError("final requires two ratings");
  const ratings = Object.create(null) as Record<string, { before: number; after: number }>;
  for (const [id, raw] of entries) { string(id, "rating player id"); const r = object(raw, "rating"); exact(r, ["before", "after"]); ratings[id] = { before: integer(r.before, "before"), after: integer(r.after, "after") }; }
  const winner = nullableString(o.winner_id, "winner_id"); if (winner !== null && !Object.hasOwn(ratings, winner)) throw new ProtocolError("winner absent from ratings");
  const method = oneOf<FinishMethod>(o.method, methods, "finish method"); coherentFinish(winner, method);
  return { version: 2, type, match_id: string(o.match_id, "match_id"), winner_id: winner, method, round: integer(o.round, "round", 1, 15), scorecards: scorecards(o.scorecards), ratings };
}

export function encodeInput(sequence: number, clientTick: number, frame: { moveX: number; moveY: number; defense: HeldDefense; actions: readonly SemanticAction[] }): string {
  const action = (raw: SemanticAction): Record<string, string> => {
    const id = raw.id === undefined ? {} : { id: raw.id.slice(0, 32) };
    if (raw.kind === "punch") return { kind: "punch", hand: oneOf<Hand>(raw.hand, hands, "hand"), class: oneOf<PunchClass>(raw.class, classes, "class"), target: oneOf<Target>(raw.target, targets, "target"), power: oneOf<Power>(raw.power, powers, "power"), ...id };
    if (raw.kind === "foul") return { kind: "foul", foul: oneOf<Foul>(raw.foul, fouls, "foul"), ...id };
    return { kind: oneOf<MovementKind>(raw.kind, movementKinds, "action"), ...id };
  };
  return JSON.stringify({ version: 2, type: "input", sequence: integer(sequence, "sequence"), client_tick: integer(clientTick, "client tick"), move: { x: Math.max(-1000, Math.min(1000, Math.round(Number.isFinite(frame.moveX) ? frame.moveX : 0))), y: Math.max(-1000, Math.min(1000, Math.round(Number.isFinite(frame.moveY) ? frame.moveY : 0))) }, defense: oneOf<HeldDefense>(frame.defense, heldDefenses, "held defense"), actions: frame.actions.slice(0, 4).map(action) });
}

export function decodeBootstrap(value: unknown): BootstrapResponse {
  const o = object(value, "bootstrap"); exact(o, ["client_id", "state", "protocol", "simulation"]); if (o.protocol !== 2) throw new ProtocolError("unsupported protocol version"); const s = object(o.simulation, "simulation"); exact(s, ["tick_rate", "ring_half_width", "ring_half_height"]);
  return { client_id: string(o.client_id, "client_id", 36), state: string(o.state, "state", 128), protocol: 2, simulation: { tick_rate: integer(s.tick_rate, "tick rate", 1, 120), ring_half_width: integer(s.ring_half_width, "ring width", 1), ring_half_height: integer(s.ring_half_height, "ring height", 1) } };
}
export function decodeToken(value: unknown): TokenResponse {
  const o = object(value, "token response"); exact(o, ["access_token", "ticket", "player"]); const p = object(o.player, "player"); exact(p, ["id", "name", "avatar", "rating"]);
  return { access_token: string(o.access_token, "access token", 4096), ticket: string(o.ticket, "ticket", 4096), player: { id: string(p.id, "id"), name: string(p.name, "name", 80), avatar: nullableString(p.avatar, "avatar", 128), rating: integer(p.rating, "rating") } };
}
