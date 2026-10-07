import manifest from "../../../src/intelstream/hands/combat-manifest.json";
import { FIGHTER_STYLES } from "./protocol";
import { loadStyle, saveStyle, STYLE_CARDS, StylePicker, styleTag, styleTitle } from "./styles";
import { publicPlayers } from "./test/fixtures";
import type { ConnectionRole, FighterStyle, SelectMessage } from "./types";

/** A style's rule as the manifest gives it; every number it leaves out is the balanced fighter's. */
interface ManifestStyle {
  readonly impact_percent?: number;
  readonly body_damage_percent?: number;
  readonly poise_damage_percent?: number;
  readonly reach_percent?: number;
  readonly move_speed_percent?: number;
  readonly stamina_cost_percent?: number;
  readonly conditioning_loss_percent?: number;
  readonly startup_ticks?: Readonly<Record<string, number>>;
  readonly recovery_ticks?: Readonly<Record<string, number>>;
}

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

  it("show the strengths the manifest's numbers give each style, so a change to either is caught", () => {
    // A bar is three at the balanced fighter's number and moves a step for each `step` away from it.
    const bar = (measure: number, neutral: number, step: number): number => Math.max(1, Math.min(5, 3 + Math.round((measure - neutral) / step)));
    const rules = manifest.styles as Readonly<Record<string, ManifestStyle>>;
    for (const card of STYLE_CARDS) {
      const rule = rules[card.style] ?? {};
      // Power: how hard the punches land, one in three to the body, and how much poise they take.
      const power = ((rule.impact_percent ?? 100) * (200 + (rule.body_damage_percent ?? 100)) / 300) * (rule.poise_damage_percent ?? 100) / 100;
      // Hand speed: the ticks a style takes off (or puts on) its punches' startup and recovery.
      const ticks = [...Object.values(rule.startup_ticks ?? {}), ...Object.values(rule.recovery_ticks ?? {})].reduce((sum, value) => sum + value, 0);
      // Stamina: what the punches cost, and how slowly the conditioning drains.
      const stamina = (100 - (rule.stamina_cost_percent ?? 100)) + (100 - (rule.conditioning_loss_percent ?? 100)) / 2;
      // Defence weighs the chin, head movement and parries against each other, so it is set by hand.
      const [power_, speed, footwork, reach, endurance] = card.stats;
      expect({ style: card.style, power: power_, speed, footwork, reach, stamina: endurance }).toEqual({
        style: card.style,
        power: bar(power, 100, 6),
        speed: bar(-ticks, 0, 2),
        footwork: bar(rule.move_speed_percent ?? 100, 100, 4),
        reach: bar(rule.reach_percent ?? 100, 100, 2),
        stamina: bar(stamina, 0, 10),
      });
    }
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

  it("settles on Enter, then holds the pick, and leaves remembering it to the room's word", () => {
    const picker = make();
    show(picker);
    press("ArrowRight");
    press("Enter");
    expect(sent).toEqual(["balanced:false", "boxer:false", "boxer:true"]);
    // Remembered once the room's ready says it is the style he boxes in (app.ts).
    expect(loadStyle()).toBe("balanced");
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

  it("lets Enter or Space on a focused card settle that card, not the highlighted one", () => {
    const picker = make();
    show(picker);
    const slugger = card(picker, "slugger");
    slugger.focus();
    for (const code of ["Enter", "Space"]) {
      const key = new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true });
      slugger.dispatchEvent(key);
      // The browser's own activation of the focused button does the settling.
      expect(key.defaultPrevented).toBe(false);
    }
    expect(sent).toEqual(["balanced:false"]);
    slugger.click();
    expect(sent).toEqual(["balanced:false", "slugger:true"]);
    picker.destroy();
  });

  it("leaves keys typed into Settings or another control to that control", () => {
    const picker = make();
    show(picker);
    const panel = document.createElement("aside");
    panel.className = "panel";
    panel.innerHTML = `<input data-volume type="range"><input data-haptics type="checkbox"><button type="button">Settings</button>`;
    parent.append(panel);
    for (const [selector, code] of [["[data-volume]", "ArrowRight"], ["[data-volume]", "Digit3"], ["[data-haptics]", "Space"], ["button", "Enter"]] as const) {
      const control = panel.querySelector<HTMLElement>(selector)!;
      control.focus();
      const key = new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true });
      control.dispatchEvent(key);
      expect(key.defaultPrevented).toBe(false);
    }
    expect(sent).toEqual(["balanced:false"]);
    picker.destroy();
  });

  it("moves the keyboard focus with the highlight, so Tab and the arrows agree", () => {
    const picker = make("boxer");
    show(picker);
    const tabbable = (): string[] => [...picker.element.querySelectorAll<HTMLButtonElement>("[data-style]")].filter((button) => button.tabIndex === 0).map((button) => button.dataset.style!);
    expect(tabbable()).toEqual(["boxer"]);
    card(picker, "boxer").focus();
    card(picker, "boxer").dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowRight", bubbles: true, cancelable: true }));
    expect(sent.at(-1)).toBe("slugger:false");
    expect(document.activeElement).toBe(card(picker, "slugger"));
    expect(tabbable()).toEqual(["slugger"]);
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
    tapped.destroy();
  });

  it("stops taking picks in the last moments, when one would reach the room after it closed", () => {
    vi.useFakeTimers();
    const picker = make();
    show(picker);
    // 300 ms of the room's 9.5 s are left on this page's clock: half a round trip from now, none.
    clock += 9_200;
    vi.advanceTimersByTime(250);
    expect(clockText(picker)).toBe("0s");
    expect([...picker.element.querySelectorAll<HTMLButtonElement>("[data-style]")].every((button) => button.disabled)).toBe(true);
    press("Digit3");
    press("ArrowRight");
    press("Enter");
    card(picker, "slugger").click();
    expect(sent).toEqual(["balanced:false"]);
    // A fresh deadline from the room opens the pick again.
    show(picker, choosing({ deadline_ms: 4_000 }));
    expect(card(picker, "slugger").disabled).toBe(false);
    press("Digit3");
    expect(sent).toEqual(["balanced:false", "slugger:true"]);
    picker.destroy();
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

  it("names the other corner's style once that fighter has settled", () => {
    const picker = make();
    show(picker);
    expect(status(picker)).toBe("Tap a style, or use the arrow keys and Enter.");
    show(picker, choosing({ players: [publicPlayers[0], { ...publicPlayers[1], style: "slugger" }], ready: ["two"] }));
    expect(status(picker)).toBe("Two: Slugger. Tap a style or press Enter to settle on yours.");
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
    expect(status(picker)).toBe("The fighters are choosing. One: Boxer");
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
