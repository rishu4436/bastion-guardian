import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { verifyTypedData, type Address, type Hex, type PublicClient } from "viem";
import { bastionPolicyRegistryAbi, solverQuoteManagerAbi } from "@bastion-guardian/contracts";
import {
  policyVersions,
  protectionPolicies,
  readinessSnapshots,
  solverLiquidityCommitments,
  solverQuotes,
  solverRegistrations,
  type Database,
} from "@bastion-guardian/db";
import { createLogger, type Logger } from "@bastion-guardian/service-kit";
import { QUOTE_TYPES, quoteDomain, type SolverQuote } from "./quote.js";

export interface CoordinatorConfig {
  chainId: number;
  solverLiquidityVault: Address;
  solverQuoteManager: Address;
  policyRegistry: Address;
  maxQuoteTtlSec?: number;
}

export class QuoteRejected extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export interface DemandItem {
  policyId: string;
  debtAsset: string;
  requiredRepayAtTrigger: bigint;
  committedCoverage: bigint;
  shortfall: bigint;
  maxFeeBps: number;
  readiness: string;
  evaluatedAt: Date;
}

export class SolverCoordinator {
  private readonly log: Logger;
  constructor(
    private readonly db: Database,
    private readonly client: PublicClient,
    private readonly cfg: CoordinatorConfig,
    logger?: Logger,
  ) {
    this.log = logger ?? createLogger("solver-coordinator");
  }

  /** Verifies and stores a signed quote. Throws QuoteRejected with a machine-readable code. */
  async submitQuote(q: SolverQuote, signature: Hex, now = Math.floor(Date.now() / 1000)): Promise<string> {
    const ok = await verifyTypedData({
      address: q.solver,
      domain: quoteDomain(this.cfg.chainId, this.cfg.solverLiquidityVault),
      types: QUOTE_TYPES,
      primaryType: "SolverQuote",
      message: q,
      signature,
    }).catch(() => false);
    if (!ok) throw new QuoteRejected("BAD_SIGNATURE");
    if (q.amount <= 0n) throw new QuoteRejected("ZERO_AMOUNT");
    if (q.validUntil <= BigInt(now)) throw new QuoteRejected("EXPIRED");
    if (q.validUntil > BigInt(now + (this.cfg.maxQuoteTtlSec ?? 3600)))
      throw new QuoteRejected("TTL_TOO_LONG");
    const solver = q.solver.toLowerCase();
    const pid = q.policyId.toLowerCase();
    const [reg] = await this.db
      .select()
      .from(solverRegistrations)
      .where(and(eq(solverRegistrations.chainId, this.cfg.chainId), eq(solverRegistrations.solver, solver)));
    if (!reg || reg.status !== "active") throw new QuoteRejected("SOLVER_NOT_ACTIVE");
    const [pol] = await this.db
      .select({ p: protectionPolicies, v: policyVersions })
      .from(protectionPolicies)
      .innerJoin(
        policyVersions,
        and(
          eq(policyVersions.chainId, protectionPolicies.chainId),
          eq(policyVersions.policyId, protectionPolicies.policyId),
          eq(policyVersions.version, protectionPolicies.currentVersion),
        ),
      )
      .where(and(eq(protectionPolicies.chainId, this.cfg.chainId), eq(protectionPolicies.policyId, pid)));
    if (!pol || pol.p.status !== "Active") throw new QuoteRejected("POLICY_NOT_ACTIVE");
    if ((pol.v.allowedPaths & 2) === 0) throw new QuoteRejected("SOLVER_PATH_NOT_ALLOWED");
    if (q.token.toLowerCase() !== pol.p.debtAsset) throw new QuoteRejected("WRONG_TOKEN");
    if (q.feeBps > pol.v.maxFeeBps) throw new QuoteRejected("FEE_ABOVE_POLICY_MAX");
    const allowed = await this.client.readContract({
      address: this.cfg.policyRegistry,
      abi: bastionPolicyRegistryAbi,
      functionName: "isSolverAllowed",
      args: [q.policyId, q.solver],
    });
    if (!allowed) throw new QuoteRejected("SOLVER_NOT_ALLOWLISTED");
    const [row] = await this.db
      .insert(solverQuotes)
      .values({
        chainId: this.cfg.chainId,
        solver,
        policyId: pid,
        token: q.token.toLowerCase(),
        amount: q.amount.toString(),
        feeBps: q.feeBps,
        validUntil: new Date(Number(q.validUntil) * 1000),
        signature,
        status: "offered",
      })
      .returning({ id: solverQuotes.id });
    return row!.id;
  }

  /** Expires stale quotes and links offered quotes to matching on-chain commitments. */
  async tick(now = new Date()): Promise<{ expired: number; linked: number }> {
    const expired = await this.db
      .update(solverQuotes)
      .set({ status: "expired" })
      .where(
        and(
          eq(solverQuotes.chainId, this.cfg.chainId),
          inArray(solverQuotes.status, ["offered", "committed"]),
          lt(solverQuotes.validUntil, now),
        ),
      )
      .returning({ id: solverQuotes.id });
    const offered = await this.db
      .select()
      .from(solverQuotes)
      .where(and(eq(solverQuotes.chainId, this.cfg.chainId), eq(solverQuotes.status, "offered")));
    let linked = 0;
    for (const q of offered) {
      const [c] = await this.db
        .select()
        .from(solverLiquidityCommitments)
        .where(
          and(
            eq(solverLiquidityCommitments.chainId, this.cfg.chainId),
            eq(solverLiquidityCommitments.solver, q.solver),
            eq(solverLiquidityCommitments.policyId, q.policyId),
            eq(solverLiquidityCommitments.token, q.token),
            eq(solverLiquidityCommitments.state, "active"),
            sql`${solverLiquidityCommitments.remaining} >= ${q.amount}`,
            sql`${solverLiquidityCommitments.feeBps} <= ${q.feeBps}`,
            sql`${solverLiquidityCommitments.expiry} > ${now}`,
          ),
        )
        .orderBy(desc(solverLiquidityCommitments.createdBlock))
        .limit(1);
      if (c) {
        await this.db
          .update(solverQuotes)
          .set({ status: "committed", backingCommitmentId: c.commitmentId })
          .where(eq(solverQuotes.id, q.id));
        linked++;
      }
    }
    if (expired.length || linked) this.log.info({ expired: expired.length, linked }, "quotes reconciled");
    return { expired: expired.length, linked };
  }

  /** Policies whose committed coverage is below the amount needed at the trigger (latest readiness snapshot). */
  async demand(): Promise<DemandItem[]> {
    const latest = await this.db.execute<{
      policy_id: string;
      status: string;
      checks: { inputs?: Record<string, string | null> };
      evaluated_at: Date;
    }>(sql`select distinct on (policy_id) policy_id, status, checks, evaluated_at from ${readinessSnapshots}
           where chain_id = ${this.cfg.chainId} order by policy_id, evaluated_at desc, id desc`);
    const out: DemandItem[] = [];
    for (const r of latest.rows) {
      const req = r.checks.inputs?.requiredRepayAtTrigger;
      if (req == null) continue;
      const [pol] = await this.db
        .select({ p: protectionPolicies, v: policyVersions })
        .from(protectionPolicies)
        .innerJoin(
          policyVersions,
          and(
            eq(policyVersions.chainId, protectionPolicies.chainId),
            eq(policyVersions.policyId, protectionPolicies.policyId),
            eq(policyVersions.version, protectionPolicies.currentVersion),
          ),
        )
        .where(
          and(eq(protectionPolicies.chainId, this.cfg.chainId), eq(protectionPolicies.policyId, r.policy_id)),
        );
      if (!pol || pol.p.status !== "Active" || (pol.v.allowedPaths & 2) === 0) continue;
      const cov = BigInt(r.checks.inputs?.solverCoverage ?? "0");
      const need = BigInt(req);
      out.push({
        policyId: r.policy_id,
        debtAsset: pol.p.debtAsset,
        requiredRepayAtTrigger: need,
        committedCoverage: cov,
        shortfall: need > cov ? need - cov : 0n,
        maxFeeBps: pol.v.maxFeeBps,
        readiness: r.status,
        evaluatedAt: r.evaluated_at,
      });
    }
    return out.sort((a, b) => (b.shortfall > a.shortfall ? 1 : b.shortfall < a.shortfall ? -1 : 0));
  }

  /** Authoritative on-chain selection (SolverQuoteManager.selectBest) — the same call the executor makes. */
  async selectBest(policyId: Hex, token: Address, required: bigint, maxFeeBps: number) {
    const [found, c] = await this.client.readContract({
      address: this.cfg.solverQuoteManager,
      abi: solverQuoteManagerAbi,
      functionName: "selectBest",
      args: [policyId, token, required, maxFeeBps],
    });
    return found ? c : null;
  }
}
