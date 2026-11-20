import { and, eq, sql } from "drizzle-orm";
import type { Account, Address, Hex, PublicClient, WalletClient } from "viem";
import { bastionProtectionVaultAbi, crossChainReserveEscrowAbi } from "@bastion-guardian/contracts";
import {
  incidentRecords,
  rescueIntents,
  settlementClaims,
  settlementEvents,
  solverFills,
  type Database,
} from "@bastion-guardian/db";
import { assertWriteAllowed, createLogger, type Logger } from "@bastion-guardian/service-kit";

export interface ReconcilerConfig {
  reserveChainId: number;
  reserveRpcUrl: string;
  reserveEscrow: Address;
  protectionVault: Address;
  /** A fill with no reserve-side outcome after this long is overdue. */
  overdueAfterSec: number;
  /** A reimbursed claim whose destination ledger is not acknowledged after this long is flagged. */
  ackTimeoutSec: number;
  /** When set, calls the permissionless escrow.retrySettlement once the budget can cover the claim. */
  retrier?: Account;
}

export interface Finding {
  rescueId: string;
  kind:
    "overdue" | "amount_mismatch" | "recovery_required" | "retried" | "ack_missing" | "onchain_drift" | "ok";
  detail: string;
  tx?: Hex;
}

/** CrossChainReserveEscrow.SettlementState (ABI order). `None` = no claim on the reserve chain yet. */
const ESCROW_STATES = ["None", "Reimbursed", "RecoveryRequired", "Disputed"] as const;

/**
 * Never moves funds itself: the only write is the permissionless retrySettlement(), which re-attempts the same
 * verified claim and can never re-execute a rescue or change amounts.
 */
export class SettlementReconciler {
  private readonly log: Logger;
  constructor(
    private readonly db: Database,
    private readonly reserve: PublicClient,
    private readonly wallet: WalletClient | null,
    private readonly cfg: ReconcilerConfig,
    logger?: Logger,
  ) {
    if (cfg.retrier) assertWriteAllowed(cfg.reserveChainId, cfg.reserveRpcUrl);
    this.log = logger ?? createLogger("settlement-reconciler");
  }

  async tick(now = new Date()): Promise<Finding[]> {
    const out: Finding[] = [];
    const fills = await this.db.select().from(solverFills);
    for (const f of fills) {
      const [claim] = await this.db
        .select()
        .from(settlementClaims)
        .where(eq(settlementClaims.rescueId, f.rescueId));
      const evs = await this.db
        .select()
        .from(settlementEvents)
        .where(eq(settlementEvents.rescueId, f.rescueId));
      const reimbursed = evs.find((e) => e.kind === "reimbursed");
      const onchain = await this.reserve.readContract({
        address: this.cfg.reserveEscrow,
        abi: crossChainReserveEscrowAbi,
        functionName: "getClaim",
        args: [f.rescueId as Hex],
      });
      const chainState = ESCROW_STATES[onchain.state] ?? "None";

      // 1) Amounts paid on the reserve chain must equal what the destination executor reported.
      if (reimbursed) {
        const d = reimbursed.data as Record<string, string>;
        if (d.principal !== f.principal || d.fee !== f.fee || d.recipient !== f.payout) {
          out.push(
            await this.incident(
              f.rescueId,
              "amount_mismatch",
              "critical",
              `reimbursed ${d.principal}+${d.fee} to ${d.recipient} but fill was ${f.principal}+${f.fee} to ${f.payout}`,
              "Freeze settlement scope and investigate: reserve payout differs from the destination fill.",
            ),
          );
          continue;
        }
      }

      // 2) DB vs chain drift (indexer behind or reorg in flight).
      if (claim && chainState !== "None" && claim.state !== chainState) {
        out.push({
          rescueId: f.rescueId,
          kind: "onchain_drift",
          detail: `db=${claim.state} chain=${chainState} (indexer catching up)`,
        });
      }

      // 3) No reserve-side outcome yet.
      if (chainState === "None") {
        const age = (now.getTime() - (claim?.destExecutedAt ?? now).getTime()) / 1000;
        if (age > this.cfg.overdueAfterSec) {
          await this.db
            .update(settlementClaims)
            .set({ overdueSince: claim?.overdueSince ?? now })
            .where(eq(settlementClaims.rescueId, f.rescueId));
          out.push(
            await this.incident(
              f.rescueId,
              "overdue",
              "warning",
              `solver fill ${f.principal}+${f.fee} has no reserve-chain settlement after ${Math.round(age)}s`,
              "Check Reactive delivery of the settlement callback (core balance, callback debt, subscriptions).",
            ),
          );
        }
        continue;
      }

      // 4) Failed payout: retry when the budget can now cover it.
      if (chainState === "RecoveryRequired") {
        const b = await this.reserve.readContract({
          address: this.cfg.protectionVault,
          abi: bastionProtectionVaultAbi,
          functionName: "getBudget",
          args: [onchain.policyOwner, onchain.policyId],
        });
        const coverable =
          b.repayReserve >= onchain.principal &&
          b.feeReserve >= onchain.fee &&
          (b.pausedAt === 0n || onchain.executedAt <= b.pausedAt);
        if (coverable && this.cfg.retrier && this.wallet) {
          const { request } = await this.reserve.simulateContract({
            account: this.cfg.retrier,
            address: this.cfg.reserveEscrow,
            abi: crossChainReserveEscrowAbi,
            functionName: "retrySettlement",
            args: [f.rescueId as Hex],
          });
          const hash = await this.wallet.writeContract({
            ...request,
            account: this.cfg.retrier,
            chain: this.wallet.chain,
          });
          const r = await this.reserve.waitForTransactionReceipt({ hash });
          if (r.status !== "success") throw new Error(`retrySettlement reverted ${hash}`);
          out.push({
            rescueId: f.rescueId,
            kind: "retried",
            detail: "budget covers claim; retried",
            tx: hash,
          });
          this.log.info({ rescueId: f.rescueId, tx: hash }, "retried settlement");
        } else {
          out.push(
            await this.incident(
              f.rescueId,
              "recovery_required",
              "critical",
              `reserve payout failed (${claim?.lastError ?? "unknown"}); budget ${coverable ? "covers" : "cannot cover"} ${onchain.principal}+${onchain.fee}`,
              coverable
                ? "Anyone may call retrySettlement(rescueId)."
                : "Borrower must fund/resume the reserve budget, then retrySettlement.",
            ),
          );
        }
        continue;
      }

      // 5) Reimbursed: the destination ledger should be acknowledged (ReimbursementComplete) via Reactive.
      if (chainState === "Reimbursed") {
        await this.resolve(f.rescueId, ["overdue", "recovery_required"]);
        const [intent] = await this.db
          .select()
          .from(rescueIntents)
          .where(eq(rescueIntents.rescueId, f.rescueId));
        const reimbursedAt = reimbursed ? await this.blockTime(reimbursed) : now;
        const age = (now.getTime() - reimbursedAt.getTime()) / 1000;
        if (intent?.state !== "ReimbursementComplete" && age > this.cfg.ackTimeoutSec) {
          out.push(
            await this.incident(
              f.rescueId,
              "ack_missing",
              "warning",
              `reserve paid but destination ledger is ${intent?.state ?? "unknown"} after ${Math.round(age)}s`,
              "Check delivery of the acknowledgment callback to the destination router.",
            ),
          );
        } else if (intent?.state === "ReimbursementComplete") {
          await this.resolve(f.rescueId, ["ack_missing"]);
          out.push({ rescueId: f.rescueId, kind: "ok", detail: "settled and acknowledged" });
        }
      }
    }
    return out;
  }

  private async blockTime(e: typeof settlementEvents.$inferSelect): Promise<Date> {
    const b = await this.reserve.getBlock({ blockNumber: e.blockNumber }).catch(() => null);
    return b ? new Date(Number(b.timestamp) * 1000) : new Date();
  }

  private async incident(
    rescueId: string,
    kind: Finding["kind"],
    severity: "warning" | "critical",
    title: string,
    action: string,
  ): Promise<Finding> {
    await this.db
      .insert(incidentRecords)
      .values({
        dedupKey: `settlement:${kind}:${rescueId}`,
        chainId: this.cfg.reserveChainId,
        scope: "settlement",
        kind: `settlement_${kind}`,
        severity,
        title,
        evidence: { rescueId },
        recommendedAction: action,
      })
      .onConflictDoUpdate({
        target: incidentRecords.dedupKey,
        targetWhere: sql`${incidentRecords.status} <> 'resolved'`,
        set: { occurrences: sql`${incidentRecords.occurrences} + 1`, lastSeenAt: new Date(), title },
      });
    return { rescueId, kind, detail: title };
  }

  private async resolve(rescueId: string, kinds: Finding["kind"][]) {
    for (const k of kinds)
      await this.db
        .update(incidentRecords)
        .set({ status: "resolved", resolvedAt: new Date() })
        .where(
          and(
            eq(incidentRecords.dedupKey, `settlement:${k}:${rescueId}`),
            sql`${incidentRecords.status} <> 'resolved'`,
          ),
        );
  }
}
