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

describe("the announcer's voice", () => {
  let settings: Settings;
  let synthesis: FakeSynthesis;
  const make = (): AnnouncerVoice => new AnnouncerVoice(() => settings, synthesis, FakeUtterance as unknown as new (text: string) => SpeechSynthesisUtterance);

  beforeEach(() => {
    settings = { volume: 0.6, haptics: true, reducedMotion: false, blood: "full", camera: "broadcast", commentary: true, announcer: true };
    synthesis = new FakeSynthesis();
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
    expect(pickVoice([french, remote])).toBe(remote);
    expect(pickVoice([french])).toBeNull();
    synthesis.voices = [french, local];
    make().speak(["Azure Vector!"]);
    expect(synthesis.spoken[0]!.voice).toBe(local);
    expect(synthesis.spoken[0]!.lang).toBe("en-GB");
  });
});
