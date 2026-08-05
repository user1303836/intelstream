import { initialState, reduceState } from "./state";
import { publicPlayers, snapshot } from "./test/fixtures";
describe("authoritative state reducer", () => {
  it("moves through wait, ready, combat, pause, resume and final without client outcomes", () => {
    let state = reduceState(initialState, { type: "message", message: { version: 2, type: "welcome", role: "fighter", player_id: "one", seat: 1, rating: 1500, players: [publicPlayers[0]], server_tick: 0, next_sequence: 7 } });
    expect(state).toMatchObject({ role: "fighter", playerId: "one", nextSequence: 7 });
    state = reduceState(state, { type: "message", message: { version: 2, type: "waiting", open_seats: 1 } }); expect(state.stage).toBe("waiting");
    state = reduceState(state, { type: "message", message: { version: 2, type: "ready", players: [...publicPlayers] } }); expect(Object.keys(state.players)).toHaveLength(2);
    state = reduceState(state, { type: "message", message: { version: 2, type: "snapshot", payload: snapshot(20) } }); expect(state.stage).toBe("fight");
    state = reduceState(state, { type: "message", message: { version: 2, type: "paused", player_id: "two", grace_ms: 20000 } }); expect(state.stage).toBe("paused");
    state = reduceState(state, { type: "message", message: { version: 2, type: "resumed", player_id: "two" } }); expect(state.stage).toBe("fight");
    state = reduceState(state, { type: "message", message: { version: 2, type: "final", match_id: "m", winner_id: null, method: "draw", round: 12, scorecards: [], ratings: { one: { before: 1500, after: 1500 }, two: { before: 1500, after: 1500 } } } }); expect(state.stage).toBe("complete");
  });
  it("stores spectator role without granting fighter identity or sequence authority", () => {
    const state = reduceState(initialState, { type: "message", message: { version: 2, type: "welcome", role: "spectator", player_id: "viewer", players: [...publicPlayers], server_tick: 30 } });
    expect(state).toMatchObject({ role: "spectator", playerId: null, nextSequence: 0, serverTick: 30 });
    expect(Object.keys(state.players)).toEqual(["one", "two"]);
  });
  it("keeps refreshed credentials out of application state", () => expect(reduceState(initialState, { type: "message", message: { version: 2, type: "ticket", reconnect_ticket: "memory-only", refresh_id: "refresh-identifier" } })).toBe(initialState));
  it("fails closed on safe server errors", () => expect(reduceState(initialState, { type: "message", message: { version: 2, type: "error", code: "invalid_input" } }).safeError).toBe("invalid_input"));
});
