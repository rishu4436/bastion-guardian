import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { foundry } from "viem/chains";
import { fixtureTokenAbi, fixtureLendingMarketAbi } from "@bastion-guardian/contracts";
import { LOCAL_FIXTURE_PROTOCOL_ID, incidentRecords, readinessSnapshots } from "@bastion-guardian/db";
import { RiskObserverService } from "@bastion-guardian/risk-observer";
import { createTestEnv, probePostgres, type TestEnv } from "@bastion/test-env";
import { GuardianHealthService } from "../src/index.js";

const pgUrl = await probePostgres();

describe.skipIf(!pgUrl)("guardian-health (LOCAL SIMULATION: anvil + Postgres)", () => {
  let env: TestEnv;
  let svc: GuardianHealthService;
  let observer: RiskObserverService;
  beforeAll(async () => {
    env = await createTestEnv(pgUrl!);
    const a = env.stack.addresses;
    const c = env.stack.public;
    svc = new GuardianHealthService(
      env.db,
      { destination: c, reactive: c, reserve: c },
      {
        chainId: 31337,
        policyRegistry: a.policyRegistry,
        flashRescueExecutor: a.flashRescueExecutor,
        solverLiquidityVault: a.solverLiquidityVault,
        solverRegistry: a.solverRegistry,
        emergency: a.emergency,
        reactiveCore: a.reactiveCore,
        callbackDebtors: [
          { proxy: a.destCallbackProxy, debtor: a.callbackRouter },
          { proxy: a.reserveCallbackProxy, debtor: a.reserveEscrow },
        ],
        protectionVault: a.protectionVault,
        heartbeatMaxAgeSec: 3600,
      },
    );
    observer = new RiskObserverService(env.db, c, null, {
      chainId: 31337,
      rpcUrl: env.stack.rpcUrl,
      protocolId: LOCAL_FIXTURE_PROTOCOL_ID,
      riskObserver: a.riskObserver,
    });
  }, 240_000);
  afterAll(async () => env?.close());

  it("is UNKNOWN (never ARMED) before any observer heartbeat exists", async () => {
    const r = await svc.tick();
    expect(r.every((x) => x.status === "UNKNOWN")).toBe(true);
    expect(r[0]!.checks.heartbeat).toBe("unknown");
    expect(
      await env.db.select().from(incidentRecords).where(eq(incidentRecords.kind, "protection_unknown")),
    ).toHaveLength(2);
  }, 60_000);

  it("is ARMED for both policies once observed: solver coverage (A) and exact FlashNet model (B)", async () => {
    await observer.tick();
    const r = await svc.tick();
    const a = r.find((x) => x.policyId === env.stack.addresses.policyA)!;
    const b = r.find((x) => x.policyId === env.stack.addresses.policyB)!;
    expect(a.status).toBe("ARMED");
    expect(b.status).toBe("ARMED");
    // At HF = trigger 1.25 with D = 13,000 and LT 85%: required repay to reach 1.5 (+1e-6 buffer).
    expect(a.requiredRepayAtTrigger! > 2_000_000_000n && a.requiredRepayAtTrigger! < 8_000_000_000n).toBe(
      true,
    );
    expect(b.inputs.flashFeasible).toBe(true);
    const open = await env.db.select().from(incidentRecords).where(eq(incidentRecords.status, "open"));
    expect(open).toHaveLength(0);
    expect((await env.db.select().from(readinessSnapshots)).length).toBe(4);
  }, 60_000);

  it("drops to UNAVAILABLE when the borrower revokes collateral authorization, and recovers", async () => {
    const s = env.stack;
    const aToken = await s.public.readContract({
      address: s.addresses.fixtureMarket,
      abi: fixtureLendingMarketAbi,
      functionName: "getReserveAToken",
      args: [s.addresses.fWETH],
    });
    const approve = async (amt: bigint) =>
      s.public.waitForTransactionReceipt({
        hash: await s.wallet.writeContract({
          account: s.accounts.borrowerB,
          chain: foundry,
          address: aToken,
          abi: fixtureTokenAbi,
          functionName: "approve",
          args: [s.addresses.fixtureAdapter, amt],
        }),
      });
    await approve(0n);
    const r = await svc.evaluate(s.addresses.policyB);
    expect(r.status).toBe("UNAVAILABLE");
    expect(r.inputs.flashReason).toBe("COLLATERAL_NOT_AUTHORIZED");
    await svc.tick();
    const [inc] = await env.db
      .select()
      .from(incidentRecords)
      .where(eq(incidentRecords.kind, "protection_unavailable"));
    expect(inc!.status).toBe("open");
    expect(inc!.recommendedAction).toMatch(/authorize collateral/);
    await approve(5n * 10n ** 18n);
    await svc.tick();
    const [after] = await env.db
      .select()
      .from(incidentRecords)
      .where(eq(incidentRecords.kind, "protection_unavailable"));
    expect(after!.status).toBe("resolved");
  }, 60_000);
});
