import { INJURY_SOUNDS } from "./assets/injury-sounds";
import type { ArcadeInjury } from "./render/renderer";

/** Finishers without a voice of their own borrow the nearest one. */
const BORROWED_VOICE: Partial<Readonly<Record<ArcadeInjury, ArcadeInjury>>> = { head_burst: "decapitation", eye_left: "jaw_dislocation", eye_right: "jaw_dislocation", ribs_left: "shoulder_left", ribs_right: "shoulder_right" };
import type { Settings } from "./settings";
import type { CombatEvent, FinalMessage, PunchClass } from "./types";

interface NoiseSpec {
  readonly duration: number;
  readonly frequency: number;
  readonly gain: number;
  readonly type?: BiquadFilterType;
  readonly q?: number;
  readonly sweepTo?: number;
  readonly delay?: number;
  /** Seconds into the noise loop to start from, so layered bursts do not line up. */
  readonly offset?: number;
}

/** Many voices on one vowel: noise through two formant filters gliding between the given centres. */
interface CrowdVoiceSpec {
  readonly duration: number;
  readonly first: readonly [number, number];
  readonly second: readonly [number, number];
  readonly gain: number;
  readonly delay?: number;
}

/** The crowd's "ooh" after a big shot lands: the vowel opens and falls away. */
const OOH: CrowdVoiceSpec = { duration: 1.1, first: [330, 420], second: [760, 880], gain: 0.16 };
/** The groan at a low blow, sliding down. */
const GROAN: CrowdVoiceSpec = { duration: 1.2, first: [520, 360], second: [980, 720], gain: 0.13 };
const BOO: CrowdVoiceSpec = { duration: 1.3, first: [300, 280], second: [640, 600], gain: 0.11, delay: 0.75 };
const OOH_COOLDOWN_SECONDS = 2.5;
const CHANT_COOLDOWN_SECONDS = 20;
/** Murmur level at full tension. */
const MURMUR_GAIN = 0.05;
/** The master bus is open to here, and muffled down to here when the player's fighter is badly rocked. */
const MUFFLE_OPEN = 20_000;
const MUFFLE_CLOSED = 650;

interface ToneSpec {
  readonly from: number;
  readonly to?: number;
  readonly duration: number;
  readonly type: OscillatorType;
  readonly gain: number;
  readonly delay?: number;
}

/** Gestures that may unlock audio. A touch pointerdown is not a user activation; the pointerup, touchend and click after it are. */
const UNLOCK_EVENTS = ["pointerdown", "pointerup", "touchend", "click", "keydown"] as const;

const WHOOSH: Record<PunchClass, { from: number; to: number; duration: number }> = {
  jab: { from: 520, to: 1500, duration: 0.09 },
  straight: { from: 420, to: 1150, duration: 0.12 },
  hook: { from: 300, to: 880, duration: 0.14 },
  uppercut: { from: 240, to: 820, duration: 0.15 },
};

/** Ticks between heartbeats while rocked: racing at first, slowing as the fighter recovers. */
export function rockedBeatTicks(level: number): number {
  return Math.round(14 + (1 - Math.max(0, Math.min(1, level))) * 22);
}

export class AudioFeedback {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private injuryBuffers: ReadonlyMap<ArcadeInjury, AudioBuffer> = new Map();
  private crowdGain: GainNode | null = null;
  private unlocked = false;
  private unlockPromise: Promise<void> | null = null;
  private crowdStarted = false;
  private destroyed = false;
  private readonly timers = new Set<number>();
  private lastBreathTick = -300;
  private lastHeartbeatTick = -300;
  private clapperRound = 0;
  private murmurGain: GainNode | null = null;
  private murmurLevel = 0;
  private lastOohAt = -Infinity;
  private lastChantAt = -Infinity;
  private muffle: BiquadFilterNode | null = null;
  private rockedLevel = 0;
  private lastRockedBeat = -300;
  private lastTick = -1;

  private readonly unlockListener = (): void => {
    // Every gesture resumes the context itself until audio is unlocked: a resume() made during a
    // touch press, which is not an activation, can stay pending, and the unlock waits on it.
    const context = this.context;
    if (context !== null && context.state !== "running") void context.resume().catch(() => undefined);
    void this.unlock().catch(() => undefined);
  };

  private readonly visibility = (): void => {
    const context = this.context;
    if (context === null) return;
    const operation = document.hidden ? context.suspend() : this.unlocked ? context.resume() : null;
    if (operation !== null) void operation.catch(() => undefined);
  };

  constructor(private readonly settings: () => Settings) {
    for (const type of UNLOCK_EVENTS) window.addEventListener(type, this.unlockListener);
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
    let context = this.context;
    if (context === null) {
      context = new AudioContext();
      const master = context.createGain();
      master.gain.value = Math.min(0.8, Math.max(0, this.settings().volume));
      const muffle = context.createBiquadFilter();
      muffle.type = "lowpass";
      muffle.frequency.value = MUFFLE_OPEN;
      muffle.Q.value = 0.7;
      master.connect(muffle).connect(context.destination);
      this.context = context;
      this.master = master;
      this.muffle = muffle;
    }
    if (context.state === "suspended") await context.resume();
    if (this.destroyed || this.context !== context) return;
    const injuryBuffers = await this.decodeInjuryBuffers(context);
    if (this.destroyed || this.context !== context) return;
    this.injuryBuffers = injuryBuffers;
    this.unlocked = true;
    for (const type of UNLOCK_EVENTS) window.removeEventListener(type, this.unlockListener);
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
        const weight = Math.min(1, event.amount / 260);
        const loud = Math.min(0.36, 0.14 + weight * 0.2) * (event.kind === "counter_hit" ? 1.25 : 1);
        this.impact(loud, body, weight);
        if (event.kind === "counter_hit" || weight > 0.7) this.crowdSwell(0.35 + weight * 0.4);
        if ((event.kind === "counter_hit" && event.amount >= 50) || event.amount >= 90) this.ooh(Math.min(1, event.amount / 160));
        break;
      }
      case "block":
        this.noise({ duration: 0.045, frequency: 1200, sweepTo: 600, gain: 0.14, type: "bandpass", q: 1.1 });
        this.noise({ duration: 0.09, frequency: 260, gain: 0.08 });
        this.tone({ from: 160, to: 110, duration: 0.06, type: "triangle", gain: 0.05 });
        break;
      case "perfect_block":
        this.noise({ duration: 0.05, frequency: 1800, sweepTo: 900, gain: 0.16, type: "bandpass", q: 1.6 });
        this.tone({ from: 280, to: 210, duration: 0.06, type: "triangle", gain: 0.06 });
        break;
      case "guard_break":
        this.impact(0.3, false, 0.9);
        this.tone({ from: 230, to: 78, duration: 0.2, type: "sawtooth", gain: 0.08 });
        this.crowdSwell(0.5);
        this.ooh(0.6);
        break;
      case "stun":
        this.tone({ from: 96, to: 74, duration: 0.22, type: "sine", gain: 0.1 });
        this.crowdSwell(0.3);
        break;
      case "parry":
        this.noise({ duration: 0.06, frequency: 2400, sweepTo: 1100, gain: 0.18, type: "bandpass", q: 1.8 });
        this.tone({ from: 330, to: 180, duration: 0.09, type: "triangle", gain: 0.07 });
        this.crowdSwell(0.35);
        break;
      case "body_collapse":
        this.tone({ from: 118, to: 52, duration: 0.42, type: "sine", gain: 0.16 });
        this.noise({ duration: 0.26, frequency: 420, sweepTo: 180, gain: 0.05, type: "bandpass", q: 0.9 });
        this.crowdSwell(0.6);
        break;
      case "eye_shut":
        this.crowdSwell(0.25);
        break;
      case "corner":
        this.noise({ duration: 0.22, frequency: 2600, sweepTo: 1500, gain: 0.05, type: "bandpass", q: 0.8 });
        break;
      case "knockdown":
        this.impact(0.34, false, 1);
        this.tone({ from: 60, to: 28, duration: 0.42, type: "sine", gain: 0.3 });
        this.noise({ duration: 0.3, frequency: 140, gain: 0.24 });
        this.crowdRoar(1);
        this.hush();
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
        this.crowdRoar(0.9);
        break;
      case "foul":
        this.whistle();
        if (event.detail === "low_blow") this.crowdVoice(GROAN);
        this.crowdVoice(BOO);
        break;
      case "referee_break":
        this.whistle();
        break;
      case "clinch":
      case "clinch_start":
        this.noise({ duration: 0.12, frequency: 190, gain: 0.1 });
        break;
      case "taunt":
        this.tone({ from: 520, to: 390, duration: 0.18, type: "triangle", gain: 0.05 });
        this.crowdSwell(0.45);
        break;
      case "clinch_denied":
      case "clinch_interrupted":
        this.noise({ duration: 0.1, frequency: 520, sweepTo: 240, gain: 0.05, type: "bandpass", q: 1 });
        break;
      case "bleed":
        break;
      case "exhausted":
        this.noise({ duration: 0.24, frequency: 360, gain: 0.05 });
        break;
      case "result":
        this.crowdRoar(0.8);
        break;
      default:
        break;
    }
  }

  /**
   * A new bout starts its clock at zero again: the heartbeats, the breathing and the clapper start over,
   * and the world is no longer muffled.
   */
  reset(): void {
    this.lastBreathTick = -300;
    this.lastHeartbeatTick = -300;
    this.lastRockedBeat = -300;
    this.clapperRound = 0;
    this.lastTick = -1;
    this.openMuffle();
  }

  private openMuffle(): void {
    if (this.rockedLevel === 0) return;
    this.rockedLevel = 0;
    const context = this.context;
    if (context !== null && this.muffle !== null) this.muffle.frequency.setTargetAtTime(MUFFLE_OPEN, context.currentTime, 0.9);
  }

  /** A tick earlier than the last one heard is a new bout's clock: the old bout's timers would silence it. */
  private follow(tick: number): void {
    if (tick < this.lastTick) this.reset();
    this.lastTick = tick;
  }

  /** The ten-second clapper: two wood-block cracks once per round when ten seconds remain. */
  roundClock(phase: string, roundNumber: number, ticksRemaining: number, tickRate: number): void {
    if (phase !== "fight" || ticksRemaining > 10 * tickRate || this.clapperRound === roundNumber) return;
    this.clapperRound = roundNumber;
    if (!this.unlocked) return;
    this.noise({ duration: 0.05, frequency: 2600, gain: 0.42, type: "bandpass", q: 1.4 });
    this.noise({ duration: 0.09, frequency: 700, gain: 0.18, type: "bandpass", q: 0.8 });
    const timer = window.setTimeout(() => {
      this.timers.delete(timer);
      this.noise({ duration: 0.05, frequency: 2400, gain: 0.4, type: "bandpass", q: 1.4 });
      this.noise({ duration: 0.09, frequency: 660, gain: 0.16, type: "bandpass", q: 0.8 });
    }, 120);
    this.timers.add(timer);
  }

  /** The crowd takes up a rhythmic clap behind a fighter who has taken over. */
  chant(): void {
    const context = this.context;
    if (!this.unlocked || context === null || context.currentTime - this.lastChantAt < CHANT_COOLDOWN_SECONDS) return;
    this.lastChantAt = context.currentTime;
    for (let beat = 0; beat < 8; beat += 1) {
      const swell = 0.5 + beat / 14;
      for (let layer = 0; layer < 3; layer += 1) {
        this.noise({ duration: 0.045, frequency: 1500 + layer * 450, gain: 0.07 * swell, type: "bandpass", q: 1.1, delay: beat * 0.42 + layer * 0.013, offset: (beat * 3 + layer) * 0.131 });
      }
    }
    this.crowdVoice({ duration: 1.4, first: [380, 460], second: [820, 940], gain: 0.08, delay: 3.2 });
  }

  /** The murmur under the crowd: 0 calm, 1 with a fighter in trouble or a count running. */
  tension(level: number): void {
    const context = this.context;
    const murmur = this.murmurGain;
    const target = Math.max(0, Math.min(1, level));
    if (context === null || murmur === null || Math.abs(target - this.murmurLevel) < 0.02) return;
    const rising = target > this.murmurLevel;
    this.murmurLevel = target;
    murmur.gain.setTargetAtTime(target * MURMUR_GAIN, context.currentTime, rising ? 0.3 : 0.8);
  }

  /** The player's own fighter is rocked: the world goes muffled and the heartbeat pounds, slowing as the head clears. */
  rocked(level: number, tick: number): void {
    this.follow(tick);
    const context = this.context;
    const muffle = this.muffle;
    if (!this.unlocked || context === null || muffle === null) return;
    const target = Math.max(0, Math.min(1, level));
    if (Math.abs(target - this.rockedLevel) >= 0.02 || (target === 0 && this.rockedLevel !== 0)) {
      const rising = target > this.rockedLevel;
      this.rockedLevel = target;
      muffle.frequency.setTargetAtTime(MUFFLE_OPEN * Math.pow(MUFFLE_CLOSED / MUFFLE_OPEN, target), context.currentTime, rising ? 0.05 : 0.9);
    }
    if (target > 0.15 && tick - this.lastRockedBeat >= rockedBeatTicks(target)) {
      this.lastRockedBeat = tick;
      this.tone({ from: 58, to: 40, duration: 0.12, type: "sine", gain: 0.09 + target * 0.08 });
      this.tone({ from: 50, to: 36, duration: 0.14, type: "sine", gain: 0.07 + target * 0.06, delay: 0.16 });
    }
  }

  snapshot(tick: number, stamina: number, maximumStamina: number, trauma: number): void {
    this.follow(tick);
    if (!this.unlocked) return;
    const fatigue = 1 - stamina / Math.max(1, maximumStamina);
    if (fatigue > 0.55 && tick - this.lastBreathTick >= 75) {
      this.lastBreathTick = tick;
      this.noise({ duration: 0.18, frequency: 420, gain: 0.045 + fatigue * 0.04 });
    }
    if ((fatigue > 0.72 || trauma > 500) && this.rockedLevel <= 0.15 && tick - this.lastHeartbeatTick >= 24) {
      this.lastHeartbeatTick = tick;
      this.tone({ from: 52, duration: 0.09, type: "sine", gain: 0.055 });
    }
  }

  result(final: FinalMessage): void {
    // The bout is over, however it ended (a forfeit sends no last snapshot to clear it).
    this.openMuffle();
    if (!this.unlocked) return;
    this.crowdSwell(1);
    this.tone({ from: final.winner_id === null ? 280 : 520, duration: 0.45, type: "triangle", gain: 0.18 });
    const timer = window.setTimeout(() => {
      this.timers.delete(timer);
      this.tone({ from: 650, duration: 0.5, type: "triangle", gain: 0.14 });
    }, 160);
    this.timers.add(timer);
  }

  injury(injury: ArcadeInjury): void {
    const context = this.context;
    const master = this.master;
    const buffer = this.injuryBuffers.get(BORROWED_VOICE[injury] ?? injury);
    const current = this.settings();
    if (!this.unlocked || context === null || master === null || buffer === undefined) return;
    if (current.blood !== "full" || current.reducedMotion) return;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = 0.16;
    source.connect(gain).connect(master);
    source.start();
  }

  private async decodeInjuryBuffers(context: AudioContext): Promise<ReadonlyMap<ArcadeInjury, AudioBuffer>> {
    const decoded = await Promise.all(INJURY_SOUNDS.map(async (sound) => {
      const encoded = atob(sound.wav);
      const bytes = new Uint8Array(encoded.length);
      for (let index = 0; index < encoded.length; index += 1) bytes[index] = encoded.charCodeAt(index);
      try {
        return [sound.name, await context.decodeAudioData(bytes.buffer)] as const;
      } catch {
        return null;
      }
    }));
    const buffers = new Map<ArcadeInjury, AudioBuffer>();
    for (const entry of decoded) {
      if (entry !== null) buffers.set(entry[0], entry[1]);
    }
    return buffers;
  }

  /** Layered punch impact: sub thump, glove thud, and a short leather snap scaled by weight. */
  private impact(loud: number, body: boolean, weight: number): void {
    this.tone({ from: body ? 86 : 118, to: body ? 34 : 44, duration: 0.14 + weight * 0.06, type: "sine", gain: loud });
    this.noise({ duration: 0.05 + weight * 0.03, frequency: body ? 240 : 420, sweepTo: body ? 120 : 200, gain: loud * 0.8, type: "bandpass", q: 0.8 });
    this.noise({ duration: 0.028, frequency: body ? 1500 : 2600, sweepTo: body ? 700 : 1400, gain: loud * (body ? 0.35 : 0.6), type: "bandpass", q: 1.3 });
    this.noise({ duration: 0.18 + weight * 0.1, frequency: body ? 150 : 210, gain: loud * 0.45 });
  }

  /** Full crowd eruption with a slow decay, used for knockdowns and finishes. */
  private crowdRoar(intensity: number): void {
    const context = this.context;
    if (context === null) return;
    this.noise({ duration: 0.5, frequency: 900, sweepTo: 520, gain: Math.min(0.3, 0.12 + intensity * 0.18), type: "bandpass", q: 0.5 });
    const crowd = this.crowdGain;
    if (crowd !== null) {
      const now = context.currentTime;
      crowd.gain.cancelScheduledValues(now);
      crowd.gain.setValueAtTime(Math.min(0.16, 0.06 + intensity * 0.1), now);
      crowd.gain.exponentialRampToValueAtTime(0.022, now + 4.5);
    }
  }

  /** After the roar at a knockdown the arena goes quiet for the count. */
  private hush(): void {
    const context = this.context;
    const crowd = this.crowdGain;
    if (context === null || crowd === null) return;
    const now = context.currentTime;
    crowd.gain.cancelScheduledValues(now);
    crowd.gain.setValueAtTime(0.16, now);
    crowd.gain.exponentialRampToValueAtTime(0.1, now + 1.2);
    crowd.gain.exponentialRampToValueAtTime(0.004, now + 3);
  }

  private ooh(weight: number): void {
    const context = this.context;
    if (context === null || context.currentTime - this.lastOohAt < OOH_COOLDOWN_SECONDS) return;
    this.lastOohAt = context.currentTime;
    this.crowdVoice({ ...OOH, gain: OOH.gain * (0.6 + 0.4 * weight), delay: 0.12 });
  }

  private crowdVoice(spec: CrowdVoiceSpec): void {
    const context = this.context;
    const master = this.master;
    if (context === null || master === null) return;
    const buffer = this.noiseLoop(context);
    const start = context.currentTime + (spec.delay ?? 0);
    const end = start + spec.duration;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(Math.min(0.3, spec.gain), start + spec.duration * 0.22);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    for (const [from, to] of [spec.first, spec.second]) {
      const formant = context.createBiquadFilter();
      formant.type = "bandpass";
      formant.Q.value = 5;
      formant.frequency.setValueAtTime(from, start);
      formant.frequency.exponentialRampToValueAtTime(to, end);
      source.connect(formant).connect(envelope);
    }
    envelope.connect(master);
    source.start(start, (spec.duration * 0.37) % 1);
    source.stop(end + 0.05);
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

  private noiseLoop(context: AudioContext): AudioBuffer {
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
    return this.noiseBuffer;
  }

  private noise(spec: NoiseSpec): void {
    const context = this.context;
    const master = this.master;
    if (context === null || master === null) return;
    const loop = this.noiseLoop(context);
    const start = context.currentTime + (spec.delay ?? 0);
    const duration = Math.min(0.5, spec.duration);
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    source.buffer = loop;
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
    source.start(start, (spec.offset ?? 0) % 1.1);
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
      crowd.gain.cancelScheduledValues(now);
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
    const murmurFilter = context.createBiquadFilter();
    murmurFilter.type = "bandpass";
    murmurFilter.frequency.value = 620;
    murmurFilter.Q.value = 0.9;
    const murmur = context.createGain();
    murmur.gain.value = 0;
    this.murmurGain = murmur;
    source.connect(murmurFilter).connect(murmur).connect(master);
  }

  destroy(): void {
    this.destroyed = true;
    for (const type of UNLOCK_EVENTS) window.removeEventListener(type, this.unlockListener);
    document.removeEventListener("visibilitychange", this.visibility);
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    const context = this.context;
    this.context = null;
    this.master = null;
    this.noiseBuffer = null;
    this.injuryBuffers = new Map();
    this.crowdGain = null;
    this.murmurGain = null;
    this.muffle = null;
    this.unlocked = false;
    if (context !== null) void context.close().catch(() => undefined);
  }
}
