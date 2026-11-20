import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { Hex, PublicClient } from "viem";
import {
  analyticsDaily,
  incidentRecords,
  notificationDeliveries,
  readinessSnapshots,
  rescueExecutions,
  riskObservations,
  settlementEvents,
  solverFills,
  type Database,
} from "@bastion-guardian/db";

/**
 * Metric catalogue. Amount metrics end in `_raw`: summed token base units across the chain. They are only
 * meaningful when the chain has a single debt asset (true for the LOCAL SIMULATION, fUSDC); a per-asset
 * breakdown needs a debt-token column on rescue rows (tracked in FEATURE-COMPLETENESS).
 */
export const METRICS = [
  "risk.observations",
  "risk.accounts_triggered",
  "rescue.executed",
  "rescue.failed",
  "rescue.path_flash",
  "rescue.path_solver",
  "rescue.repaid_raw",
  "rescue.fee_raw",
  "solver.fills",
  "solver.fee_raw",
  "settlement.reimbursed",
  "settlement.reimbursed_raw",
  "settlement.failed",
  "settlement.disputed",
  "readiness.snapshots",
  "readiness.armed_bps",
  "notifications.accepted",
  "notifications.suppressed",
  "notifications.dead_letter",
  "incidents.opened",
] as const;
export type Metric = (typeof METRICS)[number];

export type BlockTimeResolver = (chainId: number, blockHash: Hex) => Promise<Date>;

/** Resolves block timestamps from the chain for event tables that do not persist them; cached by block hash. */
export function rpcBlockTimes(clients: Record<number, PublicClient>): BlockTimeResolver {
  const cache = new Map<string, Date>();
  return async (chainId, blockHash) => {
    const k = `${chainId}:${blockHash}`;
    const hit = cache.get(k);
    if (hit) return hit;
    const c = clients[chainId];
    if (!c) throw new Error(`no RPC client for chain ${chainId}`);
    const b = await c.getBlock({ blockHash });
    const d = new Date(Number(b.timestamp) * 1000);
    cache.set(k, d);
    return d;
  };
}

export const utcDay = (d: Date) => d.toISOString().slice(0, 10);
const dayBounds = (day: string) => {
  const start = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || utcDay(start) !== day) throw new Error(`invalid day ${day}`);
  return { start, end: new Date(start.getTime() + 86_400_000) };
};

export class AnalyticsWorker {
  constructor(
    private readonly db: Database,
    private readonly blockTime: BlockTimeResolver,
  ) {}

  /** Recomputes every metric for (day, chain) from source tables and upserts; re-running is idempotent. */
  async computeDay(day: string, chainId: number): Promise<Record<Metric, bigint>> {
    const { start, end } = dayBounds(day);
    const db = this.db;
    const m = Object.fromEntries(METRICS.map((k) => [k, 0n])) as Record<Metric, bigint>;

    const [risk] = await db
      .select({ n: sql<string>`count(*)`, accts: sql<string>`count(distinct ${riskObservations.account})` })
      .from(riskObservations)
      .where(
        and(
          eq(riskObservations.chainId, chainId),
          gte(riskObservations.observedAt, start),
          lt(riskObservations.observedAt, end),
        ),
      );
    m["risk.observations"] = BigInt(risk!.n);
    m["risk.accounts_triggered"] = BigInt(risk!.accts);

    const execs = await db.select().from(rescueExecutions).where(eq(rescueExecutions.chainId, chainId));
    for (const e of execs) {
      const t = e.blockTimestamp ?? (await this.blockTime(chainId, e.blockHash as Hex));
      if (t < start || t >= end) continue;
      if (!e.success) {
        m["rescue.failed"]++;
        continue;
      }
      m["rescue.executed"]++;
      if (e.path === 1) m["rescue.path_flash"]++;
      if (e.path === 2) m["rescue.path_solver"]++;
      m["rescue.repaid_raw"] += BigInt(e.repaid ?? "0");
      m["rescue.fee_raw"] += BigInt(e.fee ?? "0");
    }

    for (const f of await db.select().from(solverFills).where(eq(solverFills.chainId, chainId))) {
      const t = await this.blockTime(chainId, f.blockHash as Hex);
      if (t < start || t >= end) continue;
      m["solver.fills"]++;
      m["solver.fee_raw"] += BigInt(f.fee);
    }

    for (const s of await db.select().from(settlementEvents).where(eq(settlementEvents.chainId, chainId))) {
      if (!["reimbursed", "failed", "disputed"].includes(s.kind)) continue;
      const t = await this.blockTime(chainId, s.blockHash as Hex);
      if (t < start || t >= end) continue;
      if (s.kind === "reimbursed") {
        const d = s.data as { principal?: string; fee?: string };
        m["settlement.reimbursed"]++;
        m["settlement.reimbursed_raw"] += BigInt(d.principal ?? "0") + BigInt(d.fee ?? "0");
      } else if (s.kind === "failed") m["settlement.failed"]++;
      else m["settlement.disputed"]++;
    }

    const [rd] = await db
      .select({
        n: sql<string>`count(*)`,
        armed: sql<string>`count(*) filter (where ${readinessSnapshots.status} = 'ARMED')`,
      })
      .from(readinessSnapshots)
      .where(
        and(
          eq(readinessSnapshots.chainId, chainId),
          gte(readinessSnapshots.evaluatedAt, start),
          lt(readinessSnapshots.evaluatedAt, end),
        ),
      );
    m["readiness.snapshots"] = BigInt(rd!.n);
    m["readiness.armed_bps"] =
      m["readiness.snapshots"] === 0n ? 0n : (BigInt(rd!.armed) * 10_000n) / m["readiness.snapshots"];

    // Notifications are user-scoped, not chain-scoped: attributed to the chain named in their verified source refs.
    const [nt] = await db
      .select({
        accepted: sql<string>`count(*) filter (where ${notificationDeliveries.state} in ('provider_accepted','provider_delivered','opened'))`,
        suppressed: sql<string>`count(*) filter (where ${notificationDeliveries.state} = 'suppressed')`,
        dead: sql<string>`count(*) filter (where ${notificationDeliveries.state} = 'dead_letter')`,
      })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.isTest, false),
          sql`(${notificationDeliveries.sourceRefs}->>'chainId')::int = ${chainId}`,
          gte(notificationDeliveries.createdAt, start),
          lt(notificationDeliveries.createdAt, end),
        ),
      );
    m["notifications.accepted"] = BigInt(nt!.accepted);
    m["notifications.suppressed"] = BigInt(nt!.suppressed);
    m["notifications.dead_letter"] = BigInt(nt!.dead);

    const [inc] = await db
      .select({ n: sql<string>`count(*)` })
      .from(incidentRecords)
      .where(
        and(
          eq(incidentRecords.chainId, chainId),
          gte(incidentRecords.openedAt, start),
          lt(incidentRecords.openedAt, end),
        ),
      );
    m["incidents.opened"] = BigInt(inc!.n);

    const now = new Date();
    await db
      .insert(analyticsDaily)
      .values(
        METRICS.map((metric) => ({ day, chainId, metric, value: m[metric].toString(), computedAt: now })),
      )
      .onConflictDoUpdate({
        target: [analyticsDaily.day, analyticsDaily.chainId, analyticsDaily.metric],
        set: { value: sql`excluded.value`, computedAt: now },
      });
    return m;
  }

  /** Recompute today and yesterday (late-arriving events and reorgs can change both). */
  async tick(chainIds: number[], now = new Date()): Promise<void> {
    const today = utcDay(now);
    const yesterday = utcDay(new Date(now.getTime() - 86_400_000));
    for (const c of chainIds) for (const d of [yesterday, today]) await this.computeDay(d, c);
  }
}
