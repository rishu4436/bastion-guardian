import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  LOCAL_FIXTURE_PROTOCOL_ID,
  lendingPositions,
  positionObservations,
  riskObservations,
} from "@bastion-guardian/db";
import { createTestEnv, probePostgres, type TestEnv } from "@bastion/test-env";
import { RiskObserverService } from "../src/index.js";

const pgUrl = await probePostgres();

describe.skipIf(!pgUrl)("risk-observer (LOCAL SIMULATION: anvil + Postgres)", () => {
  let env: TestEnv;
  let svc: RiskObserverService;
  beforeAll(async () => {
    env = await createTestEnv(pgUrl!);
    svc = new RiskObserverService(env.db, env.stack.public, env.stack.wallet, {
      chainId: 31337,
      rpcUrl: env.stack.rpcUrl,
      protocolId: LOCAL_FIXTURE_PROTOCOL_ID,
      riskObserver: env.stack.addresses.riskObserver,
      keeper: env.stack.accounts.keeper,
    });
  }, 240_000);
  afterAll(async () => env?.close());

  it("records exact positions and does nothing above trigger", async () => {
    const r = await svc.tick();
    expect(r).toHaveLength(2);
    expect(r.every((o) => !o.belowTrigger && o.observeTx === null)).toBe(true);
    expect(r[0]!.healthFactorWad).toBe(1_307_692_307_692_307_692n);
    const rows = await env.db.select().from(lendingPositions);
    expect(rows).toHaveLength(2);
    expect(rows.find((x) => x.account === env.stack.addresses.borrowerA.toLowerCase())!.debtAmount).toBe(
      "13000000000",
    );
    expect((await env.db.select().from(positionObservations)).every((o) => o.source === "chain")).toBe(true);
  }, 60_000);

  it("submits observe() when HF < trigger; the contract's interval suppresses repeats", async () => {
    await env.stack.setWethPrice(1800n * 10n ** 8n);
    const r = await svc.tick();
    expect(r.every((o) => o.belowTrigger && o.observeTx !== null)).toBe(true);
    const again = await svc.tick();
    expect(again.every((o) => o.observeTx === null && o.skippedReason === "NOT_EMITTED_BY_CONTRACT")).toBe(
      true,
    );
    await env.indexer.catchUp();
    const obs = await env.db.select().from(riskObservations);
    expect(obs).toHaveLength(2);
    expect(obs[0]!.healthFactorWad).toBe("1176923076923076923");
  }, 60_000);

  it("read-only mode never sends transactions", async () => {
    const ro = new RiskObserverService(env.db, env.stack.public, null, {
      chainId: 31337,
      rpcUrl: env.stack.rpcUrl,
      protocolId: LOCAL_FIXTURE_PROTOCOL_ID,
      riskObserver: env.stack.addresses.riskObserver,
    });
    const r = await ro.tick();
    expect(r.every((o) => o.observeTx === null && o.skippedReason === "READ_ONLY")).toBe(true);
    const pos = await env.db
      .select()
      .from(lendingPositions)
      .where(eq(lendingPositions.account, env.stack.addresses.borrowerA.toLowerCase()));
    expect(pos[0]!.observedBlock).toBe(await env.stack.public.getBlockNumber());
  }, 60_000);

  it("refuses to sign for a non-local RPC without live-execution authorization", () => {
    expect(
      () =>
        new RiskObserverService(env.db, env.stack.public, env.stack.wallet, {
          chainId: 84532,
          rpcUrl: "https://sepolia.base.org",
          protocolId: "aave-v3-base-sepolia",
          riskObserver: env.stack.addresses.riskObserver,
          keeper: env.stack.accounts.keeper,
        }),
    ).toThrow(/ENABLE_LIVE_EXECUTION/);
  });
});
