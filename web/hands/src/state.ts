import type { EngineSnapshot, FinalMessage, PublicPlayer, ServerMessage, SimulationInfo, TokenPlayer } from "./types";

export type AppStage = "bootstrapping" | "authorizing" | "connecting" | "waiting" | "countdown" | "fight" | "knockdown" | "foul_recovery" | "rest" | "paused" | "complete" | "fatal";
export interface GameState {
  readonly stage: AppStage;
  readonly player: TokenPlayer | null;
  readonly playerId: string | null;
  readonly players: Readonly<Record<string, PublicPlayer>>;
  readonly simulation: SimulationInfo | null;
  readonly snapshot: EngineSnapshot | null;
  readonly final: FinalMessage | null;
  readonly serverTick: number;
  readonly nextSequence: number;
  readonly reconnectMs: number;
  readonly safeError: string | null;
}
export const initialState: GameState = { stage: "bootstrapping", player: null, playerId: null, players: {}, simulation: null, snapshot: null, final: null, serverTick: 0, nextSequence: 0, reconnectMs: 0, safeError: null };
export type StateAction = { type: "bootstrap"; simulation: SimulationInfo } | { type: "authorized"; player: TokenPlayer } | { type: "connecting" } | { type: "message"; message: ServerMessage } | { type: "reconnect-tick"; remainingMs: number } | { type: "fatal"; code: string };
const mapPlayers = (players: readonly PublicPlayer[]): Readonly<Record<string, PublicPlayer>> => Object.fromEntries(players.map((player) => [player.id, player]));

export function reduceState(state: GameState, action: StateAction): GameState {
  if (action.type === "bootstrap") return { ...state, stage: "authorizing", simulation: action.simulation, safeError: null };
  if (action.type === "authorized") return { ...state, stage: "connecting", player: action.player, safeError: null };
  if (action.type === "connecting") return { ...state, stage: "connecting" };
  if (action.type === "reconnect-tick") return { ...state, stage: "paused", reconnectMs: Math.max(0, action.remainingMs) };
  if (action.type === "fatal") return { ...state, stage: "fatal", safeError: action.code, reconnectMs: 0 };
  const message = action.message;
  switch (message.type) {
    case "welcome": return { ...state, playerId: message.player_id, players: mapPlayers(message.players), serverTick: message.server_tick, nextSequence: message.next_sequence, safeError: null };
    case "ticket": return state;
    case "waiting": return { ...state, stage: "waiting" };
    case "ready": return { ...state, stage: state.snapshot?.phase ?? "countdown", players: mapPlayers(message.players) };
    case "paused": return { ...state, stage: "paused", reconnectMs: message.grace_ms };
    case "resumed": return { ...state, stage: state.snapshot?.phase ?? "countdown", reconnectMs: 0 };
    case "snapshot": return { ...state, stage: message.payload.phase, snapshot: message.payload, serverTick: Math.max(state.serverTick, message.payload.tick) };
    case "final": return { ...state, stage: "complete", final: message, reconnectMs: 0 };
    case "error": return { ...state, stage: "fatal", safeError: message.code, reconnectMs: 0 };
  }
}
