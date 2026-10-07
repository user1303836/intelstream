import { afterEach, describe, expect, it } from "vitest";
import { Avatars, avatarUrl, monogram } from "./avatars";

const ID = "123456789012345678";
const HASH = "a_0123456789abcdef0123456789abcdef";

describe("avatar address", () => {
  it("is on Discord's image host, for that player and that picture", () => {
    expect(avatarUrl({ id: ID, avatar: HASH })).toBe(`https://cdn.discordapp.com/avatars/${ID}/${HASH}.png?size=128`);
  });

  it("is withheld when there is no picture or either part is not what Discord issues", () => {
    expect(avatarUrl({ id: ID, avatar: null })).toBeNull();
    for (const id of ["", "one", "12345", "1".repeat(21), `${ID}/..`, `${ID}?x=1`, ` ${ID}`, "１２３４５６７８９０１２３４５６７８"]) {
      expect(avatarUrl({ id, avatar: HASH })).toBeNull();
    }
    for (const avatar of ["", "../../attachments/1", "abc.png", "abc/def", "abc?size=4096", "abc#", "a b", "a".repeat(129), "https://example.com/x"]) {
      expect(avatarUrl({ id: ID, avatar })).toBeNull();
    }
  });

  it("never leaves the avatars folder of that host", () => {
    for (const avatar of [HASH, "abc", "A_b_9", "a".repeat(128)]) {
      const url = new URL(avatarUrl({ id: ID, avatar })!);
      expect(url.origin).toBe("https://cdn.discordapp.com");
      expect(url.pathname).toBe(`/avatars/${ID}/${avatar}.png`);
      expect(url.search).toBe("?size=128");
    }
  });
});

describe("monogram", () => {
  it("is the first letter or digit of the name, in capitals", () => {
    expect(monogram("azure vector")).toBe("A");
    expect(monogram("  ~*crimson*~")).toBe("C");
    expect(monogram("9lives")).toBe("9");
    expect(monogram("élan")).toBe("É");
    expect(monogram("🥊🥊")).toBe("?");
    expect(monogram("")).toBe("?");
  });
});

interface FakeImage {
  src: string;
  crossOrigin: string | null;
  referrerPolicy: string;
  decoding: string;
  naturalWidth: number;
  onload: (() => void) | null;
  onerror: (() => void) | null;
}

function fakeImages(): { made: FakeImage[]; create: () => HTMLImageElement } {
  const made: FakeImage[] = [];
  return {
    made,
    create: () => {
      const image: FakeImage = { src: "", crossOrigin: null, referrerPolicy: "", decoding: "auto", naturalWidth: 0, onload: null, onerror: null };
      made.push(image);
      return image as unknown as HTMLImageElement;
    },
  };
}

describe("avatars", () => {
  const player = { id: ID, avatar: HASH };

  it("asks for a picture once, without credentials or a referrer, and hands it out once it has arrived", () => {
    const { made, create } = fakeImages();
    const avatars = new Avatars(create);
    expect(avatars.get(player)).toBeNull();
    expect(avatars.get(player)).toBeNull();
    expect(made).toHaveLength(1);
    expect(made[0]!.src).toBe(avatarUrl(player));
    expect(made[0]!.crossOrigin).toBe("anonymous");
    expect(made[0]!.referrerPolicy).toBe("no-referrer");
    made[0]!.naturalWidth = 128;
    made[0]!.onload!();
    expect(avatars.get(player)).toBe(made[0]);
    expect(made).toHaveLength(1);
  });

  it("asks for nothing when the player has no picture", () => {
    const { made, create } = fakeImages();
    const avatars = new Avatars(create);
    expect(avatars.get(undefined)).toBeNull();
    expect(avatars.get({ id: ID, avatar: null })).toBeNull();
    expect(avatars.get({ id: "alpha", avatar: HASH })).toBeNull();
    expect(made).toHaveLength(0);
  });

  it("does not ask again for a picture that failed or came back empty", () => {
    const { made, create } = fakeImages();
    const avatars = new Avatars(create);
    avatars.get(player);
    made[0]!.onerror!();
    expect(avatars.get(player)).toBeNull();
    const other = { id: ID, avatar: "empty" };
    avatars.get(other);
    made[1]!.onload!();
    expect(avatars.get(other)).toBeNull();
    expect(made).toHaveLength(2);
  });

  it("keeps a handful of pictures and lets the oldest go", () => {
    const { made, create } = fakeImages();
    const avatars = new Avatars(create);
    for (let index = 0; index < 9; index += 1) avatars.get({ id: ID, avatar: `picture_${index}` });
    expect(made).toHaveLength(9);
    expect(made[0]!.onload).toBeNull();
    expect(made[1]!.onload).not.toBeNull();
    avatars.get({ id: ID, avatar: "picture_8" });
    expect(made).toHaveLength(9);
    avatars.get({ id: ID, avatar: "picture_0" });
    expect(made).toHaveLength(10);
  });

  it("forgets every picture when it is disposed of", () => {
    const { made, create } = fakeImages();
    const avatars = new Avatars(create);
    avatars.get(player);
    made[0]!.naturalWidth = 128;
    made[0]!.onload!();
    avatars.dispose();
    expect(made[0]!.onload).toBeNull();
    expect(avatars.get(player)).toBeNull();
    expect(made).toHaveLength(2);
  });
});

describe("avatars asked for on every frame", () => {
  const Original = URL;
  afterEach(() => {
    globalThis.URL = Original;
  });

  it("work the address out once per picture, and again when the picture changes", () => {
    let built = 0;
    globalThis.URL = class extends Original {
      constructor(url: string | URL, base?: string | URL) {
        super(url, base);
        built += 1;
      }
    } as typeof URL;
    const avatars = new Avatars(() => ({}) as HTMLImageElement);
    for (let frame = 0; frame < 120; frame += 1) avatars.get({ id: ID, avatar: HASH });
    expect(built).toBe(1);
    avatars.get({ id: ID, avatar: "b_1" });
    expect(built).toBe(2);
    avatars.dispose();
  });
});
