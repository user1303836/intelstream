import { isDebut, recordCard, recordLine } from "./record";

describe("a fighter's record", () => {
  it("is written wins-losses, with draws only when there are any", () => {
    expect(recordLine({ wins: 12, losses: 3, draws: 1, knockouts: 8 })).toBe("12-3-1");
    expect(recordLine({ wins: 7, losses: 0, draws: 0, knockouts: 2 })).toBe("7-0");
  });

  it("calls a fighter with no bouts a debut", () => {
    expect(isDebut({ wins: 0, losses: 0, draws: 0, knockouts: 0 })).toBe(true);
    expect(isDebut({ wins: 0, losses: 0, draws: 1, knockouts: 0 })).toBe(false);
    expect(recordCard({ wins: 0, losses: 0, draws: 0, knockouts: 0 })).toBe("PRO DEBUT");
    expect(recordCard({ wins: 36, losses: 1, draws: 0, knockouts: 29 })).toBe("36-1 (29 KO)");
  });
});
