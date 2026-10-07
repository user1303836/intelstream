import { DiscordSDK, RPCCloseCodes, RPCErrorCodes } from "@discord/embedded-app-sdk";
import type { IDiscordSDK } from "@discord/embedded-app-sdk";
import { bootstrap, exchangeToken, launchInstance, ClientError } from "./api";
import type { BootstrapResponse, TokenPlayer } from "./types";

export const OAUTH_SCOPES = ["identify", "guilds.members.read"] as const;
export interface DiscordSession {
  readonly sdk: IDiscordSDK;
  readonly bootstrap: BootstrapResponse;
  readonly player: TokenPlayer;
  takeTicket(): string | null;
  /** Drops the unused ticket; the SDK stays open for the next session. */
  destroy(): void;
}
/** Signs the page in for each bout. `close` ends the Activity, so it belongs to final teardown only. */
export interface ActivityAuthorizer {
  authorize(signal: AbortSignal): Promise<DiscordSession>;
  close(): void;
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

/**
 * The page's one Discord SDK. `sdk.close` posts the host CLOSE opcode, which closes the Activity, so
 * a rematch, a retry or a failure authorizes again on the same SDK, and only `close`, at final
 * teardown, ends it.
 */
export class DiscordActivity implements ActivityAuthorizer {
  private sdk: IDiscordSDK | null = null;
  private authenticated = false;
  private closed = false;

  constructor(private readonly makeSDK: SDKFactory = (id) => new DiscordSDK(id)) {}

  async authorize(signal?: AbortSignal): Promise<DiscordSession> {
    const instance = launchInstance();
    validateSdkLaunch();
    const boot = await bootstrap(instance, signal);
    const sdk = this.open(boot.client_id);
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
          prompt: "none",
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
      // The SDK stays authenticated for the page; a later session only needs the server's fresh ticket.
      if (!this.authenticated) {
        const authentication = await sdkOperation(
          () => sdk.commands.authenticate({ access_token: token.access_token }),
          signal,
          "sdk_authenticate_failed",
          "sdk_authenticate_timeout",
          SDK_AUTHENTICATE_TIMEOUT_MS,
        );
        if (authentication == null) throw new ClientError("sdk_authenticate_failed");
        this.authenticated = true;
        requireActive();
      }
      let ticket: string | null = token.ticket;
      return {
        sdk,
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
    } catch (error) {
      if (signal?.aborted) throw new ClientError("cancelled");
      // The SDK stays open so the failure stays on screen; the reload behind Retry replaces it,
      // together with any command it was left waiting on.
      throw new ClientError(clientFailure(error, "authorization_failed").code, true);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.sdk === null) return;
    try {
      this.sdk.close(RPCCloseCodes.CLOSE_NORMAL, "Hands session closed");
    } catch {
      // Construction succeeded, but an incomplete host bridge can still reject close.
    }
  }

  private open(clientId: string): IDiscordSDK {
    if (this.closed) throw new ClientError("cancelled");
    if (this.sdk !== null) return this.sdk;
    try {
      this.sdk = this.makeSDK(clientId);
    } catch (error) {
      throw new ClientError(clientFailure(error, "sdk_initialization_failed").code, true);
    }
    return this.sdk;
  }
}
