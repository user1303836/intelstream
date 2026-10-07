import { RoundClock } from "./render/hud";
import { AnnouncerVoice } from "./announcer";
import { AudioFeedback } from "./audio";
import { ClientError, safeError } from "./api";
import { DiscordActivity, type ActivityAuthorizer, type DiscordSession } from "./discord";
import { CornerPanel } from "./corner";
import { saveStyle, StylePicker } from "./styles";
import { describeError } from "./errors";
import { HapticFeedback } from "./haptics";
import { CONTROL_SECTIONS, controlHint } from "./input/bindings";
import { coarsePointer } from "./input/touch";
import { InputController } from "./input/input";
import { EventDeduplicator } from "./interpolation";
import { NetworkController } from "./network";
import { CPU_LEVELS } from "./protocol";
import { crowdTension } from "./render/commentary";
import { FightRenderer } from "./render/renderer";
import { CAMERA_MODES, SettingsStore, type BloodLevel } from "./settings";
import { initialState, reduceState, type GameState } from "./state";
import type { CpuLevel, EngineSnapshot, PublicPlayer, ServerMessage } from "./types";

const CONTACT_FEEDBACK_KINDS = new Set(["hit", "counter_hit", "block", "perfect_block", "guard_break", "knockdown", "parry", "body_collapse", "eye_shut"]);
// The room keeps the finished bout for its result hold (ten seconds by default); a rejoin inside
// that window only replays the old final, so the rematch waits it out and retries if it still hits it.
const REMATCH_HOLD_MS = 11_000;
/** How long the announcer may run on past the opening bell to finish the name it is reading. */
const BELL_GRACE_MS = 1_500;
/** How long the finish plays without the overlay while the result is still on its way. */
const RESULT_WAIT_MS = 4_000;
const REMATCH_RETRY_MS = 3_000;
const REMATCH_MAX_ATTEMPTS = 6;
/** A rematch against the computer waits this long first, so a friend who joins in the meantime fights instead. */
const CPU_REMATCH_DELAY_MS = 5_000;
const CPU_CHOICES: readonly { readonly level: CpuLevel; readonly label: string; readonly detail: string }[] = [
  { level: "rookie", label: "Rookie", detail: "Slow hands, leaves openings" },
  { level: "contender", label: "Contender", detail: "Works the body, punishes mistakes" },
  { level: "champion", label: "Champion", detail: "Slips, counters, finishes" },
];
const isCpuLevel = (value: string | undefined): value is CpuLevel => CPU_LEVELS.includes(value as CpuLevel);

export class HandsApp {
  private state: GameState = initialState;
  private readonly settings = new SettingsStore();
  private readonly input = new InputController();
  private readonly audio = new AudioFeedback(() => this.settings.current);
  private readonly haptics = new HapticFeedback(() => this.settings.current);
  private readonly voice = new AnnouncerVoice(() => this.settings.current);
  private readonly feedbackEvents = new EventDeduplicator();
  private renderer: FightRenderer | null = null;
  private network: NetworkController | null = null;
  private session: DiscordSession | null = null;
  private abort = new AbortController();
  private destroyed = false;
  private generation = 0;
  private reloadOnRetry = false;
  private reloading = false;

  private readonly canvas: HTMLCanvasElement;
  private readonly status: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly roleIndicator: HTMLElement;
  private readonly controlsButton: HTMLButtonElement;
  private readonly controlsPanel: HTMLElement;
  private readonly retry: HTMLButtonElement;
  private readonly rematchButton: HTMLButtonElement;
  private readonly hint: HTMLElement;
  private readonly cpuPicker: HTMLElement;
  private readonly cpuPrompt: HTMLElement;
  /** The computer asked for in this bout, and the one a rematch asks for again. */
  private cpuLevel: CpuLevel | null = null;
  /** The fighter a pressed Rematch is waiting for, until the new bout is ready. */
  private rematchOpponent: string | null = null;
  private lastPhase: EngineSnapshot["phase"] | null = null;
  private cpuRematchLevel: CpuLevel | null = null;
  /** The computer a rematch calls back once its short wait is over, while it lasts. */
  private cpuRematch: { readonly level: CpuLevel; readonly at: number } | null = null;
  private cpuRematchTimer: number | null = null;
  private diagnosticsTimer: number | null = null;
  private finalReceivedAt = 0;
  private lastFinalMatchId: string | null = null;
  private rematchAttempts = 0;
  private rematchTimer: number | null = null;
  private rematchCountdownTimer: number | null = null;
  private resultRevealTimer: number | null = null;
  private resultWaitTimer: number | null = null;
  private completeSince: number | null = null;
  private readonly summaryClock = new RoundClock();
  private readonly fightSummary: HTMLElement;
  private readonly liveFightStatus: HTMLElement;
  private readonly finalSummary: HTMLElement;
  private readonly corner: CornerPanel;
  private readonly stylePicker: StylePicker;

  constructor(
    private readonly root: HTMLElement,
    private readonly reloadPage: () => void = () => window.location.reload(),
    private readonly authorizer: ActivityAuthorizer = new DiscordActivity(),
  ) {
    root.innerHTML = `<section class="activity" aria-label="Hands boxing activity"><canvas class="fight" aria-label="Two-player boxing match"></canvas><header class="topbar"><strong>HANDS</strong><span>two-player boxing</span><span class="spectator-role" data-role hidden>SPECTATING · READ ONLY</span><button type="button" data-controls aria-expanded="false">Controls</button><button type="button" data-settings aria-expanded="false">Settings</button></header><section class="overlay" data-overlay><p class="status" data-status></p><p class="hint" data-hint hidden></p><section class="cpu-picker" data-cpu hidden aria-label="Fight the computer"><p data-cpu-prompt>No one here yet? Fight the computer.</p><div class="cpu-levels">${CPU_CHOICES.map((choice) => `<button type="button" data-cpu-level="${choice.level}"><strong>${choice.label}</strong><span>${choice.detail}</span></button>`).join("")}</div></section><button type="button" class="primary" data-retry hidden>Retry securely</button><button type="button" class="primary" data-rematch hidden>Rematch</button></section><aside class="panel" data-controls-panel hidden aria-label="Controls"><h2>Controls</h2>${CONTROL_SECTIONS.map((section) => `<h3>${section.title}</h3><ul>${section.items.map((item) => `<li>${item}</li>`).join("")}</ul>`).join("")}</aside><aside class="panel settings" data-settings-panel hidden aria-label="Accessibility and feedback settings"><h2>Settings</h2><label>Volume <input data-volume type="range" min="0" max="1" step="0.05"></label><label><input data-haptics type="checkbox"> Haptics</label><label><input data-motion type="checkbox"> Reduced motion</label><label><input data-commentary type="checkbox"> Commentary captions</label><label><input data-announcer type="checkbox"> Ring announcer voice</label><label>Blood <select data-blood><option value="full">Full (arcade gore)</option><option value="reduced">Reduced</option><option value="off">Off</option></select></label><label>Camera <select data-camera><option value="broadcast">Broadcast</option><option value="close">Close</option><option value="fighter">Over the shoulder</option></select></label><details class="diagnostics"><summary>Diagnostics</summary><pre data-diagnostics></pre><button type="button" data-copy-diagnostics>Copy diagnostics</button></details><p class="model-credit"><a href="https://sketchfab.com/3d-models/boxer-84767168720948b38728ff78ee6f6090" target="_blank" rel="noreferrer">“Boxer” by Texel, Inc.</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a> · modified</p></aside><section class="sr-summary" data-fight-summary aria-label="Fight summary"></section><p class="sr-summary" data-fight-status role="status" aria-live="polite" aria-atomic="true"></p><section class="sr-summary" data-final aria-live="polite" aria-label="Final result"></section></section>`;
    this.canvas = root.querySelector<HTMLCanvasElement>("canvas")!;
    this.status = root.querySelector<HTMLElement>("[data-status]")!;
    this.overlay = root.querySelector<HTMLElement>("[data-overlay]")!;
    this.roleIndicator = root.querySelector<HTMLElement>("[data-role]")!;
    this.controlsButton = root.querySelector<HTMLButtonElement>("[data-controls]")!;
    this.controlsPanel = root.querySelector<HTMLElement>("[data-controls-panel]")!;
    this.retry = root.querySelector<HTMLButtonElement>("[data-retry]")!;
    this.rematchButton = root.querySelector<HTMLButtonElement>("[data-rematch]")!;
    this.hint = root.querySelector<HTMLElement>("[data-hint]")!;
    this.cpuPicker = root.querySelector<HTMLElement>("[data-cpu]")!;
    this.cpuPrompt = root.querySelector<HTMLElement>("[data-cpu-prompt]")!;
    this.cpuPicker.addEventListener("click", this.onCpuPick);
    this.rematchButton.addEventListener("click", this.onRematch);
    this.fightSummary = root.querySelector<HTMLElement>("[data-fight-summary]")!;
    this.liveFightStatus = root.querySelector<HTMLElement>("[data-fight-status]")!;
    this.finalSummary = root.querySelector<HTMLElement>("[data-final]")!;
    this.retry.addEventListener("click", this.onRetry);
    this.bindPanels();
    this.syncSettings();
    this.input.attachTouch(root.querySelector<HTMLElement>(".activity")!);
    this.corner = new CornerPanel(root.querySelector<HTMLElement>(".activity")!, (kind) => this.network?.sendCornerChoice(kind) ?? false);
    this.stylePicker = new StylePicker(root.querySelector<HTMLElement>(".activity")!, (style, ready) => this.network?.chooseStyle(style, ready) ?? false);
    this.input.setViewForward(() => this.renderer?.viewForward() ?? null);
    window.addEventListener("keydown", this.onCameraKey);
  }

  private readonly onCameraKey = (event: KeyboardEvent): void => {
    if (event.code !== "KeyK" || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return;
    event.preventDefault();
    const next = CAMERA_MODES[(CAMERA_MODES.indexOf(this.settings.current.camera) + 1) % CAMERA_MODES.length]!;
    this.settings.update({ camera: next });
    this.root.querySelector<HTMLSelectElement>("[data-camera]")!.value = next;
  };

  start(): void {
    void this.authorize();
  }

  private resetForAuthorization(): void {
    this.reloadOnRetry = false;
    this.network?.dispose();
    this.network = null;
    this.session?.destroy();
    this.session = null;
    this.renderer?.destroy();
    this.renderer = null;
    this.voice.cancel();
    this.audio.reset();
    this.abort.abort();
    this.abort = new AbortController();
    this.state = initialState;
    this.feedbackEvents.reset();
    this.input.setActive(false);
    this.input.reset();
    this.finalSummary.textContent = "";
    this.fightSummary.textContent = "";
    this.liveFightStatus.textContent = "";
    this.clearRematchTimers();
    this.rematchButton.hidden = true;
    this.cpuLevel = null;
    this.lastPhase = null;
  }

  private readonly onCpuPick = (event: Event): void => {
    const level = (event.target as Element | null)?.closest<HTMLElement>("[data-cpu-level]")?.dataset.cpuLevel;
    if (!isCpuLevel(level) || this.state.stage !== "waiting" || this.state.role !== "fighter" || this.cpuLevel !== null) return;
    this.callCpu(level);
  };

  private callCpu(level: CpuLevel): void {
    if (this.network?.requestCpu(level) !== true) return;
    this.cpuLevel = level;
    this.renderState();
  }

  private get cpuBout(): boolean {
    return Object.values(this.state.players).some((player) => player.cpu === true);
  }

  private readonly onRematch = (): void => {
    if (this.rematchButton.disabled || this.state.stage !== "complete") return;
    this.rematchAttempts = 1;
    // Named while the old bout's players are still known, for the wait in the new room.
    this.rematchOpponent = this.cpuBout || this.state.role !== "fighter" ? null : Object.values(this.state.players).find((player) => player.id !== this.state.playerId)?.name ?? null;
    void this.authorize();
  };

  private clearRematchTimers(): void {
    if (this.rematchTimer !== null) window.clearTimeout(this.rematchTimer);
    if (this.rematchCountdownTimer !== null) window.clearInterval(this.rematchCountdownTimer);
    this.rematchTimer = null;
    this.rematchCountdownTimer = null;
    this.clearCpuRematch();
  }

  /**
   * A rematch against the computer does not call it straight back: a friend who joins in the next
   * few seconds takes the seat instead. A tap on a level calls the computer at once.
   */
  private scheduleCpuRematch(level: CpuLevel): void {
    this.clearCpuRematch();
    this.cpuRematch = { level, at: Date.now() + CPU_REMATCH_DELAY_MS };
    this.cpuRematchTimer = window.setInterval(() => {
      const pending = this.cpuRematch;
      if (pending === null || this.state.stage !== "waiting" || this.state.role !== "fighter" || this.cpuLevel !== null) this.clearCpuRematch();
      else if (Date.now() >= pending.at) {
        this.clearCpuRematch();
        this.callCpu(pending.level);
      }
      this.renderState();
    }, 250);
  }

  private clearCpuRematch(): void {
    if (this.cpuRematchTimer !== null) window.clearInterval(this.cpuRematchTimer);
    this.cpuRematchTimer = null;
    this.cpuRematch = null;
  }

  /** Keeps the overlay out of the knockout replay's way until the result panel is on screen. */
  private awaitResultReveal(): void {
    if (this.resultRevealTimer !== null) window.clearInterval(this.resultRevealTimer);
    const check = (): void => {
      const visible = this.renderer?.resultVisible ?? true;
      this.overlay.hidden = this.state.stage === "complete" && !visible;
      if ((visible || this.state.stage !== "complete") && this.resultRevealTimer !== null) {
        window.clearInterval(this.resultRevealTimer);
        this.resultRevealTimer = null;
      }
    };
    this.resultRevealTimer = window.setInterval(check, 200);
    check();
  }

  private startRematchCountdown(): void {
    this.clearRematchTimers();
    // A spectator can stay for the channel's next bout: the fighters keep their seats for a
    // rematch, so he watches it, or takes a seat they leave empty.
    const label = this.state.role === "fighter" ? "Rematch" : "Next bout";
    const tick = (): void => {
      const remaining = Math.ceil((this.finalReceivedAt + REMATCH_HOLD_MS - Date.now()) / 1000);
      this.rematchButton.hidden = this.state.stage !== "complete";
      this.rematchButton.disabled = remaining > 0;
      this.setText(this.rematchButton, remaining > 0 ? `${label} in ${remaining}s` : label);
      if (remaining <= 0 && this.rematchCountdownTimer !== null) {
        window.clearInterval(this.rematchCountdownTimer);
        this.rematchCountdownTimer = null;
      }
    };
    tick();
    this.rematchCountdownTimer = window.setInterval(tick, 1000);
  }

  private scheduleRematchRetry(): void {
    if (this.rematchTimer !== null) return;
    if (this.rematchAttempts >= REMATCH_MAX_ATTEMPTS) {
      this.fail("rematch_unavailable");
      return;
    }
    this.rematchAttempts += 1;
    this.setText(this.status, "The ring is still being cleared… trying again.");
    this.rematchTimer = window.setTimeout(() => {
      this.rematchTimer = null;
      void this.authorize();
    }, REMATCH_RETRY_MS);
  }

  private async authorize(): Promise<void> {
    const generation = ++this.generation;
    this.resetForAuthorization();
    this.dispatch({ type: "connecting" });
    this.setText(this.status, "Securing Discord Activity session…");
    this.retry.hidden = true;
    try {
      const session = await this.authorizer.authorize(this.abort.signal);
      if (this.destroyed || generation !== this.generation) {
        session.destroy();
        return;
      }
      this.session = session;
      this.dispatch({ type: "bootstrap", simulation: session.bootstrap.simulation });
      this.dispatch({ type: "authorized", player: session.player });
      this.input.onAction((action) => {
        this.renderer?.predictAction?.(action);
        this.network?.notifyAction();
      });
      const ticket = session.takeTicket();
      if (ticket === null) throw new Error("ticket_unavailable");
      const network = new NetworkController(ticket, () => this.input.frame(), {
        onMessage: (message) => this.receive(message),
        onReconnect: (remaining) => {
          this.dispatch({ type: "reconnect-tick", remainingMs: remaining });
          this.renderer?.setReconnect(remaining);
          this.renderState();
        },
        onFatal: (code) => this.fail(code),
        onFreshAuth: () => {
          if (generation === this.generation) void this.authorize();
        },
      });
      this.network = network;
      network.start();
      this.setText(this.status, "Connecting to the ring…");
    } catch (error) {
      if (!this.abort.signal.aborted && generation === this.generation) {
        this.reloadOnRetry = error instanceof ClientError && error.reloadRequired;
        this.fail(safeError(error));
      }
    }
  }

  /**
   * The renderer is built once the socket is authenticated. Building it
   * earlier delayed the authenticate frame behind model parsing and shader
   * compilation on slow machines, which tripped the server's handshake
   * timeout.
   */
  private ensureRenderer(): void {
    if (this.renderer !== null || this.session === null || this.destroyed) return;
    const renderer = new FightRenderer(this.canvas, this.session.bootstrap.simulation, () => this.settings.current, {
      localInput: () => this.input.held(),
      inputSequenceOf: (actionId) => this.network?.sequenceOf(actionId) ?? null,
    });
    renderer.onContact = (event) => {
      this.audio.event(event);
      this.haptics.event(event);
    };
    renderer.onArcadeInjury = (injury) => this.audio.injury(injury);
    renderer.onAnnouncement = (lines) => this.voice.speak(lines);
    renderer.onCrowdCue = () => this.audio.chant();
    // The muffle follows the hurt vision: from the punch that rocked him as the screen shows it.
    renderer.onRocked = (level, tick) => this.audio.rocked(level, tick);
    this.renderer = renderer;
  }

  private receive(message: ServerMessage): void {
    if (message.type === "error") {
      this.fail(message.code);
      return;
    }
    if (message.type === "welcome") this.ensureRenderer();
    if (message.type === "welcome" || message.type === "resumed") this.renderer?.resyncClock();
    const rematching = this.rematchAttempts > 0;
    if (message.type === "waiting" || message.type === "ready") this.rematchAttempts = 0;
    if (message.type === "ready") this.rematchOpponent = null;
    if (message.type === "ready") this.rememberStyle(message.players);
    if (message.type === "final" && this.rematchAttempts > 0 && message.match_id === this.lastFinalMatchId) {
      this.scheduleRematchRetry();
      return;
    }
    this.dispatch({ type: "message", message });
    if (message.type === "snapshot") this.receiveSnapshot(message.payload);
    // A person took the computer's seat before the bell: the request is spent, and a later wait
    // for an opponent does not bring the computer back by itself.
    if ((message.type === "select" || message.type === "ready") && !message.players.some((player) => player.cpu === true)) this.cpuLevel = null;
    if (message.type === "waiting") {
      // Asked again after a reconnect lost the request; a rematch against the computer waits first.
      if (this.cpuLevel !== null) this.callCpu(this.cpuLevel);
      else if (rematching && this.cpuRematchLevel !== null) this.scheduleCpuRematch(this.cpuRematchLevel);
    }
    if (message.type === "final") {
      this.cpuRematchLevel = this.cpuBout ? this.cpuLevel : null;
      this.rematchAttempts = 0;
      this.lastFinalMatchId = message.match_id;
      this.finalReceivedAt = Date.now();
      this.renderer?.setFinal(message);
      this.audio.result(message);
      this.startRematchCountdown();
      this.awaitResultReveal();
    }
    this.renderer?.setPlayers(this.state.players, this.state.playerId, this.state.playerOrder);
    this.renderer?.setReconnect(this.state.reconnectMs);
    this.renderState();
  }

  /** Smoothed input acknowledgement latency of the local fighter and the render scale, for diagnostics. */
  get networkStats(): { inputLatencyMs: number | null; resolutionScale: number | null; gpu: { geometries: number; textures: number; programs: number } | null } {
    return { inputLatencyMs: this.network?.inputLatencyMs ?? null, resolutionScale: this.renderer?.resolutionScale ?? null, gpu: this.renderer?.memoryInfo ?? null };
  }

  private receiveSnapshot(snapshot: EngineSnapshot): void {
    // The introductions belong to the countdown: at the opening bell the rest of the script goes
    // unsaid, and a line still being read by a slow voice gets a moment to finish its name.
    if (this.lastPhase === "countdown" && snapshot.phase !== "countdown") this.voice.finishLine(BELL_GRACE_MS);
    this.lastPhase = snapshot.phase;
    this.renderer?.setInputLatency(this.network?.inputLatencyMs ?? null);
    this.renderer?.push(snapshot);
    const viewer = snapshot.fighters.find((fighter) => fighter.player_id === this.state.playerId);
    this.input.setKnockdown(viewer?.is_downed === true);
    if (viewer !== undefined) this.audio.snapshot(snapshot.tick, viewer.stamina, viewer.maximum_stamina, viewer.trauma.head + viewer.trauma.body);
    this.audio.roundClock(snapshot.phase, snapshot.round_number, snapshot.phase_ticks_remaining, this.state.simulation?.tick_rate ?? 30);
    this.audio.tension(crowdTension(snapshot));
    for (const event of this.feedbackEvents.accept(snapshot.events)) {
      if (CONTACT_FEEDBACK_KINDS.has(event.kind)) continue;
      this.audio.event(event);
      this.haptics.event(event);
    }
  }

  /** The style the room says this fighter boxes in, whether he settled on it or the deadline chose it, is offered first next time. */
  private rememberStyle(players: readonly PublicPlayer[]): void {
    const style = players.find((player) => player.id === this.state.playerId)?.style;
    if (this.state.role === "fighter" && style !== undefined) saveStyle(style);
  }

  private dispatch(action: Parameters<typeof reduceState>[1]): void {
    this.state = reduceState(this.state, action);
  }

  private setText(element: HTMLElement, text: string): void {
    if (element.textContent !== text) element.textContent = text;
  }

  private renderState(): void {
    const labels: Record<GameState["stage"], string> = {
      bootstrapping: "Loading…",
      authorizing: "Authorizing with Discord…",
      connecting: "Connecting securely…",
      waiting: this.state.role === "spectator" ? "Waiting for the fighters…" : this.cpuLevel !== null ? "Calling in the computer…" : this.cpuRematch !== null ? `Rematch with the ${CPU_CHOICES.find((choice) => choice.level === this.cpuRematch?.level)?.label ?? "computer"} in ${Math.max(1, Math.ceil((this.cpuRematch.at - Date.now()) / 1000))}s, unless someone joins first.` : this.rematchOpponent !== null ? `Waiting for ${this.rematchOpponent} to take the rematch…` : "Waiting for an opponent. Anyone in this channel can join with Play now.",
      select: "Pick how your fighter boxes.",
      countdown: "Bout countdown.",
      fight: `Round ${this.state.snapshot?.round_number ?? 1} in progress.`,
      knockdown: `Knockdown count ${this.state.snapshot?.fighters.find((fighter) => fighter.player_id === this.state.playerId)?.get_up_count ?? 0}.`,
      foul_recovery: "Foul recovery in progress.",
      rest: "Between-round rest.",
      paused: `Connection paused. ${Math.ceil(this.state.reconnectMs / 1000)} seconds remain.`,
      complete: this.cpuBout ? "Bout complete. Scorecards are displayed. Bouts against the computer are unrated." : "Bout complete. Scorecards and rating changes are displayed.",
      fatal: describeError(this.state.safeError ?? "safe_error"),
    };
    const spectating = this.state.role === "spectator";
    this.setText(this.status, spectating ? `Spectating — ${labels[this.state.stage]}` : labels[this.state.stage]);
    // The result card says how the bout ended; the button sits in the card's footer.
    const resulted = this.state.stage === "complete" && this.state.final !== null;
    this.status.hidden = resulted || ["select", "countdown", "fight", "knockdown", "foul_recovery", "rest"].includes(this.state.stage);
    this.overlay.toggleAttribute("data-raised", this.state.snapshot !== null);
    this.overlay.toggleAttribute("data-result", resulted);
    // The engine's last snapshot arrives before the result does; the finish plays without the overlay.
    if (this.state.stage !== "complete") {
      this.overlay.hidden = false;
      this.completeSince = null;
    } else if (this.state.final === null) {
      this.completeSince ??= Date.now();
      const waited = Date.now() - this.completeSince;
      this.overlay.hidden = waited < RESULT_WAIT_MS;
      if (this.overlay.hidden && this.resultWaitTimer === null) {
        this.resultWaitTimer = window.setTimeout(() => {
          this.resultWaitTimer = null;
          this.renderState();
        }, RESULT_WAIT_MS - waited + 50);
      }
    }
    this.roleIndicator.hidden = !spectating;
    this.controlsButton.hidden = spectating;
    if (spectating) {
      this.controlsPanel.hidden = true;
      this.controlsButton.setAttribute("aria-expanded", "false");
    }
    const viewer = this.state.snapshot?.fighters.find((fighter) => fighter.player_id === this.state.playerId);
    const liveStatus = spectating
      ? `Spectating. ${labels[this.state.stage]}`
      : this.state.stage === "knockdown" && viewer?.is_downed === true
        ? `Knockdown. Count ${viewer.get_up_count}. ${viewer.get_up_prompt === null ? "Wait for your private rhythm instruction." : `Press ${viewer.get_up_prompt === "get_up_left" ? "left" : "right"} now.`}`
        : this.state.stage === "paused"
          ? "Connection paused."
          : labels[this.state.stage];
    this.setText(this.liveFightStatus, liveStatus);
    this.corner.update(this.state.snapshot, this.state.playerId, this.state.role === "fighter" && this.state.stage === "rest");
    this.renderer?.setCornerPanelTop(this.corner.top());
    this.stylePicker.update(this.state.stage === "select" ? this.state.select : null, this.state.playerId, this.state.role);
    this.retry.hidden = this.state.stage !== "fatal";
    this.setText(this.retry, this.reloadOnRetry ? "Reload" : "Retry securely");
    if (this.state.stage !== "complete") this.rematchButton.hidden = true;
    this.cpuPicker.hidden = spectating || this.state.stage !== "waiting" || this.cpuLevel !== null;
    // While a rematch waits for the other fighter, the computer is the fallback rather than the invitation.
    this.setText(this.cpuPrompt, this.cpuRematch !== null ? "Or start now:" : this.rematchOpponent !== null ? "Or fight the computer instead:" : "No one here yet? Fight the computer.");
    const showHint = !spectating && (this.state.stage === "waiting" || this.state.stage === "countdown");
    this.hint.hidden = !showHint;
    if (showHint) this.setText(this.hint, controlHint(coarsePointer(), window.innerWidth));
    // Once the pads are up for the countdown, the touch hint moves to the empty stick side so it covers no pad.
    this.overlay.toggleAttribute("data-touch-hint", showHint && this.state.stage === "countdown" && coarsePointer());
    const active = !spectating && ["countdown", "fight", "knockdown", "foul_recovery"].includes(this.state.stage);
    // Between rounds and through pauses the touch controls stay up, inert, so a thumb already in place counts at the bell.
    const resting = !spectating && this.state.snapshot !== null && (this.state.stage === "rest" || this.state.stage === "paused");
    this.input.setActive(active, active || resting);
    this.network?.setActive(active);
    this.renderFightSummary();
    if (this.state.final !== null) {
      const final = this.state.final;
      this.setText(this.finalSummary, `${final.method.replaceAll("_", " ")}. ${final.winner_id === null ? "Draw" : `${this.state.players[final.winner_id]?.name ?? "Winner"} wins`}. Scorecards: ${final.scorecards.map((card) => `${card.judge}: ${card.player_one.reduce((a, b) => a + b, 0)} to ${card.player_two.reduce((a, b) => a + b, 0)}`).join("; ")}. ${this.cpuBout ? "Unrated bout against the computer." : `Ratings: ${Object.entries(final.ratings).map(([id, rating]) => `${this.state.players[id]?.name ?? "fighter"} ${rating.before} to ${rating.after}`).join("; ")}.`}`);
    }
  }

  private renderFightSummary(): void {
    const snapshot = this.state.snapshot;
    if (snapshot === null) return;
    const tickRate = this.state.simulation?.tick_rate ?? 30;
    const seconds = Math.floor(this.summaryClock.ticks(snapshot) / tickRate);
    const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    const fighters = snapshot.fighters.map((fighter) => {
      const player = this.state.players[fighter.player_id];
      return `${player?.name ?? "Fighter"}, ${player?.cpu === true ? "computer opponent" : `ELO ${player?.rating ?? "unknown"}`}, stamina ${Math.round(fighter.stamina)} of ${Math.round(fighter.maximum_stamina)}, guard ${Math.round(fighter.guard)}, poise ${Math.round(fighter.poise)}, conditioning ${Math.round(fighter.conditioning)}, ${fighter.warnings} warnings, ${fighter.knockdowns} knockdowns`;
    });
    const viewer = snapshot.fighters.find((fighter) => fighter.player_id === this.state.playerId);
    const getUp = viewer?.is_downed === true
      ? viewer.get_up_prompt === null
        ? `You are down. Count ${viewer.get_up_count}. Wait for your private rhythm instruction.`
        : `You are down. Count ${viewer.get_up_count}. Press ${viewer.get_up_prompt === "get_up_left" ? "left" : "right"} now. Get-up progress ${viewer.get_up_meter} of ${viewer.get_up_required}.`
      : "";
    this.setText(this.fightSummary, `Round ${snapshot.round_number}. ${snapshot.phase.replace("_", " ")}. Clock ${clock}. ${fighters.join(". ")}. ${getUp}`.trim());
  }

  private readonly onRetry = (): void => {
    if (this.reloadOnRetry) {
      // The reload brings up a new page and SDK; closing this SDK on the way out would close the Activity.
      this.reloading = true;
      this.reloadPage();
      return;
    }
    void this.authorize();
  };

  private bindPanels(): void {
    const bind = (buttonSelector: string, panelSelector: string): void => {
      const button = this.root.querySelector<HTMLButtonElement>(buttonSelector)!;
      const panel = this.root.querySelector<HTMLElement>(panelSelector)!;
      button.addEventListener("click", () => {
        panel.hidden = !panel.hidden;
        button.setAttribute("aria-expanded", String(!panel.hidden));
      });
    };
    bind("[data-controls]", "[data-controls-panel]");
    bind("[data-settings]", "[data-settings-panel]");
    const settingsPanel = this.root.querySelector<HTMLElement>("[data-settings-panel]")!;
    this.root.querySelector<HTMLButtonElement>("[data-settings]")!.addEventListener("click", () => {
      if (this.diagnosticsTimer !== null) window.clearInterval(this.diagnosticsTimer);
      this.diagnosticsTimer = null;
      if (settingsPanel.hidden) return;
      this.refreshDiagnostics();
      this.diagnosticsTimer = window.setInterval(() => this.refreshDiagnostics(), 1000);
    });
    const copy = this.root.querySelector<HTMLButtonElement>("[data-copy-diagnostics]")!;
    copy.addEventListener("click", () => {
      const text = this.diagnosticsText();
      const done = (): void => {
        this.setText(copy, "Copied");
        window.setTimeout(() => this.setText(copy, "Copy diagnostics"), 1500);
      };
      const selectFallback = (): void => {
        const block = this.root.querySelector<HTMLElement>("[data-diagnostics]")!;
        const selection = window.getSelection();
        if (selection === null) return;
        const range = document.createRange();
        range.selectNodeContents(block);
        selection.removeAllRanges();
        selection.addRange(range);
        this.setText(copy, "Selected. Copy manually");
        window.setTimeout(() => this.setText(copy, "Copy diagnostics"), 2500);
      };
      const clipboard = navigator.clipboard;
      if (clipboard === undefined || typeof clipboard.writeText !== "function") {
        selectFallback();
        return;
      }
      clipboard.writeText(text).then(done).catch(selectFallback);
    });
    this.root.querySelector<HTMLInputElement>("[data-volume]")!.addEventListener("input", (event) => {
      this.settings.update({ volume: Number((event.target as HTMLInputElement).value) });
      this.audio.setVolume();
      this.voice.settingsChanged();
    });
    this.root.querySelector<HTMLInputElement>("[data-haptics]")!.addEventListener("change", (event) => {
      this.settings.update({ haptics: (event.target as HTMLInputElement).checked });
    });
    this.root.querySelector<HTMLInputElement>("[data-motion]")!.addEventListener("change", (event) => {
      const reducedMotion = (event.target as HTMLInputElement).checked;
      this.settings.update({ reducedMotion });
      this.renderer?.setReducedMotion(reducedMotion);
    });
    this.root.querySelector<HTMLInputElement>("[data-commentary]")!.addEventListener("change", (event) => {
      this.settings.update({ commentary: (event.target as HTMLInputElement).checked });
    });
    this.root.querySelector<HTMLInputElement>("[data-announcer]")!.addEventListener("change", (event) => {
      const announcer = (event.target as HTMLInputElement).checked;
      this.settings.update({ announcer });
      if (!announcer) this.voice.cancel();
    });
    this.root.querySelector<HTMLSelectElement>("[data-blood]")!.addEventListener("change", (event) => {
      const blood = (event.target as HTMLSelectElement).value as BloodLevel;
      this.settings.update({ blood });
      this.renderer?.setBloodLevel(blood);
    });
    this.root.querySelector<HTMLSelectElement>("[data-camera]")!.addEventListener("change", (event) => {
      const camera = CAMERA_MODES.find((mode) => mode === (event.target as HTMLSelectElement).value);
      if (camera !== undefined) this.settings.update({ camera });
    });
  }

  /** One block of text a player can paste into the server when reporting a problem. */
  private diagnosticsText(): string {
    const stats = this.networkStats;
    const diag = this.renderer?.diagnostics;
    const fps = diag === undefined || diag.frameMs <= 0 ? "-" : (1000 / diag.frameMs).toFixed(0);
    return [
      `stage: ${this.state.stage} · role: ${this.state.role ?? "-"}`,
      `input latency: ${stats.inputLatencyMs === null ? "-" : `${Math.round(stats.inputLatencyMs)} ms`}`,
      `frame: ${diag === undefined ? "-" : `${diag.frameMs.toFixed(1)} ms (${fps} fps)`} · render scale: ${diag?.resolutionScale ?? "-"}`,
      `gpu objects: ${diag === undefined ? "-" : `${diag.gpu.geometries} geometries, ${diag.gpu.textures} textures, ${diag.gpu.programs} programs`}`,
      `graphics: ${diag?.graphics ?? "-"}`,
      `browser: ${navigator.userAgent}`,
      `pointer: ${coarsePointer() ? "coarse" : "fine"} · viewport: ${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}`,
      `last error: ${this.state.safeError ?? "none"}`,
      `match: ${this.state.final?.match_id ?? "-"}`,
    ].join("\n");
  }

  private refreshDiagnostics(): void {
    this.setText(this.root.querySelector<HTMLElement>("[data-diagnostics]")!, this.diagnosticsText());
  }

  private syncSettings(): void {
    const settings = this.settings.current;
    this.root.querySelector<HTMLInputElement>("[data-volume]")!.value = String(settings.volume);
    this.root.querySelector<HTMLInputElement>("[data-haptics]")!.checked = settings.haptics;
    this.root.querySelector<HTMLInputElement>("[data-motion]")!.checked = settings.reducedMotion;
    this.root.querySelector<HTMLSelectElement>("[data-blood]")!.value = settings.blood;
    this.root.querySelector<HTMLInputElement>("[data-commentary]")!.checked = settings.commentary;
    this.syncAnnouncerSetting();
    this.voice.onVoicesChanged = () => this.syncAnnouncerSetting();
    this.root.querySelector<HTMLSelectElement>("[data-camera]")!.value = settings.camera;
  }

  /** The voice is offered only where the device can read the names itself; it never uses an online voice. */
  private syncAnnouncerSetting(): void {
    const announcer = this.root.querySelector<HTMLInputElement>("[data-announcer]")!;
    const usable = this.voice.hasVoice;
    announcer.checked = this.settings.current.announcer && usable;
    announcer.disabled = !usable;
    const why = !this.voice.supported ? "This browser cannot speak" : usable ? null : "This device has no English voice of its own";
    if (why === null) announcer.parentElement!.removeAttribute("title");
    else announcer.parentElement!.title = why;
  }

  private fail(code: string): void {
    // A rematch can reach the old room while it is still closing; a new one opens a moment later.
    if (code === "room_closed" && this.rematchAttempts > 0) {
      this.scheduleRematchRetry();
      return;
    }
    // A server on a newer protocol cannot be played from this page; Retry reloads it.
    if (code === "client_outdated") this.reloadOnRetry = true;
    this.dispatch({ type: "fatal", code });
    this.rematchOpponent = null;
    this.voice.cancel();
    this.network?.dispose();
    this.network = null;
    this.session?.destroy();
    this.session = null;
    this.renderer?.destroy();
    this.renderer = null;
    this.input.setActive(false);
    this.input.reset();
    this.renderState();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.generation += 1;
    this.abort.abort();
    this.network?.dispose();
    this.session?.destroy();
    if (!this.reloading) this.authorizer.close();
    this.renderer?.destroy();
    window.removeEventListener("keydown", this.onCameraKey);
    this.input.destroy();
    this.corner.destroy();
    this.stylePicker.destroy();
    this.audio.destroy();
    this.voice.destroy();
    this.settings.destroy();
    this.retry.removeEventListener("click", this.onRetry);
    this.rematchButton.removeEventListener("click", this.onRematch);
    this.cpuPicker.removeEventListener("click", this.onCpuPick);
    this.clearRematchTimers();
    if (this.diagnosticsTimer !== null) window.clearInterval(this.diagnosticsTimer);
    if (this.resultRevealTimer !== null) window.clearInterval(this.resultRevealTimer);
    if (this.resultWaitTimer !== null) window.clearTimeout(this.resultWaitTimer);
    this.diagnosticsTimer = null;
    this.root.replaceChildren();
  }
}
