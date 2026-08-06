import { describe, expect, it } from "vitest";
import { externalUrlLiterals } from "./url-literals.mjs";

describe("production URL literal extraction", () => {
  it("finds explicit URLs in nested and oversized template literals", () => {
    const nested = "const value = `outer ${flag ? `https://evil.example/nested` : `//evil.example/network`}`;";
    const oversized = `const value = \`${"a".repeat(5000)}https://evil.example/oversized\`;`;
    expect([...externalUrlLiterals(nested)]).toContain("https://evil.example/nested");
    expect([...externalUrlLiterals(nested)]).toContain("//evil.example/network");
    expect([...externalUrlLiterals(oversized)]).toContain("https://evil.example/oversized");
  });

  it("keeps explicit URLs distinct while finding standalone network URLs", () => {
    expect([...externalUrlLiterals("const value = 'https://discord.com';")]).toEqual(["https://discord.com"]);
    expect([...externalUrlLiterals("const value = '//evil.example/path';")]).toContain("//evil.example/path");
    const oversized = `const value = \`${"a".repeat(5000)}//evil.example/oversized\`;`;
    expect([...externalUrlLiterals(oversized)]).toContain("//evil.example/oversized");
    expect([...externalUrlLiterals("<img src=//evil.example/image>")]).toContain("//evil.example/image");
  });
});
