import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { bastionPolicyRegistryAbi } from "@bastion-guardian/contracts";
import {
  chainLogs,
  createTestDatabase,
  incidentRecords,
  probePostgres,
  protectionPolicies,
  rescueExecutions,
  rescueIntents,
  riskObservations,
  seedLocalSimulation,
  settlementClaims,
  settlementEvents,
  solverFills,
  solverLiquidityCommitments,
  solverRegistrations,
  sourceEscrows,
  policyVersions,
  type TestDatabase,
} from "@bastion-guardian/db";
import { startLocalStack, type LocalStack } from "@bastion/local-e2e";
import { foundry } from "viem/chains";
import type { PgTable } from "drizzle-orm/pg-core";
import { ChainIndexer, localContracts } from "../src/index.js";

const pgUrl = await probePostgres();

describe.skipIf(!pgUrl)("chain-indexer against the local anvil stack + Postgres (LOCAL SIMULATION)", () => {
  let s: LocalStack;
  let t: TestDatabase;
  let idx: ChainIndexer;

  const count = async (table: PgTable) =>
    Number((await t.db.select({ n: sql<number>`count(*)` }).from(table))[0]!.n);

  beforeAll(async () => {
    [s, t] = await Promise.all([startLocalStack(), createTestDatabase(pgUrl!)]);
    await seedLocalSimulation(t.db, { fixtureMarket: s.addresses.fixtureMarket });
    idx = new ChainIndexer(t.db, s.public, {
      chainId: 31337,
      contracts: localContracts(s.addresses),
      startBlock: 0n,
      batchSize: 50n,
      reserveChainId: 31337,
    });
  }, 240_000);
  afterAll(async () => {
    await s?.stop();
    await t?.drop();
  });

  it("indexes deployment-time state: policies, versions, solver, commitment, reserve budget", async () => {
    await idx.catchUp();
    const pols = await t.db.select().from(protectionPolicies);
    expect(pols.map((p) => p.policyId).sort()).toEqual(
      [s.addresses.policyA, s.addresses.policyB].map((x) => x.toLowerCase()).sort(),
    );
    expect(pols.every((p) => p.status === "Active")).toBe(true);
    const [va] = await t.db
      .select()
      .from(policyVersions)
      .where(eq(policyVersions.policyId, s.addresses.policyA.toLowerCase()));
    expect(va!.triggerHealthFactorWad).toBe("1250000000000000000");
    const [sv] = await t.db.select().from(solverRegistrations);
    expect(sv!.solver).toBe(s.addresses.solver.toLowerCase());
    const [c] = await t.db.select().from(solverLiquidityCommitments);
    expect(c!.commitmentId).toBe(s.addresses.commitmentId.toLowerCase());
    expect(c!.amount).toBe("8000000000");
    expect(c!.state).toBe("active");
    const [b] = await t.db.select().from(sourceEscrows);
    expect(b!.owner).toBe(s.addresses.borrowerA.toLowerCase());
    expect(b!.repayReserve).toBe("10000000000");
    const cp = await idx.checkpoint();
    expect(cp!.lastBlock).toBe(await s.public.getBlockNumber());
  }, 120_000);

  it("indexes a full rescue + settlement cycle into exact-integer rows", async () => {
    const from = (await s.public.getBlockNumber()) + 1n;
    await s.setWethPrice(1800n * 10n ** 8n);
    await s.observe(s.addresses.policyA);
    await s.observe(s.addresses.policyB);
    expect(await s.relayRange(from, await s.public.getBlockNumber())).toBe(2);
    const mid = await s.public.getBlockNumber();
    expect(await s.relayRange(from, mid)).toBeGreaterThanOrEqual(0); // already processed logs are ignored by the core
    await s.relayRange(mid - 1n, await s.public.getBlockNumber()); // SolverRescueExecuted → settlement
    await s.relayRange(mid + 1n, await s.public.getBlockNumber()); // ReimbursementCompleted → acknowledgment
    await idx.catchUp();

    expect(await count(riskObservations)).toBe(2);
    const execs = await t.db.select().from(rescueExecutions);
    expect(execs).toHaveLength(2);
    expect(execs.every((e) => e.success)).toBe(true);
    const solverExec = execs.find((e) => e.path === 2)!;
    expect(solverExec.repaid).toBe("2800010200");
    expect(solverExec.fee).toBe("14000051");
    expect(solverExec.solver).toBe(s.addresses.solver.toLowerCase());
    const flashExec = execs.find((e) => e.path === 1)!;
    expect(BigInt(flashExec.repaid!)).toBe(13_000_000_000n - 6_358_671_202n);

    const [fill] = await t.db.select().from(solverFills);
    expect(fill!.policyOwner).toBe(s.addresses.borrowerA.toLowerCase());
    const [claim] = await t.db.select().from(settlementClaims);
    expect(claim!.state).toBe("Reimbursed");
    expect(claim!.principal).toBe("2800010200");
    expect(claim!.attempts).toBe(1);
    const kinds = (await t.db.select().from(settlementEvents)).map((e) => e.kind).sort();
    expect(kinds).toEqual(expect.arrayContaining(["solver_executed", "reimbursed", "acknowledged"]));
    const intents = await t.db.select().from(rescueIntents);
    const stateA = intents.find((i) => i.policyId === s.addresses.policyA.toLowerCase())!.state;
    const stateB = intents.find((i) => i.policyId === s.addresses.policyB.toLowerCase())!.state;
    expect(stateA).toBe("ReimbursementComplete");
    expect(stateB).toBe("DestinationExecuted");
    const [c] = await t.db.select().from(solverLiquidityCommitments);
    expect(BigInt(c!.remaining)).toBe(8_000_000_000n - 2_800_010_200n);
    const [b] = await t.db.select().from(sourceEscrows);
    expect(b!.totalReimbursed).toBe("2814010251");
  }, 180_000);

  it("backfill of the whole range is idempotent", async () => {
    const before = await Promise.all(
      [chainLogs, rescueExecutions, riskObservations, solverFills, settlementEvents].map(count),
    );
    const cpBefore = await idx.checkpoint();
    await idx.backfill(0n, cpBefore!.lastBlock);
    await idx.backfill(0n, cpBefore!.lastBlock);
    const after = await Promise.all(
      [chainLogs, rescueExecutions, riskObservations, solverFills, settlementEvents].map(count),
    );
    expect(after).toEqual(before);
    expect((await idx.checkpoint())!.lastBlock).toBe(cpBefore!.lastBlock);
    const [claim] = await t.db.select().from(settlementClaims);
    expect(claim!.attempts).toBe(1);
  }, 120_000);

  it("rolls back a reorg: removed logs are flagged, derived state re-derived, incident recorded", async () => {
    const snap = await s.test.snapshot();
    const hash = await s.wallet.writeContract({
      account: s.accounts.borrowerA,
      chain: foundry,
      address: s.addresses.policyRegistry,
      abi: bastionPolicyRegistryAbi,
      functionName: "pausePolicy",
      args: [s.addresses.policyA],
    });
    await s.public.waitForTransactionReceipt({ hash });
    await idx.catchUp();
    const paused = await t.db
      .select()
      .from(protectionPolicies)
      .where(eq(protectionPolicies.policyId, s.addresses.policyA.toLowerCase()));
    expect(paused[0]!.status).toBe("Paused");

    // Reorg: drop the pause block and replace it with a longer chain of different blocks.
    await s.test.revert({ id: snap });
    await s.mine(3);
    const r = await idx.tick();
    expect(r.reorg).not.toBeNull();
    expect(r.reorg!.removedLogs).toBe(1);
    await idx.catchUp();
    const back = await t.db
      .select()
      .from(protectionPolicies)
      .where(eq(protectionPolicies.policyId, s.addresses.policyA.toLowerCase()));
    expect(back[0]!.status).toBe("Active");
    const removed = await t.db
      .select()
      .from(chainLogs)
      .where(and(eq(chainLogs.removed, true), eq(chainLogs.eventName, "PolicyPaused")));
    expect(removed).toHaveLength(1);
    const inc = await t.db.select().from(incidentRecords).where(eq(incidentRecords.kind, "chain_reorg"));
    expect(inc).toHaveLength(1);
    expect((await idx.checkpoint())!.lastBlock).toBe(await s.public.getBlockNumber());
  }, 120_000);
});
