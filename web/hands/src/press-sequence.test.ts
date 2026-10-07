import { NetworkController } from "./network";
import type { InputFrame, SemanticAction } from "./types";

class FakeSocket {
  readyState = 1;
  binaryType: BinaryType = "blob";
  bufferedAmount = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly sent: string[] = [];
  send(data: string): void { this.sent.push(data); }
  close(): void { this.readyState = 3; }
  message(value: unknown): void { this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(value) })); }
}

const players = [
  { id: "one", name: "One", avatar: null, rating: 1500, connected: true },
  { id: "two", name: "Two", avatar: null, rating: 1500, connected: true },
];

describe("press sequence", () => {
  it("carries a press in the frame numbered by nextInputSequence when it was made, sent at once or with the next flush", () => {
    vi.useFakeTimers();
    history.replaceState({}, "", "/");
    let now = 1000;
    const pressed: SemanticAction[] = [];
    const socket = new FakeSocket();
    const controller = new NetworkController(
      "ticket",
      (): InputFrame => ({ moveX: 0, moveY: 0, defense: "none", actions: pressed.splice(0) }),
      { onMessage: vi.fn(), onReconnect: vi.fn(), onFatal: vi.fn(), onFreshAuth: vi.fn() },
      () => socket,
      () => now,
    );
    const advance = (milliseconds: number): void => {
      for (let step = 0; step < milliseconds; step += 1) {
        now += 1;
        vi.advanceTimersByTime(1);
      }
    };
    const press = (id: string): number => {
      pressed.push({ kind: "punch", id, class: "jab", hand: "left", target: "head", power: "normal" });
      const sequence = controller.nextInputSequence;
      controller.notifyAction();
      return sequence;
    };
    const carrier = (id: string): number | undefined => socket.sent
      .map((data) => JSON.parse(data) as { type: string; sequence?: number; actions?: { id?: string }[] })
      .find((frame) => frame.type === "input" && frame.actions?.some((action) => action.id === id))?.sequence;
    controller.start();
    socket.onopen?.(new Event("open"));
    socket.message({ version: 3, type: "welcome", role: "fighter", player_id: "one", seat: 1, rating: 1500, players, server_tick: 40, next_sequence: 5, reconnect_ticket: "next" });
    socket.message({ version: 3, type: "ready", players });
    advance(50);
    // Sent at once on the press.
    const first = press("c1");
    expect(carrier("c1")).toBe(first);
    // Too soon after that send for another, so it waits for the periodic flush.
    advance(3);
    const second = press("c2");
    expect(carrier("c2")).toBeUndefined();
    advance(40);
    expect(carrier("c2")).toBe(second);
    expect(second).toBe(first + 1);
    controller.dispose();
    vi.useRealTimers();
  });
});
