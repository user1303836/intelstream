import type { BloodLevel } from "../settings";
import type { CombatEvent } from "../types";
interface Particle { x: number; y: number; vx: number; vy: number; life: number; size: number; color: string }
interface Mark { x: number; y: number; size: number; alpha: number }
const seeded = (seed: number): (() => number) => () => { seed = Math.imul(seed ^ seed >>> 15, 1 | seed); seed ^= seed + Math.imul(seed ^ seed >>> 7, 61 | seed); return ((seed ^ seed >>> 14) >>> 0) / 4_294_967_296; };
export class ParticlePool {
  private readonly particles: Particle[] = []; private readonly marks: Mark[] = []; private shake = 0;
  constructor(private readonly maximum = 180, private readonly maximumMarks = 48) {}
  addEvent(event: CombatEvent, origin: { x: number; y: number }, bloodLevel: BloodLevel, reducedMotion: boolean): void {
    const rand = seeded(event.event_id + 1); const hit = ["hit", "counter_hit", "block", "knockdown", "bleed"].includes(event.kind); if (!hit) return;
    const bloodScale = bloodLevel === "off" ? 0 : bloodLevel === "reduced" ? 0.3 : 1;
    const count = reducedMotion ? 0 : Math.min(28, Math.round(event.blood / 6 * bloodScale)); const direction = event.direction >= 0 ? 1 : -1;
    for (let i = 0; i < count && this.particles.length < this.maximum; i += 1) this.particles.push({ x: origin.x, y: origin.y - 55, vx: direction * (30 + rand() * 100) + (rand() - 0.5) * 30, vy: -30 - rand() * 100, life: 0.45 + rand() * 0.55, size: 1.5 + rand() * 3, color: i % 4 === 0 ? "#ff514a" : "#8f151d" });
    if (event.blood > 12 && bloodScale > 0 && this.marks.length < this.maximumMarks) this.marks.push({ x: origin.x + direction * (15 + rand() * 45), y: origin.y + rand() * 8, size: (3 + rand() * 10) * bloodScale, alpha: 0.42 });
    if (!reducedMotion) this.shake = Math.min(9, this.shake + Math.max(1, event.amount / 70));
  }
  update(dt: number): void { for (const p of this.particles) { p.life -= dt; p.vy += 230 * dt; p.x += p.vx * dt; p.y += p.vy * dt; } for (let i = this.particles.length - 1; i >= 0; i -= 1) if (this.particles[i]!.life <= 0) this.particles.splice(i, 1); this.shake *= Math.pow(0.04, dt); }
  cameraOffset(time: number, reducedMotion: boolean): { x: number; y: number } { if (reducedMotion) return { x: 0, y: 0 }; return { x: Math.sin(time * 83) * this.shake, y: Math.cos(time * 67) * this.shake * 0.55 }; }
  drawMarks(ctx: CanvasRenderingContext2D): void { for (const mark of this.marks) { ctx.fillStyle = `rgba(105,13,20,${mark.alpha})`; ctx.beginPath(); ctx.ellipse(mark.x, mark.y, mark.size * 1.7, mark.size * 0.45, 0, 0, Math.PI * 2); ctx.fill(); } }
  draw(ctx: CanvasRenderingContext2D): void { for (const p of this.particles) { ctx.globalAlpha = Math.min(1, p.life * 2); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill(); } ctx.globalAlpha = 1; }
  get counts(): { particles: number; marks: number } { return { particles: this.particles.length, marks: this.marks.length }; }
  clearDynamic(): void { this.particles.length = 0; this.shake = 0; }
  clearBlood(): void { this.clearDynamic(); this.marks.length = 0; }
  clear(): void { this.clearBlood(); }
}
