import { ClientError, safeError } from "./api";
import { decodeServerFrame, encodeCpuRequest, encodeInput, encodeStyleChoice, parseStrictJson } from "./protocol";
import { PROTOCOL_VERSION, type ConnectionRole, type CornerKind, type CpuLevel, type EngineSnapshot, type FighterStyle, type InputFrame, type ServerMessage } from "./types";

export function websocketUrl(location: Location = window.location): string {
  const url = new URL("/api/hands/ws", location.origin);
  if (location.protocol === "https:") url.protocol = "wss:";
  else if (location.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(location.hostname)) url.protocol = "ws:";
  else throw new Error("insecure_websocket_origin");
  url.search = "";
  url.hash = "";
  return url.toString();
}

export interface NetworkCallbacks {
  onMessage(message: ServerMessage): void;
  onReconnect(remainingMs: number): void;
  onFatal(code: string): void;
  onFreshAuth(): void;
}

interface SocketLike {
  readonly readyState: number;
  readonly bufferedAmount?: number;
  binaryType: BinaryType;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

type SocketFactory = (url: string) => SocketLike;
const OPEN = 1;
const NEUTRAL_INPUT: InputFrame = { moveX: 0, moveY: 0, defense: "none", actions: [] };
const INPUT_FLUSH_MS = 33;
const MIN_EDGE_SEND_GAP_MS = 8;
/** The server accepts 60 inputs a second; staying under it leaves room for frames the network bunches together. */
const MAX_SENDS_PER_SECOND = 50;
/** Edge sends have a budget of their own on top of the 30 a second flush, together under MAX_SENDS_PER_SECOND. */
const MAX_EDGE_SENDS_PER_SECOND = 20;
/** Bytes still waiting in the socket above which the connection is stalled; frames queued behind it would all land at once. */
const BACKLOG_BYTES = 2048;

/** Decodes a server frame. One that declares another protocol version means this page is out of date, not that the server misbehaved. */
function decodeFrame(data: string | ArrayBuffer): ServerMessage {
  try {
    return decodeServerFrame(data);
  } catch (error) {
    let version: unknown;
    try {
      const value = parseStrictJson(data);
      version = typeof value === "object" && value !== null && "version" in value ? value.version : undefined;
    } catch {
      // Not even JSON: the original error stands.
    }
    if (typeof version === "number" && version !== PROTOCOL_VERSION) throw new ClientError("client_outdated", true);
    throw error;
  }
}

export class NetworkController {
  private socket: SocketLike | null = null;
  private reconnectTicket: string | null;
  private reconnectTimer: number | null = null;
  private opponentPauseTimer: number | null = null;
  private inputTimer: number | null = null;
  private reconnectDeadline = 0;
  private opponentPauseDeadline = 0;
  private opponentPaused = false;
  private attempts = 0;
  private nextSequence = 0;
  private playerId: string | null = null;
  private readonly sentAt = new Map<number, number>();
  private readonly actionSequences = new Map<string, number>();
  private latencyMs: number | null = null;
  private serverTick = 0;
  private role: ConnectionRole | null = null;
  private active = false;
  private resting = false;
  /** Input has been on, so the server's engine exists and accepts a frame in any phase. */
  private boutStarted = false;
  private disposed = false;
  private terminal = false;
  private inputSuppressed = false;
  /** A pointer pressed in the page since the last blur or hidden page; it stands in for document focus. */
  private pointerFocus = false;
  private listenersBound = false;
  private lastInputSentAt = -Infinity;
  private readonly sendTimes: number[] = [];
  private readonly edgeSendTimes: number[] = [];

  constructor(
    ticket: string,
    private readonly getInput: () => InputFrame,
    private readonly callbacks: NetworkCallbacks,
    private readonly makeSocket: SocketFactory = (url) => new WebSocket(url),
    private readonly now: () => number = () => performance.now(),
  ) {
    this.reconnectTicket = ticket;
  }

  start(): void {
    if (this.disposed || this.listenersBound) return;
    this.bindInputListeners();
    this.connect();
    if (!this.disposed && !this.terminal) this.inputTimer = window.setInterval(() => this.flushInput(), INPUT_FLUSH_MS);
  }

  private bindInputListeners(): void {
    this.listenersBound = true;
    window.addEventListener("blur", this.onInputLoss);
    window.addEventListener("focus", this.onInputRegain);
    window.addEventListener("pointerdown", this.onPagePointer, true);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  setActive(active: boolean): void {
    this.setInputActive(active);
  }

  /**
   * The server keeps applying the last frame's movement and guard until the next frame arrives, and
   * none comes while input is off: one neutral frame as it goes off (the bell, a pause) stops a key
   * held at the bell from walking the fighter out at the start of the next round.
   */
  private setInputActive(active: boolean): void {
    const wasActive = this.active;
    this.active = active;
    if (active) this.boutStarted = true;
    else if (wasActive) this.sendInput(NEUTRAL_INPUT, true);
  }

  /** Sends the pending input frame on the action edge instead of waiting for the periodic flush. */
  notifyAction(): void {
    // The gap merges presses that land together. It counts edge sends only: measured from the
    // periodic flush too, a press in the 8 ms after each flush waited a whole flush period.
    if (this.now() - (this.edgeSendTimes.at(-1) ?? -Infinity) < MIN_EDGE_SEND_GAP_MS) return;
    // Past the budget the press stays queued and leaves with the next periodic flush.
    if (this.withinLastSecond(this.edgeSendTimes) >= MAX_EDGE_SENDS_PER_SECOND) return;
    if (this.flushInput()) this.edgeSendTimes.push(this.lastInputSentAt);
  }

  private sendsInLastSecond(): number {
    return this.withinLastSecond(this.sendTimes);
  }

  private withinLastSecond(times: number[]): number {
    const cutoff = this.now() - 1000;
    while (times.length > 0 && times[0]! <= cutoff) times.shift();
    return times.length;
  }

  private readonly onInputLoss = (): void => {
    if (this.inputSuppressed) return;
    // Sent while input is off too (the rest, a pause); before the bout starts the server refuses input.
    this.sendInput(NEUTRAL_INPUT, this.boutStarted);
    this.inputSuppressed = true;
    this.pointerFocus = false;
  };

  private readonly onInputRegain = (): void => {
    if (!document.hidden && document.hasFocus()) this.inputSuppressed = false;
  };

  /**
   * Inside Discord the page is a frame, and a touch may never focus it: the touch controls cancel
   * pointerdown, and the focus change with it. A pointer pressed in the page counts as focus until
   * a blur or a hidden page.
   */
  private readonly onPagePointer = (): void => {
    if (document.hidden) return;
    this.pointerFocus = true;
    this.inputSuppressed = false;
    if (document.hasFocus()) return;
    try {
      window.focus();
    } catch {
      // The host can refuse focus; the press still counts.
    }
  };

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) this.onInputLoss();
    else this.onInputRegain();
  };

  private connect(): void {
    if (this.disposed || this.terminal) return;
    const ticket = this.reconnectTicket;
    if (ticket === null) {
      this.terminal = true;
      this.stopInputLifecycle();
      this.callbacks.onFreshAuth();
      return;
    }
    let socket: SocketLike;
    try {
      socket = this.makeSocket(websocketUrl());
    } catch {
      this.terminal = true;
      this.stopInputLifecycle();
      this.callbacks.onFatal("network_unavailable");
      return;
    }
    this.socket = socket;
    socket.binaryType = "arraybuffer";
    socket.onopen = () => {
      if (this.socket !== socket || this.disposed) return;
      try {
        socket.send(JSON.stringify({ version: PROTOCOL_VERSION, type: "authenticate", ticket }));
        this.reconnectTicket = null;
      } catch {
        this.handleClose(socket);
      }
    };
    socket.onmessage = (event) => this.handleMessage(socket, event);
    socket.onerror = () => undefined;
    socket.onclose = () => this.handleClose(socket);
  }

  private handleMessage(socket: SocketLike, event: MessageEvent): void {
    if (this.socket !== socket || this.disposed || this.terminal) return;
    try {
      if (typeof event.data !== "string" && !(event.data instanceof ArrayBuffer)) throw new Error("unsupported_frame");
      const message = decodeFrame(event.data);
      this.applyMessage(message);
      if (message.type === "ticket") {
        try {
          socket.send(JSON.stringify({ version: PROTOCOL_VERSION, type: "ticket_ack", refresh_id: message.refresh_id }));
        } catch {
          this.handleClose(socket);
        }
        return;
      }
      this.callbacks.onMessage(message);
      if (message.type === "error") {
        this.terminate(message.code, socket);
      } else if (message.type === "final") {
        this.terminal = true;
        this.clearTransportReconnect(true);
        this.clearOpponentPause(true);
        this.stopInputLifecycle();
        if (this.socket === socket) this.socket = null;
        socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
        socket.close(1000, "complete");
      }
    } catch (error) {
      this.callbacks.onFatal(safeError(error));
      this.dispose();
    }
  }

  private applyMessage(message: ServerMessage): void {
    if (message.type === "welcome") {
      if (message.reconnect_ticket === undefined) throw new Error("missing_reconnect_ticket");
      this.reconnectTicket = message.reconnect_ticket;
      this.serverTick = message.server_tick;
      // A seat that opens before the bell goes to a spectator, who is welcomed again as a fighter.
      const seated = this.role === "spectator" && message.role === "fighter";
      this.role = message.role;
      this.playerId = message.role === "fighter" ? message.player_id : null;
      this.sentAt.clear();
      if (message.role === "fighter") this.nextSequence = Math.max(this.nextSequence, message.next_sequence);
      else this.stopInputLifecycle();
      if (seated) {
        if (!this.listenersBound) this.bindInputListeners();
        this.inputTimer ??= window.setInterval(() => this.flushInput(), INPUT_FLUSH_MS);
      }
      this.attempts = 0;
      this.clearTransportReconnect(true);
    } else if (message.type === "ticket") {
      this.reconnectTicket = message.reconnect_ticket;
    } else if (message.type === "snapshot") {
      this.serverTick = Math.max(this.serverTick, message.payload.tick);
      this.setInputActive(["countdown", "fight", "knockdown", "foul_recovery"].includes(message.payload.phase));
      this.resting = message.payload.phase === "rest";
      this.observeAcknowledgement(message.payload);
    } else if (message.type === "paused") {
      this.setInputActive(false);
      this.startOpponentPause(message.grace_ms);
    } else if (message.type === "resumed") {
      this.setInputActive(true);
      this.attempts = 0;
      this.clearOpponentPause(true);
    } else if (message.type === "select") {
      // A pause belongs to the bout. Before the bell the pick itself says who is connected, and an
      // empty seat at the bell comes with a fresh pause after the ready.
      this.clearOpponentPause(true);
    } else if (message.type === "ready") {
      this.clearOpponentPause(true);
      this.setInputActive(true);
    } else if (message.type === "waiting") {
      this.clearOpponentPause(true);
      this.setInputActive(false);
    } else if (message.type === "final" || message.type === "error") {
      this.active = false;
      this.clearOpponentPause(true);
    }
  }

  private terminate(code: string, socket: SocketLike): void {
    this.terminal = true;
    this.active = false;
    this.clearTransportReconnect(true);
    this.clearOpponentPause(true);
    this.stopInputLifecycle();
    this.callbacks.onFatal(code);
    if (this.socket === socket) {
      this.socket = null;
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      socket.close(1000, "terminal");
    }
  }

  private handleClose(socket: SocketLike): void {
    if (this.socket !== socket) return;
    this.socket = null;
    this.active = false;
    if (this.disposed || this.terminal) return;
    if (this.reconnectTicket === null) {
      this.terminal = true;
      this.stopInputLifecycle();
      this.callbacks.onFreshAuth();
      return;
    }
    this.clearOpponentPause(false);
    if (this.reconnectDeadline === 0) this.reconnectDeadline = this.now() + 20_000;
    const remaining = Math.max(0, this.reconnectDeadline - this.now());
    this.callbacks.onReconnect(remaining);
    if (remaining <= 0) {
      this.terminal = true;
      this.stopInputLifecycle();
      this.callbacks.onFreshAuth();
      return;
    }
    const delay = Math.min(3_000, 250 * 2 ** Math.min(this.attempts, 4), remaining);
    this.attempts += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.callbacks.onReconnect(Math.max(0, this.reconnectDeadline - this.now()));
      this.connect();
    }, delay);
  }

  /** Asks the room to put the computer in the empty seat; false when there is no open connection to ask on. */
  requestCpu(level: CpuLevel): boolean {
    const socket = this.socket;
    if (this.role !== "fighter" || this.disposed || this.terminal || socket?.readyState !== OPEN) return false;
    try {
      socket.send(encodeCpuRequest(level));
      return true;
    } catch {
      this.handleClose(socket);
      return false;
    }
  }

  /** Tells the room which style this fighter is choosing, or has settled on when `ready`. */
  chooseStyle(style: FighterStyle, ready: boolean): boolean {
    const socket = this.socket;
    if (this.role !== "fighter" || this.disposed || this.terminal || socket?.readyState !== OPEN) return false;
    try {
      socket.send(encodeStyleChoice(style, ready));
      return true;
    } catch {
      this.handleClose(socket);
      return false;
    }
  }

  /** Smoothed round trip from an input send to the first snapshot acknowledging it, in milliseconds. */
  get inputLatencyMs(): number | null {
    return this.latencyMs;
  }

  /**
   * The input sequence that carried the press with this instance id, or null before it is sent. Once
   * the fighter's last_input_sequence reaches it, the server has seen the press.
   */
  sequenceOf(actionId: string): number | null {
    return this.actionSequences.get(actionId) ?? null;
  }

  private observeAcknowledgement(snapshot: EngineSnapshot): void {
    if (this.playerId === null) return;
    const self = snapshot.fighters.find((fighter) => fighter.player_id === this.playerId);
    if (self === undefined || self.last_input_sequence < 0) return;
    const sent = this.sentAt.get(self.last_input_sequence);
    if (sent !== undefined) {
      const sample = Math.max(0, this.now() - sent);
      this.latencyMs = this.latencyMs === null ? sample : this.latencyMs * 0.8 + sample * 0.2;
    }
    for (const sequence of this.sentAt.keys()) if (sequence <= self.last_input_sequence) this.sentAt.delete(sequence);
  }

  private sendInput(frame: InputFrame, whileInactive = false): boolean {
    return (this.active || whileInactive) && this.transmit(frame);
  }

  /** Tells the corner what to work on. The rest is the one phase the input stream is off, so this frame goes on its own. */
  sendCornerChoice(kind: CornerKind): boolean {
    if (!this.resting) return false;
    return this.transmit({ moveX: 0, moveY: 0, defense: "none", actions: [{ kind }] });
  }

  private transmit(frame: InputFrame): boolean {
    const socket = this.socket;
    if (this.role !== "fighter" || this.disposed || this.terminal || socket?.readyState !== OPEN) return false;
    try {
      const actions = frame.actions.slice(0, 4);
      socket.send(encodeInput(this.nextSequence, this.serverTick, { ...frame, actions }));
      this.sentAt.set(this.nextSequence, this.now());
      if (this.sentAt.size > 128) this.sentAt.delete(this.sentAt.keys().next().value!);
      for (const action of actions) if (action.id !== undefined) this.actionSequences.set(action.id, this.nextSequence);
      while (this.actionSequences.size > 64) this.actionSequences.delete(this.actionSequences.keys().next().value!);
      this.nextSequence += 1;
      this.lastInputSentAt = this.now();
      this.sendTimes.push(this.lastInputSentAt);
      return true;
    } catch {
      this.handleClose(socket);
      return false;
    }
  }

  private flushInput(): boolean {
    if (this.inputSuppressed || document.hidden || !(this.pointerFocus || document.hasFocus())) return false;
    if (this.sendsInLastSecond() >= MAX_SENDS_PER_SECOND) return false;
    // While the connection is stalled the input stays here, current, instead of joining a queue
    // of stale frames; presses wait in the input buffer and leave with the next frame that goes.
    if ((this.socket?.bufferedAmount ?? 0) > BACKLOG_BYTES) return false;
    return this.sendInput(this.getInput());
  }

  private startOpponentPause(graceMs: number): void {
    this.clearOpponentPause(false);
    this.opponentPaused = true;
    this.opponentPauseDeadline = this.now() + graceMs;
    this.callbacks.onReconnect(graceMs);
    if (graceMs > 0) this.scheduleOpponentPauseTick();
  }

  private scheduleOpponentPauseTick(): void {
    const remaining = Math.max(0, this.opponentPauseDeadline - this.now());
    if (remaining <= 0) {
      this.opponentPauseDeadline = 0;
      this.callbacks.onReconnect(0);
      return;
    }
    this.opponentPauseTimer = window.setTimeout(() => {
      this.opponentPauseTimer = null;
      const nextRemaining = Math.max(0, this.opponentPauseDeadline - this.now());
      this.callbacks.onReconnect(nextRemaining);
      if (nextRemaining > 0) this.scheduleOpponentPauseTick();
      else this.opponentPauseDeadline = 0;
    }, Math.min(250, remaining));
  }

  private clearOpponentPause(emitZero: boolean): void {
    const wasPaused = this.opponentPaused;
    this.opponentPaused = false;
    this.opponentPauseDeadline = 0;
    if (this.opponentPauseTimer !== null) {
      clearTimeout(this.opponentPauseTimer);
      this.opponentPauseTimer = null;
    }
    if (emitZero && wasPaused) this.callbacks.onReconnect(0);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearTransportReconnect(emitZero: boolean): void {
    const wasReconnecting = this.reconnectDeadline !== 0;
    this.reconnectDeadline = 0;
    this.cancelReconnect();
    if (emitZero && wasReconnecting) this.callbacks.onReconnect(0);
  }

  private stopInputLifecycle(): void {
    if (this.inputTimer !== null) {
      clearInterval(this.inputTimer);
      this.inputTimer = null;
    }
    if (this.listenersBound) {
      window.removeEventListener("blur", this.onInputLoss);
      window.removeEventListener("focus", this.onInputRegain);
      window.removeEventListener("pointerdown", this.onPagePointer, true);
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
      this.listenersBound = false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.active = false;
    this.reconnectTicket = null;
    this.clearTransportReconnect(true);
    this.clearOpponentPause(true);
    this.stopInputLifecycle();
    const socket = this.socket;
    this.socket = null;
    if (socket !== null) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      socket.close(1000, "teardown");
    }
  }
}
