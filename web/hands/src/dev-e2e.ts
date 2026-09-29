import type { IDiscordSDK } from "@discord/embedded-app-sdk";
import { bootstrap, exchangeToken, launchInstance } from "./api";
import type { DiscordSession } from "./discord";

/**
 * Development-only authorizer for playing the real client against
 * scripts/hands_e2e_server.py without Discord: the real bootstrap and token
 * routes are used, with a local handshake code instead of an OAuth code.
 */
export async function devAuthorizer(signal: AbortSignal): Promise<DiscordSession> {
  const name = new URLSearchParams(window.location.search).get("player") ?? "Player";
  const instance = launchInstance();
  const boot = await bootstrap(instance, signal);
  const token = await exchangeToken(`dev:${name}`, boot.state, signal);
  let ticket: string | null = token.ticket;
  return {
    sdk: null as unknown as IDiscordSDK,
    bootstrap: boot,
    player: token.player,
    takeTicket: () => {
      const current = ticket;
      ticket = null;
      return current;
    },
    destroy: () => {
      ticket = null;
    },
  };
}
