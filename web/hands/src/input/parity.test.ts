import { PUNCH_KEYS } from "./bindings";
import { GamepadInput } from "./gamepad";
import { KeyboardInput } from "./keyboard";
import type { Hand, PunchClass } from "../types";
const button = (down: boolean): GamepadButton => ({ pressed: down, touched: down, value: down ? 1 : 0 });
const pad = (down: number[]): Gamepad => ({ id: "pad", index: 0, connected: true, timestamp: 1, mapping: "standard", axes: [0, 0, 0, 0], buttons: Array.from({ length: 18 }, (_, index) => button(down.includes(index))) } as unknown as Gamepad);
const keyFor = (hand: Hand, punchClass: PunchClass): string => Object.entries(PUNCH_KEYS).find(([, value]) => value[0] === hand && value[1] === punchClass)![0];
describe("keyboard/controller byte-semantic parity", () => {
  it.each(["left", "right"] as const)("matches all %s punch class/target/power combinations", (hand) => {
    const classes = ["jab", "straight", "hook", "uppercut"] as const, targets = ["head", "body"] as const, powers = ["normal", "power"] as const;
    for (const punchClass of classes) for (const target of targets) for (const power of powers) {
      const keyboard = new KeyboardInput(); if (target === "body") window.dispatchEvent(new KeyboardEvent("keydown", { code: "ShiftLeft" })); if (power === "power") window.dispatchEvent(new KeyboardEvent("keydown", { code: "AltLeft" })); window.dispatchEvent(new KeyboardEvent("keydown", { code: keyFor(hand, punchClass) })); const keyboardAction = keyboard.frame().actions[0]; keyboard.destroy();
      const buttons = [classes.indexOf(punchClass), hand === "left" ? 14 : 15]; if (target === "body") buttons.push(6); if (power === "power") buttons.push(7); Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [pad(buttons)] }); const gamepad = new GamepadInput(); (gamepad as unknown as { poll(): void }).poll(); const gamepadAction = gamepad.frame().actions[0]; gamepad.destroy();
      expect(JSON.stringify(gamepadAction), `${hand}/${punchClass}/${target}/${power}`).toBe(JSON.stringify(keyboardAction));
    }
  });
  it("controller alternatives cover every non-punch action", () => { const map = new Map<number, string>([[8, "foul"], [9, "foul"], [10, "clinch"], [11, "switch_stance"], [12, "weave"], [13, "pull"], [14, "slip_left"], [15, "slip_right"]]); for (const [index, kind] of map) { let current = pad([index]); Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [current] }); const input = new GamepadInput(); (input as unknown as { poll(): void }).poll(); if (index === 14 || index === 15) { expect(input.frame().actions).toEqual([]); current = pad([]); (input as unknown as { poll(): void }).poll(); } expect(input.frame().actions[0]?.kind).toBe(kind); input.destroy(); } });
});
