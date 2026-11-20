import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { loadEnv } from "@bastion-guardian/config";
import { createTestDatabase, probePostgres, type TestDatabase } from "@bastion-guardian/db";
import { buildApp } from "../src/app.js";

const pgUrl = await probePostgres();
const redisUrl = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6379";
async function probeRedis(): Promise<boolean> {
  const r = new Redis(redisUrl, { lazyConnect: true, connectTimeout: 1500, maxRetriesPerRequest: 0 });
  try {
    await r.connect();
    return (await r.ping()) === "PONG";
  } catch (e) {
    if (process.env.REQUIRE_INTEGRATION_INFRA === "true")
      throw new Error(`Redis required but unreachable: ${String(e)}`);
    return false;
  } finally {
    r.disconnect();
  }
}
const redisOk = await probeRedis();
const ORIGIN = "http://localhost:3000";
// Anvil dev key #9: a well-known public test key, never funded on any real network.
const user = privateKeyToAccount("0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6");

describe("R-10 production guard", () => {
  it("refuses to start in production without a shared rate-limit store", async () => {
    await expect(
      buildApp({ env: loadEnv({ NODE_ENV: "production", SESSION_SECRET: "y".repeat(40) }) }),
    ).rejects.toThrow(/REDIS_URL is required in production/);
  });
});

describe.skipIf(!redisOk)("R-10: Redis-backed rate limits are shared across API instances", () => {
  let a: FastifyInstance, b: FastifyInstance;
  let ra: Redis, rb: Redis;
  beforeAll(async () => {
    ra = new Redis(redisUrl);
    rb = new Redis(redisUrl);
    const keys = await ra.keys("bastion:api:rl:*");
    if (keys.length) await ra.del(...keys);
    const env = loadEnv({ NODE_ENV: "test" });
    a = await buildApp({ env, rateLimitRedis: ra });
    b = await buildApp({ env, rateLimitRedis: rb });
  });
  afterAll(async () => {
    await a?.close();
    await b?.close();
    ra?.disconnect();
    rb?.disconnect();
  });

  it("counts requests to two instances against one budget (global 120/min)", async () => {
    // /health/live is under the global limit; 70 + 70 > 120 even though each instance alone stays below it.
    let limited = 0;
    for (let i = 0; i < 70; i++) {
      const r1 = await a.inject({ method: "GET", url: "/v1/chains" });
      const r2 = await b.inject({ method: "GET", url: "/v1/chains" });
      if (r1.statusCode === 429) limited++;
      if (r2.statusCode === 429) limited++;
    }
    expect(limited).toBe(140 - 120);
    const keys = await ra.keys("bastion:api:rl:*");
    expect(keys.length).toBeGreaterThan(0);
    const last = await b.inject({ method: "GET", url: "/v1/chains" });
    expect(last.statusCode).toBe(429);
    expect(last.headers["x-ratelimit-remaining"]).toBe("0");
  });
});

describe.skipIf(!pgUrl)("R-11: CSRF token mint is a same-origin JSON POST", () => {
  let t: TestDatabase;
  let app: FastifyInstance;
  let cookie = "";
  let csrf = "";
  beforeAll(async () => {
    t = await createTestDatabase(pgUrl!);
    app = await buildApp({
      env: loadEnv({ NODE_ENV: "test", SESSION_SECRET: "x".repeat(40), API_PUBLIC_ORIGIN: ORIGIN }),
      db: t.db,
    });
    const nonce = (await app.inject({ method: "GET", url: "/v1/auth/nonce" })).json().nonce as string;
    const message = createSiweMessage({
      address: user.address,
      chainId: 31337,
      domain: "localhost:3000",
      nonce,
      uri: ORIGIN,
      version: "1",
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/verify",
      payload: { message, signature: await user.signMessage({ message }) },
    });
    expect(res.statusCode).toBe(200);
    cookie = `bastion_session=${res.cookies.find((c) => c.name === "bastion_session")!.value}`;
    csrf = res.json().csrfToken;
  }, 60_000);
  afterAll(async () => {
    await app?.close();
    await t?.drop();
  });

  it("no longer serves GET /v1/auth/csrf", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/auth/csrf", headers: { cookie } });
    expect(r.statusCode).toBe(404);
  });

  it("rejects simple (non-preflighted) content types and foreign origins", async () => {
    const plain = await app.inject({
      method: "POST",
      url: "/v1/auth/csrf",
      headers: { cookie, "content-type": "text/plain" },
      payload: "{}",
    });
    expect(plain.statusCode).toBe(415);
    expect(plain.json().error).toBe("JSON_REQUIRED");
    const form = await app.inject({
      method: "POST",
      url: "/v1/auth/csrf",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      payload: "a=1",
    });
    expect(form.statusCode).toBe(415);
    const foreign = await app.inject({
      method: "POST",
      url: "/v1/auth/csrf",
      headers: { cookie, origin: "https://evil.example", "content-type": "application/json" },
      payload: {},
    });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json().error).toBe("ORIGIN_NOT_ALLOWED");
    const anon = await app.inject({ method: "POST", url: "/v1/auth/csrf", payload: {} });
    expect(anon.statusCode).toBe(401);
  });

  it("rotates the token on a same-origin JSON POST; the old token stops working", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/v1/auth/csrf",
      headers: { cookie, origin: ORIGIN },
      payload: {},
    });
    expect(r.statusCode).toBe(200);
    const fresh = r.json().csrfToken as string;
    expect(fresh).not.toBe(csrf);
    const prefs = { cookie, "x-csrf-token": csrf };
    const old = await app.inject({ method: "POST", url: "/v1/auth/logout", headers: prefs });
    expect(old.statusCode).toBe(403);
    const ok = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: { cookie, "x-csrf-token": fresh },
    });
    expect(ok.statusCode).toBe(200);
  });
});
