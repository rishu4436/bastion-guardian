import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { foundry } from "viem/chains";
import { solverLiquidityVaultAbi } from "@bastion-guardian/contracts";
import { LOCAL_FIXTURE_PROTOCOL_ID } from "@bastion-guardian/db";
import { GuardianHealthService } from "@bastion-guardian/guardian-health";
import { RiskObserverService } from "@bastion-guardian/risk-observer";
import { SolverCoordinator } from "@bastion-guardian/solver-coordinator";
import { createTestEnv, probePostgres, type TestEnv } from "@bastion/test-env";
import { SolverNode, type SolverRiskLimits } from "../src/index.js";

const pgUrl = await probePostgres();

describe.skipIf(!pgUrl)("solver-node (LOCAL SIMULATION: anvil + Postgres)", () => {
  let env: TestEnv;
  let co: SolverCoordinator;
  let health: GuardianHealthService;
  let observer: RiskObserverService;
  const limits: SolverRiskLimits = {
    tokens: [],
    maxPerPolicy: 10_000_000_000n,
    maxTotalCommitted: 40_000_000_000n,
    feeBps: 50,
    commitmentTtlSec: 86_400,
    minCommit: 1_000_000n,
  };
  const mkNode = (l: Partial<SolverRiskLimits> = {}) =>
    new SolverNode(env.stack.public, env.stack.wallet, co, co, {
      chainId: 31337,
      rpcUrl: env.stack.rpcUrl,
      solverLiquidityVault: env.stack.addresses.solverLiquidityVault,
      account: env.stack.accounts.solver,
      limits: { ...limits, tokens: [env.stack.addresses.fUSDC], ...l },
    });
  const refresh = async () => {
    await env.indexer.catchUp();
    await observer.tick();
    return health.tick();
  };

  beforeAll(async () => {
    env = await createTestEnv(pgUrl!);
    const a = env.stack.addresses;
    const c = env.stack.public;
    co = new SolverCoordinator(env.db, c, {
      chainId: 31337,
      solverLiquidityVault: a.solverLiquidityVault,
      solverQuoteManager: a.solverQuoteManager,
      policyRegistry: a.policyRegistry,
    });
    observer = new RiskObserverService(env.db, c, null, {
      chainId: 31337,
      rpcUrl: env.stack.rpcUrl,
      protocolId: LOCAL_FIXTURE_PROTOCOL_ID,
      riskObserver: a.riskObserver,
    });
    health = new GuardianHealthService(
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
        callbackDebtors: [],
        protectionVault: a.protectionVault,
      },
    );
  }, 240_000);
  afterAll(async () => env?.close());

  it("does nothing while committed coverage already meets demand", async () => {
    await refresh();
    const acts = await mkNode().tick();
    expect(acts.every((x) => x.kind === "skip" && x.reason === "NO_SHORTFALL")).toBe(true);
  });

  it("re-covers a policy after its commitment is withdrawn, then readiness returns to ARMED", async () => {
    const s = env.stack;
    const { request } = await s.public.simulateContract({
      account: s.accounts.solver,
      address: s.addresses.solverLiquidityVault,
      abi: solverLiquidityVaultAbi,
      functionName: "release",
      args: [s.addresses.commitmentId],
    });
    await s.public.waitForTransactionReceipt({
      hash: await s.wallet.writeContract({ ...request, account: s.accounts.solver, chain: foundry }),
    });
    const before = await refresh();
    expect(before.find((r) => r.policyId === s.addresses.policyA)!.status).toBe("UNAVAILABLE");
    const d = await co.demand();
    expect(d[0]!.shortfall).toBe(d[0]!.requiredRepayAtTrigger);

    const acts = await mkNode().tick();
    const commit = acts.find((x) => x.kind === "commit")!;
    expect(commit.amount).toBe(d[0]!.requiredRepayAtTrigger);
    const after = await refresh();
    expect(after.find((r) => r.policyId === s.addresses.policyA)!.status).toBe("ARMED");
    await co.tick();
    expect((await co.demand())[0]!.shortfall).toBe(0n);
  }, 60_000);

  it("respects risk limits: fee above policy max and per-policy cap", async () => {
    const s = env.stack;
    // Withdraw again so there is demand, then test limits.
    const ids = await s.public.readContract({
      address: s.addresses.solverLiquidityVault,
      abi: solverLiquidityVaultAbi,
      functionName: "commitmentsOf",
      args: [s.addresses.policyA],
    });
    for (const id of ids) {
      const c = await s.public.readContract({
        address: s.addresses.solverLiquidityVault,
        abi: solverLiquidityVaultAbi,
        functionName: "getCommitment",
        args: [id],
      });
      if (!c.active) continue;
      const { request } = await s.public.simulateContract({
        account: s.accounts.solver,
        address: s.addresses.solverLiquidityVault,
        abi: solverLiquidityVaultAbi,
        functionName: "release",
        args: [id],
      });
      await s.public.waitForTransactionReceipt({
        hash: await s.wallet.writeContract({ ...request, account: s.accounts.solver, chain: foundry }),
      });
    }
    await refresh();
    expect(
      (await mkNode({ feeBps: 500 }).tick()).find((x) => x.policyId === s.addresses.policyA.toLowerCase())!
        .reason,
    ).toBe("FEE_ABOVE_POLICY_MAX");
    const capped = await mkNode({ maxPerPolicy: 1_000_000_000n }).tick();
    expect(capped.find((x) => x.kind === "commit")!.amount).toBe(1_000_000_000n);
    expect(
      (await mkNode({ tokens: [s.addresses.fWETH] }).tick()).some((x) => x.reason === "TOKEN_NOT_SUPPORTED"),
    ).toBe(true);
  }, 60_000);

  it("refuses to run against a non-local chain without authorization", () => {
    expect(
      () =>
        new SolverNode(env.stack.public, env.stack.wallet, co, null, {
          chainId: 84532,
          rpcUrl: "https://sepolia.base.org",
          solverLiquidityVault: env.stack.addresses.solverLiquidityVault,
          account: env.stack.accounts.solver,
          limits,
        }),
    ).toThrow(/ENABLE_LIVE_EXECUTION/);
  });
});
