import { PROTOCOL_VERSION } from "./types";
import type { IDiscordSDK } from "@discord/embedded-app-sdk";
import { ClientError } from "./api";
import { DiscordActivity, OAUTH_SCOPES } from "./discord";
const response = (value: unknown): Response => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
const launchUrl = "/?instance_id=launch-1&frame_id=frame-1&platform=desktop";
function sdk(instanceId: string, order: string[]): IDiscordSDK {
  return { instanceId, ready: vi.fn(async () => { order.push("ready"); }), close: vi.fn(() => { order.push("close"); }), commands: { authorize: vi.fn(async () => { order.push("authorize"); return { code: "oauth-code" }; }), authenticate: vi.fn(async () => { order.push("authenticate"); return {}; }) } } as unknown as IDiscordSDK;
}
const backend = (order: string[] = []) => vi.fn(async (input: URL | RequestInfo) => { if (String(input).includes("bootstrap")) { order.push("bootstrap"); return response({ client_id: "123", state: "state", protocol: PROTOCOL_VERSION, simulation: { tick_rate: 30, ring_half_width: 6000, ring_half_height: 4000 } }); } order.push("token"); return response({ access_token: "access", ticket: "ticket", player: { id: "one", name: "One", avatar: null, rating: 1000 } }); });
describe("Discord SDK OAuth", () => {
  it("uses exact ready-authorize-token-authenticate order/scopes and memory-only ticket", async () => {
    history.replaceState({}, "", launchUrl); const order: string[] = []; const mockSdk = sdk("launch-1", order);
    vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => { const url = String(input); if (url.includes("bootstrap")) { order.push("bootstrap"); expect(init?.body).toBe(JSON.stringify({ instance_id: "launch-1" })); return response({ client_id: "123", state: "oauth-state", protocol: PROTOCOL_VERSION, simulation: { tick_rate: 30, ring_half_width: 6000, ring_half_height: 4000 } }); } order.push("token"); expect(init?.body).toBe(JSON.stringify({ code: "oauth-code", state: "oauth-state" })); return response({ access_token: "access-secret", ticket: "ticket-secret", player: { id: "one", name: "One", avatar: null, rating: 1500 } }); }));
    const activity = new DiscordActivity(() => mockSdk); const session = await activity.authorize(); expect(order).toEqual(["bootstrap", "ready", "authorize", "token", "authenticate"]);
    expect(OAUTH_SCOPES).toEqual(["identify", "guilds.members.read"]);
    expect(mockSdk.commands.authorize).toHaveBeenCalledWith({ client_id: "123", response_type: "code", state: "oauth-state", prompt: "none", scope: [...OAUTH_SCOPES] }); expect(mockSdk.commands.authenticate).toHaveBeenCalledWith({ access_token: "access-secret" });
    expect(session.takeTicket()).toBe("ticket-secret"); expect(session.takeTicket()).toBeNull(); expect(localStorage).toHaveLength(0); expect(location.href).not.toContain("secret");
    // Ending a session only drops its ticket: sdk.close posts the host CLOSE opcode, which closes the Activity.
    session.destroy(); expect(mockSdk.close).not.toHaveBeenCalled();
    activity.close(); activity.close(); expect(mockSdk.close).toHaveBeenCalledOnce(); expect(order.at(-1)).toBe("close");
  });
  it("authorizes every later session (a rematch, a retry) on the same SDK without closing it", async () => {
    history.replaceState({}, "", launchUrl); const order: string[] = []; const mockSdk = sdk("launch-1", order); const factory = vi.fn(() => mockSdk); vi.stubGlobal("fetch", backend(order));
    const activity = new DiscordActivity(factory);
    const first = await activity.authorize(); expect(first.takeTicket()).toBe("ticket"); first.destroy();
    const second = await activity.authorize(); expect(second.takeTicket()).toBe("ticket"); second.destroy();
    expect(factory).toHaveBeenCalledOnce(); expect(mockSdk.commands.authorize).toHaveBeenCalledTimes(2);
    // The SDK keeps its authentication; the second session needs only a fresh ticket from the token exchange.
    expect(order).toEqual(["bootstrap", "ready", "authorize", "token", "authenticate", "bootstrap", "ready", "authorize", "token"]); expect(mockSdk.close).not.toHaveBeenCalled();
    activity.close(); expect(mockSdk.close).toHaveBeenCalledOnce();
  });
  it("rejects missing SDK launch parameters before construction", async () => {
    history.replaceState({}, "", "/?instance_id=launch-1"); const factory = vi.fn(() => sdk("launch-1", [])); const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(new DiscordActivity(factory).authorize()).rejects.toEqual(new ClientError("invalid_launch")); expect(factory).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("requires a reload when SDK construction fails", async () => {
    history.replaceState({}, "", launchUrl); vi.stubGlobal("fetch", backend());
    await expect(new DiscordActivity(() => { throw new Error("construction failed"); }).authorize()).rejects.toEqual(new ClientError("sdk_initialization_failed", true));
  });
  it("keeps the Activity open and identifies a known authorize RPC failure", async () => {
    history.replaceState({}, "", launchUrl); const order: string[] = []; const mockSdk = sdk("launch-1", order); (mockSdk.commands.authorize as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error("host rejected"), { code: 4006 })); vi.stubGlobal("fetch", backend());
    await expect(new DiscordActivity(() => mockSdk).authorize()).rejects.toEqual(new ClientError("authorize_failed_4006", true)); expect(mockSdk.close).not.toHaveBeenCalled();
  });
  it("does not expose unknown host RPC error codes", async () => {
    history.replaceState({}, "", launchUrl); const order: string[] = []; const mockSdk = sdk("launch-1", order); (mockSdk.commands.authorize as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error("host rejected"), { code: 9999 })); vi.stubGlobal("fetch", backend());
    await expect(new DiscordActivity(() => mockSdk).authorize()).rejects.toEqual(new ClientError("authorize_failed", true)); expect(mockSdk.close).not.toHaveBeenCalled();
  });
  it("keeps the Activity open and preserves a safe token exchange failure", async () => {
    history.replaceState({}, "", launchUrl); const order: string[] = []; const mockSdk = sdk("launch-1", order); vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo) => String(input).includes("bootstrap") ? response({ client_id: "123", state: "state", protocol: PROTOCOL_VERSION, simulation: { tick_rate: 30, ring_half_width: 6000, ring_half_height: 4000 } }) : new Response("{}", { status: 401, headers: { "Content-Type": "application/json" } })));
    await expect(new DiscordActivity(() => mockSdk).authorize()).rejects.toEqual(new ClientError("token_failed", true)); expect(mockSdk.close).not.toHaveBeenCalled();
  });
  it("keeps the Activity open and identifies an authenticate RPC failure", async () => {
    history.replaceState({}, "", launchUrl); const order: string[] = []; const mockSdk = sdk("launch-1", order); (mockSdk.commands.authenticate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("host rejected")); vi.stubGlobal("fetch", backend());
    await expect(new DiscordActivity(() => mockSdk).authorize()).rejects.toEqual(new ClientError("sdk_authenticate_failed", true)); expect(mockSdk.close).not.toHaveBeenCalled();
  });
  it("keeps the Activity open and requires a reload when authenticate stalls", async () => {
    vi.useFakeTimers();
    try {
      history.replaceState({}, "", launchUrl); const order: string[] = []; const mockSdk = sdk("launch-1", order); (mockSdk.commands.authenticate as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {})); vi.stubGlobal("fetch", backend());
      // The reload behind Retry discards the stalled SDK and the access token its command still holds.
      const attempt = expect(new DiscordActivity(() => mockSdk).authorize()).rejects.toEqual(new ClientError("sdk_authenticate_timeout", true));
      await vi.advanceTimersByTimeAsync(15_000);
      await attempt; expect(mockSdk.close).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it("bounds a missing SDK ready response and requires a reload without closing the Activity", async () => {
    vi.useFakeTimers();
    try {
      history.replaceState({}, "", launchUrl); const order: string[] = []; const mockSdk = sdk("launch-1", order); (mockSdk.ready as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {})); vi.stubGlobal("fetch", backend());
      const attempt = expect(new DiscordActivity(() => mockSdk).authorize()).rejects.toEqual(new ClientError("sdk_ready_timeout", true));
      await vi.advanceTimersByTimeAsync(15_000);
      await attempt; expect(mockSdk.close).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it("rejects SDK/launch instance disagreement before authorize", async () => {
    history.replaceState({}, "", launchUrl); const order: string[] = []; const mockSdk = sdk("other", order); vi.stubGlobal("fetch", backend());
    await expect(new DiscordActivity(() => mockSdk).authorize()).rejects.toMatchObject({ code: "instance_mismatch", reloadRequired: true }); expect(mockSdk.commands.authorize).not.toHaveBeenCalled(); expect(mockSdk.close).not.toHaveBeenCalled();
  });
  it("keeps the SDK for the next authorization when one is aborted after ready", async () => {
    history.replaceState({}, "", launchUrl); const order: string[] = []; const mockSdk = sdk("launch-1", order); const factory = vi.fn(() => mockSdk); const abort = new AbortController(); (mockSdk.ready as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => { abort.abort(); }); vi.stubGlobal("fetch", backend());
    const activity = new DiscordActivity(factory);
    await expect(activity.authorize(abort.signal)).rejects.toMatchObject({ code: "cancelled" }); expect(mockSdk.close).not.toHaveBeenCalled();
    const session = await activity.authorize(new AbortController().signal); expect(session.takeTicket()).toBe("ticket"); expect(factory).toHaveBeenCalledOnce();
    // The aborted attempt never authenticated, so this one does.
    expect(mockSdk.commands.authenticate).toHaveBeenCalledOnce();
  });
  it("constructs no SDK after final teardown", async () => {
    history.replaceState({}, "", launchUrl); const factory = vi.fn(() => sdk("launch-1", [])); vi.stubGlobal("fetch", backend());
    const activity = new DiscordActivity(factory); activity.close();
    await expect(activity.authorize()).rejects.toMatchObject({ code: "cancelled" }); expect(factory).not.toHaveBeenCalled();
  });
});
