/**
 * Section 10 scenario simulator on the exact token-level model in @bastion-guardian/risk-engine/market.
 *
 * Every result carries `provenance: "SIMULATED"`; `forecast: true` marks results that depend on assumed future
 * conditions (timings, drifts, liquidity) rather than on a deterministic replay of contract math. Nothing here reads
 * or predicts live markets. Contract-math parity is asserted against Foundry runs of the real executors
 * (test/fixtures/foundry-vectors.json, produced by contracts/test/unit/SimulatorVectors.t.sol).
 */
import {
  BPS,
  WAD,
  accountData,
  decideRescue,
  estimateRepayment,
  liquidationPrice,
  normalizeState,
  type AccountData,
  type AccountState,
  type Address,
  type FlashEnvironment,
  type PolicyLimits,
  type RescueOutcome,
  type SolverCommitment,
} from "@bastion-guardian/risk-engine";

export interface TimingAssumptions {
  /** Router rejects observations older than this (BastionCallbackRouter: 120 s). */
  maxSignalAgeSec: number;
  /** Router rejects observations stamped further than this in the future (30 s). */
  maxFutureSkewSec: number;
  /** Observer refuses observations closer together than this for a policy. */
  observerMinIntervalSec: number;
  /** Assumed Reactive delivery latency origin → destination (an assumption, not a measurement). */
  callbackDelaySec: number;
  /** Assumed latency for the settlement callback to reach the reserve chain. */
  settlementDelaySec: number;
}

export const DEFAULT_TIMING: TimingAssumptions = {
  maxSignalAgeSec: 120,
  maxFutureSkewSec: 30,
  observerMinIntervalSec: 60,
  callbackDelaySec: 10,
  settlementDelaySec: 30,
};

export interface ReactiveFunding {
  /** Callback-contract balance (wei) on the destination chain and the REACT balance of the core. */
  destinationCallbackBalanceWei: bigint;
  reactiveCoreBalanceWei: bigint;
  /** Minimum balances below which delivery is not expected to happen. */
  minDestinationWei: bigint;
  minReactiveWei: bigint;
}

export interface ScenarioBase {
  state: AccountState;
  policy: PolicyLimits;
  flash: FlashEnvironment;
  commitments: readonly SolverCommitment[];
  timing?: Partial<TimingAssumptions>;
  funding?: ReactiveFunding;
  /** Reserve budget on the reserve chain backing solver reimbursement (principal + fee), token units. */
  reserveBudget?: { principal: bigint; fee: bigint };
}

export type ScenarioSpec =
  | { kind: "price_shock"; shockBps: number; asset?: Address }
  | { kind: "multi_step_crash"; stepsBps: number[]; asset?: Address }
  | { kind: "oracle_delay"; shockBps: number; delaySec: number; driftDuringDelayBps: number }
  | { kind: "liquidity_deterioration"; shockBps: number; venueExecutionCostBps: bigint }
  | { kind: "solver_liquidity_disappearance"; shockBps: number; remainingFraction?: number }
  | { kind: "callback_delay"; shockBps: number; delaySec: number }
  | { kind: "callback_failure"; shockBps: number; failedPath: "flash" | "solver" }
  | { kind: "reactive_balance_depletion"; shockBps: number }
  | { kind: "flash_unavailable"; shockBps: number }
  | { kind: "partial_rescue"; shockBps: number; remainingRepay: bigint }
  | { kind: "concurrent_repayment"; shockBps: number; userRepay: bigint }
  | { kind: "settlement_delay"; shockBps: number; delaySec: number; reserveUnderfunded?: boolean };

export interface PathReport {
  feasible: boolean;
  reason: string | null;
  repay: bigint;
  fee: bigint;
  collateralSold: bigint;
  /** Value lost to venue execution cost and slippage buffer, base units (flash only). */
  slippageCostBase: bigint;
  /** Capital that must be fronted: flash = 0 (self-funded), solver = repay. */
  capitalRequired: bigint;
  surplusToBorrower: bigint;
  resultingHf: bigint | null;
  remainingCollateral: bigint | null;
  remainingDebt: bigint | null;
}

export interface ScenarioResult {
  provenance: "SIMULATED";
  forecast: boolean;
  kind: ScenarioSpec["kind"];
  label: string;
  initial: AccountData;
  shocked: AccountData;
  /** Collateral price at which HF = 1 (base units), for the policy's collateral asset. */
  liquidationPrice: bigint | null;
  triggered: boolean;
  liquidatable: boolean;
  requiredRepay: bigint;
  flash: PathReport;
  solver: PathReport;
  /** Path the router would execute (deterministic order: flash, then solver). */
  outcome: "flash" | "solver" | "none" | "not_triggered";
  resultingHf: bigint;
  timeToProtectionSec: number | null;
  failureConditions: string[];
  recoveryOptions: string[];
  steps?: ScenarioResult[];
}

const ZERO_PATH: PathReport = {
  feasible: false,
  reason: "NOT_TRIGGERED",
  repay: 0n,
  fee: 0n,
  collateralSold: 0n,
  slippageCostBase: 0n,
  capitalRequired: 0n,
  surplusToBorrower: 0n,
  resultingHf: null,
  remainingCollateral: null,
  remainingDebt: null,
};

export function applyShock(s: AccountState, asset: Address, shockBps: number): AccountState {
  if (!Number.isInteger(shockBps) || shockBps < 0 || shockBps >= 10_000)
    throw new RangeError("shockBps must be an integer in [0, 10000)");
  return {
    ...s,
    reserves: s.reserves.map((r) =>
      r.asset.toLowerCase() === asset.toLowerCase()
        ? { ...r, price: (r.price * (BPS - BigInt(shockBps))) / BPS }
        : r,
    ),
  };
}

function report(o: RescueOutcome, s: AccountState, p: PolicyLimits): PathReport {
  const st = normalizeState(s);
  const coll = st.reserves.find((r) => r.asset.toLowerCase() === p.collateralAsset.toLowerCase())!;
  const debt = st.reserves.find((r) => r.asset.toLowerCase() === p.debtAsset.toLowerCase())!;
  let slip = 0n;
  if (o.feasible && o.path === "flash") {
    const soldBase = (o.collateralSold * coll.price) / 10n ** BigInt(coll.decimals);
    const receivedBase =
      ((o.repay + o.fee + o.surplusToBorrower) * debt.price) / 10n ** BigInt(debt.decimals);
    slip = soldBase > receivedBase ? soldBase - receivedBase : 0n;
  }
  const a = o.after ? normalizeState(o.after) : null;
  return {
    feasible: o.feasible,
    reason: o.reason,
    repay: o.repay,
    fee: o.fee,
    collateralSold: o.collateralSold,
    slippageCostBase: slip,
    capitalRequired: o.feasible && o.path === "solver" ? o.repay : 0n,
    surplusToBorrower: o.surplusToBorrower,
    resultingHf: o.afterData?.healthFactor ?? null,
    remainingCollateral: a ? (a.collateral[p.collateralAsset.toLowerCase() as Address] ?? 0n) : null,
    remainingDebt: a ? (a.debt[p.debtAsset.toLowerCase() as Address] ?? 0n) : null,
  };
}

interface EvalOpts {
  label: string;
  kind: ScenarioSpec["kind"];
  forecast: boolean;
  initial: AccountState;
  shocked: AccountState;
  base: ScenarioBase;
  policy?: PolicyLimits;
  flash?: FlashEnvironment;
  commitments?: readonly SolverCommitment[];
  blocked?: string | null;
  timeToProtectionSec?: number | null;
  failedPath?: "flash" | "solver";
  extraFailures?: string[];
  extraRecovery?: string[];
}

function evaluate(o: EvalOpts): ScenarioResult {
  const policy = o.policy ?? o.base.policy;
  const flash = o.flash ?? o.base.flash;
  const commitments = o.commitments ?? o.base.commitments;
  const initial = accountData(o.initial);
  const shocked = accountData(o.shocked);
  const triggered = shocked.healthFactor < policy.triggerHf;
  const failures = [...(o.extraFailures ?? [])];
  const recovery = [...(o.extraRecovery ?? [])];
  const liq = liquidationPrice(o.shocked, policy.collateralAsset);
  if (!triggered) {
    return {
      provenance: "SIMULATED",
      forecast: o.forecast,
      kind: o.kind,
      label: o.label,
      initial,
      shocked,
      liquidationPrice: liq,
      triggered,
      liquidatable: shocked.healthFactor < WAD,
      requiredRepay: 0n,
      flash: ZERO_PATH,
      solver: ZERO_PATH,
      outcome: "not_triggered",
      resultingHf: shocked.healthFactor,
      timeToProtectionSec: null,
      failureConditions: failures,
      recoveryOptions: recovery,
    };
  }
  const requiredRepay = estimateRepayment(o.shocked, policy.debtAsset, policy.targetHf);
  const d = decideRescue(o.shocked, policy, flash, commitments);
  const flashR = report(d.flash, o.shocked, policy);
  const solverR = report(d.solver, o.shocked, policy);
  let outcome: ScenarioResult["outcome"] = "none";
  let resulting = shocked.healthFactor;
  if (o.blocked) {
    failures.push(o.blocked);
  } else {
    // Router try/catch: a path that reverts at execution falls through to the next one in order.
    const order = d.order.filter((p) => p !== o.failedPath);
    if (o.failedPath && d.order.includes(o.failedPath))
      failures.push(`${o.failedPath.toUpperCase()}_REVERTED_AT_EXECUTION: router fell back to the next path`);
    const chosen = order[0];
    if (chosen) {
      outcome = chosen;
      resulting = (chosen === "flash" ? flashR.resultingHf : solverR.resultingHf) ?? resulting;
    } else {
      failures.push("NO_FEASIBLE_PATH");
      if (!d.flash.feasible) failures.push(`flash: ${d.flash.reason}`);
      if (!d.solver.feasible) failures.push(`solver: ${d.solver.reason}`);
    }
  }
  if (outcome === "none") {
    recovery.push(
      "Manual repay or collateral top-up from the dashboard (requestManualRescue re-runs both paths).",
    );
    if (d.flash.reason === "COLLATERAL_NOT_AUTHORIZED")
      recovery.push("Grant a bounded aToken approval (and pull cap) to the adapter to enable FlashNet.");
    if (d.flash.reason === "BUDGET_BELOW_REQUIRED" || d.solver.reason === "BUDGET_BELOW_REQUIRED")
      recovery.push("Raise maxRepayPerAction / maxTotalRepay, or enable allowPartial.");
    if (d.solver.reason === "NO_SOLVER_COMMITMENT" || d.solver.reason === "INSUFFICIENT_SOLVER_LIQUIDITY")
      recovery.push("Wait for solver commitments or enable partial rescue.");
  }
  if (resulting < WAD) failures.push("POSITION_REMAINS_LIQUIDATABLE");
  return {
    provenance: "SIMULATED",
    forecast: o.forecast,
    kind: o.kind,
    label: o.label,
    initial,
    shocked,
    liquidationPrice: liq,
    triggered,
    liquidatable: shocked.healthFactor < WAD,
    requiredRepay,
    flash: flashR,
    solver: solverR,
    outcome,
    resultingHf: resulting,
    timeToProtectionSec: outcome === "none" ? null : (o.timeToProtectionSec ?? null),
    failureConditions: failures,
    recoveryOptions: recovery,
  };
}

function stateAfter(r: ScenarioResult, s: AccountState, base: ScenarioBase): AccountState {
  if (r.outcome !== "flash" && r.outcome !== "solver") return s;
  const p = r.outcome === "flash" ? r.flash : r.solver;
  const n = normalizeState(s);
  return {
    ...n,
    collateral: { ...n.collateral, [base.policy.collateralAsset.toLowerCase()]: p.remainingCollateral! },
    debt: { ...n.debt, [base.policy.debtAsset.toLowerCase()]: p.remainingDebt! },
  };
}

export function runScenario(base: ScenarioBase, spec: ScenarioSpec): ScenarioResult {
  const t = { ...DEFAULT_TIMING, ...base.timing };
  const asset = ("asset" in spec && spec.asset) || base.policy.collateralAsset;
  const initial = base.state;
  const baseTtp = t.callbackDelaySec;
  const common = { kind: spec.kind, initial, base } as const;

  switch (spec.kind) {
    case "price_shock":
      return evaluate({
        ...common,
        label: `${spec.shockBps / 100}% collateral price shock`,
        forecast: false,
        shocked: applyShock(initial, asset, spec.shockBps),
        timeToProtectionSec: baseTtp,
      });

    case "multi_step_crash": {
      let s = initial;
      let policy = base.policy;
      const steps: ScenarioResult[] = [];
      for (const [i, b] of spec.stepsBps.entries()) {
        const shocked = applyShock(s, asset, b);
        const r = evaluate({
          ...common,
          initial: s,
          policy,
          label: `step ${i + 1}: -${b / 100}%`,
          forecast: true,
          shocked,
          timeToProtectionSec: baseTtp,
        });
        steps.push(r);
        s = stateAfter(r, shocked, base);
        const used = r.outcome === "flash" ? r.flash.repay : r.outcome === "solver" ? r.solver.repay : 0n;
        const usedFee = r.outcome === "flash" ? r.flash.fee : r.outcome === "solver" ? r.solver.fee : 0n;
        policy = {
          ...policy,
          remainingRepay: policy.remainingRepay > used ? policy.remainingRepay - used : 0n,
          remainingFees: policy.remainingFees > usedFee ? policy.remainingFees - usedFee : 0n,
        };
      }
      const last = steps[steps.length - 1]!;
      const final = accountData(s);
      return {
        ...last,
        kind: spec.kind,
        label: `multi-step crash (${spec.stepsBps.map((b) => `-${b / 100}%`).join(", ")})`,
        initial: accountData(initial),
        resultingHf: final.healthFactor,
        failureConditions: steps.flatMap((r, i) => r.failureConditions.map((f) => `step ${i + 1}: ${f}`)),
        recoveryOptions: [
          ...new Set([
            ...steps.flatMap((r) => r.recoveryOptions),
            "Each step consumes per-action and total budgets; size maxTotalRepay for consecutive rescues.",
          ]),
        ],
        steps,
      };
    }

    case "oracle_delay": {
      // The protocol and BASTION both read the oracle; while it lags, nothing triggers. When it updates, the market
      // may have drifted further than the original move.
      const shocked = applyShock(applyShock(initial, asset, spec.shockBps), asset, spec.driftDuringDelayBps);
      return evaluate({
        ...common,
        label: `oracle lags ${spec.delaySec}s; price drifts a further ${spec.driftDuringDelayBps / 100}% meanwhile`,
        forecast: true,
        shocked,
        timeToProtectionSec: spec.delaySec + baseTtp,
        extraFailures: [
          "Oracle latency is shared with the lending protocol: no signal exists until the oracle updates.",
        ],
      });
    }

    case "liquidity_deterioration":
      return evaluate({
        ...common,
        label: `venue execution cost rises to ${Number(spec.venueExecutionCostBps) / 100}%`,
        forecast: true,
        shocked: applyShock(initial, asset, spec.shockBps),
        flash: { ...base.flash, venueExecutionCostBps: spec.venueExecutionCostBps },
        timeToProtectionSec: baseTtp,
        extraRecovery: ["Raise maxSlippageBps (bounded by policy) or rely on the solver path."],
      });

    case "solver_liquidity_disappearance": {
      const f = spec.remainingFraction ?? 0;
      const scale = BigInt(Math.round(f * 10_000));
      const cs = base.commitments
        .map((c) => ({ ...c, amount: (c.amount * scale) / 10_000n }))
        .filter((c) => c.amount > 0n);
      return evaluate({
        ...common,
        label: f === 0 ? "all solver liquidity withdrawn" : `solver liquidity falls to ${f * 100}%`,
        forecast: true,
        shocked: applyShock(initial, asset, spec.shockBps),
        commitments: cs,
        timeToProtectionSec: baseTtp,
      });
    }

    case "callback_delay": {
      const stale = spec.delaySec > t.maxSignalAgeSec;
      return evaluate({
        ...common,
        label: `callback delivered after ${spec.delaySec}s`,
        forecast: true,
        shocked: applyShock(initial, asset, spec.shockBps),
        blocked: stale
          ? `STALE_SIGNAL: delivery after ${spec.delaySec}s exceeds maxSignalAge ${t.maxSignalAgeSec}s`
          : null,
        timeToProtectionSec: spec.delaySec,
        extraRecovery: stale
          ? [
              `The next observation (min interval ${t.observerMinIntervalSec}s) re-triggers with a fresh signal.`,
              "Manual rescue from the dashboard.",
            ]
          : [],
      });
    }

    case "callback_failure":
      return evaluate({
        ...common,
        label: `${spec.failedPath} path reverts during execution`,
        forecast: true,
        shocked: applyShock(initial, asset, spec.shockBps),
        failedPath: spec.failedPath,
        timeToProtectionSec: baseTtp,
      });

    case "reactive_balance_depletion": {
      const f = base.funding;
      const dest = f ? f.destinationCallbackBalanceWei < f.minDestinationWei : true;
      const core = f ? f.reactiveCoreBalanceWei < f.minReactiveWei : true;
      const reasons = [
        ...(core ? ["REACTIVE_CORE_UNDERFUNDED: the core cannot pay for react()/callbacks"] : []),
        ...(dest ? ["DESTINATION_CALLBACK_UNDERFUNDED: callback contract cannot pay delivery debt"] : []),
      ];
      return evaluate({
        ...common,
        label: "Reactive / callback balance depleted",
        forecast: true,
        shocked: applyShock(initial, asset, spec.shockBps),
        blocked: reasons.length ? reasons.join("; ") : null,
        timeToProtectionSec: baseTtp,
        extraRecovery: reasons.length
          ? ["Top up the core (depositTo) and the callback contract (coverDebt).", "Manual rescue meanwhile."]
          : [],
      });
    }

    case "flash_unavailable":
      return evaluate({
        ...common,
        label: "flash liquidity unavailable",
        forecast: true,
        shocked: applyShock(initial, asset, spec.shockBps),
        flash: { ...base.flash, flashLoanAvailable: false },
        timeToProtectionSec: baseTtp,
      });

    case "partial_rescue":
      return evaluate({
        ...common,
        label: `partial rescue capped at ${spec.remainingRepay}`,
        forecast: false,
        shocked: applyShock(initial, asset, spec.shockBps),
        policy: { ...base.policy, remainingRepay: spec.remainingRepay, allowPartial: true },
        timeToProtectionSec: baseTtp,
        extraRecovery: [
          "Partial rescues improve HF without reaching target; later observations can rescue again.",
        ],
      });

    case "concurrent_repayment": {
      const shocked = normalizeState(applyShock(initial, asset, spec.shockBps));
      const dk = base.policy.debtAsset.toLowerCase() as Address;
      const d = shocked.debt[dk] ?? 0n;
      const afterUser = {
        ...shocked,
        debt: { ...shocked.debt, [dk]: d > spec.userRepay ? d - spec.userRepay : 0n },
      };
      // Signal was raised on `shocked`, but executors recompute from live state at execution time.
      const r = evaluate({
        ...common,
        label: `user repays ${spec.userRepay} before the callback lands`,
        forecast: true,
        shocked: afterUser,
        timeToProtectionSec: baseTtp,
      });
      if (r.outcome === "not_triggered")
        r.recoveryOptions.push(
          "Executors re-read live state: no rescue is executed when the user already restored HF.",
        );
      return r;
    }

    case "settlement_delay": {
      const r = evaluate({
        ...common,
        label: `settlement acknowledged after ${spec.delaySec}s${spec.reserveUnderfunded ? " (reserve underfunded)" : ""}`,
        forecast: true,
        shocked: applyShock(initial, asset, spec.shockBps),
        timeToProtectionSec: baseTtp,
      });
      if (r.outcome === "solver") {
        const budget = base.reserveBudget;
        const short =
          spec.reserveUnderfunded ||
          (budget ? budget.principal < r.solver.repay || budget.fee < r.solver.fee : false);
        r.failureConditions.push(
          `Solver capital ${r.solver.repay} outstanding for ~${spec.delaySec + t.settlementDelaySec}s (position is already protected).`,
        );
        if (short) {
          r.failureConditions.push(
            "SETTLEMENT_FAILED → RecoveryRequired: reserve budget cannot cover principal + fee.",
          );
          r.recoveryOptions.push(
            "Fund the budget, then anyone may call retrySettlement(rescueId); the rescue is never re-executed.",
          );
        }
      }
      return r;
    }
  }
}

export interface StrategyComparison {
  provenance: "SIMULATED";
  shockBps: number;
  unprotected: { hf: bigint; liquidatable: boolean };
  flash: PathReport;
  solver: PathReport;
  partial: PathReport;
  manual: { repayNeeded: bigint; hf: bigint };
}

/** Section 10 strategy comparison at one shock level. */
export function compareStrategies(
  base: ScenarioBase,
  shockBps: number,
  partialCap?: bigint,
): StrategyComparison {
  const shocked = applyShock(base.state, base.policy.collateralAsset, shockBps);
  const sd = accountData(shocked);
  const onlyFlash = decideRescue(
    shocked,
    { ...base.policy, allowSolver: false },
    base.flash,
    base.commitments,
  );
  const onlySolver = decideRescue(
    shocked,
    { ...base.policy, allowFlash: false },
    base.flash,
    base.commitments,
  );
  const cap = partialCap ?? base.policy.remainingRepay / 2n;
  const part = decideRescue(
    shocked,
    { ...base.policy, allowPartial: true, remainingRepay: cap },
    base.flash,
    base.commitments,
  );
  const partChosen = part.chosen ?? part.solver;
  // Manual: the user repays the exact amount themselves (no fees).
  const need = estimateRepayment(shocked, base.policy.debtAsset, base.policy.targetHf);
  const n = normalizeState(shocked);
  const dk = base.policy.debtAsset.toLowerCase() as Address;
  const manualHf = accountData({ ...n, debt: { ...n.debt, [dk]: (n.debt[dk] ?? 0n) - need } }).healthFactor;
  return {
    provenance: "SIMULATED",
    shockBps,
    unprotected: { hf: sd.healthFactor, liquidatable: sd.healthFactor < WAD },
    flash: report(onlyFlash.flash, shocked, base.policy),
    solver: report(onlySolver.solver, shocked, base.policy),
    partial: report(partChosen, shocked, base.policy),
    manual: { repayNeeded: need, hf: manualHf },
  };
}

export const SECTION_10_SHOCKS_BPS = [500, 1000, 2000, 4000] as const;
