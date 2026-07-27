import type { Settings } from "./settings";
import type { CombatEvent, FinalMessage, PunchClass } from "./types";

interface NoiseSpec {
  readonly duration: number;
  readonly frequency: number;
  readonly gain: number;
  readonly type?: BiquadFilterType;
  readonly q?: number;
  readonly sweepTo?: number;
}

interface ToneSpec {
  readonly from: number;
  readonly to?: number;
  readonly duration: number;
  readonly type: OscillatorType;
  readonly gain: number;
  readonly delay?: number;
}

const WHOOSH: Record<PunchClass, { from: number; to: number; duration: number }> = {
  jab: { from: 520, to: 1500, duration: 0.09 },
  straight: { from: 420, to: 1150, duration: 0.12 },
  hook: { from: 300, to: 880, duration: 0.14 },
  uppercut: { from: 240, to: 820, duration: 0.15 },
};

export class AudioFeedback {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private crowdGain: GainNode | null = null;
  private unlocked = false;
  private unlockPromise: Promise<void> | null = null;
  private crowdStarted = false;
  private destroyed = false;
  private readonly timers = new Set<number>();
  private lastBreathTick = -300;
  private lastHeartbeatTick = -300;

  private readonly unlockListener = (): void => {
    void this.unlock().catch(() => undefined);
  };

  private readonly visibility = (): void => {
    const context = this.context;
    if (context === null) return;
    const operation = document.hidden ? context.suspend() : this.unlocked ? context.resume() : null;
    if (operation !== null) void operation.catch(() => undefined);
  };

  constructor(private readonly settings: () => Settings) {
    window.addEventListener("pointerdown", this.unlockListener);
    window.addEventListener("keydown", this.unlockListener);
    document.addEventListener("visibilitychange", this.visibility);
  }

  unlock(): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    if (this.unlocked) return Promise.resolve();
    if (this.unlockPromise !== null) return this.unlockPromise;
    this.unlockPromise = this.performUnlock().finally(() => {
      this.unlockPromise = null;
    });
    return this.unlockPromise;
  }

  private async performUnlock(): Promise<void> {
    if (this.context === null) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = Math.min(0.8, Math.max(0, this.settings().volume));
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended") await this.context.resume();
    if (this.destroyed) return;
    this.unlocked = true;
    window.removeEventListener("pointerdown", this.unlockListener);
    window.removeEventListener("keydown", this.unlockListener);
    if (!this.crowdStarted) {
      this.crowdStarted = true;
      this.crowdBed();
    }
  }

  setVolume(): void {
    if (this.master !== null) this.master.gain.value = Math.min(0.8, Math.max(0, this.settings().volume));
  }

  event(event: CombatEvent): void {
    if (!this.unlocked) return;
    switch (event.kind) {
      case "punch_start": {
        const punchClass = (event.detail.split(":")[1] ?? "jab") as PunchClass;
        const spec = WHOOSH[punchClass] ?? WHOOSH.jab;
        this.noise({ duration: spec.duration, frequency: spec.from, sweepTo: spec.to, gain: 0.1, type: "bandpass", q: 1.2 });
        break;
      }
      case "whiff":
        this.noise({ duration: 0.11, frequency: 850, sweepTo: 320, gain: 0.07, type: "bandpass", q: 1.1 });
        break;
      case "hit":
      case "counter_hit": {
        const body = event.detail.endsWith("body");
        const loud = Math.min(0.34, 0.16 + event.amount / 1400) * (event.kind === "counter_hit" ? 1.3 : 1);
        this.tone({ from: body ? 120 : 150, to: 42, duration: 0.13, type: "sine", gain: loud });
        this.noise({ duration: 0.06, frequency: body ? 420 : 1650, gain: loud * 0.85, type: "bandpass", q: 0.9 });
        this.noise({ duration: 0.16, frequency: body ? 190 : 300, gain: loud * 0.6 });
        if (event.kind === "counter_hit") this.crowdSwell(0.5);
        break;
      }
      case "block":
        this.noise({ duration: 0.05, frequency: 900, gain: 0.15, type: "bandpass", q: 1.4 });
        this.tone({ from: 170, to: 120, duration: 0.05, type: "triangle", gain: 0.06 });
        break;
      case "perfect_block":
        this.noise({ duration: 0.05, frequency: 1450, gain: 0.16, type: "bandpass", q: 1.6 });
        this.tone({ from: 260, to: 200, duration: 0.06, type: "triangle", gain: 0.07 });
        break;
      case "guard_break":
        this.noise({ duration: 0.18, frequency: 520, gain: 0.24 });
        this.tone({ from: 230, to: 78, duration: 0.2, type: "sawtooth", gain: 0.1 });
        this.crowdSwell(0.4);
        break;
      case "stun":
        this.tone({ from: 96, to: 74, duration: 0.22, type: "sine", gain: 0.1 });
        break;
      case "knockdown":
        this.tone({ from: 68, to: 32, duration: 0.34, type: "sine", gain: 0.3 });
        this.noise({ duration: 0.22, frequency: 260, gain: 0.26 });
        this.crowdSwell(1);
        break;
      case "bell": {
        const strikes = event.detail === "round_start" ? 3 : 1;
        for (let i = 0; i < strikes; i += 1) this.bellStrike(i * 0.34);
        break;
      }
      case "count":
        this.tone({ from: 300 + event.amount * 42, duration: 0.1, type: "square", gain: 0.06 });
        break;
      case "get_up":
        this.tone({ from: 420, to: 840, duration: 0.16, type: "triangle", gain: 0.1 });
        break;
      case "foul":
      case "referee_break":
        this.whistle();
        break;
      case "clinch":
      case "clinch_start":
        this.noise({ duration: 0.12, frequency: 190, gain: 0.1 });
        break;
      case "bleed":
        break;
      case "exhausted":
        this.noise({ duration: 0.24, frequency: 360, gain: 0.05 });
        break;
      case "result":
        this.crowdSwell(0.8);
        break;
      default:
        break;
    }
  }

  snapshot(tick: number, stamina: number, maximumStamina: number, trauma: number): void {
    if (!this.unlocked) return;
    const fatigue = 1 - stamina / Math.max(1, maximumStamina);
    if (fatigue > 0.55 && tick - this.lastBreathTick >= 75) {
      this.lastBreathTick = tick;
      this.noise({ duration: 0.18, frequency: 420, gain: 0.045 + fatigue * 0.04 });
    }
    if ((fatigue > 0.72 || trauma > 500) && tick - this.lastHeartbeatTick >= 24) {
      this.lastHeartbeatTick = tick;
      this.tone({ from: 52, duration: 0.09, type: "sine", gain: 0.055 });
    }
  }

  result(final: FinalMessage): void {
    if (!this.unlocked) return;
    this.crowdSwell(1);
    this.tone({ from: final.winner_id === null ? 280 : 520, duration: 0.45, type: "triangle", gain: 0.18 });
    const timer = window.setTimeout(() => {
      this.timers.delete(timer);
      this.tone({ from: 650, duration: 0.5, type: "triangle", gain: 0.14 });
    }, 160);
    this.timers.add(timer);
  }

  private tone(spec: ToneSpec): void {
    const context = this.context;
    const master = this.master;
    if (context === null || master === null) return;
    const start = context.currentTime + (spec.delay ?? 0);
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = spec.type;
    oscillator.frequency.setValueAtTime(Math.max(20, spec.from), start);
    if (spec.to !== undefined && spec.to !== spec.from) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, spec.to), start + Math.min(1.4, spec.duration));
    }
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(Math.min(0.35, spec.gain), start + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + Math.min(1.4, spec.duration));
    oscillator.connect(envelope).connect(master);
    oscillator.start(start);
    oscillator.stop(start + Math.min(1.4, spec.duration) + 0.03);
  }

  private noise(spec: NoiseSpec): void {
    const context = this.context;
    const master = this.master;
    if (context === null || master === null) return;
    if (this.noiseBuffer === null) {
      const length = Math.floor(context.sampleRate * 1.2);
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const data = buffer.getChannelData(0);
      let seed = 987_654_321;
      let last = 0;
      for (let index = 0; index < data.length; index += 1) {
        seed = (seed * 16_807) % 2_147_483_647;
        const white = seed / 1_073_741_824 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[index] = white * 0.55 + last * 3.2;
      }
      this.noiseBuffer = buffer;
    }
    const start = context.currentTime;
    const duration = Math.min(0.5, spec.duration);
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    filter.type = spec.type ?? "lowpass";
    filter.frequency.setValueAtTime(Math.max(60, Math.min(4000, spec.frequency)), start);
    if (spec.sweepTo !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(60, Math.min(4000, spec.sweepTo)), start + duration);
    }
    filter.Q.value = spec.q ?? 0.7;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(Math.min(0.35, spec.gain), start + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(envelope).connect(master);
    source.start();
    source.stop(start + duration + 0.02);
  }

  private bellStrike(delay: number): void {
    for (const [partial, gain] of [[742, 0.16], [1113, 0.1], [1486, 0.06]] as const) {
      this.tone({ from: partial, to: partial * 0.985, duration: 1.05, type: "sine", gain, delay });
    }
  }

  private whistle(): void {
    this.tone({ from: 2050, to: 2350, duration: 0.09, type: "square", gain: 0.05 });
    this.tone({ from: 2350, to: 2050, duration: 0.16, type: "square", gain: 0.05, delay: 0.1 });
    this.noise({ duration: 0.2, frequency: 2300, gain: 0.05, type: "bandpass", q: 3 });
  }

  private crowdSwell(intensity: number): void {
    const context = this.context;
    if (context === null) return;
    this.noise({ duration: 0.5, frequency: 700, sweepTo: 420, gain: Math.min(0.2, 0.07 + intensity * 0.13), type: "bandpass", q: 0.6 });
    const crowd = this.crowdGain;
    if (crowd !== null) {
      const now = context.currentTime;
      crowd.gain.setValueAtTime(Math.min(0.09, 0.03 + intensity * 0.05), now);
      crowd.gain.exponentialRampToValueAtTime(0.022, now + 1.4);
    }
  }

  private crowdBed(): void {
    const context = this.context;
    const master = this.master;
    if (context === null || master === null) return;
    const length = Math.floor(context.sampleRate * 3);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 123_456_789;
    let last = 0;
    for (let index = 0; index < data.length; index += 1) {
      seed = (seed * 16_807) % 2_147_483_647;
      const white = seed / 1_073_741_824 - 1;
      last = (last + 0.045 * white) / 1.045;
      data[index] = last * 4.5;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 480;
    filter.Q.value = 0.45;
    const gain = context.createGain();
    gain.gain.value = 0.022;
    this.crowdGain = gain;
    const lfo = context.createOscillator();
    const lfoGain = context.createGain();
    lfo.frequency.value = 0.09;
    lfoGain.gain.value = 0.007;
    lfo.connect(lfoGain).connect(gain.gain);
    source.connect(filter).connect(gain).connect(master);
    source.start();
    lfo.start();
  }

  destroy(): void {
    this.destroyed = true;
    window.removeEventListener("pointerdown", this.unlockListener);
    window.removeEventListener("keydown", this.unlockListener);
    document.removeEventListener("visibilitychange", this.visibility);
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    const context = this.context;
    this.context = null;
    this.master = null;
    this.noiseBuffer = null;
    this.crowdGain = null;
    this.unlocked = false;
    if (context !== null) void context.close().catch(() => undefined);
  }
}
