import { REST_CORNER_OFFSET } from "./manifest";
import * as THREE from "three";
import { SharedActionIntent } from "./input/action-buffer";
import { TouchInput, coarsePointer } from "./input/touch";
import { FightRenderer } from "./render/renderer";
import { CAMERA_MODES } from "./settings";
import type { CombatEvent, EngineSnapshot, FighterSnapshot, PublicPlayer } from "./types";

type Draft = { -readonly [K in keyof FighterSnapshot]: FighterSnapshot[K] };

const base = (id: string): Draft => ({
  player_id: id, x: 0, y: 0, facing: id === "fixture-one" ? 1 : -1, facing_x: id === "fixture-one" ? 1000 : -1000, facing_y: 0, velocity_x: 0, velocity_y: 0,
  stance: id === "fixture-one" ? "orthodox" : "southpaw", defense: "guard_high",
  stamina: 760, maximum_stamina: 1000, conditioning: 820, guard: 670, poise: 520,
  trauma: id === "fixture-two"
    ? { head: 420, body: 640, left_eye: 430, right_eye: 210, left_cut: 330, right_cut: 170, swelling: 280, bleeding: 380 }
    : { head: 150, body: 260, left_eye: 120, right_eye: 60, left_cut: 90, right_cut: 20, swelling: 100, bleeding: 70 },
  knockdowns: 0, warnings: 0, deductions: 0, stunned_ticks: 0, is_downed: false,
  action: null, action_hand: null, action_target: null, action_power: null, action_id: null, action_key: null, action_start_tick: 0, action_startup_ticks: 0, action_active_ticks: 0, action_recovery_ticks: 0, action_contact_tick: null, queued_actions: 0,
  clinch_startup_ticks: 0, clinch_ticks: 0, is_foul_recovery_target: false, taunt_ticks: 0,
  get_up_prompt: null, get_up_meter: 0, get_up_required: 0, get_up_count: 0, get_up_window_start_tick: 0, get_up_window_end_tick: 0,
  last_input_sequence: -1,
});

const PUNCHES = ["jab", "straight", "hook", "uppercut"] as const;

export function runDevelopmentFixture(root: HTMLElement): () => void {
  root.innerHTML = `<section class="activity"><canvas class="fight"></canvas><header class="topbar"><strong>HANDS · DEV FIXTURE</strong><span>Production never enters this harness</span></header></section>`;
  const bloodParam = new URLSearchParams(window.location.search).get("blood");
  const blood = bloodParam === "reduced" || bloodParam === "off" ? bloodParam : "full";
  const cameraParam = new URLSearchParams(window.location.search).get("camera");
  const camera = CAMERA_MODES.find((mode) => mode === cameraParam) ?? "broadcast";
  const renderer = new FightRenderer(
    root.querySelector("canvas")!,
    { tick_rate: 30, ring_half_width: 500, ring_half_height: 500 },
    () => ({ volume: 0, haptics: false, reducedMotion: false, blood, camera }),
  );
  renderer.setBloodLevel(blood);
  // `avatars=<discord id>:<avatar hash>,<discord id>:<avatar hash>` draws real pictures on the plates.
  const pictured = (new URLSearchParams(window.location.search).get("avatars") ?? "").split(",").map((entry) => entry.split(":"));
  const players: Record<string, PublicPlayer> = {
    "fixture-one": { id: pictured[0]?.[0] || "fixture-one", name: "Azure Vector", avatar: pictured[0]?.[1] || null, rating: 1512, connected: true },
    "fixture-two": { id: pictured[1]?.[0] || "fixture-two", name: "Crimson Geometry", avatar: pictured[1]?.[1] || null, rating: 1494, connected: true },
  };
  renderer.setPlayers(players, "fixture-one");
  const touch = coarsePointer() ? new TouchInput(root.querySelector<HTMLElement>(".activity")!, new SharedActionIntent()) : null;

  let tick = 0;
  let eventId = 0;
  let finalSent = false;
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
    const gap = Math.hypot(two.x - one.x, two.y - one.y) || 1;
    one.facing_x = Math.round(((two.x - one.x) / gap) * 1000);
    one.facing_y = Math.round(((two.y - one.y) / gap) * 1000);
    two.facing_x = -one.facing_x;
    two.facing_y = -one.facing_y;
    one.velocity_x = Math.cos(orbit) * 48;
    two.velocity_x = Math.cos(orbit + 0.25) * 48;
    const events: CombatEvent[] = [];
    const cycle = t % 3.2;
    const attacker = Math.floor(t / 3.2) % 2 === 0 ? one : two;
    const defender = attacker === one ? two : one;
    const tauntCycle = t % 12;
    if (tauntCycle > 7.5 && tauntCycle < 9.5) {
      one.taunt_ticks = Math.round((9.5 - tauntCycle) * 30);
      one.action = null;
    }
    const closing = tauntCycle > 1.6 && tauntCycle < 5.1;
    if (closing) {
      two.x = Math.round(one.x + one.facing_x * 0.06);
      two.y = Math.round(one.y + one.facing_y * 0.06);
      one.velocity_x = two.velocity_x = 0;
      if (tauntCycle > 3.6) one.clinch_ticks = two.clinch_ticks = Math.round((5.1 - tauntCycle) * 30);
    }
    if (cycle < 0.55 && one.taunt_ticks === 0 && two.taunt_ticks === 0 && !closing) {
      const punch = PUNCHES[Math.floor(t / 3.2) % PUNCHES.length]!;
      attacker.action = punch;
      attacker.action_hand = Math.floor(t / 3.2) % 3 === 0 ? "right" : "left";
      attacker.action_target = Math.floor(t / 3.2) % 4 === 1 ? "body" : "head";
      attacker.action_power = Math.floor(t / 3.2) % 5 === 2 ? "power" : "normal";
      defender.defense = Math.floor(t / 6.4) % 2 === 0 ? "guard_high" : "none";
      if (cycle > 0.2 && cycle < 0.3) {
        eventId += 1;
        events.push({ event_id: eventId, tick, kind: "hit", actor_id: attacker.player_id, target_id: defender.player_id, amount: 210, detail: `${attacker.action_hand}:${punch}:${attacker.action_target}`, blood: 100, direction: attacker.facing, action_id: null });
        defender.stunned_ticks = 12;
      }
    }
    const search = new URLSearchParams(window.location.search);
    const finisher = search.get("finisher");
    const forcedRest = search.get("phase") === "rest";
    const pinned = search.get("pin") === "1";
    const knockdownCycle = finisher === null ? t % 14 : (t < 2.5 ? 0 : 12);
    if (knockdownCycle > 11 && knockdownCycle < 13.4) {
      two.is_downed = true;
      two.action = null;
      two.x = 140;
      two.y = 40;
      one.x = -60;
      one.y = -30;
      const trigger = finisher === null ? knockdownCycle > 11 && knockdownCycle < 11.15 : t >= 2.5 && t < 2.65;
      if (trigger) {
        eventId += 1;
        if (finisher !== null && eventId % 2 === 1) eventId += 1;
        events.push({ event_id: eventId, tick, kind: "counter_hit", actor_id: one.player_id, target_id: two.player_id, amount: 500, detail: finisher === "hand" ? "left:hook:body" : "right:uppercut:head", blood: 100, direction: 1, action_id: null });
        eventId += 1;
        events.push({ event_id: eventId, tick, kind: "knockdown", actor_id: one.player_id, target_id: two.player_id, amount: 420, detail: "knockdown", blood: 60, direction: 1, action_id: null });
      }
    }
    if (pinned) {
      two.x = 460;
      two.y = 40;
      one.x = 330;
      one.y = 20;
    }
    const fixedGap = Number(search.get("gap"));
    if (Number.isFinite(fixedGap) && fixedGap > 0) {
      one.x = -Math.round(fixedGap / 2);
      two.x = one.x + Math.round(fixedGap);
      one.y = two.y = 0;
      one.velocity_x = two.velocity_x = 0;
      one.facing_x = 1000;
      two.facing_x = -1000;
      one.facing_y = two.facing_y = 0;
    }
    if (search.get("pin") === "corner") {
      two.x = 366;
      two.y = 366;
      one.x = 292;
      one.y = 284;
    }
    if (forcedRest) {
      for (const [fighter, sign] of [[one, -1], [two, 1]] as const) {
        fighter.x = sign * REST_CORNER_OFFSET;
        fighter.y = sign * REST_CORNER_OFFSET;
        fighter.velocity_x = fighter.velocity_y = 0;
        fighter.facing_x = fighter.facing_y = -sign * 707;
        fighter.facing = -sign;
        fighter.action = null;
        fighter.taunt_ticks = fighter.stunned_ticks = 0;
        fighter.is_downed = false;
        fighter.defense = "none";
      }
      events.length = 0;
    }
    const decided = search.get("finish") === "decision" && t >= 3.4;
    if (decided) {
      for (const fighter of [one, two]) {
        fighter.action = null;
        fighter.velocity_x = fighter.velocity_y = 0;
        fighter.taunt_ticks = fighter.stunned_ticks = fighter.clinch_ticks = 0;
        fighter.is_downed = false;
        fighter.defense = "none";
      }
      events.length = 0;
    }
    const snapshot: EngineSnapshot = {
      tick, phase: decided ? "complete" : forcedRest ? "rest" : "fight", round_number: 3, phase_ticks_remaining: decided ? 0 : Math.max(0, 5400 - tick),
      fighters: [{ ...one }, { ...two }], events, result: null, checksum: "a".repeat(64),
    };
    renderer.push(snapshot);
    if (decided && !finalSent) {
      finalSent = true;
      const winner = search.get("winner") === "two" ? two : one;
      const cards = ["Impact", "Craft", "Generalship"].map((judge) => ({ judge, player_one: winner === one ? [10, 10, 10] : [9, 9, 10], player_two: winner === one ? [9, 9, 10] : [10, 10, 10] }));
      renderer.setFinal({
        version: 3, type: "final", match_id: "fixture", winner_id: search.get("winner") === "none" ? null : winner.player_id, method: search.get("winner") === "none" ? "draw" : "decision", round: 3,
        scorecards: search.get("winner") === "none" ? cards.map((card) => ({ ...card, player_one: [10, 10, 10], player_two: [10, 10, 10] })) : cards,
        ratings: { [one.player_id]: { before: 1512, after: winner === one ? 1528 : 1496 }, [two.player_id]: { before: 1494, after: winner === one ? 1478 : 1510 } },
      });
    }
    if (finisher !== null && t >= 3.4 && !finalSent) {
      finalSent = true;
      renderer.setFinal({ version: 3, type: "final", match_id: "fixture", winner_id: one.player_id, method: "ko", round: 3, scorecards: [], ratings: {} });
    }
    (window as unknown as Record<string, unknown>).__fixtureRenderer = renderer;
    (window as unknown as Record<string, unknown>).__fixtureDebug = {
      tick,
      t: Number(t.toFixed(2)),
      downed: two.is_downed,
      severedHeads: renderer.labEffects.activeHeads,
      severedHands: renderer.labEffects.activeHands,
      rigs: renderer.labRigs.length,
      resolutionScale: renderer.resolutionScale,
      heads: renderer.labRigs.map((root) => {
        const head = root.getObjectByName("Head_00");
        return head === undefined ? null : Number(head.getWorldPosition(new THREE.Vector3()).y.toFixed(3));
      }),
    };
  }, 100);

  return () => {
    window.clearInterval(interval);
    touch?.destroy();
    renderer.destroy();
    root.replaceChildren();
  };
}
