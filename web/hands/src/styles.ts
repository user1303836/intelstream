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

/**
 * The pick closes on this page this long before the room's deadline: the deadline was measured when
 * its message left the room, so this clock runs half a round trip behind, and a pick made in that last
 * stretch would reach a room that had already started the bout with the earlier choice.
 */
const CLOSING_MS = 400;

const STYLE_KEYS: Readonly<Record<string, number>> = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3, Numpad5: 4 };

/** How far the left stick has to go to move the choice, as a share of its travel. */
const STICK_MOVE = 0.6;

type PadIntent = "previous" | "next" | "settle";

/** The first connected controller with the standard layout, or null; the browser may refuse to say. */
function standardPad(): Gamepad | null {
  try {
    return [...(navigator.getGamepads?.() ?? [])].find((item): item is Gamepad => item !== null && item.connected && item.mapping === "standard") ?? null;
  } catch {
    return null;
  }
}

/** What a standard controller asks of the pick: the D-pad or the left stick moves the choice, the bottom face button settles it. */
function padIntents(pad: Gamepad | null): Set<PadIntent> {
  const intents = new Set<PadIntent>();
  if (pad === null) return intents;
  const pressed = (index: number): boolean => pad.buttons[index]?.pressed === true;
  const x = pad.axes[0] ?? 0;
  const y = pad.axes[1] ?? 0;
  if (pressed(12) || pressed(14) || x < -STICK_MOVE || y < -STICK_MOVE) intents.add("previous");
  if (pressed(13) || pressed(15) || x > STICK_MOVE || y > STICK_MOVE) intents.add("next");
  if (pressed(0)) intents.add("settle");
  return intents;
}

/**
 * The pick of styles before the bout: five cards with their strengths, a countdown, and whether the
 * other corner has settled (not on what). Arrow keys, the D-pad or the left stick move the choice, a
 * number or a tap picks a card, and Enter or the controller's bottom face button settles on the one
 * chosen; every change is sent so the deadline uses the latest.
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
  private padFrame = 0;
  /** What the controller asked for last frame: a choice is made on the press, never while it is held. */
  private padHeld = new Set<PadIntent>();
  private context: { readonly select: SelectMessage; readonly viewerId: string | null } | null = null;

  private readonly keydown = (event: KeyboardEvent): void => {
    if (!this.visible || !this.choosing || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    // A key pressed in Settings, or on any other control that has the focus, belongs to that control.
    const target = event.target;
    if (target instanceof HTMLElement && target !== document.body && !this.element.contains(target)) return;
    const shortcut = STYLE_KEYS[event.code];
    if (shortcut !== undefined) {
      event.preventDefault();
      this.pick(STYLE_CARDS[shortcut]!.style, true);
    } else if (event.code === "ArrowRight" || event.code === "ArrowDown") {
      event.preventDefault();
      this.move(this.neighbour(1));
    } else if (event.code === "ArrowLeft" || event.code === "ArrowUp") {
      event.preventDefault();
      this.move(this.neighbour(-1));
    } else if ((event.code === "Enter" || event.code === "Space") && !(target instanceof HTMLButtonElement)) {
      // On a focused card the browser's own click settles that card.
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
    // A spectator seated before the bell begins choosing then.
    const begun = this.context === null || (!this.choosing && role === "fighter");
    if (this.context?.select !== select) this.deadlineAt = this.now() + select.deadline_ms - CLOSING_MS;
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
    if (!this.choosing || this.settled || this.closed) return;
    this.highlighted = style;
    if (!this.send(style, ready)) return;
    // Remembered for next time from the room's ready, which says the style he actually boxes in.
    if (ready) this.settled = true;
    this.render();
  }

  /** Too late for a pick to reach the room before it closes. */
  private get closed(): boolean {
    return this.now() >= this.deadlineAt;
  }

  /** The card beside the lit one, wrapping round the row. */
  private neighbour(step: 1 | -1): FighterStyle {
    const index = STYLE_CARDS.findIndex((card) => card.style === this.highlighted);
    return STYLE_CARDS[(index + step + STYLE_CARDS.length) % STYLE_CARDS.length]!.style;
  }

  /** Moves the choice, and the keyboard focus with it, so Enter, Space and Tab all mean the card that is lit. */
  private move(style: FighterStyle): void {
    this.pick(style, false);
    if (!this.settled) this.buttons.get(this.highlighted)?.focus();
  }

  private render(): void {
    const context = this.context;
    if (context === null) return;
    const { select, viewerId } = context;
    for (const card of STYLE_CARDS) {
      const button = this.buttons.get(card.style)!;
      const mine = this.choosing && card.style === this.highlighted;
      button.disabled = !this.choosing || this.settled || this.closed;
      button.setAttribute("aria-pressed", String(mine));
      button.toggleAttribute("data-chosen", mine);
      // Tab reaches only the lit card; the arrows move between them.
      button.tabIndex = card.style === this.highlighted ? 0 : -1;
    }
    const seconds = Math.max(0, Math.ceil((this.deadlineAt - this.now()) / 1000));
    const clock = `${seconds}s`;
    if (this.clock.textContent !== clock) this.clock.textContent = clock;
    // Who has settled, never on what: the styles are revealed together at the bell, since showing a
    // settled one would reward waiting to pick its counter. Who has dropped, while the pick goes on.
    const named = select.players
      .filter((player) => player.id !== viewerId && (!player.connected || select.ready.includes(player.id)))
      .map((player) => (player.connected ? `${player.name} is ready.` : `Waiting for ${player.name} to reconnect.`))
      .join(" ");
    const text = !this.choosing
      ? named.length > 0 ? `The fighters are choosing. ${named}` : "The fighters are choosing their styles."
      : this.settled
        ? named.length > 0 ? `Ready as ${cardOf(this.highlighted).name}. ${named}` : `Ready as ${cardOf(this.highlighted).name}. Waiting for your opponent.`
        : named.length > 0 ? `${named} Tap a style or press Enter to settle on yours.` : "Tap a style, or use the arrow keys and Enter.";
    if (this.status.textContent !== text) this.status.textContent = text;
  }

  private setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.element.hidden = !visible;
    if (visible) {
      this.timer = window.setInterval(() => this.render(), 250);
      // A button or stick still held as the pick opens (the last punch of the bout before) is not a choice.
      this.padHeld = padIntents(standardPad());
      this.padFrame = requestAnimationFrame(() => this.pollPad());
    } else {
      if (this.timer !== null) window.clearInterval(this.timer);
      this.timer = null;
      cancelAnimationFrame(this.padFrame);
    }
  }

  private pollPad(): void {
    if (!this.visible) return;
    const intents = padIntents(standardPad());
    for (const intent of intents) {
      if (this.padHeld.has(intent)) continue;
      if (intent === "settle") this.pick(this.highlighted, true);
      else this.move(this.neighbour(intent === "next" ? 1 : -1));
    }
    this.padHeld = intents;
    this.padFrame = requestAnimationFrame(() => this.pollPad());
  }

  destroy(): void {
    this.setVisible(false);
    window.removeEventListener("keydown", this.keydown);
    this.element.remove();
  }
}
