import { SharedActionIntent, pushActionIntent } from "./action-buffer";
import { ACTION_KEYS, ACTIVE_CODES, PUNCH_KEYS } from "./bindings";
import type { HeldDefense, InputFrame, SemanticAction } from "../types";

/** The keys whose hold every input frame carries: footwork and guard. */
const HELD_CODES = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE"]);
const MODIFIER_CODES = new Set(["ShiftLeft", "ShiftRight", "AltLeft", "AltRight"]);

export class KeyboardInput {
  private readonly held = new Set<string>(); private readonly queue: SemanticAction[] = [];
  private enabled = true;
  /** Option as the newest key event says it is, which knows of one pressed before the page had focus. */
  private altFlag = false;
  private heldListener: (() => void) | null = null;
  private readonly keydown = (event: KeyboardEvent): void => {
    this.altFlag = event.altKey;
    if (!ACTIVE_CODES.has(event.code)) return;
    // Keys stay tracked while input is off (the rest, a pause), so one held through the bell counts from the first frame.
    if (!this.enabled) { this.hold(event.code, event.repeat); return; }
    event.preventDefault();
    // A guard cancels a press still waiting to go out, before the guard itself is sent (see onHeldChange).
    if (!event.repeat && (event.code === "KeyQ" || event.code === "KeyE")) this.clearActions();
    // A repeat takes the hold of a key pressed before the page had focus, never the press.
    this.hold(event.code, event.repeat); if (event.repeat) return;
    const punch = PUNCH_KEYS[event.code];
    if (punch !== undefined) this.push({ kind: "punch", hand: punch[0], class: punch[1], target: this.hasShift(event) ? "body" : "head", power: this.alt ? "power" : "normal" });
    // A foul needs Shift held, so a number pressed for the corner as the bell goes cannot become one.
    else { const action = ACTION_KEYS[event.code]; if (action !== undefined && (action.kind !== "foul" || this.hasShift(event))) this.push(action); }
  };
  private readonly keyup = (event: KeyboardEvent): void => {
    this.altFlag = event.altKey;
    // macOS delivers no keyup for a key let go while Command is held (Chrome since 149 makes one up; Discord's Electron does
    // not), so once Command is up only the modifiers, whose releases always arrive, can be trusted to still be down.
    if (event.code === "MetaLeft" || event.code === "MetaRight") { this.letGo((code) => !MODIFIER_CODES.has(code)); return; }
    if (ACTIVE_CODES.has(event.code)) { if (this.enabled) event.preventDefault(); this.letGo((code) => code === event.code); }
  };
  private readonly visibility = (): void => { if (document.hidden) this.reset(); };
  private readonly blur = (): void => this.reset();
  constructor(private readonly target: Window = window, private readonly maximumQueue = 1, private readonly sharedActions?: SharedActionIntent) {
    target.addEventListener("keydown", this.keydown); target.addEventListener("keyup", this.keyup); target.addEventListener("blur", this.blur); document.addEventListener("visibilitychange", this.visibility);
  }
  /** Called whenever the held footwork or guard keys change. */
  onHeldChange(listener: (() => void) | null): void { this.heldListener = listener; }
  /** A fresh press goes to the back of the order, so of two opposite keys held together the newer one counts. */
  private hold(code: string, repeat: boolean): void {
    if (repeat && this.held.has(code)) return;
    this.held.delete(code); this.held.add(code);
    if (HELD_CODES.has(code)) this.heldListener?.();
  }
  private letGo(released: (code: string) => boolean): void {
    let changed = false;
    for (const code of this.held) if (released(code)) { this.held.delete(code); changed ||= HELD_CODES.has(code); }
    if (changed) this.heldListener?.();
  }
  /** 1 or -1 for whichever of the two keys was pressed last and is still held, 0 for neither. */
  private axis(positive: string, negative: string): number {
    let value = 0;
    for (const code of this.held) if (code === positive) value = 1; else if (code === negative) value = -1;
    return value;
  }
  // The key's own flags count too: a modifier pressed before the page had focus is held all the same.
  private hasShift(event: KeyboardEvent): boolean { return event.shiftKey || this.held.has("ShiftLeft") || this.held.has("ShiftRight"); }
  private get alt(): boolean { return this.altFlag || this.held.has("AltLeft") || this.held.has("AltRight"); }
  /** Alt (Option on a Mac) is held: the next punch is a power punch. */
  get powerHeld(): boolean { return this.enabled && this.alt; }
  private push(action: SemanticAction): void { if (this.sharedActions === undefined) pushActionIntent(this.queue, action, this.maximumQueue); else this.sharedActions.push("keyboard", action); }
  private clearActions(): void { this.queue.length = 0; this.sharedActions?.clear(); }
  /** Off drops queued presses but keeps the held keys; the frame stays neutral until input is on again. */
  setEnabled(enabled: boolean): void { this.enabled = enabled; if (!enabled) { this.queue.length = 0; this.sharedActions?.clearSource("keyboard"); } }
  frame(maxActions = 4): InputFrame {
    if (!this.enabled) return { moveX: 0, moveY: 0, defense: "none", actions: [] };
    let x = this.axis("KeyD", "KeyA") * 1000;
    let y = this.axis("KeyW", "KeyS") * 1000;
    if (x !== 0 && y !== 0) { x = Math.sign(x) * 707; y = Math.sign(y) * 707; }
    const guard = this.axis("KeyQ", "KeyE");
    const defense: HeldDefense = guard > 0 ? "guard_high" : guard < 0 ? "guard_low" : "none";
    return { moveX: x, moveY: y, defense, actions: this.sharedActions === undefined ? this.queue.splice(0, maxActions) : [] };
  }
  reset(): void { this.letGo(() => true); this.altFlag = false; this.queue.length = 0; this.sharedActions?.clearSource("keyboard"); }
  destroy(): void { this.reset(); this.target.removeEventListener("keydown", this.keydown); this.target.removeEventListener("keyup", this.keyup); this.target.removeEventListener("blur", this.blur); document.removeEventListener("visibilitychange", this.visibility); }
}
