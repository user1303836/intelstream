import type { EngineSnapshot, FinalMessage, PublicPlayer } from "../types";

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
  ctx.font = "800 16px Inter, system-ui, sans-serif";
  ctx.fillText(fit(ctx, name.toUpperCase(), width - 44), textX, y + 21);
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

function centerPanel(ctx: CanvasRenderingContext2D, width: number, height: number, title: string, subtitle: string, yOffset = 0): void {
  const panelWidth = 320;
  const panelHeight = 78;
  const x = width / 2 - panelWidth / 2;
  const y = height / 2 - panelHeight / 2 + yOffset;
  ctx.fillStyle = "rgba(3,6,12,0.88)";
  ctx.fillRect(x, y, panelWidth, panelHeight);
  ctx.strokeStyle = "rgba(246,213,122,0.45)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 2, y + 2, panelWidth - 4, panelHeight - 4);
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffd77a";
  ctx.font = "800 22px Inter, system-ui, sans-serif";
  ctx.fillText(title, width / 2, y + 34);
  ctx.fillStyle = "#c8d3e6";
  ctx.font = "600 12px Inter, system-ui, sans-serif";
  ctx.fillText(subtitle, width / 2, y + 58);
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
): void {
  ctx.save();
  ctx.textBaseline = "alphabetic";
  const plateWidth = Math.min(300, width * 0.38);
  const plateY = height - 84;

  snapshot.fighters.forEach((fighter, index) => {
    const mirror = index === 1;
    const x = mirror ? width - 24 - plateWidth : 24;
    const player = players[fighter.player_id];
    const detail = `ELO ${player?.rating ?? "—"} · KD ${fighter.knockdowns} · W ${fighter.warnings} · −${fighter.deductions}`;
    const bars: BarSpec[] = [
      { label: `STAMINA ${Math.round(fighter.stamina)}`, value: fighter.stamina, maximum: fighter.maximum_stamina, from: "#ffe08a", to: "#d9a53a" },
      { label: `HEALTH ${Math.round(fighter.conditioning)}`, value: fighter.conditioning, maximum: HUD_MAX_CONDITIONING, from: "#ff8a7a", to: "#b02a20" },
      { label: "GUARD", value: fighter.guard, maximum: HUD_MAX_GUARD, from: "#9ec7ff", to: "#3d6fb8" },
      { label: `POISE ${Math.round(fighter.poise)}`, value: fighter.poise, maximum: HUD_MAX_POISE, from: "#e8c890", to: "#8a6a34" },
    ];
    fighterPlate(ctx, x, plateY, plateWidth, player?.name ?? "Fighter", detail, bars.slice(0, 2), mirror, index === 0 ? "#3d6fb8" : "#b02a20");
    const miniY = plateY - 12;
    broadcastBar(ctx, mirror ? x + plateWidth - 148 : x + 20, miniY, 64, bars[2]!, mirror);
    broadcastBar(ctx, mirror ? x + plateWidth - 72 : x + 96, miniY, 64, bars[3]!, mirror);
  });

  const seconds = Math.floor(snapshot.phase_ticks_remaining / tickRate);
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  roundCard(ctx, width / 2, height - 84, clock, `ROUND ${snapshot.round_number}`, snapshot.phase.replace("_", " ").toUpperCase());

  if (snapshot.phase === "knockdown") {
    const viewer = snapshot.fighters.find((fighter) => fighter.player_id === viewerId);
    const count = Math.max(...snapshot.fighters.map((fighter) => fighter.get_up_count));
    const subtitle = viewer?.get_up_prompt !== null && viewer?.get_up_prompt !== undefined
      ? `YOUR RHYTHM: ${viewer.get_up_prompt === "get_up_left" ? "←" : "→"}  ${viewer.get_up_meter}/${viewer.get_up_required}`
      : "Waiting for the count";
    centerPanel(ctx, width, height, `COUNT ${count}`, subtitle, -height * 0.18);
  }
  if (snapshot.phase === "foul_recovery") {
    const victim = snapshot.fighters.find((fighter) => fighter.is_foul_recovery_target);
    centerPanel(ctx, width, height, "FOUL RECOVERY", `${players[victim?.player_id ?? ""]?.name ?? "Fighter"} is recovering`);
  }
  if (snapshot.phase === "rest") {
    centerPanel(ctx, width, height, "CORNERS · RECOVER", "Conditioning governs recovery");
  }
  if (reconnectMs > 0) {
    centerPanel(ctx, width, height, `OPPONENT RECONNECTING · ${Math.ceil(reconnectMs / 1000)}s`, "The bout is paused");
  }
  if (final !== null) drawFinal(ctx, width, height, final, players);
  ctx.restore();
}

function drawFinal(ctx: CanvasRenderingContext2D, width: number, height: number, final: FinalMessage, players: Readonly<Record<string, PublicPlayer>>): void {
  ctx.fillStyle = "rgba(2,4,9,0.94)";
  ctx.fillRect(width * 0.14, height * 0.13, width * 0.72, height * 0.74);
  ctx.strokeStyle = "rgba(246,213,122,0.5)";
  ctx.lineWidth = 2;
  ctx.strokeRect(width * 0.14 + 4, height * 0.13 + 4, width * 0.72 - 8, height * 0.74 - 8);
  ctx.textAlign = "center";
  ctx.fillStyle = "#f6d57a";
  ctx.font = "800 26px Inter, system-ui, sans-serif";
  ctx.fillText(final.method.replaceAll("_", " ").toUpperCase(), width / 2, height * 0.21);
  const winner = final.winner_id === null ? "DRAW" : `${players[final.winner_id]?.name ?? "Winner"} WINS`;
  ctx.fillStyle = "white";
  ctx.font = "700 18px Inter, system-ui, sans-serif";
  ctx.fillText(fit(ctx, winner, width * 0.6), width / 2, height * 0.27);
  ctx.font = "12px ui-monospace, monospace";
  final.scorecards.forEach((card, index) => {
    const y = height * 0.37 + index * 36;
    ctx.fillStyle = "#aebbd0";
    ctx.fillText(`${fit(ctx, card.judge, 100)}  ${scoreTotal(card.player_one)} — ${scoreTotal(card.player_two)}  [${card.player_one.join("·")}] [${card.player_two.join("·")}]`, width / 2, y);
  });
  const ratings = Object.entries(final.ratings);
  ctx.font = "600 13px Inter, system-ui, sans-serif";
  ratings.forEach(([id, rating], index) => {
    ctx.fillStyle = rating.after >= rating.before ? "#55df9b" : "#ff7b74";
    ctx.fillText(`${fit(ctx, players[id]?.name ?? "Fighter", 100)}  ${rating.before} → ${rating.after} (${rating.after - rating.before >= 0 ? "+" : ""}${rating.after - rating.before})`, width / 2, height * 0.61 + index * 27);
  });
}
