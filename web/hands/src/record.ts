import type { FighterRecord } from "./types";

/** A record the way boxing writes it: wins and losses, and draws when there are any. */
export function recordLine(record: FighterRecord): string {
  return `${record.wins}-${record.losses}${record.draws > 0 ? `-${record.draws}` : ""}`;
}

export const isDebut = (record: FighterRecord): boolean => record.wins + record.losses + record.draws === 0;

/** The ring announcer's card: "12-3-1 (8 KO)", or a fighter's first bout. */
export function recordCard(record: FighterRecord): string {
  return isDebut(record) ? "PRO DEBUT" : `${recordLine(record)} (${record.knockouts} KO)`;
}
