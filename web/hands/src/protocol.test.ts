import { decodeBootstrap, decodeServerFrame, decodeToken, encodeInput, ProtocolError } from "./protocol";
import { envelope, publicPlayers, snapshot } from "./test/fixtures";

describe("strict protocol v1", () => {
  it("decodes every control envelope and a populated final", () => {
    const messages = [
      { version: 1, type: "welcome", player_id: "one", seat: 1, rating: 1500, players: [publicPlayers[0]], server_tick: 0, next_sequence: 0, reconnect_ticket: "secret-ticket" },
      { version: 1, type: "waiting", open_seats: 1 }, { version: 1, type: "ready", players: publicPlayers },
      { version: 1, type: "paused", player_id: "two", grace_ms: 20000 }, { version: 1, type: "resumed", player_id: "two" },
      { version: 1, type: "error", code: "room_full" }, envelope(),
      { version: 1, type: "final", match_id: "m", winner_id: "one", method: "decision", round: 12, scorecards: [{ judge: "A", player_one: [10], player_two: [9] }, { judge: "B", player_one: [9], player_two: [10] }, { judge: "C", player_one: [10], player_two: [9] }], ratings: { one: { before: 1500, after: 1516 }, two: { before: 1500, after: 1484 } } },
    ];
    expect(messages.map((message) => decodeServerFrame(JSON.stringify(message)).type)).toEqual(["welcome", "waiting", "ready", "paused", "resumed", "error", "snapshot", "final"]);
  });
  it("decodes a fully populated embedded result", () => {
    const value = snapshot(); value.events as unknown as unknown[];
    const populated = { ...value, result: { match_id: "m", activity_instance_id: "i", guild_id: "g", player_one_id: "one", player_two_id: "two", winner_id: null, finish_method: "draw", round_number: 15, tick: 10, scorecards: [{ judge: "A", player_one: [], player_two: [] }, { judge: "B", player_one: [], player_two: [] }, { judge: "C", player_one: [], player_two: [] }], player_one_knockdowns: 1, player_two_knockdowns: 1, player_one_damage: 200, player_two_damage: 210 } };
    expect(decodeServerFrame(JSON.stringify({ version: 1, type: "snapshot", payload: populated })).type).toBe("snapshot");
  });
  it.each([
    ["missing", { version: 1, type: "waiting" }], ["extra", { version: 1, type: "waiting", open_seats: 1, winner_id: "forged" }],
    ["version", { version: 2, type: "waiting", open_seats: 1 }], ["nonfinite", "{\"version\":1,\"type\":\"paused\",\"player_id\":\"one\",\"grace_ms\":NaN}"],
  ])("rejects %s fields", (_name, value) => expect(() => decodeServerFrame(typeof value === "string" ? value : JSON.stringify(value))).toThrow(ProtocolError));
  it("rejects duplicate, oversized, and same-player snapshots", () => {
    expect(() => decodeServerFrame('{"version":1,"type":"waiting","type":"ready","open_seats":1}')).toThrow(/duplicate/u);
    expect(() => decodeServerFrame(" ".repeat(65_537))).toThrow(/large/u);
    const bad = structuredClone(envelope()) as { payload: { fighters: { player_id: string }[] } }; bad.payload.fighters[1]!.player_id = "one";
    expect(() => decodeServerFrame(JSON.stringify(bad))).toThrow(/distinct/u);
  });
  it("encodes only authorized fields, clamps movement, and caps actions", () => {
    const forged = { kind: "punch", hand: "left", class: "jab", target: "head", power: "normal", winner_id: "one" } as const;
    const encoded = JSON.parse(encodeInput(3, 9, { moveX: Infinity, moveY: -9000, defense: "guard_high", actions: [forged, forged, forged, forged, forged] })) as Record<string, unknown>;
    expect(encoded).toMatchObject({ version: 1, type: "input", sequence: 3, client_tick: 9, move: { x: 0, y: -1000 } }); expect(encoded).not.toHaveProperty("winner_id"); expect((encoded.actions as unknown[])).toHaveLength(4); expect((encoded.actions as Record<string, unknown>[])[0]).not.toHaveProperty("winner_id");
  });
  it("accepts authoritative rounds 13–15 with exactly three complete judge cards", () => {
    const rounds = Array.from({ length: 15 }, () => 10);
    const cards = ["A", "B", "C"].map((judge) => ({ judge, player_one: rounds, player_two: rounds.map(() => 9) }));
    const final = { version: 1, type: "final", match_id: "m", winner_id: "one", method: "decision", round: 15, scorecards: cards, ratings: { one: { before: 1500, after: 1516 }, two: { before: 1500, after: 1484 } } };
    expect(decodeServerFrame(JSON.stringify(final))).toMatchObject({ type: "final", round: 15 });
    const atThirteen = { ...snapshot(), round_number: 13 };
    expect(decodeServerFrame(JSON.stringify({ version: 1, type: "snapshot", payload: atThirteen }))).toMatchObject({ type: "snapshot", payload: { round_number: 13 } });
  });
  it.each([
    { winner_id: null, method: "decision" },
    { winner_id: "one", method: "draw" },
  ])("rejects incoherent final winner/method combinations", ({ winner_id, method }) => {
    const cards = ["A", "B", "C"].map((judge) => ({ judge, player_one: [], player_two: [] }));
    expect(() => decodeServerFrame(JSON.stringify({ version: 1, type: "final", match_id: "m", winner_id, method, round: 1, scorecards: cards, ratings: { one: { before: 1, after: 1 }, two: { before: 1, after: 1 } } }))).toThrow(/coherent/u);
  });
  it("accepts exact fighter-domain boundaries and the private get-up sentinel", () => {
    const base = snapshot();
    const lower = { ...base.fighters[0], x: -462, y: -292, facing: -1, velocity_x: -7, velocity_y: -7, maximum_stamina: 330, stamina: 0, poise: 0, get_up_required: 45 };
    const upper = { ...base.fighters[1], x: 462, y: 292, facing: 1, velocity_x: 7, velocity_y: 7, maximum_stamina: 1000, stamina: 1000, poise: 600, get_up_required: 169 };
    expect(decodeServerFrame(JSON.stringify({ version: 1, type: "snapshot", payload: { ...base, fighters: [lower, upper] } }))).toMatchObject({ type: "snapshot", payload: { fighters: [{ get_up_required: 45 }, { get_up_required: 169 }] } });
    const redactedOpponent = { ...upper, get_up_required: 0 };
    expect(decodeServerFrame(JSON.stringify({ version: 1, type: "snapshot", payload: { ...base, fighters: [lower, redactedOpponent] } }))).toMatchObject({ payload: { fighters: [{ get_up_required: 45 }, { get_up_required: 0 }] } });
  });
  it.each([
    ["x below", "x", -463], ["x above", "x", 463], ["y below", "y", -293], ["y above", "y", 293],
    ["zero facing", "facing", 0], ["velocity x below", "velocity_x", -8], ["velocity x above", "velocity_x", 8],
    ["velocity y below", "velocity_y", -8], ["velocity y above", "velocity_y", 8], ["maximum stamina below", "maximum_stamina", 329],
    ["maximum stamina above", "maximum_stamina", 1001], ["poise below", "poise", -1], ["poise above", "poise", 601],
    ["get-up gap start", "get_up_required", 1], ["get-up gap end", "get_up_required", 44], ["get-up above", "get_up_required", 170],
  ])("rejects %s fighter output", (_name, field, value) => {
    const base = snapshot();
    const changed = { ...base.fighters[0], [field]: value };
    expect(() => decodeServerFrame(JSON.stringify({ version: 1, type: "snapshot", payload: { ...base, fighters: [changed, base.fighters[1]] } }))).toThrow(ProtocolError);
  });
  it("rejects stamina above the decoded maximum", () => {
    const base = snapshot();
    const exhausted = { ...base.fighters[0], maximum_stamina: 330, stamina: 331 };
    expect(() => decodeServerFrame(JSON.stringify({ version: 1, type: "snapshot", payload: { ...base, fighters: [exhausted, base.fighters[1]] } }))).toThrow(ProtocolError);
  });
  it("rejects out-of-authority event and fighter bounds", () => {
    const base = snapshot();
    const badEvent = { version: 1, type: "snapshot", payload: { ...base, events: [{ event_id: 1, tick: 1, kind: "x".repeat(33), actor_id: null, target_id: null, amount: 10_001, detail: "", blood: 101, direction: 2 }] } };
    expect(() => decodeServerFrame(JSON.stringify(badEvent))).toThrow();
    const badQueue = { version: 1, type: "snapshot", payload: { ...base, fighters: [{ ...base.fighters[0], queued_actions: 9 }, base.fighters[1]] } };
    expect(() => decodeServerFrame(JSON.stringify(badQueue))).toThrow();
  });
  it("strictly decodes same-origin API payload schemas", () => {
    expect(decodeBootstrap({ client_id: "123", state: "s", protocol: 1, simulation: { tick_rate: 30, ring_half_width: 6000, ring_half_height: 4000 } }).simulation.tick_rate).toBe(30);
    expect(decodeToken({ access_token: "a", ticket: "t", player: { id: "one", name: "One", avatar: null, rating: 1500 } }).player.id).toBe("one");
    expect(() => decodeToken({ access_token: "a", ticket: "t", outcome: "forged", player: { id: "one", name: "One", avatar: null, rating: 1500 } })).toThrow();
  });
});
