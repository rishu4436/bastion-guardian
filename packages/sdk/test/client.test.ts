import { describe, expect, it } from "vitest";
import { BastionApiError, BastionClient, parseSse } from "../src/client.js";
import { protectUrl } from "../src/react/protect.js";

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("BastionClient (unit)", () => {
  it("builds query strings, strips trailing slashes and omits undefined params", async () => {
    const { f, calls } = mockFetch(() => Response.json({ items: [] }));
    const c = new BastionClient({ baseUrl: "http://api.test///", fetch: f });
    await c.policies({ chainId: 31337, owner: undefined, limit: 5 });
    expect(calls[0]!.url).toBe("http://api.test/v1/policies?chainId=31337&limit=5");
    expect(calls[0]!.init.credentials).toBe("include");
  });

  it("maps API errors to BastionApiError with status and code", async () => {
    const { f } = mockFetch(() =>
      Response.json({ error: "POLICY_NOT_FOUND", message: "nope" }, { status: 404 }),
    );
    const c = new BastionClient({ baseUrl: "http://api.test", fetch: f });
    const err = await c.policy(1, "0x01").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BastionApiError);
    expect(err).toMatchObject({ status: 404, code: "POLICY_NOT_FOUND", message: "nope" });
  });

  it("reports an unreachable API as status 0 API_UNREACHABLE", async () => {
    const { f } = mockFetch(() => {
      throw new TypeError("fetch failed");
    });
    const c = new BastionClient({ baseUrl: "http://api.test", fetch: f });
    await expect(c.chains()).rejects.toMatchObject({ status: 0, code: "API_UNREACHABLE" });
  });

  it("mints a CSRF token with a JSON POST before the first state-changing call and reuses it", async () => {
    const { f, calls } = mockFetch((url) =>
      url.endsWith("/v1/auth/csrf") ? Response.json({ csrfToken: "tok-1" }) : Response.json({ ok: true }),
    );
    const c = new BastionClient({ baseUrl: "http://api.test", fetch: f, cookie: "bastion_session=s" });
    await c.unlinkChannel("abc");
    await c.removeDevice("def");
    expect(calls.map((x) => `${x.init.method} ${new URL(x.url).pathname}`)).toEqual([
      "POST /v1/auth/csrf",
      "DELETE /v1/me/channels/abc",
      "DELETE /v1/me/devices/def",
    ]);
    const mint = new Headers(calls[0]!.init.headers);
    expect(mint.get("content-type")).toBe("application/json");
    expect(new Headers(calls[1]!.init.headers).get("x-csrf-token")).toBe("tok-1");
    expect(new Headers(calls[2]!.init.headers).get("cookie")).toBe("bastion_session=s");
  });

  it("parses SSE frames, ignoring heartbeats and multi-line data", () => {
    expect(parseSse(": heartbeat")).toBeNull();
    expect(parseSse('id: abc\nevent: rescue.executed\ndata: {"a":\ndata: 1}')).toEqual({
      id: "abc",
      event: "rescue.executed",
      data: { a: 1 },
    });
    expect(parseSse("data: not-json")).toEqual({ id: "", event: "message", data: { raw: "not-json" } });
  });

  it("builds the embed deep link to the policy wizard", () => {
    expect(protectUrl("https://app.example/", "0x00000000000000000000000000000000000000aa", 84532)).toBe(
      "https://app.example/policies/new?account=0x00000000000000000000000000000000000000aa&chainId=84532&ref=embed",
    );
  });
});
