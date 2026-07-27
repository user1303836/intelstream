import type { Settings } from "./settings";
import type { CombatEvent } from "./types";

type VibratingPad = Gamepad & {
  vibrationActuator?: {
    playEffect(type: "dual-rumble", parameters: { duration: number; strongMagnitude: number; weakMagnitude: number }): Promise<unknown>;
  } | null;
};
const patterns: Readonly<Record<string, readonly [number, number, number]>> = {
  block: [55, 0.12, 0.22], hit: [85, 0.3, 0.42], counter_hit: [105, 0.38, 0.5],
  stun: [125, 0.42, 0.55], knockdown: [180, 0.62, 0.65],
};

export class HapticFeedback {
  constructor(private readonly settings: () => Settings) {}

  event(event: CombatEvent): void {
    if (!this.settings().haptics) return;
    const pattern = patterns[event.kind];
    if (pattern === undefined || typeof navigator.getGamepads !== "function") return;
    let pads: (Gamepad | null)[];
    try {
      pads = [...navigator.getGamepads.call(navigator)];
    } catch {
      return;
    }
    const pad = pads.find((item): item is VibratingPad => item !== null && item.connected && "vibrationActuator" in item);
    const actuator = pad?.vibrationActuator;
    if (actuator == null || typeof actuator.playEffect !== "function") return;
    try {
      void Promise.resolve(actuator.playEffect("dual-rumble", {
        duration: Math.min(180, Math.max(0, pattern[0])),
        strongMagnitude: Math.min(0.65, Math.max(0, pattern[1])),
        weakMagnitude: Math.min(0.65, Math.max(0, pattern[2])),
      })).catch(() => undefined);
    } catch {
      // Some gamepad implementations throw before returning their advertised promise.
    }
  }
}
