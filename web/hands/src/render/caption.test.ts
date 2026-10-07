import { readFileSync } from "node:fs";
import { fighter, mockHudContext, publicPlayers, snapshot } from "../test/fixtures";
import type { MatchPhase } from "../types";
import { cardMetrics, captionSlot, drawCaption, splitLine, type CaptionScene } from "./caption";
import type { BroadcastLine, Caption } from "./commentary";
import { COUNT_BELOW_HEADLINE, drawHud, headlineBaseline, panelHeightFor, topPanelOffset, TOUCH_PADS } from "./hud";

const scene = (width: number, height: number, phase: MatchPhase = "fight", extra: Partial<CaptionScene> = {}): CaptionScene => ({ width, height, phase, resultTop: null, touch: false, hint: false, viewerDown: false, replay: false, ...extra });
const line = (text: string, extra: Partial<BroadcastLine> = {}): BroadcastLine => ({ speaker: "play", text, priority: 50, urgent: false, hold: 3, card: null, ...extra });
const shown = (value: BroadcastLine, opacity = 1, entering = 0): Caption => ({ line: value, opacity, entering });
/**
 * The touch pads as Edge lays out style.css: upright one 190 x 274 column 12 px in and 118 px up; on its side the
 * modifiers and punch pads, 190 x 196, with the moves 122 x 102 at the foot, 12 px to their left; and on a screen
 * 350 px tall or less, 188 x 154 and 120 x 86, 112 px up.
 */
const padRects = (width: number, height: number) => width <= height
  ? [{ left: width - 202, right: width - 12, top: height - 392, bottom: height - 118 }]
  : height <= 350
    ? [{ left: width - 200, right: width - 12, top: height - 266, bottom: height - 112 }, { left: width - 332, right: width - 212, top: height - 198, bottom: height - 112 }]
    : [{ left: width - 202, right: width - 12, top: height - 314, bottom: height - 118 }, { left: width - 336, right: width - 214, top: height - 220, bottom: height - 118 }];
/** Phones held upright and on their side, from the smallest to the largest. */
const PHONES = [[320, 568], [360, 640], [375, 667], [360, 740], [375, 812], [390, 844], [412, 915], [568, 320], [600, 330], [640, 320], [640, 360], [667, 375], [740, 360], [812, 375], [844, 390], [915, 412], [932, 430]] as const;

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
          for (const pad of padRects(width, height)) {
            const clear = plate.x + plate.w <= pad.left || plate.x >= pad.right || plate.y + plate.h <= pad.top || plate.y >= pad.bottom;
            expect(clear, `${width}x${height} ${phase} ${JSON.stringify(extra)}: caption ${JSON.stringify(plate)} under the pads ${JSON.stringify(pad)}`).toBe(true);
          }
        }
      }
    }
    // Most of these still have their caption, beside the pads or above them.
    expect(drawn).toBeGreaterThan(40);
  });

  it("keeps the centre panel and the introductions drawn over it clear of the touch pads, upright or on its side", () => {
    const players = Object.fromEntries(publicPlayers.map((player) => [player.id, { ...player, name: player.id === "one" ? "Azure Vector" : "Crimson Geometry" }]));
    const card = line("In the red corner, Crimson Geometry.", { speaker: "announcer", urgent: true, card: { kicker: "IN THE RED CORNER", title: "CRIMSON GEOMETRY", detail: "SWARMER · 19-5-1 (12 KO) · RATED 1512", corner: 1 } });
    for (const [width, height] of PHONES) {
      for (const phase of ["countdown", "rest", "foul_recovery"] as const) {
        // The panel is the HUD's one fill of its colour in these phases; the introduction's plate is the caption's first.
        const panels: Array<{ x: number; y: number; w: number; h: number }> = [];
        let fill = "";
        const hud = Object.assign(mockHudContext([]), { fillRect: (x: number, y: number, w: number, h: number) => { if (fill === "rgba(3,6,12,0.88)") panels.push({ x, y, w, h }); } });
        Object.defineProperty(hud, "fillStyle", { set: (value: string) => { fill = value; } });
        drawHud(hud, width, height, { ...snapshot(), phase }, players, "one", null, 0, 30, null, null, null, null, null, null, null, true);
        expect(panels, `${width}x${height} ${phase}`).toHaveLength(1);
        const boxes = [panels[0]!];
        if (phase === "countdown") {
          const plates: Array<{ x: number; y: number; w: number; h: number }> = [];
          drawCaption(Object.assign(mockHudContext([]), { fillRect: (x: number, y: number, w: number, h: number) => plates.push({ x, y, w, h }) }), shown(card), captionSlot(scene(width, height, "countdown", { touch: true, hint: true }))!, true);
          boxes.push(plates[0]!);
        }
        for (const box of boxes) {
          const where = `${width}x${height} ${phase}: ${JSON.stringify(box)}`;
          for (const pad of padRects(width, height)) expect(box.x + box.w <= pad.left || box.x >= pad.right || box.y + box.h <= pad.top - 8 || box.y >= pad.bottom, `${where} under the pads ${JSON.stringify(pad)}`).toBe(true);
          // Under the top bar, on the screen, and clear of the round card a narrow screen puts under the top bar.
          expect(box.y >= 54 && box.x >= 12 && box.x + box.w <= width - 12, where).toBe(true);
          if (width < 640) expect(box.x + box.w <= width / 2 - 84 || box.x >= width / 2 + 84 || box.y >= 112, `${where} on the round card`).toBe(true);
        }
      }
    }
  });

  it("keeps a downed player's get-up panel clear of the get-up pads and his thumbs on them", () => {
    // While he is down only the punch pads show (style.css), as the get-up pads: as Edge lays them out, 190 x 118
    // at the foot of the block, or 188 x 92 on a screen on its side 350 px tall or less; 8 px round them for thumbs.
    const getUpPads = (width: number, height: number) => (width > height && height <= 350
      ? { left: width - 200 - 8, right: width - 12 + 8, top: height - 204 - 8, bottom: height - 112 + 8 }
      : { left: width - 202 - 8, right: width - 12 + 8, top: height - 236 - 8, bottom: height - 118 + 8 });
    const named = Object.fromEntries(publicPlayers.map((player) => [player.id, { ...player, name: player.id === "one" ? "Azure Vector" : "Crimson Geometry" }]));
    for (const [width, height] of PHONES) {
      const fills: Array<{ x: number; y: number; w: number; h: number; style: string }> = [];
      const texts: Array<{ text: string; x: number; y: number; font: string }> = [];
      let style = "";
      let font = "";
      const hud = Object.assign(mockHudContext([]), {
        fillRect: (x: number, y: number, w: number, h: number) => fills.push({ x, y, w, h, style }),
        fillText: (text: string, x: number, y: number) => texts.push({ text, x, y, font }),
      });
      Object.defineProperty(hud, "fillStyle", { set: (value: string) => { style = value; } });
      Object.defineProperty(hud, "font", { set: (value: string) => { font = value; } });
      // Down, in his rhythm window: the count, the arrow, NOW! and the meter.
      const down = { ...snapshot(100), phase: "knockdown" as const, fighters: [{ ...fighter("one", -100), is_downed: true, get_up_count: 3, get_up_prompt: "get_up_left" as const, get_up_meter: 18, get_up_required: 40, get_up_window_start_tick: 95, get_up_window_end_tick: 105 }, { ...fighter("two", 100), get_up_count: 3 }] as const };
      drawHud(hud, width, height, down, named, "one", null, 0, 30, null, null, null, null, null, null, "one", true);
      const where = `${width}x${height}`;
      const panels = fills.filter((fill) => fill.style === "rgba(3,6,12,0.88)");
      expect(panels, where).toHaveLength(1);
      const panel = panels[0]!;
      const meter = fills.find((fill) => fill.style === "rgba(2,4,9,0.9)")!;
      const pads = getUpPads(width, height);
      for (const box of [panel, meter]) expect(box.x + box.w <= pads.left || box.x >= pads.right || box.y + box.h <= pads.top || box.y >= pads.bottom, `${where}: ${JSON.stringify(box)} at the get-up pads`).toBe(true);
      // On the screen, under the top bar and above the plates' guard and poise bars.
      expect(panel.x >= 12 && panel.x + panel.w <= width - 12 && panel.y >= 54 && panel.y + panel.h <= height - 112, `${where}: ${JSON.stringify(panel)}`).toBe(true);
      for (const prompt of ["COUNT 3", "←", "NOW!"]) {
        const text = texts.find((candidate) => candidate.text === prompt && candidate.y > panel.y);
        expect(text !== undefined && text.x > panel.x && text.x < panel.x + panel.w && text.y < panel.y + panel.h, `${where}: ${prompt} in the panel`).toBe(true);
      }
      // The headline it gives way to is not drawn under it, nor the round card's clock on a narrow screen.
      for (const text of texts.filter((candidate) => candidate.text === "KNOCKDOWN" && candidate.font.includes("44px") || candidate.text.endsWith("IS DOWN"))) expect(text.y + 2, `${where}: ${text.text}`).toBeLessThanOrEqual(panel.y);
      if (width < 640 && panel.y < 112 && panel.x < width / 2 + 84 && panel.x + panel.w > width / 2 - 84) expect(texts.some((text) => /^\d:\d\d$/u.test(text.text)), `${where}: the clock under the panel`).toBe(false);
    }
  });

  it("keeps the paused bout's panel, and the captions with it, clear of the touch pads", () => {
    const named = Object.fromEntries(publicPlayers.map((player) => [player.id, player]));
    const longest = line("Crimson Geometry is just covering up as Azure Vector lets the hands go, and the referee is taking a long look!");
    for (const [width, height] of PHONES) {
      for (const phase of ["fight", "rest", "countdown"] as const) {
        const panels: Array<{ x: number; y: number; w: number; h: number }> = [];
        let fill = "";
        const hud = Object.assign(mockHudContext([]), { fillRect: (x: number, y: number, w: number, h: number) => { if (fill === "rgba(3,6,12,0.88)") panels.push({ x, y, w, h }); } });
        Object.defineProperty(hud, "fillStyle", { set: (value: string) => { fill = value; } });
        drawHud(hud, width, height, { ...snapshot(), phase }, named, "one", null, 4000, 30, null, null, null, null, null, null, null, true);
        // The pause is drawn last, over the countdown's or the rest's panel.
        const pause = panels.at(-1)!;
        const boxes = [pause];
        const slot = captionSlot(scene(width, height, phase, { touch: true, paused: true }));
        if (slot !== null) {
          const plates: Array<{ x: number; y: number; w: number; h: number }> = [];
          drawCaption(Object.assign(mockHudContext([]), { fillRect: (x: number, y: number, w: number, h: number) => plates.push({ x, y, w, h }) }), shown(longest), slot, true);
          const plate = plates[0]!;
          expect(plate.y >= pause.y + pause.h || plate.y + plate.h <= pause.y, `${width}x${height} ${phase}: the caption over the pause`).toBe(true);
          boxes.push(plate);
        }
        for (const box of boxes) {
          const where = `${width}x${height} ${phase}: ${JSON.stringify(box)}`;
          for (const pad of padRects(width, height)) expect(box.x + box.w <= pad.left || box.x >= pad.right || box.y + box.h <= pad.top - 8 || box.y >= pad.bottom, `${where} under the pads ${JSON.stringify(pad)}`).toBe(true);
          expect(box.y >= 54, where).toBe(true);
          if (width < 640) expect(box.x + box.w <= width / 2 - 84 || box.x >= width / 2 + 84 || box.y >= 112, `${where} on the round card`).toBe(true);
        }
      }
    }
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
    expect({ bottom: px(pads, "bottom"), height: rows(2, move, px(moves, "gap")) + px(moves, "margin-bottom") + px(pads, "gap") + stack, grid: rows(2, pad, px(grid, "gap")) }).toEqual({ bottom: TOUCH_PADS.upright.bottom, height: TOUCH_PADS.upright.height, grid: TOUCH_PADS.upright.grid });
    expect(px(pads, "right") + columns(grid, px(grid, "gap")) + 14).toBe(TOUCH_PADS.reach);
    // On its side the moves stand in three rows in a column of their own, to the left of the other two.
    const side = media("(orientation:landscape)");
    expect({ height: stack, moves: rows(3, move, px(moves, "gap")), grid: rows(2, pad, px(grid, "gap")) }).toEqual({ height: TOUCH_PADS.landscape.height, moves: TOUCH_PADS.landscape.moves, grid: TOUCH_PADS.landscape.grid });
    expect(columns(declarations(side, ".touch-moves"), px(moves, "gap")) + px(declarations(side, ".touch-pads"), "column-gap")).toBe(TOUCH_PADS.movesReach);
    // A short screen on its side gets smaller ones, lower down.
    const short = media(`(orientation:landscape) and (max-height:${TOUCH_PADS.shortHeight}px)`);
    const gap = px(declarations(short, ".touch-grid,.touch-mods,.touch-moves"), "gap");
    const [shortPad, shortMod] = [".touch-pad", ".touch-mod,.touch-move"].map((selector) => px(declarations(short, selector), "height")) as [number, number];
    const shortPads = declarations(short, ".touch-pads");
    expect({ bottom: px(shortPads, "bottom"), height: rows(2, shortMod, gap) + px(shortPads, "row-gap") + rows(2, shortPad, gap), moves: rows(3, shortMod, gap), grid: rows(2, shortPad, gap) }).toEqual(TOUCH_PADS.short);
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

  it("show only the get-up pads while the player is down, where they stood", () => {
    // Hidden, not removed: the get-up pads keep their place under his thumbs, and a held guard still hears its finger lift.
    expect(declarations(sheet, ".touch-controls.knockdown .touch-move,.touch-controls.knockdown .touch-mod")).toBe("visibility:hidden");
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
