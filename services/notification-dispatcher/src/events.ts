import { and, eq, gt, isNotNull, sql } from "drizzle-orm";
import {
  chains,
  incidentRecords,
  protectionPolicies,
  rescueExecutions,
  rescueIntents,
  riskObservations,
  settlementClaims,
  type Database,
} from "@bastion-guardian/db";
import type { Severity } from "./policy.js";

export interface NotificationEvent {
  dedupKey: string;
  eventType: string;
  severity: Severity;
  chainId: number;
  policyId: string | null;
  owner: string | null;
  sourceRefs: Record<string, unknown>;
  confirmation: "observed" | "confirmed" | "not_applicable";
  facts: Record<string, string | number | boolean | null>;
}

const fmtWad = (v: string | null) =>
  v == null ? null : (Number(BigInt(v) / 10n ** 14n) / 10_000).toFixed(4);

/**
 * Collects notifiable facts from VERIFIED sources only (indexed chain rows and incident records). Every event has a
 * deterministic dedup key, so re-scanning the same window never sends twice.
 */
export async function collectEvents(
  db: Database,
  chainId: number,
  since: Date,
  head: bigint,
): Promise<NotificationEvent[]> {
  const [chain] = await db.select().from(chains).where(eq(chains.chainId, chainId));
  const depth = BigInt(chain?.finalityDepth ?? 1_000_000);
  const conf = (b: bigint) => (head - b >= depth ? "confirmed" : "observed");
  const owner = async (pid: string) =>
    (
      await db
        .select({ o: protectionPolicies.owner })
        .from(protectionPolicies)
        .where(and(eq(protectionPolicies.chainId, chainId), eq(protectionPolicies.policyId, pid)))
    )[0]?.o ?? null;
  const out: NotificationEvent[] = [];

  for (const r of await db
    .select()
    .from(riskObservations)
    .where(and(eq(riskObservations.chainId, chainId), gt(riskObservations.observedAt, since)))) {
    out.push({
      dedupKey: `risk:${chainId}:${r.txHash}:${r.logIndex}`,
      eventType: "risk.trigger_crossed",
      severity: "warning",
      chainId,
      policyId: r.policyId,
      owner: await owner(r.policyId),
      sourceRefs: { chainId, txHash: r.txHash, logIndex: r.logIndex, blockNumber: r.blockNumber.toString() },
      confirmation: conf(r.blockNumber),
      facts: { healthFactor: fmtWad(r.healthFactorWad), trigger: fmtWad(r.triggerHealthFactorWad) },
    });
  }

  const execs = await db
    .select({ e: rescueExecutions, i: rescueIntents })
    .from(rescueExecutions)
    .innerJoin(rescueIntents, eq(rescueIntents.rescueId, rescueExecutions.rescueId))
    .where(
      and(
        eq(rescueExecutions.chainId, chainId),
        sql`coalesce(${rescueExecutions.blockTimestamp}, now()) > ${since}`,
      ),
    );
  for (const { e, i } of execs) {
    out.push({
      dedupKey: `rescue:${chainId}:${e.txHash}:${e.logIndex}`,
      eventType: e.success ? "rescue.executed" : "rescue.failed",
      severity: e.success ? "warning" : "critical",
      chainId,
      policyId: i.policyId,
      owner: await owner(i.policyId),
      sourceRefs: {
        chainId,
        txHash: e.txHash,
        logIndex: e.logIndex,
        rescueId: e.rescueId,
        blockNumber: e.blockNumber.toString(),
      },
      confirmation: conf(e.blockNumber),
      facts: {
        path: e.path === 1 ? "FlashNet" : e.path === 2 ? "Solver" : String(e.path),
        repaid: e.repaid,
        fee: e.fee,
        hfBefore: fmtWad(e.healthFactorBeforeWad),
        hfAfter: fmtWad(e.healthFactorAfterWad),
        reason: e.reason,
      },
    });
  }

  for (const c of await db
    .select()
    .from(settlementClaims)
    .where(and(eq(settlementClaims.state, "RecoveryRequired"), gt(settlementClaims.updatedAt, since)))) {
    out.push({
      dedupKey: `settlement:recovery:${c.rescueId}:${c.attempts}`,
      eventType: "settlement.recovery_required",
      severity: "warning",
      chainId: c.reserveChainId,
      policyId: c.policyId,
      owner: c.policyOwner,
      sourceRefs: { chainId: c.reserveChainId, rescueId: c.rescueId, reserveChainId: c.reserveChainId },
      confirmation: "not_applicable",
      facts: { principal: c.principal, fee: c.fee, lastError: c.lastError },
    });
  }

  for (const inc of await db
    .select()
    .from(incidentRecords)
    .where(
      and(
        isNotNull(incidentRecords.policyId),
        eq(incidentRecords.status, "open"),
        gt(incidentRecords.openedAt, since),
      ),
    )) {
    out.push({
      dedupKey: `incident:${inc.id}`,
      eventType: `protection.${inc.kind}`,
      severity: inc.severity,
      chainId: inc.chainId ?? chainId,
      policyId: inc.policyId,
      owner: await owner(inc.policyId!),
      sourceRefs: { chainId: inc.chainId ?? chainId, incidentId: inc.id },
      confirmation: "not_applicable",
      facts: { title: inc.title, action: inc.recommendedAction },
    });
  }
  return out;
}
