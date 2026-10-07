import type { CombatEvent, EngineSnapshot, FinalMessage, PublicPlayer } from "../types";

export const HUD_MAX_GUARD = 700;
export const HUD_MAX_POISE = 600;
export const HUD_MAX_CONDITIONING = 1000;
export const scoreTotal = (scores: readonly number[]): number => scores.reduce((sum, score) => sum + score, 0);

const fit = (ctx: CanvasRenderingContext2D, text: string, width: number): string => {
  if (ctx.measureText(text).width <= width) return text;
  let value = text;
  while (value.length > 1 && ctx.measureText(`${value}…`).width > width) value = value.slice(0, -1);
  return `${value}…`;
};

/** Largest font size from `maximum` down to `minimum` (whole pixels) at which `measure` fits `width`, else `minimum`. */
export const fitFontSize = (measure: (size: number) => number, width: number, maximum: number, minimum: number): number => {
  for (let size = maximum; size > minimum; size -= 1) if (measure(size) <= width) return size;
  return minimum;
};

interface BarSpec {
  readonly label: string;
  readonly value: number;
  readonly maximum: number;
  readonly from: string;
  readonly to: string;
}

function broadcastBar(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, spec: BarSpec, mirror: boolean): void {
  const height = 9;
  ctx.fillStyle = "rgba(2,4,9,0.85)";
  ctx.fillRect(x - 1, y - 1, width + 2, height + 2);
  const frame = ctx.createLinearGradient(0, y, 0, y + height);
  frame.addColorStop(0, "rgba(210,220,235,0.5)");
  frame.addColorStop(0.5, "rgba(90,100,120,0.25)");
  frame.addColorStop(1, "rgba(30,36,50,0.4)");
  ctx.strokeStyle = frame;
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 1.5, y - 1.5, width + 3, height + 3);
  const ratio = Math.max(0, Math.min(1, spec.value / Math.max(1, spec.maximum)));
  const fill = ctx.createLinearGradient(0, y, 0, y + height);
  fill.addColorStop(0, spec.from);
  fill.addColorStop(1, spec.to);
  ctx.fillStyle = fill;
  const fillWidth = width * ratio;
  ctx.fillRect(mirror ? x + width - fillWidth : x, y, fillWidth, height);
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fillRect(mirror ? x + width - fillWidth : x, y, fillWidth, 2);
  ctx.fillStyle = "#dfe7f5";
  ctx.font = "700 9px Inter, system-ui, sans-serif";
  ctx.textAlign = mirror ? "right" : "left";
  ctx.fillText(spec.label, mirror ? x + width : x, y - 4);
}

function fighterPlate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  name: string,
  detail: string,
  bars: readonly BarSpec[],
  mirror: boolean,
  accent: string,
): void {
  const height = 62;
  ctx.save();
  ctx.beginPath();
  if (mirror) {
    ctx.moveTo(x + 14, y);
    ctx.lineTo(x + width, y);
    ctx.lineTo(x + width - 14, y + height);
    ctx.lineTo(x, y + height);
  } else {
    ctx.moveTo(x, y);
    ctx.lineTo(x + width - 14, y);
    ctx.lineTo(x + width, y + height);
    ctx.lineTo(x + 14, y + height);
  }
  ctx.closePath();
  ctx.fillStyle = "rgba(3,6,12,0.82)";
  ctx.fill();
  ctx.strokeStyle = "rgba(190,200,220,0.22)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.fillRect(mirror ? x + width - 5 : x, y + 4, 5, height - 8);

  const textX = mirror ? x + width - 20 : x + 20;
  ctx.textAlign = mirror ? "right" : "left";
  ctx.fillStyle = "#f5f8ff";
  const label = name.toUpperCase();
  const nameSize = fitFontSize((size) => {
    ctx.font = `800 ${size}px Inter, system-ui, sans-serif`;
    return ctx.measureText(label).width;
  }, width - 44, 16, 11);
  ctx.font = `800 ${nameSize}px Inter, system-ui, sans-serif`;
  ctx.fillText(fit(ctx, label, width - 44), textX, y + 21);
  ctx.fillStyle = "#93a3bd";
  ctx.font = "600 10px Inter, system-ui, sans-serif";
  ctx.fillText(detail, textX, y + 35);

  const barWidth = (width - 52) / bars.length;
  const groupWidth = bars.length * barWidth + (bars.length - 1) * 12;
  const startX = mirror ? x + width - 20 - groupWidth : x + 20;
  bars.forEach((spec, index) => {
    broadcastBar(ctx, startX + (barWidth + 12) * index, y + 48, barWidth, spec, mirror);
  });
  ctx.restore();
}

function roundCard(ctx: CanvasRenderingContext2D, centerX: number, y: number, clock: string, round: string, phase: string): void {
  const width = 168;
  const height = 58;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(centerX - width / 2 + 12, y);
  ctx.lineTo(centerX + width / 2 - 12, y);
  ctx.lineTo(centerX + width / 2, y + height / 2);
  ctx.lineTo(centerX + width / 2 - 12, y + height);
  ctx.lineTo(centerX - width / 2 + 12, y + height);
  ctx.lineTo(centerX - width / 2, y + height / 2);
  ctx.closePath();
  ctx.fillStyle = "rgba(4,6,12,0.88)";
  ctx.fill();
  const gold = ctx.createLinearGradient(centerX - width / 2, y, centerX + width / 2, y + height);
  gold.addColorStop(0, "#8a6a26");
  gold.addColorStop(0.5, "#f6d57a");
  gold.addColorStop(1, "#8a6a26");
  ctx.strokeStyle = gold;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 22px ui-monospace, monospace";
  ctx.fillText(clock, centerX, y + 27);
  ctx.fillStyle = "#f6d57a";
  ctx.font = "800 12px Inter, system-ui, sans-serif";
  ctx.fillText(round, centerX, y + 44);
  if (phase !== "FIGHT") {
    ctx.fillStyle = "#93a3bd";
    ctx.font = "700 9px Inter, system-ui, sans-serif";
    ctx.fillText(phase, centerX, y + 55);
  }
  ctx.restore();
}

const PANEL_HEIGHT = 78;
const SHORT_PANEL_HEIGHT = 50;
const panelHeightFor = (height: number): number => (height < 480 ? SHORT_PANEL_HEIGHT : PANEL_HEIGHT);

/** Offset that parks a centre panel under the top bar, or under the round card on narrow screens, clear of the fighters. */
export const topPanelOffset = (width: number, height: number): number =>
  Math.max(width < 640 ? 112 : 56, height * 0.1) + panelHeightFor(height) / 2 - height / 2;

function centerPanel(ctx: CanvasRenderingContext2D, width: number, height: number, title: string, subtitle: string, yOffset = 0): void {
  const panelWidth = Math.min(320, width - 24);
  const panelHeight = panelHeightFor(height);
  const short = panelHeight === SHORT_PANEL_HEIGHT;
  const x = width / 2 - panelWidth / 2;
  const y = height / 2 - panelHeight / 2 + yOffset;
  ctx.fillStyle = "rgba(3,6,12,0.88)";
  ctx.fillRect(x, y, panelWidth, panelHeight);
  ctx.strokeStyle = "rgba(246,213,122,0.45)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 2, y + 2, panelWidth - 4, panelHeight - 4);
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffd77a";
  ctx.font = `800 ${short ? 17 : 22}px Inter, system-ui, sans-serif`;
  ctx.fillText(title, width / 2, y + (short ? 22 : 34));
  ctx.fillStyle = "#c8d3e6";
  ctx.font = `600 ${short ? 11 : 12}px Inter, system-ui, sans-serif`;
  ctx.fillText(fit(ctx, subtitle, panelWidth - 24), width / 2, y + (short ? 39 : 58));
}

/** Holds the round clock while a knockdown count or a foul timeout runs its own timer. */
export class RoundClock {
  private fightTicks: number | null = null;
  private round = 0;

  ticks(snapshot: EngineSnapshot): number {
    if (snapshot.round_number !== this.round) {
      this.round = snapshot.round_number;
      this.fightTicks = null;
    }
    if (snapshot.phase === "fight") this.fightTicks = snapshot.phase_ticks_remaining;
    const held = snapshot.phase === "knockdown" || snapshot.phase === "foul_recovery";
    return held && this.fightTicks !== null ? this.fightTicks : snapshot.phase_ticks_remaining;
  }
}

export interface RoundPunchStats {
  thrown: number;
  landed: number;
}

/** Punches thrown and landed per fighter in the current round, reset on the round-start bell. */
export class RoundStatsTracker {
  private readonly stats = new Map<string, RoundPunchStats>();
  private readonly totals = new Map<string, RoundPunchStats>();

  record(event: CombatEvent): void {
    if (event.kind === "bell") {
      if (event.detail === "round_start") this.stats.clear();
      return;
    }
    if (event.actor_id === null) return;
    if (event.kind === "punch_start") {
      this.entry(this.stats, event.actor_id).thrown += 1;
      this.entry(this.totals, event.actor_id).thrown += 1;
    } else if (event.kind === "hit" || event.kind === "counter_hit") {
      this.entry(this.stats, event.actor_id).landed += 1;
      this.entry(this.totals, event.actor_id).landed += 1;
    }
  }

  get(playerId: string): RoundPunchStats {
    return this.stats.get(playerId) ?? { thrown: 0, landed: 0 };
  }

  /** Punches over the whole bout, for the result panel. */
  total(playerId: string): RoundPunchStats {
    return this.totals.get(playerId) ?? { thrown: 0, landed: 0 };
  }

  private entry(map: Map<string, RoundPunchStats>, playerId: string): RoundPunchStats {
    let entry = map.get(playerId);
    if (entry === undefined) {
      entry = { thrown: 0, landed: 0 };
      map.set(playerId, entry);
    }
    return entry;
  }
}

/** Headline for the result panel: decisions and draws say whether the judges were unanimous, split or majority. */
export function decisionLabel(final: FinalMessage): string {
  const base = final.method.replaceAll("_", " ").toUpperCase();
  if (final.method !== "decision" && final.method !== "draw") return base;
  let one = 0;
  let two = 0;
  let even = 0;
  for (const card of final.scorecards) {
    const a = scoreTotal(card.player_one);
    const b = scoreTotal(card.player_two);
    if (a > b) one += 1;
    else if (b > a) two += 1;
    else even += 1;
  }
  const cards = final.scorecards.length;
  if (cards === 0) return base;
  if (final.method === "draw") return even === cards ? "UNANIMOUS DRAW" : one === two ? "SPLIT DRAW" : "MAJORITY DRAW";
  const winnerCards = Math.max(one, two);
  if (winnerCards === cards) return "UNANIMOUS DECISION";
  if (even > 0) return "MAJORITY DECISION";
  return "SPLIT DECISION";
}

export const STOPPAGE_METHODS: ReadonlySet<string> = new Set(["ko", "flash_ko", "tko"]);
export const FINAL_REVEAL_DELAY_SECONDS = 3.6;

/** Seconds to hold the result panel back so a stoppage's slow-motion fall stays visible. */
export function finalRevealDelay(final: FinalMessage | null): number {
  return final !== null && STOPPAGE_METHODS.has(final.method) ? FINAL_REVEAL_DELAY_SECONDS : 0;
}

export function drawHud(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  snapshot: EngineSnapshot,
  players: Readonly<Record<string, PublicPlayer>>,
  viewerId: string | null,
  final: FinalMessage | null,
  reconnectMs: number,
  tickRate = 30,
  roundStats: RoundStatsTracker | null = null,
  replayLabel: string | null = null,
  inputLatencyMs: number | null = null,
  roundCallout: string | null = null,
  clockTicks: number | null = null,
): void {
  ctx.save();
  ctx.textBaseline = "alphabetic";
  // Below 640 px the two plates share the bottom edge and the round card moves under the top bar.
  const compact = width < 640;
  const plateWidth = compact ? (width - 56) / 2 : Math.min(300, width * 0.38);
  const plateY = height - 84;

  snapshot.fighters.forEach((fighter, index) => {
    const mirror = index === 1;
    const x = mirror ? width - 24 - plateWidth : 24;
    const player = players[fighter.player_id];
    const detail = `ELO ${player?.rating ?? "—"} · KD ${fighter.knockdowns} · W ${fighter.warnings} · −${fighter.deductions}`;
    const bars: BarSpec[] = [
      { label: `${compact ? "STA" : "STAMINA"} ${Math.round(fighter.stamina)}`, value: fighter.stamina, maximum: fighter.maximum_stamina, from: "#ffe08a", to: "#d9a53a" },
      { label: `${compact ? "HP" : "HEALTH"} ${Math.round(fighter.conditioning)}`, value: fighter.conditioning, maximum: HUD_MAX_CONDITIONING, from: "#ff8a7a", to: "#b02a20" },
      { label: "GUARD", value: fighter.guard, maximum: HUD_MAX_GUARD, from: "#9ec7ff", to: "#3d6fb8" },
      { label: `POISE ${Math.round(fighter.poise)}`, value: fighter.poise, maximum: HUD_MAX_POISE, from: "#e8c890", to: "#8a6a34" },
    ];
    fighterPlate(ctx, x, plateY, plateWidth, player?.name ?? "Fighter", detail, bars.slice(0, 2), mirror, index === 0 ? "#3d6fb8" : "#b02a20");
    const miniY = plateY - 12;
    // Guard and poise ride above the plate, as wide as the plate's own bars once the plate is narrow.
    const miniWidth = Math.min(64, (plateWidth - 52) / 2);
    broadcastBar(ctx, mirror ? x + plateWidth - 20 - 2 * miniWidth : x + 20, miniY, miniWidth, bars[2]!, mirror);
    broadcastBar(ctx, mirror ? x + plateWidth - 8 - miniWidth : x + 32 + miniWidth, miniY, miniWidth, bars[3]!, mirror);
  });

  const seconds = Math.floor((clockTicks ?? snapshot.phase_ticks_remaining) / tickRate);
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  roundCard(ctx, width / 2, compact ? 54 : height - 84, clock, `ROUND ${snapshot.round_number}`, snapshot.phase.replace("_", " ").toUpperCase());
  if (inputLatencyMs !== null && final === null && snapshot.fighters.some((fighter) => fighter.player_id === viewerId)) {
    const rounded = Math.round(inputLatencyMs);
    ctx.save();
    ctx.textAlign = "right";
    ctx.font = "700 11px ui-monospace, monospace";
    ctx.fillStyle = rounded < 90 ? "rgba(170,200,180,0.75)" : rounded < 160 ? "rgba(240,200,110,0.9)" : "rgba(255,110,100,0.95)";
    ctx.fillText(`INPUT ${rounded} ms`, width - 24, compact ? 128 : 36);
    ctx.restore();
  }
  if (replayLabel !== null) {
    const tagY = compact ? 120 : 64;
    ctx.save();
    ctx.fillStyle = "rgba(3,6,12,0.82)";
    ctx.fillRect(24, tagY, 196, 34);
    ctx.fillStyle = "#ff3b3b";
    ctx.beginPath();
    ctx.arc(42, tagY + 17, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f6f7fb";
    ctx.font = "800 14px Inter, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(replayLabel, 56, tagY + 22);
    ctx.restore();
  }

  if (roundCallout !== null && snapshot.phase === "fight") {
    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "900 46px Inter, system-ui, sans-serif";
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.strokeText(roundCallout, width / 2, height * 0.22);
    ctx.fillStyle = "#f6d57a";
    ctx.fillText(roundCallout, width / 2, height * 0.22);
    ctx.restore();
  }
  if (snapshot.phase === "countdown") {
    centerPanel(ctx, width, height, `ROUND ${snapshot.round_number}`, "Touch gloves. Protect yourself at all times.", topPanelOffset(width, height));
  }
  if (snapshot.phase === "knockdown") {
    const viewer = snapshot.fighters.find((fighter) => fighter.player_id === viewerId);
    const downed = snapshot.fighters.find((fighter) => fighter.is_downed) ?? viewer;
    const count = Math.max(...snapshot.fighters.map((fighter) => fighter.get_up_count));
    const downedName = players[downed?.player_id ?? ""]?.name ?? "Fighter";
    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "900 44px Inter, system-ui, sans-serif";
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.strokeText("KNOCKDOWN", width / 2, height * 0.16);
    ctx.fillStyle = "#ff4d4d";
    ctx.fillText("KNOCKDOWN", width / 2, height * 0.16);
    ctx.font = "700 15px Inter, system-ui, sans-serif";
    ctx.fillStyle = "#e6ecf7";
    ctx.fillText(`${fit(ctx, downedName.toUpperCase(), width * 0.5)} IS DOWN`, width / 2, height * 0.16 + 24);
    ctx.restore();
  }
  if (snapshot.phase === "knockdown" && replayLabel === null) {
    const viewer = snapshot.fighters.find((fighter) => fighter.player_id === viewerId);
    const count = Math.max(...snapshot.fighters.map((fighter) => fighter.get_up_count));
    if (viewer?.is_downed !== true) {
      ctx.save();
      ctx.textAlign = "center";
      ctx.font = "900 36px Inter, system-ui, sans-serif";
      ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(0,0,0,0.75)";
      ctx.strokeText(`COUNT ${count}`, width / 2, height * 0.16 + 64);
      ctx.fillStyle = "#ffd77a";
      ctx.fillText(`COUNT ${count}`, width / 2, height * 0.16 + 64);
      ctx.restore();
    } else {
      const panelWidth = Math.min(380, width - 24);
      const panelHeight = 150;
      const x = width / 2 - panelWidth / 2;
      const y = height * 0.24;
      ctx.fillStyle = "rgba(3,6,12,0.88)";
      ctx.fillRect(x, y, panelWidth, panelHeight);
      ctx.strokeStyle = "rgba(246,213,122,0.5)";
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 2, y + 2, panelWidth - 4, panelHeight - 4);
      ctx.textAlign = "center";
      ctx.fillStyle = "#ffd77a";
      ctx.font = "800 30px Inter, system-ui, sans-serif";
      ctx.fillText(`COUNT ${count}`, width / 2, y + 40);
      const prompt = viewer?.is_downed === true ? viewer.get_up_prompt : null;
      if (prompt !== null && prompt !== undefined && viewer !== undefined) {
        const inWindow = snapshot.tick >= viewer.get_up_window_start_tick && snapshot.tick <= viewer.get_up_window_end_tick;
        const arrow = prompt === "get_up_left" ? "←" : "→";
        if (inWindow) {
          ctx.fillStyle = "#ffe9a8";
          ctx.font = "900 64px Inter, system-ui, sans-serif";
          ctx.fillText(arrow, width / 2 - 90, y + 106);
          ctx.fillStyle = "#7dffa8";
          ctx.font = "900 34px Inter, system-ui, sans-serif";
          ctx.fillText("NOW!", width / 2 + 62, y + 100);
        } else {
          ctx.fillStyle = "#8fa3c8";
          ctx.font = "800 30px Inter, system-ui, sans-serif";
          ctx.fillText(`GET READY ${arrow}`, width / 2, y + 98);
        }
        const meterWidth = panelWidth - 60;
        const ratio = Math.max(0, Math.min(1, viewer.get_up_meter / Math.max(1, viewer.get_up_required)));
        ctx.fillStyle = "rgba(2,4,9,0.9)";
        ctx.fillRect(x + 30, y + 120, meterWidth, 16);
        const meterFill = ctx.createLinearGradient(x + 30, 0, x + 30 + meterWidth, 0);
        meterFill.addColorStop(0, "#7dffa8");
        meterFill.addColorStop(1, "#2ea860");
        ctx.fillStyle = meterFill;
        ctx.fillRect(x + 30, y + 120, meterWidth * ratio, 16);
        ctx.strokeStyle = "rgba(210,220,235,0.5)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 29.5, y + 119.5, meterWidth + 1, 17);
      } else {
        ctx.fillStyle = "#c8d3e6";
        ctx.font = "600 14px Inter, system-ui, sans-serif";
        ctx.fillText("Waiting for your rhythm instruction…", width / 2, y + 100);
      }
    }
  }
  if (snapshot.phase === "foul_recovery") {
    const victim = snapshot.fighters.find((fighter) => fighter.is_foul_recovery_target);
    centerPanel(ctx, width, height, "FOUL RECOVERY", `${players[victim?.player_id ?? ""]?.name ?? "Fighter"} is recovering`, topPanelOffset(width, height));
  }
  if (snapshot.phase === "rest") {
    const statsLine = snapshot.fighters
      .map((fighter) => ({ name: players[fighter.player_id]?.name ?? "Fighter", stats: roundStats?.get(fighter.player_id) ?? { thrown: 0, landed: 0 } }))
      .filter(({ stats }) => stats.thrown > 0 || stats.landed > 0)
      .map(({ name, stats }) => `${fit(ctx, name, width * 0.22)} ${stats.landed}/${stats.thrown}`)
      .join("  ·  ");
    centerPanel(ctx, width, height, "CORNERS · RECOVER", statsLine.length > 0 ? `Landed this round: ${statsLine}` : "Conditioning governs recovery", topPanelOffset(width, height));
  }
  if (reconnectMs > 0) {
    centerPanel(ctx, width, height, `OPPONENT RECONNECTING · ${Math.ceil(reconnectMs / 1000)}s`, "The bout is paused");
  }
  if (final !== null) drawFinal(ctx, width, height, final, players, snapshot.fighters.map((fighter) => ({ name: players[fighter.player_id]?.name ?? "Fighter", stats: roundStats?.total(fighter.player_id) ?? { thrown: 0, landed: 0 } })));
  ctx.restore();
}

function fitted(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, weight: number, maximum: number, minimum: number, family = "Inter, system-ui, sans-serif"): void {
  const size = fitFontSize((candidate) => {
    ctx.font = `${weight} ${candidate}px ${family}`;
    return ctx.measureText(text).width;
  }, maxWidth, maximum, minimum);
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.fillText(fit(ctx, text, maxWidth), x, y);
}

function drawFinal(ctx: CanvasRenderingContext2D, width: number, height: number, final: FinalMessage, players: Readonly<Record<string, PublicPlayer>>, punches: readonly { name: string; stats: RoundPunchStats }[] = []): void {
  ctx.fillStyle = "rgba(2,4,9,0.94)";
  ctx.fillRect(width * 0.14, height * 0.13, width * 0.72, height * 0.74);
  ctx.strokeStyle = "rgba(246,213,122,0.5)";
  ctx.lineWidth = 2;
  ctx.strokeRect(width * 0.14 + 4, height * 0.13 + 4, width * 0.72 - 8, height * 0.74 - 8);
  const inner = width * 0.72 - 32;
  ctx.textAlign = "center";
  ctx.fillStyle = "#f6d57a";
  fitted(ctx, decisionLabel(final), width / 2, height * 0.21, inner, 800, 26, 14);
  const winner = final.winner_id === null ? "DRAW" : `${players[final.winner_id]?.name ?? "Winner"} WINS`;
  ctx.fillStyle = "white";
  fitted(ctx, winner, width / 2, height * 0.27, inner, 700, 18, 11);
  const thrown = punches.filter(({ stats }) => stats.thrown > 0);
  if (thrown.length > 0) {
    ctx.fillStyle = "#c8d3e6";
    ctx.font = "600 13px Inter, system-ui, sans-serif";
    const line = thrown.map(({ name, stats }) => `${fit(ctx, name, inner / thrown.length - 70)} ${stats.landed}/${stats.thrown} landed`).join("   ·   ");
    fitted(ctx, line, width / 2, height * 0.32, inner, 600, 13, 9);
  }
  final.scorecards.forEach((card, index) => {
    const y = height * 0.37 + index * 36;
    ctx.fillStyle = "#aebbd0";
    fitted(ctx, `${card.judge}  ${scoreTotal(card.player_one)} — ${scoreTotal(card.player_two)}  [${card.player_one.join("·")}] [${card.player_two.join("·")}]`, width / 2, y, inner, 400, 12, 8, "ui-monospace, monospace");
  });
  const ratings = Object.entries(final.ratings);
  ratings.forEach(([id, rating], index) => {
    ctx.fillStyle = rating.after >= rating.before ? "#55df9b" : "#ff7b74";
    const change = `${rating.before} → ${rating.after} (${rating.after - rating.before >= 0 ? "+" : ""}${rating.after - rating.before})`;
    fitted(ctx, `${players[id]?.name ?? "Fighter"}  ${change}`, width / 2, height * 0.61 + index * 27, inner, 600, 13, 9);
  });
}
