import * as THREE from "three";
import type { Settings } from "../settings";
import { fighter, snapshot } from "../test/fixtures";
import type { CombatEvent, FighterSnapshot, FinalMessage, MatchResult } from "../types";
import { attachFakeWebGl, type FakeWebGl } from "../test/webgl";
import type { Effects3D } from "./effects";
import { FightRenderer } from "./renderer";

/** The renderer's private parts a test drives or inspects. */
interface Internals {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly scaler: { scale: number };
  applyResolutionScale(): void;
  readonly keyLight: THREE.SpotLight;
  readonly effects: Effects3D;
  restoreAllInjuries(): void;
}

const punch = (eventId: number, tick: number, detail = "straight:head"): CombatEvent => ({
  event_id: eventId, tick, kind: "hit", actor_id: "one", target_id: "two", amount: 420, detail, blood: 100, direction: 1, action_id: `punch-${eventId}`,
});

/** Fighter one landing a straight on fighter two at `tick`. */
const exchange = (tick: number, target: "head" | "body", downed = false): readonly [FighterSnapshot, FighterSnapshot] => [
  { ...fighter("one", -60), action_key: `straight:right:${target}:normal`, action_contact_tick: tick },
  { ...fighter("two", 60), is_downed: downed },
];

/** Pushes the snapshot carrying `events` and the next one, so the manual clock presents the contact. */
function land(fight: FightRenderer, tick: number, events: readonly CombatEvent[], fighters: readonly [FighterSnapshot, FighterSnapshot]): void {
  fight.push({ ...snapshot(tick), fighters, events });
  fight.push({ ...snapshot(tick + 1), fighters });
}

/** The graphics-card handle three made for a texture. */
const glTexture = (renderer: THREE.WebGLRenderer, texture: THREE.Texture | null | undefined): unknown =>
  texture === null || texture === undefined ? undefined : (renderer.properties.get(texture) as { __webglTexture?: unknown }).__webglTexture;

const mounted: FightRenderer[] = [];

/** Draws a few frames so everything the idle scene shows has been drawn once. */
function settle(fight: FightRenderer, from = 0): number {
  for (let frame = 1; frame <= 6; frame += 1) fight.labFrame(from + frame / 10);
  return from + 0.6;
}

async function mount(settings: Partial<Settings> = {}, manualClock = true): Promise<{ gl: FakeWebGl; fight: FightRenderer; internals: Internals }> {
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const gl = attachFakeWebGl(canvas);
  const current: Settings = { volume: 0, haptics: false, reducedMotion: false, blood: "full", ...settings };
  const fight = new FightRenderer(canvas, undefined, () => current, { manualClock });
  mounted.push(fight);
  await fight.ready;
  return { gl, fight, internals: fight as unknown as Internals };
}

afterEach(() => {
  for (const fight of mounted.splice(0)) fight.destroy();
  document.body.replaceChildren();
});

describe("quality tiers on the graphics card", () => {
  it("drops the key shadow at the low tier and brings it back without compiling a shader", async () => {
    const { gl, fight, internals } = await mount();
    const setScale = (scale: number): void => {
      internals.scaler.scale = scale;
      internals.applyResolutionScale();
    };
    const time = settle(fight);
    const programs = gl.created.programs;
    const key = internals.keyLight;
    const depth = glTexture(internals.renderer, key.shadow.map?.depthTexture);
    expect(gl.alive(depth)).toBe(true);
    setScale(0.55);
    fight.labFrame(time + 0.1);
    expect(gl.created.programs).toBe(programs);
    expect(key.castShadow).toBe(true);
    expect(key.shadow.intensity).toBe(0);
    // The shadow map is no longer drawn, and its depth target is freed.
    expect(key.shadow.map).toBeNull();
    expect(gl.alive(depth)).toBe(false);
    setScale(0.7);
    fight.labFrame(time + 0.2);
    expect(gl.created.programs).toBe(programs);
    expect(key.shadow.intensity).toBe(1);
    expect(key.shadow.map).not.toBeNull();
    expect(key.shadow.map?.width).toBe(1024);
  });
});

describe("stoppage without a replay", () => {
  it("cuts to the finish only once the punch that ended the bout is on screen", async () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const { fight } = await mount({}, false);
    const draw = (time: number): void => (fight as unknown as { draw(time: number): void }).draw(time);
    const presentFinish = vi.spyOn(fight as unknown as { presentFinish(final: FinalMessage): void }, "presentFinish");
    const shown: number[] = [];
    fight.onContact = (event) => shown.push(event.event_id);
    // Thirty ticks a second; the third knockdown ends the bout on tick 30, and the server stops there.
    const finisher = { ...punch(300, 30, "hook:head"), amount: 520 };
    const knockdown: CombatEvent = { ...finisher, event_id: 301, kind: "knockdown", amount: 3, detail: "", blood: 0, direction: 0, action_id: null };
    const result: MatchResult = {
      match_id: "m", activity_instance_id: "a", guild_id: "g", player_one_id: "one", player_two_id: "two", winner_id: "one", finish_method: "tko",
      round_number: 1, tick: 30, scorecards: [], player_one_knockdowns: 0, player_two_knockdowns: 3, player_one_damage: 0, player_two_damage: 900,
    };
    for (let tick = 1; tick <= 30; tick += 1) {
      now.mockReturnValue((tick * 1000) / 30);
      if (tick < 30) fight.push(snapshot(tick));
      else fight.push({ ...snapshot(30), phase: "complete", fighters: [{ ...exchange(30, "head")[0], action_key: "hook:left:head:power" }, { ...fighter("two", 60), is_downed: true, knockdowns: 3 }], events: [finisher, knockdown], result });
      draw((tick * 1000) / 30);
    }
    // The final message lands a moment after the result, while the screen is still two ticks behind it.
    fight.setFinal({ version: 3, type: "final", match_id: "m", winner_id: "one", method: "tko", round: 1, scorecards: [], ratings: {} });
    expect(presentFinish).not.toHaveBeenCalled();
    for (let time = 1000; time < 1500 && presentFinish.mock.calls.length === 0; time += 1000 / 60) {
      now.mockReturnValue(time);
      draw(time);
    }
    expect(presentFinish).toHaveBeenCalledOnce();
    expect(shown).toContain(finisher.event_id);
  });
});

describe("device pixel ratio", () => {
  const setDevicePixelRatio = (ratio: number): void => {
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: ratio });
  };
  afterEach(() => setDevicePixelRatio(2));

  it("follows a zoom or a move to another monitor, capped and scaled by the quality tier", async () => {
    const { fight, internals } = await mount();
    fight.labFrame(0.1);
    expect(internals.renderer.getPixelRatio()).toBe(2);
    setDevicePixelRatio(1.25);
    fight.labFrame(0.2);
    expect(internals.renderer.getPixelRatio()).toBe(1.25);
    setDevicePixelRatio(3);
    fight.labFrame(0.3);
    expect(internals.renderer.getPixelRatio()).toBe(2);
    internals.scaler.scale = 0.7;
    internals.applyResolutionScale();
    setDevicePixelRatio(1);
    fight.labFrame(0.4);
    expect(internals.renderer.getPixelRatio()).toBeCloseTo(0.7);
  });
});

describe("graphics memory across rematches on a shared context", () => {
  it("leaves nothing on the context but what three itself keeps per renderer", async () => {
    // A bare renderer's own leftovers: its state's placeholder textures and its copy framebuffers.
    const bareCanvas = document.createElement("canvas");
    const bare = attachFakeWebGl(bareCanvas);
    new THREE.WebGLRenderer({ canvas: bareCanvas }).dispose();
    const { gl, fight, internals } = await mount();
    const time = settle(fight);
    land(fight, 20, [punch(41, 20)], exchange(20, "head"));
    fight.labFrame(time + 0.1);
    expect(internals.effects.liveGibs).toBeGreaterThan(0);
    // Upload every canvas-drawn texture the scene uses, as drawing it on a real card does.
    internals.scene.traverse((object) => {
      for (const material of [(object as THREE.Mesh).material ?? []].flat()) {
        for (const value of Object.values(material)) if (value instanceof THREE.CanvasTexture) internals.renderer.initTexture(value);
      }
    });
    // The shadow map's depth material belongs to three and is never disposed.
    const threeOwned = internals.renderer.info.programs!.filter((program) => program.cacheKey.startsWith("depth,")).map((program) => (program as unknown as { program: unknown }).program);
    fight.destroy();
    const live = gl.live();
    expect(live.buffers).toBe(0);
    expect(live.vertexArrays).toBe(0);
    expect(live.renderbuffers).toBe(0);
    expect(live.textures).toBe(bare.live().textures);
    expect(live.framebuffers).toBe(bare.live().framebuffers);
    expect(live.programs).toBe(threeOwned.filter((program) => gl.alive(program)).length);
  });
});

describe("shaders for effects that start hidden", () => {
  it("are compiled before the first bloody hit, decapitation and severed hand", async () => {
    const { gl, fight, internals } = await mount();
    let time = settle(fight);
    const programs = gl.created.programs;
    land(fight, 20, [punch(41, 20)], exchange(20, "head"));
    fight.labFrame((time += 0.1));
    expect(internals.effects.visibleDecals).toBeGreaterThan(0);
    land(fight, 22, [punch(42, 22)], exchange(22, "head", true));
    fight.labFrame((time += 0.1));
    expect(internals.effects.activeHeads).toBe(1);
    internals.restoreAllInjuries();
    land(fight, 24, [punch(44, 24, "straight:body")], exchange(24, "body", true));
    fight.labFrame((time += 0.1));
    expect(internals.effects.activeHands).toBe(1);
    fight.labFrame((time += 0.1));
    expect(gl.created.programs).toBe(programs);
  });
});
