import type { Settings } from "./settings";

type Synthesis = Pick<SpeechSynthesis, "speak" | "cancel" | "getVoices"> & {
  addEventListener?(type: "voiceschanged", listener: () => void): void;
  removeEventListener?(type: "voiceschanged", listener: () => void): void;
};
type UtteranceConstructor = new (text: string) => SpeechSynthesisUtterance;

const MAX_QUEUE = 6;

/** Whether this browser can speak. Discord's mobile webviews may not. */
export function speechAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.speechSynthesis === "object" && window.speechSynthesis !== null && typeof window.SpeechSynthesisUtterance === "function";
}

/**
 * An English voice that runs on the device, the default one if it qualifies. A voice that
 * synthesizes on a vendor's servers would send the players' names off the device, so the
 * announcer goes without rather than use one.
 */
export function pickVoice(voices: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const local = voices.filter((voice) => voice.localService && voice.lang.toLowerCase().startsWith("en"));
  return local.find((voice) => voice.default) ?? local[0] ?? null;
}

/** Reads the ring announcements aloud, one at a time, at the player's volume. */
export class AnnouncerVoice {
  private readonly queue: string[] = [];
  private speaking: SpeechSynthesisUtterance | null = null;
  private destroyed = false;
  /** The device's own English voice it reads with, once the device has listed one. */
  private voice: SpeechSynthesisVoice | null = null;
  /** Chrome lists no voices until a moment after the page loads. */
  private voicesListed = false;
  /** Called when the device's voices change, so Settings can offer the announcer or say why it cannot. */
  onVoicesChanged: (() => void) | null = null;

  private readonly voicesChanged = (): void => {
    this.listVoices();
    if (this.voice === null) this.cancel();
    this.onVoicesChanged?.();
  };

  /** The rest of the game's sound is suspended while the Activity is hidden, and the voice goes quiet with it. */
  private readonly visibility = (): void => {
    if (document.hidden) this.cancel();
  };

  constructor(
    private readonly settings: () => Settings,
    private readonly synthesis: Synthesis | null = speechAvailable() ? window.speechSynthesis : null,
    private readonly Utterance: UtteranceConstructor | null = speechAvailable() ? window.SpeechSynthesisUtterance : null,
  ) {
    // Asking for the voices is also what starts Chrome loading them.
    this.listVoices();
    synthesis?.addEventListener?.("voiceschanged", this.voicesChanged);
    document.addEventListener("visibilitychange", this.visibility);
  }

  get supported(): boolean {
    return this.synthesis !== null && this.Utterance !== null;
  }

  /** False once the device has listed its voices and none of them is an English voice of its own. */
  get hasVoice(): boolean {
    return this.supported && (this.voice !== null || !this.voicesListed);
  }

  speak(lines: readonly string[]): void {
    if (!this.supported || this.destroyed || document.hidden) return;
    const settings = this.settings();
    if (!settings.announcer || settings.volume <= 0) return;
    // A browser that never says its voices changed may still have listed them since.
    if (this.voice === null) this.listVoices();
    if (this.voice === null) return;
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
    this.synthesis?.removeEventListener?.("voiceschanged", this.voicesChanged);
    document.removeEventListener("visibilitychange", this.visibility);
    this.onVoicesChanged = null;
    this.cancel();
  }

  private listVoices(): void {
    const voices = this.synthesis?.getVoices() ?? [];
    if (voices.length > 0) this.voicesListed = true;
    this.voice = pickVoice(voices);
  }

  private next(): void {
    const synthesis = this.synthesis;
    const Utterance = this.Utterance;
    const voice = this.voice;
    const text = this.queue.shift();
    if (synthesis === null || Utterance === null || text === undefined) return;
    const settings = this.settings();
    if (!settings.announcer || settings.volume <= 0 || voice === null || document.hidden) {
      this.queue.length = 0;
      return;
    }
    const utterance = new Utterance(text);
    utterance.volume = Math.min(1, settings.volume);
    utterance.rate = 0.96;
    utterance.pitch = 0.82;
    utterance.voice = voice;
    utterance.lang = voice.lang;
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
