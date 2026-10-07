import { FIGHTER_STYLES } from "./protocol";
import type { ConnectionRole, FighterStyle, SelectMessage } from "./types";

export interface StyleCard {
  readonly style: FighterStyle;
  readonly name: string;
  /** Short enough for a name plate. */
  readonly tag: string;
  readonly detail: string;
  /** One to five for power, hand speed, footwork, reach, stamina and defence, in that order. */
  readonly stats: readonly [number, number, number, number, number, number];
}

export const STAT_NAMES = ["Power", "Hand speed", "Footwork", "Reach", "Stamina", "Defence"] as const;

export const STYLE_CARDS: readonly StyleCard[] = [
  { style: "balanced", name: "Balanced", tag: "BALANCED", detail: "Even at everything, no holes to exploit.", stats: [3, 3, 3, 3, 3, 3] },
  { style: "boxer", name: "Boxer", tag: "BOXER", detail: "Snappy jab and long reach, lighter hands.", stats: [2, 4, 3, 4, 3, 3] },
  { style: "slugger", name: "Slugger", tag: "SLUGGER", detail: "Heavy hands, hard chin, slow feet, tires sooner.", stats: [5, 2, 2, 3, 2, 4] },
  { style: "swarmer", name: "Swarmer", tag: "SWARMER", detail: "Quick feet and head, digs to the body, never stops.", stats: [3, 4, 5, 3, 4, 3] },
  { style: "counter_puncher", name: "Counter-puncher", tag: "COUNTER", detail: "Slips and parries, makes every miss cost.", stats: [2, 3, 3, 3, 3, 5] },
];

const cardOf = (style: FighterStyle): StyleCard => STYLE_CARDS.find((card) => card.style === style) ?? STYLE_CARDS[0]!;

/** The name plate's tag for a style; the balanced fighter carries none. */
export function styleTag(style: FighterStyle | undefined): string | null {
  return style === undefined || style === "balanced" ? null : cardOf(style).tag;
}

/** How the ring announcer says it: "the slugger". */
export function styleTitle(style: FighterStyle | undefined): string | null {
  return style === undefined || style === "balanced" ? null : `the ${cardOf(style).name.toLowerCase()}`;
}

const STORAGE_KEY = "hands.style.v1";

/** The style the player picked last time, so it is ready again. Storage can be missing or blocked. */
export function loadStyle(storage: Pick<Storage, "getItem"> | null = safeStorage()): FighterStyle {
  try {
    const value = storage?.getItem(STORAGE_KEY);
    return FIGHTER_STYLES.find((style) => style === value) ?? "balanced";
  } catch {
    return "balanced";
  }
}

export function saveStyle(style: FighterStyle, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, style);
  } catch {
    // Remembering the pick is a convenience; the bout goes ahead without it.
  }
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const STYLE_KEYS: Readonly<Record<string, number>> = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3, Numpad5: 4 };

/**
 * The pick of styles before the bout: five cards with their strengths, a countdown, and the other
 * corner's style once it is settled. Arrow keys move the choice, a number or a tap picks a card and
 * Enter settles on the one chosen; every change is sent so the deadline uses the latest.
 */
export class StylePicker {
  readonly element: HTMLElement;
  private readonly buttons = new Map<FighterStyle, HTMLButtonElement>();
  private readonly clock: HTMLElement;
  private readonly status: HTMLElement;
  private visible = false;
  private choosing = false;
  private highlighted: FighterStyle;
  private settled = false;
  private deadlineAt = 0;
  private timer: number | null = null;
  private context: { readonly select: SelectMessage; readonly viewerId: string | null } | null = null;

  private readonly keydown = (event: KeyboardEvent): void => {
    if (!this.visible || !this.choosing || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const index = STYLE_CARDS.findIndex((card) => card.style === this.highlighted);
    const shortcut = STYLE_KEYS[event.code];
    if (shortcut !== undefined) {
      event.preventDefault();
      this.pick(STYLE_CARDS[shortcut]!.style, true);
    } else if (event.code === "ArrowRight" || event.code === "ArrowDown") {
      event.preventDefault();
      this.pick(STYLE_CARDS[(index + 1) % STYLE_CARDS.length]!.style, false);
    } else if (event.code === "ArrowLeft" || event.code === "ArrowUp") {
      event.preventDefault();
      this.pick(STYLE_CARDS[(index + STYLE_CARDS.length - 1) % STYLE_CARDS.length]!.style, false);
    } else if (event.code === "Enter" || event.code === "Space") {
      event.preventDefault();
      this.pick(this.highlighted, true);
    }
  };

  constructor(
    parent: HTMLElement,
    private readonly send: (style: FighterStyle, ready: boolean) => boolean,
    private readonly now: () => number = () => performance.now(),
    preferred: FighterStyle = loadStyle(),
  ) {
    this.highlighted = preferred;
    const section = document.createElement("section");
    section.className = "style-picker";
    section.dataset.stylePicker = "";
    section.hidden = true;
    section.setAttribute("aria-label", "Pick how your fighter boxes");
    const head = document.createElement("header");
    const title = document.createElement("p");
    title.className = "style-title";
    title.textContent = "CHOOSE YOUR STYLE";
    this.clock = document.createElement("p");
    this.clock.className = "style-clock";
    head.append(title, this.clock);
    const row = document.createElement("div");
    row.className = "style-cards";
    for (const [index, card] of STYLE_CARDS.entries()) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.style = card.style;
      button.setAttribute("aria-pressed", "false");
      const key = document.createElement("kbd");
      key.textContent = String(index + 1);
      const name = document.createElement("strong");
      name.textContent = card.name;
      const detail = document.createElement("span");
      detail.textContent = card.detail;
      const stats = document.createElement("ul");
      stats.className = "style-stats";
      for (const [statIndex, value] of card.stats.entries()) {
        const item = document.createElement("li");
        item.setAttribute("aria-label", `${STAT_NAMES[statIndex]} ${value} of 5`);
        const label = document.createElement("small");
        label.textContent = STAT_NAMES[statIndex]!;
        const bar = document.createElement("i");
        bar.dataset.value = String(value);
        item.append(label, bar);
        stats.append(item);
      }
      button.append(key, name, detail, stats);
      button.addEventListener("click", () => this.pick(card.style, true));
      row.append(button);
      this.buttons.set(card.style, button);
    }
    this.status = document.createElement("p");
    this.status.className = "style-status";
    this.status.setAttribute("role", "status");
    section.append(head, row, this.status);
    parent.append(section);
    this.element = section;
    window.addEventListener("keydown", this.keydown);
  }

  /** Shows the pick while the room is choosing; `role` decides whether this viewer may choose. */
  update(select: SelectMessage | null, viewerId: string | null, role: ConnectionRole | null): void {
    if (select === null) {
      this.setVisible(false);
      this.context = null;
      this.settled = false;
      return;
    }
    const begun = this.context === null;
    if (this.context?.select !== select) this.deadlineAt = this.now() + select.deadline_ms;
    this.context = { select, viewerId };
    this.choosing = role === "fighter" && viewerId !== null;
    // A settled pick is final, here as in the room, even before the room has echoed it.
    this.settled = this.choosing && (this.settled || select.ready.includes(viewerId!));
    // After a reconnect the room knows the settled pick better than this page does.
    const own = select.players.find((player) => player.id === viewerId)?.style;
    if (this.settled && own !== undefined) this.highlighted = own;
    // Last time's style goes in as soon as the pick begins, so the deadline uses it unless changed.
    if (begun && this.choosing && !this.settled) this.send(this.highlighted, false);
    this.setVisible(true);
    this.render();
  }

  private pick(style: FighterStyle, ready: boolean): void {
    if (!this.choosing || this.settled) return;
    this.highlighted = style;
    if (!this.send(style, ready)) return;
    if (ready) {
      this.settled = true;
      saveStyle(style);
    }
    this.render();
  }

  private render(): void {
    const context = this.context;
    if (context === null) return;
    const { select, viewerId } = context;
    for (const card of STYLE_CARDS) {
      const button = this.buttons.get(card.style)!;
      const mine = this.choosing && card.style === this.highlighted;
      button.disabled = !this.choosing || this.settled;
      button.setAttribute("aria-pressed", String(mine));
      button.toggleAttribute("data-chosen", mine);
    }
    const seconds = Math.max(0, Math.ceil((this.deadlineAt - this.now()) / 1000));
    const clock = `${seconds}s`;
    if (this.clock.textContent !== clock) this.clock.textContent = clock;
    const named = select.players
      .filter((player) => player.id !== viewerId && player.style !== undefined)
      .map((player) => `${player.name}: ${cardOf(player.style!).name}`)
      .join(" · ");
    const text = !this.choosing
      ? named.length > 0 ? `The fighters are choosing. ${named}` : "The fighters are choosing their styles."
      : this.settled
        ? named.length > 0 ? `Ready as ${cardOf(this.highlighted).name}. ${named}` : `Ready as ${cardOf(this.highlighted).name}. Waiting for your opponent.`
        : named.length > 0 ? `${named}. Tap a style or press Enter to settle on yours.` : "Tap a style, or use the arrow keys and Enter.";
    if (this.status.textContent !== text) this.status.textContent = text;
  }

  private setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.element.hidden = !visible;
    if (visible) this.timer = window.setInterval(() => this.render(), 250);
    else if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  destroy(): void {
    this.setVisible(false);
    window.removeEventListener("keydown", this.keydown);
    this.element.remove();
  }
}
