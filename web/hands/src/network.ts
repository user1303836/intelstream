import { safeError } from "./api";
import { decodeServerFrame, encodeCpuRequest, encodeInput } from "./protocol";
import { PROTOCOL_VERSION, type ConnectionRole, type CornerKind, type CpuLevel, type EngineSnapshot, type InputFrame, type ServerMessage } from "./types";

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
/** Edge sends share the window with the 30 a second flush, which must always fit so a released key is reported. */
const MAX_EDGE_SENDS_PER_SECOND = 20;
/** Bytes still waiting in the socket above which the connection is stalled; frames queued behind it would all land at once. */
const BACKLOG_BYTES = 2048;

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
  private latencyMs: number | null = null;
  private serverTick = 0;
  private role: ConnectionRole | null = null;
  private active = false;
  private resting = false;
  private disposed = false;
  private terminal = false;
  private inputSuppressed = false;
  private listenersBound = false;
  private lastInputSentAt = -Infinity;
  private readonly sendTimes: number[] = [];

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
    this.listenersBound = true;
    window.addEventListener("blur", this.onInputLoss);
    window.addEventListener("focus", this.onInputRegain);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.connect();
    if (!this.disposed && !this.terminal) this.inputTimer = window.setInterval(() => this.flushInput(), INPUT_FLUSH_MS);
  }

  setActive(active: boolean): void {
    this.active = active;
  }

  /** Sends the pending input frame on the action edge instead of waiting for the periodic flush. */
  notifyAction(): void {
    if (this.now() - this.lastInputSentAt < MIN_EDGE_SEND_GAP_MS) return;
    // Past the budget the press stays queued and leaves with the next periodic flush.
    if (this.sendsInLastSecond() >= MAX_EDGE_SENDS_PER_SECOND) return;
    this.flushInput();
  }

  private sendsInLastSecond(): number {
    const cutoff = this.now() - 1000;
    while (this.sendTimes.length > 0 && this.sendTimes[0]! <= cutoff) this.sendTimes.shift();
    return this.sendTimes.length;
  }

  private readonly onInputLoss = (): void => {
    if (this.inputSuppressed) return;
    this.sendInput(NEUTRAL_INPUT);
    this.inputSuppressed = true;
  };

  private readonly onInputRegain = (): void => {
    if (!document.hidden && document.hasFocus()) this.inputSuppressed = false;
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
      const message = decodeServerFrame(event.data);
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
      this.role = message.role;
      this.playerId = message.role === "fighter" ? message.player_id : null;
      this.sentAt.clear();
      if (message.role === "fighter") this.nextSequence = Math.max(this.nextSequence, message.next_sequence);
      else this.stopInputLifecycle();
      this.attempts = 0;
      this.clearTransportReconnect(true);
    } else if (message.type === "ticket") {
      this.reconnectTicket = message.reconnect_ticket;
    } else if (message.type === "snapshot") {
      this.serverTick = Math.max(this.serverTick, message.payload.tick);
      this.active = ["countdown", "fight", "knockdown", "foul_recovery"].includes(message.payload.phase);
      this.resting = message.payload.phase === "rest";
      this.observeAcknowledgement(message.payload);
    } else if (message.type === "paused") {
      this.active = false;
      this.startOpponentPause(message.grace_ms);
    } else if (message.type === "resumed") {
      this.active = true;
      this.attempts = 0;
      this.clearOpponentPause(true);
    } else if (message.type === "ready") {
      this.active = true;
    } else if (message.type === "waiting") {
      this.active = false;
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

  /** Smoothed round trip from an input send to the first snapshot acknowledging it, in milliseconds. */
  get inputLatencyMs(): number | null {
    return this.latencyMs;
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

  private sendInput(frame: InputFrame): void {
    if (this.active) this.transmit(frame);
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
      socket.send(encodeInput(this.nextSequence, this.serverTick, { ...frame, actions: frame.actions.slice(0, 4) }));
      this.sentAt.set(this.nextSequence, this.now());
      if (this.sentAt.size > 128) this.sentAt.delete(this.sentAt.keys().next().value!);
      this.nextSequence += 1;
      this.lastInputSentAt = this.now();
      this.sendTimes.push(this.lastInputSentAt);
      return true;
    } catch {
      this.handleClose(socket);
      return false;
    }
  }

  private flushInput(): void {
    if (this.inputSuppressed || document.hidden || !document.hasFocus()) return;
    if (this.sendsInLastSecond() >= MAX_SENDS_PER_SECOND) return;
    // While the connection is stalled the input stays here, current, instead of joining a queue
    // of stale frames; presses wait in the input buffer and leave with the next frame that goes.
    if ((this.socket?.bufferedAmount ?? 0) > BACKLOG_BYTES) return;
    this.sendInput(this.getInput());
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
