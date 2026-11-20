import {
  BPS,
  WAD,
  healthFactor,
  repayBaseForTarget,
  deleverageBaseForTarget,
  flashCostFactorBps,
  mulDiv,
  UINT256_MAX,
} from "@bastion-guardian/risk-engine";

/**
 * Deterministic stress simulator. All outputs are labeled SIMULATED and are hypothetical: they model an
 * Aave-style position under collateral price shocks and do not read or predict live markets.
 */
export interface SimPosition {
  collateralBase: bigint; // 1e8 base units
  debtBase: bigint;
  ltBps: bigint; // position-level LT
  collateralLtBps: bigint;
}

export interface SimPolicy {
  triggerHf: bigint;
  targetHf: bigint;
  maxRepayPerActionBase: bigint;
  flashPremiumBps: bigint;
  maxSlippageBps: bigint;
}

export interface ShockResult {
  provenance: "SIMULATED";
  shockBps: number;
  hfBefore: bigint;
  hfAfterShock: bigint;
  triggered: boolean;
  liquidatable: boolean;
  solverRepayBase: bigint;
  solverHfAfter: bigint | null;
  solverWithinCap: boolean;
  flashRepayBase: bigint | null; // null => target unreachable via deleverage
  flashHfAfter: bigint | null;
}

export function shock(pos: SimPosition, shockBps: number): SimPosition {
  if (!Number.isInteger(shockBps) || shockBps < 0 || shockBps >= 10_000)
    throw new RangeError("shockBps must be an integer in [0, 10000)");
  return { ...pos, collateralBase: mulDiv(pos.collateralBase, BPS - BigInt(shockBps), BPS) };
}

export function simulateShock(pos: SimPosition, policy: SimPolicy, shockBps: number): ShockResult {
  const hfBefore = healthFactor(pos.collateralBase, pos.debtBase, pos.ltBps);
  const s = shock(pos, shockBps);
  const hfAfterShock = healthFactor(s.collateralBase, s.debtBase, s.ltBps);
  const triggered = hfAfterShock < policy.triggerHf;
  const solverRepayBase = triggered
    ? repayBaseForTarget(s.collateralBase, s.debtBase, s.ltBps, policy.targetHf)
    : 0n;
  const solverHfAfter = triggered
    ? healthFactor(s.collateralBase, s.debtBase - solverRepayBase, s.ltBps)
    : null;
  let flashRepayBase: bigint | null = null;
  let flashHfAfter: bigint | null = null;
  if (triggered) {
    const k = flashCostFactorBps(policy.flashPremiumBps, policy.maxSlippageBps);
    const x = deleverageBaseForTarget(
      s.collateralBase,
      s.debtBase,
      s.ltBps,
      s.collateralLtBps,
      k,
      policy.targetHf,
    );
    if (x !== UINT256_MAX && x <= s.debtBase) {
      flashRepayBase = x;
      const withdrawn = mulDiv(x, k, BPS, true);
      if (withdrawn <= s.collateralBase) {
        // weighted collateral loses withdrawn * collateralLt
        const weighted = mulDiv(s.collateralBase, s.ltBps, BPS) - mulDiv(withdrawn, s.collateralLtBps, BPS);
        flashHfAfter = s.debtBase - x === 0n ? UINT256_MAX : mulDiv(weighted, WAD, s.debtBase - x);
      }
    }
  }
  return {
    provenance: "SIMULATED",
    shockBps,
    hfBefore,
    hfAfterShock,
    triggered,
    liquidatable: hfAfterShock < WAD,
    solverRepayBase,
    solverHfAfter,
    solverWithinCap: solverRepayBase <= policy.maxRepayPerActionBase,
    flashRepayBase,
    flashHfAfter,
  };
}

export const DEFAULT_SHOCKS_BPS = [500, 1000, 2000, 4000] as const;

export function stressTest(
  pos: SimPosition,
  policy: SimPolicy,
  shocks: readonly number[] = DEFAULT_SHOCKS_BPS,
): ShockResult[] {
  return shocks.map((b) => simulateShock(pos, policy, b));
}
