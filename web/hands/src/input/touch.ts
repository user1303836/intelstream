import { SharedActionIntent } from "./action-buffer";
import type { HeldDefense, InputFrame, MovementKind, PunchClass } from "../types";

/**
 * On-screen controls for coarse-pointer clients (Discord mobile). The left
 * half of the activity is a floating joystick for footwork; the right side
 * carries four punch pads whose left or right half selects the hand, hold
 * modifiers for body shots and power, hold guards, and a row of evasions and
 * the clinch. During a knockdown the pads become the get-up rhythm buttons.
 */

export function coarsePointer(): boolean {
  try {
    if (window.matchMedia?.("(pointer: coarse)").matches) return true;
  } catch {
    // matchMedia can be unavailable in embedded webviews.
  }
  return (navigator.maxTouchPoints ?? 0) > 0 && new URLSearchParams(window.location.search).get("platform") === "mobile";
}

const PUNCH_PADS: readonly { readonly label: string; readonly punchClass: PunchClass }[] = [
  { label: "JAB", punchClass: "jab" },
  { label: "STRAIGHT", punchClass: "straight" },
  { label: "HOOK", punchClass: "hook" },
  { label: "UPPER", punchClass: "uppercut" },
];

/** The evasions and the clinch, the same actions as the keyboard's Z, C, X, V and B. */
const MOVES: readonly { readonly label: string; readonly name: string; readonly kind: MovementKind }[] = [
  { label: "◀ SLIP", name: "Slip left", kind: "slip_left" },
  { label: "WEAVE", name: "Weave", kind: "weave" },
  { label: "SLIP ▶", name: "Slip right", kind: "slip_right" },
  { label: "PULL", name: "Pull", kind: "pull" },
  { label: "CLINCH", name: "Clinch", kind: "clinch" },
];

export class TouchInput {
  private readonly root: HTMLElement;
  private readonly stickZone: HTMLElement;
  private readonly stickBase: HTMLElement;
  private readonly stickKnob: HTMLElement;
  private readonly pads: HTMLButtonElement[] = [];
  private readonly moves: HTMLButtonElement[] = [];
  private stickPointer: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private moveX = 0;
  private moveY = 0;
  private body = false;
  private power = false;
  private guard: HeldDefense = "none";
  private knockdown = false;
  private enabled = true;
  private readonly heldPointers = new Map<number, string>();

  constructor(container: HTMLElement, private readonly sharedActions: SharedActionIntent) {
    this.root = document.createElement("div");
    this.root.className = "touch-controls";
    this.root.setAttribute("aria-label", "Touch controls");
    this.root.innerHTML = `<div class="touch-stick" data-stick><div class="touch-stick-base" data-stick-base><div class="touch-stick-knob" data-stick-knob></div></div></div>
<div class="touch-pads" data-pads>
  <div class="touch-moves">${MOVES.map((move) => `<button type="button" class="touch-move" data-move="${move.kind}" aria-label="${move.name}">${move.label}</button>`).join("")}</div>
  <div class="touch-mods">
    <button type="button" class="touch-mod" data-mod="body">BODY</button>
    <button type="button" class="touch-mod" data-mod="power">POWER</button>
    <button type="button" class="touch-mod" data-guard="guard_high">GUARD</button>
    <button type="button" class="touch-mod" data-guard="guard_low">LOW</button>
  </div>
  <div class="touch-grid">${PUNCH_PADS.map((pad) => `<button type="button" class="touch-pad" data-punch="${pad.punchClass}"><span class="touch-pad-hand">L</span><span class="touch-pad-label">${pad.label}</span><span class="touch-pad-hand">R</span></button>`).join("")}</div>
</div>`;
    container.append(this.root);
    this.stickZone = this.root.querySelector("[data-stick]")!;
    this.stickBase = this.root.querySelector("[data-stick-base]")!;
    this.stickKnob = this.root.querySelector("[data-stick-knob]")!;
    this.pads.push(...this.root.querySelectorAll<HTMLButtonElement>("[data-punch]"));
    this.moves.push(...this.root.querySelectorAll<HTMLButtonElement>("[data-move]"));
    this.bind();
  }

  private bind(): void {
    const zone = this.stickZone;
    // The stick and the hold buttons track fingers while input is off but shown (the rest, a pause); presses wait for input.
    zone.addEventListener("pointerdown", (event) => {
      if (this.stickPointer !== null) return;
      event.preventDefault();
      this.stickPointer = event.pointerId;
      this.stickOrigin = { x: event.clientX, y: event.clientY };
      zone.setPointerCapture(event.pointerId);
      const rect = zone.getBoundingClientRect();
      this.stickBase.style.left = `${event.clientX - rect.left}px`;
      this.stickBase.style.top = `${event.clientY - rect.top}px`;
      this.stickBase.classList.add("active");
      this.updateStick(event.clientX, event.clientY);
    });
    zone.addEventListener("pointermove", (event) => {
      if (event.pointerId !== this.stickPointer) return;
      event.preventDefault();
      this.updateStick(event.clientX, event.clientY);
    });
    const release = (event: PointerEvent): void => {
      if (event.pointerId !== this.stickPointer) return;
      this.stickPointer = null;
      this.moveX = 0;
      this.moveY = 0;
      this.stickKnob.style.transform = "translate(-50%, -50%)";
      this.stickBase.classList.remove("active");
    };
    zone.addEventListener("pointerup", release);
    zone.addEventListener("pointercancel", release);

    for (const pad of this.pads) {
      pad.addEventListener("pointerdown", (event) => {
        if (!this.enabled) return;
        event.preventDefault();
        const rect = pad.getBoundingClientRect();
        const hand = event.clientX - rect.left < rect.width / 2 ? "left" : "right";
        if (this.knockdown) {
          this.sharedActions.push("touch", { kind: hand === "left" ? "get_up_left" : "get_up_right" });
          return;
        }
        const punchClass = pad.dataset.punch as PunchClass;
        this.sharedActions.push("touch", { kind: "punch", hand, class: punchClass, target: this.body ? "body" : "head", power: this.power ? "power" : "normal" });
        pad.classList.add("pressed");
        window.setTimeout(() => pad.classList.remove("pressed"), 120);
      });
    }
    for (const move of this.moves) {
      // A press must start on the button, like a punch pad; a thumb sliding over from the pads does nothing.
      move.addEventListener("pointerdown", (event) => {
        if (!this.enabled || this.knockdown) return;
        event.preventDefault();
        this.sharedActions.push("touch", { kind: move.dataset.move as MovementKind });
        move.classList.add("pressed");
        window.setTimeout(() => move.classList.remove("pressed"), 120);
      });
    }
    for (const mod of this.root.querySelectorAll<HTMLButtonElement>("[data-mod], [data-guard]")) {
      const key = mod.dataset.mod ?? mod.dataset.guard ?? "";
      const press = (event: PointerEvent): void => {
        event.preventDefault();
        mod.setPointerCapture(event.pointerId);
        this.heldPointers.set(event.pointerId, key);
        if (key === "guard_high" || key === "guard_low") this.sharedActions.clear();
        this.syncHeld();
        mod.classList.add("pressed");
      };
      const lift = (event: PointerEvent): void => {
        if (!this.heldPointers.delete(event.pointerId)) return;
        this.syncHeld();
        mod.classList.toggle("pressed", [...this.heldPointers.values()].includes(key));
      };
      mod.addEventListener("pointerdown", press);
      mod.addEventListener("pointerup", lift);
      mod.addEventListener("pointercancel", lift);
    }
  }

  /** Body, power and guard follow the fingers still down; with both guards held, the later one counts. */
  private syncHeld(): void {
    const keys = [...this.heldPointers.values()];
    this.body = keys.includes("body");
    this.power = keys.includes("power");
    this.guard = keys.findLast((key): key is HeldDefense => key === "guard_high" || key === "guard_low") ?? "none";
  }

  private updateStick(clientX: number, clientY: number): void {
    const radius = 56;
    let dx = clientX - this.stickOrigin.x;
    let dy = clientY - this.stickOrigin.y;
    const length = Math.hypot(dx, dy);
    if (length > radius) {
      dx = (dx / length) * radius;
      dy = (dy / length) * radius;
    }
    this.stickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const magnitude = Math.min(1, length / radius);
    const scaled = magnitude < 0.15 ? 0 : (magnitude - 0.15) / 0.85;
    const unitX = length > 0 ? dx / Math.max(length, 1e-6) : 0;
    const unitY = length > 0 ? dy / Math.max(length, 1e-6) : 0;
    this.moveX = Math.round(unitX * scaled * 1000) || 0;
    this.moveY = Math.round(-unitY * scaled * 1000) || 0;
  }

  setKnockdown(value: boolean): void {
    if (this.knockdown === value) return;
    this.knockdown = value;
    this.root.classList.toggle("knockdown", value);
    for (const [index, pad] of this.pads.entries()) {
      const label = pad.querySelector<HTMLElement>(".touch-pad-label");
      if (label !== null) label.textContent = value ? (index % 2 === 0 ? "GET UP" : "RHYTHM") : PUNCH_PADS[index]!.label;
    }
  }

  /**
   * Off and hidden outside a bout. Through the rest and pauses the controls stay shown, dimmed: a
   * thumb resting on the stick or a hold button counts from the first frame after the bell.
   */
  setEnabled(enabled: boolean, shown = enabled): void {
    this.enabled = enabled;
    this.root.classList.toggle("disabled", !shown);
    this.root.classList.toggle("resting", shown && !enabled);
    if (!shown) this.reset();
    else if (!enabled) this.sharedActions.clearSource("touch");
  }

  frame(): InputFrame {
    if (!this.enabled) return { moveX: 0, moveY: 0, defense: "none", actions: [] };
    return { moveX: this.moveX, moveY: this.moveY, defense: this.guard, actions: [] };
  }

  reset(): void {
    this.stickPointer = null;
    this.moveX = 0;
    this.moveY = 0;
    this.body = false;
    this.power = false;
    this.guard = "none";
    this.heldPointers.clear();
    this.stickBase.classList.remove("active");
    for (const pressed of this.root.querySelectorAll(".pressed")) pressed.classList.remove("pressed");
    this.sharedActions.clearSource("touch");
  }

  destroy(): void {
    this.reset();
    this.root.remove();
  }
}
