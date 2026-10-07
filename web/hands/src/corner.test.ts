import { CORNER_TREATMENTS, EYE_SHUT_TRAUMA } from "./manifest";
import { CORNER_PAD_BUTTONS, CornerPanel, cornerPreview } from "./corner";
import { fighter, snapshot } from "./test/fixtures";
import type { CornerChoice, CornerKind, EngineSnapshot } from "./types";

const resting = (choice: CornerChoice | null = null, trauma: Partial<EngineSnapshot["fighters"][0]["trauma"]> = {}): EngineSnapshot => {
  const base = snapshot();
  return { ...base, phase: "rest", phase_ticks_remaining: 300, fighters: [{ ...base.fighters[0], corner_choice: choice, trauma: { ...base.fighters[0].trauma, ...trauma } }, base.fighters[1]] };
};

function panel(pick: (kind: CornerKind) => boolean = () => true, now: () => number = () => 0): { panel: CornerPanel; root: HTMLElement; buttons: () => HTMLButtonElement[]; status: () => string } {
  const root = document.createElement("div");
  document.body.append(root);
  const created = new CornerPanel(root, pick, now);
  return {
    panel: created,
    root,
    buttons: () => [...root.querySelectorAll<HTMLButtonElement>("[data-corner-pick]")],
    status: () => root.querySelector(".corner-status")?.textContent ?? "",
  };
}

const press = (code: string): void => { window.dispatchEvent(new KeyboardEvent("keydown", { code })); };

describe("the corner between rounds", () => {
  afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

  it("is shown only to a fighter, and only during the rest", () => {
    const { panel: corner, root } = panel();
    corner.update(resting(), "one", true);
    expect(root.querySelector<HTMLElement>("[data-corner]")!.hidden).toBe(false);
    corner.update(resting(), "one", false);
    expect(root.querySelector<HTMLElement>("[data-corner]")!.hidden).toBe(true);
    corner.update(snapshot(), "one", true);
    expect(root.querySelector<HTMLElement>("[data-corner]")!.hidden).toBe(true);
    corner.update(resting(), "nobody", true);
    expect(root.querySelector<HTMLElement>("[data-corner]")!.hidden).toBe(true);
    corner.destroy();
  });

  it("calls a click to the corner once and waits for the server", () => {
    const picks: CornerKind[] = [];
    const { panel: corner, buttons, status } = panel((kind) => { picks.push(kind); return true; });
    corner.update(resting(), "one", true);
    buttons()[1]!.click();
    buttons()[0]!.click();
    expect(picks).toEqual(["corner_swelling"]);
    expect(buttons().map((button) => button.disabled)).toEqual([true, true, true]);
    expect(buttons().map((button) => button.hasAttribute("data-picked"))).toEqual([false, true, false]);
    expect(status()).toMatch(/calling/i);
    corner.destroy();
  });

  it("takes the number keys only while it is on screen", () => {
    const picks: CornerKind[] = [];
    const { panel: corner } = panel((kind) => { picks.push(kind); return true; });
    const during = new KeyboardEvent("keydown", { code: "Digit1", cancelable: true });
    window.dispatchEvent(during);
    expect(during.defaultPrevented).toBe(false);
    press("Digit3");
    expect(picks).toEqual([]);
    corner.update(resting(), "one", true);
    press("Numpad3");
    expect(picks).toEqual(["corner_breath"]);
    corner.destroy();
    press("Digit1");
    expect(picks).toEqual(["corner_breath"]);
  });

  it("shows what the corner is doing once the server confirms it", () => {
    const { panel: corner, buttons, status } = panel();
    corner.update(resting("cut"), "one", true);
    expect(status()).toBe("Your corner is closing the cut.");
    expect(buttons().map((button) => button.disabled)).toEqual([true, true, true]);
    expect(buttons().map((button) => button.hasAttribute("data-picked"))).toEqual([true, false, false]);
    corner.destroy();
  });

  it("offers the choice again when the server never confirms it", () => {
    let time = 0;
    const picks: CornerKind[] = [];
    const { panel: corner, buttons } = panel((kind) => { picks.push(kind); return true; }, () => time);
    corner.update(resting(), "one", true);
    buttons()[0]!.click();
    time = 1000;
    corner.update(resting(), "one", true);
    expect(buttons()[2]!.disabled).toBe(true);
    time = 1600;
    corner.update(resting(), "one", true);
    expect(buttons().map((button) => button.disabled)).toEqual([false, false, false]);
    buttons()[2]!.click();
    expect(picks).toEqual(["corner_cut", "corner_breath"]);
    corner.destroy();
  });

  it("stays open when the instruction could not be sent", () => {
    const { panel: corner, buttons } = panel(() => false);
    corner.update(resting(), "one", true);
    buttons()[0]!.click();
    expect(buttons().map((button) => button.disabled)).toEqual([false, false, false]);
    corner.destroy();
  });

  it("maps the left, top and right face buttons to the cut, the swelling and the breath", () => {
    expect(CORNER_PAD_BUTTONS).toEqual({ 2: "corner_cut", 3: "corner_swelling", 1: "corner_breath" });
  });

  it("tells the caption where its top edge is while it is up", () => {
    const { panel: corner } = panel(() => true);
    expect(corner.top()).toBeNull();
    corner.update(resting(), "one", true);
    corner.element.getBoundingClientRect = () => ({ top: 520, height: 130 }) as DOMRect;
    corner.element.parentElement!.getBoundingClientRect = () => ({ top: 20, height: 720 }) as DOMRect;
    expect(corner.top()).toBe(500);
    corner.update(resting(), "one", false);
    expect(corner.top()).toBeNull();
    corner.destroy();
  });

  it("takes the controller's face buttons", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { frames.push(callback); return frames.length; });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const button = (kind: CornerKind): number => Number(Object.entries(CORNER_PAD_BUTTONS).find(([, candidate]) => candidate === kind)![0]);
    const held = new Set<number>();
    const pad = { connected: true, mapping: "standard", get buttons() { return Array.from({ length: 16 }, (_unused, index) => ({ pressed: held.has(index) })); } } as unknown as Gamepad;
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [pad] });
    const picks: CornerKind[] = [];
    const { panel: corner } = panel((kind) => { picks.push(kind); return true; });
    // A punch button still held from the last exchange as the bell rings is not a pick.
    held.add(button("corner_cut"));
    corner.update(resting(), "one", true);
    frames.shift()!(0);
    expect(picks).toEqual([]);
    held.delete(button("corner_cut"));
    frames.shift()!(0);
    held.add(button("corner_swelling"));
    frames.shift()!(0);
    expect(picks).toEqual(["corner_swelling"]);
    corner.destroy();
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: undefined });
  });
});

describe("what each instruction would do", () => {
  it("previews the cut, the eye and the health in the HUD's terms", () => {
    const hurt = { ...fighter("one"), conditioning: 500, trauma: { ...fighter("one").trauma, left_cut: 600, right_cut: 200, right_eye: EYE_SHUT_TRAUMA + 20, swelling: 300 } };
    const preview = cornerPreview(hurt);
    expect(preview.cut).toBe(`Cut 600 → ${600 - CORNER_TREATMENTS.cut.worse_cut}`);
    expect(preview.swelling).toBe(`Eye ${EYE_SHUT_TRAUMA + 20} → ${EYE_SHUT_TRAUMA + 20 - CORNER_TREATMENTS.swelling.eyes} · opens the eye`);
    expect(preview.breath).toBe(`Health 500 → ${500 + CORNER_TREATMENTS.breath.conditioning} · full stamina`);
  });

  it("says when there is nothing to treat, and when an eye stays shut", () => {
    const fresh = cornerPreview(fighter("one"));
    expect(fresh.cut).toBe("No cut to close");
    expect(fresh.swelling).toBe("No swelling");
    const closed = cornerPreview({ ...fighter("one"), trauma: { ...fighter("one").trauma, left_eye: 1000 } });
    expect(closed.swelling).toMatch(/stays shut$/u);
  });
});
