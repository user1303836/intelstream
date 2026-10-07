import { snapshot } from "./test/fixtures";
import { SharedActionIntent } from "./input/action-buffer";
import { NetworkController, websocketUrl } from "./network";
import { PROTOCOL_VERSION, type ServerMessage } from "./types";

class FakeSocket {
  readyState = 1;
  binaryType: BinaryType = "blob";
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  sent: string[] = [];
  closed = false;
  bufferedAmount = 0;
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
  version: PROTOCOL_VERSION, type: "welcome", role: "fighter", player_id: "one", seat: 1, rating: 1500,
  players: [{ id: "one", name: "One", avatar: null, rating: 1500, connected: true }],
  server_tick: 40, next_sequence: 5, reconnect_ticket: ticket,
});
const ready = {
  version: PROTOCOL_VERSION, type: "ready", players: [
    { id: "one", name: "One", avatar: null, rating: 1500, connected: true },
    { id: "two", name: "Two", avatar: null, rating: 1500, connected: true },
  ],
};
const final = {
  version: PROTOCOL_VERSION, type: "final", match_id: "match", winner_id: "one", method: "decision", round: 1,
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

  it("measures input acknowledgement latency from the local fighter's acknowledged sequence", () => {
    vi.useFakeTimers();
    history.replaceState({}, "", "/");
    const socket = new FakeSocket();
    const controller = new NetworkController("ticket", () => ({ moveX: 0, moveY: 0, defense: "none", actions: [] }), callbacks(), () => socket, () => Date.now());
    controller.start();
    socket.open();
    socket.message(welcome());
    socket.message(ready);
    expect(controller.inputLatencyMs).toBeNull();
    vi.advanceTimersByTime(40);
    const sent = JSON.parse(socket.sent.at(-1)!) as { sequence: number };
    vi.advanceTimersByTime(70);
    const base = snapshot();
    const acknowledged = { ...base, tick: 44, fighters: [{ ...base.fighters[0], player_id: welcome().player_id, last_input_sequence: sent.sequence }, base.fighters[1]] as const };
    socket.message({ version: PROTOCOL_VERSION, type: "snapshot", payload: acknowledged });
    const measured = controller.inputLatencyMs;
    expect(measured).not.toBeNull();
    expect(measured!).toBeGreaterThanOrEqual(70);
    expect(measured!).toBeLessThan(120);
    vi.advanceTimersByTime(40);
    socket.message({ version: PROTOCOL_VERSION, type: "snapshot", payload: { ...acknowledged, tick: 45 } });
    expect(controller.inputLatencyMs).toBe(measured);
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
      version: PROTOCOL_VERSION,
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

  it("starts sending input once a spectator is seated as a fighter before the bell", () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const getInput = vi.fn(() => ({ moveX: 1000, moveY: 0, defense: "none" as const, actions: [] }));
    const controller = new NetworkController("ticket", getInput, callbacks(), () => socket);
    controller.start();
    socket.open();
    const watching = [{ ...ready.players[1] }, { id: "three", name: "Three", avatar: null, rating: 1500, connected: false }];
    socket.message({ version: PROTOCOL_VERSION, type: "welcome", role: "spectator", player_id: "one", players: watching, server_tick: 0, reconnect_ticket: "spectator-ticket" });
    vi.advanceTimersByTime(200);
    expect(getInput).not.toHaveBeenCalled();
    socket.message({ ...welcome("seated-ticket"), server_tick: 0, next_sequence: 0 });
    socket.message(ready);
    vi.advanceTimersByTime(100);
    const frames = socket.sent.map((frame) => JSON.parse(frame) as { type: string; sequence?: number });
    expect(frames[0]?.type).toBe("authenticate");
    expect(frames.slice(1).length).toBeGreaterThan(0);
    expect(frames.slice(1).every((frame) => frame.type === "input")).toBe(true);
    expect(frames[1]?.sequence).toBe(0);
    controller.dispose();
    expect(vi.getTimerCount()).toBe(0);
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
    sockets[0]!.message({ version: PROTOCOL_VERSION, type: "ticket", reconnect_ticket: "ticket-c", refresh_id: "refresh-identifier" });
    expect(messages.map((message) => message.type)).toEqual(["welcome"]);
    expect(JSON.parse(sockets[0]!.sent[1]!)).toEqual({ version: PROTOCOL_VERSION, type: "ticket_ack", refresh_id: "refresh-identifier" });
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

  it("sends one neutral frame as input goes off at the bell, and one on a later focus loss, so held input stops driving the fighter", () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const controller = new NetworkController("ticket", () => ({ moveX: 0, moveY: 1000, defense: "guard_high", actions: [] }), callbacks(), () => socket);
    const inputs = (): Record<string, unknown>[] => socket.sent.map((frame) => JSON.parse(frame) as Record<string, unknown>).filter((frame) => frame.type === "input");
    controller.start();
    socket.open();
    socket.message(welcome());
    socket.message(ready);
    socket.message({ version: PROTOCOL_VERSION, type: "snapshot", payload: { ...snapshot(41), phase: "fight" } });
    vi.advanceTimersByTime(40);
    expect(inputs().at(-1)).toMatchObject({ move: { x: 0, y: 1000 }, defense: "guard_high" });
    const held = inputs().length;
    socket.message({ version: PROTOCOL_VERSION, type: "snapshot", payload: { ...snapshot(42), phase: "rest" } });
    expect(inputs()).toHaveLength(held + 1);
    expect(inputs().at(-1)).toMatchObject({ move: { x: 0, y: 0 }, defense: "none", actions: [] });
    controller.setActive(false);
    vi.advanceTimersByTime(500);
    expect(inputs()).toHaveLength(held + 1);
    window.dispatchEvent(new Event("blur"));
    expect(inputs()).toHaveLength(held + 2);
    expect(inputs().at(-1)).toMatchObject({ move: { x: 0, y: 0 }, defense: "none" });
    controller.dispose();
  });

  it("sends touch input from a frame that never gets document focus, and still stops for a hidden page", () => {
    vi.useFakeTimers();
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const focus = vi.spyOn(window, "focus").mockImplementation(() => undefined);
    let hidden = false;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    try {
      const socket = new FakeSocket();
      const controller = new NetworkController("ticket", () => ({ moveX: 1000, moveY: 0, defense: "none", actions: [] }), callbacks(), () => socket);
      const inputs = (): Record<string, unknown>[] => socket.sent.map((frame) => JSON.parse(frame) as Record<string, unknown>).filter((frame) => frame.type === "input");
      const touch = (): void => { document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true })); };
      controller.start();
      socket.open();
      socket.message(welcome());
      socket.message(ready);
      vi.advanceTimersByTime(100);
      expect(inputs()).toHaveLength(0);
      touch();
      expect(focus).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(100);
      expect(inputs().length).toBeGreaterThanOrEqual(2);
      expect(inputs().at(-1)).toMatchObject({ move: { x: 1000, y: 0 } });

      hidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
      expect(inputs().at(-1)).toMatchObject({ move: { x: 0, y: 0 }, defense: "none" });
      const stopped = inputs().length;
      vi.advanceTimersByTime(200);
      hidden = false;
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(200);
      expect(inputs()).toHaveLength(stopped);
      touch();
      vi.advanceTimersByTime(100);
      expect(inputs().length).toBeGreaterThan(stopped);
      controller.dispose();
    } finally {
      delete (document as { hidden?: boolean }).hidden;
    }
  });

  it("sends nothing before the bout starts, even on a focus loss, since the server ends the connection for it", () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const controller = new NetworkController("ticket", () => ({ moveX: 0, moveY: 1000, defense: "guard_high", actions: [] }), callbacks(), () => socket);
    controller.start();
    socket.open();
    socket.message(welcome());
    socket.message({ version: PROTOCOL_VERSION, type: "waiting", open_seats: 1 });
    controller.setActive(false);
    window.dispatchEvent(new Event("blur"));
    vi.advanceTimersByTime(200);
    expect(socket.sent.map((frame) => JSON.parse(frame).type)).toEqual(["authenticate"]);
    controller.dispose();
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
    socket.message({ version: PROTOCOL_VERSION, type: "error", code });
    expect(fatal).toHaveBeenCalledOnce();
    expect(fatal).toHaveBeenCalledWith(code);
    expect(socket.closed).toBe(true);
    socket.disconnect();
    vi.runAllTimers();
    expect(fresh).not.toHaveBeenCalled();
    expect(reconnect).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("reports a frame from another protocol version as an outdated client, and a malformed one as a protocol error", () => {
    const outdated = new FakeSocket();
    const fatal = vi.fn();
    const controller = new NetworkController("ticket", () => ({ moveX: 0, moveY: 0, defense: "none", actions: [] }), callbacks({ onFatal: fatal }), () => outdated);
    controller.start();
    outdated.open();
    // A server that moved on answers authenticate with its own version, so the frame itself does not decode.
    outdated.message({ version: PROTOCOL_VERSION + 1, type: "error", code: "client_outdated" });
    expect(fatal).toHaveBeenCalledWith("client_outdated");
    controller.dispose();

    const malformed = new FakeSocket();
    const protocolFatal = vi.fn();
    const other = new NetworkController("ticket", () => ({ moveX: 0, moveY: 0, defense: "none", actions: [] }), callbacks({ onFatal: protocolFatal }), () => malformed);
    other.start();
    malformed.open();
    malformed.message({ version: PROTOCOL_VERSION, type: "waiting", open_seats: 3 });
    expect(protocolFatal).toHaveBeenCalledWith("protocol_error");
    other.dispose();
  });

  it("ticks an open-socket opponent pause from its current grace to zero", () => {
    vi.useFakeTimers();
    const reconnect = vi.fn();
    const socket = new FakeSocket();
    const controller = new NetworkController("ticket", () => ({ moveX: 0, moveY: 0, defense: "none", actions: [] }), callbacks({ onReconnect: reconnect }), () => socket, () => Date.now());
    controller.start(); socket.open(); socket.message(welcome());
    socket.message({ version: PROTOCOL_VERSION, type: "paused", player_id: "two", grace_ms: 1_000 });
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
    socket.message({ version: PROTOCOL_VERSION, type: "paused", player_id: "two", grace_ms: 2_000 });
    vi.advanceTimersByTime(250);
    socket.message({ version: PROTOCOL_VERSION, type: "resumed", player_id: "two" });
    expect(reconnect).toHaveBeenLastCalledWith(0);
    const calls = reconnect.mock.calls.length;
    vi.advanceTimersByTime(3_000);
    expect(reconnect).toHaveBeenCalledTimes(calls);
    controller.dispose();
  });

  it("lets the pick and the bell end an opponent pause, so no countdown runs over the picker or the bout", () => {
    vi.useFakeTimers();
    const reconnect = vi.fn();
    const socket = new FakeSocket();
    const controller = new NetworkController("ticket", () => ({ moveX: 0, moveY: 0, defense: "none", actions: [] }), callbacks({ onReconnect: reconnect }), () => socket, () => Date.now());
    controller.start(); socket.open(); socket.message(welcome());
    const select = { version: PROTOCOL_VERSION, type: "select", deadline_ms: 9_000, players: ready.players, ready: [] };
    for (const ends of [select, ready, { version: PROTOCOL_VERSION, type: "waiting", open_seats: 1 }]) {
      socket.message({ version: PROTOCOL_VERSION, type: "paused", player_id: "two", grace_ms: 8_500 });
      vi.advanceTimersByTime(250);
      expect(reconnect).toHaveBeenLastCalledWith(8_250);
      socket.message(ends);
      expect(reconnect).toHaveBeenLastCalledWith(0);
      const calls = reconnect.mock.calls.length;
      vi.advanceTimersByTime(9_000);
      expect(reconnect).toHaveBeenCalledTimes(calls);
    }
    controller.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gives its own dropped transport a fresh grace while the opponent is paused", () => {
    vi.useFakeTimers();
    const reconnect = vi.fn();
    const socket = new FakeSocket();
    const controller = new NetworkController("ticket", () => ({ moveX: 0, moveY: 0, defense: "none", actions: [] }), callbacks({ onReconnect: reconnect }), () => socket, () => Date.now());
    controller.start(); socket.open(); socket.message(welcome());
    socket.message({ version: PROTOCOL_VERSION, type: "paused", player_id: "two", grace_ms: 5_000 });
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
    finalSocket.message({ version: PROTOCOL_VERSION, type: "paused", player_id: "two", grace_ms: 2_000 });
    finalSocket.message(final);
    expect(finalReconnect).toHaveBeenLastCalledWith(0);
    expect(vi.getTimerCount()).toBe(0);

    const disposeReconnect = vi.fn();
    const disposeSocket = new FakeSocket();
    const disposeController = new NetworkController("ticket", () => ({ moveX: 0, moveY: 0, defense: "none", actions: [] }), callbacks({ onReconnect: disposeReconnect }), () => disposeSocket, () => Date.now());
    disposeController.start(); disposeSocket.open(); disposeSocket.message(welcome());
    disposeSocket.message({ version: PROTOCOL_VERSION, type: "paused", player_id: "two", grace_ms: 2_000 });
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
    sockets[0]!.message({ version: PROTOCOL_VERSION, type: "paused", player_id: "two", grace_ms: 5_000 });
    now = 5_500;
    sockets[0]!.message({ version: PROTOCOL_VERSION, type: "resumed", player_id: "two" });
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

describe("calling in the computer", () => {
  const neutral = () => ({ moveX: 0, moveY: 0, defense: "none" as const, actions: [] });

  it("asks on the open connection as a fighter, and not once that connection is gone", () => {
    const socket = new FakeSocket();
    const controller = new NetworkController("ticket", neutral, callbacks(), () => socket);
    expect(controller.requestCpu("rookie")).toBe(false);
    controller.start();
    socket.open();
    socket.message(welcome());
    socket.message({ version: PROTOCOL_VERSION, type: "waiting", open_seats: 1 });
    expect(controller.requestCpu("champion")).toBe(true);
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ version: PROTOCOL_VERSION, type: "cpu", level: "champion" });
    socket.readyState = 3;
    expect(controller.requestCpu("champion")).toBe(false);
    expect(socket.sent.filter((frame) => JSON.parse(frame).type === "cpu")).toHaveLength(1);
    controller.dispose();
  });

  it("never asks for a spectator", () => {
    const socket = new FakeSocket();
    const controller = new NetworkController("ticket", neutral, callbacks(), () => socket);
    controller.start();
    socket.open();
    socket.message({ version: PROTOCOL_VERSION, type: "welcome", role: "spectator", player_id: "viewer", players: ready.players, server_tick: 40, reconnect_ticket: "spectator-ticket" });
    expect(controller.requestCpu("rookie")).toBe(false);
    expect(socket.sent.map((frame) => JSON.parse(frame).type)).toEqual(["authenticate"]);
    controller.dispose();
  });
});

describe("edge-triggered action sends", () => {
  it("flushes immediately on notifyAction and coalesces bursts", () => {
    vi.useFakeTimers();
    let now = 1000;
    const socket = new FakeSocket();
    const frames = [
      { moveX: 0, moveY: 0, defense: "none" as const, actions: [{ kind: "punch" as const, hand: "left" as const, class: "jab" as const, target: "head" as const, power: "normal" as const, id: "c1" }] },
      { moveX: 0, moveY: 0, defense: "none" as const, actions: [] },
    ];
    let frameIndex = 0;
    const controller = new NetworkController(
      "ticket",
      () => frames[Math.min(frameIndex++, frames.length - 1)]!,
      callbacks(),
      () => socket,
      () => now,
    );
    controller.start();
    socket.open();
    socket.message(welcome());
    socket.message(ready);
    controller.setActive(true);
    controller.notifyAction();
    expect(socket.sent).toHaveLength(2);
    expect(JSON.parse(socket.sent[1]!).actions).toEqual([{ kind: "punch", hand: "left", class: "jab", target: "head", power: "normal", id: "c1" }]);
    controller.notifyAction();
    expect(socket.sent).toHaveLength(2);
    now += 20;
    controller.notifyAction();
    expect(socket.sent).toHaveLength(3);
    controller.dispose();
    vi.useRealTimers();
  });

  it("sends a press at once in the middle of a bout, when the periodic flush has filled the last second", () => {
    vi.useFakeTimers();
    let now = 1000;
    const socket = new FakeSocket();
    const controller = new NetworkController("ticket", () => ({ moveX: 0, moveY: 0, defense: "none" as const, actions: [] }), callbacks(), () => socket, () => now);
    controller.start();
    socket.open();
    socket.message(welcome());
    socket.message(ready);
    controller.setActive(true);
    for (let millisecond = 0; millisecond < 1500; millisecond += 1) {
      now += 1;
      vi.advanceTimersByTime(1);
    }
    now += 10;
    const before = socket.sent.length;
    controller.notifyAction();
    expect(socket.sent.length).toBe(before + 1);
    let edges = 0;
    for (let millisecond = 0; millisecond < 1000; millisecond += 10) {
      now += 10;
      vi.advanceTimersByTime(10);
      const sent = socket.sent.length;
      controller.notifyAction();
      edges += socket.sent.length - sent;
    }
    expect(edges).toBeLessThanOrEqual(20);
    expect(edges).toBeGreaterThanOrEqual(15);
    controller.dispose();
    vi.useRealTimers();
  });

  it("sends a press at once however soon after a periodic flush it comes", () => {
    vi.useFakeTimers();
    let now = 1000;
    const socket = new FakeSocket();
    const queued: string[] = [];
    const controller = new NetworkController(
      "ticket",
      () => ({ moveX: 0, moveY: 0, defense: "none" as const, actions: queued.splice(0, 4).map((id) => ({ kind: "punch" as const, hand: "left" as const, class: "jab" as const, target: "head" as const, power: "normal" as const, id })) }),
      callbacks(),
      () => socket,
      () => now,
    );
    controller.start();
    socket.open();
    socket.message(welcome());
    socket.message(ready);
    controller.setActive(true);
    const step = (): void => { now += 1; vi.advanceTimersByTime(1); };
    const carried = (id: string): boolean => socket.sent.some((frame) => (JSON.parse(frame).actions ?? []).some((action: { id?: string }) => action.id === id));
    const waits: number[] = [];
    for (let offset = 0; offset < 33; offset += 1) {
      for (let rest = 0; rest < 100; rest += 1) step();
      const sent = socket.sent.length;
      while (socket.sent.length === sent) step();
      for (let elapsed = 0; elapsed < offset; elapsed += 1) step();
      const id = `p${offset}`;
      queued.push(id);
      controller.notifyAction();
      let waited = 0;
      while (!carried(id)) { step(); waited += 1; }
      waits.push(waited);
    }
    expect(waits).toEqual(Array.from({ length: 33 }, () => 0));
    controller.dispose();
    vi.useRealTimers();
  });

  it("keeps room for the periodic flush when presses come in a burst", () => {
    vi.useFakeTimers();
    let now = 1000;
    const socket = new FakeSocket();
    const controller = new NetworkController("ticket", () => ({ moveX: 0, moveY: 0, defense: "none" as const, actions: [] }), callbacks(), () => socket, () => now);
    controller.start();
    socket.open();
    socket.message(welcome());
    socket.message(ready);
    controller.setActive(true);
    let edges = 0;
    for (let millisecond = 0; millisecond < 400; millisecond += 9) {
      now += 9;
      vi.advanceTimersByTime(9);
      const sent = socket.sent.length;
      controller.notifyAction();
      edges += socket.sent.length - sent;
    }
    expect(edges).toBe(20);
    controller.dispose();
    vi.useRealTimers();
  });

  it("remembers which input sequence carried each press, for telling a refused press from a late one", () => {
    vi.useFakeTimers();
    let now = 1000;
    const socket = new FakeSocket();
    const queued: string[] = [];
    const controller = new NetworkController(
      "ticket",
      () => ({ moveX: 0, moveY: 0, defense: "none" as const, actions: queued.splice(0, 4).map((id) => ({ kind: "punch" as const, hand: "left" as const, class: "jab" as const, target: "head" as const, power: "normal" as const, id })) }),
      callbacks(),
      () => socket,
      () => now,
    );
    controller.start();
    socket.open();
    socket.message(welcome());
    socket.message(ready);
    controller.setActive(true);
    queued.push("c1");
    expect(controller.sequenceOf("c1")).toBeNull();
    controller.notifyAction();
    expect(controller.sequenceOf("c1")).toBe(5);
    now += 20;
    queued.push("c2", "c3");
    controller.notifyAction();
    expect([controller.sequenceOf("c2"), controller.sequenceOf("c3")]).toEqual([6, 6]);
    expect(controller.sequenceOf("c9")).toBeNull();
    controller.dispose();
    vi.useRealTimers();
  });

  it("holds its input while the connection is stalled and sends the current state when it clears", () => {
    vi.useFakeTimers();
    let now = 1000;
    const socket = new FakeSocket();
    let held = 1000;
    const queued: string[] = ["p1"];
    const controller = new NetworkController(
      "ticket",
      () => ({ moveX: held, moveY: 0, defense: "none" as const, actions: queued.splice(0, 4).map((id) => ({ kind: "punch" as const, hand: "left" as const, class: "jab" as const, target: "head" as const, power: "normal" as const, id })) }),
      callbacks(),
      () => socket,
      () => now,
    );
    controller.start();
    socket.open();
    socket.message(welcome());
    socket.message(ready);
    controller.setActive(true);
    const authenticated = socket.sent.length;
    socket.bufferedAmount = 5000;
    for (let millisecond = 0; millisecond < 2000; millisecond += 1) { now += 1; vi.advanceTimersByTime(1); }
    controller.notifyAction();
    expect(socket.sent.length).toBe(authenticated);
    held = 0;
    socket.bufferedAmount = 0;
    for (let millisecond = 0; millisecond < 40; millisecond += 1) { now += 1; vi.advanceTimersByTime(1); }
    const frames = socket.sent.slice(authenticated).map((frame) => JSON.parse(frame) as { move: { x: number }; actions: { id: string }[] });
    expect(frames.length).toBeGreaterThanOrEqual(1);
    expect(frames.length).toBeLessThanOrEqual(2);
    expect(frames[0]!.move.x).toBe(0);
    expect(frames[0]!.actions.map((action) => action.id)).toEqual(["p1"]);
    controller.dispose();
    vi.useRealTimers();
  });

  it("stays under the server's input limit however fast the player mashes, and always sends the newest press", () => {
    vi.useFakeTimers();
    let now = 1000;
    const socket = new FakeSocket();
    // The client's own press queue, as InputController builds it: it holds one press, the newest, as
    // the engine keeps the newer of two presses in one tick, so a press the next one overtakes is dropped.
    const presses = new SharedActionIntent(1);
    const controller = new NetworkController(
      "ticket",
      () => ({ moveX: 0, moveY: 0, defense: "none" as const, actions: presses.drain(4) }),
      callbacks(),
      () => socket,
      () => now,
    );
    presses.setListener(() => controller.notifyAction());
    controller.start();
    socket.open();
    socket.message(welcome());
    socket.message(ready);
    controller.setActive(true);
    const authenticated = socket.sent.length;
    const times: number[] = [];
    const delivered: string[] = [];
    let pressed = 0;
    // Each frame that leaves carries the newest press, or none once that has gone out.
    const record = (): void => {
      for (const frame of socket.sent.slice(authenticated + times.length)) {
        times.push(now);
        const ids = (JSON.parse(frame).actions as { id: string }[]).map((action) => action.id);
        expect(ids.length).toBeLessThanOrEqual(1);
        if (ids.length === 1) expect(ids[0]).toBe(`c${pressed}`);
        delivered.push(...ids);
      }
    };
    for (let millisecond = 0; millisecond < 3000; millisecond += 1) {
      now += 1;
      vi.advanceTimersByTime(1);
      record();
      if (millisecond < 2000 && millisecond % 2 === 0) {
        // Alternate hands, as a masher does, so no press repeats the one before it.
        pressed += 1;
        presses.push("keyboard", { kind: "punch", hand: pressed % 2 === 0 ? "right" : "left", class: "jab", target: "head", power: "normal" });
        record();
      }
    }
    for (const start of times) expect(times.filter((at) => at >= start && at < start + 1000).length).toBeLessThanOrEqual(50);
    expect(times.length).toBeGreaterThan(90);
    // A thousand presses in two seconds: the ones overtaken before a frame could leave are dropped, never sent late.
    expect(pressed).toBe(1000);
    expect(delivered.length).toBeGreaterThan(90);
    expect(delivered.length).toBeLessThan(pressed);
    expect(delivered.map((id) => Number(id.slice(1)))).toEqual([...new Set(delivered.map((id) => Number(id.slice(1))))].sort((a, b) => a - b));
    expect(delivered.at(-1)).toBe(`c${pressed}`);
    controller.dispose();
    vi.useRealTimers();
  });
});

describe("corner instructions between rounds", () => {
  it("sends the instruction on its own only during the rest, on the input sequence", () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const getInput = vi.fn(() => ({ moveX: 1000, moveY: 0, defense: "none" as const, actions: [] }));
    const controller = new NetworkController("ticket", getInput, callbacks(), () => socket);
    controller.start();
    socket.open();
    socket.message(welcome());
    socket.message(ready);
    socket.message({ version: PROTOCOL_VERSION, type: "snapshot", payload: snapshot() });
    expect(controller.sendCornerChoice("corner_cut")).toBe(false);

    socket.message({ version: PROTOCOL_VERSION, type: "snapshot", payload: { ...snapshot(11), phase: "rest", phase_ticks_remaining: 300 } });
    const before = socket.sent.length;
    vi.advanceTimersByTime(200);
    expect(socket.sent.length).toBe(before);
    expect(controller.sendCornerChoice("corner_breath")).toBe(true);
    const frame = JSON.parse(socket.sent.at(-1)!) as { type: string; sequence: number; move: unknown; defense: string; actions: unknown[] };
    expect(frame).toMatchObject({ type: "input", move: { x: 0, y: 0 }, defense: "none", actions: [{ kind: "corner_breath" }] });
    expect(frame.sequence).toBeGreaterThanOrEqual(5);

    socket.message(final);
    expect(controller.sendCornerChoice("corner_cut")).toBe(false);
    controller.dispose();
  });

  it("never sends a corner instruction for a spectator", () => {
    const socket = new FakeSocket();
    const controller = new NetworkController("ticket", () => ({ moveX: 0, moveY: 0, defense: "none" as const, actions: [] }), callbacks(), () => socket);
    controller.start();
    socket.open();
    socket.message({ version: PROTOCOL_VERSION, type: "welcome", role: "spectator", player_id: "viewer", players: ready.players, server_tick: 40, reconnect_ticket: "spectator-ticket" });
    socket.message({ version: PROTOCOL_VERSION, type: "snapshot", payload: { ...snapshot(11), phase: "rest", phase_ticks_remaining: 300 } });
    expect(controller.sendCornerChoice("corner_cut")).toBe(false);
    expect(socket.sent.map((sent) => JSON.parse(sent).type)).toEqual(["authenticate"]);
    controller.dispose();
  });
});
