import { SharedActionIntent } from "./action-buffer";
import type { HeldDefense, InputFrame, PunchClass } from "../types";

/**
 * On-screen controls for coarse-pointer clients (Discord mobile). The left
 * half of the activity is a floating joystick for footwork; the right side
 * carries four punch pads whose left or right half selects the hand, hold
 * modifiers for body shots and power, and hold guards. During a knockdown the
 * pads become the get-up rhythm buttons.
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

export class TouchInput {
  private readonly root: HTMLElement;
  private readonly stickZone: HTMLElement;
  private readonly stickBase: HTMLElement;
  private readonly stickKnob: HTMLElement;
  private readonly pads: HTMLButtonElement[] = [];
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
    this.bind();
  }

  private bind(): void {
    const zone = this.stickZone;
    zone.addEventListener("pointerdown", (event) => {
      if (!this.enabled || this.stickPointer !== null) return;
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
    for (const mod of this.root.querySelectorAll<HTMLButtonElement>("[data-mod], [data-guard]")) {
      const press = (event: PointerEvent): void => {
        if (!this.enabled) return;
        event.preventDefault();
        mod.setPointerCapture(event.pointerId);
        const key = mod.dataset.mod ?? mod.dataset.guard ?? "";
        this.heldPointers.set(event.pointerId, key);
        this.applyHeld(key, true);
        mod.classList.add("pressed");
      };
      const lift = (event: PointerEvent): void => {
        const key = this.heldPointers.get(event.pointerId);
        if (key === undefined) return;
        this.heldPointers.delete(event.pointerId);
        this.applyHeld(key, false);
        mod.classList.remove("pressed");
      };
      mod.addEventListener("pointerdown", press);
      mod.addEventListener("pointerup", lift);
      mod.addEventListener("pointercancel", lift);
    }
  }

  private applyHeld(key: string, down: boolean): void {
    if (key === "body") this.body = down;
    else if (key === "power") this.power = down;
    else if (key === "guard_high" || key === "guard_low") {
      if (down) {
        this.guard = key;
        this.sharedActions.clear();
      } else if (this.guard === key) {
        this.guard = "none";
      }
    }
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

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.root.classList.toggle("disabled", !enabled);
    if (!enabled) this.reset();
  }

  frame(): InputFrame {
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
