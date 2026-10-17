import { SharedActionIntent } from "./action-buffer";
import { InputController, viewRelativeMove } from "./input";
import type { InputFrame } from "../types";

const button = (pressed = false): GamepadButton => ({ pressed, touched: pressed, value: pressed ? 1 : 0 });
function pad(buttons: number[] = []): Gamepad {
  return {
    id: "standard-pad",
    index: 0,
    connected: true,
    timestamp: 1,
    mapping: "standard",
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 18 }, (_, index) => button(buttons.includes(index))),
    vibrationActuator: null,
    hapticActuators: [],
  } as unknown as Gamepad;
}
const key = (type: "keydown" | "keyup", code: string): KeyboardEvent => new KeyboardEvent(type, { code, bubbles: true, cancelable: true });
const poll = (input: InputController): void => { (input.gamepad as unknown as { poll(): void }).poll(); };

describe("combined input intent", () => {
  it("retains the newest action across keyboard and gamepad in either order", () => {
    let current = pad();
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [current] });
    const input = new InputController();

    window.dispatchEvent(key("keydown", "KeyF"));
    window.dispatchEvent(key("keyup", "KeyF"));
    current = pad([2]); poll(input);
    expect(input.frame().actions).toEqual([{ kind: "punch", hand: "right", class: "hook", target: "head", power: "normal", id: "c2" }]);

    current = pad(); poll(input);
    current = pad([0]); poll(input);
    window.dispatchEvent(key("keydown", "KeyB"));
    window.dispatchEvent(key("keyup", "KeyB"));
    expect(input.frame().actions).toEqual([{ kind: "clinch", id: "c4" }]);
    input.destroy();
  });

  it("a guard on either device leaves the press made before it on the other to go out with it, and permits a newer punch", () => {
    let current = pad();
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [current] });
    const input = new InputController();

    window.dispatchEvent(key("keydown", "KeyF"));
    window.dispatchEvent(key("keyup", "KeyF"));
    current = pad([4]); poll(input);
    expect(input.frame()).toMatchObject({ defense: "guard_high", actions: [{ kind: "punch", hand: "left", class: "jab", target: "head", power: "normal" }] });

    window.dispatchEvent(key("keydown", "KeyF"));
    window.dispatchEvent(key("keyup", "KeyF"));
    expect(input.frame()).toMatchObject({
      defense: "guard_high",
      actions: [{ kind: "punch", hand: "left", class: "jab", target: "head", power: "normal" }],
    });

    current = pad(); poll(input);
    current = pad([2]); poll(input);
    window.dispatchEvent(key("keydown", "KeyQ"));
    expect(input.frame()).toMatchObject({ defense: "guard_high", actions: [{ kind: "punch", hand: "right", class: "hook", target: "head", power: "normal" }] });
    input.destroy();
  });
});

describe("input across the bell", () => {
  it("counts movement and guard keys pressed during the rest and held through the bell", () => {
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [] });
    const input = new InputController();
    input.setActive(false);
    window.dispatchEvent(key("keydown", "KeyW"));
    window.dispatchEvent(key("keydown", "KeyQ"));
    expect(input.held()).toEqual({ moveX: 0, moveY: 0, defense: "none" });
    input.setActive(true);
    expect(input.frame()).toEqual({ moveX: 0, moveY: 1000, defense: "guard_high", actions: [] });
    window.dispatchEvent(new Event("blur"));
    expect(input.frame()).toEqual({ moveX: 0, moveY: 0, defense: "none", actions: [] });
    input.destroy();
  });
});

describe("action instance ids", () => {
  it("preserves the original id and notification when identical intent coalesces", () => {
    const buffer = new SharedActionIntent(1);
    const seen: string[] = [];
    buffer.setListener((action) => seen.push(action.id ?? ""));
    buffer.push("keyboard", { kind: "punch", hand: "left", class: "jab", target: "head", power: "normal" });
    buffer.push("gamepad", { kind: "punch", hand: "left", class: "jab", target: "head", power: "normal" });
    expect(seen).toEqual(["c1"]);
    expect(buffer.drain(1)[0]!.id).toBe("c1");
  });

  it("assigns fresh ids to differing intents and notifies", () => {
    const buffer = new SharedActionIntent(1);
    const seen: string[] = [];
    buffer.setListener((action) => seen.push(action.id ?? ""));
    buffer.push("keyboard", { kind: "punch", hand: "left", class: "jab", target: "head", power: "normal" });
    buffer.push("keyboard", { kind: "punch", hand: "right", class: "jab", target: "head", power: "normal" });
    expect(seen).toEqual(["c1", "c2"]);
  });
});

describe("controls that turn with the camera", () => {
  it("leaves a move alone for the broadcast camera", () => {
    expect(viewRelativeMove(707, 707, 0, -1)).toEqual({ moveX: 707, moveY: 707 });
    expect(viewRelativeMove(-1000, 0, 0, -1)).toEqual({ moveX: -1000, moveY: 0 });
  });

  it("walks the way the camera faces on up and circles on left and right", () => {
    expect(viewRelativeMove(0, 1000, 1, 0)).toEqual({ moveX: 1000, moveY: 0 });
    expect(viewRelativeMove(0, 1000, 0, 1)).toEqual({ moveX: 0, moveY: -1000 });
    expect(viewRelativeMove(1000, 0, 1, 0)).toEqual({ moveX: 0, moveY: -1000 });
    expect(viewRelativeMove(-1000, 0, 1, 0)).toEqual({ moveX: 0, moveY: 1000 });
  });

  it("keeps the strength of the move and stays in range", () => {
    for (let degrees = 0; degrees < 360; degrees += 7) {
      const angle = (degrees * Math.PI) / 180;
      for (const [x, y] of [[0, 1000], [707, -707], [-300, 0]] as const) {
        const turned = viewRelativeMove(x, y, Math.sin(angle), Math.cos(angle));
        expect(Math.abs(Math.hypot(turned.moveX, turned.moveY) - Math.hypot(x, y))).toBeLessThan(2);
        expect(Math.abs(turned.moveX)).toBeLessThanOrEqual(1000);
        expect(Math.abs(turned.moveY)).toBeLessThanOrEqual(1000);
      }
    }
  });

  it("turns the held move, and asks the camera only while a direction is held", () => {
    const input = new InputController();
    const forward = vi.fn(() => ({ x: 1, z: 0 }));
    input.setViewForward(forward);
    expect(input.held()).toMatchObject({ moveX: 0, moveY: 0 });
    expect(forward).not.toHaveBeenCalled();
    window.dispatchEvent(key("keydown", "KeyW"));
    expect(input.held()).toMatchObject({ moveX: 1000, moveY: 0 });
    expect(input.frame()).toMatchObject({ moveX: 1000, moveY: 0 });
    window.dispatchEvent(key("keyup", "KeyW"));
    forward.mockReturnValue(null as unknown as { x: number; z: number });
    window.dispatchEvent(key("keydown", "KeyW"));
    expect(input.held()).toMatchObject({ moveX: 0, moveY: 1000 });
    window.dispatchEvent(key("keyup", "KeyW"));
    input.destroy();
  });

  it("keeps the way a held direction walks across a change of camera until the keys change, and turns with the player's own camera meanwhile", () => {
    const input = new InputController();
    let forward: { x: number; z: number } | null = { x: 1, z: 0 };
    input.setViewForward(() => forward);
    window.dispatchEvent(key("keydown", "KeyW"));
    expect(input.held()).toMatchObject({ moveX: 1000, moveY: 0 });
    forward = { x: 0, z: 1 };
    expect(input.held()).toMatchObject({ moveX: 0, moveY: -1000 });
    // K, or a shot that takes the frame: W goes on walking the way it did.
    forward = null;
    expect(input.held()).toMatchObject({ moveX: 0, moveY: -1000 });
    window.dispatchEvent(key("keydown", "KeyD"));
    expect(input.held()).toMatchObject({ moveX: 707, moveY: 707 });
    // Pressed under the broadcast, the move keeps its meaning when the player's own camera comes back.
    forward = { x: 1, z: 0 };
    expect(input.held()).toMatchObject({ moveX: 707, moveY: 707 });
    window.dispatchEvent(key("keyup", "KeyD"));
    expect(input.held()).toMatchObject({ moveX: 1000, moveY: 0 });
    window.dispatchEvent(key("keyup", "KeyW"));
    input.destroy();
  });
});

describe("the power modifier held", () => {
  it("is held while Alt or Option, the right trigger or the POWER pad is, and never while input is off", () => {
    let triggers: number[] = [];
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [pad(triggers)] });
    Element.prototype.setPointerCapture = () => undefined;
    const input = new InputController();
    const container = document.createElement("div");
    input.attachTouch(container, true);
    expect(input.powerHeld).toBe(false);
    window.dispatchEvent(key("keydown", "AltLeft"));
    expect(input.powerHeld).toBe(true);
    window.dispatchEvent(key("keyup", "AltLeft"));
    expect(input.powerHeld).toBe(false);
    triggers = [7];
    poll(input);
    expect(input.powerHeld).toBe(true);
    triggers = [];
    poll(input);
    expect(input.powerHeld).toBe(false);
    const power = container.querySelector<HTMLButtonElement>("[data-mod='power']")!;
    const touch = (type: string): void => { const event = new MouseEvent(type, { bubbles: true, cancelable: true }); Object.defineProperty(event, "pointerId", { value: 4 }); power.dispatchEvent(event); };
    touch("pointerdown");
    expect(input.powerHeld).toBe(true);
    input.setActive(false, true);
    expect(input.powerHeld).toBe(false);
    input.setActive(true);
    touch("pointerup");
    expect(input.powerHeld).toBe(false);
    input.destroy();
  });
});

describe("telling the server of held input as it changes", () => {
  it("speaks up for a new direction, a stop or a guard, not for a key's repeat or a punch", () => {
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [] });
    const input = new InputController();
    const changed = vi.fn();
    input.onHeldChange(changed);
    window.dispatchEvent(key("keydown", "KeyD"));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD", repeat: true, cancelable: true }));
    window.dispatchEvent(key("keydown", "KeyF"));
    expect(changed).toHaveBeenCalledTimes(1);
    window.dispatchEvent(key("keydown", "KeyW"));
    window.dispatchEvent(key("keydown", "KeyQ"));
    window.dispatchEvent(key("keyup", "KeyW"));
    window.dispatchEvent(key("keyup", "KeyD"));
    expect(changed).toHaveBeenCalledTimes(5);
    input.destroy();
  });

  it("sends a press still waiting to go out with the guard frame, from the keyboard, a pad or the touch controls", () => {
    // A press inside the edge gap or past a send budget waits for the next frame, and the app sends one at once on a held
    // change (network.notifyHeld flushes input.frame()). The renderer already plays the press, and the server decides.
    let current = pad();
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [current] });
    Element.prototype.setPointerCapture = () => undefined;
    const sentOnGuard = (press: (input: InputController, container: HTMLElement) => void, guard: (input: InputController, container: HTMLElement) => void): InputFrame[] => {
      const input = new InputController();
      const container = document.createElement("div");
      input.attachTouch(container, true);
      const sent: InputFrame[] = [];
      press(input, container);
      input.onHeldChange(() => sent.push(input.frame()));
      guard(input, container);
      input.destroy();
      return sent;
    };
    const tap = (target: Element): void => { const event = new MouseEvent("pointerdown", { bubbles: true, cancelable: true }); Object.defineProperty(event, "pointerId", { value: 3 }); target.dispatchEvent(event); };
    const keyboard = sentOnGuard(() => { window.dispatchEvent(key("keydown", "KeyF")); window.dispatchEvent(key("keyup", "KeyF")); }, () => window.dispatchEvent(key("keydown", "KeyQ")));
    window.dispatchEvent(key("keyup", "KeyQ"));
    expect(keyboard[0]).toEqual({ moveX: 0, moveY: 0, defense: "guard_high", actions: [{ kind: "punch", hand: "left", class: "jab", target: "head", power: "normal", id: "c1" }] });
    const gamepad = sentOnGuard((input) => { current = pad([0]); poll(input); }, (input) => { current = pad([4]); poll(input); });
    current = pad();
    expect(gamepad[0]).toEqual({ moveX: 0, moveY: 0, defense: "guard_high", actions: [{ kind: "punch", hand: "right", class: "jab", target: "head", power: "normal", id: "c1" }] });
    const touch = sentOnGuard((_input, container) => tap(container.querySelector("[data-move='slip_left']")!), (_input, container) => tap(container.querySelector("[data-guard='guard_high']")!));
    expect(touch[0]).toEqual({ moveX: 0, moveY: 0, defense: "guard_high", actions: [{ kind: "slip_left", id: "c1" }] });
  });

  it("speaks up for a stick that turns or presses well past where it was, not for every twitch of the thumb", () => {
    const axes = [0, 0, 0, 0];
    let held: number[] = [];
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [{ ...pad(held), axes: [...axes] }] });
    const input = new InputController();
    const changed = vi.fn();
    input.onHeldChange(changed);
    const at = (x: number, y: number): void => { axes[0] = x; axes[1] = y; poll(input); };
    at(0.9, 0);
    expect(changed).toHaveBeenCalledTimes(1);
    at(0.92, -0.05);
    at(0.9, 0.04);
    expect(changed).toHaveBeenCalledTimes(1);
    at(0.6, -0.6);
    expect(changed).toHaveBeenCalledTimes(2);
    held = [4];
    poll(input);
    expect(changed).toHaveBeenCalledTimes(3);
    at(0, 0);
    expect(changed).toHaveBeenCalledTimes(4);
    input.destroy();
  });
});
