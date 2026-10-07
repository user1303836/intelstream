import { SharedActionIntent } from "./action-buffer";
import { GamepadInput } from "./gamepad";
import { KeyboardInput } from "./keyboard";
import { TouchInput, coarsePointer } from "./touch";
import type { HeldInput } from "../prediction";
import type { InputFrame, SemanticAction } from "../types";

/**
 * Turns a stick or key direction given relative to the camera into the ring's own axes. `forwardX`
 * and `forwardZ` are the unit direction the camera faces along the canvas in world space; the
 * broadcast camera faces world -z, which leaves a move unchanged. Ring +y is world -z.
 */
export function viewRelativeMove(moveX: number, moveY: number, forwardX: number, forwardZ: number): { moveX: number; moveY: number } {
  const clamp = (value: number): number => Math.max(-1000, Math.min(1000, Math.round(value))) || 0;
  return { moveX: clamp(-forwardZ * moveX + forwardX * moveY), moveY: clamp(-forwardX * moveX - forwardZ * moveY) };
}

export class InputController {
  private readonly actions = new SharedActionIntent(1);
  readonly keyboard: KeyboardInput; readonly gamepad: GamepadInput; touch: TouchInput | null = null;
  readonly reset = (): void => { this.keyboard.reset(); this.gamepad.reset(); this.touch?.reset(); this.actions.clear(); this.gamepad.setKnockdown(false); };
  constructor() { this.keyboard = new KeyboardInput(window, 1, this.actions); this.gamepad = new GamepadInput(1, this.actions); window.addEventListener("blur", this.reset); document.addEventListener("visibilitychange", this.visibility); }
  private readonly visibility = (): void => { if (document.hidden) this.reset(); };
  attachTouch(container: HTMLElement, force = coarsePointer()): void { if (this.touch !== null || !force) return; this.touch = new TouchInput(container, this.actions); }
  /** `touchShown` keeps the touch controls on screen, inert, while input is off (the rest, a pause). */
  setActive(active: boolean, touchShown = active): void { this.keyboard.setEnabled(active); this.gamepad.setEnabled(active); this.touch?.setEnabled(active, touchShown); }
  setKnockdown(value: boolean): void { this.gamepad.setKnockdown(value); this.touch?.setKnockdown(value); }
  onAction(listener: ((action: SemanticAction) => void) | null): void { this.actions.setListener(listener); }
  /** While the camera turns with the player's fighter, up on the stick or W walks the way it faces. */
  setViewForward(provider: (() => { readonly x: number; readonly z: number } | null) | null): void { this.viewForward = provider; }
  private viewForward: (() => { readonly x: number; readonly z: number } | null) | null = null;
  held(): HeldInput {
    const keyboard = this.keyboard.frame(0); const gamepad = this.gamepad.frame(0); const touch = this.touch?.frame() ?? null;
    const moveX = gamepad.moveX !== 0 ? gamepad.moveX : touch !== null && touch.moveX !== 0 ? touch.moveX : keyboard.moveX;
    const moveY = gamepad.moveY !== 0 ? gamepad.moveY : touch !== null && touch.moveY !== 0 ? touch.moveY : keyboard.moveY;
    const defense = gamepad.defense !== "none" ? gamepad.defense : touch !== null && touch.defense !== "none" ? touch.defense : keyboard.defense;
    const forward = (moveX !== 0 || moveY !== 0) ? this.viewForward?.() ?? null : null;
    if (forward === null) return { moveX, moveY, defense };
    const turned = viewRelativeMove(moveX, moveY, forward.x, forward.z);
    return { moveX: turned.moveX, moveY: turned.moveY, defense };
  }
  frame(): InputFrame {
    return { ...this.held(), actions: this.actions.drain(4) };
  }
  destroy(): void { window.removeEventListener("blur", this.reset); document.removeEventListener("visibilitychange", this.visibility); this.keyboard.destroy(); this.gamepad.destroy(); this.touch?.destroy(); }
}
