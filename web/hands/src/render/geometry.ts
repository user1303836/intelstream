import type { SimulationInfo } from "../types";
export interface Point { readonly x: number; readonly y: number; readonly scale: number }
export interface Viewport { readonly width: number; readonly height: number }
export function projectRing(x: number, y: number, simulation: SimulationInfo, viewport: Viewport): Point {
  const nx = Math.max(-1.2, Math.min(1.2, x / simulation.ring_half_width));
  const ny = Math.max(-1.2, Math.min(1.2, y / simulation.ring_half_height));
  const depth = (ny + 1) / 2; const nearWidth = viewport.width * 0.84, farWidth = viewport.width * 0.55;
  const width = nearWidth + (farWidth - nearWidth) * depth;
  return { x: viewport.width / 2 + nx * width / 2, y: viewport.height * (0.75 - depth * 0.36), scale: 1.14 - depth * 0.35 };
}
export function resizeHighDpi(canvas: HTMLCanvasElement, maximumDpr = 2): { context: CanvasRenderingContext2D; viewport: Viewport; dpr: number } | null {
  const rect = canvas.getBoundingClientRect(); const width = Math.max(1, Math.round(rect.width)); const height = Math.max(1, Math.round(rect.height)); const dpr = Math.min(maximumDpr, Math.max(1, window.devicePixelRatio || 1));
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
  const context = canvas.getContext("2d"); if (context === null) return null; context.setTransform(dpr, 0, 0, dpr, 0, 0); return { context, viewport: { width, height }, dpr };
}
