import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { analyticsDaily } from "@bastion-guardian/db";
import { createTestEnv, probePostgres, type TestEnv } from "@bastion/test-env";
import { AnalyticsWorker, rpcBlockTimes, utcDay } from "../src/index.js";

const pgUrl = await probePostgres();

describe("utcDay", () => {
  it("formats UTC days", () => expect(utcDay(new Date("2026-11-20T23:59:59Z"))).toBe("2026-11-20"));
});

describe.skipIf(!pgUrl)("analytics-worker (LOCAL SIMULATION: anvil + Postgres)", () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await createTestEnv(pgUrl!);
  }, 240_000);
  afterAll(async () => env?.close());

  it("computes daily metrics from verified indexed rows, exactly matching the local rescue cycle", async () => {
    await env.crashAndRescue();
    const block = await env.stack.public.getBlock();
    const day = utcDay(new Date(Number(block.timestamp) * 1000));
    const w = new AnalyticsWorker(env.db, rpcBlockTimes({ 31337: env.stack.public }));
    const m = await w.computeDay(day, 31337);
    expect(m["risk.observations"]).toBe(2n);
    expect(m["risk.accounts_triggered"]).toBe(2n);
    expect(m["rescue.executed"]).toBe(2n);
    expect(m["rescue.path_solver"]).toBe(1n);
    expect(m["rescue.path_flash"]).toBe(1n);
    expect(m["solver.fills"]).toBe(1n);
    expect(m["solver.fee_raw"]).toBe(14000051n);
    expect(m["settlement.reimbursed"]).toBe(1n);
    expect(m["settlement.reimbursed_raw"]).toBe(2814010251n);
    // Idempotent: recompute yields identical rows, no duplicates.
    await w.computeDay(day, 31337);
    const rows = await env.db
      .select()
      .from(analyticsDaily)
      .where(and(eq(analyticsDaily.day, day), eq(analyticsDaily.chainId, 31337)));
    expect(rows.length).toBe(20);
    expect(rows.find((r) => r.metric === "settlement.reimbursed_raw")!.value).toBe("2814010251");
    // A different day has zero chain activity.
    const other = await w.computeDay("2000-01-01", 31337);
    expect(other["rescue.executed"]).toBe(0n);
  }, 120_000);
});
