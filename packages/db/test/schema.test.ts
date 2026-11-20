import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { createTestDatabase, probePostgres, type TestDatabase } from "../src/testing.js";
import {
  chainLogs,
  incidentRecords,
  lendingPositions,
  notificationDeliveries,
  protocols,
  sourceEscrows,
  users,
} from "../src/schema.js";
import { fromDbAmount, normAddress, toDbAmount } from "../src/amounts.js";
import { seedReferenceData } from "../src/seed.js";

const adminUrl = await probePostgres();
const d = adminUrl ? describe : describe.skip;
if (!adminUrl)
  console.warn("SKIPPED: no Postgres reachable (set TEST_DATABASE_URL or start infrastructure/docker)");

const A = "0x" + "ab".repeat(20);
const B32 = (n: number) => "0x" + n.toString(16).padStart(64, "0");

d("schema (real Postgres)", () => {
  let t: TestDatabase;
  beforeAll(async () => {
    t = await createTestDatabase(adminUrl!);
    await seedReferenceData(t.db);
  });
  afterAll(async () => t?.drop());

  it("stores uint256 amounts exactly (no float rounding at 2^256-1)", async () => {
    const max = (1n << 256n) - 1n;
    await t.db.insert(lendingPositions).values({
      chainId: 84532,
      protocolId: "aave-v3-base-sepolia",
      account: A,
      collateralAsset: normAddress("0xBA50Cd2A20f6DA35D788639E581bca8d0B5d4D5f"),
      debtAsset: "0x0a215d8ba66387dca84b284d18c3b4ec3de6e54a",
      collateralAmount: toDbAmount(max),
      debtAmount: toDbAmount(123456789012345678901234567890n),
      healthFactorWad: toDbAmount(1_176_923_076_923_076_923n),
      liquidationThresholdBps: 8500,
      observedBlock: 1n,
      observedAt: new Date(),
    });
    const [row] = await t.db.select().from(lendingPositions).where(eq(lendingPositions.account, A));
    expect(fromDbAmount(row!.collateralAmount)).toBe(max);
    expect(fromDbAmount(row!.debtAmount)).toBe(123456789012345678901234567890n);
  });

  it("rejects negative amounts and non-lowercase addresses via CHECK constraints", async () => {
    await expect(
      t.db.execute(
        sql`insert into tokens (chain_id, address, symbol, decimals) values (84532, '0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD', 'X', 6)`,
      ),
    ).rejects.toThrow();
    await expect(
      t.db.execute(
        sql`insert into analytics_daily (day, chain_id, metric, value) values ('2026-11-20', 84532, 'm', -1)`,
      ),
    ).rejects.toThrow();
  });

  it("chain_logs ingestion is idempotent per (chain, blockHash, logIndex)", async () => {
    const row = {
      chainId: 84532,
      blockNumber: 10n,
      blockHash: B32(1),
      txHash: B32(2),
      logIndex: 0,
      address: A,
      eventName: "RiskObserved",
      args: { hf: "1" },
    };
    await t.db.insert(chainLogs).values(row).onConflictDoNothing();
    await t.db.insert(chainLogs).values(row).onConflictDoNothing();
    const rows = await t.db
      .select()
      .from(chainLogs)
      .where(eq(chainLogs.blockHash, B32(1)));
    expect(rows).toHaveLength(1);
  });

  it("only one OPEN incident per dedup key (repeated-incident suppression), resolved ones may repeat", async () => {
    const base = {
      dedupKey: "k1",
      scope: "policy",
      kind: "ORACLE_STALE",
      severity: "warning" as const,
      title: "t",
      evidence: {},
      recommendedAction: "r",
    };
    await t.db.insert(incidentRecords).values(base);
    await expect(t.db.insert(incidentRecords).values(base)).rejects.toThrow();
    await t.db.update(incidentRecords).set({ status: "resolved" }).where(eq(incidentRecords.dedupKey, "k1"));
    await t.db.insert(incidentRecords).values(base);
    const n = await t.db.select().from(incidentRecords).where(eq(incidentRecords.dedupKey, "k1"));
    expect(n).toHaveLength(2);
  });

  it("notification deliveries are unique per (dedupKey, channel)", async () => {
    const [u] = await t.db.insert(users).values({}).returning();
    const v = {
      dedupKey: "rescue:0x1",
      userId: u!.id,
      channelKind: "telegram" as const,
      eventType: "RESCUE_SUCCESSFUL",
      severity: "critical" as const,
      sourceRefs: [],
      eventConfirmation: "confirmed",
    };
    await t.db.insert(notificationDeliveries).values(v);
    await expect(t.db.insert(notificationDeliveries).values(v)).rejects.toThrow();
    await t.db.insert(notificationDeliveries).values({ ...v, channelKind: "email" });
  });

  it("reserve budgets are keyed by (chain, vault, owner, policyId) — R-07 parity", async () => {
    const base = {
      chainId: 1301,
      vault: A,
      policyId: B32(9),
      token: A,
      repayReserve: "1",
      feeReserve: "0",
      maxFeeBps: 100,
      updatedBlock: 1n,
    };
    await t.db.insert(sourceEscrows).values({ ...base, owner: "0x" + "01".repeat(20) });
    await t.db.insert(sourceEscrows).values({ ...base, owner: "0x" + "02".repeat(20) });
    const rows = await t.db
      .select()
      .from(sourceEscrows)
      .where(and(eq(sourceEscrows.policyId, B32(9))));
    expect(rows).toHaveLength(2);
  });

  it("seeds the official Aave market as configured, not live", async () => {
    const [p] = await t.db.select().from(protocols).where(eq(protocols.id, "aave-v3-base-sepolia"));
    expect(p!.status).toBe("configured");
    expect(p!.kind).toBe("official");
  });
});
