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
});
