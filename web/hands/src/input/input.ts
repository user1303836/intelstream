import { SharedActionIntent } from "./action-buffer";
import { GamepadInput } from "./gamepad";
import { KeyboardInput } from "./keyboard";
import type { InputFrame, SemanticAction } from "../types";

export class InputController {
  private readonly actions = new SharedActionIntent(1);
  readonly keyboard: KeyboardInput; readonly gamepad: GamepadInput;
  readonly reset = (): void => { this.keyboard.reset(); this.gamepad.reset(); this.actions.clear(); this.gamepad.setKnockdown(false); };
  constructor() { this.keyboard = new KeyboardInput(window, 1, this.actions); this.gamepad = new GamepadInput(1, this.actions); window.addEventListener("blur", this.reset); document.addEventListener("visibilitychange", this.visibility); }
  private readonly visibility = (): void => { if (document.hidden) this.reset(); };
  setActive(active: boolean): void { this.keyboard.setEnabled(active); this.gamepad.setEnabled(active); }
  setKnockdown(value: boolean): void { this.gamepad.setKnockdown(value); }
  onAction(listener: ((action: SemanticAction) => void) | null): void { this.actions.setListener(listener); }
  frame(): InputFrame {
    const keyboard = this.keyboard.frame(0); const gamepad = this.gamepad.frame(0);
    return { moveX: gamepad.moveX !== 0 ? gamepad.moveX : keyboard.moveX, moveY: gamepad.moveY !== 0 ? gamepad.moveY : keyboard.moveY, defense: gamepad.defense !== "none" ? gamepad.defense : keyboard.defense, actions: this.actions.drain(4) };
  }
  destroy(): void { window.removeEventListener("blur", this.reset); document.removeEventListener("visibilitychange", this.visibility); this.keyboard.destroy(); this.gamepad.destroy(); }
}
