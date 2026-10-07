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

/** A cut in the words a corner would use; the ringside doctor stops a bout at about 800. */
export function cutWord(cut: number): string {
  return cut < 150 ? "small" : cut < 350 ? "nasty" : cut < 550 ? "deep" : "dangerous";
}

const percent = (value: number, of: number): number => Math.round(Math.max(0, Math.min(1, value / of)) * 100);

/** What each instruction would do for this fighter, in plain words: an eye at 100% is swollen shut. */
export function cornerPreview(fighter: FighterSnapshot): Readonly<Record<CornerChoice, string>> {
  const { trauma } = fighter;
  const worseCut = Math.max(trauma.left_cut, trauma.right_cut);
  const cutAfter = Math.max(0, worseCut - CORNER_TREATMENTS.cut.worse_cut);
  const worseEye = Math.max(trauma.left_eye, trauma.right_eye);
  const eyeAfter = Math.max(0, worseEye - CORNER_TREATMENTS.swelling.eyes);
  const shut = worseEye >= EYE_SHUT_TRAUMA ? (eyeAfter < EYE_SHUT_TRAUMA ? " · opens the eye" : " · stays shut") : "";
  const cutNow = cutWord(worseCut);
  return {
    cut: worseCut === 0 ? "No cut to close" : `${cutNow[0]!.toUpperCase()}${cutNow.slice(1)} cut → ${cutAfter === 0 ? "closed" : cutWord(cutAfter)}`,
    swelling: worseEye === 0 && trauma.swelling === 0 ? "No swelling" : `Eye ${percent(worseEye, EYE_SHUT_TRAUMA)}% swollen → ${percent(eyeAfter, EYE_SHUT_TRAUMA)}%${shut}`,
    breath: `Health ${percent(fighter.conditioning, MAX_CONDITIONING)}% → ${percent(fighter.conditioning + CORNER_TREATMENTS.breath.conditioning, MAX_CONDITIONING)}% · full stamina`,
    balanced: "",
  };
}

/** An instruction with nothing to work on cannot be picked. */
export function cornerAvailable(fighter: FighterSnapshot): Readonly<Record<CornerChoice, boolean>> {
  const { trauma } = fighter;
  return {
    cut: Math.max(trauma.left_cut, trauma.right_cut) > 0,
    swelling: Math.max(trauma.left_eye, trauma.right_eye) > 0 || trauma.swelling > 0,
    breath: true,
    balanced: false,
  };
}

/** The fighter's instructions to the corner between rounds: three buttons, the number keys and the face buttons. */
function standardPad(): Gamepad | null {
  try {
    return [...(navigator.getGamepads?.() ?? [])].find((item): item is Gamepad => item !== null && item.connected && item.mapping === "standard") ?? null;
  } catch {
    return null;
  }
}

export class CornerPanel {
  readonly element: HTMLElement;
  private readonly buttons = new Map<CornerKind, HTMLButtonElement>();
  private readonly details = new Map<CornerKind, HTMLElement>();
  private readonly status: HTMLElement;
  private visible = false;
  private choice: CornerChoice | null = null;
  private pending: { readonly kind: CornerKind; readonly at: number } | null = null;
  /** What the cards said when the pick was made: the treatment changes the fighter, not what was chosen. */
  private shown: Readonly<Record<CornerChoice, string>> | null = null;
  private frozen: Readonly<Record<CornerChoice, string>> | null = null;
  private available: Readonly<Record<CornerChoice, boolean>> | null = null;
  private padFrame = 0;
  private readonly padPrevious = new Set<number>();
  private measuredTop: number | null = null;
  private readonly resize = (): void => {
    this.measuredTop = null;
  };

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
    window.addEventListener("resize", this.resize);
  }

  /** Shows the panel to a fighter during the rest and reflects the corner's work from the latest snapshot. */
  update(snapshot: EngineSnapshot | null, viewerId: string | null, fighter: boolean): void {
    const viewer = snapshot?.fighters.find((candidate) => candidate.player_id === viewerId);
    const show = fighter && snapshot !== null && snapshot.phase === "rest" && viewer !== undefined;
    if (!show || viewer === undefined) {
      this.setVisible(false);
      this.choice = null;
      this.pending = null;
      this.shown = null;
      this.frozen = null;
      return;
    }
    this.setVisible(true);
    this.choice = viewer.corner_choice;
    if (this.choice !== null || (this.pending !== null && this.now() - this.pending.at > PENDING_MS)) this.pending = null;
    const picked = this.choice !== null || this.pending !== null;
    if (!picked) this.frozen = null;
    const preview = picked && this.frozen !== null ? this.frozen : cornerPreview(viewer);
    this.shown = preview;
    const available = cornerAvailable(viewer);
    this.available = available;
    for (const { kind, choice } of CHOICES) {
      const button = this.buttons.get(kind)!;
      const detail = this.details.get(kind)!;
      if (detail.textContent !== preview[choice]) detail.textContent = preview[choice];
      button.disabled = picked || !available[choice];
      button.toggleAttribute("data-picked", this.choice === choice || this.pending?.kind === kind);
    }
    const text = this.choice !== null ? WORKING[this.choice] : this.pending !== null ? "Calling it to your corner…" : "Tell your corner what to work on before the bell.";
    if (this.status.textContent !== text) this.status.textContent = text;
  }

  private choose(kind: CornerKind): void {
    if (!this.visible || this.choice !== null || this.pending !== null) return;
    const choice = CHOICES.find((candidate) => candidate.kind === kind)?.choice;
    if (choice === undefined || this.available?.[choice] === false) return;
    if (!this.pick(kind)) return;
    this.frozen = this.shown;
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
    this.measuredTop = null;
    this.padPrevious.clear();
    if (visible) {
      // A button already held when the panel opens (a punch thrown at the bell) is not a pick.
      const pad = standardPad();
      for (const index of Object.keys(CORNER_PAD_BUTTONS)) if (pad?.buttons[Number(index)]?.pressed === true) this.padPrevious.add(Number(index));
      this.padFrame = requestAnimationFrame(() => this.pollPad());
    } else cancelAnimationFrame(this.padFrame);
  }

  /** How far down the activity the panel's top edge is while it is up, so a caption can keep above it; null while hidden. */
  top(): number | null {
    if (!this.visible) return null;
    if (this.measuredTop === null) {
      const rect = this.element.getBoundingClientRect();
      if (rect.height <= 0) return null;
      this.measuredTop = rect.top - (this.element.parentElement?.getBoundingClientRect().top ?? 0);
    }
    return this.measuredTop;
  }

  private pollPad(): void {
    if (!this.visible) return;
    const pad = standardPad();
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
    window.removeEventListener("resize", this.resize);
    this.element.remove();
  }
}
