import { FightRenderer } from "./render/renderer";
import type { CombatEvent, EngineSnapshot, FighterSnapshot, PublicPlayer } from "./types";

type Draft = { -readonly [K in keyof FighterSnapshot]: FighterSnapshot[K] };

const base = (id: string): Draft => ({
  player_id: id, x: 0, y: 0, facing: id === "fixture-one" ? 1 : -1, velocity_x: 0, velocity_y: 0,
  stance: id === "fixture-one" ? "orthodox" : "southpaw", defense: "guard_high",
  stamina: 760, maximum_stamina: 1000, conditioning: 820, guard: 670, poise: 520,
  trauma: { head: 120, body: 160, left_eye: 110, right_eye: 60, left_cut: 70, right_cut: 20, swelling: 90, bleeding: 40 },
  knockdowns: 0, warnings: 0, deductions: 0, stunned_ticks: 0, is_downed: false,
  action: null, action_hand: null, action_target: null, action_power: null, queued_actions: 0,
  clinch_startup_ticks: 0, clinch_ticks: 0, is_foul_recovery_target: false,
  get_up_prompt: null, get_up_meter: 0, get_up_required: 0, get_up_count: 0, get_up_window_start_tick: 0, get_up_window_end_tick: 0,
});

const PUNCHES = ["jab", "straight", "hook", "uppercut"] as const;

export function runDevelopmentFixture(root: HTMLElement): () => void {
  root.innerHTML = `<section class="activity"><canvas class="fight"></canvas><header class="topbar"><strong>HANDS · DEV FIXTURE</strong><span>Production never enters this harness</span></header></section>`;
  const renderer = new FightRenderer(
    root.querySelector("canvas")!,
    { tick_rate: 30, ring_half_width: 500, ring_half_height: 330 },
    () => ({ volume: 0, haptics: false, reducedMotion: false, blood: "full" }),
  );
  const players: Record<string, PublicPlayer> = {
    "fixture-one": { id: "fixture-one", name: "Azure Vector", avatar: null, rating: 1512, connected: true },
    "fixture-two": { id: "fixture-two", name: "Crimson Geometry", avatar: null, rating: 1494, connected: true },
  };
  renderer.setPlayers(players, "fixture-one");

  let tick = 0;
  let eventId = 0;
  const interval = window.setInterval(() => {
    tick += 3;
    const t = tick / 30;
    const one = base("fixture-one");
    const two = base("fixture-two");
    const orbit = t * 0.22;
    one.x = Math.sin(orbit) * 260 - 120;
    one.y = Math.cos(orbit) * 150;
    two.x = Math.sin(orbit + 0.35) * 260 + 120;
    two.y = Math.cos(orbit + 0.35) * 150;
    one.facing = two.x >= one.x ? 1 : -1;
    two.facing = -one.facing;
    one.velocity_x = Math.cos(orbit) * 48;
    two.velocity_x = Math.cos(orbit + 0.25) * 48;
    const events: CombatEvent[] = [];
    const cycle = t % 3.2;
    const attacker = Math.floor(t / 3.2) % 2 === 0 ? one : two;
    const defender = attacker === one ? two : one;
    if (cycle < 0.55) {
      const punch = PUNCHES[Math.floor(t / 3.2) % PUNCHES.length]!;
      attacker.action = punch;
      attacker.action_hand = Math.floor(t / 3.2) % 3 === 0 ? "right" : "left";
      attacker.action_target = Math.floor(t / 3.2) % 4 === 1 ? "body" : "head";
      attacker.action_power = Math.floor(t / 3.2) % 5 === 2 ? "power" : "normal";
      defender.defense = Math.floor(t / 6.4) % 2 === 0 ? "guard_high" : "none";
      if (cycle > 0.2 && cycle < 0.3) {
        eventId += 1;
        events.push({ event_id: eventId, tick, kind: "hit", actor_id: attacker.player_id, target_id: defender.player_id, amount: 140, detail: `${punch}`, blood: 26, direction: attacker.facing });
        defender.stunned_ticks = 12;
      }
    }
    const knockdownCycle = t % 14;
    if (knockdownCycle > 11 && knockdownCycle < 13.4) {
      two.is_downed = true;
      two.action = null;
      two.x = 140;
      two.y = 40;
      one.x = -60;
      one.y = -30;
      if (knockdownCycle > 11 && knockdownCycle < 11.15) {
        eventId += 1;
        events.push({ event_id: eventId, tick, kind: "knockdown", actor_id: one.player_id, target_id: two.player_id, amount: 420, detail: "knockdown", blood: 60, direction: 1 });
      }
    }
    const snapshot: EngineSnapshot = {
      tick, phase: "fight", round_number: 3, phase_ticks_remaining: Math.max(0, 5400 - tick),
      fighters: [{ ...one }, { ...two }], events, result: null, checksum: "a".repeat(64),
    };
    renderer.push(snapshot);
  }, 100);

  return () => {
    window.clearInterval(interval);
    renderer.destroy();
    root.replaceChildren();
  };
}
