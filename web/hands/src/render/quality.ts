export interface ResolutionScalerOptions {
  readonly maximum: number;
  readonly minimum: number;
  readonly slowMs: number;
  readonly fastMs: number;
  readonly windowMs: number;
  readonly step: number;
}

export const DEFAULT_SCALER_OPTIONS: ResolutionScalerOptions = {
  maximum: 1,
  minimum: 0.55,
  slowMs: 24,
  fastMs: 17.5,
  windowMs: 1000,
  step: 0.15,
};

const HOLD_WINDOWS_AFTER_NO_GAIN = 10;
const HOLD_WINDOWS_AFTER_FAILED_RAISE = 10;
const MAXIMUM_HOLD_WINDOWS = 160;
const FAST_WINDOWS_BEFORE_RAISE = 3;
const RAISE_TRIAL_WINDOWS = 3;

/**
 * Dynamic render-resolution controller. Frame times are averaged over a
 * window; a slow window lowers the scale one step, and three fast windows in a
 * row raise it again. A downscale that does not make the next window at least
 * ten percent faster is reverted and further downscales are held off, with
 * the hold doubling on every fruitless attempt, so a client whose frame time
 * is capped by its display or by the CPU keeps its full resolution. A raise
 * that brings a slow window back within three windows is undone at once and
 * further raises are held off the same way, so a client that needs exactly one
 * step down settles there instead of pumping between two scales.
 */
export class ResolutionScaler {
  scale: number;
  private elapsed = 0;
  private frames = 0;
  private fastWindows = 0;
  private holdWindows = 0;
  private fruitlessAttempts = 0;
  private pending: { readonly before: number; readonly previous: number } | null = null;
  private raised: { readonly previous: number; windows: number } | null = null;
  private raiseHoldWindows = 0;
  private failedRaises = 0;

  constructor(private readonly options: ResolutionScalerOptions = DEFAULT_SCALER_OPTIONS) {
    this.scale = options.maximum;
  }

  /** Records one frame interval in milliseconds; returns true when the scale changed. */
  record(frameMs: number): boolean {
    if (!(frameMs > 0) || frameMs > 1000) return false;
    this.elapsed += frameMs;
    this.frames += 1;
    if (this.elapsed < this.options.windowMs) return false;
    const average = this.elapsed / this.frames;
    this.elapsed = 0;
    this.frames = 0;
    if (this.pending !== null) {
      const pending = this.pending;
      this.pending = null;
      if (average > pending.before * 0.9) {
        this.scale = pending.previous;
        this.holdWindows = Math.min(MAXIMUM_HOLD_WINDOWS, HOLD_WINDOWS_AFTER_NO_GAIN * 2 ** this.fruitlessAttempts);
        this.fruitlessAttempts += 1;
        return true;
      }
      this.fruitlessAttempts = 0;
    }
    if (this.raised !== null) {
      const raised = this.raised;
      if (average > this.options.slowMs) {
        this.raised = null;
        this.scale = raised.previous;
        this.fastWindows = 0;
        this.raiseHoldWindows = Math.min(MAXIMUM_HOLD_WINDOWS, HOLD_WINDOWS_AFTER_FAILED_RAISE * 2 ** this.failedRaises);
        this.failedRaises += 1;
        return true;
      }
      raised.windows += 1;
      if (raised.windows >= RAISE_TRIAL_WINDOWS) {
        this.raised = null;
        this.failedRaises = 0;
      }
    }
    if (average > this.options.slowMs) {
      this.fastWindows = 0;
      if (this.holdWindows > 0) {
        this.holdWindows -= 1;
        return false;
      }
      if (this.scale <= this.options.minimum) return false;
      const previous = this.scale;
      this.scale = Math.max(this.options.minimum, this.scale - this.options.step);
      this.pending = { before: average, previous };
      return true;
    }
    if (average < this.options.fastMs) {
      this.fastWindows += 1;
      if (this.raiseHoldWindows > 0) {
        this.raiseHoldWindows -= 1;
        return false;
      }
      if (this.fastWindows >= FAST_WINDOWS_BEFORE_RAISE && this.scale < this.options.maximum) {
        this.fastWindows = 0;
        this.raised = { previous: this.scale, windows: 0 };
        this.scale = Math.min(this.options.maximum, this.scale + this.options.step);
        return true;
      }
      return false;
    }
    this.fastWindows = 0;
    return false;
  }
}
