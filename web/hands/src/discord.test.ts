import type { IDiscordSDK } from "@discord/embedded-app-sdk";
import { ClientError } from "./api";
import { authorizeDiscord, OAUTH_SCOPES } from "./discord";
const response = (value: unknown): Response => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
const launchUrl = "/?instance_id=launch-1&frame_id=frame-1&platform=desktop";
function sdk(instanceId: string, order: string[]): IDiscordSDK {
  return { instanceId, ready: vi.fn(async () => { order.push("ready"); }), close: vi.fn(() => { order.push("close"); }), commands: { authorize: vi.fn(async () => { order.push("authorize"); return { code: "oauth-code" }; }), authenticate: vi.fn(async () => { order.push("authenticate"); return {}; }) } } as unknown as IDiscordSDK;
}
describe("Discord SDK OAuth", () => {
  it("uses exact ready-authorize-token-authenticate order/scopes and memory-only ticket", async () => {
    history.replaceState({}, "", launchUrl); const order: string[] = []; const mockSdk = sdk("launch-1", order);
    vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => { const url = String(input); if (url.includes("bootstrap")) { order.push("bootstrap"); expect(init?.body).toBe(JSON.stringify({ instance_id: "launch-1" })); return response({ client_id: "123", state: "oauth-state", protocol: 1, simulation: { tick_rate: 30, ring_half_width: 6000, ring_half_height: 4000 } }); } order.push("token"); expect(init?.body).toBe(JSON.stringify({ code: "oauth-code", state: "oauth-state" })); return response({ access_token: "access-secret", ticket: "ticket-secret", player: { id: "one", name: "One", avatar: null, rating: 1500 } }); }));
    const session = await authorizeDiscord(undefined, () => mockSdk); expect(order).toEqual(["bootstrap", "ready", "authorize", "token", "authenticate"]);
    expect(OAUTH_SCOPES).toEqual(["identify", "guilds.members.read"]);
    expect(mockSdk.commands.authorize).toHaveBeenCalledWith({ client_id: "123", response_type: "code", state: "oauth-state", prompt: "none", scope: [...OAUTH_SCOPES] }); expect(mockSdk.commands.authenticate).toHaveBeenCalledWith({ access_token: "access-secret" });
    expect(session.takeTicket()).toBe("ticket-secret"); expect(session.takeTicket()).toBeNull(); expect(localStorage).toHaveLength(0); expect(location.href).not.toContain("secret"); session.destroy(); session.destroy(); expect(mockSdk.close).toHaveBeenCalledOnce(); expect(order.at(-1)).toBe("close");
  });
  it("rejects missing SDK launch parameters before construction", async () => {
    history.replaceState({}, "", "/?instance_id=launch-1"); const factory = vi.fn(() => sdk("launch-1", [])); const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(authorizeDiscord(undefined, factory)).rejects.toEqual(new ClientError("invalid_launch")); expect(factory).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("requires a reload when SDK construction fails", async () => {
    history.replaceState({}, "", launchUrl); vi.stubGlobal("fetch", vi.fn(async () => response({ client_id: "123", state: "state", protocol: 1, simulation: { tick_rate: 30, ring_half_width: 6000, ring_half_height: 4000 } })));
    await expect(authorizeDiscord(undefined, () => { throw new Error("construction failed"); })).rejects.toEqual(new ClientError("sdk_initialization_failed", true));
  });
  it("keeps the Activity open and identifies a known authorize RPC failure", async () => {
    history.replaceState({}, "", launchUrl); const order: string[] = []; const mockSdk = sdk("launch-1", order); (mockSdk.commands.authorize as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error("host rejected"), { code: 4006 })); vi.stubGlobal("fetch", vi.fn(async () => response({ client_id: "123", state: "state", protocol: 1, simulation: { tick_rate: 30, ring_half_width: 6000, ring_half_height: 4000 } })));
    await expect(authorizeDiscord(undefined, () => mockSdk)).rejects.toEqual(new ClientError("authorize_failed_4006", true)); expect(mockSdk.close).not.toHaveBeenCalled();
  });
  it("does not expose unknown host RPC error codes", async () => {
    history.replaceState({}, "", launchUrl); const order: string[] = []; const mockSdk = sdk("launch-1", order); (mockSdk.commands.authorize as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error("host rejected"), { code: 9999 })); vi.stubGlobal("fetch", vi.fn(async () => response({ client_id: "123", state: "state", protocol: 1, simulation: { tick_rate: 30, ring_half_width: 6000, ring_half_height: 4000 } })));
    await expect(authorizeDiscord(undefined, () => mockSdk)).rejects.toEqual(new ClientError("authorize_failed", true)); expect(mockSdk.close).not.toHaveBeenCalled();
  });
  it("keeps the Activity open and preserves a safe token exchange failure", async () => {
    history.replaceState({}, "", launchUrl); const order: string[] = []; const mockSdk = sdk("launch-1", order); vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo) => String(input).includes("bootstrap") ? response({ client_id: "123", state: "state", protocol: 1, simulation: { tick_rate: 30, ring_half_width: 6000, ring_half_height: 4000 } }) : new Response("{}", { status: 401, headers: { "Content-Type": "application/json" } })));
    await expect(authorizeDiscord(undefined, () => mockSdk)).rejects.toEqual(new ClientError("token_failed", true)); expect(mockSdk.close).not.toHaveBeenCalled();
  });
  it("keeps the Activity open and identifies an authenticate RPC failure", async () => {
    history.replaceState({}, "", launchUrl); const order: string[] = []; const mockSdk = sdk("launch-1", order); (mockSdk.commands.authenticate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("host rejected")); vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo) => String(input).includes("bootstrap") ? response({ client_id: "123", state: "state", protocol: 1, simulation: { tick_rate: 30, ring_half_width: 6000, ring_half_height: 4000 } }) : response({ access_token: "access", ticket: "ticket", player: { id: "one", name: "One", avatar: null, rating: 1000 } })));
    await expect(authorizeDiscord(undefined, () => mockSdk)).rejects.toEqual(new ClientError("sdk_authenticate_failed", true)); expect(mockSdk.close).not.toHaveBeenCalled();
  });
  it("closes the stalled realm when authenticate retains an access token", async () => {
    vi.useFakeTimers();
    try {
      history.replaceState({}, "", launchUrl); const order: string[] = []; const mockSdk = sdk("launch-1", order); (mockSdk.commands.authenticate as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {})); vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo) => String(input).includes("bootstrap") ? response({ client_id: "123", state: "state", protocol: 1, simulation: { tick_rate: 30, ring_half_width: 6000, ring_half_height: 4000 } }) : response({ access_token: "access", ticket: "ticket", player: { id: "one", name: "One", avatar: null, rating: 1000 } })));
      const attempt = expect(authorizeDiscord(undefined, () => mockSdk)).rejects.toEqual(new ClientError("sdk_authenticate_timeout"));
      await vi.advanceTimersByTimeAsync(15_000);
      await attempt; expect(mockSdk.close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
  it("bounds a missing SDK ready response and closes the stalled realm", async () => {
    vi.useFakeTimers();
    try {
      history.replaceState({}, "", launchUrl); const order: string[] = []; const mockSdk = sdk("launch-1", order); (mockSdk.ready as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {})); vi.stubGlobal("fetch", vi.fn(async () => response({ client_id: "123", state: "state", protocol: 1, simulation: { tick_rate: 30, ring_half_width: 6000, ring_half_height: 4000 } })));
      const attempt = expect(authorizeDiscord(undefined, () => mockSdk)).rejects.toEqual(new ClientError("sdk_ready_timeout"));
      await vi.advanceTimersByTimeAsync(15_000);
      await attempt; expect(mockSdk.close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
  it("rejects SDK/launch instance disagreement before authorize", async () => {
    history.replaceState({}, "", launchUrl); const order: string[] = []; const mockSdk = sdk("other", order); vi.stubGlobal("fetch", vi.fn(async () => response({ client_id: "123", state: "state", protocol: 1, simulation: { tick_rate: 30, ring_half_width: 6000, ring_half_height: 4000 } })));
    await expect(authorizeDiscord(undefined, () => mockSdk)).rejects.toMatchObject({ code: "instance_mismatch" }); expect(mockSdk.commands.authorize).not.toHaveBeenCalled(); expect(mockSdk.close).toHaveBeenCalledOnce();
  });
  it("closes a constructed SDK when authorization is aborted after ready", async () => {
    history.replaceState({}, "", launchUrl); const order: string[] = []; const mockSdk = sdk("launch-1", order); const abort = new AbortController(); (mockSdk.ready as ReturnType<typeof vi.fn>).mockImplementation(async () => { abort.abort(); }); vi.stubGlobal("fetch", vi.fn(async () => response({ client_id: "123", state: "state", protocol: 1, simulation: { tick_rate: 30, ring_half_width: 500, ring_half_height: 330 } })));
    await expect(authorizeDiscord(abort.signal, () => mockSdk)).rejects.toMatchObject({ code: "cancelled" }); expect(mockSdk.close).toHaveBeenCalledOnce();
  });
});
