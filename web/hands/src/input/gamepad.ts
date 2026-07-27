import { PunchGesture, radialDeadzone } from "./gesture";
import type { HeldDefense, InputFrame, PunchClass, SemanticAction } from "../types";

const FACE_CLASSES: readonly PunchClass[] = ["jab", "straight", "hook", "uppercut"];
const pressed = (pad: Gamepad, index: number): boolean => pad.buttons[index]?.pressed === true;

function standardPad(): Gamepad | null {
  const getGamepads = navigator.getGamepads;
  if (typeof getGamepads !== "function") return null;
  try {
    return [...getGamepads.call(navigator)].find((item): item is Gamepad => item !== null && item.connected && item.mapping === "standard") ?? null;
  } catch {
    return null;
  }
}

export class GamepadInput {
  private readonly gesture = new PunchGesture();
  private readonly queue: SemanticAction[] = [];
  private readonly previous = new Set<number>();
  private readonly selectorConsumed = new Map<number, boolean>();
  private raf = 0;
  private currentId: string | null = null;
  private moveX = 0;
  private moveY = 0;
  private defense: HeldDefense = "none";
  private knockdown = false;
  private enabled = true;

  private readonly disconnect = (event: GamepadEvent): void => {
    if (event.gamepad.id === this.currentId) this.reset();
  };

  constructor(private readonly maximumQueue = 24) {
    window.addEventListener("gamepaddisconnected", this.disconnect);
    this.raf = requestAnimationFrame(() => this.poll());
  }

  private push(action: SemanticAction): void {
    if (this.queue.length < this.maximumQueue) this.queue.push(action);
  }

  private poll(): void {
    if (!this.enabled) {
      this.reset();
      this.schedulePoll();
      return;
    }
    const pad = standardPad();
    if (pad === null) {
      if (this.currentId !== null) this.reset();
      this.schedulePoll();
      return;
    }
    if (this.currentId !== null && this.currentId !== pad.id) this.reset();
    this.currentId = pad.id;
    const move = radialDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
    this.moveX = Math.round(move.x * 1000);
    this.moveY = Math.round(-move.y * 1000);
    this.defense = pressed(pad, 4) ? "guard_high" : pressed(pad, 5) ? "guard_low" : "none";

    const gesture = this.gesture.update(pad.axes[2] ?? 0, pad.axes[3] ?? 0, pressed(pad, 6), pressed(pad, 7));
    if (gesture !== null) this.push(gesture);

    const faceEdge = FACE_CLASSES.some((_class, index) => pressed(pad, index) && !this.previous.has(index));
    for (const index of [14, 15] as const) {
      const down = pressed(pad, index);
      const wasDown = this.previous.has(index);
      if (this.knockdown) {
        if (down && !wasDown) this.push({ kind: index === 14 ? "get_up_left" : "get_up_right" });
        this.selectorConsumed.delete(index);
      } else if (down) {
        if (!wasDown) this.selectorConsumed.set(index, false);
        if (faceEdge) this.selectorConsumed.set(index, true);
      } else if (wasDown) {
        if (this.selectorConsumed.get(index) === false) this.push({ kind: index === 14 ? "slip_left" : "slip_right" });
        this.selectorConsumed.delete(index);
      }
    }

    for (let index = 0; index < pad.buttons.length; index += 1) {
      const down = pressed(pad, index);
      const edge = down && !this.previous.has(index);
      if (down) this.previous.add(index);
      else this.previous.delete(index);
      if (!edge) continue;

      const punchClass = FACE_CLASSES[index];
      if (punchClass !== undefined) {
        this.push({
          kind: "punch",
          hand: pressed(pad, 14) ? "left" : "right",
          class: punchClass,
          target: pressed(pad, 6) ? "body" : "head",
          power: pressed(pad, 7) ? "power" : "normal",
        });
      } else if (index === 8) this.push({ kind: "foul", foul: "low_blow" });
      else if (index === 9) this.push({ kind: "foul", foul: "headbutt" });
      else if (index === 10) this.push({ kind: "clinch" });
      else if (index === 11) this.push({ kind: "switch_stance" });
      else if (index === 12) this.push({ kind: "weave" });
      else if (index === 13) this.push({ kind: "pull" });
    }
    this.schedulePoll();
  }

  private schedulePoll(): void {
    this.raf = requestAnimationFrame(() => this.poll());
  }

  setKnockdown(value: boolean): void {
    this.knockdown = value;
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
    if (!value) this.reset();
  }

  frame(maxActions = 4): InputFrame {
    return { moveX: this.moveX, moveY: this.moveY, defense: this.defense, actions: this.queue.splice(0, maxActions) };
  }

  reset(): void {
    this.currentId = null;
    this.moveX = this.moveY = 0;
    this.defense = "none";
    this.queue.length = 0;
    this.previous.clear();
    this.selectorConsumed.clear();
    this.gesture.reset();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("gamepaddisconnected", this.disconnect);
    this.reset();
  }
}
