import { FIGHTER_STYLES } from "./protocol";
import { loadStyle, saveStyle, STYLE_CARDS, StylePicker, styleTag, styleTitle } from "./styles";
import { publicPlayers } from "./test/fixtures";
import type { ConnectionRole, FighterStyle, SelectMessage } from "./types";

const choosing = (fields: Partial<SelectMessage> = {}): SelectMessage => ({ version: 3, type: "select", deadline_ms: 9_500, players: [publicPlayers[0], publicPlayers[1]], ready: [], ...fields });
const press = (code: string, init: KeyboardEventInit = {}): void => { window.dispatchEvent(new KeyboardEvent("keydown", { code, cancelable: true, ...init })); };

describe("style cards", () => {
  it("offer every style once, each with six strengths from one to five", () => {
    expect(STYLE_CARDS.map((card) => card.style)).toEqual([...FIGHTER_STYLES]);
    for (const card of STYLE_CARDS) {
      expect(card.stats).toHaveLength(6);
      expect(card.stats.every((value) => Number.isInteger(value) && value >= 1 && value <= 5)).toBe(true);
    }
    expect(STYLE_CARDS.find((card) => card.style === "balanced")?.stats).toEqual([3, 3, 3, 3, 3, 3]);
  });

  it("tag a name plate and title an introduction for every style but balanced", () => {
    expect(FIGHTER_STYLES.map((style) => styleTag(style))).toEqual([null, "BOXER", "SLUGGER", "SWARMER", "COUNTER"]);
    expect(FIGHTER_STYLES.map((style) => styleTitle(style))).toEqual([null, "the boxer", "the slugger", "the swarmer", "the counter-puncher"]);
    expect(styleTag(undefined)).toBeNull();
    expect(styleTitle(undefined)).toBeNull();
  });
});

describe("remembering the style", () => {
  it("brings back last time's pick and falls back to balanced when there is none to trust", () => {
    const stored = new Map<string, string>();
    const storage = { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, value); } };
    expect(loadStyle(storage)).toBe("balanced");
    saveStyle("swarmer", storage);
    expect(loadStyle(storage)).toBe("swarmer");
    stored.set("hands.style.v1", "brawler");
    expect(loadStyle(storage)).toBe("balanced");
    const blocked = { getItem: (): string | null => { throw new Error("blocked"); }, setItem: (): void => { throw new Error("blocked"); } };
    expect(loadStyle(blocked)).toBe("balanced");
    expect(() => saveStyle("boxer", blocked)).not.toThrow();
    expect(loadStyle(null)).toBe("balanced");
  });
});

describe("the style picker", () => {
  let parent: HTMLElement;
  let sent: string[];
  let clock: number;
  let accept: boolean;
  const make = (preferred: FighterStyle = "balanced"): StylePicker => new StylePicker(parent, (style, ready) => { sent.push(`${style}:${ready}`); return accept; }, () => clock, preferred);
  const show = (picker: StylePicker, select: SelectMessage = choosing(), viewer: string | null = "one", role: ConnectionRole = "fighter"): void => picker.update(select, viewer, role);
  const card = (picker: StylePicker, style: FighterStyle): HTMLButtonElement => picker.element.querySelector<HTMLButtonElement>(`[data-style="${style}"]`)!;
  const status = (picker: StylePicker): string => picker.element.querySelector(".style-status")?.textContent ?? "";
  const clockText = (picker: StylePicker): string => picker.element.querySelector(".style-clock")?.textContent ?? "";

  beforeEach(() => {
    parent = document.createElement("div");
    document.body.append(parent);
    sent = [];
    clock = 1_000;
    accept = true;
  });
  afterEach(() => parent.remove());

  it("stays hidden until the room is choosing, and again once it is done", () => {
    const picker = make();
    expect(picker.element.hidden).toBe(true);
    show(picker);
    expect(picker.element.hidden).toBe(false);
    expect([...picker.element.querySelectorAll<HTMLButtonElement>("[data-style]")].map((button) => button.dataset.style)).toEqual([...FIGHTER_STYLES]);
    picker.update(null, "one", "fighter");
    expect(picker.element.hidden).toBe(true);
    press("Digit2");
    expect(sent).toEqual(["balanced:false"]);
    picker.destroy();
  });

  it("offers last time's style, unsettled, once each time a pick begins", () => {
    const picker = make("swarmer");
    show(picker);
    expect(sent).toEqual(["swarmer:false"]);
    show(picker, choosing({ deadline_ms: 6_000 }));
    expect(sent).toEqual(["swarmer:false"]);
    picker.update(null, "one", "fighter");
    show(picker);
    expect(sent).toEqual(["swarmer:false", "swarmer:false"]);
    picker.destroy();
  });

  it("starts on last time's pick and moves with the arrow keys without settling", () => {
    const picker = make("slugger");
    show(picker);
    expect(card(picker, "slugger").getAttribute("aria-pressed")).toBe("true");
    press("ArrowRight");
    press("ArrowDown");
    press("ArrowLeft");
    press("ArrowUp");
    press("ArrowUp");
    press("ArrowUp");
    expect(sent).toEqual(["slugger:false", "swarmer:false", "counter_puncher:false", "swarmer:false", "slugger:false", "boxer:false", "balanced:false"]);
    press("ArrowLeft");
    expect(sent.at(-1)).toBe("counter_puncher:false");
    expect(card(picker, "counter_puncher").getAttribute("aria-pressed")).toBe("true");
    expect(card(picker, "counter_puncher").disabled).toBe(false);
    press("ArrowRight", { repeat: true });
    press("ArrowRight", { ctrlKey: true });
    expect(sent).toHaveLength(8);
    picker.destroy();
  });

  it("settles on Enter, then holds the pick and remembers it for next time", () => {
    const picker = make();
    show(picker);
    press("ArrowRight");
    press("Enter");
    expect(sent).toEqual(["balanced:false", "boxer:false", "boxer:true"]);
    expect(loadStyle()).toBe("boxer");
    expect(card(picker, "slugger").disabled).toBe(true);
    expect(status(picker)).toBe("Ready as Boxer. Waiting for your opponent.");
    press("Digit3");
    card(picker, "slugger").click();
    expect(sent).toHaveLength(3);
    // An update from before the room heard the pick does not undo it.
    show(picker, choosing({ ready: [] }));
    expect(card(picker, "slugger").disabled).toBe(true);
    picker.destroy();
  });

  it("settles at once on a number key or a tap", () => {
    const keyed = make();
    show(keyed);
    press("Digit3");
    expect(sent).toEqual(["balanced:false", "slugger:true"]);
    keyed.destroy();
    sent.length = 0;
    const tapped = make();
    show(tapped);
    card(tapped, "counter_puncher").click();
    expect(sent).toEqual(["balanced:false", "counter_puncher:true"]);
    expect(loadStyle()).toBe("counter_puncher");
    tapped.destroy();
  });

  it("does not settle a pick that could not be sent", () => {
    accept = false;
    const picker = make();
    show(picker);
    press("Digit4");
    expect(card(picker, "swarmer").disabled).toBe(false);
    expect(loadStyle()).toBe("balanced");
    accept = true;
    press("Digit4");
    expect(card(picker, "swarmer").disabled).toBe(true);
    picker.destroy();
  });

  it("counts down to the deadline the room gave", () => {
    vi.useFakeTimers();
    const picker = make();
    show(picker);
    expect(clockText(picker)).toBe("10s");
    clock += 4_000;
    vi.advanceTimersByTime(250);
    expect(clockText(picker)).toBe("6s");
    show(picker, choosing({ deadline_ms: 3_000 }));
    expect(clockText(picker)).toBe("3s");
    clock += 60_000;
    vi.advanceTimersByTime(250);
    expect(clockText(picker)).toBe("0s");
    picker.destroy();
  });

  it("says the other corner has settled without saying on what", () => {
    const picker = make();
    show(picker);
    expect(status(picker)).toBe("Tap a style, or use the arrow keys and Enter.");
    // Even a style the room let slip would not be named: the bell reveals both together.
    show(picker, choosing({ players: [publicPlayers[0], { ...publicPlayers[1], style: "slugger" }], ready: ["two"] }));
    expect(status(picker)).toBe("Two is ready. Tap a style or press Enter to settle on yours.");
    expect(status(picker)).not.toContain("Slugger");
    picker.destroy();
  });

  it("says who the pick is waiting on when the other corner drops, and that he is back", () => {
    const picker = make();
    const away = choosing({ players: [publicPlayers[0], { ...publicPlayers[1], connected: false }] });
    show(picker, away);
    expect(status(picker)).toBe("Waiting for Two to reconnect. Tap a style or press Enter to settle on yours.");
    card(picker, "slugger").click();
    expect(status(picker)).toBe("Ready as Slugger. Waiting for Two to reconnect.");
    show(picker, choosing());
    expect(status(picker)).toBe("Ready as Slugger. Waiting for your opponent.");
    show(picker, away, null, "spectator");
    expect(status(picker)).toBe("The fighters are choosing. Waiting for Two to reconnect.");
    picker.destroy();
  });

  it("shows the room's settled pick after a reconnect", () => {
    const picker = make("balanced");
    show(picker, choosing({ players: [{ ...publicPlayers[0], style: "swarmer" }, publicPlayers[1]], ready: ["one"] }));
    expect(card(picker, "swarmer").getAttribute("aria-pressed")).toBe("true");
    expect(card(picker, "swarmer").disabled).toBe(true);
    expect(status(picker)).toBe("Ready as Swarmer. Waiting for your opponent.");
    picker.destroy();
  });

  it("lets a spectator watch the pick but not take part", () => {
    const picker = make();
    show(picker, choosing({ players: [{ ...publicPlayers[0], style: "boxer" }, publicPlayers[1]], ready: ["one"] }), null, "spectator");
    expect(picker.element.hidden).toBe(false);
    expect([...picker.element.querySelectorAll<HTMLButtonElement>("[data-style]")].every((button) => button.disabled && button.getAttribute("aria-pressed") === "false")).toBe(true);
    press("Digit2");
    press("Enter");
    card(picker, "boxer").click();
    expect(sent).toEqual([]);
    expect(status(picker)).toBe("The fighters are choosing. One is ready.");
    picker.destroy();
  });

  it("stops listening for keys once destroyed", () => {
    const added = vi.spyOn(window, "addEventListener");
    const removed = vi.spyOn(window, "removeEventListener");
    const picker = make();
    show(picker);
    const listener = added.mock.calls.find(([type]) => type === "keydown")?.[1];
    picker.destroy();
    expect(listener).toBeDefined();
    expect(removed).toHaveBeenCalledWith("keydown", listener);
    press("Digit1");
    expect(sent).toEqual(["balanced:false"]);
    expect(parent.contains(picker.element)).toBe(false);
  });
});
