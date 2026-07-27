import { CONTROL_HELP } from "./bindings";
import { GamepadInput } from "./gamepad";

const button = (pressed = false): GamepadButton => ({ pressed, touched: pressed, value: pressed ? 1 : 0 });
function pad(buttons: number[] = [], axes = [0, 0, 0, 0]): Gamepad {
  const values = Array.from({ length: 18 }, (_, i) => button(buttons.includes(i)));
  return { id: "standard-pad", index: 0, connected: true, timestamp: 1, mapping: "standard", axes, buttons: values, vibrationActuator: null, hapticActuators: [] } as unknown as Gamepad;
}
const poll = (input: GamepadInput): void => { (input as unknown as { poll(): void }).poll(); };

describe("gamepad semantic parity", () => {
  it("documents delayed slip release, consumed face chords, and immediate get-up exactly", () => {
    expect(CONTROL_HELP).toContain("Controller face hand: hold D-pad left for left hand or D-pad right for right hand, then press a face punch; otherwise punches use the right hand. A direction used for a punch is consumed and does not evade.");
    expect(CONTROL_HELP).toContain("Controller actions: left stick press clinch · right stick press switch stance · D-pad up weave · D-pad down pull · tap and release D-pad left/right to slip; while down, D-pad left/right performs the private get-up rhythm immediately.");
  });

  it("face alternatives produce byte-equivalent modified punches", () => {
    let current = pad([0, 14, 6, 7]);
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [current] });
    const input = new GamepadInput();
    poll(input);
    expect(input.frame().actions).toEqual([{ kind: "punch", hand: "left", class: "jab", target: "body", power: "power" }]);
    current = pad(); poll(input);
    current = pad([3, 5, 15]); poll(input);
    expect(input.frame().actions[0]).toMatchObject({ hand: "right", class: "uppercut" });
    input.destroy();
  });

  it("defers a held selector and consumes it when a later face punch uses the chord", () => {
    let current = pad([14]);
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [current] });
    const input = new GamepadInput();
    poll(input);
    expect(input.frame().actions).toEqual([]);
    current = pad([14, 2, 4]); poll(input);
    const frame = input.frame();
    expect(frame.defense).toBe("guard_high");
    expect(frame.actions).toEqual([{ kind: "punch", hand: "left", class: "hook", target: "head", power: "normal" }]);
    current = pad([14]); poll(input);
    current = pad(); poll(input);
    expect(input.frame().actions).toEqual([]);
    input.destroy();
  });

  it.each([[14, "slip_left"], [15, "slip_right"]] as const)("emits a standalone D-pad %i slip only on release", (index, kind) => {
    let current = pad([index]);
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [current] });
    const input = new GamepadInput();
    poll(input);
    expect(input.frame().actions).toEqual([]);
    current = pad(); poll(input);
    expect(input.frame().actions).toEqual([{ kind }]);
    input.destroy();
  });

  it("caps full-stick locomotion with conventional up and down screen directions", () => {
    let current = pad([], [1, 1, 0, 0]);
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [current] });
    const input = new GamepadInput();
    poll(input);
    expect(input.frame()).toMatchObject({ moveX: 707, moveY: -707 });
    current = pad([], [-Math.SQRT1_2, -Math.SQRT1_2, 0, 0]); poll(input);
    expect(input.frame()).toMatchObject({ moveX: -707, moveY: 707 });
    input.destroy();
  });

  it("feature-detects absent and throwing gamepad APIs", () => {
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: undefined });
    const missing = new GamepadInput();
    expect(() => poll(missing)).not.toThrow();
    missing.destroy();
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => { throw new Error("host"); } });
    const throwing = new GamepadInput();
    expect(() => poll(throwing)).not.toThrow();
    throwing.destroy();
  });

  it("keeps knockdown get-up immediate and clears state on disconnect", () => {
    let current = pad();
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [current] });
    const input = new GamepadInput();
    input.setKnockdown(true);
    current = pad([15]); poll(input);
    expect(input.frame().actions).toEqual([{ kind: "get_up_right" }]);
    const event = new Event("gamepaddisconnected") as GamepadEvent;
    Object.defineProperty(event, "gamepad", { value: current });
    window.dispatchEvent(event);
    expect(input.frame()).toMatchObject({ moveX: 0, moveY: 0, defense: "none" });
    input.destroy();
  });
});
