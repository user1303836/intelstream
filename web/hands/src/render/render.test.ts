import { projectRing, resizeHighDpi } from "./geometry";
import { drawFighter, fighterPose } from "./fighters";
import { drawHud, HUD_MAX_GUARD, HUD_MAX_POISE, scoreTotal } from "./hud";
import { ParticlePool } from "./particles";
import { FightRenderer } from "./renderer";
import { fighter, publicPlayers, snapshot } from "../test/fixtures";
describe("original render geometry and bounded effects", () => {
  it("projects perspective depth and ring sides deterministically", () => { const sim = { tick_rate: 30, ring_half_width: 6000, ring_half_height: 4000 }; const left = projectRing(-6000, 4000, sim, { width: 1000, height: 600 }), right = projectRing(6000, 4000, sim, { width: 1000, height: 600 }), near = projectRing(0, -4000, sim, { width: 1000, height: 600 }); expect(left.x).toBeLessThan(right.x); expect(near.scale).toBeGreaterThan(left.scale); expect(projectRing(0, 0, sim, { width: 1000, height: 600 })).toEqual(projectRing(0, 0, sim, { width: 1000, height: 600 })); });
  it("caps pooled blood, canvas marks, and shake", () => { const pool = new ParticlePool(10, 2); for (let id = 0; id < 20; id += 1) pool.addEvent({ event_id: id, tick: 1, kind: "hit", actor_id: "one", target_id: "two", amount: 1000, detail: "head", blood: 1000, direction: 1 }, { x: 10, y: 10 }, "full", false); expect(pool.counts).toEqual({ particles: 10, marks: 2 }); expect(Math.abs(pool.cameraOffset(1, false).x)).toBeLessThanOrEqual(9); pool.clearBlood(); expect(pool.counts).toEqual({ particles: 0, marks: 0 }); });
  it("suppresses blood and motion without losing score information", () => { const pool = new ParticlePool(); pool.addEvent({ event_id: 1, tick: 1, kind: "hit", actor_id: null, target_id: null, amount: 100, detail: "", blood: 100, direction: 1 }, { x: 0, y: 0 }, "full", true); expect(pool.counts.particles).toBe(0); expect(pool.cameraOffset(1, true)).toEqual({ x: 0, y: 0 }); expect(scoreTotal([10, 9, 10])).toBe(29); });
  it("caps high-DPI canvas allocation", () => { const canvas = document.createElement("canvas"); const resized = resizeHighDpi(canvas, 2); expect(resized?.dpr).toBeLessThanOrEqual(2); expect(canvas.width).toBe(1600); });
  it("cancels renderer animation immediately and cannot reschedule from a stale callback", () => {
    const callbacks: FrameRequestCallback[] = [];
    const request = vi.fn((callback: FrameRequestCallback) => { callbacks.push(callback); return callbacks.length; });
    const cancel = vi.fn();
    const originalRequest = globalThis.requestAnimationFrame;
    const originalCancel = globalThis.cancelAnimationFrame;
    Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, writable: true, value: request });
    Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, writable: true, value: cancel });
    try {
      const renderer = new FightRenderer(document.createElement("canvas"), { tick_rate: 30, ring_half_width: 500, ring_half_height: 330 }, () => ({ volume: 0, haptics: false, reducedMotion: false, blood: "off" }));
      expect(request).toHaveBeenCalledOnce();
      renderer.destroy();
      expect(cancel).toHaveBeenCalledWith(1);
      callbacks[0]!(16);
      expect(request).toHaveBeenCalledOnce();
      renderer.destroy();
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, writable: true, value: originalRequest });
      Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, writable: true, value: originalCancel });
    }
  });
  it("draws all authoritative phases, defenses and punch poses without mutating state", () => { const ctx = document.createElement("canvas").getContext("2d")!; const base = fighter("one"), serialized = JSON.stringify(base); for (const phase of ["countdown", "fight", "knockdown", "foul_recovery", "rest", "complete"] as const) for (const defense of ["none", "guard_high", "guard_low", "slip_left", "slip_right", "weave", "pull"] as const) for (const action of [null, "jab", "straight", "hook", "uppercut"] as const) expect(() => drawFighter(ctx, { ...base, defense, action, action_hand: action === null ? null : "left", action_target: action === null ? null : "body", action_power: action === null ? null : "power", is_downed: phase === "knockdown", get_up_count: 0 }, { x: 100, y: 200, scale: 1 }, phase, { skin: "#965", trunks: "#126", glove: "#a33", accent: "#fc8" }, 1)).not.toThrow(); expect(JSON.stringify(base)).toBe(serialized); });
  it("uses distinct punch, stance, and bodily foul-recovery geometry", () => {
    const base = fighter("one");
    const jab = fighterPose({ ...base, action: "jab", action_hand: "left", action_target: "head", action_power: "normal" });
    const straight = fighterPose({ ...base, action: "straight", action_hand: "left", action_target: "head", action_power: "normal" });
    expect(straight.leftGlove.x).toBeGreaterThan(jab.leftGlove.x);
    expect(straight.torsoShift).toBeGreaterThan(jab.torsoShift);
    expect(straight.torsoLean).not.toBe(jab.torsoLean);
    const orthodox = fighterPose({ ...base, stance: "orthodox" });
    const southpaw = fighterPose({ ...base, stance: "southpaw" });
    expect(orthodox.leftFoot.x).toBeGreaterThan(orthodox.rightFoot.x);
    expect(southpaw.rightFoot.x).toBeGreaterThan(southpaw.leftFoot.x);
    expect(orthodox.leftGlove).toEqual(southpaw.rightGlove);
    const foulRecovery = fighterPose({ ...base, is_foul_recovery_target: true });
    expect(foulRecovery.leftGlove.y).toBeGreaterThan(orthodox.leftGlove.y);
    expect(foulRecovery.rightGlove.y).toBeGreaterThan(orthodox.rightGlove.y);
    expect(foulRecovery).toMatchObject({ torsoShift: -3, torsoDrop: 9, torsoLean: -0.075 });
  });
  it("keeps opponent get-up timing private while exposing the viewer prompt", () => { const texts: string[] = []; const ctx = { save: () => {}, restore: () => {}, fillRect: () => {}, fillText: (text: string) => texts.push(text), measureText: (text: string) => ({ width: text.length * 7 }), set fillStyle(_value: string) {}, set font(_value: string) {}, set textAlign(_value: CanvasTextAlign) {}, set textBaseline(_value: CanvasTextBaseline) {} } as unknown as CanvasRenderingContext2D; const players = Object.fromEntries(publicPlayers.map((p) => [p.id, p])); const base = snapshot(); const opponentPrompt = { ...base, phase: "knockdown" as const, fighters: [base.fighters[0], { ...base.fighters[1], get_up_prompt: "get_up_left" as const, get_up_count: 4 }] as const }; drawHud(ctx, 800, 600, opponentPrompt, players, "one", null, 0); expect(texts.join(" ")).not.toContain("YOUR RHYTHM"); texts.length = 0; const ownPrompt = { ...opponentPrompt, fighters: [{ ...base.fighters[0], get_up_prompt: "get_up_right" as const, get_up_meter: 2, get_up_required: 4 }, opponentPrompt.fighters[1]] as const }; drawHud(ctx, 800, 600, ownPrompt, players, "one", null, 0); expect(texts.join(" ")).toContain("YOUR RHYTHM: →  2/4"); });
  it("scales fully replenished guard and poise to full HUD bars", () => {
    expect(HUD_MAX_GUARD).toBe(700);
    expect(HUD_MAX_POISE).toBe(600);
  });
  it("uses the bootstrap tick rate for the authoritative HUD clock", () => { const texts: string[] = []; const ctx = { save: () => {}, restore: () => {}, fillRect: () => {}, fillText: (text: string) => texts.push(text), measureText: (text: string) => ({ width: text.length * 7 }), set fillStyle(_value: string) {}, set font(_value: string) {}, set textAlign(_value: CanvasTextAlign) {}, set textBaseline(_value: CanvasTextBaseline) {} } as unknown as CanvasRenderingContext2D; const state = { ...snapshot(), phase_ticks_remaining: 1205 }; drawHud(ctx, 800, 600, state, Object.fromEntries(publicPlayers.map((player) => [player.id, player])), "one", null, 0, 20); expect(texts).toContain("1:00"); });
});
