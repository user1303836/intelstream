import { describe, expect, it } from "vitest";
import { describeError } from "./errors";

describe("describeError", () => {
  it("explains known codes in plain language and keeps the code", () => {
    expect(describeError("room_closed")).toBe("Unable to continue: the bout has already ended; use Play now to start another (room_closed).");
    expect(describeError("authentication_timeout")).toContain("took too long to authenticate");
    expect(describeError("authentication_timeout")).toContain("(authentication_timeout)");
  });

  it("falls back to the bare code for unknown failures", () => {
    expect(describeError("mystery_failure")).toBe("Unable to continue (mystery_failure).");
  });

  it("tells the player to reload when Hands was updated", () => {
    expect(describeError("client_outdated")).toBe("Hands was updated. Reload to continue (client_outdated).");
  });

  it("explains a Discord RPC failure by its stage and keeps the RPC number", () => {
    expect(describeError("authorize_failed_4006")).toBe("Unable to continue: Discord did not authorize the session (authorize_failed_4006).");
    expect(describeError("sdk_ready_failed_4000")).toBe("Unable to continue: the Discord client did not respond (sdk_ready_failed_4000).");
    expect(describeError("sdk_authenticate_failed_4009")).toContain("Discord did not confirm your identity");
    expect(describeError("mystery_failure_4006")).toBe("Unable to continue (mystery_failure_4006).");
  });

  it("explains every code the server and the client can end a session with", () => {
    const server = [
      "already_in_room", "authentication_required", "authentication_timeout", "connection_replaced", "input_queue_full",
      "internal_error", "invalid_activity", "invalid_guild", "invalid_input", "invalid_request", "invalid_state",
      "invalid_ticket", "match_abandoned", "match_not_started", "not_in_activity", "persistence_failed", "rate_limited",
      "room_closed", "room_full", "server_shutting_down", "service_busy", "service_unavailable", "spectator_read_only",
      "upstream_unavailable",
    ];
    const client = ["network_unavailable", "protocol_error", "unexpected_error", "rematch_unavailable", "bootstrap_failed", "token_failed"];
    for (const code of [...server, ...client]) expect(describeError(code), code).not.toBe(`Unable to continue (${code}).`);
  });
});
