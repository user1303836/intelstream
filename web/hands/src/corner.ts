import { CORNER_TREATMENTS, EYE_SHUT_TRAUMA } from "./manifest";
import type { CornerChoice, CornerKind, EngineSnapshot, FighterSnapshot } from "./types";

export const CORNER_KEYS: Readonly<Record<string, CornerKind>> = {
  Digit1: "corner_cut", Numpad1: "corner_cut",
  Digit2: "corner_swelling", Numpad2: "corner_swelling",
  Digit3: "corner_breath", Numpad3: "corner_breath",
};
/** Standard-mapping face buttons: left (X, square) the cut, top (Y, triangle) the swelling, right (B, circle) the breath. */
export const CORNER_PAD_BUTTONS: Readonly<Record<number, CornerKind>> = { 2: "corner_cut", 3: "corner_swelling", 1: "corner_breath" };

const CHOICES: readonly { readonly kind: CornerKind; readonly choice: CornerChoice; readonly key: string; readonly title: string }[] = [
  { kind: "corner_cut", choice: "cut", key: "1", title: "Close the cut" },
  { kind: "corner_swelling", choice: "swelling", key: "2", title: "Bring down the swelling" },
  { kind: "corner_breath", choice: "breath", key: "3", title: "Catch your breath" },
];
const WORKING: Readonly<Record<CornerChoice, string>> = {
  cut: "Your corner is closing the cut.",
  swelling: "Your corner is bringing the swelling down.",
  breath: "Your corner is getting your breath back.",
  balanced: "Your corner did a little of everything.",
};
/** A pick the server has not confirmed by then is offered again. */
const PENDING_MS = 1500;
const MAX_CONDITIONING = 1000;

/** What each instruction would do for this fighter, in the HUD's own terms. */
export function cornerPreview(fighter: FighterSnapshot): Readonly<Record<CornerChoice, string>> {
  const { trauma } = fighter;
  const worseCut = Math.max(trauma.left_cut, trauma.right_cut);
  const worseEye = Math.max(trauma.left_eye, trauma.right_eye);
  const eyeAfter = Math.max(0, worseEye - CORNER_TREATMENTS.swelling.eyes);
  const shut = worseEye >= EYE_SHUT_TRAUMA ? (eyeAfter < EYE_SHUT_TRAUMA ? " · opens the eye" : " · stays shut") : "";
  return {
    cut: worseCut === 0 ? "No cut to close" : `Cut ${worseCut} → ${Math.max(0, worseCut - CORNER_TREATMENTS.cut.worse_cut)}`,
    swelling: worseEye === 0 && trauma.swelling === 0 ? "No swelling" : `Eye ${worseEye} → ${eyeAfter}${shut}`,
    breath: `Health ${fighter.conditioning} → ${Math.min(MAX_CONDITIONING, fighter.conditioning + CORNER_TREATMENTS.breath.conditioning)} · full stamina`,
    balanced: "",
  };
}

/** The fighter's instructions to the corner between rounds: three buttons, the number keys and the face buttons. */
export class CornerPanel {
  readonly element: HTMLElement;
  private readonly buttons = new Map<CornerKind, HTMLButtonElement>();
  private readonly details = new Map<CornerKind, HTMLElement>();
  private readonly status: HTMLElement;
  private visible = false;
  private choice: CornerChoice | null = null;
  private pending: { readonly kind: CornerKind; readonly at: number } | null = null;
  private padFrame = 0;
  private readonly padPrevious = new Set<number>();

  private readonly keydown = (event: KeyboardEvent): void => {
    const kind = CORNER_KEYS[event.code];
    if (kind === undefined || !this.visible || event.repeat) return;
    event.preventDefault();
    this.choose(kind);
  };

  constructor(parent: HTMLElement, private readonly pick: (kind: CornerKind) => boolean, private readonly now: () => number = () => performance.now()) {
    const section = document.createElement("section");
    section.className = "corner";
    section.dataset.corner = "";
    section.hidden = true;
    section.setAttribute("aria-label", "Instructions for your corner");
    const title = document.createElement("p");
    title.className = "corner-title";
    title.textContent = "YOUR CORNER";
    const row = document.createElement("div");
    row.className = "corner-choices";
    for (const { kind, key, title: label } of CHOICES) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.cornerPick = kind;
      const keyLabel = document.createElement("kbd");
      keyLabel.textContent = key;
      const name = document.createElement("strong");
      name.textContent = label;
      const detail = document.createElement("span");
      button.append(keyLabel, name, detail);
      button.addEventListener("click", () => this.choose(kind));
      row.append(button);
      this.buttons.set(kind, button);
      this.details.set(kind, detail);
    }
    this.status = document.createElement("p");
    this.status.className = "corner-status";
    this.status.setAttribute("role", "status");
    section.append(title, row, this.status);
    parent.append(section);
    this.element = section;
    window.addEventListener("keydown", this.keydown);
  }

  /** Shows the panel to a fighter during the rest and reflects the corner's work from the latest snapshot. */
  update(snapshot: EngineSnapshot | null, viewerId: string | null, fighter: boolean): void {
    const viewer = snapshot?.fighters.find((candidate) => candidate.player_id === viewerId);
    const show = fighter && snapshot !== null && snapshot.phase === "rest" && viewer !== undefined;
    if (!show || viewer === undefined) {
      this.setVisible(false);
      this.choice = null;
      this.pending = null;
      return;
    }
    this.setVisible(true);
    this.choice = viewer.corner_choice;
    if (this.choice !== null || (this.pending !== null && this.now() - this.pending.at > PENDING_MS)) this.pending = null;
    const preview = cornerPreview(viewer);
    for (const { kind, choice } of CHOICES) {
      const button = this.buttons.get(kind)!;
      const detail = this.details.get(kind)!;
      if (detail.textContent !== preview[choice]) detail.textContent = preview[choice];
      button.disabled = this.choice !== null || this.pending !== null;
      button.toggleAttribute("data-picked", this.choice === choice || this.pending?.kind === kind);
    }
    const text = this.choice !== null ? WORKING[this.choice] : this.pending !== null ? "Calling it to your corner…" : "Tell your corner what to work on before the bell.";
    if (this.status.textContent !== text) this.status.textContent = text;
  }

  private choose(kind: CornerKind): void {
    if (!this.visible || this.choice !== null || this.pending !== null) return;
    if (!this.pick(kind)) return;
    this.pending = { kind, at: this.now() };
    for (const [candidate, button] of this.buttons) {
      button.disabled = true;
      button.toggleAttribute("data-picked", candidate === kind);
    }
    this.status.textContent = "Calling it to your corner…";
  }

  private setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.element.hidden = !visible;
    this.padPrevious.clear();
    if (visible) this.padFrame = requestAnimationFrame(() => this.pollPad());
    else cancelAnimationFrame(this.padFrame);
  }

  private pollPad(): void {
    if (!this.visible) return;
    let pad: Gamepad | null = null;
    try {
      pad = [...(navigator.getGamepads?.() ?? [])].find((item): item is Gamepad => item !== null && item.connected && item.mapping === "standard") ?? null;
    } catch {
      pad = null;
    }
    if (pad !== null) {
      for (const [index, kind] of Object.entries(CORNER_PAD_BUTTONS)) {
        const button = Number(index);
        const down = pad.buttons[button]?.pressed === true;
        if (down && !this.padPrevious.has(button)) this.choose(kind);
        if (down) this.padPrevious.add(button);
        else this.padPrevious.delete(button);
      }
    }
    this.padFrame = requestAnimationFrame(() => this.pollPad());
  }

  destroy(): void {
    this.setVisible(false);
    window.removeEventListener("keydown", this.keydown);
    this.element.remove();
  }
}
