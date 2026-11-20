import type { ReadinessStatus } from "@bastion-guardian/types";

/**
 * Guardian Mode readiness (Section 9). Readiness indicates operational preparedness; it is NOT a guarantee that a
 * rescue will succeed. Any unknown/unobserved input degrades the status — never upgrades it.
 */
export interface ReadinessInput {
  now: number; // unix seconds
  policy: { active: boolean; expiresAt: number; paused: boolean } | null;
  reactive: {
    coreActive: boolean | null;
    subscriptionsActive: boolean | null;
    callbackDebt: bigint | null; // outstanding debt on destination callback contract
    lastHeartbeatAt: number | null;
  };
  protection: {
    /** Required external repayment for the configured target (token units), null if unknown. */
    requiredRepay: bigint | null;
    remainingPolicyBudget: bigint | null;
    vaultBudget: bigint | null;
    solverCoverage: bigint | null;
    flashFeasible: boolean | null;
  };
  oracle: { status: "OK" | "STALE" | "CONTRADICTORY" | "UNAVAILABLE" | null };
  emergencyPaused: boolean | null;
  heartbeatMaxAgeSec?: number;
  expiryWarningSec?: number;
}

export interface ReadinessReport {
  status: ReadinessStatus;
  reasons: string[];
  checks: Record<string, "pass" | "warn" | "fail" | "unknown">;
}

export function evaluateReadiness(i: ReadinessInput): ReadinessReport {
  const reasons: string[] = [];
  const checks: ReadinessReport["checks"] = {};
  const hbMax = i.heartbeatMaxAgeSec ?? 300;
  const expWarn = i.expiryWarningSec ?? 86_400;
  let fail = false;
  let warn = false;
  let unknown = false;
  const set = (k: string, v: "pass" | "warn" | "fail" | "unknown", reason?: string) => {
    checks[k] = v;
    if (v === "fail") fail = true;
    if (v === "warn") warn = true;
    if (v === "unknown") unknown = true;
    if (reason) reasons.push(reason);
  };

  if (i.emergencyPaused === null) set("emergency", "unknown", "Emergency control state not observed");
  else if (i.emergencyPaused) set("emergency", "fail", "Protocol emergency pause is active");
  else set("emergency", "pass");

  if (!i.policy) set("policy", "fail", "No active protection policy");
  else if (i.policy.paused || !i.policy.active) set("policy", "fail", "Policy is paused or revoked");
  else if (i.policy.expiresAt <= i.now) set("policy", "fail", "Policy has expired");
  else if (i.policy.expiresAt - i.now < expWarn) set("policy", "warn", "Policy expires within 24h");
  else set("policy", "pass");

  const r = i.reactive;
  if (r.coreActive === null || r.subscriptionsActive === null)
    set("reactive", "unknown", "Reactive core state not observed");
  else if (!r.coreActive || !r.subscriptionsActive)
    set("reactive", "fail", "Reactive core paused or subscriptions inactive");
  else set("reactive", "pass");

  if (r.callbackDebt === null) set("callbackDebt", "unknown", "Callback contract debt not observed");
  else if (r.callbackDebt > 0n)
    set("callbackDebt", "fail", "Callback contract has unpaid debt — callbacks will not be delivered");
  else set("callbackDebt", "pass");

  if (r.lastHeartbeatAt === null) set("heartbeat", "unknown", "No Guardian heartbeat observed");
  else if (i.now - r.lastHeartbeatAt > hbMax) set("heartbeat", "warn", "Guardian heartbeat is stale");
  else set("heartbeat", "pass");

  if (i.oracle.status === null) set("oracle", "unknown", "Oracle status not observed");
  else if (i.oracle.status === "OK") set("oracle", "pass");
  else if (i.oracle.status === "STALE") set("oracle", "warn", "Oracle price is stale");
  else set("oracle", "fail", `Oracle ${i.oracle.status.toLowerCase()}`);

  const p = i.protection;
  if (p.requiredRepay === null) set("capacity", "unknown", "Required rescue amount unknown");
  else {
    const budget = p.remainingPolicyBudget;
    const solverOk =
      p.solverCoverage !== null &&
      budget !== null &&
      p.solverCoverage >= p.requiredRepay &&
      budget >= p.requiredRepay;
    const flashOk = p.flashFeasible === true;
    const vaultOk = p.vaultBudget !== null && p.vaultBudget >= p.requiredRepay;
    if (solverOk || flashOk)
      set(
        "capacity",
        vaultOk || flashOk ? "pass" : "warn",
        vaultOk || flashOk ? undefined : "Solver capacity present but vault reimbursement budget is short",
      );
    // Unused policy budget is a limit, not capacity: partial capacity needs actual committed solver liquidity.
    else if ((p.solverCoverage ?? 0n) > 0n && (budget ?? 0n) > 0n)
      set("capacity", "warn", "Only partial rescue capacity available");
    else if (p.solverCoverage === null && p.flashFeasible === null)
      set("capacity", "unknown", "Rescue capacity not observed");
    else set("capacity", "fail", "No rescue path can currently cover the required amount");
  }

  const status: ReadinessStatus = fail ? "UNAVAILABLE" : unknown ? "UNKNOWN" : warn ? "LIMITED" : "ARMED";
  return { status, reasons, checks };
}
