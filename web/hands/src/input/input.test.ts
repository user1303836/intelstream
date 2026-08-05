import { SharedActionIntent } from "./action-buffer";
import { InputController } from "./input";

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

  it("guard on either device clears older cross-device intent but permits a newer punch", () => {
    let current = pad();
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [current] });
    const input = new InputController();

    window.dispatchEvent(key("keydown", "KeyF"));
    window.dispatchEvent(key("keyup", "KeyF"));
    current = pad([4]); poll(input);
    expect(input.frame()).toMatchObject({ defense: "guard_high", actions: [] });

    window.dispatchEvent(key("keydown", "KeyF"));
    window.dispatchEvent(key("keyup", "KeyF"));
    expect(input.frame()).toMatchObject({
      defense: "guard_high",
      actions: [{ kind: "punch", hand: "left", class: "jab", target: "head", power: "normal" }],
    });

    current = pad(); poll(input);
    current = pad([2]); poll(input);
    window.dispatchEvent(key("keydown", "KeyQ"));
    expect(input.frame()).toMatchObject({ defense: "guard_high", actions: [] });
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
