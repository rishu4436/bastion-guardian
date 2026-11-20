import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { accountData, type AccountState, type PolicyLimits } from "@bastion-guardian/risk-engine";
import {
  SECTION_10_SHOCKS_BPS,
  applyShock,
  compareStrategies,
  runScenario,
  type ScenarioBase,
} from "../src/index.js";

const USDC = "0x00000000000000000000000000000000000000c1" as const;
const WETH = "0x00000000000000000000000000000000000000e1" as const;

// Same configuration as contracts/test/BastionTestBase + SimulatorVectors.t.sol (labeled fixture market).
const state: AccountState = {
  reserves: [
    { asset: WETH, symbol: "fWETH", decimals: 18, price: 2000n * 10n ** 8n, ltBps: 8500n, ltvBps: 8000n },
    { asset: USDC, symbol: "fUSDC", decimals: 6, price: 100_000_000n, ltBps: 8000n, ltvBps: 7500n },
  ],
  collateral: { [WETH]: 10n * 10n ** 18n },
  debt: { [USDC]: 13_000_000_000n },
};
const policy: PolicyLimits = {
  collateralAsset: WETH,
  debtAsset: USDC,
  triggerHf: 1_250_000_000_000_000_000n,
  targetHf: 1_500_000_000_000_000_000n,
  remainingRepay: 8_000_000_000n,
  remainingFees: 200_000_000n,
  maxSlippageBps: 200n,
  maxFeeBps: 100n,
  allowPartial: false,
  allowFlash: true,
  allowSolver: true,
};
const base: ScenarioBase = {
  state,
  policy,
  flash: {
    flashLoanAvailable: true,
    flashPremiumBps: 5n,
    flashLiquidity: 500_000_000_000n,
    venueAvailable: true,
    venueExecutionCostBps: 30n,
    collateralAuthorization: 5n * 10n ** 18n,
  },
  commitments: [
    {
      id: "0x01",
      solver: "0x00000000000000000000000000000000000000aa",
      amount: 8_000_000_000n,
      feeBps: 50n,
      failures: 0,
    },
  ],
  funding: {
    destinationCallbackBalanceWei: 10n ** 17n,
    reactiveCoreBalanceWei: 10n ** 18n,
    minDestinationWei: 10n ** 16n,
    minReactiveWei: 10n ** 17n,
  },
  reserveBudget: { principal: 10_000_000_000n, fee: 200_000_000n },
};

interface Vector {
  shockBps: number;
  path: "flash" | "solver";
  success: boolean;
  reason: string;
  hfAfterShock: number | string;
  hfAfter: number | string;
  debtAfter: number | string;
  collateralAfter: number | string;
  borrowerUsdcWallet: number | string;
}
// forge's JSON writer emits large integers as JSON numbers; re-read them losslessly as strings.
const raw = readFileSync(new URL("./fixtures/foundry-vectors.json", import.meta.url), "utf8").replace(
  /:\s*(\d{16,})/g,
  ': "$1"',
);
const vectors = Object.values(JSON.parse(raw) as Record<string, Vector>);

describe("contract-math parity with Foundry runs of the real executors", () => {
  it("has all Section 10 shock levels for both paths", () => {
    expect(vectors).toHaveLength(SECTION_10_SHOCKS_BPS.length * 2);
  });
  for (const v of vectors) {
    it(`${v.shockBps / 100}% shock, ${v.path}: matches on-chain result bit-for-bit`, () => {
      const only = v.path === "flash" ? { allowSolver: false } : { allowFlash: false };
      const r = runScenario(
        { ...base, policy: { ...policy, ...only } },
        { kind: "price_shock", shockBps: v.shockBps },
      );
      expect(r.shocked.healthFactor).toBe(BigInt(v.hfAfterShock));
      const p = v.path === "flash" ? r.flash : r.solver;
      expect(p.feasible).toBe(v.success);
      if (!v.success) {
        expect(p.reason).toBe(v.reason);
        expect(r.resultingHf).toBe(BigInt(v.hfAfter));
        return;
      }
      expect(p.remainingDebt).toBe(BigInt(v.debtAfter));
      expect(p.remainingCollateral).toBe(BigInt(v.collateralAfter));
      expect(p.resultingHf).toBe(BigInt(v.hfAfter));
      expect(13_000_000_000n + p.surplusToBorrower).toBe(BigInt(v.borrowerUsdcWallet));
    });
  }
});

describe("Section 10 scenarios", () => {
  it("custom shock below trigger does not trigger", () => {
    const r = runScenario(base, { kind: "price_shock", shockBps: 100 });
    expect(r.outcome).toBe("not_triggered");
    expect(r.provenance).toBe("SIMULATED");
  });

  it("40% shock: liquidatable, flash over budget, solver rescues to target", () => {
    const r = runScenario(base, { kind: "price_shock", shockBps: 4000 });
    expect(r.liquidatable).toBe(true);
    expect(r.flash.reason).toBe("BUDGET_BELOW_REQUIRED");
    expect(r.outcome).toBe("solver");
    expect(r.solver.capitalRequired).toBe(r.solver.repay);
    expect(r.resultingHf >= policy.targetHf).toBe(true);
  });

  it("flash reports slippage cost, zero capital and surplus to the borrower", () => {
    const r = runScenario(base, { kind: "price_shock", shockBps: 1000 });
    expect(r.outcome).toBe("flash");
    expect(r.flash.capitalRequired).toBe(0n);
    expect(r.flash.slippageCostBase > 0n).toBe(true);
    expect(r.flash.surplusToBorrower).toBe(112_560_361n);
  });

  it("multi-step crash consumes budget across steps", () => {
    const r = runScenario(base, { kind: "multi_step_crash", stepsBps: [1000, 1500, 2000] });
    expect(r.steps).toHaveLength(3);
    expect(r.steps![0]!.outcome).toBe("flash");
    expect(r.forecast).toBe(true);
    const repaid = r.steps!.reduce(
      (a, s) => a + (s.outcome === "flash" ? s.flash.repay : s.outcome === "solver" ? s.solver.repay : 0n),
      0n,
    );
    expect(repaid <= policy.remainingRepay).toBe(true);
  });

  it("oracle delay with further drift adds the delay to time-to-protection", () => {
    const r = runScenario(base, {
      kind: "oracle_delay",
      shockBps: 1000,
      delaySec: 60,
      driftDuringDelayBps: 1000,
    });
    expect(r.timeToProtectionSec).toBe(70);
    expect(
      r.shocked.healthFactor <
        runScenario(base, { kind: "price_shock", shockBps: 1000 }).shocked.healthFactor,
    ).toBe(true);
  });

  it("liquidity deterioration makes flash fail on slippage and falls back to solver", () => {
    const r = runScenario(base, {
      kind: "liquidity_deterioration",
      shockBps: 1000,
      venueExecutionCostBps: 500n,
    });
    expect(r.flash.reason).toBe("SLIPPAGE");
    expect(r.outcome).toBe("solver");
  });

  it("solver liquidity disappearance with flash unauthorized leaves no path", () => {
    const r = runScenario(
      { ...base, flash: { ...base.flash, collateralAuthorization: 0n } },
      { kind: "solver_liquidity_disappearance", shockBps: 1000 },
    );
    expect(r.outcome).toBe("none");
    expect(r.failureConditions).toContain("NO_FEASIBLE_PATH");
    expect(r.recoveryOptions.join(" ")).toMatch(/aToken approval/);
  });

  it("callback delay beyond 120 s is rejected as stale", () => {
    expect(runScenario(base, { kind: "callback_delay", shockBps: 1000, delaySec: 60 }).outcome).toBe("flash");
    const r = runScenario(base, { kind: "callback_delay", shockBps: 1000, delaySec: 121 });
    expect(r.outcome).toBe("none");
    expect(r.failureConditions[0]).toMatch(/^STALE_SIGNAL/);
  });

  it("callback failure on flash falls back to solver", () => {
    const r = runScenario(base, { kind: "callback_failure", shockBps: 1000, failedPath: "flash" });
    expect(r.outcome).toBe("solver");
    expect(r.failureConditions[0]).toMatch(/FLASH_REVERTED/);
  });

  it("Reactive balance depletion blocks automated protection", () => {
    const r = runScenario(
      { ...base, funding: { ...base.funding!, reactiveCoreBalanceWei: 0n } },
      { kind: "reactive_balance_depletion", shockBps: 1000 },
    );
    expect(r.outcome).toBe("none");
    expect(r.failureConditions[0]).toMatch(/REACTIVE_CORE_UNDERFUNDED/);
  });

  it("flash unavailable uses solver", () => {
    const r = runScenario(base, { kind: "flash_unavailable", shockBps: 1000 });
    expect(r.flash.reason).toBe("NO_FLASH_LENDER");
    expect(r.outcome).toBe("solver");
  });

  it("partial rescue improves HF without reaching target", () => {
    const r = runScenario(base, { kind: "partial_rescue", shockBps: 4000, remainingRepay: 2_000_000_000n });
    expect(r.outcome).not.toBe("none");
    expect(r.resultingHf > r.shocked.healthFactor).toBe(true);
    expect(r.resultingHf < policy.targetHf).toBe(true);
  });

  it("concurrent user repayment shrinks or cancels the rescue", () => {
    const full = runScenario(base, { kind: "price_shock", shockBps: 1000 });
    const r = runScenario(base, { kind: "concurrent_repayment", shockBps: 1000, userRepay: 1_000_000_000n });
    expect(r.requiredRepay < full.requiredRepay).toBe(true);
    const cancelled = runScenario(base, {
      kind: "concurrent_repayment",
      shockBps: 1000,
      userRepay: 5_000_000_000n,
    });
    expect(cancelled.outcome).toBe("not_triggered");
  });

  it("settlement delay with underfunded reserve requires recovery", () => {
    const r = runScenario(
      { ...base, flash: { ...base.flash, flashLoanAvailable: false } },
      { kind: "settlement_delay", shockBps: 1000, delaySec: 600, reserveUnderfunded: true },
    );
    expect(r.outcome).toBe("solver");
    expect(r.failureConditions.join(" ")).toMatch(/RecoveryRequired/);
    expect(r.recoveryOptions.join(" ")).toMatch(/retrySettlement/);
  });

  it("strategy comparison: manual is cheapest in fees, unprotected stays at shocked HF", () => {
    const c = compareStrategies(base, 2000);
    expect(c.unprotected.hf).toBe(accountData(applyShock(state, WETH, 2000)).healthFactor);
    expect(c.manual.hf >= policy.targetHf).toBe(true);
    expect(c.solver.feasible).toBe(true);
    expect(c.flash.feasible).toBe(false);
    expect(c.partial.feasible).toBe(true);
  });

  it("rejects invalid shocks", () => {
    expect(() => runScenario(base, { kind: "price_shock", shockBps: 10_000 })).toThrow(RangeError);
  });
});
