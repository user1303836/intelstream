import { SharedActionIntent } from "./action-buffer";
import { TouchInput } from "./touch";

const pointer = (type: string, target: Element, init: { pointerId?: number; clientX?: number; clientY?: number }): void => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.clientX ?? 0, clientY: init.clientY ?? 0 }) as MouseEvent & { pointerId: number };
  Object.defineProperty(event, "pointerId", { value: init.pointerId ?? 1 });
  target.dispatchEvent(event);
};

describe("touch controls", () => {
  beforeEach(() => {
    Element.prototype.setPointerCapture = () => undefined;
    Element.prototype.releasePointerCapture = () => undefined;
  });

  it("splits punch pads by hand, applies hold modifiers, and drives the stick", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const actions = new SharedActionIntent(4);
    const touch = new TouchInput(container, actions);
    const jab = container.querySelector<HTMLButtonElement>("[data-punch='jab']")!;
    jab.getBoundingClientRect = () => ({ left: 100, top: 0, width: 96, height: 64, right: 196, bottom: 64, x: 100, y: 0, toJSON: () => undefined });
    pointer("pointerdown", jab, { clientX: 110 });
    pointer("pointerdown", jab, { clientX: 190 });
    expect(actions.drain(4)).toEqual([
      { kind: "punch", hand: "left", class: "jab", target: "head", power: "normal", id: "c1" },
      { kind: "punch", hand: "right", class: "jab", target: "head", power: "normal", id: "c2" },
    ]);

    const body = container.querySelector<HTMLButtonElement>("[data-mod='body']")!;
    const power = container.querySelector<HTMLButtonElement>("[data-mod='power']")!;
    pointer("pointerdown", body, { pointerId: 7 });
    pointer("pointerdown", power, { pointerId: 8 });
    const hook = container.querySelector<HTMLButtonElement>("[data-punch='hook']")!;
    hook.getBoundingClientRect = jab.getBoundingClientRect;
    pointer("pointerdown", hook, { clientX: 120 });
    expect(actions.drain(4)).toEqual([{ kind: "punch", hand: "left", class: "hook", target: "body", power: "power", id: "c3" }]);
    pointer("pointerup", body, { pointerId: 7 });
    pointer("pointerup", power, { pointerId: 8 });

    const guard = container.querySelector<HTMLButtonElement>("[data-guard='guard_high']")!;
    pointer("pointerdown", guard, { pointerId: 9 });
    expect(touch.frame().defense).toBe("guard_high");
    pointer("pointerup", guard, { pointerId: 9 });
    expect(touch.frame().defense).toBe("none");

    const zone = container.querySelector<HTMLElement>("[data-stick]")!;
    zone.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400, x: 0, y: 0, toJSON: () => undefined });
    pointer("pointerdown", zone, { pointerId: 3, clientX: 100, clientY: 200 });
    pointer("pointermove", zone, { pointerId: 3, clientX: 156, clientY: 200 });
    expect(touch.frame().moveX).toBe(1000);
    expect(touch.frame().moveY).toBe(0);
    pointer("pointermove", zone, { pointerId: 3, clientX: 100, clientY: 144 });
    expect(touch.frame().moveY).toBe(1000);
    pointer("pointerup", zone, { pointerId: 3 });
    expect(touch.frame().moveX).toBe(0);

    touch.setKnockdown(true);
    pointer("pointerdown", jab, { clientX: 190 });
    expect(actions.drain(4)).toEqual([{ kind: "get_up_right", id: "c4" }]);
    touch.destroy();
    expect(container.querySelector(".touch-controls")).toBeNull();
  });
});
