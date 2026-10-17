/** Drops the lens holds at most: past that the oldest is wiped off to make room. */
export const MOST_LENS_DROPS = 96;
const SPRITE_SIZE = 96;
const SPRITE_COUNT = 4;
/** Seconds a drop stays on the lens, and the last share of them it takes to fade. */
const LENS_SECONDS_LOW = 2.5;
const LENS_SECONDS_HIGH = 5;
const LENS_FADE = 0.45;
/** A drop this big (a share of the screen's height) or bigger runs down the lens before it fades. */
const RUNNING_DROP = 0.032;

interface LensDrop {
  x: number;
  y: number;
  /** As a share of the screen's height. */
  radius: number;
  alpha: number;
  life: number;
  maxLife: number;
  /** How fast it runs down the lens and how far it has run, as shares of the screen's height. */
  run: number;
  ran: number;
  sprite: number;
  turn: number;
}

const seeded = (seed: number): (() => number) => () => {
  seed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed);
  return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
};

/**
 * A splash of blood on glass, seen out of focus: a ragged blot darkest at its rim where it is thickest,
 * runs thrown out from it as it hit, and flecks round it.
 */
function lensSprite(seed: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_SIZE;
  canvas.height = SPRITE_SIZE;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return canvas;
  const rand = seeded(seed);
  const middle = SPRITE_SIZE / 2;
  const lobes = 4 + Math.floor(rand() * 3);
  for (let lobe = 0; lobe < lobes; lobe += 1) {
    const angle = rand() * Math.PI * 2;
    const reach = lobe === 0 ? 0 : 9 + rand() * 11;
    const x = middle + Math.cos(angle) * reach;
    const y = middle + Math.sin(angle) * reach;
    const radius = lobe === 0 ? 21 : 8 + rand() * 9;
    const body = ctx.createRadialGradient(x, y, 0, x, y, radius);
    body.addColorStop(0, "rgba(140,4,10,0.55)");
    body.addColorStop(0.7, "rgba(100,0,6,0.85)");
    body.addColorStop(0.92, "rgba(50,0,3,0.95)");
    body.addColorStop(1, "rgba(50,0,3,0)");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(92,0,6,0.85)";
  for (let spike = 0; spike < 4 + Math.floor(rand() * 5); spike += 1) {
    const angle = rand() * Math.PI * 2;
    const reach = 20 + rand() * 12;
    ctx.beginPath();
    ctx.ellipse(middle + Math.cos(angle) * reach, middle + Math.sin(angle) * reach, 5 + rand() * 8, 1.4 + rand() * 1.8, angle, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let fleck = 0; fleck < 4 + Math.floor(rand() * 5); fleck += 1) {
    const angle = rand() * Math.PI * 2;
    const reach = 32 + rand() * 13;
    ctx.beginPath();
    ctx.arc(middle + Math.cos(angle) * reach, middle + Math.sin(angle) * reach, 1 + rand() * 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(255,210,210,0.1)";
  ctx.beginPath();
  ctx.ellipse(middle - 6, middle - 7, 6, 3, -0.6, 0, Math.PI * 2);
  ctx.fill();
  return canvas;
}

/**
 * Blood thrown at the camera: drops that land on its lens, drawn over the picture and under the broadcast's
 * graphics. Big drops run down the glass; all of them fade away within a few seconds.
 */
export class LensBlood {
  private readonly drops: LensDrop[] = [];
  private sprites: HTMLCanvasElement[] | null = null;

  /** Drops on the lens now. */
  get count(): number {
    return this.drops.length;
  }

  /**
   * Spatters the lens round (x, y), as shares of the screen across and down, `strength` from a few small
   * drops (0.2) to a soaking (3) with a big gob or two running down the glass.
   */
  splash(x: number, y: number, strength: number, seed: number): void {
    if (!(strength > 0.05) || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const rand = seeded((Number.isSafeInteger(seed) ? seed : 0) * 40_503 + 11);
    const count = Math.min(24, Math.max(1, Math.round(strength * 12)));
    const size = 0.7 + 0.3 * Math.min(3, strength);
    for (let drop = 0; drop < count; drop += 1) {
      // Most land round where the blow is on the screen, a few anywhere on the glass.
      const anywhere = rand() < 0.2;
      const spread = 0.12 + 0.12 * Math.min(3, strength);
      const radius = (0.01 + rand() ** 2 * 0.04) * size * (drop === 0 && strength >= 1.5 ? 1.8 : 1);
      const maxLife = LENS_SECONDS_LOW + rand() * (LENS_SECONDS_HIGH - LENS_SECONDS_LOW);
      this.drops.push({
        x: Math.min(1, Math.max(0, anywhere ? rand() : x + (rand() + rand() - 1) * spread * 1.6)),
        y: Math.min(1, Math.max(0, anywhere ? rand() : y + (rand() + rand() - 1) * spread)),
        radius,
        alpha: 0.6 + rand() * 0.35,
        life: maxLife,
        maxLife,
        run: radius >= RUNNING_DROP ? 0.02 + rand() * 0.04 : 0,
        ran: 0,
        sprite: Math.floor(rand() * SPRITE_COUNT),
        turn: rand() * Math.PI * 2,
      });
    }
    if (this.drops.length > MOST_LENS_DROPS) this.drops.splice(0, this.drops.length - MOST_LENS_DROPS);
  }

  update(dt: number): void {
    const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    for (let index = this.drops.length - 1; index >= 0; index -= 1) {
      const drop = this.drops[index]!;
      drop.life -= step;
      if (drop.life <= 0) {
        this.drops.splice(index, 1);
        continue;
      }
      // A running drop slows as it leaves its blood on the glass behind it.
      drop.ran += drop.run * step * (drop.life / drop.maxLife);
    }
  }

  draw(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    if (this.drops.length === 0) return;
    this.sprites ??= Array.from({ length: SPRITE_COUNT }, (_, index) => lensSprite(0x51ed_270b + index * 7919));
    ctx.save();
    for (const drop of this.drops) {
      const fade = Math.min(1, drop.life / (drop.maxLife * LENS_FADE));
      const radius = drop.radius * height;
      const x = drop.x * width;
      const y = (drop.y + drop.ran) * height;
      ctx.globalAlpha = drop.alpha * fade;
      if (drop.ran > 0) {
        // The trail a running drop leaves on the glass, thinning and fading back up to where it landed.
        const top = drop.y * height;
        const trail = ctx.createLinearGradient(0, top, 0, y);
        trail.addColorStop(0, "rgba(88,0,6,0)");
        trail.addColorStop(1, "rgba(88,0,6,0.6)");
        ctx.fillStyle = trail;
        ctx.beginPath();
        ctx.moveTo(x - radius * 0.06, top);
        ctx.lineTo(x + radius * 0.06, top);
        ctx.lineTo(x + radius * 0.28, y);
        ctx.lineTo(x - radius * 0.28, y);
        ctx.closePath();
        ctx.fill();
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(drop.turn);
      ctx.drawImage(this.sprites[drop.sprite]!, -radius, -radius, radius * 2, radius * 2);
      ctx.restore();
    }
    ctx.restore();
  }

  clear(): void {
    this.drops.length = 0;
  }
}
