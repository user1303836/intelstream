import type { Hand, PunchClass, SemanticAction } from "../types";

export const PUNCH_KEYS: Readonly<Record<string, readonly [Hand, PunchClass]>> = {
  KeyF: ["left", "jab"], KeyJ: ["right", "jab"],
  KeyR: ["left", "straight"], KeyU: ["right", "straight"],
  KeyG: ["left", "hook"], KeyH: ["right", "hook"],
  KeyT: ["left", "uppercut"], KeyY: ["right", "uppercut"],
};
export const ACTION_KEYS: Readonly<Record<string, SemanticAction>> = {
  KeyZ: { kind: "slip_left" }, KeyX: { kind: "slip_right" }, KeyC: { kind: "weave" }, KeyV: { kind: "pull" },
  KeyB: { kind: "clinch" }, KeyN: { kind: "switch_stance" },
  Digit1: { kind: "foul", foul: "low_blow" }, Digit2: { kind: "foul", foul: "headbutt" },
  ArrowLeft: { kind: "get_up_left" }, ArrowRight: { kind: "get_up_right" },
};
export const ACTIVE_CODES = new Set([...Object.keys(PUNCH_KEYS), ...Object.keys(ACTION_KEYS), "KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "ShiftLeft", "ShiftRight", "AltLeft", "AltRight"]);
export const CONTROL_HELP = [
  "Move: W up · S down · A left · D right", "High / low guard: Q / E", "Left/right jab: F / J", "Left/right straight: R / U",
  "Left/right hook: G / H", "Left/right uppercut: T / Y", "Body: Shift · Power: Alt",
  "Slip: Z / X · Weave: C · Pull: V", "Clinch: B · Stance: N · Fouls: 1 / 2", "Get-up rhythm: ← / →",
  "Controller move: left stick. High / low guard: left / right shoulder (independent of punches).",
  "Controller face classes: bottom jab · right straight · left hook · top uppercut.",
  "Controller face hand: hold D-pad left for left hand or D-pad right for right hand, then press a face punch; otherwise punches use the right hand. A direction used for a punch is consumed and does not evade.",
  "Controller modifiers: left trigger body · right trigger power.",
  "Controller actions: left stick press clinch · right stick press switch stance · D-pad up weave · D-pad down pull · tap and release D-pad left/right to slip; while down, D-pad left/right performs the private get-up rhythm immediately.",
  "Controller fouls: View/Back low blow · Menu/Start headbutt.",
  "Right-stick gesture: horizontal 0–22.5° hook · 22.5–45° jab · 45–70° straight · 70–90° uppercut; left/right direction selects hand.",
] as const;
