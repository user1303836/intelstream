import type { Hand, PunchClass, SemanticAction } from "../types";

export const PUNCH_KEYS: Readonly<Record<string, readonly [Hand, PunchClass]>> = {
  KeyF: ["left", "jab"], KeyJ: ["right", "jab"],
  KeyR: ["left", "straight"], KeyU: ["right", "straight"],
  KeyG: ["left", "hook"], KeyH: ["right", "hook"],
  KeyT: ["left", "uppercut"], KeyY: ["right", "uppercut"],
};
export const ACTION_KEYS: Readonly<Record<string, SemanticAction>> = {
  KeyZ: { kind: "slip_left" }, KeyX: { kind: "slip_right" }, KeyC: { kind: "weave" }, KeyV: { kind: "pull" },
  KeyB: { kind: "clinch" }, KeyN: { kind: "switch_stance" }, KeyM: { kind: "taunt" },
  Digit1: { kind: "foul", foul: "low_blow" }, Digit2: { kind: "foul", foul: "headbutt" },
  ArrowLeft: { kind: "get_up_left" }, ArrowRight: { kind: "get_up_right" },
};
export const ACTIVE_CODES = new Set([...Object.keys(PUNCH_KEYS), ...Object.keys(ACTION_KEYS), "KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "ShiftLeft", "ShiftRight", "AltLeft", "AltRight"]);
export const CONTROL_HELP = [
  "Move: W up · S down · A left · D right", "High / low guard: Q / E", "Left/right jab: F / J", "Left/right straight: R / U",
  "Left/right hook: G / H", "Left/right uppercut: T / Y", "Body: Shift · Power: Alt",
  "Slip: Z / X · Weave: C · Pull: V", "Clinch: B · Stance: N · Taunt: M · Fouls (on purpose): Shift+1 low blow / Shift+2 headbutt", "Get-up rhythm: ← / →",
  "Camera: K cycles broadcast, close and over the shoulder (behind your fighter, W walks at the opponent and A / D circle him).",
  "Controller move: left stick. High / low guard: left / right shoulder (independent of punches).",
  "Controller face classes: bottom jab · right straight · left hook · top uppercut.",
  "Controller face hand: hold D-pad left for left hand or D-pad right for right hand, then press a face punch; otherwise punches use the right hand. A direction used for a punch is consumed and does not evade.",
  "Controller modifiers: left trigger body · right trigger power.",
  "Controller actions: left stick press clinch · right stick press switch stance · hold right trigger + right stick press to taunt · D-pad up weave · D-pad down pull · tap and release D-pad left/right to slip; while down, D-pad left/right performs the private get-up rhythm immediately.",
  "Controller fouls: View/Back low blow · Menu/Start headbutt.",
  "Right-stick gesture: horizontal 0–22.5° hook · 22.5–45° jab · 45–70° straight · 70–90° uppercut; left/right direction selects hand.",
  "Between rounds, tell your corner what to work on: 1 close the cut · 2 bring down the swelling · 3 catch your breath (controller: left, top or right face button; or tap).",
] as const;

/** The Controls panel in sections instead of one list. */
export const CONTROL_SECTIONS: readonly { readonly title: string; readonly items: readonly string[] }[] = [
  { title: "Keyboard", items: CONTROL_HELP.filter((item) => !item.startsWith("Controller") && !item.startsWith("Right-stick") && !item.startsWith("Between rounds")) },
  { title: "Between rounds", items: CONTROL_HELP.filter((item) => item.startsWith("Between rounds")) },
  { title: "Controller", items: CONTROL_HELP.filter((item) => item.startsWith("Controller") || item.startsWith("Right-stick")) },
];
