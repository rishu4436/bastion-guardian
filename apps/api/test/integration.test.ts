import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PrivateKeyAccount } from "viem";
import { createSiweMessage } from "viem/siwe";
import { loadEnv } from "@bastion-guardian/config";
import { SolverCoordinator, QUOTE_TYPES, quoteDomain } from "@bastion-guardian/solver-coordinator";
import type { NotificationProvider, RenderedMessage } from "@bastion-guardian/notification-dispatcher";
import { createTestEnv, probePostgres, type TestEnv } from "@bastion/test-env";
import { buildApp } from "../src/app.js";

const pgUrl = await probePostgres();

class CapturingProvider implements NotificationProvider {
  readonly configured = true;
  sent: { to: string; msg: RenderedMessage }[] = [];
  constructor(readonly kind: "telegram" | "email") {}
  async send(to: string, msg: RenderedMessage) {
    this.sent.push({ to, msg });
    return { providerMessageId: `fixture-${this.sent.length}` };
  }
}

describe.skipIf(!pgUrl)("api v1 (LOCAL SIMULATION: anvil + Postgres)", () => {
  let env: TestEnv;
  let app: FastifyInstance;
  const tg = new CapturingProvider("telegram");
  const sent: { userId: string; kind: string }[] = [];

  async function signIn(
    account: PrivateKeyAccount,
    opts: { domain?: string; chainId?: number; reuseNonce?: string } = {},
  ) {
    const n = opts.reuseNonce ?? (await app.inject({ method: "GET", url: "/v1/auth/nonce" })).json().nonce;
    const message = createSiweMessage({
      address: account.address,
      chainId: opts.chainId ?? 31337,
      domain: opts.domain ?? "localhost:3000",
      nonce: n,
      uri: "http://localhost:3000",
      version: "1",
      statement: "Sign in to BASTION Guardian (LOCAL SIMULATION).",
    });
    const signature = await account.signMessage({ message });
    const res = await app.inject({ method: "POST", url: "/v1/auth/verify", payload: { message, signature } });
    const cookie = res.cookies.find((c) => c.name === "bastion_session");
    return {
      res,
      nonce: n,
      cookie: cookie ? `bastion_session=${cookie.value}` : "",
      csrf: res.json().csrfToken as string,
    };
  }

  beforeAll(async () => {
    env = await createTestEnv(pgUrl!);
    const a = env.stack.addresses;
    app = await buildApp({
      env: loadEnv({ NODE_ENV: "test", ADMIN_ADDRESSES: a.gov, SESSION_SECRET: "x".repeat(40) }),
      db: env.db,
      clients: { 31337: env.stack.public },
      coordinators: {
        31337: new SolverCoordinator(env.db, env.stack.public, {
          chainId: 31337,
          solverLiquidityVault: a.solverLiquidityVault,
          solverQuoteManager: a.solverQuoteManager,
          policyRegistry: a.policyRegistry,
        }),
      },
      providers: { telegram: tg },
      notifier: {
        sendTest: async (userId, kind) => (
          sent.push({ userId, kind }),
          "00000000-0000-4000-8000-000000000001"
        ),
      },
      sseIntervalMs: 100,
    });
  }, 240_000);
  afterAll(async () => {
    await app?.close();
    await env?.close();
  });

  it("SIWE: valid sign-in opens a session; nonce single-use; wrong domain/chain rejected", async () => {
    const s = await signIn(env.stack.accounts.borrowerA);
    expect(s.res.statusCode).toBe(200);
    expect(s.res.json()).toMatchObject({
      authenticated: true,
      address: env.stack.addresses.borrowerA.toLowerCase(),
      chainId: 31337,
      roles: ["borrower"],
    });
    const c = s.res.cookies.find((x) => x.name === "bastion_session")!;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe("Lax");
    // Replay of the same nonce fails.
    expect((await signIn(env.stack.accounts.borrowerA, { reuseNonce: s.nonce })).res.json().error).toBe(
      "SIWE_NONCE_INVALID",
    );
    expect((await signIn(env.stack.accounts.borrowerA, { domain: "evil.example" })).res.json().error).toBe(
      "SIWE_DOMAIN_MISMATCH",
    );
    expect((await signIn(env.stack.accounts.borrowerA, { chainId: 1 })).res.json().error).toBe(
      "SIWE_CHAIN_NOT_ALLOWED",
    );
    // Signature by a different key over borrowerA's message.
    const n = (await app.inject({ method: "GET", url: "/v1/auth/nonce" })).json().nonce;
    const message = createSiweMessage({
      address: env.stack.addresses.borrowerA,
      chainId: 31337,
      domain: "localhost:3000",
      nonce: n,
      uri: "http://localhost:3000",
      version: "1",
    });
    const bad = await app.inject({
      method: "POST",
      url: "/v1/auth/verify",
      payload: { message, signature: await env.stack.accounts.borrowerB.signMessage({ message }) },
    });
    expect(bad.json().error).toBe("SIWE_SIGNATURE_INVALID");
    const me = await app.inject({ method: "GET", url: "/v1/me", headers: { cookie: s.cookie } });
    expect(me.json().wallets).toEqual([env.stack.addresses.borrowerA.toLowerCase()]);
    expect((await app.inject({ method: "GET", url: "/v1/me" })).statusCode).toBe(401);
  });

  it("CSRF is required for state changes; logout revokes the session", async () => {
    const s = await signIn(env.stack.accounts.borrowerB);
    const noCsrf = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: { cookie: s.cookie },
    });
    expect(noCsrf.json().error).toBe("CSRF_TOKEN_INVALID");
    const out = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: { cookie: s.cookie, "x-csrf-token": s.csrf },
    });
    expect(out.statusCode).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: "/v1/auth/session", headers: { cookie: s.cookie } }))
        .statusCode,
    ).toBe(401);
  });

  it("roles: admin from ADMIN_ADDRESSES, solver from on-chain registration; role-gated routes enforce", async () => {
    const admin = await signIn(env.stack.accounts.gov);
    expect(admin.res.json().roles).toContain("admin");
    const solver = await signIn(env.stack.accounts.solver);
    expect(solver.res.json().roles).toEqual(["borrower", "solver"]);
    expect(
      (await app.inject({ method: "GET", url: "/v1/incidents", headers: { cookie: solver.cookie } })).json()
        .error,
    ).toBe("FORBIDDEN_ROLE");
    expect(
      (await app.inject({ method: "GET", url: "/v1/incidents", headers: { cookie: admin.cookie } }))
        .statusCode,
    ).toBe(200);
    const grant = await app.inject({
      method: "POST",
      url: "/v1/admin/roles",
      headers: { cookie: admin.cookie, "x-csrf-token": admin.csrf },
      payload: { address: env.stack.addresses.solver, role: "auditor", grant: true },
    });
    expect(grant.statusCode).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: "/v1/incidents", headers: { cookie: solver.cookie } }))
        .statusCode,
    ).toBe(200);
    const audit = (
      await app.inject({ method: "GET", url: "/v1/admin/audit-events", headers: { cookie: admin.cookie } })
    ).json();
    expect(audit.items.some((x: { action: string }) => x.action === "role.granted")).toBe(true);
  });

  it("notification channels: code sent via provider, verified once, wrong codes counted", async () => {
    const s = await signIn(env.stack.accounts.borrowerA);
    const h = { cookie: s.cookie, "x-csrf-token": s.csrf };
    const add = await app.inject({
      method: "POST",
      url: "/v1/me/channels",
      headers: h,
      payload: { kind: "telegram", destination: "123456" },
    });
    expect(add.statusCode).toBe(201);
    expect(add.json().codeDelivery).toBe("sent");
    const email = await app.inject({
      method: "POST",
      url: "/v1/me/channels",
      headers: h,
      payload: { kind: "email", destination: "a@example.com" },
    });
    expect(email.json().codeDelivery).toBe("PROVIDER_NOT_CONFIGURED");
    const code = /code: (\d{6})/.exec(tg.sent.at(-1)!.msg.body)![1]!;
    const wrong = code === "000000" ? "111111" : "000000";
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/me/channels/${add.json().id}/verify`,
          headers: h,
          payload: { code: wrong },
        })
      ).json().error,
    ).toBe("CODE_INVALID");
    const ok = await app.inject({
      method: "POST",
      url: `/v1/me/channels/${add.json().id}/verify`,
      headers: h,
      payload: { code },
    });
    expect(ok.json()).toMatchObject({ status: "active" });
    const list = (await app.inject({ method: "GET", url: "/v1/me/channels", headers: h })).json();
    expect(list.items.find((c: { kind: string }) => c.kind === "telegram")).toMatchObject({
      status: "active",
      verificationAttempts: 1,
    });
    expect(JSON.stringify(list)).not.toMatch(/verificationCodeHash/);
    expect(list.providers).toEqual({ telegram: true, email: false, sms: false, webpush: false });
    const prefs = await app.inject({
      method: "PUT",
      url: "/v1/me/notification-preferences",
      headers: h,
      payload: {
        minSeverity: "critical",
        quietHoursStart: 22,
        quietHoursEnd: 7,
        timezone: "Asia/Kolkata",
        escalateCritical: true,
        privateLockScreen: true,
        weeklyDigest: false,
        eventOptOuts: [],
      },
    });
    expect(prefs.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/v1/me/notification-preferences",
          headers: h,
          payload: { ...(prefs.json() as object), timezone: "Mars/Olympus" },
        })
      ).statusCode,
    ).toBe(400);
    const t = await app.inject({
      method: "POST",
      url: "/v1/me/notifications/test",
      headers: h,
      payload: { kind: "telegram" },
    });
    expect(t.statusCode).toBe(202);
    expect(sent.at(-1)!.kind).toBe("telegram");
  });

  it("solver quotes: signed submission accepted, bad signature rejected with a code; demand served", async () => {
    const a = env.stack.addresses;
    const now = Math.floor(Date.now() / 1000);
    const quote = {
      solver: a.solver,
      policyId: a.policyA,
      token: a.fUSDC,
      amount: 5_000_000_000n,
      feeBps: 60,
      validUntil: BigInt(now + 600),
      nonce: 7n,
    };
    const sign = (who: PrivateKeyAccount) =>
      who.signTypedData({
        domain: quoteDomain(31337, a.solverLiquidityVault),
        types: QUOTE_TYPES,
        primaryType: "SolverQuote",
        message: quote,
      });
    const body = (sig: string) =>
      JSON.stringify({ quote, signature: sig }, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    const ok = await app.inject({
      method: "POST",
      url: "/v1/solver/quotes",
      headers: { "content-type": "application/json" },
      payload: body(await sign(env.stack.accounts.solver)),
    });
    expect(ok.statusCode).toBe(201);
    const bad = await app.inject({
      method: "POST",
      url: "/v1/solver/quotes",
      headers: { "content-type": "application/json" },
      payload: body(await sign(env.stack.accounts.borrowerB)),
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error).toBe("BAD_SIGNATURE");
    const d = await app.inject({ method: "GET", url: "/v1/solver/demand?chainId=31337" });
    expect(d.statusCode).toBe(200);
    expect(Array.isArray(d.json().items)).toBe(true);
    expect((await app.inject({ method: "GET", url: "/v1/solver/demand?chainId=84532" })).json().error).toBe(
      "SOLVER_COORDINATOR_UNAVAILABLE",
    );
  });

  it("SSE streams verified rescue events as they are indexed, and data endpoints return exact receipts", async () => {
    const addr = await app.listen({ port: 0, host: "127.0.0.1" });
    const ac = new AbortController();
    const res = await fetch(`${addr}/v1/stream?chainId=31337`, { signal: ac.signal });
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    const events: { event: string; data: Record<string, unknown>; id?: string }[] = [];
    let buf = "";
    const pump = (async () => {
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
        if (done) return;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(chunk)?.[1];
          const data = /^data: (.+)$/m.exec(chunk)?.[1];
          const id = /^id: (.+)$/m.exec(chunk)?.[1];
          if (ev && data) events.push({ event: ev, data: JSON.parse(data), id });
        }
      }
    })();
    await env.crashAndRescue();
    const until = Date.now() + 10_000;
    while (
      Date.now() < until &&
      !(
        events.some((e) => e.event === "rescue.executed") &&
        events.some((e) => e.event === "settlement.event")
      )
    )
      await new Promise((r) => setTimeout(r, 100));
    ac.abort();
    await pump;
    expect(events[0]!.event).toBe("hello");
    expect(events.filter((e) => e.event === "risk.observed")).toHaveLength(2);
    const execs = events.filter((e) => e.event === "rescue.executed");
    expect(execs.map((e) => e.data.repaid)).toContain("2800010200");
    expect(events.every((e) => e.id)).toBe(true);

    const pol = (
      await app.inject({ method: "GET", url: `/v1/policies/31337/${env.stack.addresses.policyA}` })
    ).json();
    expect(pol.policy.owner).toBe(env.stack.addresses.borrowerA.toLowerCase());
    expect(pol.provenance).toMatch(/LOCAL SIMULATION/);
    const solverExec = execs.find((e) => e.data.repaid === "2800010200")!;
    const receipt = (
      await app.inject({ method: "GET", url: `/v1/rescues/${solverExec.data.rescueId}` })
    ).json();
    expect(receipt.settlementClaim.state).toBe("Reimbursed");
    expect(receipt.solverFills[0].fee).toBe("14000051");
    expect(receipt.settlementEvents.map((e: { kind: string }) => e.kind)).toEqual(
      expect.arrayContaining(["reimbursed", "acknowledged"]),
    );
    expect((await app.inject({ method: "GET", url: `/v1/rescues/0x${"ab".repeat(32)}` })).statusCode).toBe(
      404,
    );
    expect((await app.inject({ method: "GET", url: "/v1/policies/31337/not-hex" })).statusCode).toBe(400);
    const mine = await signIn(env.stack.accounts.borrowerA);
    const myPolicies = (
      await app.inject({ method: "GET", url: "/v1/me/policies", headers: { cookie: mine.cookie } })
    ).json();
    expect(myPolicies.items.map((p: { policyId: string }) => p.policyId)).toContain(
      env.stack.addresses.policyA.toLowerCase(),
    );
  }, 60_000);

  it("OpenAPI documents the versioned surface", async () => {
    const spec = (await app.inject({ method: "GET", url: "/openapi.json" })).json();
    for (const p of [
      "/v1/auth/nonce",
      "/v1/auth/verify",
      "/v1/policies/{chainId}/{policyId}",
      "/v1/rescues/{rescueId}",
      "/v1/solver/quotes",
      "/v1/stream",
      "/v1/me/channels",
      "/v1/simulations/scenario",
    ])
      expect(Object.keys(spec.paths)).toContain(p);
    expect((await app.inject({ method: "GET", url: "/docs" })).statusCode).toBeLessThan(400);
  });
});
