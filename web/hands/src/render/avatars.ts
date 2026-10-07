import type { PublicPlayer } from "../types";

type Pictured = Pick<PublicPlayer, "id" | "avatar">;

const DISCORD_ID = /^[0-9]{17,20}$/u;
const AVATAR_HASH = /^[A-Za-z0-9_]{1,128}$/u;
const AVATAR_HOST = "https://cdn.discordapp.com/avatars/";
const AVATAR_PIXELS = 128;
const MAX_PICTURES = 8;

/** Where Discord serves the player's picture, or null when they have none. Never anywhere but Discord's image host. */
export function avatarUrl(player: Pictured): string | null {
  if (player.avatar === null || !DISCORD_ID.test(player.id) || !AVATAR_HASH.test(player.avatar)) return null;
  return new URL(`${player.id}/${player.avatar}.png?size=${AVATAR_PIXELS}`, AVATAR_HOST).href;
}

/** The letter that stands in for a picture. */
export function monogram(name: string): string {
  const first = Array.from(name).find((character) => /[\p{L}\p{N}]/u.test(character));
  return first === undefined ? "?" : first.toUpperCase();
}

interface Picture {
  readonly image: HTMLImageElement;
  ready: boolean;
}

/** Players' pictures, each fetched once and handed out once it has arrived. */
export class Avatars {
  private readonly pictures = new Map<string, Picture>();
  /** The address worked out for each player's current picture: the HUD asks for every player on every frame. */
  private readonly addresses = new Map<string, { readonly avatar: string | null; readonly url: string | null }>();

  constructor(private readonly create: () => HTMLImageElement = () => new Image()) {}

  get(player: Pictured | undefined): HTMLImageElement | null {
    if (player === undefined) return null;
    let address = this.addresses.get(player.id);
    if (address === undefined || address.avatar !== player.avatar) {
      if (this.addresses.size >= MAX_PICTURES) this.addresses.clear();
      address = { avatar: player.avatar, url: avatarUrl(player) };
      this.addresses.set(player.id, address);
    }
    const url = address.url;
    if (url === null) return null;
    const known = this.pictures.get(url);
    if (known !== undefined) return known.ready ? known.image : null;
    if (this.pictures.size >= MAX_PICTURES) {
      const oldest = this.pictures.entries().next().value;
      if (oldest !== undefined) this.drop(oldest[0], oldest[1]);
    }
    const picture: Picture = { image: this.create(), ready: false };
    this.pictures.set(url, picture);
    picture.image.crossOrigin = "anonymous";
    picture.image.referrerPolicy = "no-referrer";
    picture.image.decoding = "async";
    picture.image.onload = () => {
      picture.ready = picture.image.naturalWidth > 0;
    };
    picture.image.onerror = () => {
      picture.ready = false;
    };
    picture.image.src = url;
    return null;
  }

  dispose(): void {
    for (const [url, picture] of [...this.pictures]) this.drop(url, picture);
    this.addresses.clear();
  }

  private drop(url: string, picture: Picture): void {
    picture.image.onload = null;
    picture.image.onerror = null;
    picture.ready = false;
    this.pictures.delete(url);
  }
}
