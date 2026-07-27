import { DiscordSDK, RPCCloseCodes, RPCErrorCodes } from "@discord/embedded-app-sdk";
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

function clientFailure(error: unknown, fallback: string): ClientError {
  if (error instanceof ClientError) return error;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    const knownCodes = Object.values(RPCErrorCodes).filter((value) => typeof value === "number");
    if (typeof code === "number" && knownCodes.includes(code)) {
      return new ClientError(`${fallback}_${code}`);
    }
  }
  return new ClientError(fallback);
}

const SDK_READY_TIMEOUT_MS = 15_000;
const SDK_AUTHORIZE_TIMEOUT_MS = 120_000;
const SDK_AUTHENTICATE_TIMEOUT_MS = 15_000;

function validateSdkLaunch(search = window.location.search): void {
  const parameters = new URLSearchParams(search);
  const frameIds = parameters.getAll("frame_id");
  const platforms = parameters.getAll("platform");
  if (
    frameIds.length !== 1
    || frameIds[0] === undefined
    || frameIds[0].length === 0
    || frameIds[0].length > 255
    || platforms.length !== 1
    || !["desktop", "mobile"].includes(platforms[0] ?? "")
  ) {
    throw new ClientError("invalid_launch");
  }
}

async function sdkOperation<T>(
  operation: () => Promise<T>,
  signal: AbortSignal | undefined,
  failureCode: string,
  timeoutCode: string,
  timeoutMs: number,
): Promise<T> {
  let abortHandler: (() => void) | null = null;
  const cancelled = new Promise<never>((_resolve, reject) => {
    if (signal === undefined) return;
    abortHandler = () => reject(new ClientError("cancelled"));
    signal.addEventListener("abort", abortHandler, { once: true });
    if (signal.aborted) abortHandler();
  });
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new ClientError(timeoutCode)), timeoutMs);
  });
  const result = Promise.resolve()
    .then(() => {
      if (signal?.aborted) throw new ClientError("cancelled");
      return operation();
    })
    .catch((error: unknown) => {
      throw clientFailure(error, failureCode);
    });
  try {
    return await Promise.race([result, cancelled, timedOut]);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
    if (signal !== undefined && abortHandler !== null) {
      signal.removeEventListener("abort", abortHandler);
    }
  }
}

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
  validateSdkLaunch();
  const boot = await bootstrap(instance, signal);
  let sdk: IDiscordSDK;
  try {
    sdk = makeSDK(boot.client_id);
  } catch (error) {
    const failure = clientFailure(error, "sdk_initialization_failed");
    throw new ClientError(failure.code, true);
  }
  const requireActive = (): void => {
    if (signal?.aborted) throw new ClientError("cancelled");
  };
  try {
    requireActive();
    await sdkOperation(
      () => sdk.ready(),
      signal,
      "sdk_ready_failed",
      "sdk_ready_timeout",
      SDK_READY_TIMEOUT_MS,
    );
    requireActive();
    if (sdk.instanceId !== instance) throw new ClientError("instance_mismatch");
    const authorization = await sdkOperation(
      () => sdk.commands.authorize({
        client_id: boot.client_id,
        response_type: "code",
        state: boot.state,
        scope: [...OAUTH_SCOPES],
      }),
      signal,
      "authorize_failed",
      "authorize_timeout",
      SDK_AUTHORIZE_TIMEOUT_MS,
    );
    requireActive();
    const token = await exchangeToken(authorization.code, boot.state, signal);
    requireActive();
    const authentication = await sdkOperation(
      () => sdk.commands.authenticate({ access_token: token.access_token }),
      signal,
      "sdk_authenticate_failed",
      "sdk_authenticate_timeout",
      SDK_AUTHENTICATE_TIMEOUT_MS,
    );
    if (authentication == null) throw new ClientError("sdk_authenticate_failed");
    requireActive();
    let ticket: string | null = token.ticket;
    let destroyed = false;
    return {
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
  } catch (error) {
    const failure = signal?.aborted
      ? new ClientError("cancelled")
      : clientFailure(error, "authorization_failed");
    if (
      failure.code === "cancelled"
      || failure.code === "instance_mismatch"
      || failure.code.endsWith("_timeout")
    ) {
      closeSdk(sdk, "Hands authorization closed");
      throw failure;
    }
    throw new ClientError(failure.code, true);
  }
}
