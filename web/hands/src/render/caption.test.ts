import { readFileSync } from "node:fs";
import { mockHudContext } from "../test/fixtures";
import type { MatchPhase } from "../types";
import { cardMetrics, captionSlot, drawCaption, splitLine, TOUCH_PADS, type CaptionScene } from "./caption";
import type { BroadcastLine, Caption } from "./commentary";
import { COUNT_BELOW_HEADLINE, headlineBaseline, panelHeightFor, topPanelOffset } from "./hud";

const scene = (width: number, height: number, phase: MatchPhase = "fight", extra: Partial<CaptionScene> = {}): CaptionScene => ({ width, height, phase, resultTop: null, touch: false, hint: false, viewerDown: false, replay: false, ...extra });
const line = (text: string, extra: Partial<BroadcastLine> = {}): BroadcastLine => ({ speaker: "play", text, priority: 50, urgent: false, hold: 3, card: null, ...extra });
const shown = (value: BroadcastLine, opacity = 1, entering = 0): Caption => ({ line: value, opacity, entering });

describe("caption placement", () => {
  it("sits in the lower third above the plates on a desktop, and above the controls hint in the countdown", () => {
    expect(captionSlot(scene(1280, 720))).toMatchObject({ anchor: "bottom", y: 720 - 110, x: 640, maxWidth: 680, scale: 1 });
    expect(captionSlot(scene(1280, 720, "fight", { hint: true }))).toMatchObject({ anchor: "bottom", y: 720 - 168 });
    expect(captionSlot(scene(1280, 720, "knockdown", { viewerDown: true }))).toMatchObject({ anchor: "bottom" });
  });

  it("keeps above the fighter's corner panel between rounds", () => {
    // The panel's top edge as the browser lays it out at 1280x720: 124 px off the bottom, about 130 px tall.
    const slot = captionSlot(scene(1280, 720, "rest", { cornerPanelTop: 466 }));
    expect(slot).toMatchObject({ anchor: "bottom" });
    expect(slot!.y).toBeLessThanOrEqual(466 - 8);
    expect(captionSlot(scene(1280, 720, "rest", { cornerPanelTop: null }))).toMatchObject({ anchor: "bottom", y: 720 - 110 });
    // A panel reaching too far up for a line above it sends the caption up under the rest panel instead.
    const high = captionSlot(scene(1280, 720, "rest", { cornerPanelTop: 340 }));
    expect(high === null || (high.anchor === "top" && high.y + 74 <= 340)).toBe(true);
  });

  it("keeps below a big callout on phones", () => {
    for (const [width, height] of [[390, 844], [844, 390]] as const) {
      const quiet = captionSlot(scene(width, height, "fight", { touch: true }))!;
      const slot = captionSlot(scene(width, height, "fight", { touch: true, callout: true }));
      // The callout is 46 px type on a baseline 22% down the screen.
      const calloutBottom = height * 0.22 + 14;
      expect(slot === null || (slot.anchor === "top" && slot.y >= calloutBottom)).toBe(true);
      expect(quiet.y).toBeLessThan(calloutBottom);
    }
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

  it("leaves the slow-connection warning its corner beside the touch pads", () => {
    // hud.ts sets it from x 24 on a 76 px baseline: "SLOW CONNECTION 180 ms" in 11 px monospace is about 135 px.
    const quiet = captionSlot(scene(932, 430, "fight", { touch: true }))!;
    const slow = captionSlot(scene(932, 430, "fight", { touch: true, lag: true }))!;
    expect(quiet.x - quiet.maxWidth / 2).toBeLessThan(24 + 135);
    expect(slow.x - slow.maxWidth / 2).toBeGreaterThanOrEqual(24 + 160 + 8);
    // A phone held upright has no warning on its broadcast, and a caption below it has nothing to leave room for.
    expect(captionSlot(scene(390, 844, "fight", { touch: true, lag: true }))).toEqual(captionSlot(scene(390, 844, "fight", { touch: true })));
    expect(captionSlot(scene(932, 430, "rest", { touch: true, lag: true }))).toEqual(captionSlot(scene(932, 430, "rest", { touch: true })));
  });

  it("keeps a knockdown caption under the count on a phone, or gives way", () => {
    for (const [width, height] of [[320, 568], [360, 640], [375, 667], [360, 740], [375, 812], [390, 844], [412, 915]] as const) {
      // The 36 px figures stand on this baseline (hud.ts), with nothing below it.
      const count = headlineBaseline(height, true) + COUNT_BELOW_HEADLINE;
      for (const touch of [false, true]) {
        const slot = captionSlot(scene(width, height, "knockdown", { touch }));
        const top = slot === null ? null : slot.anchor === "top" ? slot.y : slot.y - 74 * slot.scale;
        expect(top === null || top >= count + 4, `${width}x${height}${touch ? " with the pads" : ""}: ${top} under ${count}`).toBe(true);
      }
    }
    expect(captionSlot(scene(390, 844, "knockdown", { touch: true }))?.y).toBeGreaterThanOrEqual(headlineBaseline(844, true) + COUNT_BELOW_HEADLINE + 4);
  });

  it("never draws a caption under the touch pads, upright or on its side", () => {
    // The pads as Edge lays out style.css: upright one 190 x 274 column 12 px in and 118 px up; on its side the
    // modifiers and punch pads, 190 x 196, with the moves 122 x 102 at the foot, 12 px to their left; and on a
    // screen 350 px tall or less, 188 x 154 and 120 x 86, 112 px up.
    const pads = (width: number, height: number) => width <= height
      ? [{ left: width - 202, right: width - 12, top: height - 392, bottom: height - 118 }]
      : height <= 350
        ? [{ left: width - 200, right: width - 12, top: height - 266, bottom: height - 112 }, { left: width - 332, right: width - 212, top: height - 198, bottom: height - 112 }]
        : [{ left: width - 202, right: width - 12, top: height - 314, bottom: height - 118 }, { left: width - 336, right: width - 214, top: height - 220, bottom: height - 118 }];
    // The longest line the commentary has, which wraps onto two rows.
    const longest = line("Crimson Geometry is just covering up as Azure Vector lets the hands go, and the referee is taking a long look!");
    let drawn = 0;
    for (const [width, height] of [[320, 568], [360, 640], [375, 667], [390, 844], [412, 915], [568, 320], [640, 320], [640, 350], [640, 360], [667, 375], [740, 360], [844, 390], [932, 430]] as const) {
      for (const phase of ["fight", "knockdown", "rest", "foul_recovery"] as const) {
        for (const extra of [{}, { callout: true }, { replay: true }]) {
          const slot = captionSlot(scene(width, height, phase, { touch: true, ...extra }));
          if (slot === null) continue;
          drawn += 1;
          const plates: Array<{ x: number; y: number; w: number; h: number }> = [];
          drawCaption(Object.assign(mockHudContext([]), { fillRect: (x: number, y: number, w: number, h: number) => plates.push({ x, y, w, h }) }), shown(longest), slot, true);
          const plate = plates[0]!;
          expect(plate.w, `${width}x${height} ${phase}`).toBeGreaterThan(0);
          for (const pad of pads(width, height)) {
            const clear = plate.x + plate.w <= pad.left || plate.x >= pad.right || plate.y + plate.h <= pad.top || plate.y >= pad.bottom;
            expect(clear, `${width}x${height} ${phase} ${JSON.stringify(extra)}: caption ${JSON.stringify(plate)} under the pads ${JSON.stringify(pad)}`).toBe(true);
          }
        }
      }
    }
    // Most of these still have their caption, beside the pads or above them.
    expect(drawn).toBeGreaterThan(40);
  });

  it("keeps clear of the replay tag", () => {
    expect(captionSlot(scene(390, 844, "complete", { touch: true, replay: true }))!.y).toBe(120 + 34 + 8);
  });

  it("goes above the result card once it is up, or nowhere", () => {
    expect(captionSlot(scene(1280, 720, "complete", { resultTop: 420 }))).toMatchObject({ anchor: "top", y: 54 });
    expect(captionSlot(scene(844, 390, "complete", { resultTop: 110 }))).toBeNull();
  });
});

describe("the touch pads, as style.css lays them out", () => {
  const sheet = readFileSync("src/style.css", "utf8");
  /** A media block of the sheet, from its opening to its last rule. */
  const media = (query: string): string => {
    const start = sheet.indexOf(`@media${query}{`);
    return start < 0 ? "" : sheet.slice(start, sheet.indexOf("}}", start) + 2);
  };
  const declarations = (css: string, selector: string): string => new RegExp(`[{}\\n]${selector.replace(/[.()[\]]/gu, "\\$&")}\\{([^}]*)\\}`, "u").exec(`\n${css}`)?.[1] ?? "";
  const px = (css: string, property: string): number => Number(new RegExp(`(?:^|;)${property}:(?:max\\()?(\\d+)px`, "u").exec(css)?.[1]);
  /** The width of a grid of fixed columns. */
  const columns = (css: string, gap: number): number => {
    const [, count, size] = /repeat\((\d+),(\d+)px\)/u.exec(css)!;
    return Number(count) * Number(size) + (Number(count) - 1) * gap;
  };
  const rows = (count: number, height: number, gap: number): number => count * height + (count - 1) * gap;

  it("are the size the captions keep clear of", () => {
    const pads = declarations(sheet, ".touch-pads");
    const grid = declarations(sheet, ".touch-grid");
    const mods = declarations(sheet, ".touch-mods");
    const moves = declarations(sheet, ".touch-moves");
    const [pad, mod, move] = [".touch-pad", ".touch-mod", ".touch-move"].map((selector) => px(declarations(sheet, selector), "height")) as [number, number, number];
    // Upright: two rows of moves, the modifiers and the punch pads, one above another.
    const stack = rows(2, mod, px(mods, "gap")) + px(pads, "gap") + rows(2, pad, px(grid, "gap"));
    expect({ bottom: px(pads, "bottom"), height: rows(2, move, px(moves, "gap")) + px(moves, "margin-bottom") + px(pads, "gap") + stack }).toEqual({ bottom: TOUCH_PADS.upright.bottom, height: TOUCH_PADS.upright.height });
    expect(px(pads, "right") + columns(grid, px(grid, "gap")) + 14).toBe(TOUCH_PADS.reach);
    // On its side the moves stand in three rows in a column of their own, to the left of the other two.
    const side = media("(orientation:landscape)");
    expect({ height: stack, moves: rows(3, move, px(moves, "gap")) }).toEqual({ height: TOUCH_PADS.landscape.height, moves: TOUCH_PADS.landscape.moves });
    expect(columns(declarations(side, ".touch-moves"), px(moves, "gap")) + px(declarations(side, ".touch-pads"), "column-gap")).toBe(TOUCH_PADS.movesReach);
    // A short screen on its side gets smaller ones, lower down.
    const short = media(`(orientation:landscape) and (max-height:${TOUCH_PADS.shortHeight}px)`);
    const gap = px(declarations(short, ".touch-grid,.touch-mods,.touch-moves"), "gap");
    const [shortPad, shortMod] = [".touch-pad", ".touch-mod,.touch-move"].map((selector) => px(declarations(short, selector), "height")) as [number, number];
    const shortPads = declarations(short, ".touch-pads");
    expect({ bottom: px(shortPads, "bottom"), height: rows(2, shortMod, gap) + px(shortPads, "row-gap") + rows(2, shortPad, gap), moves: rows(3, shortMod, gap) }).toEqual(TOUCH_PADS.short);
  });

  it("keep the touch hint 12 px to their left, held upright or on its side", () => {
    // max-width: min(44vw, 300px, calc(100vw - Npx - the side insets)), and the hint stands 12 px in from the left.
    const cap = (css: string): [number, number, number] => {
      const [, vw, most, offset] = /max-width:min\((\d+)vw,(\d+)px,calc\(100vw - (\d+)px - env\(safe-area-inset-left\) - env\(safe-area-inset-right\)\)\)/u.exec(css) ?? [];
      return [Number(vw), Number(most), Number(offset)];
    };
    const upright = cap(declarations(sheet, ".overlay[data-touch-hint]"));
    const sideways = cap(declarations(sheet.slice(sheet.indexOf("@media(orientation:landscape){.overlay[data-touch-hint]")), ".overlay[data-touch-hint]"));
    const right = ([vw, most, offset]: [number, number, number], width: number): number => 12 + Math.min((vw / 100) * width, most, width - offset);
    // Where the pads start: TOUCH_PADS.reach has 14 px to spare beyond them.
    const pads = (width: number, onItsSide: boolean): number => width - (TOUCH_PADS.reach - 14) - (onItsSide ? TOUCH_PADS.movesReach : 0);
    for (const width of [320, 360, 375, 390, 412]) expect(right(upright, width), `${width} upright`).toBeLessThanOrEqual(pads(width, false) - 12);
    for (const width of [568, 640, 667, 740, 844, 932]) expect(right(sideways, width), `${width} on its side`).toBeLessThanOrEqual(pads(width, true) - 12);
  });

  it("let a tap between them through, so the block's empty corner never takes the top bar's buttons", () => {
    expect(declarations(sheet, ".touch-pads")).toContain("pointer-events:none");
    expect(declarations(sheet, ".touch-pad,.touch-mod,.touch-move")).toContain("pointer-events:auto");
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
