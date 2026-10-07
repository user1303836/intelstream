import type { EngineSnapshot, FighterSnapshot } from "../types";
export const fighter = (id: string, x = 0): FighterSnapshot => ({ player_id: id, x, y: 0, facing: id === "one" ? 1 : -1, facing_x: id === "one" ? 1000 : -1000, facing_y: 0, velocity_x: 0, velocity_y: 0, stance: "orthodox", defense: "none", stamina: 900, maximum_stamina: 1000, conditioning: 850, guard: 650, poise: 550, trauma: { head: 0, body: 0, left_eye: 0, right_eye: 0, left_cut: 0, right_cut: 0, swelling: 0, bleeding: 0 }, knockdowns: 0, warnings: 0, deductions: 0, stunned_ticks: 0, is_downed: false, action: null, action_hand: null, action_target: null, action_power: null, action_id: null, action_key: null, action_start_tick: 0, action_startup_ticks: 0, action_active_ticks: 0, action_recovery_ticks: 0, action_contact_tick: null, queued_actions: 0, clinch_startup_ticks: 0, clinch_ticks: 0, is_foul_recovery_target: false, taunt_ticks: 0, corner_choice: null, get_up_prompt: null, get_up_meter: 0, get_up_required: 0, get_up_count: 0, get_up_window_start_tick: 0, get_up_window_end_tick: 0, last_input_sequence: -1 });
export const snapshot = (tick = 10): EngineSnapshot => ({ tick, phase: "fight", round_number: 1, phase_ticks_remaining: 5000, fighters: [fighter("one", -100), fighter("two", 100)], events: [], result: null, checksum: "a".repeat(64) });
export const envelope = (tick = 10): Record<string, unknown> => ({ version: 3, type: "snapshot", payload: snapshot(tick) });
export const publicPlayers = [{ id: "one", name: "One", avatar: null, rating: 1500, connected: true }, { id: "two", name: "Two", avatar: null, rating: 1500, connected: true }] as const;

export interface DrawnPicture { image: unknown; x: number; y: number; width: number; height: number }

export function mockHudContext(texts: string[], drawn?: DrawnPicture[], arcs?: Array<{ x: number; y: number; radius: number }>): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} };
  return {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    closePath: () => {},
    arc: (x: number, y: number, radius: number) => arcs?.push({ x, y, radius }),
    clip: () => {},
    setTransform: () => {},
    drawImage: (image: unknown, x: number, y: number, width: number, height: number) => drawn?.push({ image, x, y, width, height }),
    moveTo: () => {},
    lineTo: () => {},
    fill: () => {},
    stroke: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    clearRect: () => {},
    fillText: (text: string) => texts.push(text),
    strokeText: () => undefined,
    measureText: (text: string) => ({ width: text.length * 7 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    set fillStyle(_value: unknown) {},
    set strokeStyle(_value: unknown) {},
    set font(_value: string) {},
    set lineWidth(_value: number) {},
    set textAlign(_value: CanvasTextAlign) {},
    set textBaseline(_value: CanvasTextBaseline) {},
  } as unknown as CanvasRenderingContext2D;
}
