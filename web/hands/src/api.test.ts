import { bootstrap, ClientError, exchangeToken } from "./api";

const rawResponse = (body: string): Response => new Response(body, {
  status: 200,
  headers: { "Content-Type": "application/json; charset=utf-8" },
});

describe("strict same-origin HTTP response parsing", () => {
  it("rejects top-level duplicate bootstrap keys before schema decoding", async () => {
    history.replaceState({}, "", "/");
    vi.stubGlobal("fetch", vi.fn(async () => rawResponse('{"client_id":"123","client_id":"forged","state":"s","protocol":1,"simulation":{"tick_rate":30,"ring_half_width":500,"ring_half_height":330}}')));
    await expect(bootstrap("launch")).rejects.toEqual(new ClientError("bootstrap_failed"));
  });

  it("rejects nested duplicate token keys before schema decoding", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => rawResponse('{"access_token":"a","ticket":"t","player":{"id":"one","name":"One","name":"Forged","avatar":null,"rating":1500}}')));
    await expect(exchangeToken("code", "state")).rejects.toEqual(new ClientError("token_failed"));
  });
});
