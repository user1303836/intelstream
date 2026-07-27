import { safeError } from "./api";
import { decodeServerFrame, encodeInput } from "./protocol";
import type { InputFrame, ServerMessage } from "./types";

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
  private serverTick = 0;
  private active = false;
  private disposed = false;
  private terminal = false;
  private inputSuppressed = false;
  private listenersBound = false;

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
    if (!this.disposed && !this.terminal) this.inputTimer = window.setInterval(() => this.flushInput(), 40);
  }

  setActive(active: boolean): void {
    this.active = active;
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
        socket.send(JSON.stringify({ version: 1, type: "authenticate", ticket }));
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
          socket.send(JSON.stringify({ version: 1, type: "ticket_ack", refresh_id: message.refresh_id }));
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
      this.nextSequence = Math.max(this.nextSequence, message.next_sequence);
      this.attempts = 0;
      this.clearTransportReconnect(true);
    } else if (message.type === "ticket") {
      this.reconnectTicket = message.reconnect_ticket;
    } else if (message.type === "snapshot") {
      this.serverTick = Math.max(this.serverTick, message.payload.tick);
      this.active = ["countdown", "fight", "knockdown", "foul_recovery"].includes(message.payload.phase);
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

  private sendInput(frame: InputFrame): void {
    const socket = this.socket;
    if (!this.active || this.disposed || this.terminal || socket?.readyState !== OPEN) return;
    try {
      socket.send(encodeInput(this.nextSequence, this.serverTick, { ...frame, actions: frame.actions.slice(0, 4) }));
      this.nextSequence += 1;
    } catch {
      this.handleClose(socket);
    }
  }

  private flushInput(): void {
    if (this.inputSuppressed || document.hidden || !document.hasFocus()) return;
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
