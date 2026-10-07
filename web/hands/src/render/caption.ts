import type { MatchPhase } from "../types";
import { BROADCAST_VOICES, type AnnouncerCard, type BroadcastLine, type Caption, type Speaker } from "./commentary";
import { CALLOUT_BASELINE, CALLOUT_BELOW_BASELINE, fitFontSize, panelHeightFor, topPanelOffset } from "./hud";

/** What else is on the screen, so the caption keeps out of its way. */
export interface CaptionScene {
  readonly width: number;
  readonly height: number;
  readonly phase: MatchPhase;
  /** Top edge of the result card while it is shown. */
  readonly resultTop: number | null;
  /** The on-screen touch pads are up over the lower right of the screen. */
  readonly touch: boolean;
  /** The controls hint sits above the plates during the countdown. */
  readonly hint: boolean;
  /** The viewer is down and has the get-up panel to watch. */
  readonly viewerDown: boolean;
  readonly replay: boolean;
  /** Where the fighter's own corner panel starts, measured down the screen, while it is up between rounds. */
  readonly cornerPanelTop?: number | null;
  /** A big callout ("ROUND 2", "PARRIED") is on screen. */
  readonly callout?: boolean;
}

export interface CaptionSlot {
  /** Centre of the caption. */
  readonly x: number;
  /** Its bottom edge for a lower third, its top edge otherwise. */
  readonly y: number;
  readonly maxWidth: number;
  readonly anchor: "top" | "bottom";
  readonly scale: number;
  /** The countdown panel the introductions are drawn over, which the caption covers completely. */
  readonly cover: { readonly width: number; readonly height: number } | null;
}

/** Below the top bar. */
const TOP_CLEARANCE = 54;
/** Below the round clock, the portraits and the input readout on narrow screens. */
const COMPACT_TOP = 136;
/** Above the plates' guard and poise bars. */
const LOWER_THIRD = 110;
/** Above the controls hint the page shows over the plates during the countdown. */
const ABOVE_HINT = 168;
/** The tallest caption, an announcer card, at full size. */
const CAPTION_ROOM = 74;
const REPLAY_TAG = { right: 220, wideTop: 64, compactTop: 120, height: 34 } as const;
/** The HUD's centre panels are this wide at most (hud.ts centerPanel). */
const PANEL_WIDTH = 320;
/** The touch pads' column (style.css .touch-pads): its width with margins, its bottom offset and its height. */
const TOUCH_PADS = { width: 216, bottom: 118, height: 196 } as const;

const BACKGROUND = "rgba(3,6,12,0.86)";
const COVER_BACKGROUND = "rgb(4,7,13)";
const SPEAKER_ACCENTS: Readonly<Record<Speaker, string>> = { play: "#f6d57a", colour: "#9ec7ff", announcer: "#f6d57a" };
const CORNER_ACCENTS = ["#4f86d9", "#d9483c"] as const;
const FAMILY = "Inter, system-ui, sans-serif";

/**
 * Where the caption goes: over the countdown panel for the introductions, a lower third above the plates on a
 * desktop, otherwise under the top bar and below whatever panel is up. Null when there is no room that keeps
 * clear of the fighters and the scoreboard.
 */
export function captionSlot(scene: CaptionScene): CaptionSlot | null {
  const { width, height } = scene;
  const compact = width < 640;
  const short = height < 480;
  const scale = short ? 0.78 : compact ? 0.85 : 1;
  const maxWidth = Math.min(680, width - 24);
  const result = scene.resultTop;
  const panelHeight = panelHeightFor(height);
  const panelTop = height / 2 + topPanelOffset(width, height) - panelHeight / 2;
  if (result === null && scene.phase === "countdown") {
    // The introductions take the countdown panel's place.
    return { x: width / 2, y: panelTop, maxWidth, anchor: "top", scale, cover: { width: Math.min(PANEL_WIDTH, width - 24), height: panelHeight } };
  }
  if (result === null && !scene.touch && !short) {
    const lowerThird = height - (scene.hint ? ABOVE_HINT : LOWER_THIRD);
    const bottom = scene.cornerPanelTop === undefined || scene.cornerPanelTop === null ? lowerThird : Math.min(lowerThird, scene.cornerPanelTop - 8);
    // Above the corner panel when there is room for it there, otherwise up at the top with the panels.
    if (bottom - CAPTION_ROOM * scale >= height * 0.45) return { x: width / 2, y: bottom, maxWidth, anchor: "bottom", scale, cover: null };
  }
  if (result === null && scene.viewerDown) return null;
  let top = result === null && compact ? COMPACT_TOP : TOP_CLEARANCE;
  if (result === null) {
    if (scene.phase === "rest" || scene.phase === "foul_recovery") top = Math.max(top, panelTop + panelHeight + 8);
    else if (scene.phase === "knockdown") top = Math.max(top, height * 0.16 + 80);
    if (scene.replay && width / 2 - maxWidth / 2 < REPLAY_TAG.right + 8) top = Math.max(top, (compact ? REPLAY_TAG.compactTop : REPLAY_TAG.wideTop) + REPLAY_TAG.height + 8);
    if (scene.callout === true && scene.phase === "fight") top = Math.max(top, height * CALLOUT_BASELINE + CALLOUT_BELOW_BASELINE + 8);
  }
  const limit = result !== null ? result - 8 : height * (short ? 0.46 : 0.5);
  if (top + CAPTION_ROOM * scale > limit) return null;
  const padsTop = height - TOUCH_PADS.bottom - TOUCH_PADS.height;
  const besidePads = result === null && scene.touch && top + CAPTION_ROOM * scale > padsTop;
  return { x: width / 2, y: top, maxWidth: besidePads ? Math.min(maxWidth, width - TOUCH_PADS.width * 2) : maxWidth, anchor: "top", scale, cover: null };
}

/** Draws the caption in its slot: faded and eased in unless motion is reduced, when it simply appears. */
export function drawCaption(ctx: CanvasRenderingContext2D, caption: Caption, slot: CaptionSlot, reducedMotion: boolean): void {
  const alpha = reducedMotion ? 1 : caption.opacity;
  if (alpha <= 0.01) return;
  const slide = reducedMotion || slot.cover !== null ? 0 : caption.entering * 8 * (slot.anchor === "bottom" ? 1 : -1);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textBaseline = "alphabetic";
  // The dark plate is all but invisible over the arena while it fades, so the words fade faster than the plate
  // and never float over the fighters as ghost text.
  const textAlpha = alpha * alpha;
  if (caption.line.card !== null) drawCard(ctx, caption.line.card, slot, slide, textAlpha);
  else drawLine(ctx, caption.line, slot, slide, textAlpha);
  ctx.restore();
}

function truncate(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let value = text;
  while (value.length > 1 && ctx.measureText(`${value}…`).width > width) value = value.slice(0, -1);
  return `${value}…`;
}

/** Splits a line in two at the space that best balances the halves while both fit. */
export function splitLine(text: string, fits: (part: string) => boolean): [string, string] {
  const middle = text.length / 2;
  let best: [string, string] | null = null;
  let bestDistance = Infinity;
  for (let index = text.indexOf(" "); index >= 0; index = text.indexOf(" ", index + 1)) {
    const first = text.slice(0, index);
    const second = text.slice(index + 1);
    const distance = Math.abs(index - middle);
    if (fits(first) && fits(second) && distance < bestDistance) {
      best = [first, second];
      bestDistance = distance;
    }
  }
  if (best !== null) return best;
  const space = text.lastIndexOf(" ", Math.floor(middle));
  return space > 0 ? [text.slice(0, space), text.slice(space + 1)] : [text, ""];
}

function drawLine(ctx: CanvasRenderingContext2D, line: BroadcastLine, slot: CaptionSlot, slide: number, textAlpha: number): void {
  const s = slot.scale;
  const padX = Math.round(14 * s);
  const tagSize = Math.round(10 * s);
  const inner = slot.maxWidth - padX * 2 - 4;
  const measure = (text: string, size: number): number => {
    ctx.font = `700 ${size}px ${FAMILY}`;
    return ctx.measureText(text).width;
  };
  const size = fitFontSize((candidate) => measure(line.text, candidate), inner, Math.round(17 * s), Math.round(13 * s));
  const rows = measure(line.text, size) <= inner ? [line.text] : splitLine(line.text, (part) => measure(part, size) <= inner).filter((row) => row.length > 0);
  const textWidth = Math.max(...rows.map((row) => Math.min(inner, measure(row, size))));
  const tag = BROADCAST_VOICES[line.speaker];
  ctx.font = `800 ${tagSize}px ${FAMILY}`;
  const tagWidth = ctx.measureText(tag).width;
  const width = Math.min(slot.maxWidth, Math.max(textWidth, tagWidth) + padX * 2 + 4);
  const rowHeight = Math.round(size * 1.3);
  const head = Math.round(8 * s) + tagSize;
  const height = head + Math.round(4 * s) + rows.length * rowHeight + Math.round(5 * s);
  const top = (slot.anchor === "bottom" ? slot.y - height : slot.y) + slide;
  const left = slot.x - width / 2;
  const accent = SPEAKER_ACCENTS[line.speaker];
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(left, top, width, height);
  ctx.fillStyle = accent;
  ctx.fillRect(left, top, 4, height);
  ctx.globalAlpha = textAlpha;
  ctx.textAlign = "left";
  ctx.font = `800 ${tagSize}px ${FAMILY}`;
  ctx.fillText(tag, left + 4 + padX, top + head);
  ctx.fillStyle = "#f6f7fb";
  ctx.font = `700 ${size}px ${FAMILY}`;
  rows.forEach((row, index) => ctx.fillText(truncate(ctx, row, inner), left + 4 + padX, top + head + Math.round(4 * s) + rowHeight * (index + 1) - Math.round(size * 0.28)));
}

/** Kicker, title and detail sizes for a card fitted to a panel it covers: tighter first, then without the detail, then a smaller title. */
export function cardMetrics(scale: number, hasDetail: boolean, room: number | null): { kicker: number; title: number; detail: number; gap: number; pad: number; height: number } {
  const kicker = Math.round(11 * scale);
  const title = Math.round(28 * scale);
  const detailGap = Math.round(6 * scale);
  const loose = { pad: Math.round(10 * scale), gap: Math.round(7 * scale) };
  const tight = { pad: Math.max(4, Math.round(6 * scale)), gap: Math.max(3, Math.round(4 * scale)) };
  const fullDetail = hasDetail ? Math.round(10 * scale) : 0;
  const layouts = [{ ...loose, detail: fullDetail }, { ...tight, detail: fullDetail }, { ...tight, detail: 0 }];
  const heightOf = (layout: { pad: number; gap: number; detail: number }, size: number): number => layout.pad * 2 + kicker + layout.gap + size + (layout.detail === 0 ? 0 : detailGap + layout.detail);
  for (const layout of layouts) {
    if (room === null || heightOf(layout, title) <= room) return { kicker, title, ...layout, height: heightOf(layout, title) };
  }
  const last = layouts[2]!;
  const fitted = Math.max(12, Math.min(title, (room ?? Infinity) - heightOf(last, 0)));
  return { kicker, title: fitted, ...last, height: heightOf(last, fitted) };
}

function drawCard(ctx: CanvasRenderingContext2D, card: AnnouncerCard, slot: CaptionSlot, slide: number, textAlpha: number): void {
  const s = slot.scale;
  const pad = Math.round(18 * s);
  const inner = slot.maxWidth - pad * 2;
  const metrics = cardMetrics(s, card.detail.length > 0, slot.cover?.height ?? null);
  const kickerSize = metrics.kicker;
  const detailSize = metrics.detail;
  const measure = (text: string, weight: number, size: number): number => {
    ctx.font = `${weight} ${size}px ${FAMILY}`;
    return ctx.measureText(text).width;
  };
  const titleSize = fitFontSize((candidate) => measure(card.title, 900, candidate), inner, metrics.title, Math.min(metrics.title, Math.round(15 * s)));
  const contentWidth = Math.max(measure(card.kicker, 800, kickerSize), Math.min(inner, measure(card.title, 900, titleSize)), detailSize === 0 ? 0 : measure(card.detail, 700, detailSize));
  const width = Math.min(slot.maxWidth, Math.max(240 * s, contentWidth + pad * 2, slot.cover?.width ?? 0));
  const content = metrics.pad + kickerSize + metrics.gap + titleSize + (detailSize === 0 ? 0 : Math.round(6 * s) + detailSize) + metrics.pad;
  const height = Math.max(content, slot.cover?.height ?? 0);
  const top = (slot.anchor === "bottom" ? slot.y - height : slot.y) + slide;
  const left = slot.x - width / 2;
  const accent = card.corner === null ? SPEAKER_ACCENTS.announcer : CORNER_ACCENTS[card.corner];
  ctx.fillStyle = slot.cover === null ? BACKGROUND : COVER_BACKGROUND;
  ctx.fillRect(left, top, width, height);
  ctx.fillStyle = accent;
  ctx.fillRect(left, top, width, 3);
  ctx.globalAlpha = textAlpha;
  ctx.textAlign = "center";
  let baseline = top + (height - content) / 2 + metrics.pad + kickerSize;
  ctx.font = `800 ${kickerSize}px ${FAMILY}`;
  ctx.fillText(truncate(ctx, card.kicker, inner), slot.x, baseline);
  baseline += metrics.gap + titleSize;
  ctx.fillStyle = "#ffffff";
  ctx.font = `900 ${titleSize}px ${FAMILY}`;
  ctx.fillText(truncate(ctx, card.title, inner), slot.x, baseline - Math.round(titleSize * 0.12));
  if (detailSize > 0) {
    baseline += Math.round(6 * s) + detailSize;
    ctx.fillStyle = "#93a3bd";
    ctx.font = `700 ${detailSize}px ${FAMILY}`;
    ctx.fillText(truncate(ctx, card.detail, inner), slot.x, baseline);
  }
}
