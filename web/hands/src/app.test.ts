import type { NetworkCallbacks } from "./network";
import { PROTOCOL_VERSION, type EngineSnapshot, type ServerMessage } from "./types";
import { fighter } from "./test/fixtures";

const mocks = vi.hoisted(() => {
  const sessionDestroy = vi.fn();
  return {
    sessionDestroy,
    authorize: vi.fn(async () => ({
      sdk: {},
      bootstrap: { client_id: "123", state: "state", protocol: 3, simulation: { tick_rate: 20, ring_half_width: 500, ring_half_height: 500 } },
      player: { id: "one", name: "One", avatar: null, rating: 1500 },
      takeTicket: () => "ticket",
      destroy: sessionDestroy,
    })),
    activityClose: vi.fn(),
    networkDispose: vi.fn(),
    networkSetActive: vi.fn(),
    inputDestroy: vi.fn(),
    rendererDestroy: vi.fn(),
    rendererPushes: [] as number[][],
    callbacks: null as NetworkCallbacks | null,
    rendererResyncs: 0,
    resultVisible: true,
    cornerPicks: [] as string[],
    styleChoices: [] as string[],
    cpuRequests: [] as string[],
    cpuAccepted: true,
    renderers: [] as Array<{ onAnnouncement?: ((lines: readonly string[]) => void) | null; onCrowdCue?: ((cue: "chant") => void) | null; onRocked?: ((level: number, tick: number) => void) | null }>,
    input: null as (() => { moveX: number; moveY: number }) | null,
    viewForward: null as { x: number; z: number } | null,
  };
});
vi.mock("./discord", () => ({
  DiscordActivity: class {
    readonly authorize = mocks.authorize;
    readonly close = mocks.activityClose;
  },
}));
vi.mock("./network", () => ({
  NetworkController: class {
    constructor(_ticket: string, input: unknown, callbacks: NetworkCallbacks) { mocks.callbacks = callbacks; mocks.input = input as () => { moveX: number; moveY: number }; }
    start(): void {}
    setActive(active: boolean): void { mocks.networkSetActive(active); }
    notifyAction(): void {}
    sendCornerChoice(kind: string): boolean { mocks.cornerPicks.push(kind); return true; }
    chooseStyle(style: string, ready: boolean): boolean { mocks.styleChoices.push(`${style}:${ready}`); return true; }
    requestCpu(level: string): boolean { mocks.cpuRequests.push(level); return mocks.cpuAccepted; }
    dispose(): void { mocks.networkDispose(); }
  },
}));
vi.mock("./render/renderer", () => ({
  FightRenderer: class {
    private readonly pushes: number[] = [];
    onAnnouncement: ((lines: readonly string[]) => void) | null = null;
    onCrowdCue: ((cue: "chant") => void) | null = null;
    onRocked: ((level: number, tick: number) => void) | null = null;
    constructor() { mocks.rendererPushes.push(this.pushes); mocks.renderers.push(this); }
    setPlayers(): void {}
    setFinal(): void {}
    setReconnect(): void {}
    setBloodLevel(): void {}
    setReducedMotion(): void {}
    viewForward(): { x: number; z: number } | null { return mocks.viewForward; }
    setCornerPanelTop(): void {}
    resyncClock(): void { mocks.rendererResyncs += 1; }
    push(snapshot: EngineSnapshot): void { this.pushes.push(snapshot.tick); }
    destroy(): void { mocks.rendererDestroy(); }
    setInputLatency(): void {}
    get resultVisible(): boolean { return mocks.resultVisible; }
  },
}));

import type { IDiscordSDK } from "@discord/embedded-app-sdk";
import { ClientError } from "./api";
import { HandsApp } from "./app";
import { AudioFeedback } from "./audio";

const send = (message: ServerMessage): void => { mocks.callbacks?.onMessage(message); };
/** A Discord client that answers every command; `close` is what would close the Activity. */
const fakeDiscord = (instanceId: string) => ({
  instanceId,
  ready: vi.fn(async () => undefined),
  close: vi.fn(),
  commands: { authorize: vi.fn(async () => ({ code: "oauth-code" })), authenticate: vi.fn(async () => ({})) },
});
const json = (value: unknown): Response => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
const handsBackend = () => vi.fn(async (input: URL | RequestInfo) => String(input).includes("bootstrap")
  ? json({ client_id: "123", state: "state", protocol: 3, simulation: { tick_rate: 30, ring_half_width: 500, ring_half_height: 500 } })
  : json({ access_token: "access", ticket: "ticket", player: { id: "one", name: "One", avatar: null, rating: 1500 } }));
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
    mocks.resultVisible = true;
    mocks.cpuRequests.length = 0;
    mocks.cpuAccepted = true;
    vi.clearAllMocks();
  });

  it("cycles the camera with K, keeps the settings panel in step and ignores K while typing", () => {
    localStorage.clear();
    const root = document.createElement("div");
    document.body.append(root);
    const app = new HandsApp(root);
    const select = root.querySelector<HTMLSelectElement>("[data-camera]")!;
    const press = (target: EventTarget = window): void => { target.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyK", bubbles: true, cancelable: true })); };
    const saved = (): unknown => JSON.parse(localStorage.getItem("hands.preferences.v1") ?? "{}").camera;
    expect(select.value).toBe("broadcast");
    press();
    expect(select.value).toBe("close");
    press();
    expect(select.value).toBe("fighter");
    expect(saved()).toBe("fighter");
    press();
    expect(select.value).toBe("broadcast");
    press(root.querySelector<HTMLInputElement>("[data-volume]")!);
    expect(select.value).toBe("broadcast");
    select.value = "fighter";
    select.dispatchEvent(new Event("change"));
    expect(saved()).toBe("fighter");
    app.destroy();
    press();
    expect(saved()).toBe("fighter");
    root.remove();
    localStorage.clear();
  });

  it("turns the controls with the player's own camera", async () => {
    history.replaceState({}, "", "/?instance_id=turned");
    const root = document.createElement("div");
    const app = new HandsApp(root);
    app.start();
    await vi.waitFor(() => expect(mocks.callbacks).not.toBeNull());
    send({ version: 3, type: "welcome", role: "fighter", player_id: "one", seat: 1, rating: 1500, players: [...players], server_tick: 0, next_sequence: 0, reconnect_ticket: "rotated" });
    send({ version: 3, type: "ready", players: [...players] });
    send({ version: 3, type: "snapshot", payload: makeSnapshot(10) });
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", bubbles: true, cancelable: true }));
    expect(mocks.input!()).toMatchObject({ moveX: 0, moveY: 1000 });
    mocks.viewForward = { x: 1, z: 0 };
    expect(mocks.input!()).toMatchObject({ moveX: 1000, moveY: 0 });
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW", bubbles: true, cancelable: true }));
    mocks.viewForward = null;
    app.destroy();
  });

  it("labels graphic full mode and exposes the required model attribution", () => {
    const root = document.createElement("div");
    const app = new HandsApp(root);
    expect(root.querySelector<HTMLOptionElement>('option[value="full"]')?.textContent).toBe("Full (arcade gore)");
    const credit = root.querySelector<HTMLElement>(".model-credit");
    expect(credit?.textContent).toContain("Boxer");
    expect(credit?.textContent).toContain("Texel, Inc.");
    expect(credit?.textContent).toContain("CC BY 4.0");
    app.destroy();
  });

  it("launches, waits for the channel Play now action, reports final and cleans up", async () => {
    history.replaceState({}, "", "/?instance_id=launch");
    const root = document.createElement("div");
    const app = new HandsApp(root);
    app.start();
    await vi.waitFor(() => expect(mocks.callbacks).not.toBeNull());
    send({ version: 3, type: "welcome", role: "fighter", player_id: "one", seat: 1, rating: 1500, players: [players[0]], server_tick: 0, next_sequence: 0, reconnect_ticket: "rotated" });
    send({ version: 3, type: "waiting", open_seats: 1 });
    expect(root.querySelector("[data-invite]")).toBeNull();
    expect(root.querySelector("[data-status]")?.textContent).toContain("Play now");
    expect(root.querySelector<HTMLElement>("[data-status]")?.hidden).toBe(false);
    expect(root.querySelector("[data-overlay]")?.hasAttribute("data-raised")).toBe(false);
    const hint = root.querySelector<HTMLElement>("[data-hint]")!;
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toContain("Jab");
    send({ version: 3, type: "ready", players: [...players] });
    const cards = ["A", "B", "C"].map((judge) => ({ judge, player_one: [10], player_two: [9] }));
    send({ version: 3, type: "final", match_id: "m", winner_id: "one", method: "decision", round: 1, scorecards: cards, ratings: { one: { before: 1500, after: 1516 }, two: { before: 1500, after: 1484 } } });
    expect(root.querySelector("[data-final]")?.textContent).toContain("A: 10 to 9");
    expect(root.querySelector<HTMLElement>("[data-hint]")!.hidden).toBe(true);
    expect(mocks.activityClose).not.toHaveBeenCalled();
    app.destroy();
    expect(mocks.networkDispose).toHaveBeenCalled();
    expect(mocks.rendererDestroy).toHaveBeenCalled();
    expect(mocks.sessionDestroy).toHaveBeenCalled();
    expect(mocks.activityClose).toHaveBeenCalledOnce();
    expect(root.children).toHaveLength(0);
  });

  it("renders a persistent read-only spectator mode without private coaching", async () => {
    history.replaceState({}, "", "/?instance_id=launch");
    const root = document.createElement("div");
    const app = new HandsApp(root);
    app.start();
    await vi.waitFor(() => expect(mocks.callbacks).not.toBeNull());
    const controls = root.querySelector<HTMLButtonElement>("[data-controls]")!;
    controls.click();
    expect(root.querySelector<HTMLElement>("[data-controls-panel]")!.hidden).toBe(false);

    send({ version: 3, type: "welcome", role: "spectator", player_id: "viewer", players: [...players], server_tick: 30, reconnect_ticket: "spectator-ticket" });
    const redacted = makeSnapshot(30, "knockdown");
    send({ version: 3, type: "snapshot", payload: redacted });

    expect(root.querySelector<HTMLElement>("[data-role]")!.hidden).toBe(false);
    expect(root.querySelector("[data-role]")?.textContent).toContain("SPECTATING");
    expect(root.querySelector("[data-status]")?.textContent).toContain("Spectating");
    expect(root.querySelector("[data-fight-status]")?.textContent).toContain("Spectating");
    expect(root.querySelector("[data-fight-status]")?.textContent).not.toContain("Press");
    expect(controls.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>("[data-controls-panel]")!.hidden).toBe(true);
    expect(mocks.networkSetActive).toHaveBeenLastCalledWith(false);
    app.destroy();
  });

  it("keeps authorization failures visible and reloads before retrying", async () => {
    mocks.authorize.mockRejectedValueOnce(new ClientError("sdk_authenticate_failed", true));
    history.replaceState({}, "", "/?instance_id=launch");
    const root = document.createElement("div");
    const reload = vi.fn();
    const app = new HandsApp(root, reload);
    app.start();
    await vi.waitFor(() => expect(root.querySelector("[data-status]")?.textContent).toBe("Unable to continue: Discord did not confirm your identity (sdk_authenticate_failed)."));
    const retry = root.querySelector<HTMLButtonElement>("[data-retry]")!;
    expect(retry.hidden).toBe(false);
    retry.click();
    expect(reload).toHaveBeenCalledOnce();
    expect(mocks.sessionDestroy).not.toHaveBeenCalled();
    // The reload's pagehide tears the app down; closing the SDK then would close the Activity instead.
    app.destroy();
    expect(mocks.activityClose).not.toHaveBeenCalled();
  });

  it.each([
    ["the bootstrap", (): void => { mocks.authorize.mockRejectedValueOnce(new ClientError("client_outdated", true)); }],
    ["the socket", (): void => undefined],
  ])("asks for a reload, not another sign-in, when %s shows Hands was updated", async (source, arrange) => {
    arrange();
    history.replaceState({}, "", "/?instance_id=launch");
    const root = document.createElement("div");
    const reload = vi.fn();
    const app = new HandsApp(root, reload);
    app.start();
    if (source === "the socket") {
      await vi.waitFor(() => expect(mocks.callbacks).not.toBeNull());
      send({ version: 3, type: "error", code: "client_outdated" });
      mocks.callbacks?.onFatal("client_outdated");
    }
    await vi.waitFor(() => expect(root.querySelector("[data-status]")?.textContent).toBe("Hands was updated. Reload to continue (client_outdated)."));
    const retry = root.querySelector<HTMLButtonElement>("[data-retry]")!;
    expect(retry.hidden).toBe(false);
    expect(retry.textContent).toBe("Reload");
    const authorizations = mocks.authorize.mock.calls.length;
    retry.click();
    expect(reload).toHaveBeenCalledOnce();
    expect(mocks.authorize.mock.calls.length).toBe(authorizations);
    app.destroy();
  });

  it("plays the finish without the overlay while the result is still on its way, but not forever", async () => {
    const root = document.createElement("main");
    const app = new HandsApp(root);
    app.start();
    await vi.waitFor(() => expect(mocks.callbacks).not.toBeNull());
    send({ version: 3, type: "welcome", role: "fighter", player_id: "one", seat: 1, rating: 1500, players: [...players], server_tick: 100, next_sequence: 8, reconnect_ticket: "rotated" });
    send({ version: 3, type: "snapshot", payload: makeSnapshot(100) });
    const overlay = root.querySelector<HTMLElement>("[data-overlay]")!;
    expect(overlay.hidden).toBe(false);
    vi.useFakeTimers();
    send({ version: 3, type: "snapshot", payload: makeSnapshot(101, "complete") });
    expect(overlay.hidden).toBe(true);
    vi.advanceTimersByTime(4_200);
    expect(overlay.hidden).toBe(false);
    vi.useRealTimers();
    app.destroy();
  });

  it("keeps the result overlay hidden until the knockout replay has revealed the result", async () => {
    const root = document.createElement("main");
    const app = new HandsApp(root);
    app.start();
    await vi.waitFor(() => expect(mocks.callbacks).not.toBeNull());
    send({ version: 3, type: "welcome", role: "fighter", player_id: "one", seat: 1, rating: 1500, players: [...players], server_tick: 100, next_sequence: 8, reconnect_ticket: "rotated" });
    send({ version: 3, type: "snapshot", payload: makeSnapshot(100) });
    const overlay = root.querySelector<HTMLElement>("[data-overlay]")!;
    expect(overlay.hidden).toBe(false);
    mocks.resultVisible = false;
    vi.useFakeTimers();
    send({ version: 3, type: "final", match_id: "m-replay", winner_id: "one", method: "ko", round: 1, scorecards: [], ratings: { one: { before: 1500, after: 1516 }, two: { before: 1500, after: 1484 } } });
    expect(overlay.hidden).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(overlay.hidden).toBe(true);
    mocks.resultVisible = true;
    vi.advanceTimersByTime(250);
    expect(overlay.hidden).toBe(false);
    vi.useRealTimers();
    app.destroy();
  });

  it("waits for the named opponent after Rematch, with the computer only as a fallback", async () => {
    history.replaceState({}, "", "/?instance_id=launch");
    const root = document.createElement("div");
    const app = new HandsApp(root);
    app.start();
    await vi.waitFor(() => expect(mocks.callbacks).not.toBeNull());
    send({ version: 3, type: "welcome", role: "fighter", player_id: "one", seat: 1, rating: 1500, players: [...players], server_tick: 100, next_sequence: 8, reconnect_ticket: "rotated" });
    send({ version: 3, type: "snapshot", payload: makeSnapshot(100) });
    vi.useFakeTimers();
    send({ version: 3, type: "final", match_id: "m1", winner_id: "one", method: "decision", round: 1, scorecards: [], ratings: { one: { before: 1500, after: 1516 }, two: { before: 1500, after: 1484 } } });
    vi.advanceTimersByTime(11_500);
    const first = mocks.callbacks;
    root.querySelector<HTMLButtonElement>("[data-rematch]")!.click();
    vi.useRealTimers();
    await vi.waitFor(() => expect(mocks.callbacks).not.toBe(first));
    send({ version: 3, type: "welcome", role: "fighter", player_id: "one", seat: 1, rating: 1516, players: [players[0]], server_tick: 0, next_sequence: 0, reconnect_ticket: "again" });
    send({ version: 3, type: "waiting", open_seats: 1 });
    expect(root.querySelector("[data-status]")?.textContent).toBe("Waiting for Two to take the rematch…");
    expect(root.querySelector("[data-cpu-prompt]")?.textContent).toBe("Or fight the computer instead:");
    send({ version: 3, type: "ready", players: [...players] });
    send({ version: 3, type: "snapshot", payload: makeSnapshot(1, "countdown") });
    expect(root.querySelector("[data-cpu-prompt]")?.textContent).toBe("No one here yet? Fight the computer.");
    app.destroy();
  });

  it("groups the controls into sections and keeps diagnostics behind a disclosure", () => {
    const root = document.createElement("div");
    const app = new HandsApp(root);
    const headings = [...root.querySelectorAll("[data-controls-panel] h3")].map((heading) => heading.textContent);
    expect(headings).toEqual(["Keyboard", "Between rounds", "Controller", "Touch"]);
    expect(root.querySelector("[data-controls-panel]")?.textContent).toContain("Shift+1 low blow");
    const diagnostics = root.querySelector("details.diagnostics");
    expect(diagnostics).not.toBeNull();
    expect(diagnostics?.hasAttribute("open")).toBe(false);
    expect(diagnostics?.querySelector("[data-diagnostics]")).not.toBeNull();
    app.destroy();
  });

  it("offers a rematch after the result hold and retries while the ring is still clearing", async () => {
    history.replaceState({}, "", "/?instance_id=launch");
    const root = document.createElement("div");
    const app = new HandsApp(root);
    app.start();
    await vi.waitFor(() => expect(mocks.callbacks).not.toBeNull());
    send({ version: 3, type: "welcome", role: "fighter", player_id: "one", seat: 1, rating: 1500, players: [...players], server_tick: 100, next_sequence: 8, reconnect_ticket: "rotated" });
    send({ version: 3, type: "snapshot", payload: makeSnapshot(100) });
    const final = (matchId: string): ServerMessage => ({ version: 3, type: "final", match_id: matchId, winner_id: "one", method: "decision", round: 1, scorecards: [], ratings: { one: { before: 1500, after: 1516 }, two: { before: 1500, after: 1484 } } });
    const button = root.querySelector<HTMLButtonElement>("[data-rematch]")!;
    expect(button.hidden).toBe(true);
    vi.useFakeTimers();
    send(final("m1"));
    expect(button.hidden).toBe(false);
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain("Rematch in");
    vi.advanceTimersByTime(11_500);
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Rematch");
    const first = mocks.callbacks;
    button.click();
    vi.useRealTimers();
    await vi.waitFor(() => expect(mocks.callbacks).not.toBe(first));
    expect(button.hidden).toBe(true);
    send({ version: 3, type: "welcome", role: "fighter", player_id: "one", seat: 1, rating: 1516, players: [...players], server_tick: 900, next_sequence: 0, reconnect_ticket: "again" });
    vi.useFakeTimers();
    const held = mocks.callbacks;
    send(final("m1"));
    expect(root.querySelector("[data-status]")?.textContent).toContain("still being cleared");
    expect(root.querySelector("[data-final]")?.textContent).toBe("");
    vi.advanceTimersByTime(3_100);
    vi.useRealTimers();
    await vi.waitFor(() => expect(mocks.callbacks).not.toBe(held));
    send({ version: 3, type: "welcome", role: "fighter", player_id: "one", seat: 1, rating: 1516, players: [...players], server_tick: 1, next_sequence: 0, reconnect_ticket: "fresh" });
    send({ version: 3, type: "snapshot", payload: makeSnapshot(1, "countdown") });
    expect(root.querySelector("[data-status]")?.textContent).toBe("Bout countdown.");
    expect(root.querySelector<HTMLElement>("[data-status]")?.hidden).toBe(true);
    expect(root.querySelector("[data-overlay]")?.hasAttribute("data-raised")).toBe(true);
    expect(root.querySelector("[data-overlay]")?.hasAttribute("data-result")).toBe(false);
    send(final("m2"));
    expect(root.querySelector("[data-status]")?.textContent).toBe("Bout complete. Scorecards and rating changes are displayed.");
    expect(root.querySelector<HTMLElement>("[data-status]")?.hidden).toBe(true);
    expect(root.querySelector("[data-overlay]")?.hasAttribute("data-result")).toBe(true);
    expect(button.hidden).toBe(false);
    expect(button.disabled).toBe(true);
    app.destroy();
  });

  describe("fighting the computer", () => {
    const computer = { id: "cpu:champion", name: "Viktor 'Iron' Volkov", avatar: null, rating: 1400, connected: true, cpu: true };
    const alone = (): void => {
      send({ version: 3, type: "welcome", role: "fighter", player_id: "one", seat: 1, rating: 1500, players: [players[0]], server_tick: 0, next_sequence: 0, reconnect_ticket: "rotated" });
      send({ version: 3, type: "waiting", open_seats: 1 });
    };
    const launch = async (): Promise<{ app: HandsApp; root: HTMLElement }> => {
      history.replaceState({}, "", "/?instance_id=launch");
      const root = document.createElement("div");
      const app = new HandsApp(root);
      app.start();
      await vi.waitFor(() => expect(mocks.callbacks).not.toBeNull());
      return { app, root };
    };
    const pick = (root: HTMLElement, level: string): void => root.querySelector<HTMLButtonElement>(`[data-cpu-level="${level}"]`)!.click();

    it("offers a fighter waiting alone the computer at three levels and calls the one chosen", async () => {
      const { app, root } = await launch();
      const picker = root.querySelector<HTMLElement>("[data-cpu]")!;
      expect(picker.hidden).toBe(true);
      alone();
      expect(picker.hidden).toBe(false);
      expect([...picker.querySelectorAll<HTMLButtonElement>("[data-cpu-level]")].map((button) => button.dataset.cpuLevel)).toEqual(["rookie", "contender", "champion"]);
      pick(root, "contender");
      expect(mocks.cpuRequests).toEqual(["contender"]);
      expect(picker.hidden).toBe(true);
      expect(root.querySelector("[data-status]")?.textContent).toBe("Calling in the computer…");
      pick(root, "rookie");
      expect(mocks.cpuRequests).toEqual(["contender"]);
      send({ version: 3, type: "ready", players: [players[0], computer] });
      expect(picker.hidden).toBe(true);
      app.destroy();
    });

    it("keeps the offer away from spectators and from a bout already under way", async () => {
      const { app, root } = await launch();
      send({ version: 3, type: "welcome", role: "spectator", player_id: "viewer", players: [...players], server_tick: 40, reconnect_ticket: "spectator" });
      send({ version: 3, type: "waiting", open_seats: 1 });
      expect(root.querySelector<HTMLElement>("[data-cpu]")!.hidden).toBe(true);
      pick(root, "rookie");
      expect(mocks.cpuRequests).toEqual([]);
      app.destroy();
      const second = await launch();
      send({ version: 3, type: "welcome", role: "fighter", player_id: "one", seat: 1, rating: 1500, players: [...players], server_tick: 0, next_sequence: 0, reconnect_ticket: "rotated" });
      send({ version: 3, type: "ready", players: [...players] });
      expect(second.root.querySelector<HTMLElement>("[data-cpu]")!.hidden).toBe(true);
      second.app.destroy();
    });

    it("asks again when a reconnect lands back in the empty ring, and keeps offering when it could not ask", async () => {
      const { app, root } = await launch();
      alone();
      mocks.cpuAccepted = false;
      pick(root, "rookie");
      expect(root.querySelector<HTMLElement>("[data-cpu]")!.hidden).toBe(false);
      expect(root.querySelector("[data-status]")?.textContent).toContain("Play now");
      mocks.cpuAccepted = true;
      pick(root, "rookie");
      send({ version: 3, type: "waiting", open_seats: 1 });
      expect(mocks.cpuRequests).toEqual(["rookie", "rookie", "rookie"]);
      app.destroy();
    });

    it("calls the bout unrated and brings the same computer back for a rematch", async () => {
      const { app, root } = await launch();
      alone();
      pick(root, "champion");
      send({ version: 3, type: "ready", players: [players[0], computer] });
      send({ version: 3, type: "snapshot", payload: { ...makeSnapshot(100), fighters: [fighter("one", -100), fighter("cpu:champion", 100)] } });
      const summary = root.querySelector("[data-fight-summary]")?.textContent ?? "";
      expect(summary).toContain("Viktor 'Iron' Volkov, computer opponent");
      expect(summary).not.toContain("ELO 1400");
      vi.useFakeTimers();
      send({ version: 3, type: "final", match_id: "m1", winner_id: "cpu:champion", method: "decision", round: 1, scorecards: [], ratings: { one: { before: 1500, after: 1500 }, "cpu:champion": { before: 1400, after: 1400 } } });
      expect(root.querySelector("[data-final]")?.textContent).toContain("Unrated bout against the computer.");
      expect(root.querySelector("[data-final]")?.textContent).not.toContain("Ratings:");
      expect(root.querySelector("[data-status]")?.textContent).toContain("unrated");
      vi.advanceTimersByTime(11_500);
      const first = mocks.callbacks;
      root.querySelector<HTMLButtonElement>("[data-rematch]")!.click();
      vi.useRealTimers();
      await vi.waitFor(() => expect(mocks.callbacks).not.toBe(first));
      expect(mocks.cpuRequests).toEqual(["champion"]);
      alone();
      expect(mocks.cpuRequests).toEqual(["champion", "champion"]);
      expect(root.querySelector<HTMLElement>("[data-cpu]")!.hidden).toBe(true);
      app.destroy();
    });

    it("does not call the computer for a rematch against a person", async () => {
      const { app, root } = await launch();
      alone();
      send({ version: 3, type: "ready", players: [...players] });
      vi.useFakeTimers();
      send({ version: 3, type: "final", match_id: "m1", winner_id: "one", method: "decision", round: 1, scorecards: [], ratings: { one: { before: 1500, after: 1516 }, two: { before: 1500, after: 1484 } } });
      expect(root.querySelector("[data-final]")?.textContent).toContain("Ratings:");
      vi.advanceTimersByTime(11_500);
      const first = mocks.callbacks;
      root.querySelector<HTMLButtonElement>("[data-rematch]")!.click();
      vi.useRealTimers();
      await vi.waitFor(() => expect(mocks.callbacks).not.toBe(first));
      alone();
      expect(mocks.cpuRequests).toEqual([]);
      expect(root.querySelector<HTMLElement>("[data-cpu]")!.hidden).toBe(false);
      app.destroy();
    });
  });

  it("retries a rematch that reaches the old room while it is still closing, once per refusal", async () => {
    history.replaceState({}, "", "/?instance_id=launch");
    const root = document.createElement("div");
    const app = new HandsApp(root);
    app.start();
    await vi.waitFor(() => expect(mocks.callbacks).not.toBeNull());
    send({ version: 3, type: "welcome", role: "fighter", player_id: "one", seat: 1, rating: 1500, players: [...players], server_tick: 100, next_sequence: 8, reconnect_ticket: "rotated" });
    send({ version: 3, type: "snapshot", payload: makeSnapshot(100) });
    vi.useFakeTimers();
    send({ version: 3, type: "final", match_id: "m1", winner_id: "one", method: "decision", round: 1, scorecards: [], ratings: { one: { before: 1500, after: 1516 }, two: { before: 1500, after: 1484 } } });
    vi.advanceTimersByTime(11_500);
    const first = mocks.callbacks;
    root.querySelector<HTMLButtonElement>("[data-rematch]")!.click();
    vi.useRealTimers();
    await vi.waitFor(() => expect(mocks.callbacks).not.toBe(first));
    const closing = mocks.callbacks;
    const authorizations = mocks.authorize.mock.calls.length;
    vi.useFakeTimers();
    send({ version: 3, type: "error", code: "room_closed" });
    closing?.onFatal("room_closed");
    expect(root.querySelector("[data-status]")?.textContent).toContain("still being cleared");
    vi.advanceTimersByTime(3_100);
    vi.useRealTimers();
    await vi.waitFor(() => expect(mocks.callbacks).not.toBe(closing));
    expect(mocks.authorize.mock.calls.length).toBe(authorizations + 1);
    send({ version: 3, type: "welcome", role: "fighter", player_id: "one", seat: 1, rating: 1516, players: [players[0]], server_tick: 0, next_sequence: 0, reconnect_ticket: "fresh" });
    send({ version: 3, type: "waiting", open_seats: 1 });
    send({ version: 3, type: "error", code: "room_closed" });
    expect(root.querySelector("[data-status]")?.textContent).toContain("already ended");
    app.destroy();
  });

  it("relearns the server clock on a new connection and when a paused bout resumes", async () => {
    history.replaceState({}, "", "/?instance_id=launch");
    const root = document.createElement("div");
    const app = new HandsApp(root);
    app.start();
    await vi.waitFor(() => expect(mocks.callbacks).not.toBeNull());
    mocks.rendererResyncs = 0;
    send({ version: 3, type: "welcome", role: "fighter", player_id: "one", seat: 1, rating: 1500, players: [...players], server_tick: 100, next_sequence: 8, reconnect_ticket: "rotated" });
    expect(mocks.rendererResyncs).toBe(1);
    send({ version: 3, type: "snapshot", payload: makeSnapshot(100) });
    send({ version: 3, type: "paused", player_id: "two", grace_ms: 20_000 });
    expect(mocks.rendererResyncs).toBe(1);
    send({ version: 3, type: "resumed", player_id: "two" });
    expect(mocks.rendererResyncs).toBe(2);
    app.destroy();
  });

  it("shows copyable diagnostics in the settings panel", async () => {
    history.replaceState({}, "", "/?instance_id=launch");
    const root = document.createElement("div");
    const app = new HandsApp(root);
    app.start();
    await vi.waitFor(() => expect(mocks.callbacks).not.toBeNull());
    const writeText = vi.fn((_text: string) => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    root.querySelector<HTMLButtonElement>("[data-settings]")!.click();
    const text = root.querySelector("[data-diagnostics]")?.textContent ?? "";
    expect(text).toContain("frame:");
    expect(text).toContain("browser:");
    expect(text).toContain("last error: none");
    root.querySelector<HTMLButtonElement>("[data-copy-diagnostics]")!.click();
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("input latency:"));
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    document.body.append(root);
    root.querySelector<HTMLButtonElement>("[data-copy-diagnostics]")!.click();
    expect(root.querySelector("[data-copy-diagnostics]")?.textContent).toBe("Selected. Copy manually");
    expect(window.getSelection()?.toString()).toContain("frame:");
    root.remove();
    app.destroy();
  });

  it("fully resets renderer, snapshot tick history, player/final state and dedupers on fresh authorization", async () => {
    history.replaceState({}, "", "/?instance_id=launch");
    const root = document.createElement("div");
    const app = new HandsApp(root);
    app.start();
    await vi.waitFor(() => expect(mocks.callbacks).not.toBeNull());
    send({ version: 3, type: "welcome", role: "fighter", player_id: "one", seat: 1, rating: 1500, players: [...players], server_tick: 100, next_sequence: 8, reconnect_ticket: "rotated" });
    send({ version: 3, type: "snapshot", payload: makeSnapshot(100) });
    const firstCallbacks = mocks.callbacks!;
    firstCallbacks.onFatal("persistence_failed");
    expect(mocks.rendererDestroy).toHaveBeenCalledOnce();
    expect(root.querySelector<HTMLButtonElement>("[data-retry]")!.hidden).toBe(false);
    expect(root.querySelector("canvas")).not.toBeNull();
    root.querySelector<HTMLButtonElement>("[data-retry]")!.click();
    await vi.waitFor(() => expect(mocks.callbacks).not.toBe(firstCallbacks));
    expect(mocks.rendererDestroy).toHaveBeenCalledOnce();
    expect(mocks.sessionDestroy).toHaveBeenCalledOnce();
    expect(mocks.rendererPushes).toHaveLength(1);
    send({ version: 3, type: "welcome", role: "fighter", player_id: "one", seat: 1, rating: 1500, players: [...players], server_tick: 1, next_sequence: 0, reconnect_ticket: "new" });
    expect(mocks.rendererPushes).toHaveLength(2);
    send({ version: 3, type: "snapshot", payload: makeSnapshot(1, "countdown") });
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
    send({ version: 3, type: "welcome", role: "fighter", player_id: "one", seat: 1, rating: 1500, players: [{ ...players[0], name: longName }, players[1]], server_tick: 1, next_sequence: 0, reconnect_ticket: "new" });
    const downed = { ...fighter("one", -100), is_downed: true, get_up_prompt: "get_up_left" as const, get_up_meter: 12, get_up_required: 50, get_up_count: 0 };
    const snapshot = { ...makeSnapshot(2, "knockdown"), fighters: [downed, fighter("two", 100)] as const };
    send({ version: 3, type: "snapshot", payload: snapshot });
    const summary = root.querySelector("[data-fight-summary]")!;
    const live = root.querySelector("[data-fight-status]")!;
    expect(summary.hasAttribute("aria-live")).toBe(false);
    expect(summary.textContent).toContain(longName);
    expect(summary.textContent).toContain("Clock 1:00");
    expect(summary.textContent).toContain("Press left now");
    expect(live.textContent).toBe("Knockdown. Count 0. Press left now.");
    const firstLiveNode = live.firstChild;
    const staminaChanged = { ...snapshot, tick: 3, fighters: [{ ...downed, stamina: downed.stamina - 1 }, snapshot.fighters[1]] as const };
    send({ version: 3, type: "snapshot", payload: staminaChanged });
    expect(summary.textContent).toContain(`stamina ${downed.stamina - 1}`);
    expect(live.firstChild).toBe(firstLiveNode);
    send({ version: 3, type: "snapshot", payload: { ...staminaChanged, tick: 4, fighters: [{ ...staminaChanged.fighters[0], get_up_prompt: "get_up_right" }, staminaChanged.fighters[1]] } });
    expect(live.textContent).toBe("Knockdown. Count 0. Press right now.");
    expect(live.firstChild).not.toBe(firstLiveNode);
    app.destroy();
  });

  it("keeps the touch controls up but inert through the rest, and hides them outside the bout", async () => {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({ matches: query === "(pointer: coarse)", media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() }));
    history.replaceState({}, "", "/?instance_id=launch");
    const root = document.createElement("div");
    const app = new HandsApp(root);
    app.start();
    await vi.waitFor(() => expect(mocks.callbacks).not.toBeNull());
    const controls = root.querySelector<HTMLElement>(".touch-controls")!;
    send({ version: 3, type: "welcome", role: "fighter", player_id: "one", seat: 1, rating: 1500, players: [players[0]], server_tick: 0, next_sequence: 0, reconnect_ticket: "rotated" });
    send({ version: 3, type: "waiting", open_seats: 1 });
    expect(controls.classList.contains("disabled")).toBe(true);
    send({ version: 3, type: "ready", players: [...players] });
    send({ version: 3, type: "snapshot", payload: makeSnapshot(100) });
    expect(controls.classList.contains("disabled")).toBe(false);
    expect(controls.classList.contains("resting")).toBe(false);
    send({ version: 3, type: "snapshot", payload: makeSnapshot(101, "rest") });
    expect(controls.classList.contains("disabled")).toBe(false);
    expect(controls.classList.contains("resting")).toBe(true);
    send({ version: 3, type: "snapshot", payload: makeSnapshot(102, "fight") });
    expect(controls.classList.contains("resting")).toBe(false);
    send({ version: 3, type: "snapshot", payload: makeSnapshot(103, "complete") });
    expect(controls.classList.contains("disabled")).toBe(true);
    app.destroy();
  });

  it("keeps the page's one Discord SDK open through a rematch and a retried failure, and closes it at teardown", async () => {
    const { DiscordActivity } = await vi.importActual<typeof import("./discord")>("./discord");
    history.replaceState({}, "", "/?instance_id=launch&frame_id=frame&platform=mobile");
    vi.stubGlobal("fetch", handsBackend());
    const discord = fakeDiscord("launch");
    const makeSdk = vi.fn(() => discord as unknown as IDiscordSDK);
    const root = document.createElement("div");
    const app = new HandsApp(root, vi.fn(), new DiscordActivity(makeSdk));
    app.start();
    await vi.waitFor(() => expect(mocks.callbacks).not.toBeNull());
    send({ version: 3, type: "welcome", role: "fighter", player_id: "one", seat: 1, rating: 1500, players: [...players], server_tick: 100, next_sequence: 8, reconnect_ticket: "rotated" });
    send({ version: 3, type: "snapshot", payload: makeSnapshot(100) });
    vi.useFakeTimers();
    send({ version: 3, type: "final", match_id: "m1", winner_id: "one", method: "decision", round: 1, scorecards: [], ratings: { one: { before: 1500, after: 1516 }, two: { before: 1500, after: 1484 } } });
    vi.advanceTimersByTime(11_500);
    const first = mocks.callbacks;
    root.querySelector<HTMLButtonElement>("[data-rematch]")!.click();
    vi.useRealTimers();
    await vi.waitFor(() => expect(mocks.callbacks).not.toBe(first));
    expect(discord.commands.authorize).toHaveBeenCalledTimes(2);
    expect(discord.close).not.toHaveBeenCalled();

    const rematched = mocks.callbacks!;
    rematched.onFatal("persistence_failed");
    expect(root.querySelector("[data-status]")?.textContent).toContain("could not be saved");
    expect(discord.close).not.toHaveBeenCalled();
    root.querySelector<HTMLButtonElement>("[data-retry]")!.click();
    await vi.waitFor(() => expect(mocks.callbacks).not.toBe(rematched));
    expect(discord.commands.authorize).toHaveBeenCalledTimes(3);
    expect(makeSdk).toHaveBeenCalledOnce();
    expect(discord.close).not.toHaveBeenCalled();

    app.destroy();
    expect(discord.close).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("reloads without closing the Activity when Discord authorization fails", async () => {
    const { DiscordActivity } = await vi.importActual<typeof import("./discord")>("./discord");
    history.replaceState({}, "", "/?instance_id=launch&frame_id=frame&platform=mobile");
    vi.stubGlobal("fetch", handsBackend());
    const discord = fakeDiscord("launch");
    discord.commands.authenticate.mockRejectedValue(new Error("host rejected"));
    const reload = vi.fn();
    const root = document.createElement("div");
    const app = new HandsApp(root, reload, new DiscordActivity(() => discord as unknown as IDiscordSDK));
    app.start();
    await vi.waitFor(() => expect(root.querySelector("[data-status]")?.textContent).toContain("(sdk_authenticate_failed)"));
    expect(discord.close).not.toHaveBeenCalled();
    root.querySelector<HTMLButtonElement>("[data-retry]")!.click();
    expect(reload).toHaveBeenCalledOnce();
    app.destroy();
    expect(discord.close).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("the corner panel", () => {
  beforeEach(() => {
    mocks.callbacks = null;
    mocks.cornerPicks.length = 0;
    vi.clearAllMocks();
  });

  it("appears to a fighter between rounds and sends the pick to the corner", async () => {
    history.replaceState({}, "", "/?instance_id=corner");
    const root = document.createElement("div");
    const app = new HandsApp(root);
    app.start();
    await vi.waitFor(() => expect(mocks.callbacks).not.toBeNull());
    send({ version: 3, type: "welcome", role: "fighter", player_id: "one", seat: 1, rating: 1500, players: [...players], server_tick: 0, next_sequence: 0, reconnect_ticket: "rotated" });
    send({ version: 3, type: "ready", players: [...players] });
    send({ version: 3, type: "snapshot", payload: makeSnapshot(10) });
    const panel = root.querySelector<HTMLElement>("[data-corner]")!;
    expect(panel.hidden).toBe(true);
    send({ version: 3, type: "snapshot", payload: makeSnapshot(11, "rest") });
    expect(panel.hidden).toBe(false);
    root.querySelector<HTMLButtonElement>('[data-corner-pick="corner_breath"]')!.click();
    expect(mocks.cornerPicks).toEqual(["corner_breath"]);
    send({ version: 3, type: "snapshot", payload: makeSnapshot(12, "fight") });
    expect(panel.hidden).toBe(true);
    app.destroy();
  });

  it("is never shown to a spectator", async () => {
    history.replaceState({}, "", "/?instance_id=corner-watch");
    const root = document.createElement("div");
    const app = new HandsApp(root);
    app.start();
    await vi.waitFor(() => expect(mocks.callbacks).not.toBeNull());
    send({ version: 3, type: "welcome", role: "spectator", player_id: "viewer", players: [...players], server_tick: 0, reconnect_ticket: "spectator" });
    send({ version: 3, type: "snapshot", payload: makeSnapshot(11, "rest") });
    expect(root.querySelector<HTMLElement>("[data-corner]")!.hidden).toBe(true);
    app.destroy();
  });
});

describe("the pick of styles", () => {
  beforeEach(() => {
    mocks.callbacks = null;
    mocks.styleChoices.length = 0;
    vi.clearAllMocks();
  });

  const launch = async (instance: string): Promise<{ app: HandsApp; root: HTMLElement }> => {
    history.replaceState({}, "", `/?instance_id=${instance}`);
    const root = document.createElement("div");
    const app = new HandsApp(root);
    app.start();
    await vi.waitFor(() => expect(mocks.callbacks).not.toBeNull());
    return { app, root };
  };

  it("offers last time's style when the pick begins, without settling on it, and never for a spectator", async () => {
    localStorage.setItem("hands.style.v1", "swarmer");
    const select = { version: 3, type: "select", deadline_ms: 9_000, players: [...players], ready: [] } as const;
    const fighterView = await launch("styles-join");
    send({ version: 3, type: "welcome", role: "fighter", player_id: "one", seat: 1, rating: 1500, players: [players[0]], server_tick: 0, next_sequence: 0 });
    expect(mocks.styleChoices).toEqual([]);
    send(select);
    expect(mocks.styleChoices).toEqual(["swarmer:false"]);
    fighterView.app.destroy();
    const watcher = await launch("styles-watch");
    send({ version: 3, type: "welcome", role: "spectator", player_id: "viewer", players: [...players], server_tick: 0 });
    send(select);
    expect(mocks.styleChoices).toEqual(["swarmer:false"]);
    watcher.app.destroy();
  });

  it("shows the pick while the room is choosing and sends a tap as the fighter's settled style", async () => {
    const { app, root } = await launch("styles-pick");
    send({ version: 3, type: "welcome", role: "fighter", player_id: "one", seat: 1, rating: 1500, players: [players[0]], server_tick: 0, next_sequence: 0 });
    send({ version: 3, type: "waiting", open_seats: 1 });
    const picker = root.querySelector<HTMLElement>("[data-style-picker]")!;
    expect(picker.hidden).toBe(true);
    send({ version: 3, type: "select", deadline_ms: 9_000, players: [players[0], { ...players[1], style: "boxer" }], ready: ["two"] });
    expect(picker.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>("[data-status]")!.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>("[data-cpu]")!.hidden).toBe(true);
    expect(picker.textContent).toContain("Two: Boxer");
    picker.querySelector<HTMLButtonElement>('[data-style="slugger"]')!.click();
    expect(mocks.styleChoices.at(-1)).toBe("slugger:true");
    expect(localStorage.getItem("hands.style.v1")).toBe("slugger");
    send({ version: 3, type: "ready", players: [{ ...players[0], style: "slugger" }, { ...players[1], style: "boxer" }] });
    expect(picker.hidden).toBe(true);
    app.destroy();
  });
});

describe("the broadcast", () => {
  beforeEach(() => {
    mocks.callbacks = null;
    mocks.renderers.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "speechSynthesis");
    Reflect.deleteProperty(window, "SpeechSynthesisUtterance");
  });

  const launch = async (): Promise<{ root: HTMLElement; app: HandsApp }> => {
    history.replaceState({}, "", "/?instance_id=broadcast");
    const root = document.createElement("div");
    const app = new HandsApp(root);
    app.start();
    await vi.waitFor(() => expect(mocks.callbacks).not.toBeNull());
    send({ version: 3, type: "welcome", role: "fighter", player_id: "one", seat: 1, rating: 1500, players: [...players], server_tick: 0, next_sequence: 0 });
    return { root, app };
  };

  it("offers caption and announcer settings, with the voice switched off where the browser cannot speak", async () => {
    const { root, app } = await launch();
    const captions = root.querySelector<HTMLInputElement>("[data-commentary]")!;
    const voice = root.querySelector<HTMLInputElement>("[data-announcer]")!;
    expect(captions.checked).toBe(true);
    expect(voice.disabled).toBe(true);
    expect(voice.checked).toBe(false);
    captions.checked = false;
    captions.dispatchEvent(new Event("change"));
    expect(JSON.parse(localStorage.getItem("hands.preferences.v1")!)).toMatchObject({ commentary: false });
    app.destroy();
  });

  it("reads the ring announcements aloud and stops when the voice is switched off", async () => {
    const spoken: string[] = [];
    const cancel = vi.fn();
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { speak: (utterance: { text: string }) => spoken.push(utterance.text), cancel, getVoices: () => [] } });
    Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: class { onend = null; onerror = null; constructor(readonly text: string) {} } });
    const { root, app } = await launch();
    const voice = root.querySelector<HTMLInputElement>("[data-announcer]")!;
    expect(voice.disabled).toBe(false);
    expect(voice.checked).toBe(true);
    mocks.renderers.at(-1)!.onAnnouncement!(["In the blue corner... One!", "And in the red corner... Two!"]);
    expect(spoken).toEqual(["In the blue corner... One!"]);
    voice.checked = false;
    voice.dispatchEvent(new Event("change"));
    expect(cancel).toHaveBeenCalled();
    app.destroy();
  });

  it("stops the announcer mid-line when the player turns the volume down to nothing", async () => {
    const cancel = vi.fn();
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { speak: () => undefined, cancel, getVoices: () => [] } });
    Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: class { onend = null; onerror = null; constructor(readonly text: string) {} } });
    const { root, app } = await launch();
    mocks.renderers.at(-1)!.onAnnouncement!(["In the blue corner... One!"]);
    const volume = root.querySelector<HTMLInputElement>("[data-volume]")!;
    volume.value = "0";
    volume.dispatchEvent(new Event("input"));
    expect(cancel).toHaveBeenCalled();
    app.destroy();
  });

  it("cuts the ring announcer off at the opening bell", async () => {
    const cancel = vi.fn();
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { speak: () => undefined, cancel, getVoices: () => [] } });
    Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: class { onend = null; onerror = null; constructor(readonly text: string) {} } });
    const { app } = await launch();
    send({ version: 3, type: "snapshot", payload: makeSnapshot(1, "countdown") });
    mocks.renderers.at(-1)!.onAnnouncement!(["In the blue corner... One!", "And in the red corner... Two!"]);
    cancel.mockClear();
    send({ version: 3, type: "snapshot", payload: makeSnapshot(2, "countdown") });
    expect(cancel).not.toHaveBeenCalled();
    send({ version: 3, type: "snapshot", payload: makeSnapshot(3, "fight") });
    expect(cancel).toHaveBeenCalled();
    app.destroy();
  });

  it("muffles the sound as the renderer shows the player's own fighter rocked, not as the snapshot arrives", async () => {
    // The stun arrives a playback delay before the punch that caused it is on screen; the renderer, which
    // shows that punch, says when he is rocked (and never does for a spectator).
    const rocked = vi.spyOn(AudioFeedback.prototype, "rocked");
    const { app } = await launch();
    send({ version: PROTOCOL_VERSION, type: "ready", players: [...players] });
    const hit = makeSnapshot(40);
    send({ version: PROTOCOL_VERSION, type: "snapshot", payload: { ...hit, fighters: [{ ...hit.fighters[0], stunned_ticks: 45 }, hit.fighters[1]] } });
    expect(rocked).not.toHaveBeenCalled();
    mocks.renderers.at(-1)!.onRocked!(1, 40);
    expect(rocked).toHaveBeenLastCalledWith(1, 40);
    app.destroy();
  });

  it("lets the crowd follow the fight", async () => {
    const tension = vi.spyOn(AudioFeedback.prototype, "tension");
    const chant = vi.spyOn(AudioFeedback.prototype, "chant");
    const { app } = await launch();
    send({ version: 3, type: "ready", players: [...players] });
    const hurt = makeSnapshot(40);
    send({ version: 3, type: "snapshot", payload: { ...hurt, fighters: [hurt.fighters[0], { ...hurt.fighters[1], stunned_ticks: 12 }] } });
    expect(tension).toHaveBeenLastCalledWith(0.75);
    mocks.renderers.at(-1)!.onCrowdCue!("chant");
    expect(chant).toHaveBeenCalledOnce();
    app.destroy();
  });
});
