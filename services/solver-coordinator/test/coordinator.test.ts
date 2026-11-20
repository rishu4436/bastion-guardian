import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { privateKeyToAccount } from "viem/accounts";
import { LOCAL_FIXTURE_PROTOCOL_ID, solverQuotes } from "@bastion-guardian/db";
import { GuardianHealthService } from "@bastion-guardian/guardian-health";
import { RiskObserverService } from "@bastion-guardian/risk-observer";
import { createTestEnv, probePostgres, type TestEnv } from "@bastion/test-env";
import {
  QUOTE_TYPES,
  QuoteRejected,
  SolverCoordinator,
  quoteDomain,
  type SolverQuote,
} from "../src/index.js";

const pgUrl = await probePostgres();

describe.skipIf(!pgUrl)("solver-coordinator (LOCAL SIMULATION: anvil + Postgres)", () => {
  let env: TestEnv;
  let co: SolverCoordinator;
  let now: number;
  const sign = (q: SolverQuote, who = env.stack.accounts.solver) =>
    who.signTypedData({
      domain: quoteDomain(31337, env.stack.addresses.solverLiquidityVault),
      types: QUOTE_TYPES,
      primaryType: "SolverQuote",
      message: q,
    });
  const quote = (over: Partial<SolverQuote> = {}): SolverQuote => ({
    solver: env.stack.addresses.solver,
    policyId: env.stack.addresses.policyA,
    token: env.stack.addresses.fUSDC,
    amount: 5_000_000_000n,
    feeBps: 60,
    validUntil: BigInt(now + 600),
    nonce: 1n,
    ...over,
  });

  beforeAll(async () => {
    env = await createTestEnv(pgUrl!);
    const a = env.stack.addresses;
    co = new SolverCoordinator(env.db, env.stack.public, {
      chainId: 31337,
      solverLiquidityVault: a.solverLiquidityVault,
      solverQuoteManager: a.solverQuoteManager,
      policyRegistry: a.policyRegistry,
    });
    now = Math.floor(Date.now() / 1000);
  }, 240_000);
  afterAll(async () => env?.close());

  it("accepts a valid signed quote and links it to the on-chain commitment", async () => {
    const q = quote();
    const id = await co.submitQuote(q, await sign(q), now);
    expect((await co.tick()).linked).toBe(1);
    const [row] = await env.db.select().from(solverQuotes).where(eq(solverQuotes.id, id));
    expect(row!.status).toBe("committed");
    expect(row!.backingCommitmentId).toBe(env.stack.addresses.commitmentId.toLowerCase());
  });

  it("does not link a quote that exceeds committed liquidity (quotes are never liquidity)", async () => {
    const q = quote({ amount: 9_000_000_000n, nonce: 2n });
    const id = await co.submitQuote(q, await sign(q), now);
    await co.tick();
    const [row] = await env.db.select().from(solverQuotes).where(eq(solverQuotes.id, id));
    expect(row!.status).toBe("offered");
    expect(row!.backingCommitmentId).toBeNull();
  });

  it.each([
    [
      "BAD_SIGNATURE",
      async () =>
        co.submitQuote(
          quote(),
          await sign(quote(), privateKeyToAccount(("0x" + "11".repeat(32)) as `0x${string}`)),
          now,
        ),
    ],
    [
      "FEE_ABOVE_POLICY_MAX",
      async () => {
        const q = quote({ feeBps: 500 });
        return co.submitQuote(q, await sign(q), now);
      },
    ],
    [
      "EXPIRED",
      async () => {
        const q = quote({ validUntil: BigInt(now - 1) });
        return co.submitQuote(q, await sign(q), now);
      },
    ],
    [
      "TTL_TOO_LONG",
      async () => {
        const q = quote({ validUntil: BigInt(now + 86_400) });
        return co.submitQuote(q, await sign(q), now);
      },
    ],
    [
      "WRONG_TOKEN",
      async () => {
        const q = quote({ token: env.stack.addresses.fWETH });
        return co.submitQuote(q, await sign(q), now);
      },
    ],
    [
      "SOLVER_PATH_NOT_ALLOWED",
      async () => {
        const q = quote({ policyId: env.stack.addresses.policyB });
        return co.submitQuote(q, await sign(q), now);
      },
    ],
    [
      "SOLVER_NOT_ACTIVE",
      async () => {
        const lp = env.stack.accounts.lp;
        const q = quote({ solver: lp.address });
        return co.submitQuote(q, await sign(q, lp), now);
      },
    ],
  ])("rejects %s", async (code, fn) => {
    await expect(fn()).rejects.toSatisfy((e: unknown) => e instanceof QuoteRejected && e.code === code);
  });

  it("expires quotes past validUntil", async () => {
    const r = await co.tick(new Date((now + 3600) * 1000));
    expect(r.expired).toBe(2);
  });

  it("publishes demand from readiness and agrees with the on-chain selector", async () => {
    const a = env.stack.addresses;
    const c = env.stack.public;
    await new RiskObserverService(env.db, c, null, {
      chainId: 31337,
      rpcUrl: env.stack.rpcUrl,
      protocolId: LOCAL_FIXTURE_PROTOCOL_ID,
      riskObserver: a.riskObserver,
    }).tick();
    await new GuardianHealthService(
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
    ).tick();
    const d = await co.demand();
    expect(d).toHaveLength(1); // policy B is flash-only
    expect(d[0]!.policyId).toBe(a.policyA.toLowerCase());
    expect(d[0]!.committedCoverage).toBe(8_000_000_000n);
    expect(d[0]!.shortfall).toBe(0n);
    const best = await co.selectBest(a.policyA, a.fUSDC, d[0]!.requiredRepayAtTrigger, 100);
    expect(best?.solver.toLowerCase()).toBe(a.solver.toLowerCase());
  });
});
