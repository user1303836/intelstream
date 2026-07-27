import { DiscordSDK, RPCCloseCodes } from "@discord/embedded-app-sdk";
import type { IDiscordSDK } from "@discord/embedded-app-sdk";
import { bootstrap, exchangeToken, launchInstance, ClientError } from "./api";
import type { BootstrapResponse, TokenPlayer } from "./types";

export const OAUTH_SCOPES = ["identify", "guilds.members.read", "applications.commands"] as const;
export interface DiscordSession {
  readonly sdk: IDiscordSDK;
  readonly bootstrap: BootstrapResponse;
  readonly player: TokenPlayer;
  takeTicket(): string | null;
  invite(): Promise<void>;
  destroy(): void;
}
type SDKFactory = (clientId: string) => IDiscordSDK;

function closeSdk(sdk: IDiscordSDK, message: string): void {
  try {
    sdk.close(RPCCloseCodes.CLOSE_NORMAL, message);
  } catch {
    // Construction succeeded, but an incomplete host bridge can still reject close.
  }
}

export async function authorizeDiscord(
  signal?: AbortSignal,
  makeSDK: SDKFactory = (id) => new DiscordSDK(id),
): Promise<DiscordSession> {
  const instance = launchInstance();
  const boot = await bootstrap(instance, signal);
  const sdk = makeSDK(boot.client_id);
  let handedOff = false;
  const requireActive = (): void => {
    if (signal?.aborted) throw new ClientError("cancelled");
  };
  try {
    requireActive();
    await sdk.ready();
    requireActive();
    if (sdk.instanceId !== instance) throw new ClientError("instance_mismatch");
    const authorization = await sdk.commands.authorize({
      client_id: boot.client_id,
      response_type: "code",
      state: boot.state,
      scope: [...OAUTH_SCOPES],
    });
    requireActive();
    const token = await exchangeToken(authorization.code, boot.state, signal);
    requireActive();
    await sdk.commands.authenticate({ access_token: token.access_token });
    requireActive();
    let ticket: string | null = token.ticket;
    let destroyed = false;
    const session: DiscordSession = {
      sdk,
      bootstrap: boot,
      player: token.player,
      takeTicket: () => {
        const current = ticket;
        ticket = null;
        return current;
      },
      invite: async () => {
        await sdk.commands.openInviteDialog();
      },
      destroy: () => {
        if (destroyed) return;
        destroyed = true;
        ticket = null;
        closeSdk(sdk, "Hands session closed");
      },
    };
    handedOff = true;
    return session;
  } catch (error) {
    if (!handedOff) closeSdk(sdk, "Hands authorization closed");
    throw error;
  }
}
