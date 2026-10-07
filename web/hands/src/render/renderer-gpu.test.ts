import * as THREE from "three";
import type { Settings } from "../settings";
import { attachFakeWebGl, type FakeWebGl } from "../test/webgl";
import { FightRenderer } from "./renderer";

/** The renderer's private parts a test drives or inspects. */
interface Internals {
  readonly renderer: THREE.WebGLRenderer;
  readonly scaler: { scale: number };
  applyResolutionScale(): void;
  readonly keyLight: THREE.SpotLight;
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

async function mount(settings: Partial<Settings> = {}): Promise<{ gl: FakeWebGl; fight: FightRenderer; internals: Internals }> {
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const gl = attachFakeWebGl(canvas);
  const current: Settings = { volume: 0, haptics: false, reducedMotion: false, blood: "full", ...settings };
  const fight = new FightRenderer(canvas, undefined, () => current, { manualClock: true });
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
