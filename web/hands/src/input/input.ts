import { GamepadInput } from "./gamepad";
import { KeyboardInput } from "./keyboard";
import type { InputFrame } from "../types";

export class InputController {
  readonly keyboard = new KeyboardInput(); readonly gamepad = new GamepadInput();
  readonly reset = (): void => { this.keyboard.reset(); this.gamepad.reset(); this.gamepad.setKnockdown(false); };
  constructor() { window.addEventListener("blur", this.reset); document.addEventListener("visibilitychange", this.visibility); }
  private readonly visibility = (): void => { if (document.hidden) this.reset(); };
  setActive(active: boolean): void { this.keyboard.setEnabled(active); this.gamepad.setEnabled(active); }
  setKnockdown(value: boolean): void { this.gamepad.setKnockdown(value); }
  frame(): InputFrame {
    const keyboard = this.keyboard.frame(4); const gamepad = this.gamepad.frame(Math.max(0, 4 - keyboard.actions.length));
    return { moveX: gamepad.moveX !== 0 ? gamepad.moveX : keyboard.moveX, moveY: gamepad.moveY !== 0 ? gamepad.moveY : keyboard.moveY, defense: gamepad.defense !== "none" ? gamepad.defense : keyboard.defense, actions: [...keyboard.actions, ...gamepad.actions].slice(0, 4) };
  }
  destroy(): void { window.removeEventListener("blur", this.reset); document.removeEventListener("visibilitychange", this.visibility); this.keyboard.destroy(); this.gamepad.destroy(); }
}
