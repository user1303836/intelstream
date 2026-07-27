import type { IDiscordSDK } from "@discord/embedded-app-sdk";
import { authorizeDiscord, OAUTH_SCOPES } from "./discord";
const response = (value: unknown): Response => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
function sdk(instanceId: string, order: string[]): IDiscordSDK {
  return { instanceId, ready: vi.fn(async () => { order.push("ready"); }), close: vi.fn(() => { order.push("close"); }), commands: { authorize: vi.fn(async () => { order.push("authorize"); return { code: "oauth-code" }; }), authenticate: vi.fn(async () => { order.push("authenticate"); return {}; }), openInviteDialog: vi.fn(async () => { order.push("invite"); return {}; }) } } as unknown as IDiscordSDK;
}
describe("Discord SDK OAuth", () => {
  it("uses exact ready-authorize-token-authenticate order/scopes and memory-only ticket", async () => {
    history.replaceState({}, "", "/?instance_id=launch-1&frame_id=ignored"); const order: string[] = []; const mockSdk = sdk("launch-1", order);
    vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => { const url = String(input); if (url.includes("bootstrap")) { order.push("bootstrap"); expect(init?.body).toBe(JSON.stringify({ instance_id: "launch-1" })); return response({ client_id: "123", state: "oauth-state", protocol: 1, simulation: { tick_rate: 30, ring_half_width: 6000, ring_half_height: 4000 } }); } order.push("token"); expect(init?.body).toBe(JSON.stringify({ code: "oauth-code", state: "oauth-state" })); return response({ access_token: "access-secret", ticket: "ticket-secret", player: { id: "one", name: "One", avatar: null, rating: 1500 } }); }));
    const session = await authorizeDiscord(undefined, () => mockSdk); expect(order).toEqual(["bootstrap", "ready", "authorize", "token", "authenticate"]);
    expect(mockSdk.commands.authorize).toHaveBeenCalledWith({ client_id: "123", response_type: "code", state: "oauth-state", scope: [...OAUTH_SCOPES] }); expect(mockSdk.commands.authenticate).toHaveBeenCalledWith({ access_token: "access-secret" });
    expect(session.takeTicket()).toBe("ticket-secret"); expect(session.takeTicket()).toBeNull(); expect(localStorage).toHaveLength(0); expect(location.href).not.toContain("secret"); await session.invite(); expect(order.at(-1)).toBe("invite"); session.destroy(); session.destroy(); expect(mockSdk.close).toHaveBeenCalledOnce(); expect(order.at(-1)).toBe("close");
  });
  it("rejects SDK/launch instance disagreement before authorize", async () => {
    history.replaceState({}, "", "/?instance_id=launch-1"); const order: string[] = []; const mockSdk = sdk("other", order); vi.stubGlobal("fetch", vi.fn(async () => response({ client_id: "123", state: "state", protocol: 1, simulation: { tick_rate: 30, ring_half_width: 6000, ring_half_height: 4000 } })));
    await expect(authorizeDiscord(undefined, () => mockSdk)).rejects.toMatchObject({ code: "instance_mismatch" }); expect(mockSdk.commands.authorize).not.toHaveBeenCalled(); expect(mockSdk.close).toHaveBeenCalledOnce();
  });
  it("closes a constructed SDK when authorization is aborted after ready", async () => {
    history.replaceState({}, "", "/?instance_id=launch-1"); const order: string[] = []; const mockSdk = sdk("launch-1", order); const abort = new AbortController(); (mockSdk.ready as ReturnType<typeof vi.fn>).mockImplementation(async () => { abort.abort(); }); vi.stubGlobal("fetch", vi.fn(async () => response({ client_id: "123", state: "state", protocol: 1, simulation: { tick_rate: 30, ring_half_width: 500, ring_half_height: 330 } })));
    await expect(authorizeDiscord(abort.signal, () => mockSdk)).rejects.toMatchObject({ code: "cancelled" }); expect(mockSdk.close).toHaveBeenCalledOnce();
  });
});
