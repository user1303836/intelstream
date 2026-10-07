export const PROTOCOL_VERSION = 4 as const;
export const MAX_SERVER_FRAME_BYTES = 65_536;

export type Hand = "left" | "right";
export type PunchClass = "jab" | "straight" | "hook" | "uppercut";
export type Target = "head" | "body";
export type Power = "normal" | "power";
export type Stance = "orthodox" | "southpaw";
export type FighterStyle = "balanced" | "boxer" | "slugger" | "swarmer" | "counter_puncher";
export type DefensivePose = "none" | "guard_high" | "guard_low" | "slip_left" | "slip_right" | "weave" | "pull";
export type HeldDefense = "none" | "guard_high" | "guard_low";
export type CornerKind = "corner_cut" | "corner_swelling" | "corner_breath";
export type MovementKind = "slip_left" | "slip_right" | "weave" | "pull" | "clinch" | "switch_stance" | "get_up_left" | "get_up_right" | "taunt" | CornerKind;
/** What the corner did between rounds: the fighter's instruction, or the balanced treatment at the bell when none came. */
export type CornerChoice = "cut" | "swelling" | "breath" | "balanced";
export type ActionKind = "punch" | MovementKind | "foul";
export type Foul = "low_blow" | "headbutt";
export type MatchPhase = "countdown" | "fight" | "knockdown" | "foul_recovery" | "rest" | "complete";
export type FinishMethod = "ko" | "flash_ko" | "tko" | "doctor_stoppage" | "disqualification" | "decision" | "draw" | "forfeit";
export type ConnectionRole = "fighter" | "spectator";

export interface PunchAction { readonly kind: "punch"; readonly hand: Hand; readonly class: PunchClass; readonly target: Target; readonly power: Power; readonly id?: string }
export interface MovementAction { readonly kind: MovementKind; readonly id?: string }
export interface FoulAction { readonly kind: "foul"; readonly foul: Foul; readonly id?: string }
export type SemanticAction = PunchAction | MovementAction | FoulAction;
export interface InputFrame { readonly moveX: number; readonly moveY: number; readonly defense: HeldDefense; readonly actions: readonly SemanticAction[] }

export type CpuLevel = "rookie" | "contender" | "champion";
/** `cpu` marks the computer opponent, which plays unrated bouts. */
export interface FighterRecord { readonly wins: number; readonly losses: number; readonly draws: number; readonly knockouts: number }
export interface PublicPlayer { readonly id: string; readonly name: string; readonly avatar: string | null; readonly rating: number; readonly connected: boolean; readonly cpu?: boolean; readonly record?: FighterRecord; readonly style?: FighterStyle }
export interface TraumaSnapshot { readonly head: number; readonly body: number; readonly left_eye: number; readonly right_eye: number; readonly left_cut: number; readonly right_cut: number; readonly swelling: number; readonly bleeding: number }
export interface FighterSnapshot {
  readonly player_id: string; readonly x: number; readonly y: number; readonly facing: number;
  readonly facing_x: number; readonly facing_y: number;
  readonly velocity_x: number; readonly velocity_y: number; readonly stance: Stance; readonly style: FighterStyle; readonly defense: DefensivePose;
  readonly stamina: number; readonly maximum_stamina: number; readonly conditioning: number; readonly guard: number;
  readonly poise: number; readonly trauma: TraumaSnapshot; readonly knockdowns: number; readonly warnings: number;
  readonly deductions: number; readonly stunned_ticks: number; readonly is_downed: boolean;
  readonly action: PunchClass | null; readonly action_hand: Hand | null; readonly action_target: Target | null;
  readonly action_power: Power | null;
  readonly action_id: string | null;
  readonly action_key: string | null;
  readonly action_start_tick: number;
  readonly action_startup_ticks: number;
  readonly action_active_ticks: number;
  readonly action_recovery_ticks: number;
  readonly action_contact_tick: number | null;
  readonly queued_actions: number; readonly clinch_startup_ticks: number;
  readonly clinch_ticks: number; readonly is_foul_recovery_target: boolean;
  readonly taunt_ticks: number;
  readonly corner_choice: CornerChoice | null;
  readonly get_up_prompt: "get_up_left" | "get_up_right" | null;
  readonly get_up_meter: number; readonly get_up_required: number; readonly get_up_count: number;
  readonly get_up_window_start_tick: number; readonly get_up_window_end_tick: number;
  readonly last_input_sequence: number;
}
export interface CombatEvent { readonly event_id: number; readonly tick: number; readonly kind: string; readonly actor_id: string | null; readonly target_id: string | null; readonly amount: number; readonly detail: string; readonly blood: number; readonly direction: number; readonly action_id: string | null }
export interface JudgeCard { readonly judge: string; readonly player_one: readonly number[]; readonly player_two: readonly number[] }
export interface MatchResult {
  readonly match_id: string; readonly activity_instance_id: string; readonly guild_id: string;
  readonly player_one_id: string; readonly player_two_id: string; readonly winner_id: string | null;
  readonly finish_method: FinishMethod; readonly round_number: number; readonly tick: number;
  readonly scorecards: readonly JudgeCard[]; readonly player_one_knockdowns: number; readonly player_two_knockdowns: number;
  readonly player_one_damage: number; readonly player_two_damage: number;
}
export interface EngineSnapshot { readonly tick: number; readonly phase: MatchPhase; readonly round_number: number; readonly phase_ticks_remaining: number; readonly fighters: readonly [FighterSnapshot, FighterSnapshot]; readonly events: readonly CombatEvent[]; readonly result: MatchResult | null; readonly checksum: string }

interface WelcomeBase { readonly version: typeof PROTOCOL_VERSION; readonly type: "welcome"; readonly player_id: string; readonly players: readonly PublicPlayer[]; readonly server_tick: number; readonly reconnect_ticket?: string }
export interface FighterWelcomeMessage extends WelcomeBase { readonly role: "fighter"; readonly seat: 1 | 2; readonly rating: number; readonly next_sequence: number }
/** A spectator who arrives before the bell can find one corner, or both, still empty. */
export interface SpectatorWelcomeMessage extends WelcomeBase { readonly role: "spectator" }
export type WelcomeMessage = FighterWelcomeMessage | SpectatorWelcomeMessage;
export interface TicketMessage { readonly version: typeof PROTOCOL_VERSION; readonly type: "ticket"; readonly reconnect_ticket: string; readonly refresh_id: string }
/** A fighter waits for an opponent (one open seat); a spectator can be watching both corners fill. */
export interface WaitingMessage { readonly version: typeof PROTOCOL_VERSION; readonly type: "waiting"; readonly open_seats: 1 | 2 }
/**
 * The fighters pick their styles before the bout; `ready` lists who has settled and `connected` who
 * is here. Styles are revealed together in the ready: before it a fighter sees only his own, settled.
 */
export interface SelectMessage { readonly version: typeof PROTOCOL_VERSION; readonly type: "select"; readonly deadline_ms: number; readonly players: readonly [PublicPlayer, PublicPlayer]; readonly ready: readonly string[] }
export interface ReadyMessage { readonly version: typeof PROTOCOL_VERSION; readonly type: "ready"; readonly players: readonly [PublicPlayer, PublicPlayer] }
export interface PausedMessage { readonly version: typeof PROTOCOL_VERSION; readonly type: "paused"; readonly player_id: string; readonly grace_ms: number }
export interface ResumedMessage { readonly version: typeof PROTOCOL_VERSION; readonly type: "resumed"; readonly player_id: string }
export interface SnapshotMessage { readonly version: typeof PROTOCOL_VERSION; readonly type: "snapshot"; readonly payload: EngineSnapshot }
export interface RatingDelta { readonly before: number; readonly after: number }
/** A fighter's punches over the whole bout as the engine counted them; landed means clean, not blocked. */
export interface PunchTotals { readonly thrown: number; readonly landed: number; readonly jabs_thrown: number; readonly jabs_landed: number }
export interface FinalMessage { readonly version: typeof PROTOCOL_VERSION; readonly type: "final"; readonly match_id: string; readonly winner_id: string | null; readonly method: FinishMethod; readonly round: number; readonly scorecards: readonly JudgeCard[]; readonly ratings: Readonly<Record<string, RatingDelta>>; readonly punches?: Readonly<Record<string, PunchTotals>> }
export interface ErrorMessage { readonly version: typeof PROTOCOL_VERSION; readonly type: "error"; readonly code: string }
export type ServerMessage = WelcomeMessage | TicketMessage | WaitingMessage | SelectMessage | ReadyMessage | PausedMessage | ResumedMessage | SnapshotMessage | FinalMessage | ErrorMessage;

export interface SimulationInfo { readonly tick_rate: number; readonly ring_half_width: number; readonly ring_half_height: number }
export interface BootstrapResponse { readonly client_id: string; readonly state: string; readonly protocol: typeof PROTOCOL_VERSION; readonly simulation: SimulationInfo }
export interface TokenPlayer { readonly id: string; readonly name: string; readonly avatar: string | null; readonly rating: number }
export interface TokenResponse { readonly access_token: string; readonly ticket: string; readonly player: TokenPlayer }
