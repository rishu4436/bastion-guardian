/**
 * Token-level, exact mirror of the on-chain rescue arithmetic:
 *   - FixtureLendingMarket.getUserAccountData (Aave V3 account-data semantics: collateral valued with floor, debt
 *     with ceil, position LT = value-weighted average with floor division)
 *   - AaveV3LendingAdapter.estimateRepayment / estimateDeleverage (incl. TARGET_BUFFER_PPM)
 *   - SolverRescueExecutor.execute and FlashRescueExecutor.isFeasible/execute/_collateralForOwed
 *   - FixtureSwapVenue.quote, Aave/fixture flash premium (ceil)
 *   - BastionCallbackRouter path order: FlashNet first when feasible, solver second.
 *
 * Every function is pure bigint arithmetic. Results are validated against Foundry runs of the real contracts
 * (contracts/test/unit/SimulatorVectors.t.sol ⇄ packages/simulator/test/fixtures/foundry-vectors.json).
 *
 * The official Aave V3 Pool rounds per-asset in ray math, so against real Aave this model is accurate to within the
 * ~1e-10 HF discrepancy documented in the adapter (TARGET_BUFFER_PPM absorbs it); against the fixture it is exact.
 */
import {
  BPS,
  UINT256_MAX,
  WAD,
  baseToTokenUp,
  deleverageBaseForTarget,
  healthFactor,
  mulDiv,
  repayBaseForTarget,
} from "./math.js";

export type Address = `0x${string}`;

export interface ReserveConfig {
  asset: Address;
  symbol: string;
  decimals: number;
  /** Oracle price in base-currency units (Aave: 1e8 USD). */
  price: bigint;
  ltBps: bigint;
  ltvBps: bigint;
}

export interface AccountState {
  reserves: readonly ReserveConfig[];
  /** aToken balances (collateral) per asset, token base units. */
  collateral: Readonly<Record<Address, bigint>>;
  /** variable debt per asset, token base units. */
  debt: Readonly<Record<Address, bigint>>;
}

export interface AccountData {
  totalCollateralBase: bigint;
  totalDebtBase: bigint;
  currentLiquidationThresholdBps: bigint;
  ltvBps: bigint;
  healthFactor: bigint;
}

export const TARGET_BUFFER_PPM = 1n;

const key = (a: Address) => a.toLowerCase() as Address;
function reserveOf(s: AccountState, asset: Address): ReserveConfig {
  const r = s.reserves.find((x) => key(x.asset) === key(asset));
  if (!r) throw new Error(`reserve not listed: ${asset}`);
  return r;
}
const bal = (m: Readonly<Record<Address, bigint>>, a: Address) => m[key(a)] ?? m[a] ?? 0n;

export function normalizeState(s: AccountState): AccountState {
  const lower = (m: Readonly<Record<Address, bigint>>) =>
    Object.fromEntries(Object.entries(m).map(([k, v]) => [k.toLowerCase(), v])) as Record<Address, bigint>;
  return { reserves: s.reserves, collateral: lower(s.collateral), debt: lower(s.debt) };
}

export function accountData(s: AccountState): AccountData {
  let tc = 0n;
  let td = 0n;
  let wLt = 0n;
  let wLtv = 0n;
  for (const r of s.reserves) {
    const c = bal(s.collateral, r.asset);
    if (c > 0n) {
      const v = mulDiv(c, r.price, 10n ** BigInt(r.decimals));
      tc += v;
      wLt += v * r.ltBps;
      wLtv += v * r.ltvBps;
    }
    const d = bal(s.debt, r.asset);
    if (d > 0n) td += mulDiv(d, r.price, 10n ** BigInt(r.decimals), true);
  }
  const lt = tc > 0n ? wLt / tc : 0n;
  const ltv = tc > 0n ? wLtv / tc : 0n;
  return {
    totalCollateralBase: tc,
    totalDebtBase: td,
    currentLiquidationThresholdBps: lt,
    ltvBps: ltv,
    healthFactor: healthFactor(tc, td, lt),
  };
}

export function bufferedTarget(targetHf: bigint): bigint {
  return targetHf + (targetHf * TARGET_BUFFER_PPM) / 1_000_000n;
}

/** AaveV3LendingAdapter.estimateRepayment (token units of the debt asset, capped at actual debt). */
export function estimateRepayment(s: AccountState, debtAsset: Address, targetHf: bigint): bigint {
  const a = accountData(s);
  const xBase = repayBaseForTarget(
    a.totalCollateralBase,
    a.totalDebtBase,
    a.currentLiquidationThresholdBps,
    bufferedTarget(targetHf),
  );
  if (xBase === 0n) return 0n;
  const r = reserveOf(s, debtAsset);
  const amount = baseToTokenUp(xBase, r.price, r.decimals);
  const d = bal(s.debt, debtAsset);
  return amount > d ? d : amount;
}

/** FlashRescueExecutor.costFactorBps: ceil((BPS+premium)(BPS+slippage)/BPS) + 1. */
export function costFactorBps(flashPremiumBps: bigint, maxSlippageBps: bigint): bigint {
  return mulDiv(BPS + flashPremiumBps, BPS + maxSlippageBps, BPS, true) + 1n;
}

/** AaveV3LendingAdapter.estimateDeleverage. Returns UINT256_MAX when the target is unreachable by deleveraging. */
export function estimateDeleverage(
  s: AccountState,
  collateralAsset: Address,
  debtAsset: Address,
  targetHf: bigint,
  costFactor: bigint,
): bigint {
  const a = accountData(s);
  const c = reserveOf(s, collateralAsset);
  const d = reserveOf(s, debtAsset);
  const xBase = deleverageBaseForTarget(
    a.totalCollateralBase,
    a.totalDebtBase,
    a.currentLiquidationThresholdBps,
    c.ltBps,
    costFactor,
    bufferedTarget(targetHf),
  );
  if (xBase === UINT256_MAX) return UINT256_MAX;
  if (xBase === 0n) return 0n;
  const amount = baseToTokenUp(xBase, d.price, d.decimals);
  const debt = bal(s.debt, debtAsset);
  return amount > debt ? debt : amount;
}

export function flashPremium(amount: bigint, premiumBps: bigint): bigint {
  return mulDiv(amount, premiumBps, BPS, true);
}

/** FlashRescueExecutor._collateralForOwed. */
export function collateralForOwed(
  owed: bigint,
  debt: ReserveConfig,
  coll: ReserveConfig,
  maxSlippageBps: bigint,
): bigint {
  const owedBase = mulDiv(owed, debt.price, 10n ** BigInt(debt.decimals), true);
  const withSlip = mulDiv(owedBase, BPS + maxSlippageBps, BPS, true);
  return baseToTokenUp(withSlip, coll.price, coll.decimals);
}

/** FixtureSwapVenue.quote (oracle-priced venue with a configurable execution cost). */
export function venueQuote(
  amountIn: bigint,
  tokenIn: ReserveConfig,
  tokenOut: ReserveConfig,
  executionCostBps: bigint,
): bigint {
  const valueBase = mulDiv(amountIn, tokenIn.price, 10n ** BigInt(tokenIn.decimals));
  const gross = mulDiv(valueBase, 10n ** BigInt(tokenOut.decimals), tokenOut.price);
  return (gross * (BPS - executionCostBps)) / BPS;
}

// ---------------------------------------------------------------------------------------------------------------
// policy + rescue simulation

export interface PolicyLimits {
  collateralAsset: Address;
  debtAsset: Address;
  triggerHf: bigint;
  targetHf: bigint;
  /** min(maxTotalRepay - totalRepaid, maxRepayPerAction) — BastionPolicyRegistry.remainingRepay. */
  remainingRepay: bigint;
  remainingFees: bigint;
  maxSlippageBps: bigint;
  maxFeeBps: bigint;
  allowPartial: boolean;
  allowFlash: boolean;
  allowSolver: boolean;
}

export interface SolverCommitment {
  id: string;
  solver: Address;
  amount: bigint;
  feeBps: bigint;
  failures: number;
}

export interface FlashEnvironment {
  flashLoanAvailable: boolean;
  flashPremiumBps: bigint;
  /** Liquidity the flash lender can lend in the debt asset (token units). */
  flashLiquidity: bigint;
  venueAvailable: boolean;
  venueExecutionCostBps: bigint;
  /** min(aToken allowance, aToken balance, account pull cap) — adapter.collateralAuthorization. */
  collateralAuthorization: bigint;
}

export type Reason = string;

export interface RescueOutcome {
  path: "flash" | "solver";
  feasible: boolean;
  reason: Reason | null;
  repay: bigint;
  /** Flash: premium paid to the flash lender. Solver: solver fee reimbursed from the reserve. */
  fee: bigint;
  collateralSold: bigint;
  surplusToBorrower: bigint;
  solver: Address | null;
  after: AccountState | null;
  afterData: AccountData | null;
}

function withBalances(
  s: AccountState,
  collateral: Record<Address, bigint>,
  debt: Record<Address, bigint>,
): AccountState {
  return {
    reserves: s.reserves,
    collateral: { ...s.collateral, ...collateral },
    debt: { ...s.debt, ...debt },
  };
}

function fail(path: RescueOutcome["path"], reason: Reason): RescueOutcome {
  return {
    path,
    feasible: false,
    reason,
    repay: 0n,
    fee: 0n,
    collateralSold: 0n,
    surplusToBorrower: 0n,
    solver: null,
    after: null,
    afterData: null,
  };
}

/** SolverQuoteManager._better ordering. Commitments must already be filtered to eligible, unexpired, allowlisted ones. */
export function rankCommitments(
  cs: readonly SolverCommitment[],
  required: bigint,
  maxFeeBps: bigint,
): SolverCommitment[] {
  return cs
    .filter((c) => c.amount > 0n && c.feeBps <= maxFeeBps)
    .slice()
    .sort((a, b) => {
      const af = a.amount >= required;
      const bf = b.amount >= required;
      if (af !== bf) return af ? -1 : 1;
      if (a.feeBps !== b.feeBps) return a.feeBps < b.feeBps ? -1 : 1;
      if (a.amount !== b.amount) return a.amount > b.amount ? -1 : 1;
      if (a.failures !== b.failures) return a.failures - b.failures;
      return BigInt(a.id) < BigInt(b.id) ? -1 : 1;
    });
}

/** Mirrors SolverRescueExecutor.execute (and isFeasible's checks). */
export function simulateSolverRescue(
  s0: AccountState,
  p: PolicyLimits,
  commitments: readonly SolverCommitment[],
): RescueOutcome {
  const s = normalizeState(s0);
  if (!p.allowSolver) return fail("solver", "PATH_NOT_ALLOWED");
  const before = accountData(s);
  const debt = bal(s.debt, p.debtAsset);
  let need = estimateRepayment(s, p.debtAsset, p.targetHf);
  const cap = p.remainingRepay < debt ? p.remainingRepay : debt;
  const capped = need > cap;
  if (capped) need = cap;
  if (need === 0n) return fail("solver", "NOTHING_TO_REPAY");
  const ranked = rankCommitments(commitments, need, p.maxFeeBps);
  const best = ranked[0];
  if (!best) return fail("solver", "NO_SOLVER_COMMITMENT");
  const amount = need < best.amount ? need : best.amount;
  if ((amount < need || capped) && !p.allowPartial)
    return fail("solver", capped ? "BUDGET_BELOW_REQUIRED" : "INSUFFICIENT_SOLVER_LIQUIDITY");
  const spent = amount < debt ? amount : debt;
  const fee = mulDiv(spent, best.feeBps, BPS);
  if (fee > p.remainingFees) return fail("solver", "FEE_LIMIT_EXCEEDED");
  const after = withBalances(s, {}, { [key(p.debtAsset)]: debt - spent });
  const ad = accountData(after);
  if (ad.healthFactor <= before.healthFactor) return fail("solver", "NO_ECONOMIC_EFFECT");
  return {
    path: "solver",
    feasible: true,
    reason: null,
    repay: spent,
    fee,
    collateralSold: 0n,
    surplusToBorrower: 0n,
    solver: best.solver,
    after,
    afterData: ad,
  };
}

/** Mirrors FlashRescueExecutor.isFeasible + execute + executeOperation. */
export function simulateFlashRescue(s0: AccountState, p: PolicyLimits, env: FlashEnvironment): RescueOutcome {
  const s = normalizeState(s0);
  if (!p.allowFlash) return fail("flash", "PATH_NOT_ALLOWED");
  if (!env.venueAvailable) return fail("flash", "NO_SWAP_VENUE");
  if (!env.flashLoanAvailable) return fail("flash", "NO_FLASH_LENDER");
  const cRes = reserveOf(s, p.collateralAsset);
  const dRes = reserveOf(s, p.debtAsset);
  const k = costFactorBps(env.flashPremiumBps, p.maxSlippageBps);
  const x = estimateDeleverage(s, p.collateralAsset, p.debtAsset, p.targetHf, k);
  if (x === UINT256_MAX && !p.allowPartial) return fail("flash", "TARGET_UNREACHABLE");
  if (x === 0n) return fail("flash", "NOTHING_TO_REPAY");
  const debt = bal(s.debt, p.debtAsset);
  const cap = p.remainingRepay < debt ? p.remainingRepay : debt;
  const repay = x > cap ? cap : x;
  if (repay < x && !p.allowPartial) return fail("flash", "BUDGET_BELOW_REQUIRED");
  if (repay > env.flashLiquidity) return fail("flash", "FLASH_LIQUIDITY_INSUFFICIENT");
  const premium = flashPremium(repay, env.flashPremiumBps);
  const owed = repay + premium;
  const collNeeded = collateralForOwed(owed, dRes, cRes, p.maxSlippageBps);
  if (env.collateralAuthorization < collNeeded) return fail("flash", "COLLATERAL_NOT_AUTHORIZED");
  const coll = bal(s.collateral, p.collateralAsset);
  if (collNeeded > coll) return fail("flash", "INSUFFICIENT_COLLATERAL");
  const before = accountData(s);
  // repay, then aToken transfer to the adapter: the market validates HF >= 1 after the transfer.
  const after = withBalances(
    s,
    { [key(p.collateralAsset)]: coll - collNeeded },
    { [key(p.debtAsset)]: debt - repay },
  );
  const ad = accountData(after);
  if (ad.healthFactor < WAD) return fail("flash", "HF_BELOW_ONE_AFTER_WITHDRAW");
  const out = venueQuote(collNeeded, cRes, dRes, env.venueExecutionCostBps);
  if (out < owed) return fail("flash", "SLIPPAGE");
  if (premium > p.remainingFees) return fail("flash", "FEE_LIMIT_EXCEEDED");
  if (ad.healthFactor <= before.healthFactor) return fail("flash", "NO_ECONOMIC_EFFECT");
  return {
    path: "flash",
    feasible: true,
    reason: null,
    repay,
    fee: premium,
    collateralSold: collNeeded,
    surplusToBorrower: out - owed,
    solver: null,
    after,
    afterData: ad,
  };
}

export interface RescueDecision {
  /** Deterministic order identical to BastionCallbackRouter._choosePaths. */
  order: ("flash" | "solver")[];
  chosen: RescueOutcome | null;
  flash: RescueOutcome;
  solver: RescueOutcome;
  explanation: string[];
}

export function decideRescue(
  s: AccountState,
  p: PolicyLimits,
  env: FlashEnvironment,
  commitments: readonly SolverCommitment[],
): RescueDecision {
  const flash = simulateFlashRescue(s, p, env);
  const solver = simulateSolverRescue(s, p, commitments);
  const order: RescueDecision["order"] = [];
  const explanation: string[] = [];
  if (flash.feasible) {
    order.push("flash");
    explanation.push(
      "FlashNet is feasible: self-funded and atomic, so it carries no cross-chain settlement risk; it is tried first.",
    );
  } else explanation.push(`FlashNet unavailable: ${flash.reason}.`);
  if (solver.feasible) {
    order.push("solver");
    explanation.push(
      flash.feasible
        ? "Solver rescue is the fallback if FlashNet reverts at execution time."
        : "Solver rescue is used: a committed solver repays and is reimbursed from the reserve.",
    );
  } else explanation.push(`Solver rescue unavailable: ${solver.reason}.`);
  const chosen = order[0] === "flash" ? flash : order[0] === "solver" ? solver : null;
  if (!chosen)
    explanation.push(
      "No feasible path: the router would record NO_FEASIBLE_PATH and the position stays unprotected.",
    );
  return { order, chosen, flash, solver, explanation };
}

/** Single-collateral liquidation boundary: collateral price at which HF = 1 (other prices fixed). */
export function liquidationPrice(s: AccountState, collateralAsset: Address): bigint | null {
  const a = accountData(s);
  const c = reserveOf(s, collateralAsset);
  const amt = bal(normalizeState(s).collateral, collateralAsset);
  if (a.totalDebtBase === 0n || amt === 0n) return null;
  // Other collateral contributes weighted value too.
  const thisValue = mulDiv(amt, c.price, 10n ** BigInt(c.decimals));
  const otherWeighted = a.totalCollateralBase * a.currentLiquidationThresholdBps - thisValue * c.ltBps;
  const needWeighted = a.totalDebtBase * BPS - (otherWeighted > 0n ? otherWeighted : 0n);
  if (needWeighted <= 0n) return 0n;
  // price * amt / 10^dec * lt >= needWeighted  => price = needWeighted * 10^dec / (amt * lt), ceil
  return mulDiv(needWeighted, 10n ** BigInt(c.decimals), amt * c.ltBps, true);
}
