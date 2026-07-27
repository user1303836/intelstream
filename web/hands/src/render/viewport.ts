export interface Viewport { readonly width: number; readonly height: number }

export function resizeHighDpi(canvas: HTMLCanvasElement, maximumDpr = 2): { context: CanvasRenderingContext2D; viewport: Viewport; dpr: number } | null {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const dpr = Math.min(maximumDpr, Math.max(1, window.devicePixelRatio || 1));
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const context = canvas.getContext("2d");
  if (context === null) return null;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { context, viewport: { width, height }, dpr };
}
