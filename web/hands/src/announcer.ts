import type { Settings } from "./settings";

type Synthesis = Pick<SpeechSynthesis, "speak" | "cancel" | "getVoices">;
type UtteranceConstructor = new (text: string) => SpeechSynthesisUtterance;

const MAX_QUEUE = 6;

/** Whether this browser can speak. Discord's mobile webviews may not. */
export function speechAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.speechSynthesis === "object" && window.speechSynthesis !== null && typeof window.SpeechSynthesisUtterance === "function";
}

/** An English voice that runs on the device, the default one if it qualifies. */
export function pickVoice(voices: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const english = voices.filter((voice) => voice.lang.toLowerCase().startsWith("en"));
  return english.find((voice) => voice.localService && voice.default) ?? english.find((voice) => voice.localService) ?? english[0] ?? null;
}

/** Reads the ring announcements aloud, one at a time, at the player's volume. */
export class AnnouncerVoice {
  private readonly queue: string[] = [];
  private speaking: SpeechSynthesisUtterance | null = null;
  private destroyed = false;

  constructor(
    private readonly settings: () => Settings,
    private readonly synthesis: Synthesis | null = speechAvailable() ? window.speechSynthesis : null,
    private readonly Utterance: UtteranceConstructor | null = speechAvailable() ? window.SpeechSynthesisUtterance : null,
  ) {}

  get supported(): boolean {
    return this.synthesis !== null && this.Utterance !== null;
  }

  speak(lines: readonly string[]): void {
    if (!this.supported || this.destroyed) return;
    const settings = this.settings();
    if (!settings.announcer || settings.volume <= 0) return;
    this.queue.push(...lines);
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
    if (this.speaking === null) this.next();
  }

  /** A line already being read keeps the volume it started with, so muting, or switching the voice off, stops it. */
  settingsChanged(): void {
    const settings = this.settings();
    if (!settings.announcer || settings.volume <= 0) this.cancel();
  }

  /** Stops the current announcement and forgets the rest. */
  cancel(): void {
    this.queue.length = 0;
    const speaking = this.speaking;
    this.speaking = null;
    if (speaking !== null) {
      speaking.onend = null;
      speaking.onerror = null;
      this.synthesis?.cancel();
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.cancel();
  }

  private next(): void {
    const synthesis = this.synthesis;
    const Utterance = this.Utterance;
    const text = this.queue.shift();
    if (synthesis === null || Utterance === null || text === undefined) return;
    const settings = this.settings();
    if (!settings.announcer || settings.volume <= 0) {
      this.queue.length = 0;
      return;
    }
    const utterance = new Utterance(text);
    utterance.volume = Math.min(1, settings.volume);
    utterance.rate = 0.96;
    utterance.pitch = 0.82;
    const voice = pickVoice(synthesis.getVoices());
    if (voice !== null) utterance.voice = voice;
    utterance.lang = voice?.lang ?? "en-US";
    // A blocked or failed line ends like a finished one so the queue never stalls.
    const finished = (): void => {
      if (this.speaking !== utterance) return;
      this.speaking = null;
      this.next();
    };
    utterance.onend = finished;
    utterance.onerror = finished;
    this.speaking = utterance;
    synthesis.speak(utterance);
  }
}
