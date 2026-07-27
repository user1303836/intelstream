import type { Hand, Power, PunchAction, PunchClass, Target } from "../types";

export interface Stick { readonly x: number; readonly y: number }
export function radialDeadzone(x: number, y: number, deadzone = 0.18): Stick {
  const rawMagnitude = Math.hypot(x, y); if (!Number.isFinite(rawMagnitude) || rawMagnitude <= deadzone) return { x: 0, y: 0 };
  const magnitude = Math.min(1, rawMagnitude); const scaled = (magnitude - deadzone) / (1 - deadzone);
  return { x: x / rawMagnitude * scaled, y: y / rawMagnitude * scaled };
}
const classify = (x: number, y: number): PunchClass => {
  const angle = Math.atan2(Math.abs(y), Math.abs(x)) * 180 / Math.PI;
  if (angle < 22.5) return "hook"; if (angle < 45) return "jab"; if (angle < 70) return "straight"; return "uppercut";
};
export class PunchGesture {
  private active = false; private hand: Hand = "right"; private target: Target = "head"; private power: Power = "normal";
  private peak: Stick = { x: 0, y: 0 }; private peakMagnitude = 0;
  update(x: number, y: number, body: boolean, power: boolean): PunchAction | null {
    const magnitude = Math.hypot(x, y);
    if (!this.active && magnitude >= 0.55 && Math.abs(x) >= 0.12) {
      this.active = true; this.hand = x < 0 ? "left" : "right"; this.target = body ? "body" : "head"; this.power = power ? "power" : "normal"; this.peak = { x, y }; this.peakMagnitude = magnitude; return null;
    }
    if (!this.active) return null;
    if (magnitude > this.peakMagnitude) { this.peak = { x, y }; this.peakMagnitude = magnitude; }
    if (magnitude <= 0.25) {
      const result: PunchAction = { kind: "punch", hand: this.hand, class: classify(this.peak.x, this.peak.y), target: this.target, power: this.power };
      this.reset(); return result;
    }
    return null;
  }
  reset(): void { this.active = false; this.peak = { x: 0, y: 0 }; this.peakMagnitude = 0; }
}
