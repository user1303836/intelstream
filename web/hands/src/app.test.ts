import type { NetworkCallbacks } from "./network";
import type { EngineSnapshot, ServerMessage } from "./types";
import { fighter } from "./test/fixtures";

const mocks = vi.hoisted(() => ({
  invite: vi.fn(async () => {}),
  sessionDestroy: vi.fn(),
  networkDispose: vi.fn(),
  inputDestroy: vi.fn(),
  rendererDestroy: vi.fn(),
  rendererPushes: [] as number[][],
  callbacks: null as NetworkCallbacks | null,
}));
vi.mock("./discord", () => ({
  authorizeDiscord: vi.fn(async () => ({
    sdk: {},
    bootstrap: { client_id: "123", state: "state", protocol: 1, simulation: { tick_rate: 20, ring_half_width: 500, ring_half_height: 330 } },
    player: { id: "one", name: "One", avatar: null, rating: 1500 },
    takeTicket: () => "ticket",
    invite: mocks.invite,
    destroy: mocks.sessionDestroy,
  })),
}));
vi.mock("./network", () => ({
  NetworkController: class {
    constructor(_ticket: string, _input: unknown, callbacks: NetworkCallbacks) { mocks.callbacks = callbacks; }
    start(): void {}
    setActive(): void {}
    dispose(): void { mocks.networkDispose(); }
  },
}));
vi.mock("./render/renderer", () => ({
  FightRenderer: class {
    private readonly pushes: number[] = [];
    constructor() { mocks.rendererPushes.push(this.pushes); }
    setPlayers(): void {}
    setFinal(): void {}
    setReconnect(): void {}
    setBloodLevel(): void {}
    setReducedMotion(): void {}
    push(snapshot: EngineSnapshot): void { this.pushes.push(snapshot.tick); }
    destroy(): void { mocks.rendererDestroy(); }
  },
}));

import { HandsApp } from "./app";

const send = (message: ServerMessage): void => { mocks.callbacks?.onMessage(message); };
const players = [
  { id: "one", name: "One", avatar: null, rating: 1500, connected: true },
  { id: "two", name: "Two", avatar: null, rating: 1500, connected: true },
] as const;
const makeSnapshot = (tick: number, phase: EngineSnapshot["phase"] = "fight"): EngineSnapshot => ({
  tick,
  phase,
  round_number: 1,
  phase_ticks_remaining: 1_205,
  fighters: [fighter("one", -100), fighter("two", 100)],
  events: [],
  result: null,
  checksum: "a".repeat(64),
});

describe("browser lifecycle and accessible overlays", () => {
  beforeEach(() => {
    mocks.callbacks = null;
    mocks.rendererPushes.length = 0;
    vi.clearAllMocks();
  });

  it("launches, waits/invites, hides invite at exactly two, reports final and cleans up", async () => {
    history.replaceState({}, "", "/?instance_id=launch");
    const root = document.createElement("div");
    const app = new HandsApp(root);
    app.start();
    await vi.waitFor(() => expect(mocks.callbacks).not.toBeNull());
    send({ version: 1, type: "welcome", player_id: "one", seat: 1, rating: 1500, players: [players[0]], server_tick: 0, next_sequence: 0, reconnect_ticket: "rotated" });
    send({ version: 1, type: "waiting", open_seats: 1 });
    const invite = root.querySelector<HTMLButtonElement>("[data-invite]")!;
    expect(invite.hidden).toBe(false);
    invite.click();
    await vi.waitFor(() => expect(mocks.invite).toHaveBeenCalled());
    send({ version: 1, type: "ready", players: [...players] });
    expect(invite.hidden).toBe(true);
    const cards = ["A", "B", "C"].map((judge) => ({ judge, player_one: [10], player_two: [9] }));
    send({ version: 1, type: "final", match_id: "m", winner_id: "one", method: "decision", round: 1, scorecards: cards, ratings: { one: { before: 1500, after: 1516 }, two: { before: 1500, after: 1484 } } });
    expect(root.querySelector("[data-final]")?.textContent).toContain("A: 10 to 9");
    app.destroy();
    expect(mocks.networkDispose).toHaveBeenCalled();
    expect(mocks.rendererDestroy).toHaveBeenCalled();
    expect(mocks.sessionDestroy).toHaveBeenCalled();
    expect(root.children).toHaveLength(0);
  });

  it("fully resets renderer, snapshot tick history, player/final state and dedupers on fresh authorization", async () => {
    history.replaceState({}, "", "/?instance_id=launch");
    const root = document.createElement("div");
    const app = new HandsApp(root);
    app.start();
    await vi.waitFor(() => expect(mocks.callbacks).not.toBeNull());
    send({ version: 1, type: "welcome", player_id: "one", seat: 1, rating: 1500, players: [...players], server_tick: 100, next_sequence: 8, reconnect_ticket: "rotated" });
    send({ version: 1, type: "snapshot", payload: makeSnapshot(100) });
    const firstCallbacks = mocks.callbacks!;
    firstCallbacks.onFatal("persistence_failed");
    expect(mocks.rendererDestroy).toHaveBeenCalledOnce();
    expect(root.querySelector<HTMLButtonElement>("[data-retry]")!.hidden).toBe(false);
    expect(root.querySelector("canvas")).not.toBeNull();
    root.querySelector<HTMLButtonElement>("[data-retry]")!.click();
    await vi.waitFor(() => expect(mocks.rendererPushes).toHaveLength(2));
    expect(mocks.rendererDestroy).toHaveBeenCalledOnce();
    expect(mocks.sessionDestroy).toHaveBeenCalledOnce();
    send({ version: 1, type: "welcome", player_id: "one", seat: 1, rating: 1500, players: [...players], server_tick: 1, next_sequence: 0, reconnect_ticket: "new" });
    send({ version: 1, type: "snapshot", payload: makeSnapshot(1, "countdown") });
    expect(mocks.rendererPushes).toEqual([[100], [1]]);
    expect(root.querySelector("[data-final]")?.textContent).toBe("");
    expect(root.querySelector("[data-status]")?.textContent).toBe("Bout countdown.");
    app.destroy();
  });

  it("provides a stable semantic summary with full long names, tick-rate clock and private get-up instructions", async () => {
    history.replaceState({}, "", "/?instance_id=launch");
    const root = document.createElement("div");
    const app = new HandsApp(root);
    app.start();
    await vi.waitFor(() => expect(mocks.callbacks).not.toBeNull());
    const longName = "A very long authoritative fighter name that canvas must truncate but semantics retain";
    send({ version: 1, type: "welcome", player_id: "one", seat: 1, rating: 1500, players: [{ ...players[0], name: longName }, players[1]], server_tick: 1, next_sequence: 0, reconnect_ticket: "new" });
    const downed = { ...fighter("one", -100), is_downed: true, get_up_prompt: "get_up_left" as const, get_up_meter: 12, get_up_required: 50, get_up_count: 0 };
    const snapshot = { ...makeSnapshot(2, "knockdown"), fighters: [downed, fighter("two", 100)] as const };
    send({ version: 1, type: "snapshot", payload: snapshot });
    const summary = root.querySelector("[data-fight-summary]")!;
    const live = root.querySelector("[data-fight-status]")!;
    expect(summary.hasAttribute("aria-live")).toBe(false);
    expect(summary.textContent).toContain(longName);
    expect(summary.textContent).toContain("Clock 1:00");
    expect(summary.textContent).toContain("Press left now");
    expect(live.textContent).toBe("Knockdown. Count 0. Press left now.");
    const firstLiveNode = live.firstChild;
    const staminaChanged = { ...snapshot, tick: 3, fighters: [{ ...downed, stamina: downed.stamina - 1 }, snapshot.fighters[1]] as const };
    send({ version: 1, type: "snapshot", payload: staminaChanged });
    expect(summary.textContent).toContain(`stamina ${downed.stamina - 1}`);
    expect(live.firstChild).toBe(firstLiveNode);
    send({ version: 1, type: "snapshot", payload: { ...staminaChanged, tick: 4, fighters: [{ ...staminaChanged.fighters[0], get_up_prompt: "get_up_right" }, staminaChanged.fighters[1]] } });
    expect(live.textContent).toBe("Knockdown. Count 0. Press right now.");
    expect(live.firstChild).not.toBe(firstLiveNode);
    app.destroy();
  });

  it("reports invite failures without leaving the waiting stage", async () => {
    mocks.invite.mockRejectedValueOnce(new Error("host failure"));
    history.replaceState({}, "", "/?instance_id=launch");
    const root = document.createElement("div");
    const app = new HandsApp(root);
    app.start();
    await vi.waitFor(() => expect(mocks.callbacks).not.toBeNull());
    send({ version: 1, type: "welcome", player_id: "one", seat: 1, rating: 1500, players: [players[0]], server_tick: 0, next_sequence: 0, reconnect_ticket: "rotated" });
    send({ version: 1, type: "waiting", open_seats: 1 });
    root.querySelector<HTMLButtonElement>("[data-invite]")!.click();
    await vi.waitFor(() => expect(root.querySelector("[data-status]")?.textContent).toContain("Invite could not open"));
    expect(root.querySelector<HTMLButtonElement>("[data-invite]")!.hidden).toBe(false);
    app.destroy();
  });
});
