import { ACTION_KEYS, ACTIVE_CODES, PUNCH_KEYS } from "./bindings";
import type { HeldDefense, InputFrame, SemanticAction } from "../types";

export class KeyboardInput {
  private readonly held = new Set<string>(); private readonly queue: SemanticAction[] = [];
  private enabled = true;
  private readonly keydown = (event: KeyboardEvent): void => {
    if (!this.enabled || !ACTIVE_CODES.has(event.code)) return;
    event.preventDefault(); if (event.repeat) return; this.held.add(event.code);
    const punch = PUNCH_KEYS[event.code];
    if (punch !== undefined) this.push({ kind: "punch", hand: punch[0], class: punch[1], target: this.hasShift() ? "body" : "head", power: this.hasAlt() ? "power" : "normal" });
    else { const action = ACTION_KEYS[event.code]; if (action !== undefined) this.push(action); }
  };
  private readonly keyup = (event: KeyboardEvent): void => { if (ACTIVE_CODES.has(event.code)) { if (this.enabled) event.preventDefault(); this.held.delete(event.code); } };
  private readonly visibility = (): void => { if (document.hidden) this.reset(); };
  private readonly blur = (): void => this.reset();
  constructor(private readonly target: Window = window, private readonly maximumQueue = 24) {
    target.addEventListener("keydown", this.keydown); target.addEventListener("keyup", this.keyup); target.addEventListener("blur", this.blur); document.addEventListener("visibilitychange", this.visibility);
  }
  private hasShift(): boolean { return this.held.has("ShiftLeft") || this.held.has("ShiftRight"); }
  private hasAlt(): boolean { return this.held.has("AltLeft") || this.held.has("AltRight"); }
  private push(action: SemanticAction): void { if (this.queue.length < this.maximumQueue) this.queue.push(action); }
  setEnabled(enabled: boolean): void { this.enabled = enabled; if (!enabled) this.reset(); }
  frame(maxActions = 4): InputFrame {
    let x = (this.held.has("KeyD") ? 1000 : 0) - (this.held.has("KeyA") ? 1000 : 0);
    let y = (this.held.has("KeyS") ? 1000 : 0) - (this.held.has("KeyW") ? 1000 : 0);
    if (x !== 0 && y !== 0) { x = Math.sign(x) * 707; y = Math.sign(y) * 707; }
    const defense: HeldDefense = this.held.has("KeyQ") ? "guard_high" : this.held.has("KeyE") ? "guard_low" : "none";
    return { moveX: x, moveY: y, defense, actions: this.queue.splice(0, maxActions) };
  }
  reset(): void { this.held.clear(); this.queue.length = 0; }
  destroy(): void { this.reset(); this.target.removeEventListener("keydown", this.keydown); this.target.removeEventListener("keyup", this.keyup); this.target.removeEventListener("blur", this.blur); document.removeEventListener("visibilitychange", this.visibility); }
}
