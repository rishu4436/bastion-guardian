import { describe, expect, it } from "vitest";
import {
  WAD,
  UINT256_MAX,
  healthFactor,
  repayBaseForTarget,
  deleverageBaseForTarget,
  baseToTokenUp,
  tokenToBase,
  flashCostFactorBps,
  formatWad,
  mulDiv,
} from "../src/index.js";

/**
 * Cross-language vectors. The same inputs/outputs are asserted in
 * contracts/test/unit/CrossLanguageVectors.t.sol so TS and Solidity cannot silently diverge.
 */
export const VECTORS = {
  // 5 WETH @ $2000 (1e8 base), 8000 USDC debt, LT 85%
  collateralBase: 1_000_000_000_000n, // $10,000 * 1e8
  debtBase: 800_000_000_000n, // $8,000 * 1e8
  ltBps: 8500n,
};

describe("HealthFactorMath mirror", () => {
  it("computes Aave-style HF", () => {
    expect(healthFactor(VECTORS.collateralBase, VECTORS.debtBase, VECTORS.ltBps)).toBe(
      1_062_500_000_000_000_000n,
    );
    expect(healthFactor(1n, 0n, 8500n)).toBe(UINT256_MAX);
  });
  it("repay for target 1.5 is minimal and reaches target", () => {
    const x = repayBaseForTarget(VECTORS.collateralBase, VECTORS.debtBase, VECTORS.ltBps, (15n * WAD) / 10n);
    expect(x).toBe(233_333_333_334n);
    expect(
      healthFactor(VECTORS.collateralBase, VECTORS.debtBase - x, VECTORS.ltBps) >= (15n * WAD) / 10n,
    ).toBe(true);
    expect(
      healthFactor(VECTORS.collateralBase, VECTORS.debtBase - x + 1n, VECTORS.ltBps) < (15n * WAD) / 10n,
    ).toBe(true);
  });
  it("deleverage for target 1.5 with 5bps premium + 2% slippage", () => {
    const k = flashCostFactorBps(5n, 200n);
    expect(k).toBe(10_207n);
    const x = deleverageBaseForTarget(
      VECTORS.collateralBase,
      VECTORS.debtBase,
      VECTORS.ltBps,
      8500n,
      k,
      (15n * WAD) / 10n,
    );
    expect(x).toBe(553_442_809_592n);
    // after: worst-case actual cost (premium + full slippage, without the +1bp planning margin) leaves HF >= target
    const actualK = k - 1n;
    const col = VECTORS.collateralBase - mulDiv(x, actualK, 10_000n, true);
    expect(healthFactor(col, VECTORS.debtBase - x, VECTORS.ltBps) >= (15n * WAD) / 10n).toBe(true);
  });
  it("flags unreachable deleverage targets", () => {
    expect(deleverageBaseForTarget(1000n, 900n, 8500n, 8500n, 12_000n, WAD)).toBe(UINT256_MAX);
  });
  it("converts base<->token with conservative rounding", () => {
    expect(baseToTokenUp(233_333_333_334n, 100_000_000n, 6)).toBe(2_333_333_334n);
    expect(tokenToBase(5n * 10n ** 18n, 200_000_000_000n, 18)).toBe(1_000_000_000_000n);
    expect(baseToTokenUp(1n, 0n, 6)).toBe(UINT256_MAX);
  });
  it("never uses floats for display", () => {
    expect(formatWad(1_062_500_000_000_000_000n)).toBe("1.0625");
    expect(formatWad(UINT256_MAX)).toBe("∞");
  });
  it("randomised: repay result is always sufficient and minimal within rounding (2,000 cases)", () => {
    let seed = 0xb457n;
    const rnd = (max: bigint) => {
      seed = (seed * 6364136223846793005n + 1442695040888963407n) % (1n << 64n);
      return (seed % max) + 1n;
    };
    for (let i = 0; i < 2000; i++) {
      const c = rnd(10n ** 16n);
      const d = rnd(10n ** 16n);
      const lt = 5000n + rnd(4000n);
      const t = WAD + rnd(2n * WAD);
      const x = repayBaseForTarget(c, d, lt, t);
      if (x === 0n) {
        expect(healthFactor(c, d, lt) >= t || d === 0n).toBe(true);
        continue;
      }
      expect(x <= d).toBe(true);
      if (x < d) expect(healthFactor(c, d - x, lt) >= t).toBe(true);
      // Near-minimal: flooring of weighted collateral (W = C*LT/1e4) can over-estimate by at most ~1e18/target + 1
      // base units, so repaying 3 base units less must already miss the target.
      expect(healthFactor(c, d - x + 3n, lt) < t).toBe(true);
    }
  });
});
