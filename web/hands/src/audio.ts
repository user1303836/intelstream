import type { Settings } from "./settings";
import type { CombatEvent, FinalMessage } from "./types";

export class AudioFeedback {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
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
    if (event.kind === "bell") this.tone(720, 1.15, "sine", 0.22);
    else if (event.kind === "hit" || event.kind === "counter_hit") {
      this.noise(0.08, event.detail.includes("body") ? 150 : 230, 0.28);
      this.tone(event.detail.includes("body") ? 85 : 125, 0.09, "triangle", 0.14);
    } else if (event.kind === "block") this.noise(0.055, 380, 0.16);
    else if (event.kind === "knockdown") {
      this.noise(0.2, 90, 0.3);
      this.tone(58, 0.32, "sine", 0.2);
    } else if (event.kind === "count") this.tone(330, 0.12, "square", 0.08);
    else if (event.kind === "rope" || event.kind === "clinch_start") this.noise(0.11, 110, 0.13);
  }

  snapshot(tick: number, stamina: number, maximumStamina: number, trauma: number): void {
    if (!this.unlocked) return;
    const fatigue = 1 - stamina / Math.max(1, maximumStamina);
    if (fatigue > 0.55 && tick - this.lastBreathTick >= 75) {
      this.lastBreathTick = tick;
      this.noise(0.18, 420, 0.045 + fatigue * 0.04);
    }
    if ((fatigue > 0.72 || trauma > 500) && tick - this.lastHeartbeatTick >= 24) {
      this.lastHeartbeatTick = tick;
      this.tone(52, 0.09, "sine", 0.055);
    }
  }

  result(final: FinalMessage): void {
    if (!this.unlocked) return;
    this.tone(final.winner_id === null ? 280 : 520, 0.45, "triangle", 0.18);
    const timer = window.setTimeout(() => {
      this.timers.delete(timer);
      this.tone(650, 0.5, "triangle", 0.14);
    }, 160);
    this.timers.add(timer);
  }

  private tone(frequency: number, duration: number, type: OscillatorType, gain: number): void {
    const context = this.context;
    const master = this.master;
    if (context === null || master === null) return;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    envelope.gain.setValueAtTime(0.0001, context.currentTime);
    envelope.gain.exponentialRampToValueAtTime(Math.min(0.35, gain), context.currentTime + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + Math.min(1.2, duration));
    oscillator.connect(envelope).connect(master);
    oscillator.start();
    oscillator.stop(context.currentTime + Math.min(1.2, duration) + 0.02);
  }

  private noise(duration: number, cutoff: number, gain: number): void {
    const context = this.context;
    const master = this.master;
    if (context === null || master === null) return;
    const length = Math.max(1, Math.floor(context.sampleRate * Math.min(0.4, duration)));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = length;
    for (let index = 0; index < data.length; index += 1) {
      seed = (seed * 16_807) % 2_147_483_647;
      data[index] = seed / 1_073_741_824 - 1;
    }
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    source.buffer = buffer;
    filter.type = "lowpass";
    filter.frequency.value = Math.max(60, Math.min(1200, cutoff));
    envelope.gain.setValueAtTime(Math.min(0.35, gain), context.currentTime);
    envelope.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + Math.min(0.4, duration));
    source.connect(filter).connect(envelope).connect(master);
    source.start();
  }

  private crowdBed(): void {
    const context = this.context;
    const master = this.master;
    if (context === null || master === null) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 42;
    gain.gain.value = 0.012;
    oscillator.connect(gain).connect(master);
    oscillator.start();
    oscillator.stop(context.currentTime + 8);
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
    this.unlocked = false;
    if (context !== null) void context.close().catch(() => undefined);
  }
}
