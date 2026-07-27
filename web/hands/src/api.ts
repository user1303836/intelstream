import { decodeBootstrap, decodeToken, parseStrictJson, ProtocolError } from "./protocol";
import type { BootstrapResponse, TokenResponse } from "./types";

export class ClientError extends Error {
  override name = "ClientError";
  constructor(readonly code: string) { super(code); }
}
async function jsonResponse(response: Response, fallback: string): Promise<unknown> {
  if (!response.ok) throw new ClientError(response.status === 429 ? "rate_limited" : fallback);
  const type = response.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) throw new ClientError(fallback);
  try { return parseStrictJson(await response.text()); } catch { throw new ClientError(fallback); }
}
export function launchInstance(search = window.location.search): string {
  const values = new URLSearchParams(search).getAll("instance_id");
  if (values.length !== 1 || !/^[A-Za-z0-9_-]{1,255}$/u.test(values[0] ?? "")) throw new ClientError("invalid_launch");
  return values[0]!;
}
export async function bootstrap(instanceId: string, signal?: AbortSignal): Promise<BootstrapResponse> {
  const url = new URL("/api/hands/bootstrap", window.location.origin); url.searchParams.set("instance_id", instanceId);
  try { return decodeBootstrap(await jsonResponse(await fetch(url, { method: "GET", credentials: "same-origin", cache: "no-store", ...(signal === undefined ? {} : { signal }) }), "bootstrap_failed")); }
  catch (error) { if (error instanceof ClientError) throw error; if (error instanceof ProtocolError) throw new ClientError("invalid_bootstrap"); throw new ClientError("bootstrap_failed"); }
}
export async function exchangeToken(code: string, state: string, signal?: AbortSignal): Promise<TokenResponse> {
  try {
    const response = await fetch(new URL("/api/hands/token", window.location.origin), { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, state }), ...(signal === undefined ? {} : { signal }) });
    return decodeToken(await jsonResponse(response, "token_failed"));
  } catch (error) { if (error instanceof ClientError) throw error; if (error instanceof ProtocolError) throw new ClientError("invalid_token_response"); throw new ClientError("token_failed"); }
}
export function safeError(error: unknown): string { return error instanceof ClientError ? error.code : error instanceof ProtocolError ? "protocol_error" : "unexpected_error"; }
