import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { foundry } from "viem/chains";
import { bastionProtectionVaultAbi } from "@bastion-guardian/contracts";
import { incidentRecords, settlementClaims } from "@bastion-guardian/db";
import { createTestEnv, probePostgres, type TestEnv } from "@bastion/test-env";
import { SettlementReconciler } from "../src/index.js";

const pgUrl = await probePostgres();

describe.skipIf(!pgUrl)("settlement-reconciler (LOCAL SIMULATION: anvil + Postgres)", () => {
  let env: TestEnv;
  let rec: SettlementReconciler;
  const vault = async (fn: "pauseBudget" | "resumeBudget") => {
    const s = env.stack;
    await s.public.waitForTransactionReceipt({
      hash: await s.wallet.writeContract({
        account: s.accounts.borrowerA,
        chain: foundry,
        address: s.addresses.protectionVault,
        abi: bastionProtectionVaultAbi,
        functionName: fn,
        args: [s.addresses.policyA],
      }),
    });
  };
  beforeAll(async () => {
    env = await createTestEnv(pgUrl!);
    rec = new SettlementReconciler(env.db, env.stack.public, env.stack.wallet, {
      reserveChainId: 31337,
      reserveRpcUrl: env.stack.rpcUrl,
      reserveEscrow: env.stack.addresses.reserveEscrow,
      protectionVault: env.stack.addresses.protectionVault,
      overdueAfterSec: 600,
      ackTimeoutSec: 0,
      retrier: env.stack.accounts.keeper,
    });
  }, 240_000);
  afterAll(async () => env?.close());

  it("paused reserve budget → RecoveryRequired → incident; resume → permissionless retry pays exactly the fill", async () => {
    // Pause in a block BEFORE the rescue so the rescue's executedAt > pausedAt.
    await vault("pauseBudget");
    await env.stack.mine(1);
    await env.crashAndRescue();
    const [c1] = await env.db.select().from(settlementClaims);
    expect(c1!.state).toBe("RecoveryRequired");
    const f1 = await rec.tick();
    expect(f1.map((f) => f.kind)).toContain("recovery_required");
    const [inc] = await env.db
      .select()
      .from(incidentRecords)
      .where(eq(incidentRecords.kind, "settlement_recovery_required"));
    expect(inc!.status).toBe("open");

    await vault("resumeBudget");
    const f2 = await rec.tick();
    const retried = f2.find((f) => f.kind === "retried");
    expect(retried?.tx).toMatch(/^0x/);
    await env.indexer.catchUp();
    const [c2] = await env.db.select().from(settlementClaims);
    expect(c2!.state).toBe("Reimbursed");
    expect(c2!.attempts).toBe(2);
  }, 120_000);

  it("flags the missing destination acknowledgment until Reactive delivers it, then reports ok", async () => {
    const f = await rec.tick();
    expect(f.map((x) => x.kind)).toContain("ack_missing");
    // Relay the ReimbursementCompleted (from the retry) → router acknowledgment.
    const head = await env.stack.public.getBlockNumber();
    await env.stack.relayRange(head - 3n, head);
    await env.indexer.catchUp();
    const f2 = await rec.tick();
    expect(f2.map((x) => x.kind)).toContain("ok");
    const open = await env.db.select().from(incidentRecords).where(eq(incidentRecords.status, "open"));
    expect(open.filter((i) => i.scope === "settlement")).toHaveLength(0);
  }, 120_000);
});
