import { EYE_SHUT_TRAUMA } from "../manifest";
import { cornerWorkLine, drawHud, shutEyeTag } from "./hud";
import { fighter, mockHudContext, publicPlayers, snapshot } from "../test/fixtures";

const players = Object.fromEntries(publicPlayers.map((player) => [player.id, player]));

describe("a swollen shut eye", () => {
  it("is tagged on the plate at the engine's threshold and not before", () => {
    const eyes = (left: number, right: number) => ({ ...fighter("one").trauma, left_eye: left, right_eye: right });
    expect(shutEyeTag(eyes(EYE_SHUT_TRAUMA - 1, 0))).toBeNull();
    expect(shutEyeTag(eyes(EYE_SHUT_TRAUMA, 0))).toBe("LEFT EYE SHUT");
    expect(shutEyeTag(eyes(0, EYE_SHUT_TRAUMA))).toBe("RIGHT EYE SHUT");
    expect(shutEyeTag(eyes(1000, 1000))).toBe("BOTH EYES SHUT");
  });

  it("is drawn over the fighter's plate", () => {
    const texts: string[] = [];
    const base = snapshot();
    const shut = { ...base, fighters: [base.fighters[0], { ...base.fighters[1], trauma: { ...base.fighters[1].trauma, right_eye: EYE_SHUT_TRAUMA } }] as const };
    drawHud(mockHudContext(texts), 1280, 720, shut, players, "one", null, 0);
    expect(texts.filter((text) => text === "RIGHT EYE SHUT")).toHaveLength(1);
    texts.length = 0;
    drawHud(mockHudContext(texts), 1280, 720, base, players, "one", null, 0);
    expect(texts.some((text) => text.endsWith("SHUT"))).toBe(false);
  });
});

describe("the corners between rounds", () => {
  it("says what each corner is working on once told", () => {
    const base = snapshot();
    expect(cornerWorkLine(base.fighters)).toBeNull();
    const told = [{ ...base.fighters[0], corner_choice: "cut" as const }, { ...base.fighters[1], corner_choice: "breath" as const }];
    expect(cornerWorkLine(told)).toBe("Blue: closing the cut  ·  Red: catching breath");
    expect(cornerWorkLine([base.fighters[0], { ...base.fighters[1], corner_choice: "swelling" as const }])).toBe("Red: icing the swelling");
  });

  it("puts it on the rest panel", () => {
    const texts: string[] = [];
    const base = snapshot();
    const resting = { ...base, phase: "rest" as const, phase_ticks_remaining: 300, fighters: [{ ...base.fighters[0], corner_choice: "swelling" as const }, base.fighters[1]] as const };
    drawHud(mockHudContext(texts), 1280, 720, resting, players, "two", null, 0);
    expect(texts).toContain("Blue: icing the swelling");
  });
});
