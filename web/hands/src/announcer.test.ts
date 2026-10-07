import { AnnouncerVoice, pickVoice } from "./announcer";
import type { Settings } from "./settings";

class FakeUtterance {
  volume = 1;
  rate = 1;
  pitch = 1;
  lang = "";
  voice: SpeechSynthesisVoice | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly text: string) {}
}

class FakeSynthesis {
  readonly spoken: FakeUtterance[] = [];
  cancels = 0;
  voices: SpeechSynthesisVoice[] = [];
  private readonly listeners = new Set<() => void>();
  addEventListener(type: string, listener: () => void): void {
    if (type === "voiceschanged") this.listeners.add(listener);
  }
  removeEventListener(type: string, listener: () => void): void {
    if (type === "voiceschanged") this.listeners.delete(listener);
  }
  /** The browser (re)lists its voices, as Chrome does a moment after the page loads. */
  listVoices(voices: SpeechSynthesisVoice[]): void {
    this.voices = voices;
    for (const listener of this.listeners) listener();
  }
  speak(utterance: SpeechSynthesisUtterance): void {
    this.spoken.push(utterance as unknown as FakeUtterance);
  }
  cancel(): void {
    this.cancels += 1;
  }
  getVoices(): SpeechSynthesisVoice[] {
    return this.voices;
  }
  finishLast(): void {
    this.spoken.at(-1)!.onend?.();
  }
}

const voice = (name: string, lang: string, localService: boolean, isDefault = false): SpeechSynthesisVoice => ({ name, lang, localService, default: isDefault, voiceURI: name }) as SpeechSynthesisVoice;
const deviceVoice = voice("Microsoft David", "en-US", true, true);

describe("the announcer's voice", () => {
  let settings: Settings;
  let synthesis: FakeSynthesis;
  const make = (): AnnouncerVoice => new AnnouncerVoice(() => settings, synthesis, FakeUtterance as unknown as new (text: string) => SpeechSynthesisUtterance);

  beforeEach(() => {
    settings = { volume: 0.6, haptics: true, reducedMotion: false, blood: "full", camera: "broadcast", commentary: true, announcer: true };
    synthesis = new FakeSynthesis();
    synthesis.voices = [deviceVoice];
  });

  it("speaks one line at a time, in order, at the player's volume", () => {
    const announcer = make();
    announcer.speak(["In the blue corner... Azure Vector!", "And in the red corner... Crimson Geometry!"]);
    expect(synthesis.spoken.map((utterance) => utterance.text)).toEqual(["In the blue corner... Azure Vector!"]);
    expect(synthesis.spoken[0]!.volume).toBe(0.6);
    announcer.speak(["Ladies and gentlemen, we go to the scorecards."]);
    expect(synthesis.spoken).toHaveLength(1);
    synthesis.finishLast();
    expect(synthesis.spoken.map((utterance) => utterance.text)).toEqual(["In the blue corner... Azure Vector!", "And in the red corner... Crimson Geometry!"]);
    synthesis.finishLast();
    synthesis.finishLast();
    expect(synthesis.spoken).toHaveLength(3);
  });

  it("carries on past a line the browser refuses to speak", () => {
    const announcer = make();
    announcer.speak(["one", "two"]);
    synthesis.spoken[0]!.onerror?.();
    expect(synthesis.spoken.map((utterance) => utterance.text)).toEqual(["one", "two"]);
  });

  it("stays quiet when turned off or muted", () => {
    settings = { ...settings, announcer: false };
    make().speak(["Your winner..."]);
    settings = { ...settings, announcer: true, volume: 0 };
    make().speak(["Your winner..."]);
    expect(synthesis.spoken).toHaveLength(0);
  });

  it("drops the rest of the script when it is turned off mid-way", () => {
    const announcer = make();
    announcer.speak(["one", "two"]);
    settings = { ...settings, announcer: false };
    synthesis.finishLast();
    expect(synthesis.spoken).toHaveLength(1);
  });

  it("stops the line being read when the player mutes, and keeps it when the volume only changes", () => {
    const announcer = make();
    announcer.speak(["In the blue corner...", "And in the red corner..."]);
    settings = { ...settings, volume: 0.3 };
    announcer.settingsChanged();
    expect(synthesis.cancels).toBe(0);
    settings = { ...settings, volume: 0 };
    announcer.settingsChanged();
    expect(synthesis.cancels).toBe(1);
    synthesis.finishLast();
    expect(synthesis.spoken).toHaveLength(1);
  });

  it("is cancelled for a rematch and after teardown says nothing", () => {
    const announcer = make();
    announcer.speak(["one", "two"]);
    announcer.cancel();
    expect(synthesis.cancels).toBe(1);
    synthesis.finishLast();
    expect(synthesis.spoken).toHaveLength(1);
    announcer.destroy();
    announcer.speak(["three"]);
    expect(synthesis.spoken).toHaveLength(1);
  });

  it("says nothing while the Activity is hidden and stops the line it was reading when it hides", () => {
    let hidden = true;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    try {
      const announcer = make();
      // The final arrives with the player in another app: the scorecards line is not read over it.
      announcer.speak(["Ladies and gentlemen, we go to the scorecards."]);
      expect(synthesis.spoken).toHaveLength(0);
      hidden = false;
      announcer.speak(["In the blue corner, Azure Vector!", "And in the red corner, Crimson Geometry!"]);
      expect(synthesis.spoken).toHaveLength(1);
      hidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
      expect(synthesis.cancels).toBe(1);
      synthesis.finishLast();
      expect(synthesis.spoken).toHaveLength(1);
      announcer.destroy();
      hidden = false;
      document.dispatchEvent(new Event("visibilitychange"));
      expect(synthesis.cancels).toBe(1);
    } finally {
      Reflect.deleteProperty(document, "hidden");
    }
  });

  it("does nothing where the browser cannot speak", () => {
    const announcer = new AnnouncerVoice(() => settings, null, null);
    expect(announcer.supported).toBe(false);
    expect(() => announcer.speak(["hello"])).not.toThrow();
  });

  it("prefers an English voice on the device", () => {
    const remote = voice("Remote English", "en-US", false);
    const local = voice("Local English", "en-GB", true);
    const french = voice("Local French", "fr-FR", true, true);
    expect(pickVoice([french, remote, local])).toBe(local);
    expect(pickVoice([french, remote])).toBeNull();
    expect(pickVoice([french])).toBeNull();
    synthesis.voices = [french, local];
    make().speak(["Azure Vector!"]);
    expect(synthesis.spoken[0]!.voice).toBe(local);
    expect(synthesis.spoken[0]!.lang).toBe("en-GB");
  });

  it("never reads the fighters' names with a voice that speaks from a vendor's servers", () => {
    // Chrome's "Google US English" synthesizes online: the names would leave the Activity.
    synthesis.voices = [voice("Google US English", "en-US", false, true), voice("Local French", "fr-FR", true)];
    const announcer = make();
    expect(announcer.hasVoice).toBe(false);
    announcer.speak(["In the blue corner, Azure Vector!"]);
    expect(synthesis.spoken).toHaveLength(0);
  });

  it("waits for voices the browser lists late, and reads with the device's own once they come", () => {
    synthesis.voices = [];
    const changed = vi.fn();
    const announcer = make();
    announcer.onVoicesChanged = changed;
    // Nothing is listed yet: Settings still offers the voice, but no line goes to the browser's own choice.
    expect(announcer.hasVoice).toBe(true);
    announcer.speak(["In the blue corner, Azure Vector!"]);
    expect(synthesis.spoken).toHaveLength(0);
    synthesis.listVoices([voice("Google UK English Male", "en-GB", false), deviceVoice]);
    expect(changed).toHaveBeenCalledOnce();
    announcer.speak(["In the blue corner, Azure Vector!"]);
    expect(synthesis.spoken[0]!.voice).toBe(deviceVoice);
    // A device whose own voice goes away stops reading, and Settings is told.
    synthesis.listVoices([voice("Google UK English Male", "en-GB", false)]);
    expect(synthesis.cancels).toBe(1);
    expect(announcer.hasVoice).toBe(false);
    expect(changed).toHaveBeenCalledTimes(2);
    announcer.destroy();
    synthesis.listVoices([deviceVoice]);
    expect(changed).toHaveBeenCalledTimes(2);
  });
});
