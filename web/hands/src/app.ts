import { AudioFeedback } from "./audio";
import { ClientError, safeError } from "./api";
import { authorizeDiscord, type DiscordSession } from "./discord";
import { HapticFeedback } from "./haptics";
import { CONTROL_HELP } from "./input/bindings";
import { InputController } from "./input/input";
import { EventDeduplicator } from "./interpolation";
import { NetworkController } from "./network";
import { FightRenderer } from "./render/renderer";
import { SettingsStore, type BloodLevel } from "./settings";
import { initialState, reduceState, type GameState } from "./state";
import type { EngineSnapshot, ServerMessage } from "./types";

const CONTACT_FEEDBACK_KINDS = new Set(["hit", "counter_hit", "block", "perfect_block", "guard_break", "knockdown"]);

export class HandsApp {
  private state: GameState = initialState;
  private readonly settings = new SettingsStore();
  private readonly input = new InputController();
  private readonly audio = new AudioFeedback(() => this.settings.current);
  private readonly haptics = new HapticFeedback(() => this.settings.current);
  private readonly feedbackEvents = new EventDeduplicator();
  private renderer: FightRenderer | null = null;
  private network: NetworkController | null = null;
  private session: DiscordSession | null = null;
  private abort = new AbortController();
  private destroyed = false;
  private generation = 0;
  private reloadOnRetry = false;

  private readonly canvas: HTMLCanvasElement;
  private readonly status: HTMLElement;
  private readonly roleIndicator: HTMLElement;
  private readonly controlsButton: HTMLButtonElement;
  private readonly controlsPanel: HTMLElement;
  private readonly retry: HTMLButtonElement;
  private readonly fightSummary: HTMLElement;
  private readonly liveFightStatus: HTMLElement;
  private readonly finalSummary: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly reloadPage: () => void = () => window.location.reload(),
  ) {
    root.innerHTML = `<section class="activity" aria-label="Hands boxing activity"><canvas class="fight" aria-label="Authoritative two-player boxing match"></canvas><header class="topbar"><strong>HANDS</strong><span>authoritative two-player boxing</span><span class="spectator-role" data-role hidden>SPECTATING · READ ONLY</span><button type="button" data-controls aria-expanded="false">Controls</button><button type="button" data-settings aria-expanded="false">Settings</button></header><section class="overlay" data-overlay><p class="status" data-status></p><button type="button" class="primary" data-retry hidden>Retry securely</button></section><aside class="panel" data-controls-panel hidden aria-label="Controls"><h2>Controls</h2><ul>${CONTROL_HELP.map((item) => `<li>${item}</li>`).join("")}</ul></aside><aside class="panel settings" data-settings-panel hidden aria-label="Accessibility and feedback settings"><h2>Settings</h2><label>Volume <input data-volume type="range" min="0" max="1" step="0.05"></label><label><input data-haptics type="checkbox"> Haptics</label><label><input data-motion type="checkbox"> Reduced motion</label><label>Blood <select data-blood><option value="full">Full (arcade gore)</option><option value="reduced">Reduced</option><option value="off">Off</option></select></label><p class="model-credit"><a href="https://sketchfab.com/3d-models/boxer-84767168720948b38728ff78ee6f6090" target="_blank" rel="noreferrer">“Boxer” by Texel, Inc.</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a> · modified</p></aside><section class="sr-summary" data-fight-summary aria-label="Fight summary"></section><p class="sr-summary" data-fight-status role="status" aria-live="polite" aria-atomic="true"></p><section class="sr-summary" data-final aria-live="polite" aria-label="Final result"></section></section>`;
    this.canvas = root.querySelector<HTMLCanvasElement>("canvas")!;
    this.status = root.querySelector<HTMLElement>("[data-status]")!;
    this.roleIndicator = root.querySelector<HTMLElement>("[data-role]")!;
    this.controlsButton = root.querySelector<HTMLButtonElement>("[data-controls]")!;
    this.controlsPanel = root.querySelector<HTMLElement>("[data-controls-panel]")!;
    this.retry = root.querySelector<HTMLButtonElement>("[data-retry]")!;
    this.fightSummary = root.querySelector<HTMLElement>("[data-fight-summary]")!;
    this.liveFightStatus = root.querySelector<HTMLElement>("[data-fight-status]")!;
    this.finalSummary = root.querySelector<HTMLElement>("[data-final]")!;
    this.retry.addEventListener("click", this.onRetry);
    this.bindPanels();
    this.syncSettings();
  }

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
    this.abort.abort();
    this.abort = new AbortController();
    this.state = initialState;
    this.feedbackEvents.reset();
    this.input.setActive(false);
    this.input.reset();
    this.finalSummary.textContent = "";
    this.fightSummary.textContent = "";
    this.liveFightStatus.textContent = "";
  }

  private async authorize(): Promise<void> {
    const generation = ++this.generation;
    this.resetForAuthorization();
    this.dispatch({ type: "connecting" });
    this.setText(this.status, "Securing Discord Activity session…");
    this.retry.hidden = true;
    try {
      const session = await authorizeDiscord(this.abort.signal);
      if (this.destroyed || generation !== this.generation) {
        session.destroy();
        return;
      }
      this.session = session;
      this.dispatch({ type: "bootstrap", simulation: session.bootstrap.simulation });
      this.dispatch({ type: "authorized", player: session.player });
      this.renderer = new FightRenderer(this.canvas, session.bootstrap.simulation, () => this.settings.current);
      this.renderer.onContact = (event) => {
        this.audio.event(event);
        this.haptics.event(event);
      };
      this.renderer.onArcadeInjury = (injury) => this.audio.injury(injury);
      this.input.onAction((action) => this.renderer?.predictAction?.(action));
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

  private receive(message: ServerMessage): void {
    if (message.type === "error") {
      this.fail(message.code);
      return;
    }
    this.dispatch({ type: "message", message });
    if (message.type === "snapshot") this.receiveSnapshot(message.payload);
    if (message.type === "final") {
      this.renderer?.setFinal(message);
      this.audio.result(message);
    }
    this.renderer?.setPlayers(this.state.players, this.state.playerId);
    this.renderer?.setReconnect(this.state.reconnectMs);
    this.renderState();
  }

  private receiveSnapshot(snapshot: EngineSnapshot): void {
    this.renderer?.push(snapshot);
    const viewer = snapshot.fighters.find((fighter) => fighter.player_id === this.state.playerId);
    this.input.setKnockdown(viewer?.is_downed === true);
    if (viewer !== undefined) {
      this.audio.snapshot(snapshot.tick, viewer.stamina, viewer.maximum_stamina, viewer.trauma.head + viewer.trauma.body);
    }
    for (const event of this.feedbackEvents.accept(snapshot.events)) {
      if (CONTACT_FEEDBACK_KINDS.has(event.kind)) continue;
      this.audio.event(event);
      this.haptics.event(event);
    }
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
      waiting: "Waiting for one opponent to use Play now in this channel.",
      countdown: "Bout countdown.",
      fight: `Round ${this.state.snapshot?.round_number ?? 1} in progress.`,
      knockdown: `Knockdown count ${this.state.snapshot?.fighters.find((fighter) => fighter.player_id === this.state.playerId)?.get_up_count ?? 0}.`,
      foul_recovery: "Foul recovery in progress.",
      rest: "Between-round rest.",
      paused: `Connection paused. ${Math.ceil(this.state.reconnectMs / 1000)} seconds remain.`,
      complete: "Bout complete. Scorecards and rating changes are displayed.",
      fatal: `Unable to continue (${this.state.safeError ?? "safe_error"}).`,
    };
    const spectating = this.state.role === "spectator";
    this.setText(this.status, spectating ? `Spectating — ${labels[this.state.stage]}` : labels[this.state.stage]);
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
    this.retry.hidden = this.state.stage !== "fatal";
    const active = !spectating && ["countdown", "fight", "knockdown", "foul_recovery"].includes(this.state.stage);
    this.input.setActive(active);
    this.network?.setActive(active);
    this.renderFightSummary();
    if (this.state.final !== null) {
      const final = this.state.final;
      this.setText(this.finalSummary, `${final.method.replaceAll("_", " ")}. ${final.winner_id === null ? "Draw" : `${this.state.players[final.winner_id]?.name ?? "Winner"} wins`}. Scorecards: ${final.scorecards.map((card) => `${card.judge}: ${card.player_one.reduce((a, b) => a + b, 0)} to ${card.player_two.reduce((a, b) => a + b, 0)}`).join("; ")}. Ratings: ${Object.entries(final.ratings).map(([id, rating]) => `${this.state.players[id]?.name ?? "fighter"} ${rating.before} to ${rating.after}`).join("; ")}.`);
    }
  }

  private renderFightSummary(): void {
    const snapshot = this.state.snapshot;
    if (snapshot === null) return;
    const tickRate = this.state.simulation?.tick_rate ?? 30;
    const seconds = Math.floor(snapshot.phase_ticks_remaining / tickRate);
    const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    const fighters = snapshot.fighters.map((fighter) => {
      const player = this.state.players[fighter.player_id];
      return `${player?.name ?? "Fighter"}, ELO ${player?.rating ?? "unknown"}, stamina ${Math.round(fighter.stamina)} of ${Math.round(fighter.maximum_stamina)}, guard ${Math.round(fighter.guard)}, poise ${Math.round(fighter.poise)}, conditioning ${Math.round(fighter.conditioning)}, ${fighter.warnings} warnings, ${fighter.knockdowns} knockdowns`;
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
    this.root.querySelector<HTMLInputElement>("[data-volume]")!.addEventListener("input", (event) => {
      this.settings.update({ volume: Number((event.target as HTMLInputElement).value) });
      this.audio.setVolume();
    });
    this.root.querySelector<HTMLInputElement>("[data-haptics]")!.addEventListener("change", (event) => {
      this.settings.update({ haptics: (event.target as HTMLInputElement).checked });
    });
    this.root.querySelector<HTMLInputElement>("[data-motion]")!.addEventListener("change", (event) => {
      const reducedMotion = (event.target as HTMLInputElement).checked;
      this.settings.update({ reducedMotion });
      this.renderer?.setReducedMotion(reducedMotion);
    });
    this.root.querySelector<HTMLSelectElement>("[data-blood]")!.addEventListener("change", (event) => {
      const blood = (event.target as HTMLSelectElement).value as BloodLevel;
      this.settings.update({ blood });
      this.renderer?.setBloodLevel(blood);
    });
  }

  private syncSettings(): void {
    const settings = this.settings.current;
    this.root.querySelector<HTMLInputElement>("[data-volume]")!.value = String(settings.volume);
    this.root.querySelector<HTMLInputElement>("[data-haptics]")!.checked = settings.haptics;
    this.root.querySelector<HTMLInputElement>("[data-motion]")!.checked = settings.reducedMotion;
    this.root.querySelector<HTMLSelectElement>("[data-blood]")!.value = settings.blood;
  }

  private fail(code: string): void {
    this.dispatch({ type: "fatal", code });
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
    this.renderer?.destroy();
    this.input.destroy();
    this.audio.destroy();
    this.settings.destroy();
    this.retry.removeEventListener("click", this.onRetry);
    this.root.replaceChildren();
  }
}
