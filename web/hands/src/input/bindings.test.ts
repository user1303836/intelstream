import { CONTROL_HELP, controlHint, SHORT_HINT_WIDTH } from "./bindings";

/** The lines a hint wraps to in a box this wide: 11 px type at about 0.55 em a character, 12 px of padding a side and a 1 px border. */
function wrappedLines(text: string, box: number): number {
  const room = box - 26;
  const character = 11 * 0.55;
  let lines = 1;
  let used = 0;
  for (const word of text.split(" ")) {
    const width = word.length * character;
    if (used === 0 || used + character + width <= room) used += (used === 0 ? 0 : character) + width;
    else {
      lines += 1;
      used = width;
    }
  }
  return lines;
}

describe("the controls hint", () => {
  it("gives a phone held upright the essentials, short enough for the column beside the pads", () => {
    // The hint's box beside the pads, as Edge lays out style.css: min(44vw, 300px, 100vw - 226px) held upright.
    for (const [width, box] of [[320, 94], [360, 134], [375, 149], [390, 164], [412, 181]] as const) {
      const hint = controlHint(true, width);
      for (const essential of [/drag/iu, /move/iu, /tap/iu, /punch/iu, /hold guard/iu]) expect(hint, `${width} px`).toMatch(essential);
      // Five lines at 320 px (88 px in Edge, where the whole hint took eleven, 177 px), and four at most from 360 px
      // (Edge sets three).
      expect(wrappedLines(hint, box), `${width} px`).toBeLessThanOrEqual(width === 320 ? 5 : 4);
      expect(wrappedLines(controlHint(true, SHORT_HINT_WIDTH), box)).toBeGreaterThan(wrappedLines(hint, box));
    }
  });

  it("keeps the whole touch hint for wider screens, and the keys for a keyboard", () => {
    expect(controlHint(true, SHORT_HINT_WIDTH - 1)).not.toContain("SLIP");
    for (const width of [SHORT_HINT_WIDTH, 568, 844, 1280]) {
      const hint = controlHint(true, width);
      for (const button of ["BODY", "POWER", "GUARD", "SLIP", "WEAVE", "PULL", "CLINCH"]) expect(hint).toContain(button);
    }
    for (const width of [320, 1280]) expect(controlHint(false, width)).toContain("Jab F/J");
    // The Controls panel has the rest.
    expect(CONTROL_HELP.some((item) => item.startsWith("Touch:") && item.includes("left or right half"))).toBe(true);
  });
});
