import { AudioFeedback } from "./audio";
import { HapticFeedback } from "./haptics";

const settings = { volume: 1, haptics: true, reducedMotion: false, blood: "full" as const };
const audioParam = (): AudioParam => ({ value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } as unknown as AudioParam);
class MockAudioContext {
  static created = 0;
  static failResume = false;
  static oscillatorStarts = 0;
  state: AudioContextState = "suspended";
  currentTime = 0;
  sampleRate = 8000;
  destination = {};
  resume = vi.fn(async () => {
    if (MockAudioContext.failResume) { MockAudioContext.failResume = false; throw new Error("blocked"); }
    this.state = "running";
  });
  suspend = vi.fn(async () => { this.state = "suspended"; });
  close = vi.fn(async () => {});
  constructor() { MockAudioContext.created += 1; }
  createGain(): GainNode { return { gain: audioParam(), connect: vi.fn((target) => target) } as unknown as GainNode; }
  createOscillator(): OscillatorNode { return { type: "sine", frequency: audioParam(), connect: vi.fn((target) => target), start: vi.fn(() => { MockAudioContext.oscillatorStarts += 1; }), stop: vi.fn() } as unknown as OscillatorNode; }
  createBiquadFilter(): BiquadFilterNode { return { type: "lowpass", frequency: audioParam(), Q: audioParam(), connect: vi.fn((target) => target) } as unknown as BiquadFilterNode; }
  createBuffer(_channels: number, length: number): AudioBuffer { return { getChannelData: () => new Float32Array(length) } as unknown as AudioBuffer; }
  createBufferSource(): AudioBufferSourceNode { return { buffer: null, loop: false, connect: vi.fn((target) => target), start: vi.fn(), stop: vi.fn() } as unknown as AudioBufferSourceNode; }
}

describe("authoritative audio and haptics", () => {
  beforeEach(() => {
    MockAudioContext.created = 0;
    MockAudioContext.failResume = false;
    MockAudioContext.oscillatorStarts = 0;
    vi.stubGlobal("AudioContext", MockAudioContext);
  });

  it("creates WebAudio only after an explicit gesture and safely synthesizes events", async () => {
    const feedback = new AudioFeedback(() => settings);
    feedback.event({ event_id: 1, tick: 1, kind: "hit", actor_id: null, target_id: null, amount: 100, detail: "body", blood: 0, direction: 0 });
    expect(MockAudioContext.created).toBe(0);
    await feedback.unlock();
    expect(MockAudioContext.created).toBe(1);
    expect(() => feedback.event({ event_id: 2, tick: 1, kind: "knockdown", actor_id: null, target_id: null, amount: 100, detail: "", blood: 0, direction: 0 })).not.toThrow();
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

  it("maps only authoritative feedback events to bounded rumble and swallows rejection", async () => {
    const playEffect = vi.fn(async (_type: string, pattern: { duration: number; strongMagnitude: number; weakMagnitude: number }) => {
      expect(pattern.duration).toBeLessThanOrEqual(180);
      expect(pattern.strongMagnitude).toBeLessThanOrEqual(0.65);
      throw new Error("unsupported");
    });
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [{ connected: true, vibrationActuator: { playEffect } }] });
    const haptics = new HapticFeedback(() => settings);
    haptics.event({ event_id: 1, tick: 1, kind: "knockdown", actor_id: null, target_id: null, amount: 1, detail: "", blood: 0, direction: 0 });
    haptics.event({ event_id: 2, tick: 1, kind: "bell", actor_id: null, target_id: null, amount: 0, detail: "", blood: 0, direction: 0 });
    await Promise.resolve();
    expect(playEffect).toHaveBeenCalledOnce();
  });

  it("swallows synchronous playEffect failures", () => {
    const playEffect = vi.fn(() => { throw new Error("synchronous host failure"); });
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [{ connected: true, vibrationActuator: { playEffect } }] });
    const haptics = new HapticFeedback(() => settings);
    expect(() => haptics.event({ event_id: 1, tick: 1, kind: "hit", actor_id: null, target_id: null, amount: 1, detail: "", blood: 0, direction: 0 })).not.toThrow();
    expect(playEffect).toHaveBeenCalledOnce();
  });

  it("tolerates absent and throwing gamepad APIs", () => {
    const haptics = new HapticFeedback(() => settings);
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: undefined });
    expect(() => haptics.event({ event_id: 1, tick: 1, kind: "hit", actor_id: null, target_id: null, amount: 1, detail: "", blood: 0, direction: 0 })).not.toThrow();
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => { throw new Error("host"); } });
    expect(() => haptics.event({ event_id: 2, tick: 1, kind: "hit", actor_id: null, target_id: null, amount: 1, detail: "", blood: 0, direction: 0 })).not.toThrow();
  });
});
