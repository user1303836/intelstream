import { bootstrap, ClientError, exchangeToken } from "./api";
import { PROTOCOL_VERSION } from "./types";

const rawResponse = (body: string): Response => new Response(body, {
  status: 200,
  headers: { "Content-Type": "application/json; charset=utf-8" },
});

describe("strict same-origin HTTP response parsing", () => {
  it("posts the launch instance so browsers send the same-origin Origin header", async () => {
    history.replaceState({}, "", "/");
    const fetchMock = vi.fn(async () => rawResponse(`{"client_id":"123","state":"s","protocol":${PROTOCOL_VERSION},"simulation":{"tick_rate":30,"ring_half_width":500,"ring_half_height":500}}`));
    vi.stubGlobal("fetch", fetchMock);
    await bootstrap("launch");
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("/api/hands/bootstrap", window.location.origin),
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instance_id: "launch" }),
      }),
    );
  });

  it("rejects top-level duplicate bootstrap keys before schema decoding", async () => {
    history.replaceState({}, "", "/");
    vi.stubGlobal("fetch", vi.fn(async () => rawResponse(`{"client_id":"123","client_id":"forged","state":"s","protocol":${PROTOCOL_VERSION},"simulation":{"tick_rate":30,"ring_half_width":500,"ring_half_height":500}}`)));
    await expect(bootstrap("launch")).rejects.toEqual(new ClientError("bootstrap_failed"));
  });

  it("asks for a reload when the server speaks another protocol, and only then", async () => {
    history.replaceState({}, "", "/");
    vi.stubGlobal("fetch", vi.fn(async () => rawResponse(`{"client_id":"123","state":"s","protocol":${PROTOCOL_VERSION + 1},"simulation":{"tick_rate":30,"ring_half_width":500,"ring_half_height":500},"build":"next"}`)));
    await expect(bootstrap("launch")).rejects.toEqual(new ClientError("client_outdated", true));
    vi.stubGlobal("fetch", vi.fn(async () => rawResponse(`{"client_id":"123","state":"s","protocol":${PROTOCOL_VERSION},"simulation":{"tick_rate":30,"ring_half_width":500,"ring_half_height":500},"extra":1}`)));
    await expect(bootstrap("launch")).rejects.toEqual(new ClientError("invalid_bootstrap"));
  });

  it("rejects nested duplicate token keys before schema decoding", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => rawResponse('{"access_token":"a","ticket":"t","player":{"id":"one","name":"One","name":"Forged","avatar":null,"rating":1500}}')));
    await expect(exchangeToken("code", "state")).rejects.toEqual(new ClientError("token_failed"));
  });
});
