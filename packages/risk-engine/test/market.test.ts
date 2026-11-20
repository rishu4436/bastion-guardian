import { describe, expect, it } from "vitest";
import {
  accountData,
  decideRescue,
  liquidationPrice,
  simulateFlashRescue,
  simulateSolverRescue,
  type AccountState,
  type PolicyLimits,
} from "../src/market.js";

const USDC = "0x00000000000000000000000000000000000000c1" as const;
const WETH = "0x00000000000000000000000000000000000000e1" as const;

export function fixtureState(wethPrice: bigint, debt = 13_000_000_000n): AccountState {
  return {
    reserves: [
      { asset: WETH, symbol: "fWETH", decimals: 18, price: wethPrice, ltBps: 8500n, ltvBps: 8000n },
      { asset: USDC, symbol: "fUSDC", decimals: 6, price: 100_000_000n, ltBps: 8000n, ltvBps: 7500n },
    ],
    collateral: { [WETH]: 10n * 10n ** 18n },
    debt: { [USDC]: debt },
  };
}

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
const env = {
  flashLoanAvailable: true,
  flashPremiumBps: 5n,
  flashLiquidity: 10n ** 30n,
  venueAvailable: true,
  venueExecutionCostBps: 30n,
  collateralAuthorization: 5n * 10n ** 18n,
};

describe("market model vs. the local anvil run of the real contracts (evidence/local-simulation)", () => {
  it("HF after the 2000→1800 crash equals the on-chain value 1.1769…", () => {
    expect(accountData(fixtureState(1800n * 10n ** 8n)).healthFactor).toBe(1_176_923_076_923_076_923n);
  });

  it("solver path repays exactly 2,800.010200 fUSDC with a 50 bps fee (on-chain: debt 13000000000 → 10199989800)", () => {
    const r = simulateSolverRescue(fixtureState(1800n * 10n ** 8n), policy, [
      {
        id: "0x01",
        solver: "0x00000000000000000000000000000000000000aa",
        amount: 8_000_000_000n,
        feeBps: 50n,
        failures: 0,
      },
    ]);
    expect(r.feasible).toBe(true);
    expect(r.repay).toBe(13_000_000_000n - 10_199_989_800n);
    expect(r.fee).toBe(2_814_010_251n - 2_800_010_200n);
    expect(r.afterData!.healthFactor >= policy.targetHf).toBe(true);
  });

  it("flash path leaves exactly 6,358.671202 fUSDC of debt (on-chain value)", () => {
    const r = simulateFlashRescue(fixtureState(1800n * 10n ** 8n), { ...policy, allowSolver: false }, env);
    expect(r.feasible).toBe(true);
    expect(13_000_000_000n - r.repay).toBe(6_358_671_202n);
  });

  it("router order: flash first when both feasible; solver when flash lacks authorization", () => {
    const cs = [
      {
        id: "0x01",
        solver: "0x00000000000000000000000000000000000000aa" as const,
        amount: 8_000_000_000n,
        feeBps: 50n,
        failures: 0,
      },
    ];
    const both = decideRescue(
      fixtureState(1800n * 10n ** 8n),
      { ...policy, remainingRepay: 8_000_000_000n },
      env,
      cs,
    );
    expect(both.order).toEqual(["flash", "solver"]);
    const noAuth = decideRescue(
      fixtureState(1800n * 10n ** 8n),
      policy,
      { ...env, collateralAuthorization: 0n },
      cs,
    );
    expect(noAuth.order).toEqual(["solver"]);
    expect(noAuth.flash.reason).toBe("COLLATERAL_NOT_AUTHORIZED");
  });

  it("liquidation price for 10 WETH / 13,000 USDC at LT 85% is 1529.41…", () => {
    const p = liquidationPrice(fixtureState(2000n * 10n ** 8n), WETH)!;
    expect(p).toBe(152_941_176_471n); // ceil(13000e8*1e4*1e18 / (10e18*8500))
    expect(accountData(fixtureState(p)).healthFactor >= 10n ** 18n).toBe(true);
    expect(accountData(fixtureState(p - 1n)).healthFactor < 10n ** 18n).toBe(true);
  });
});
