import type { SemanticAction } from "../types";

function sameAction(left: SemanticAction, right: SemanticAction): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "punch" && right.kind === "punch") {
    return left.hand === right.hand && left.class === right.class && left.target === right.target && left.power === right.power;
  }
  if (left.kind === "foul" && right.kind === "foul") return left.foul === right.foul;
  return true;
}

export function pushActionIntent(
  queue: SemanticAction[],
  action: SemanticAction,
  maximum: number,
): void {
  if (maximum < 1 || (queue.length > 0 && sameAction(queue.at(-1)!, action))) return;
  const overflow = queue.length - maximum + 1;
  if (overflow > 0) queue.splice(0, overflow);
  queue.push(action);
}

export type ActionSource = "keyboard" | "gamepad";

export class SharedActionIntent {
  private readonly queue: Array<{ action: SemanticAction; source: ActionSource }> = [];
  private counter = 0;
  private listener: ((action: SemanticAction) => void) | null = null;

  constructor(private readonly maximum = 1) {}

  setListener(listener: ((action: SemanticAction) => void) | null): void {
    this.listener = listener;
  }

  push(source: ActionSource, action: SemanticAction): void {
    if (this.maximum < 1) return;
    const identified: SemanticAction = { ...action, id: `c${(this.counter += 1)}` };
    const latest = this.queue.at(-1);
    if (latest !== undefined && sameAction(latest.action, identified)) {
      latest.source = source;
      latest.action = identified;
      return;
    }
    const overflow = this.queue.length - this.maximum + 1;
    if (overflow > 0) this.queue.splice(0, overflow);
    this.queue.push({ action: identified, source });
    this.listener?.(identified);
  }

  clear(): void {
    this.queue.length = 0;
  }

  clearSource(source: ActionSource): void {
    const retained = this.queue.filter((entry) => entry.source !== source);
    this.queue.splice(0, this.queue.length, ...retained);
  }

  drain(maximum: number): SemanticAction[] {
    return this.queue.splice(0, maximum).map((entry) => entry.action);
  }
}
