/**
 * SDK client integration tests against the real API (see global-setup.ts: private anvil chain with the LOCAL SIMULATION
 * deployment, isolated Postgres, real indexer / risk-observer / guardian-health). Nothing touches a public network.
 */
import { describe, expect, inject, it } from "vitest";
import { createSiweMessage } from "viem/siwe";
import { privateKeyToAccount } from "viem/accounts";
import { DEV_KEYS } from "@bastion/local-e2e";
import { BastionClient, type StreamEvent } from "../src/index.js";

const stack = inject("sdkStack");
const ORIGIN = "http://localhost:3000";
const FROM_START = Buffer.from(
  JSON.stringify({ r: 0, e: 0, s: 0, d: 0, i: "1970-01-01T00:00:00.000Z" }),
).toString("base64url");

describe.skipIf(!stack)("@bastion-guardian/sdk client against the real API (LOCAL SIMULATION)", () => {
  const client = new BastionClient({ baseUrl: stack?.baseUrl ?? "http://127.0.0.1:9" });

  it("reads system, markets, policies, readiness and positions with exact integer strings", async () => {
    expect((await client.chains()).chains.length).toBeGreaterThan(0);
    const sys = await client.systemStatus();
    expect(sys).toMatchObject({ database: true, mainnetEnabled: false, liveExecutionEnabled: false });
    const tokens = (await client.tokens({ chainId: 31337 })).items;
    expect(tokens.map((t) => t.symbol)).toEqual(expect.arrayContaining(["fUSDC", "fWETH"]));
    const { items, provenance } = await client.policies({ chainId: 31337, owner: stack!.borrowerA });
    expect(provenance).toMatch(/LOCAL SIMULATION/);
    expect(items[0]!.policyId).toBe(stack!.policyA);
    const detail = await client.policy(31337, items[0]!.policyId);
    expect(detail.versions[0]!.triggerHealthFactorWad).toMatch(/^\d+$/);
    expect(detail.readiness?.status).toMatch(/ARMED|LIMITED|UNAVAILABLE|UNKNOWN/);
    const hist = await client.readinessHistory(31337, items[0]!.policyId);
    expect(hist.items.length).toBeGreaterThan(0);
    const pos = await client.positions({ account: stack!.borrowerA });
    expect(pos.items[0]!.healthFactorWad).toMatch(/^\d+$/);
    const obs = await client.positionObservations(pos.items[0]!.id);
    const one = await client.position(pos.items[0]!.id);
    expect(one.healthFactorWad).toBe(pos.items[0]!.healthFactorWad);
    await expect(client.position("00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({
      status: 404,
      code: "POSITION_NOT_FOUND",
    });
    expect(obs.items.every((o) => o.source === "chain")).toBe(true);
    await expect(client.policy(31337, `0x${"ef".repeat(32)}`)).rejects.toMatchObject({
      status: 404,
      code: "POLICY_NOT_FOUND",
    });
  });

  it("reads recorded deployments and the live policy nonce from BastionPolicyRegistry", async () => {
    const d = await client.deployments(31337);
    expect(d.mode).toBe("local_simulation");
    expect(d.contracts.policyRegistry).toMatch(/^0x[0-9a-fA-F]{40}$/);
    const n = await client.policyNonce(31337, stack!.borrowerA);
    expect(n.registry.toLowerCase()).toBe(d.contracts.policyRegistry!.toLowerCase());
    expect(BigInt(n.nonce)).toBeGreaterThanOrEqual(1n); // borrower A registered a policy in the fixture
    expect(n.blockNumber).toMatch(/^\d+$/);
    expect((await client.deployments(84532)).mode).toBeNull();
  });

  it("replays the event stream from a cursor and stops on abort", async () => {
    const events: StreamEvent[] = [];
    const ac = new AbortController();
    const pump = client.stream(
      (e) => {
        events.push(e);
        if (e.event === "rescue.executed") ac.abort();
      },
      { chainId: 31337, lastEventId: FROM_START, signal: ac.signal },
    );
    const timer = setTimeout(() => ac.abort(), 10_000);
    const last = await pump;
    clearTimeout(timer);
    expect(events[0]!.event).toBe("hello");
    expect(events.some((e) => e.event === "risk.observed")).toBe(true);
    expect(events.some((e) => e.event === "rescue.executed")).toBe(true);
    expect(last).toBeTruthy();
  });

  it("serves rescue receipts, Proof of Protection (JSON + PDF), solvers and settlements", async () => {
    const rescues = (await client.rescues({ chainId: 31337 })).items;
    const ok = rescues.find((r) => r.executions.some((e) => e.success))!;
    const receipt = await client.rescue(ok.rescueId);
    expect(receipt.executions[0]!.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    const proof = await client.proof(ok.rescueId);
    expect(proof.environment).toBe("LOCAL_SIMULATION");
    expect(proof.verification.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const pdf = await fetch(client.proofPdfUrl(ok.rescueId));
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    const solvers = (await client.solvers({ chainId: 31337 })).items;
    expect(solvers.length).toBeGreaterThan(0);
    const sd = await client.solver(31337, solvers[0]!.solver);
    expect(sd.fills.length).toBeGreaterThan(0);
    expect((await client.settlements()).items.length).toBeGreaterThan(0);
    const sim = await client.simulationPresets();
    const r = await client.simulateScenario({
      base: sim.presets[0]!.base,
      spec: { kind: "flash_unavailable", shockBps: 1500 },
    });
    expect(r.provenance).toBe("SIMULATED");
  });

  it("signs in with SIWE (the wallet signs; the SDK only holds the session), rotates CSRF, logs out", async () => {
    const acct = privateKeyToAccount(DEV_KEYS.borrowerA);
    const nodeClient = new BastionClient({
      baseUrl: stack!.baseUrl,
      cookie: "",
      headers: { origin: ORIGIN },
    });
    const { nonce } = await nodeClient.nonce();
    const message = createSiweMessage({
      address: acct.address,
      chainId: 31337,
      domain: "localhost:3000",
      nonce,
      uri: ORIGIN,
      version: "1",
    });
    const s = await nodeClient.verify(message, await acct.signMessage({ message }));
    expect(s.roles).toContain("borrower");
    expect(nodeClient.sessionCookie).toMatch(/^bastion_session=/);
    expect((await nodeClient.me()).wallets).toEqual([acct.address.toLowerCase()]);
    expect((await nodeClient.myPolicies()).items.length).toBeGreaterThan(0);
    const t1 = await nodeClient.refreshCsrf();
    const t2 = await nodeClient.refreshCsrf();
    expect(t1).not.toBe(t2);
    await nodeClient.logout();
    await expect(nodeClient.me()).rejects.toMatchObject({ status: 401 });
  });
});
