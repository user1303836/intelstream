import { EventDeduplicator, SnapshotBuffer } from "../interpolation";
import type { BloodLevel, Settings } from "../settings";
import type { EngineSnapshot, FinalMessage, PublicPlayer, SimulationInfo } from "../types";
import { drawFighter, type FighterStyle } from "./fighters";
import { projectRing, resizeHighDpi, type Viewport } from "./geometry";
import { drawHud } from "./hud";
import { ParticlePool } from "./particles";
const STYLES: readonly FighterStyle[] = [
  { skin: "#a96848", trunks: "#173d58", glove: "#56b7c9", accent: "#f2cb72" },
  { skin: "#74462f", trunks: "#633045", glove: "#df6f68", accent: "#c9e7ec" },
];
export class FightRenderer {
  private readonly buffer = new SnapshotBuffer(); private readonly dedupe = new EventDeduplicator(); private readonly particles = new ParticlePool(); private raf = 0; private previous = performance.now();
  private players: Readonly<Record<string, PublicPlayer>> = {}; private viewerId: string | null = null; private final: FinalMessage | null = null; private reconnectMs = 0; private bloodLevel: BloodLevel; private destroyed = false;
  constructor(private readonly canvas: HTMLCanvasElement, private readonly simulation: SimulationInfo, private readonly settings: () => Settings) { this.bloodLevel = settings().blood; this.raf = requestAnimationFrame((time) => this.draw(time)); }
  setPlayers(players: Readonly<Record<string, PublicPlayer>>, viewerId: string | null): void { this.players = players; this.viewerId = viewerId; }
  setFinal(final: FinalMessage | null): void { this.final = final; }
  setReconnect(milliseconds: number): void { this.reconnectMs = milliseconds; }
  setBloodLevel(level: BloodLevel): void { if (level !== this.bloodLevel) { this.bloodLevel = level; this.particles.clearBlood(); } }
  setReducedMotion(reduced: boolean): void { if (reduced) this.particles.clearDynamic(); }
  push(snapshot: EngineSnapshot): void {
    if (!this.buffer.push(snapshot)) return; const resize = resizeHighDpi(this.canvas); if (resize === null) return;
    for (const event of this.dedupe.accept(snapshot.events)) { const target = snapshot.fighters.find((fighter) => fighter.player_id === event.target_id) ?? snapshot.fighters.find((fighter) => fighter.player_id === event.actor_id) ?? snapshot.fighters[0]; const origin = projectRing(target.x, target.y, this.simulation, resize.viewport); this.particles.addEvent(event, origin, this.settings().blood, this.settings().reducedMotion); }
  }
  private draw(time: number): void {
    if (this.destroyed) return;
    const resized = resizeHighDpi(this.canvas); if (resized !== null) { const dt = Math.min(0.05, Math.max(0, (time - this.previous) / 1000)); this.previous = time; this.particles.update(dt); this.paint(resized.context, resized.viewport, time / 1000); }
    if (!this.destroyed) this.raf = requestAnimationFrame((next) => this.draw(next));
  }
  private paint(ctx: CanvasRenderingContext2D, viewport: Viewport, time: number): void {
    const settings = this.settings(); this.setBloodLevel(settings.blood); if (settings.reducedMotion) this.particles.clearDynamic(); const offset = this.particles.cameraOffset(time, settings.reducedMotion); ctx.save(); ctx.clearRect(0, 0, viewport.width, viewport.height); ctx.translate(offset.x, offset.y);
    const sky = ctx.createLinearGradient(0, 0, 0, viewport.height); sky.addColorStop(0, "#090d18"); sky.addColorStop(0.55, "#151a27"); sky.addColorStop(1, "#07090d"); ctx.fillStyle = sky; ctx.fillRect(-12, -12, viewport.width + 24, viewport.height + 24);
    drawCrowd(ctx, viewport, settings.reducedMotion ? 0 : time); drawRing(ctx, viewport); this.particles.drawMarks(ctx);
    const latest = this.buffer.latest(); const snapshot = latest === null ? null : this.buffer.sample(latest.tick - 1);
    if (snapshot !== null) {
      const ordered = snapshot.fighters.map((fighter, index) => ({ fighter, index, point: projectRing(fighter.x, fighter.y, this.simulation, viewport) })).sort((a, b) => a.fighter.y - b.fighter.y);
      for (const item of ordered) drawFighter(ctx, item.fighter, item.point, snapshot.phase, STYLES[item.index]!, time, settings.reducedMotion, settings.blood);
      if (!settings.reducedMotion) this.particles.draw(ctx); drawForegroundRopes(ctx, viewport); drawHud(ctx, viewport.width, viewport.height, snapshot, this.players, this.viewerId, this.final, this.reconnectMs, this.simulation.tick_rate);
      const hurt = Math.max(...snapshot.fighters.map((fighter) => fighter.trauma.head + fighter.trauma.body)); if (hurt > 350) { const vignette = ctx.createRadialGradient(viewport.width / 2, viewport.height / 2, viewport.width * 0.2, viewport.width / 2, viewport.height / 2, viewport.width * 0.7); vignette.addColorStop(0, "rgba(90,0,8,0)"); vignette.addColorStop(1, `rgba(75,0,8,${Math.min(0.28, hurt / 5000)})`); ctx.fillStyle = vignette; ctx.fillRect(0, 0, viewport.width, viewport.height); }
    }
    ctx.restore();
  }
  destroy(): void { if (this.destroyed) return; this.destroyed = true; cancelAnimationFrame(this.raf); this.raf = 0; this.buffer.clear(); this.dedupe.reset(); this.particles.clear(); }
}
function drawCrowd(ctx: CanvasRenderingContext2D, viewport: Viewport, time: number): void { ctx.fillStyle = "#111726"; ctx.fillRect(0, viewport.height * 0.19, viewport.width, viewport.height * 0.24); const count = Math.ceil(viewport.width / 17); for (let i = 0; i < count; i += 1) { const x = i * 17 + 4, y = viewport.height * 0.35 + Math.sin(i * 9.7 + time * 0.7) * 3; ctx.fillStyle = i % 4 === 0 ? "#252d40" : "#1b2231"; ctx.beginPath(); ctx.arc(x, y - 16, 5, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(x - 6, y - 11, 12, 25); } }
function corners(viewport: Viewport): readonly [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }] { return [{ x: viewport.width * 0.225, y: viewport.height * 0.39 }, { x: viewport.width * 0.775, y: viewport.height * 0.39 }, { x: viewport.width * 0.92, y: viewport.height * 0.76 }, { x: viewport.width * 0.08, y: viewport.height * 0.76 }]; }
function drawRing(ctx: CanvasRenderingContext2D, viewport: Viewport): void { const c = corners(viewport); ctx.fillStyle = "#b8bec2"; ctx.beginPath(); ctx.moveTo(c[0].x, c[0].y); for (const point of c.slice(1)) ctx.lineTo(point.x, point.y); ctx.closePath(); ctx.fill(); ctx.strokeStyle = "rgba(40,49,60,.2)"; ctx.lineWidth = 1; for (let i = 1; i < 9; i += 1) { const y = c[0].y + (c[3].y - c[0].y) * i / 9; ctx.beginPath(); ctx.moveTo(viewport.width * (0.225 - i * 0.016), y); ctx.lineTo(viewport.width * (0.775 + i * 0.016), y); ctx.stroke(); } for (const point of c) { ctx.fillStyle = "#202b38"; ctx.fillRect(point.x - 6, point.y - 75, 12, 82); } ctx.strokeStyle = "#74899a"; ctx.lineWidth = 4; for (let rail = 0; rail < 3; rail += 1) { const lift = 26 + rail * 18; ctx.beginPath(); ctx.moveTo(c[0].x, c[0].y - lift); ctx.lineTo(c[1].x, c[1].y - lift); ctx.stroke(); } }
function drawForegroundRopes(ctx: CanvasRenderingContext2D, viewport: Viewport): void { const c = corners(viewport); for (let rail = 0; rail < 3; rail += 1) { const lift = 18 + rail * 18; ctx.strokeStyle = rail === 1 ? "#c8d2d8" : "#7f2731"; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(c[3].x, c[3].y - lift); ctx.lineTo(c[2].x, c[2].y - lift); ctx.stroke(); } }
