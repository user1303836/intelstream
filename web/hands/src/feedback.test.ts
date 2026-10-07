import * as THREE from "three";
import { AudioFeedback, rockedBeatTicks } from "./audio";
import { INJURY_SOUNDS } from "./assets/injury-sounds";
import { HapticFeedback } from "./haptics";
import { EventDeduplicator, SnapshotBuffer } from "./interpolation";
import { RoundStatsTracker } from "./render/hud";
import { contactParticipants, contactPresentationPlan, FightRenderer } from "./render/renderer";
import { worldMapping } from "./render/world";
import { fighter, snapshot } from "./test/fixtures";
import type { CombatEvent, EngineSnapshot } from "./types";

const settings = { volume: 1, haptics: true, reducedMotion: false, blood: "full" as const, camera: "broadcast" as const, commentary: true, announcer: true };
const audioParam = (): AudioParam => ({ value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn() } as unknown as AudioParam);
class MockAudioContext {
  static created = 0;
  static failResume = false;
  static oscillatorStarts = 0;
  static bufferStarts = 0;
  static decodeCalls = 0;
  static failDecode = false;
  static decodeGate: Promise<void> | null = null;
  static operations: string[] = [];
  static last: MockAudioContext | null = null;
  static playedBuffers: Array<AudioBuffer | null> = [];
  static filters: BiquadFilterNode[] = [];
  static gains: GainNode[] = [];
  static sourceStarts: Array<[number | undefined, number | undefined]> = [];
  /** The next resume() is outside a user activation: it stays pending until a later resume() starts the context. */
  static holdResume = false;
  private readonly pendingResumes: (() => void)[] = [];
  state: AudioContextState = "suspended";
  currentTime = 0;
  sampleRate = 8000;
  destination = {};
  resume = vi.fn(async () => {
    MockAudioContext.operations.push("resume");
    if (MockAudioContext.failResume) { MockAudioContext.failResume = false; throw new Error("blocked"); }
    if (MockAudioContext.holdResume) {
      MockAudioContext.holdResume = false;
      await new Promise<void>((resolve) => { this.pendingResumes.push(resolve); });
      return;
    }
    this.state = "running";
    for (const resolve of this.pendingResumes.splice(0)) resolve();
  });
  suspend = vi.fn(async () => { this.state = "suspended"; });
  close = vi.fn(async () => {});
  constructor() {
    MockAudioContext.created += 1;
    MockAudioContext.last = this;
  }
  createGain(): GainNode {
    const gain = { gain: audioParam(), connect: vi.fn((target) => target) } as unknown as GainNode;
    MockAudioContext.gains.push(gain);
    return gain;
  }
  createOscillator(): OscillatorNode { return { type: "sine", frequency: audioParam(), connect: vi.fn((target) => target), start: vi.fn(() => { MockAudioContext.oscillatorStarts += 1; }), stop: vi.fn() } as unknown as OscillatorNode; }
  createBiquadFilter(): BiquadFilterNode {
    const filter = { type: "lowpass", frequency: audioParam(), Q: audioParam(), connect: vi.fn((target) => target) } as unknown as BiquadFilterNode;
    MockAudioContext.filters.push(filter);
    return filter;
  }
  createBuffer(_channels: number, length: number): AudioBuffer { return { getChannelData: () => new Float32Array(length) } as unknown as AudioBuffer; }
  decodeAudioData = vi.fn(async (_data: ArrayBuffer): Promise<AudioBuffer> => {
    MockAudioContext.operations.push("decode");
    MockAudioContext.decodeCalls += 1;
    if (MockAudioContext.decodeGate !== null) await MockAudioContext.decodeGate;
    if (MockAudioContext.failDecode) { MockAudioContext.failDecode = false; throw new Error("decode"); }
    return { decodeIndex: MockAudioContext.decodeCalls - 1 } as unknown as AudioBuffer;
  });
  createBufferSource(): AudioBufferSourceNode {
    const source = { buffer: null as AudioBuffer | null, loop: false, connect: vi.fn((target) => target), start: vi.fn((when?: number, offset?: number) => {
      MockAudioContext.bufferStarts += 1;
      MockAudioContext.playedBuffers.push(source.buffer);
      MockAudioContext.sourceStarts.push([when, offset]);
    }), stop: vi.fn() };
    return source as unknown as AudioBufferSourceNode;
  }
}

describe("authoritative audio and haptics", () => {
  beforeEach(() => {
    MockAudioContext.created = 0;
    MockAudioContext.failResume = false;
    MockAudioContext.oscillatorStarts = 0;
    MockAudioContext.bufferStarts = 0;
    MockAudioContext.decodeCalls = 0;
    MockAudioContext.failDecode = false;
    MockAudioContext.decodeGate = null;
    MockAudioContext.operations = [];
    MockAudioContext.last = null;
    MockAudioContext.playedBuffers = [];
    MockAudioContext.filters = [];
    MockAudioContext.gains = [];
    MockAudioContext.sourceStarts = [];
    MockAudioContext.holdResume = false;
    vi.stubGlobal("AudioContext", MockAudioContext);
  });

  it.each(["pointerup", "touchend", "click"])("unlocks audio on the %s that ends a touch whose press could not start it", async (release) => {
    MockAudioContext.holdResume = true;
    const feedback = new AudioFeedback(() => settings);
    try {
      window.dispatchEvent(new Event("pointerdown"));
      await Promise.resolve();
      expect(MockAudioContext.created).toBe(1);
      expect(MockAudioContext.oscillatorStarts).toBe(0);
      window.dispatchEvent(new Event(release));
      await vi.waitFor(() => expect(MockAudioContext.oscillatorStarts).toBe(1));
      expect(MockAudioContext.last!.state).toBe("running");
    } finally {
      feedback.destroy();
    }
  });

  it.each(["touchend", "click"])("unlocks audio when %s is the first gesture", async (gesture) => {
    const feedback = new AudioFeedback(() => settings);
    try {
      window.dispatchEvent(new Event(gesture));
      await vi.waitFor(() => expect(MockAudioContext.oscillatorStarts).toBe(1));
    } finally {
      feedback.destroy();
    }
  });

  it("creates WebAudio only after an explicit gesture and safely synthesizes events", async () => {
    const feedback = new AudioFeedback(() => settings);
    feedback.event({ event_id: 1, tick: 1, kind: "hit", actor_id: null, target_id: null, amount: 100, detail: "body", blood: 0, direction: 0, action_id: null });
    expect(MockAudioContext.created).toBe(0);
    await feedback.unlock();
    expect(MockAudioContext.created).toBe(1);
    expect(() => feedback.event({ event_id: 2, tick: 1, kind: "knockdown", actor_id: null, target_id: null, amount: 100, detail: "", blood: 0, direction: 0, action_id: null })).not.toThrow();
    feedback.destroy();
  });

  it("cracks the ten-second clapper once per round of the fight phase", async () => {
    const feedback = new AudioFeedback(() => settings);
    await feedback.unlock();
    const before = MockAudioContext.bufferStarts;
    feedback.roundClock("fight", 1, 3500, 30);
    feedback.roundClock("rest", 1, 200, 30);
    expect(MockAudioContext.bufferStarts).toBe(before);
    feedback.roundClock("fight", 1, 299, 30);
    expect(MockAudioContext.bufferStarts).toBe(before + 2);
    feedback.roundClock("fight", 1, 280, 30);
    expect(MockAudioContext.bufferStarts).toBe(before + 2);
    feedback.roundClock("fight", 2, 250, 30);
    expect(MockAudioContext.bufferStarts).toBe(before + 4);
    // The next bout starts at round one again.
    feedback.reset();
    feedback.roundClock("fight", 1, 299, 30);
    expect(MockAudioContext.bufferStarts).toBe(before + 6);
    feedback.destroy();
  });

  it("shares one unlock promise, starts one crowd bed, and retries after resume rejection", async () => {
    const feedback = new AudioFeedback(() => settings);
    MockAudioContext.failResume = true;
    const first = feedback.unlock();
    const concurrent = feedback.unlock();
    expect(concurrent).toBe(first);
    await expect(first).rejects.toThrow("blocked");
    expect(MockAudioContext.created).toBe(1);
    expect(MockAudioContext.oscillatorStarts).toBe(0);
    window.dispatchEvent(new KeyboardEvent("keydown"));
    await vi.waitFor(() => expect(MockAudioContext.oscillatorStarts).toBe(1));
    await feedback.unlock();
    expect(MockAudioContext.oscillatorStarts).toBe(1);
    feedback.destroy();
  });

  it("resumes during activation and ignores deferred decodes after destruction", async () => {
    let releaseDecode = (): void => undefined;
    MockAudioContext.decodeGate = new Promise<void>((resolve) => { releaseDecode = resolve; });
    const feedback = new AudioFeedback(() => settings);
    const unlocking = feedback.unlock();
    await vi.waitFor(() => expect(MockAudioContext.decodeCalls).toBe(6));
    expect(MockAudioContext.operations[0]).toBe("resume");
    expect(MockAudioContext.operations.slice(1)).toEqual(Array.from({ length: 6 }, () => "decode"));
    const context = MockAudioContext.last!;
    feedback.destroy();
    releaseDecode();
    await expect(unlocking).resolves.toBeUndefined();
    expect(context.close).toHaveBeenCalledOnce();
    feedback.injury("decapitation");
    expect(MockAudioContext.bufferStarts).toBe(0);
  });

  it("embeds six distinct bounded PCM16 WAV voices generated with NumPy FM", () => {
    expect(INJURY_SOUNDS.map((sound) => sound.name)).toEqual([
      "decapitation", "dismember_left", "dismember_right",
      "jaw_dislocation", "shoulder_left", "shoulder_right",
    ]);
    expect(new Set(INJURY_SOUNDS.map((sound) => sound.wav)).size).toBe(6);
    let totalBytes = 0;
    for (const sound of INJURY_SOUNDS) {
      const bytes = Uint8Array.from(atob(sound.wav), (character) => character.charCodeAt(0));
      const view = new DataView(bytes.buffer);
      const ascii = (from: number, length: number): string => String.fromCharCode(...bytes.slice(from, from + length));
      expect(ascii(0, 4)).toBe("RIFF");
      expect(ascii(8, 4)).toBe("WAVE");
      expect(view.getUint16(20, true)).toBe(1);
      expect(view.getUint16(22, true)).toBe(1);
      expect(view.getUint32(24, true)).toBe(12_000);
      expect(view.getUint16(34, true)).toBe(16);
      expect(ascii(36, 4)).toBe("data");
      expect(view.getUint32(40, true)).toBe(sound.frames * 2);
      expect(bytes.slice(44).some((sample) => sample !== 0)).toBe(true);
      totalBytes += bytes.byteLength;
    }
    expect(totalBytes).toBeLessThan(100_000);
  });

  it("decodes once after unlock and maps each applied injury to its exact FM voice", async () => {
    const feedback = new AudioFeedback(() => settings);
    await feedback.unlock();
    expect(MockAudioContext.decodeCalls).toBe(6);
    const injuries = [
      "decapitation", "dismember_left", "dismember_right",
      "jaw_dislocation", "shoulder_left", "shoulder_right",
    ] as const;
    for (const [index, injury] of injuries.entries()) {
      feedback.injury(injury);
      const played = MockAudioContext.playedBuffers.at(-1) as unknown as { decodeIndex: number };
      expect(played.decodeIndex).toBe(index);
    }
    await feedback.unlock();
    expect(MockAudioContext.decodeCalls).toBe(6);
    feedback.destroy();
  });

  it("gives a finisher without a voice of its own the nearest one", async () => {
    const feedback = new AudioFeedback(() => settings);
    await feedback.unlock();
    feedback.injury("head_burst");
    const played = MockAudioContext.playedBuffers.at(-1) as unknown as { decodeIndex: number };
    expect(played.decodeIndex).toBe(0);
    feedback.destroy();
  });

  it("suppresses gore voices for accessibility settings and tolerates an undecodable WAV", async () => {
    let blood: "off" | "reduced" | "full" = "full";
    let reducedMotion = false;
    MockAudioContext.failDecode = true;
    const feedback = new AudioFeedback(() => ({ ...settings, blood, reducedMotion }));
    await expect(feedback.unlock()).resolves.toBeUndefined();
    const started = MockAudioContext.bufferStarts;
    feedback.injury("decapitation");
    expect(MockAudioContext.bufferStarts).toBe(started);
    feedback.injury("dismember_left");
    expect(MockAudioContext.bufferStarts).toBe(started + 1);
    blood = "off";
    feedback.injury("dismember_right");
    expect(MockAudioContext.bufferStarts).toBe(started + 1);
    blood = "full";
    reducedMotion = true;
    feedback.injury("jaw_dislocation");
    expect(MockAudioContext.bufferStarts).toBe(started + 1);
    feedback.destroy();
  });

  it("maps only authoritative feedback events to bounded rumble and swallows rejection", async () => {
    const playEffect = vi.fn(async (_type: string, pattern: { duration: number; strongMagnitude: number; weakMagnitude: number }) => {
      expect(pattern.duration).toBeLessThanOrEqual(180);
      expect(pattern.strongMagnitude).toBeLessThanOrEqual(0.65);
      throw new Error("unsupported");
    });
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [{ connected: true, vibrationActuator: { playEffect } }] });
    const haptics = new HapticFeedback(() => settings);
    haptics.event({ event_id: 1, tick: 1, kind: "knockdown", actor_id: null, target_id: null, amount: 1, detail: "", blood: 0, direction: 0, action_id: null });
    haptics.event({ event_id: 2, tick: 1, kind: "bell", actor_id: null, target_id: null, amount: 0, detail: "", blood: 0, direction: 0, action_id: null });
    await Promise.resolve();
    expect(playEffect).toHaveBeenCalledOnce();
  });

  it("swallows synchronous playEffect failures", () => {
    const playEffect = vi.fn(() => { throw new Error("synchronous host failure"); });
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [{ connected: true, vibrationActuator: { playEffect } }] });
    const haptics = new HapticFeedback(() => settings);
    expect(() => haptics.event({ event_id: 1, tick: 1, kind: "hit", actor_id: null, target_id: null, amount: 1, detail: "", blood: 0, direction: 0, action_id: null })).not.toThrow();
    expect(playEffect).toHaveBeenCalledOnce();
  });

  it("vibrates a phone that has no pad to rumble, only with Haptics on and never on a desktop", () => {
    const vibrate = vi.fn((_duration: number) => true);
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [] });
    let coarse = true;
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({ matches: coarse && query === "(pointer: coarse)", media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() }));
    try {
      let haptics = true;
      const feedback = new HapticFeedback(() => ({ ...settings, haptics }));
      const hit = { event_id: 1, tick: 1, kind: "hit", actor_id: null, target_id: null, amount: 1, detail: "", blood: 0, direction: 0, action_id: null };
      feedback.event(hit);
      feedback.event({ ...hit, event_id: 2, kind: "bell" });
      expect(vibrate).toHaveBeenCalledOnce();
      expect(vibrate).toHaveBeenCalledWith(85);
      haptics = false;
      feedback.event({ ...hit, event_id: 3 });
      haptics = true;
      coarse = false;
      feedback.event({ ...hit, event_id: 4 });
      expect(vibrate).toHaveBeenCalledOnce();
    } finally {
      delete (navigator as { vibrate?: unknown }).vibrate;
    }
  });

  it("tolerates absent and throwing gamepad APIs", () => {
    const haptics = new HapticFeedback(() => settings);
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: undefined });
    expect(() => haptics.event({ event_id: 1, tick: 1, kind: "hit", actor_id: null, target_id: null, amount: 1, detail: "", blood: 0, direction: 0, action_id: null })).not.toThrow();
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => { throw new Error("host"); } });
    expect(() => haptics.event({ event_id: 2, tick: 1, kind: "hit", actor_id: null, target_id: null, amount: 1, detail: "", blood: 0, direction: 0, action_id: null })).not.toThrow();
  });
});

describe("the crowd", () => {
  const formants = (): number => MockAudioContext.filters.filter((filter) => (filter.Q as unknown as { value: number }).value === 5).length;
  const crowdEvent = (kind: string, amount = 0, detail = ""): Parameters<AudioFeedback["event"]>[0] => ({ event_id: 1, tick: 1, kind, actor_id: "one", target_id: "two", amount, detail, blood: 0, direction: 0, action_id: null });

  beforeEach(() => {
    MockAudioContext.filters = [];
    MockAudioContext.gains = [];
    MockAudioContext.sourceStarts = [];
    vi.stubGlobal("AudioContext", MockAudioContext);
  });

  it("goes ooh at a big counter but not at every jab, and not twice at once", async () => {
    const feedback = new AudioFeedback(() => settings);
    await feedback.unlock();
    feedback.event(crowdEvent("hit", 30, "jab:head"));
    expect(formants()).toBe(0);
    feedback.event(crowdEvent("counter_hit", 70, "hook:head"));
    expect(formants()).toBe(2);
    feedback.event(crowdEvent("counter_hit", 70, "hook:head"));
    expect(formants()).toBe(2);
    MockAudioContext.last!.currentTime = 3;
    feedback.event(crowdEvent("hit", 95, "uppercut:head"));
    expect(formants()).toBe(4);
    feedback.destroy();
  });

  it("groans and boos at a low blow and boos a headbutt", async () => {
    const feedback = new AudioFeedback(() => settings);
    await feedback.unlock();
    feedback.event(crowdEvent("foul", 0, "low_blow"));
    expect(formants()).toBe(4);
    feedback.event(crowdEvent("foul", 0, "headbutt"));
    expect(formants()).toBe(6);
    feedback.destroy();
  });

  it("claps in rhythm behind a fighter who takes over, and not again straight away", async () => {
    const feedback = new AudioFeedback(() => settings);
    await feedback.unlock();
    const before = MockAudioContext.sourceStarts.length;
    feedback.chant();
    const claps = MockAudioContext.sourceStarts.slice(before);
    expect(claps.length).toBe(8 * 3 + 1);
    const beats = claps.slice(0, 24).map(([when]) => when!);
    expect(beats[3]! - beats[0]!).toBeCloseTo(0.42);
    expect(new Set(claps.slice(0, 3).map(([, offset]) => offset)).size).toBe(3);
    feedback.chant();
    expect(MockAudioContext.sourceStarts.length).toBe(before + claps.length);
    feedback.destroy();
  });

  it("murmurs with the tension and settles when it passes", async () => {
    const feedback = new AudioFeedback(() => settings);
    await feedback.unlock();
    const murmur = MockAudioContext.gains.find((gain) => gain.gain.value === 0 && MockAudioContext.gains.indexOf(gain) > 0)!;
    const target = murmur.gain.setTargetAtTime as unknown as ReturnType<typeof vi.fn>;
    feedback.tension(0.8);
    expect(target).toHaveBeenLastCalledWith(0.8 * 0.05, 0, 0.3);
    feedback.tension(0.81);
    expect(target).toHaveBeenCalledTimes(1);
    feedback.tension(0);
    expect(target).toHaveBeenLastCalledWith(0, 0, 0.8);
    feedback.destroy();
  });

  it("goes quiet through a knockdown count and roars when the fighter gets up", async () => {
    const feedback = new AudioFeedback(() => settings);
    await feedback.unlock();
    const crowd = MockAudioContext.gains.find((gain) => gain.gain.value === 0.022)!;
    const ramp = crowd.gain.exponentialRampToValueAtTime as unknown as ReturnType<typeof vi.fn>;
    feedback.event(crowdEvent("knockdown", 1));
    expect(ramp).toHaveBeenLastCalledWith(0.004, 3);
    feedback.event(crowdEvent("get_up", 6));
    expect((crowd.gain.setValueAtTime as unknown as ReturnType<typeof vi.fn>).mock.lastCall![0]).toBeCloseTo(0.15);
    expect(ramp).toHaveBeenLastCalledWith(0.022, 4.5);
    feedback.destroy();
  });
});

describe("rocked", () => {
  beforeEach(() => {
    MockAudioContext.filters = [];
    MockAudioContext.oscillatorStarts = 0;
    vi.stubGlobal("AudioContext", MockAudioContext);
  });

  it("muffles the arena while the player's fighter is rocked and opens it up again after", async () => {
    const feedback = new AudioFeedback(() => settings);
    await feedback.unlock();
    const muffle = MockAudioContext.filters.find((filter) => filter.type === "lowpass" && (filter.frequency as unknown as { value: number }).value === 20_000)!;
    const target = muffle.frequency.setTargetAtTime as unknown as ReturnType<typeof vi.fn>;
    feedback.rocked(1, 100);
    expect(target.mock.lastCall![0]).toBeCloseTo(650);
    expect(target.mock.lastCall![2]).toBe(0.05);
    feedback.rocked(0, 200);
    expect(target.mock.lastCall![0]).toBeCloseTo(20_000);
    expect(target.mock.lastCall![2]).toBe(0.9);
    feedback.destroy();
  });

  it("pounds a heartbeat that slows as the fighter recovers", async () => {
    const feedback = new AudioFeedback(() => settings);
    await feedback.unlock();
    const beatsOver = (level: number, from: number): number => {
      const before = MockAudioContext.oscillatorStarts;
      for (let tick = from; tick < from + 60; tick += 1) feedback.rocked(level, tick);
      return (MockAudioContext.oscillatorStarts - before) / 2;
    };
    expect(rockedBeatTicks(1)).toBe(14);
    expect(rockedBeatTicks(0.3)).toBe(29);
    expect(beatsOver(1, 1000)).toBe(5);
    expect(beatsOver(0.3, 2000)).toBe(3);
    expect(beatsOver(0.1, 3000)).toBe(0);
    feedback.destroy();
  });

  it("beats again in a rematch, whose clock starts over at zero", async () => {
    const feedback = new AudioFeedback(() => settings);
    await feedback.unlock();
    const beatsOver = (from: number): number => {
      const before = MockAudioContext.oscillatorStarts;
      for (let tick = from; tick < from + 60; tick += 1) feedback.rocked(1, tick);
      return (MockAudioContext.oscillatorStarts - before) / 2;
    };
    expect(beatsOver(15_000)).toBe(5);
    expect(beatsOver(400)).toBe(5);
    feedback.destroy();
  });

  it("opens the arena up again when the bout ends, even without a last snapshot", async () => {
    const feedback = new AudioFeedback(() => settings);
    await feedback.unlock();
    const muffle = MockAudioContext.filters.find((filter) => filter.type === "lowpass" && (filter.frequency as unknown as { value: number }).value === 20_000)!;
    const target = muffle.frequency.setTargetAtTime as unknown as ReturnType<typeof vi.fn>;
    feedback.rocked(1, 100);
    feedback.result({ version: 3, type: "final", match_id: "m", winner_id: "two", method: "forfeit", round: 1, scorecards: [], ratings: {} });
    expect(target.mock.lastCall![0]).toBeCloseTo(20_000);
    feedback.destroy();
  });
});

describe("a punch the guard took", () => {
  const SIMULATION = { tick_rate: 30, ring_half_width: 500, ring_half_height: 500 };
  const renderer = FightRenderer.prototype as unknown as {
    fireContacts(this: unknown, sampledTick: number): void;
    push(this: unknown, snapshot: EngineSnapshot): void;
    recordedHit(this: unknown, knockdown: CombatEvent): CombatEvent | null;
  };
  // The engine reports the defender's block, then the hit that leaked through it, under the punch's action id.
  const block: CombatEvent = { event_id: 11, tick: 40, kind: "block", actor_id: "two", target_id: "one", amount: 30, detail: "", blood: 0, direction: 0, action_id: "one:7" };
  const leaked: CombatEvent = { event_id: 12, tick: 40, kind: "counter_hit", actor_id: "one", target_id: "two", amount: 60, detail: "uppercut:head", blood: 12, direction: 1, action_id: "one:7" };
  const clean: CombatEvent = { ...leaked, event_id: 21, amount: 120, blood: 30, action_id: "one:8" };

  beforeEach(() => {
    MockAudioContext.filters = [];
    MockAudioContext.gains = [];
    vi.stubGlobal("AudioContext", MockAudioContext);
  });

  it("is heard and felt as the block, not as a punch that landed", async () => {
    const audio = new AudioFeedback(() => settings);
    await audio.unlock();
    const rumbles: number[] = [];
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [{ connected: true, vibrationActuator: { playEffect: async (_type: string, pattern: { duration: number }) => { rumbles.push(pattern.duration); } } }] });
    const haptics = new HapticFeedback(() => settings);
    const sounds = Object.fromEntries((["impact", "crowdSwell", "ooh"] as const).map((name) => [name, vi.spyOn(AudioFeedback.prototype as unknown as Record<typeof name, () => void>, name)]));
    // Through the renderer's real presentation, as push() queues contacts and the clock reaches them.
    const present = (events: CombatEvent[]): string[] => {
      const frame = snapshot(40);
      const heard: string[] = [];
      const stub = Object.assign(Object.create(FightRenderer.prototype) as Record<string, unknown>, {
        pendingContacts: contactPresentationPlan(events, frame).map((entry) => ({ ...entry, contactTick: 40, ...contactParticipants(entry.event, frame), injury: null })),
        buffer: { latest: () => frame }, presentFightEvent: vi.fn(), mapping: worldMapping(SIMULATION), contactPoint: new THREE.Vector3(), mouthPoint: new THREE.Vector3(),
        effects: { addEvent: vi.fn(), spawnTeeth: vi.fn() }, settings: () => ({ reducedMotion: false, blood: "full" }), arena: { excite: vi.fn() }, viewerId: null,
        arcadeInjuries: [null, null], graphs: null, headWorldPose: () => null, knockOutMouthpiece: vi.fn(), viewerHitFlash: 0,
        onContact: (event: CombatEvent) => {
          heard.push(event.kind);
          audio.event(event);
          haptics.event(event);
        },
      });
      renderer.fireContacts.call(stub, 40);
      return heard;
    };
    expect(present([block, leaked])).toEqual(["block"]);
    for (const spy of Object.values(sounds)) expect(spy).not.toHaveBeenCalled();
    expect(rumbles).toEqual([55]);
    // The same counter landing clean is a punch, a swell and an ooh, and the counter's rumble.
    expect(present([clean])).toEqual(["counter_hit"]);
    for (const spy of Object.values(sounds)) expect(spy).toHaveBeenCalledOnce();
    expect(rumbles).toEqual([55, 105]);
    audio.destroy();
  });

  it("earns no finisher for the knockdown it causes, though the replay still shows it", () => {
    const knockdown: CombatEvent = { event_id: 13, tick: 40, kind: "knockdown", actor_id: "one", target_id: "two", amount: 1, detail: "", blood: 0, direction: 0, action_id: null };
    const pushed = (events: CombatEvent[]): { hit: CombatEvent | null; finisher: string | null } => {
      const stub: Record<string, unknown> = {
        buffer: new SnapshotBuffer(64, 30), dedupe: new EventDeduplicator(), history: [], roundStats: new RoundStatsTracker(), referee: null, graphs: null,
        acknowledgeActions: vi.fn(), mapping: worldMapping(SIMULATION), contactPoint: new THREE.Vector3(), pendingContacts: [], effects: { addEvent: vi.fn() },
        manualClock: true, lastManualTime: 0, lastKnockdown: null, recordedHit: renderer.recordedHit, settings: () => ({ reducedMotion: false, blood: "full" }),
        commentary: { observe: vi.fn() }, simulation: SIMULATION, players: {}, frameSeconds: 0,
      };
      const floored = { ...snapshot(40), phase: "knockdown" as const, fighters: [{ ...fighter("one", -100), action_key: "uppercut:right:head:power" }, { ...fighter("two", 100), is_downed: true }] as const, events };
      renderer.push.call(stub, floored);
      return stub.lastKnockdown as { hit: CombatEvent | null; finisher: string | null };
    };
    expect(pushed([clean, { ...knockdown, event_id: 22 }]).finisher).not.toBeNull();
    const blocked = pushed([block, leaked, knockdown]);
    expect(blocked.finisher).toBeNull();
    expect(blocked.hit).toEqual(leaked);
  });
});
