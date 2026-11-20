/**
 * Domain projections. Two kinds:
 *  - event rows (risk_observations, rescue_executions, solver_fills, settlement_events): one row per canonical log,
 *    unique on (chain, block_hash, log_index) → re-ingesting is a no-op; reorged rows are deleted by block number.
 *  - derived state (rescue_intents, settlement_claims, protection_policies/policy_versions, commitments, solvers,
 *    source_escrows): always RECOMPUTED from the canonical (non-removed) logs or from current chain state for the
 *    touched keys, so the result is identical no matter how often or in what order blocks are (re)ingested.
 */
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { Address, Hex, PublicClient } from "viem";
import {
  chainLogs,
  policyVersions,
  protectionPolicies,
  rescueExecutions,
  rescueIntents,
  riskObservations,
  settlementClaims,
  settlementEvents,
  solverFills,
  solverLiquidityCommitments,
  solverRegistrations,
  sourceEscrows,
  type Database,
} from "@bastion-guardian/db";
import {
  bastionPolicyRegistryAbi,
  bastionProtectionVaultAbi,
  rescueSettlementLedgerAbi,
} from "@bastion-guardian/contracts";
import type { DecodedLog, IndexedContract } from "./contracts.js";

export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const RESCUE_STATES = [
  "None",
  "Requested",
  "Authorized",
  "SolverCommitted",
  "DestinationExecuted",
  "ExecutionFailed",
  "SettlementPending",
  "ReimbursementComplete",
  "ReimbursementDisputed",
  "RecoveryRequired",
  "Expired",
  "Cancelled",
] as const;

export const SETTLEMENT_KINDS: Record<string, string> = {
  SolverRescueExecuted: "solver_executed",
  ReimbursementCompleted: "reimbursed",
  SettlementFailed: "failed",
  DuplicateSettlementIgnored: "duplicate_ignored",
  UntrustedSourceRejected: "untrusted_rejected",
  ClaimDisputed: "disputed",
  SettlementAcknowledged: "acknowledged",
};

export interface Touched {
  rescueIds: Set<string>;
  policyIds: Set<string>;
  commitmentIds: Set<string>;
  solvers: Set<string>;
  budgets: Set<string>; // policyId (owners resolved from BudgetAllocated logs)
}
export const emptyTouched = (): Touched => ({
  rescueIds: new Set(),
  policyIds: new Set(),
  commitmentIds: new Set(),
  solvers: new Set(),
  budgets: new Set(),
});

const s = (v: unknown) => String(v).toLowerCase();

/** Which derived keys a log affects (used both for new logs and for reorged/removed ones). */
export function touch(t: Touched, eventName: string, args: Record<string, unknown>) {
  if (args.rescueId) t.rescueIds.add(s(args.rescueId));
  if (eventName === "RescueStateChanged" || eventName === "SolverClaimRecorded")
    t.rescueIds.add(s(args.rescueId));
  if (["PolicyRegistered", "PolicyPaused", "PolicyResumed", "PolicyRevoked"].includes(eventName))
    t.policyIds.add(s(args.policyId));
  if (["CommitmentCreated", "CommitmentDrawn", "CommitmentReleased", "UnusedReturned"].includes(eventName))
    t.commitmentIds.add(s(args.commitmentId));
  if (
    [
      "SolverRegistered",
      "BondAdded",
      "FillRecorded",
      "FailureRecorded",
      "SolverSuspended",
      "ExitRequested",
      "ExitCompleted",
      "PayoutUpdated",
    ].includes(eventName)
  )
    t.solvers.add(s(args.solver));
  if (
    [
      "BudgetAllocated",
      "BudgetReleased",
      "BudgetPaused",
      "BudgetResumed",
      "ReleaseRequested",
      "Reimbursed",
    ].includes(eventName)
  )
    t.budgets.add(s(args.policyId));
}

export interface ProjectionContext {
  chainId: number;
  client: PublicClient;
  contracts: IndexedContract[];
  /** Chain id of the reserve escrow that settles this chain's solver rescues. */
  reserveChainId: number;
  blockTime: Map<bigint, Date>;
}

const addr = (ctx: ProjectionContext, name: IndexedContract["name"]) =>
  ctx.contracts.find((c) => c.name === name)?.address;

// ---------------------------------------------------------------------------------------------------------------
// event rows

export async function insertEventRows(tx: Tx, ctx: ProjectionContext, logs: DecodedLog[]) {
  const byTx = new Map<string, DecodedLog[]>();
  for (const l of logs) byTx.set(l.txHash, [...(byTx.get(l.txHash) ?? []), l]);
  const base = (l: DecodedLog) => ({
    chainId: ctx.chainId,
    blockNumber: l.blockNumber,
    blockHash: l.blockHash,
    txHash: l.txHash,
    logIndex: l.logIndex,
  });
  for (const l of logs) {
    const a = l.args;
    if (l.eventName === "RiskObserved") {
      await tx
        .insert(riskObservations)
        .values({
          ...base(l),
          policyId: s(a.policyId),
          policyVersion: Number(a.version),
          account: s(a.account),
          healthFactorWad: String(a.healthFactor),
          triggerHealthFactorWad: String(a.triggerHealthFactor),
          observedAt: new Date(Number(a.observedAt) * 1000),
        })
        .onConflictDoNothing();
    } else if (l.eventName === "RescueAttempted") {
      const rid = s(a.rescueId);
      const exists = await tx
        .select({ id: rescueIntents.rescueId })
        .from(rescueIntents)
        .where(eq(rescueIntents.rescueId, rid));
      if (!exists.length) continue; // intent recomputation runs first; absent only if the ledger never opened it
      const same = (byTx.get(l.txHash) ?? []).filter((x) => s(x.args.rescueId) === rid);
      const receipt = same.find((x) => x.eventName === "ReceiptRecorded")?.args;
      const flash = same.find((x) => x.eventName === "FlashRescueExecuted")?.args;
      const solver = same.find((x) => x.eventName === "SolverRescueExecuted")?.args;
      const reason = String(a.reason);
      await tx
        .insert(rescueExecutions)
        .values({
          ...base(l),
          rescueId: rid,
          path: Number(a.path),
          success: Boolean(a.success),
          reason: /^0x0+$/.test(reason) ? null : bytes32ToText(reason as Hex),
          repaid: receipt ? String(receipt.repaid) : null,
          fee: receipt ? String(receipt.fee) : flash ? String(flash.premium) : null,
          healthFactorBeforeWad: receipt ? String(receipt.healthFactorBefore) : null,
          healthFactorAfterWad: receipt ? String(receipt.healthFactorAfter) : null,
          solver: solver ? s(solver.solver) : null,
          blockTimestamp: ctx.blockTime.get(l.blockNumber) ?? null,
        })
        .onConflictDoNothing();
    }
    if (l.eventName === "SolverRescueExecuted") {
      await tx
        .insert(solverFills)
        .values({
          ...base(l),
          rescueId: s(a.rescueId),
          solver: s(a.solver),
          payout: s(a.payout),
          policyOwner: s(a.policyOwner),
          principal: String(a.principal),
          fee: String(a.fee),
        })
        .onConflictDoNothing();
    }
    const kind = SETTLEMENT_KINDS[l.eventName];
    if (kind && a.rescueId) {
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(a))
        data[k] = typeof v === "bigint" ? v.toString() : typeof v === "string" ? v.toLowerCase() : v;
      await tx
        .insert(settlementEvents)
        .values({ ...base(l), rescueId: s(a.rescueId), kind, data })
        .onConflictDoNothing();
    }
  }
}

export function bytes32ToText(h: Hex): string {
  const b = Buffer.from(h.slice(2), "hex");
  const end = b.indexOf(0);
  const txt = b.subarray(0, end === -1 ? b.length : end).toString("utf8");
  return /^[\x20-\x7e]+$/.test(txt) ? txt : h;
}

// ---------------------------------------------------------------------------------------------------------------
// derived state

async function canonicalLogs(tx: Tx, chainId: number | null, events: string[], key: string, value: string) {
  return tx
    .select()
    .from(chainLogs)
    .where(
      and(
        chainId === null ? sql`true` : eq(chainLogs.chainId, chainId),
        inArray(chainLogs.eventName, events),
        eq(chainLogs.removed, false),
        sql`${chainLogs.args}->>${key} = ${value}`,
      ),
    )
    .orderBy(asc(chainLogs.blockNumber), asc(chainLogs.logIndex));
}

export async function recompute(tx: Tx, ctx: ProjectionContext, t: Touched) {
  for (const rid of t.rescueIds) await recomputeRescue(tx, ctx, rid);
  for (const rid of t.rescueIds) await recomputeClaim(tx, ctx, rid);
  for (const pid of t.policyIds) await recomputePolicy(tx, ctx, pid);
  for (const cid of t.commitmentIds) await recomputeCommitment(tx, ctx, cid);
  for (const sv of t.solvers) await recomputeSolver(tx, ctx, sv);
  for (const pid of t.budgets) await refreshBudgets(tx, ctx, pid);
}

async function recomputeRescue(tx: Tx, ctx: ProjectionContext, rid: string) {
  const logs = await canonicalLogs(tx, ctx.chainId, ["RescueStateChanged"], "rescueId", rid);
  if (!logs.length) {
    // No canonical ledger history left (reorged out): remove the intent if nothing references it.
    const refs = await tx
      .select({ id: rescueExecutions.id })
      .from(rescueExecutions)
      .where(eq(rescueExecutions.rescueId, rid));
    if (!refs.length)
      await tx
        .delete(rescueIntents)
        .where(and(eq(rescueIntents.rescueId, rid), eq(rescueIntents.chainId, ctx.chainId)));
    return;
  }
  const last = logs[logs.length - 1]!;
  const state = RESCUE_STATES[Number((last.args as { to: unknown }).to)] ?? "None";
  const ledger = addr(ctx, "ledger");
  if (!ledger) return;
  const rec = await ctx.client.readContract({
    address: ledger,
    abi: rescueSettlementLedgerAbi,
    functionName: "getRecord",
    args: [rid as Hex], // immutable fields only: read at latest (works on non-archive nodes)
  });
  await tx
    .insert(rescueIntents)
    .values({
      rescueId: rid,
      chainId: ctx.chainId,
      policyId: s(rec.policyId),
      policyVersion: Number(rec.policyVersion),
      originEventId: s(rec.originEventId),
      state,
      createdAt: ctx.blockTime.get(logs[0]!.blockNumber) ?? new Date(),
    })
    .onConflictDoUpdate({ target: rescueIntents.rescueId, set: { state, updatedAt: new Date() } });
}

async function recomputeClaim(tx: Tx, ctx: ProjectionContext, rid: string) {
  const evs = await tx
    .select()
    .from(settlementEvents)
    .where(eq(settlementEvents.rescueId, rid))
    .orderBy(asc(settlementEvents.blockNumber), asc(settlementEvents.logIndex));
  const exec = evs.find((e) => e.kind === "solver_executed");
  if (!exec) {
    await tx.delete(settlementClaims).where(eq(settlementClaims.rescueId, rid));
    return;
  }
  const d = exec.data as Record<string, string>;
  let state: "Pending" | "Reimbursed" | "RecoveryRequired" | "Disputed" = "Pending";
  let attempts = 0;
  let lastError: string | null = null;
  for (const e of evs) {
    const x = e.data as Record<string, string>;
    if (e.kind === "reimbursed") {
      state = "Reimbursed";
      attempts++;
      lastError = null;
    } else if (e.kind === "failed") {
      state = "RecoveryRequired";
      attempts++;
      lastError = bytes32ToText(x.reason as Hex);
    } else if (e.kind === "disputed") state = "Disputed";
  }
  const row = {
    rescueId: rid,
    reserveChainId: ctx.reserveChainId,
    destChainId: exec.chainId,
    policyId: d.policyId!,
    policyOwner: d.policyOwner!,
    recipient: d.payout!,
    principal: d.principal!,
    fee: d.fee!,
    state,
    attempts,
    lastError,
    destExecutedAt: new Date(Number(d.executedAt) * 1000),
    updatedAt: new Date(),
  };
  await tx
    .insert(settlementClaims)
    .values(row)
    .onConflictDoUpdate({
      target: settlementClaims.rescueId,
      set: { state, attempts, lastError, updatedAt: row.updatedAt },
    });
}

const POLICY_EVENTS = ["PolicyRegistered", "PolicyPaused", "PolicyResumed", "PolicyRevoked"];

async function recomputePolicy(tx: Tx, ctx: ProjectionContext, pid: string) {
  const logs = await canonicalLogs(tx, ctx.chainId, POLICY_EVENTS, "policyId", pid);
  const regs = logs.filter((l) => l.eventName === "PolicyRegistered");
  const keepVersions = regs.map((l) => Number((l.args as { version: string }).version));
  await tx
    .delete(policyVersions)
    .where(
      and(
        eq(policyVersions.chainId, ctx.chainId),
        eq(policyVersions.policyId, pid),
        keepVersions.length ? notInArray(policyVersions.version, keepVersions) : sql`true`,
      ),
    );
  if (!regs.length) {
    await tx
      .delete(protectionPolicies)
      .where(and(eq(protectionPolicies.chainId, ctx.chainId), eq(protectionPolicies.policyId, pid)));
    return;
  }
  const registry = addr(ctx, "policyRegistry")!;
  const lastReg = regs[regs.length - 1]!;
  const version = Number((lastReg.args as { version: string }).version);
  const [p] = await ctx.client.readContract({
    address: registry,
    abi: bastionPolicyRegistryAbi,
    functionName: "getPolicy",
    args: [pid as Hex], // the latest registered version's terms; versions are immutable once registered
  });
  let status: "Active" | "Paused" | "Revoked" = "Active";
  for (const l of logs.filter(
    (x) =>
      x.blockNumber > lastReg.blockNumber ||
      (x.blockNumber === lastReg.blockNumber && x.logIndex > lastReg.logIndex),
  )) {
    if (l.eventName === "PolicyPaused") status = "Paused";
    else if (l.eventName === "PolicyResumed") status = "Active";
    else if (l.eventName === "PolicyRevoked") status = "Revoked";
  }
  const registeredAt = ctx.blockTime.get(regs[0]!.blockNumber) ?? new Date();
  await tx
    .insert(protectionPolicies)
    .values({
      chainId: ctx.chainId,
      policyId: pid,
      owner: s(p.owner),
      account: s(p.account),
      adapter: s(p.adapter),
      market: s(p.market),
      debtAsset: s(p.debtAsset),
      collateralAsset: s(p.collateralAsset),
      status,
      currentVersion: version,
      registeredAt,
    })
    .onConflictDoUpdate({
      target: [protectionPolicies.chainId, protectionPolicies.policyId],
      set: { status, currentVersion: version, updatedAt: new Date() },
    });
  await tx
    .insert(policyVersions)
    .values({
      chainId: ctx.chainId,
      policyId: pid,
      version,
      sourceChainId: Number(p.sourceChainId),
      destChainId: Number(p.destChainId),
      triggerHealthFactorWad: p.triggerHealthFactor.toString(),
      targetHealthFactorWad: p.targetHealthFactor.toString(),
      maxTotalRepay: p.maxTotalRepay.toString(),
      maxRepayPerAction: p.maxRepayPerAction.toString(),
      maxTotalFees: p.maxTotalFees.toString(),
      maxSlippageBps: Number(p.maxSlippageBps),
      maxFeeBps: Number(p.maxFeeBps),
      allowedPaths: Number(p.allowedPaths),
      allowPartial: p.allowPartial,
      expiry: new Date(Number(p.expiry) * 1000),
      cooldownSeconds: Number(p.cooldown),
      nonce: p.nonce.toString(),
      solversHash: s(p.solversHash),
      recipientsHash: s(p.recipientsHash),
      registeredTxHash: lastReg.txHash,
      registeredBlock: lastReg.blockNumber,
    })
    .onConflictDoNothing();
}

async function recomputeCommitment(tx: Tx, ctx: ProjectionContext, cid: string) {
  const logs = await canonicalLogs(
    tx,
    ctx.chainId,
    ["CommitmentCreated", "CommitmentDrawn", "CommitmentReleased"],
    "commitmentId",
    cid,
  );
  const created = logs.find((l) => l.eventName === "CommitmentCreated");
  if (!created) {
    await tx
      .delete(solverLiquidityCommitments)
      .where(
        and(
          eq(solverLiquidityCommitments.chainId, ctx.chainId),
          eq(solverLiquidityCommitments.commitmentId, cid),
        ),
      );
    return;
  }
  const c = created.args as Record<string, string>;
  const amount = BigInt(c.amount!);
  let drawn = 0n;
  let released = false;
  for (const l of logs) {
    const a = l.args as Record<string, string>;
    if (l.eventName === "CommitmentDrawn") drawn += BigInt(a.amount!);
    if (l.eventName === "CommitmentReleased") released = true;
  }
  const remaining = released ? 0n : amount - drawn;
  const state = released ? "released" : remaining === 0n ? "drawn" : "active";
  const row = {
    chainId: ctx.chainId,
    commitmentId: cid,
    solver: s(c.solver),
    policyId: s(c.policyId),
    token: s(c.token),
    amount: amount.toString(),
    remaining: remaining.toString(),
    feeBps: Number(c.feeBps),
    expiry: new Date(Number(c.expiry) * 1000),
    state,
    createdBlock: created.blockNumber,
  };
  await tx
    .insert(solverLiquidityCommitments)
    .values(row)
    .onConflictDoUpdate({
      target: [solverLiquidityCommitments.chainId, solverLiquidityCommitments.commitmentId],
      set: { remaining: row.remaining, state, updatedAt: new Date() },
    });
}

const SOLVER_EVENTS = [
  "SolverRegistered",
  "BondAdded",
  "FillRecorded",
  "FailureRecorded",
  "SolverSuspended",
  "ExitRequested",
  "ExitCompleted",
  "PayoutUpdated",
];

async function recomputeSolver(tx: Tx, ctx: ProjectionContext, solver: string) {
  const logs = await canonicalLogs(tx, ctx.chainId, SOLVER_EVENTS, "solver", solver);
  const reg = logs.find((l) => l.eventName === "SolverRegistered");
  if (!reg) {
    await tx
      .delete(solverRegistrations)
      .where(and(eq(solverRegistrations.chainId, ctx.chainId), eq(solverRegistrations.solver, solver)));
    return;
  }
  const r = reg.args as Record<string, string>;
  let payout = s(r.payout);
  let bond = BigInt(r.bond!);
  let fills = 0;
  let failures = 0;
  let volume = 0n;
  let status: "active" | "suspended" | "exiting" | "exited" = "active";
  for (const l of logs) {
    const a = l.args as Record<string, string | boolean>;
    switch (l.eventName) {
      case "BondAdded":
        bond = BigInt(a.total as string);
        break;
      case "FillRecorded":
        fills++;
        volume += BigInt(a.amount as string);
        break;
      case "FailureRecorded":
        failures++;
        break;
      case "SolverSuspended":
        if (status !== "exiting" && status !== "exited") status = a.suspended ? "suspended" : "active";
        break;
      case "ExitRequested":
        status = "exiting";
        break;
      case "ExitCompleted":
        status = "exited";
        bond = 0n;
        break;
      case "PayoutUpdated":
        payout = s(a.payout);
        break;
    }
  }
  const row = {
    chainId: ctx.chainId,
    solver,
    payout,
    bond: bond.toString(),
    metadataUri: r.metadataURI ?? null,
    status,
    totalFilled: volume.toString(),
    fills,
    failures,
    registeredBlock: reg.blockNumber,
  };
  await tx
    .insert(solverRegistrations)
    .values(row)
    .onConflictDoUpdate({
      target: [solverRegistrations.chainId, solverRegistrations.solver],
      set: { ...row, updatedAt: new Date() },
    });
}

async function refreshBudgets(tx: Tx, ctx: ProjectionContext, pid: string) {
  const vault = addr(ctx, "protectionVault");
  if (!vault) return;
  const allocs = await canonicalLogs(tx, ctx.chainId, ["BudgetAllocated"], "policyId", pid);
  const owners = new Set(allocs.map((l) => s((l.args as { owner: string }).owner)));
  const existing = await tx
    .select({ owner: sourceEscrows.owner })
    .from(sourceEscrows)
    .where(and(eq(sourceEscrows.chainId, ctx.chainId), eq(sourceEscrows.policyId, pid)));
  for (const e of existing)
    if (!owners.has(e.owner))
      await tx
        .delete(sourceEscrows)
        .where(
          and(
            eq(sourceEscrows.chainId, ctx.chainId),
            eq(sourceEscrows.policyId, pid),
            eq(sourceEscrows.owner, e.owner),
          ),
        );
  const head = await ctx.client.getBlockNumber();
  for (const owner of owners) {
    const b = await ctx.client.readContract({
      address: vault,
      abi: bastionProtectionVaultAbi,
      functionName: "getBudget",
      args: [owner as Address, pid as Hex],
      blockNumber: head,
    });
    const row = {
      chainId: ctx.chainId,
      vault: vault.toLowerCase(),
      owner,
      policyId: pid,
      token: s(b.token),
      repayReserve: b.repayReserve.toString(),
      feeReserve: b.feeReserve.toString(),
      maxFeeBps: Number(b.maxFeeBps),
      totalReimbursed: b.totalReimbursed.toString(),
      pausedAt: b.pausedAt > 0n ? new Date(Number(b.pausedAt) * 1000) : null,
      releaseRequestedAt: b.releaseRequestedAt > 0n ? new Date(Number(b.releaseRequestedAt) * 1000) : null,
      updatedBlock: head,
    };
    await tx
      .insert(sourceEscrows)
      .values(row)
      .onConflictDoUpdate({
        target: [sourceEscrows.chainId, sourceEscrows.vault, sourceEscrows.owner, sourceEscrows.policyId],
        set: { ...row, updatedAt: new Date() },
      });
  }
}
