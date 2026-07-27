import { NetworkController, websocketUrl } from "./network";
import type { ServerMessage } from "./types";

class FakeSocket {
  readyState = 1;
  binaryType: BinaryType = "blob";
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  sent: string[] = [];
  closed = false;
  send(data: string): void { this.sent.push(data); }
  close(): void { this.closed = true; }
  open(): void { this.onopen?.(new Event("open")); }
  message(value: unknown): void { this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(value) })); }
  disconnect(): void { this.onclose?.(new CloseEvent("close")); }
}

const callbacks = (overrides: Partial<{
  onMessage: (message: ServerMessage) => void;
  onReconnect: (remaining: number) => void;
  onFatal: (code: string) => void;
  onFreshAuth: () => void;
}> = {}) => ({
  onMessage: overrides.onMessage ?? vi.fn(),
  onReconnect: overrides.onReconnect ?? vi.fn(),
  onFatal: overrides.onFatal ?? vi.fn(),
  onFreshAuth: overrides.onFreshAuth ?? vi.fn(),
});

const welcome = (ticket = "ticket-b") => ({
  version: 1, type: "welcome", role: "fighter", player_id: "one", seat: 1, rating: 1500,
  players: [{ id: "one", name: "One", avatar: null, rating: 1500, connected: true }],
  server_tick: 40, next_sequence: 5, reconnect_ticket: ticket,
});
const ready = {
  version: 1, type: "ready", players: [
    { id: "one", name: "One", avatar: null, rating: 1500, connected: true },
    { id: "two", name: "Two", avatar: null, rating: 1500, connected: true },
  ],
};
const final = {
  version: 1, type: "final", match_id: "match", winner_id: "one", method: "decision", round: 1,
  scorecards: ["A", "B", "C"].map((judge) => ({ judge, player_one: [10], player_two: [9] })),
  ratings: { one: { before: 1500, after: 1516 }, two: { before: 1500, after: 1484 } },
};

describe("same-origin WebSocket controller", () => {
  it("derives only secure/safe local websocket URLs", () => {
    expect(websocketUrl({ origin: "https://123.discordsays.com", protocol: "https:", hostname: "123.discordsays.com" } as Location)).toBe("wss://123.discordsays.com/api/hands/ws");
    expect(websocketUrl({ origin: "http://localhost:5173", protocol: "http:", hostname: "localhost" } as Location)).toBe("ws://localhost:5173/api/hands/ws");
    expect(() => websocketUrl({ origin: "http://example.com", protocol: "http:", hostname: "example.com" } as Location)).toThrow();
  });

  it("authenticates first, rotates one-use tickets, continues sequence and batches four", () => {
    vi.useFakeTimers();
    history.replaceState({}, "", "/");
    const sockets: FakeSocket[] = [];
    const messages: ServerMessage[] = [];
    const fresh = vi.fn();
    const controller = new NetworkController(
      "ticket-a",
      () => ({ moveX: 7, moveY: 9, defense: "none", actions: Array.from({ length: 8 }, () => ({ kind: "slip_left" as const })) }),
      callbacks({ onMessage: (message) => messages.push(message), onFreshAuth: fresh }),
      () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      () => Date.now(),
    );
    controller.start();
    sockets[0]!.open();
    expect(JSON.parse(sockets[0]!.sent[0]!).type).toBe("authenticate");
    expect(JSON.parse(sockets[0]!.sent[0]!).ticket).toBe("ticket-a");
    sockets[0]!.message(welcome());
    sockets[0]!.message(ready);
    vi.advanceTimersByTime(40);
    const input = JSON.parse(sockets[0]!.sent[1]!) as { sequence: number; client_tick: number; actions: unknown[] };
    expect(input).toMatchObject({ sequence: 5, client_tick: 40 });
    expect(input.actions).toHaveLength(4);
    sockets[0]!.disconnect();
    vi.advanceTimersByTime(250);
    expect(sockets).toHaveLength(2);
    sockets[1]!.open();
    expect(JSON.parse(sockets[1]!.sent[0]!).ticket).toBe("ticket-b");
    expect(fresh).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("never sends gameplay input for a server-declared spectator", () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const getInput = vi.fn(() => ({ moveX: 1000, moveY: 1000, defense: "guard_high" as const, actions: [{ kind: "punch" as const, hand: "left" as const, class: "jab" as const, target: "head" as const, power: "normal" as const }] }));
    const controller = new NetworkController("ticket", getInput, callbacks(), () => socket);
    controller.start();
    socket.open();
    socket.message({
      version: 1,
      type: "welcome",
      role: "spectator",
      player_id: "viewer",
      players: ready.players,
      server_tick: 40,
      reconnect_ticket: "spectator-ticket",
    });
    socket.message(ready);
    controller.setActive(true);
    vi.advanceTimersByTime(200);
    window.dispatchEvent(new Event("blur"));

    expect(socket.sent.map((frame) => JSON.parse(frame).type)).toEqual(["authenticate"]);
    expect(getInput).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("uses the latest in-memory ticket refresh without exposing it to app callbacks", () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const messages: ServerMessage[] = [];
    const controller = new NetworkController(
      "ticket-a",
      () => ({ moveX: 0, moveY: 0, defense: "none", actions: [] }),
      callbacks({ onMessage: (message) => messages.push(message) }),
      () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      () => Date.now(),
    );
    controller.start();
    sockets[0]!.open();
    sockets[0]!.message(welcome("ticket-b"));
    sockets[0]!.message({ version: 1, type: "ticket", reconnect_ticket: "ticket-c", refresh_id: "refresh-identifier" });
    expect(messages.map((message) => message.type)).toEqual(["welcome"]);
    expect(JSON.parse(sockets[0]!.sent[1]!)).toEqual({ version: 1, type: "ticket_ack", refresh_id: "refresh-identifier" });
    sockets[0]!.disconnect();
    vi.advanceTimersByTime(250);
    sockets[1]!.open();
    expect(JSON.parse(sockets[1]!.sent[0]!).ticket).toBe("ticket-c");
    controller.dispose();
  });

  it("sends exactly one authoritative neutral frame before focus-loss suppression and removes listeners", () => {
    const socket = new FakeSocket();
    const controller = new NetworkController(
      "ticket",
      () => ({ moveX: 800, moveY: -400, defense: "guard_high", actions: [{ kind: "clinch" }] }),
      callbacks(),
      () => socket,
    );
    controller.start();
    socket.open();
    socket.message(welcome());
    socket.message(ready);
    window.dispatchEvent(new Event("blur"));
    document.dispatchEvent(new Event("visibilitychange"));
    const inputs = socket.sent.slice(1).map((frame) => JSON.parse(frame) as Record<string, unknown>);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ sequence: 5, move: { x: 0, y: 0 }, defense: "none", actions: [] });
    controller.dispose();
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("blur"));
    expect(socket.sent.slice(1)).toHaveLength(1);
  });

  it.each(["room_full", "persistence_failed", "abandoned"])("treats server error %s as terminal", (code) => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const fatal = vi.fn();
    const fresh = vi.fn();
    const reconnect = vi.fn();
    const controller = new NetworkController("ticket", () => ({ moveX: 0, moveY: 0, defense: "none", actions: [] }), callbacks({ onFatal: fatal, onFreshAuth: fresh, onReconnect: reconnect }), () => socket);
    controller.start();
    socket.open();
    socket.message(welcome());
    socket.message({ version: 1, type: "error", code });
    expect(fatal).toHaveBeenCalledOnce();
    expect(fatal).toHaveBeenCalledWith(code);
    expect(socket.closed).toBe(true);
    socket.disconnect();
    vi.runAllTimers();
    expect(fresh).not.toHaveBeenCalled();
    expect(reconnect).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("ticks an open-socket opponent pause from its current grace to zero", () => {
    vi.useFakeTimers();
    const reconnect = vi.fn();
    const socket = new FakeSocket();
    const controller = new NetworkController("ticket", () => ({ moveX: 0, moveY: 0, defense: "none", actions: [] }), callbacks({ onReconnect: reconnect }), () => socket, () => Date.now());
    controller.start(); socket.open(); socket.message(welcome());
    socket.message({ version: 1, type: "paused", player_id: "two", grace_ms: 1_000 });
    expect(reconnect).toHaveBeenLastCalledWith(1_000);
    vi.advanceTimersByTime(250); expect(reconnect).toHaveBeenLastCalledWith(750);
    vi.advanceTimersByTime(750); expect(reconnect).toHaveBeenLastCalledWith(0);
    controller.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels opponent countdown updates on resume", () => {
    vi.useFakeTimers();
    const reconnect = vi.fn();
    const socket = new FakeSocket();
    const controller = new NetworkController("ticket", () => ({ moveX: 0, moveY: 0, defense: "none", actions: [] }), callbacks({ onReconnect: reconnect }), () => socket, () => Date.now());
    controller.start(); socket.open(); socket.message(welcome());
    socket.message({ version: 1, type: "paused", player_id: "two", grace_ms: 2_000 });
    vi.advanceTimersByTime(250);
    socket.message({ version: 1, type: "resumed", player_id: "two" });
    expect(reconnect).toHaveBeenLastCalledWith(0);
    const calls = reconnect.mock.calls.length;
    vi.advanceTimersByTime(3_000);
    expect(reconnect).toHaveBeenCalledTimes(calls);
    controller.dispose();
  });

  it("gives its own dropped transport a fresh grace while the opponent is paused", () => {
    vi.useFakeTimers();
    const reconnect = vi.fn();
    const socket = new FakeSocket();
    const controller = new NetworkController("ticket", () => ({ moveX: 0, moveY: 0, defense: "none", actions: [] }), callbacks({ onReconnect: reconnect }), () => socket, () => Date.now());
    controller.start(); socket.open(); socket.message(welcome());
    socket.message({ version: 1, type: "paused", player_id: "two", grace_ms: 5_000 });
    vi.advanceTimersByTime(4_000);
    socket.disconnect();
    expect(reconnect).toHaveBeenLastCalledWith(20_000);
    controller.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears opponent countdowns on final and dispose without timer leaks", () => {
    vi.useFakeTimers();
    const finalReconnect = vi.fn();
    const finalSocket = new FakeSocket();
    const finalController = new NetworkController("ticket", () => ({ moveX: 0, moveY: 0, defense: "none", actions: [] }), callbacks({ onReconnect: finalReconnect }), () => finalSocket, () => Date.now());
    finalController.start(); finalSocket.open(); finalSocket.message(welcome());
    finalSocket.message({ version: 1, type: "paused", player_id: "two", grace_ms: 2_000 });
    finalSocket.message(final);
    expect(finalReconnect).toHaveBeenLastCalledWith(0);
    expect(vi.getTimerCount()).toBe(0);

    const disposeReconnect = vi.fn();
    const disposeSocket = new FakeSocket();
    const disposeController = new NetworkController("ticket", () => ({ moveX: 0, moveY: 0, defense: "none", actions: [] }), callbacks({ onReconnect: disposeReconnect }), () => disposeSocket, () => Date.now());
    disposeController.start(); disposeSocket.open(); disposeSocket.message(welcome());
    disposeSocket.message({ version: 1, type: "paused", player_id: "two", grace_ms: 2_000 });
    disposeController.dispose();
    expect(disposeReconnect).toHaveBeenLastCalledWith(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears a pause deadline on resume so a later disconnect receives a fresh 20-second window", () => {
    let now = 1_000;
    const sockets: FakeSocket[] = [];
    const reconnect = vi.fn();
    const controller = new NetworkController(
      "ticket",
      () => ({ moveX: 0, moveY: 0, defense: "none", actions: [] }),
      callbacks({ onReconnect: reconnect }),
      () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      () => now,
    );
    controller.start();
    sockets[0]!.open();
    sockets[0]!.message(welcome());
    sockets[0]!.message({ version: 1, type: "paused", player_id: "two", grace_ms: 5_000 });
    now = 5_500;
    sockets[0]!.message({ version: 1, type: "resumed", player_id: "two" });
    now = 8_000;
    sockets[0]!.disconnect();
    expect(reconnect).toHaveBeenLastCalledWith(20_000);
    controller.dispose();
  });

  it("falls back to fresh OAuth when a sent ticket dies before rotation", () => {
    const socket = new FakeSocket();
    const fresh = vi.fn();
    const controller = new NetworkController("once", () => ({ moveX: 0, moveY: 0, defense: "none", actions: [] }), callbacks({ onFreshAuth: fresh }), () => socket);
    controller.start();
    socket.open();
    socket.disconnect();
    expect(fresh).toHaveBeenCalledOnce();
    controller.dispose();
  });
});
