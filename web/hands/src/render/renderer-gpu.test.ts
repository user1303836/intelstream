import * as THREE from "three";
import type { Settings } from "../settings";
import { fighter, snapshot } from "../test/fixtures";
import type { CombatEvent, FighterSnapshot, FinalMessage, MatchResult } from "../types";
import { attachFakeWebGl, type FakeWebGl } from "../test/webgl";
import type { Effects3D } from "./effects";
import type { BoxingGraph } from "./graph";
import { FightRenderer } from "./renderer";

/** The renderer's private parts a test drives or inspects. */
interface Internals {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly scaler: { scale: number };
  applyResolutionScale(): void;
  readonly keyLight: THREE.SpotLight;
  readonly effects: Effects3D;
  readonly graphs: readonly [BoxingGraph, BoxingGraph];
  restoreAllInjuries(): void;
  applyArcadeInjury(index: number, injury: string, event: CombatEvent): boolean;
  knockOutMouthpiece(index: number, direction: number, eventId: number, again: boolean): void;
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
function land(fight: FightRenderer, tick: number, events: readonly CombatEvent[], fighters: readonly [FighterSnapshot, FighterSnapshot], result: MatchResult | null = null): void {
  fight.push({ ...snapshot(tick), fighters, events, result });
  fight.push({ ...snapshot(tick + 1), fighters, result });
}

/** Fighter one knocking fighter two out on `tick`: severed parts are finishers, done by the punch that ends the bout. */
const knockout = (tick: number): MatchResult => ({
  match_id: "m", activity_instance_id: "a", guild_id: "g", player_one_id: "one", player_two_id: "two", winner_id: "one", finish_method: "ko",
  round_number: 1, tick, scorecards: [], player_one_knockdowns: 0, player_two_knockdowns: 1, player_one_damage: 0, player_two_damage: 900,
});

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
  const current: Settings = { volume: 0, haptics: false, reducedMotion: false, blood: "full", commentary: false, announcer: false, camera: "broadcast", ...settings };
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

describe("spray direction", () => {
  it("throws the blood and the severed head along the punch when the fighters face each other along y", async () => {
    const { fight, internals } = await mount();
    let time = settle(fight);
    // One at (0, -60) punches two at (0, 60), towards world -z; the event still carries the engine's
    // world-x sign, +1.
    const fighters = [
      { ...fighter("one"), x: 0, y: -60, facing_x: 0, facing_y: 1000, action_key: "straight:right:head:normal", action_contact_tick: 20 },
      { ...fighter("two"), x: 0, y: 60, facing_x: 0, facing_y: -1000, is_downed: true },
    ] as const;
    land(fight, 20, [punch(40, 20)], fighters, knockout(20));
    // The blood and the head leave from where they burst, the head's bone and the mouth, which stand
    // off the fighter's feet in his stance, so their flight is measured from there.
    const blood = (): { x: number; z: number; count: number } => {
      const positions = internals.effects.dropletBuffers.position;
      const colors = internals.effects.dropletBuffers.color;
      let x = 0;
      let z = 0;
      let count = 0;
      for (let index = 0; index < positions.count; index += 1) {
        if (positions.getY(index) < -10 || colors.getY(index) >= 0.2) continue;
        x += positions.getX(index);
        z += positions.getZ(index);
        count += 1;
      }
      return { x: x / Math.max(1, count), z: z / Math.max(1, count), count };
    };
    fight.labFrame((time += 1 / 60));
    const start = blood();
    const headStart = new THREE.Vector3();
    expect(internals.effects.severedHeadPosition(1, headStart)).toBe(true);
    for (let frame = 1; frame < 18; frame += 1) fight.labFrame((time += 1 / 60));
    expect(internals.effects.activeHeads).toBe(1);
    const end = blood();
    expect(end.count).toBeGreaterThan(50);
    expect(end.z - start.z).toBeLessThan(-0.15);
    expect(Math.abs(end.x - start.x)).toBeLessThan(Math.abs(end.z - start.z) / 2);
    const head = new THREE.Vector3();
    internals.effects.severedHeadPosition(1, head);
    expect(head.z - headStart.z).toBeLessThan(-0.2);
    expect(Math.abs(head.x - headStart.x)).toBeLessThan(Math.abs(head.z - headStart.z));
  });
});

describe("knockdown punch", () => {
  it("leaves the punch's own dent in the face, not the knockdown's minimum one", async () => {
    const { fight, internals } = await mount({ blood: "reduced" });
    const time = settle(fight);
    const hit = { ...punch(51, 20), amount: 90 };
    const knockdown: CombatEvent = { ...hit, event_id: 52, kind: "knockdown", amount: 1, detail: "", blood: 0, direction: 0, action_id: null };
    land(fight, 20, [hit, knockdown], exchange(20, "head", true));
    fight.labFrame(time + 0.1);
    // A straight to the head dents the mouth 1.1 cm, plus up to 2.1 cm more as the damage nears the engine's hardest hit (150).
    expect(internals.graphs[1].boxer.headInjury.impactDepth).toBeCloseTo(1.1 + (2.1 * hit.amount) / 150, 2);
  });
});

describe("stoppage without a replay", () => {
  it("cuts to the finish only once the punch that ended the bout is on screen", async () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    // A stoppage is replayed in slow motion unless motion is reduced; then it cuts straight to the finish.
    const { fight } = await mount({ reducedMotion: true }, false);
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
  it("are compiled before the first bloody hit, decapitation, severed hand, burst head, gouged eye and lost gum shield", async () => {
    const { gl, fight, internals } = await mount();
    let time = settle(fight);
    const programs = gl.created.programs;
    // A straight on an open cut, the bleeding behind most of its blood, splashes the canvas as it lands.
    land(fight, 20, [{ ...punch(41, 20), amount: 90, blood: 60 }], exchange(20, "head"));
    fight.labFrame((time += 0.1));
    expect(internals.effects.canvasStains).toBeGreaterThan(0);
    land(fight, 22, [punch(42, 22)], exchange(22, "head", true), knockout(22));
    fight.labFrame((time += 0.1));
    expect(internals.effects.activeHeads).toBe(1);
    internals.restoreAllInjuries();
    land(fight, 24, [punch(44, 24, "hook:body")], exchange(24, "body", true), knockout(24));
    fight.labFrame((time += 0.1));
    expect(internals.effects.activeHands).toBe(1);
    // The other finishers, whatever punch earns them, and the gum shield a big punch knocks out.
    internals.restoreAllInjuries();
    expect(internals.applyArcadeInjury(1, "head_burst", punch(46, 26))).toBe(true);
    fight.labFrame((time += 0.1));
    expect(internals.effects.headBurst(1)).toBe(true);
    internals.restoreAllInjuries();
    expect(internals.applyArcadeInjury(1, "eye_left", punch(47, 27))).toBe(true);
    fight.labFrame((time += 0.1));
    expect(internals.effects.eyeOut(1)).toBe(true);
    internals.knockOutMouthpiece(1, 1, 48, false);
    fight.labFrame((time += 0.1));
    expect(internals.effects.mouthpieceOut(1)).toBe(true);
    fight.labFrame((time += 0.1));
    expect(gl.created.programs).toBe(programs);
  });
});
