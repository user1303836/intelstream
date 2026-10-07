import { mockHudContext } from "../test/fixtures";
import type { MatchPhase } from "../types";
import { cardMetrics, captionSlot, drawCaption, splitLine, type CaptionScene } from "./caption";
import type { BroadcastLine, Caption } from "./commentary";
import { panelHeightFor, topPanelOffset } from "./hud";

const scene = (width: number, height: number, phase: MatchPhase = "fight", extra: Partial<CaptionScene> = {}): CaptionScene => ({ width, height, phase, resultTop: null, touch: false, hint: false, viewerDown: false, replay: false, ...extra });
const line = (text: string, extra: Partial<BroadcastLine> = {}): BroadcastLine => ({ speaker: "play", text, priority: 50, urgent: false, hold: 3, card: null, ...extra });
const shown = (value: BroadcastLine, opacity = 1, entering = 0): Caption => ({ line: value, opacity, entering });

describe("caption placement", () => {
  it("sits in the lower third above the plates on a desktop, and above the controls hint in the countdown", () => {
    expect(captionSlot(scene(1280, 720))).toMatchObject({ anchor: "bottom", y: 720 - 110, x: 640, maxWidth: 680, scale: 1 });
    expect(captionSlot(scene(1280, 720, "fight", { hint: true }))).toMatchObject({ anchor: "bottom", y: 720 - 168 });
    expect(captionSlot(scene(1280, 720, "knockdown", { viewerDown: true }))).toMatchObject({ anchor: "bottom" });
  });

  it("moves to the top on phones, under the round clock in portrait and clear of the touch pads", () => {
    expect(captionSlot(scene(390, 844, "fight", { touch: true }))).toMatchObject({ anchor: "top", y: 136, maxWidth: 366, scale: 0.85 });
    expect(captionSlot(scene(844, 390, "fight", { touch: true }))).toMatchObject({ anchor: "top", y: 54, scale: 0.78, maxWidth: 844 - 432 });
    expect(captionSlot(scene(844, 390, "fight"))).toMatchObject({ maxWidth: 680 });
  });

  it("covers the countdown panel with the introductions on every screen and keeps below the rest panel", () => {
    for (const [width, height, touch] of [[390, 844, true], [844, 390, true], [1280, 720, false]] as const) {
      const countdown = captionSlot(scene(width, height, "countdown", { touch, hint: true }))!;
      expect(countdown.y).toBeCloseTo(height / 2 + topPanelOffset(width, height) - panelHeightFor(height) / 2);
      expect(countdown.cover).toEqual({ width: Math.min(320, width - 24), height: panelHeightFor(height) });
    }
    const rest = captionSlot(scene(844, 390, "rest", { touch: true }))!;
    expect(rest.y).toBeCloseTo(390 / 2 + topPanelOffset(844, 390) + panelHeightFor(390) / 2 + 8);
  });

  it("gives way where nothing would stay clear of the fighters", () => {
    expect(captionSlot(scene(844, 390, "knockdown", { touch: true }))).toBeNull();
    expect(captionSlot(scene(390, 844, "knockdown", { touch: true, viewerDown: true }))).toBeNull();
  });

  it("keeps clear of the replay tag", () => {
    expect(captionSlot(scene(390, 844, "complete", { touch: true, replay: true }))!.y).toBe(120 + 34 + 8);
  });

  it("goes above the result card once it is up, or nowhere", () => {
    expect(captionSlot(scene(1280, 720, "complete", { resultTop: 420 }))).toMatchObject({ anchor: "top", y: 54 });
    expect(captionSlot(scene(844, 390, "complete", { resultTop: 110 }))).toBeNull();
  });
});

describe("caption drawing", () => {
  it("names the speaker and draws the line", () => {
    const texts: string[] = [];
    drawCaption(mockHudContext(texts), shown(line("Down goes Crimson Geometry!")), captionSlot(scene(1280, 720))!, false);
    expect(texts).toEqual(["CALLAHAN", "Down goes Crimson Geometry!"]);
    const colour: string[] = [];
    drawCaption(mockHudContext(colour), shown(line("Tough round to score.", { speaker: "colour" })), captionSlot(scene(1280, 720))!, false);
    expect(colour[0]).toBe("OKAFOR");
  });

  it("wraps a long line onto two rows on a phone rather than shrinking it away", () => {
    const texts: string[] = [];
    const text = "Crimson Geometry is just covering up as Azure Vector lets the hands go!";
    drawCaption(mockHudContext(texts), shown(line(text)), captionSlot(scene(390, 844, "fight", { touch: true }))!, false);
    expect(texts).toHaveLength(3);
    expect(`${texts[1]} ${texts[2]}`).toBe(text);
  });

  it("splits at the space that balances the rows", () => {
    expect(splitLine("aaaa bbbb cccc dddd", (part) => part.length <= 10)).toEqual(["aaaa bbbb", "cccc dddd"]);
    expect(splitLine("aaaaaaaa bb", (part) => part.length <= 8)).toEqual(["aaaaaaaa", "bb"]);
  });

  it("draws an announcer card as kicker, title and detail", () => {
    const texts: string[] = [];
    const card = line("In the blue corner, Azure Vector.", { speaker: "announcer", urgent: true, card: { kicker: "IN THE BLUE CORNER", title: "AZURE VECTOR", detail: "RATED 1512", corner: 0 } });
    drawCaption(mockHudContext(texts), shown(card), captionSlot(scene(1280, 720))!, false);
    expect(texts).toEqual(["IN THE BLUE CORNER", "AZURE VECTOR", "RATED 1512"]);
  });

  it("fits an introduction inside the panel it covers: tighter, then without the rating, then a smaller name", () => {
    expect(cardMetrics(1, true, null).height).toBeGreaterThan(78);
    const tall = cardMetrics(1, true, 78);
    expect(tall.height).toBeLessThanOrEqual(78);
    expect(tall.detail).toBeGreaterThan(0);
    expect(tall.title).toBe(28);
    const short = cardMetrics(0.78, true, 50);
    expect(short.height).toBeLessThanOrEqual(50);
    expect(short.detail).toBe(0);
    expect(short.title).toBe(Math.round(28 * 0.78));
    const tiny = cardMetrics(0.78, true, 36);
    expect(tiny.height).toBeLessThanOrEqual(36);
    expect(tiny.title).toBeLessThan(Math.round(28 * 0.78));
    expect(cardMetrics(1, true, 200)).toEqual(cardMetrics(1, true, null));
  });

  it("draws the introduction over the whole countdown panel", () => {
    const rects: Array<[number, number, number, number]> = [];
    const context = Object.assign(mockHudContext([]), { fillRect: (x: number, y: number, w: number, h: number) => rects.push([x, y, w, h]) });
    const slot = captionSlot(scene(390, 844, "countdown", { touch: true }))!;
    const card = line("In the blue corner, Azure Vector.", { speaker: "announcer", urgent: true, card: { kicker: "IN THE BLUE CORNER", title: "AZURE VECTOR", detail: "RATED 1512", corner: 0 } });
    drawCaption(context, shown(card, 1, 1), slot, false);
    const [x, y, w, h] = rects[0]!;
    expect(x).toBeLessThanOrEqual(390 / 2 - 160);
    expect(x + w).toBeGreaterThanOrEqual(390 / 2 + 160);
    expect(y).toBeCloseTo(slot.y);
    expect(h).toBeGreaterThanOrEqual(panelHeightFor(844));
  });

  it("fades and eases in, but with reduced motion it simply appears", () => {
    const fading = mockHudContext([]);
    drawCaption(fading, shown(line("Big right hand from Azure Vector!"), 0.4, 0.6), captionSlot(scene(1280, 720))!, false);
    // The last thing drawn is the words, which fade as the square of the plate's opacity.
    expect(fading.globalAlpha).toBeCloseTo(0.16, 6);
    const still = mockHudContext([]);
    drawCaption(still, shown(line("Big right hand from Azure Vector!"), 0.4, 0.6), captionSlot(scene(1280, 720))!, true);
    expect(still.globalAlpha).toBe(1);
    const hidden: string[] = [];
    drawCaption(mockHudContext(hidden), shown(line("Gone"), 0), captionSlot(scene(1280, 720))!, false);
    expect(hidden).toEqual([]);
  });
});

describe("a caption fading in or out", () => {
  it("fades its words faster than its plate, so no ghost text floats over the fighters", () => {
    const plates: number[] = [];
    const words: number[] = [];
    const ctx = {
      globalAlpha: 1, font: "", fillStyle: "", textAlign: "left", textBaseline: "alphabetic",
      save: () => undefined, restore: () => undefined,
      measureText: (text: string) => ({ width: text.length * 7 }),
      fillRect(this: { globalAlpha: number }) { plates.push(this.globalAlpha); },
      fillText(this: { globalAlpha: number }) { words.push(this.globalAlpha); },
    } as unknown as CanvasRenderingContext2D;
    const slot = { x: 640, y: 600, maxWidth: 600, anchor: "bottom" as const, scale: 1, cover: null };
    const line = { speaker: "play" as const, text: "Down goes Two!", priority: 95, urgent: true, hold: 3, card: null };
    drawCaption(ctx, { line, opacity: 0.3, entering: 0 }, slot, false);
    expect(Math.min(...plates)).toBeCloseTo(0.3, 6);
    expect(Math.max(...words)).toBeCloseTo(0.09, 6);
    plates.length = 0;
    words.length = 0;
    drawCaption(ctx, { line: { ...line, card: { kicker: "THE WINNER, BY UNANIMOUS DECISION", title: "TWO", detail: "", corner: 1 } }, opacity: 0.3, entering: 0 }, slot, false);
    expect(Math.max(...words)).toBeCloseTo(0.09, 6);
    drawCaption(ctx, { line, opacity: 1, entering: 0 }, slot, false);
    expect(words.at(-1)).toBe(1);
  });
});
