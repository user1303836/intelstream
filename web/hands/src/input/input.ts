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

/** Angle between two moves, 0 to pi. */
const turnBetween = (ax: number, ay: number, bx: number, by: number): number => Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
/** A move keeps the camera it was pressed under until it turns about as far as one key changes it. */
const RELATCH_TURN = Math.PI / 4 - 0.01;
/** Held input worth sending at once: a new guard, a start or a stop, a turn this far, or this much more or less push on a stick. */
const SEND_TURN = Math.PI / 8;
const SEND_PUSH = 300;

export class InputController {
  private readonly actions = new SharedActionIntent(1);
  readonly keyboard: KeyboardInput; readonly gamepad: GamepadInput; touch: TouchInput | null = null;
  readonly reset = (): void => { this.keyboard.reset(); this.gamepad.reset(); this.touch?.reset(); this.actions.clear(); this.gamepad.setKnockdown(false); };
  private readonly heldChanged = (): void => {
    const held = this.held(); const sent = this.sentHeld;
    const moving = held.moveX !== 0 || held.moveY !== 0; const wasMoving = sent.moveX !== 0 || sent.moveY !== 0;
    const differs = held.defense !== sent.defense || moving !== wasMoving
      || (moving && (turnBetween(held.moveX, held.moveY, sent.moveX, sent.moveY) > SEND_TURN || Math.abs(Math.hypot(held.moveX, held.moveY) - Math.hypot(sent.moveX, sent.moveY)) > SEND_PUSH));
    if (!differs) return;
    this.sentHeld = held;
    this.heldListener?.();
  };
  constructor() { this.keyboard = new KeyboardInput(window, 1, this.actions); this.gamepad = new GamepadInput(1, this.actions); this.keyboard.onHeldChange(this.heldChanged); this.gamepad.onHeldChange(this.heldChanged); window.addEventListener("blur", this.reset); document.addEventListener("visibilitychange", this.visibility); }
  private readonly visibility = (): void => { if (document.hidden) this.reset(); };
  attachTouch(container: HTMLElement, force = coarsePointer()): void { if (this.touch !== null || !force) return; this.touch = new TouchInput(container, this.actions); this.touch.onHeldChange(this.heldChanged); }
  /** `touchShown` keeps the touch controls on screen, inert, while input is off (the rest, a pause). */
  setActive(active: boolean, touchShown = active): void { this.keyboard.setEnabled(active); this.gamepad.setEnabled(active); this.touch?.setEnabled(active, touchShown); }
  setKnockdown(value: boolean): void { this.gamepad.setKnockdown(value); this.touch?.setKnockdown(value); }
  onAction(listener: ((action: SemanticAction) => void) | null): void { this.actions.setListener(listener); }
  /** Called when the held movement or guard changes enough to be worth sending before the next periodic frame. */
  onHeldChange(listener: (() => void) | null): void { this.heldListener = listener; }
  private heldListener: (() => void) | null = null;
  private sentHeld: HeldInput = { moveX: 0, moveY: 0, defense: "none" };
  /** While the camera turns with the player's fighter, up on the stick or W walks the way it faces. */
  setViewForward(provider: (() => { readonly x: number; readonly z: number } | null) | null): void { this.viewForward = provider; }
  private viewForward: (() => { readonly x: number; readonly z: number } | null) | null = null;
  /**
   * The move held and the camera it was pressed under: the forward of the player's own camera, followed while that camera
   * is in use, or null for the broadcast's. A change of camera (K, or a shot taking the frame) leaves it until the move
   * itself changes, so the fighter does not swerve under a key held through the cut.
   */
  private latched: { moveX: number; moveY: number; forward: { x: number; z: number } | null } | null = null;
  held(): HeldInput {
    const keyboard = this.keyboard.frame(0); const gamepad = this.gamepad.frame(0); const touch = this.touch?.frame() ?? null;
    const moveX = gamepad.moveX !== 0 ? gamepad.moveX : touch !== null && touch.moveX !== 0 ? touch.moveX : keyboard.moveX;
    const moveY = gamepad.moveY !== 0 ? gamepad.moveY : touch !== null && touch.moveY !== 0 ? touch.moveY : keyboard.moveY;
    const defense = gamepad.defense !== "none" ? gamepad.defense : touch !== null && touch.defense !== "none" ? touch.defense : keyboard.defense;
    if (moveX === 0 && moveY === 0) { this.latched = null; return { moveX, moveY, defense }; }
    const live = this.viewForward?.() ?? null;
    const latched = this.latched;
    if (latched === null || turnBetween(moveX, moveY, latched.moveX, latched.moveY) > RELATCH_TURN) this.latched = { moveX, moveY, forward: live === null ? null : { x: live.x, z: live.z } };
    else if (latched.forward !== null && live !== null) { latched.forward.x = live.x; latched.forward.z = live.z; }
    const forward = this.latched!.forward;
    if (forward === null) return { moveX, moveY, defense };
    const turned = viewRelativeMove(moveX, moveY, forward.x, forward.z);
    return { moveX: turned.moveX, moveY: turned.moveY, defense };
  }
  frame(): InputFrame {
    return { ...this.held(), actions: this.actions.drain(4) };
  }
  destroy(): void { window.removeEventListener("blur", this.reset); document.removeEventListener("visibilitychange", this.visibility); this.keyboard.destroy(); this.gamepad.destroy(); this.touch?.destroy(); }
}
