import type { SimulationInfo } from "../types";

export const RING_FIGHT_HALF = 3.05;
export const RING_APRON_HALF = 3.85;
export const PLATFORM_HALF = 4.05;
export const POST_RADIUS = 3.42;
export const ROPE_HEIGHTS = [0.5, 0.88, 1.26] as const;
export const CANVAS_TOP = 0;

export interface WorldMapping {
  readonly x: (simX: number) => number;
  readonly z: (simY: number) => number;
}

export function worldMapping(simulation: SimulationInfo): WorldMapping {
  const scaleX = RING_FIGHT_HALF / Math.max(1, simulation.ring_half_width);
  const scaleZ = RING_FIGHT_HALF / Math.max(1, simulation.ring_half_height);
  return {
    x: (simX) => simX * scaleX,
    z: (simY) => simY * scaleZ,
  };
}

export const CORNER_COLORS = {
  blue: 0x1d4ed8,
  red: 0xb91c1c,
  neutral: 0xe5e7eb,
} as const;

export interface FighterPalette {
  readonly skin: number;
  readonly skinShadow: number;
  readonly trunks: number;
  readonly trunkTrim: number;
  readonly glove: number;
  readonly gloveTrim: number;
  readonly hair: number;
  readonly shoe: number;
}

export const PALETTES: readonly [FighterPalette, FighterPalette] = [
  {
    skin: 0xb0703f,
    skinShadow: 0x8a5430,
    trunks: 0x14406b,
    trunkTrim: 0xd9b45c,
    glove: 0x1d4ed8,
    gloveTrim: 0xe5e7eb,
    hair: 0x191411,
    shoe: 0x22303d,
  },
  {
    skin: 0x6e4128,
    skinShadow: 0x55301d,
    trunks: 0x6b1420,
    trunkTrim: 0xe5e7eb,
    glove: 0xb91c1c,
    gloveTrim: 0xd9b45c,
    hair: 0x0d0b0a,
    shoe: 0x2d1c1c,
  },
];
