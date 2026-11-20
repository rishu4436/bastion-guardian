/**
 * Exact bigint mirror of contracts/src/libraries/HealthFactorMath.sol. Rounding directions match Solidity
 * (OpenZeppelin Math.mulDiv Floor/Ceil). No floating point is used anywhere in this module.
 */
export const WAD = 10n ** 18n;
export const BPS = 10_000n;
export const UINT256_MAX = (1n << 256n) - 1n;

export function mulDiv(a: bigint, b: bigint, d: bigint, roundUp = false): bigint {
  if (d === 0n) throw new RangeError("mulDiv: division by zero");
  if (a < 0n || b < 0n || d < 0n) throw new RangeError("mulDiv: negative operand");
  const p = a * b;
  const q = p / d;
  const r = roundUp && p % d !== 0n ? q + 1n : q;
  if (r > UINT256_MAX) throw new RangeError("mulDiv: overflow");
  return r;
}

export function healthFactor(totalCollateralBase: bigint, totalDebtBase: bigint, ltBps: bigint): bigint {
  if (totalDebtBase === 0n) return UINT256_MAX;
  return mulDiv(totalCollateralBase * ltBps, WAD, totalDebtBase * BPS);
}

export function repayBaseForTarget(
  totalCollateralBase: bigint,
  totalDebtBase: bigint,
  ltBps: bigint,
  targetHf: bigint,
): bigint {
  if (targetHf === 0n) return totalDebtBase;
  const weighted = mulDiv(totalCollateralBase, ltBps, BPS);
  const maxDebtAtTarget = mulDiv(weighted, WAD, targetHf);
  return totalDebtBase <= maxDebtAtTarget ? 0n : totalDebtBase - maxDebtAtTarget;
}

export function deleverageBaseForTarget(
  totalCollateralBase: bigint,
  totalDebtBase: bigint,
  ltBps: bigint,
  collateralLtBps: bigint,
  costFactorBps: bigint,
  targetHf: bigint,
): bigint {
  const weighted = mulDiv(totalCollateralBase, ltBps, BPS);
  const targetTimesDebt = mulDiv(targetHf, totalDebtBase, WAD);
  if (targetTimesDebt <= weighted) return 0n;
  const kLt = mulDiv(costFactorBps * collateralLtBps, WAD, BPS * BPS);
  if (targetHf <= kLt) return UINT256_MAX;
  return mulDiv(targetTimesDebt - weighted, WAD, targetHf - kLt, true);
}

export function baseToTokenUp(baseValue: bigint, price: bigint, decimals: number): bigint {
  if (price === 0n) return UINT256_MAX;
  return mulDiv(baseValue, 10n ** BigInt(decimals), price, true);
}

export function tokenToBase(amount: bigint, price: bigint, decimals: number): bigint {
  return mulDiv(amount, price, 10n ** BigInt(decimals));
}

/** Mirrors FlashRescueExecutor cost factor: ceil((BPS+premium)*(BPS+slip)/BPS) + 1. */
export function flashCostFactorBps(premiumBps: bigint, slippageBps: bigint): bigint {
  return mulDiv(BPS + premiumBps, BPS + slippageBps, BPS, true) + 1n;
}

/** Render a WAD value as a fixed-decimal string without floats (display only). */
export function formatWad(v: bigint, decimals = 4): string {
  if (v === UINT256_MAX) return "∞";
  const scale = 10n ** BigInt(18 - decimals);
  const scaled = v / scale;
  const whole = scaled / 10n ** BigInt(decimals);
  const frac = (scaled % 10n ** BigInt(decimals)).toString().padStart(decimals, "0");
  return decimals === 0 ? whole.toString() : `${whole}.${frac}`;
}
