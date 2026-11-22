import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import {
  analyticsDaily,
  chainCheckpoints,
  deploymentRegistry,
  lendingPositions,
  policyAuthorizations,
  policyVersions,
  positionObservations,
  protectionPolicies,
  protocols,
  readinessSnapshots,
  rescueExecutions,
  rescueIntents,
  riskObservations,
  settlementClaims,
  settlementEvents,
  solverFills,
  solverLiquidityCommitments,
  solverRegistrations,
  sourceEscrows,
  tokens,
} from "@bastion-guardian/db";
import { Address, Bytes32, ChainIdQ, HttpError, Limit, json, needDb, type ApiContext } from "../context.js";

const where = (...c: (SQL | undefined)[]) => {
  const xs = c.filter((x): x is SQL => !!x);
  return xs.length ? and(...xs) : undefined;
};

export const PROVENANCE_NOTE =
  "Indexed from chain events. On local chain 31337 these are LOCAL SIMULATION results (anvil + fixture protocol), not testnet or mainnet data.";

export const dataRoutes: FastifyPluginAsync<{ ctx: ApiContext }> = async (app, { ctx }) => {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/system/status",
    { schema: { tags: ["system"], summary: "Indexer checkpoints, deployment records and execution mode" } },
    async () => {
      const base = {
        liveExecutionEnabled: ctx.env.ENABLE_LIVE_EXECUTION,
        mainnetEnabled: false,
        database: !!ctx.db,
      };
      if (!ctx.db) return { ...base, checkpoints: [], deployments: [] };
      const db = ctx.db;
      return json({
        ...base,
        checkpoints: await db.select().from(chainCheckpoints).orderBy(asc(chainCheckpoints.chainId)),
        deployments: await db.select().from(deploymentRegistry).orderBy(asc(deploymentRegistry.chainId)),
      });
    },
  );

  r.get(
    "/deployments",
    {
      schema: {
        tags: ["system"],
        summary: "Recorded BASTION contract addresses per chain (mode says local_simulation or testnet)",
        querystring: z.object({ chainId: ChainIdQ }),
      },
    },
    async (req) => {
      const rows = await needDb(ctx)
        .select()
        .from(deploymentRegistry)
        .where(eq(deploymentRegistry.chainId, req.query.chainId))
        .orderBy(asc(deploymentRegistry.contractName));
      return {
        chainId: req.query.chainId,
        mode: rows[0]?.mode ?? null,
        contracts: Object.fromEntries(rows.map((r) => [r.contractName, r.address])),
      };
    },
  );

  r.get(
    "/protocols",
    {
      schema: {
        tags: ["markets"],
        summary: "Configured lending protocols (official vs fixture is explicit)",
      },
    },
    async () => json({ items: await needDb(ctx).select().from(protocols).orderBy(asc(protocols.id)) }),
  );

  r.get(
    "/tokens",
    {
      schema: {
        tags: ["markets"],
        summary: "Token metadata (fixture tokens are flagged is_fixture)",
        querystring: z.object({ chainId: ChainIdQ.optional() }),
      },
    },
    async (req) =>
      json({
        items: await needDb(ctx)
          .select()
          .from(tokens)
          .where(req.query.chainId ? eq(tokens.chainId, req.query.chainId) : undefined),
      }),
  );

  r.get(
    "/policies",
    {
      schema: {
        tags: ["policies"],
        summary: "Registered protection policies (public on-chain data)",
        querystring: z.object({
          chainId: ChainIdQ.optional(),
          owner: Address.optional(),
          account: Address.optional(),
          status: z.enum(["Active", "Paused", "Revoked"]).optional(),
          limit: Limit,
        }),
      },
    },
    async (req) => {
      const q = req.query;
      const items = await needDb(ctx)
        .select()
        .from(protectionPolicies)
        .where(
          where(
            q.chainId ? eq(protectionPolicies.chainId, q.chainId) : undefined,
            q.owner ? eq(protectionPolicies.owner, q.owner) : undefined,
            q.account ? eq(protectionPolicies.account, q.account) : undefined,
            q.status ? eq(protectionPolicies.status, q.status) : undefined,
          ),
        )
        .orderBy(desc(protectionPolicies.registeredAt))
        .limit(q.limit);
      const latest = await latestReadiness(items.map((p) => [p.chainId, p.policyId] as const));
      return json({
        items: items.map((p) => ({ ...p, readiness: latest.get(`${p.chainId}:${p.policyId}`) ?? null })),
        provenance: PROVENANCE_NOTE,
      });
    },
  );

  async function latestReadiness(keys: (readonly [number, string])[]) {
    const out = new Map<string, unknown>();
    if (!keys.length) return out;
    const db = needDb(ctx);
    const rows = await db
      .selectDistinctOn([readinessSnapshots.chainId, readinessSnapshots.policyId])
      .from(readinessSnapshots)
      .where(
        inArray(
          readinessSnapshots.policyId,
          keys.map((k) => k[1]),
        ),
      )
      .orderBy(readinessSnapshots.chainId, readinessSnapshots.policyId, desc(readinessSnapshots.evaluatedAt));
    for (const x of rows) out.set(`${x.chainId}:${x.policyId}`, x);
    return out;
  }

  const PolicyParams = z.object({ chainId: ChainIdQ, policyId: Bytes32 });

  r.get(
    "/policies/:chainId/:policyId",
    {
      schema: {
        tags: ["policies"],
        summary: "Policy detail: versions, authorizations, budget, readiness and rescues",
        params: PolicyParams,
      },
    },
    async (req) => {
      const db = needDb(ctx);
      const { chainId, policyId } = req.params;
      const [policy] = await db
        .select()
        .from(protectionPolicies)
        .where(and(eq(protectionPolicies.chainId, chainId), eq(protectionPolicies.policyId, policyId)));
      if (!policy) throw new HttpError(404, "POLICY_NOT_FOUND");
      const [versions, authorizations, budgets, rescues, readiness, position] = await Promise.all([
        db
          .select()
          .from(policyVersions)
          .where(and(eq(policyVersions.chainId, chainId), eq(policyVersions.policyId, policyId)))
          .orderBy(desc(policyVersions.version)),
        db.select().from(policyAuthorizations).where(eq(policyAuthorizations.policyId, policyId)),
        db.select().from(sourceEscrows).where(eq(sourceEscrows.policyId, policyId)),
        db
          .select()
          .from(rescueIntents)
          .where(eq(rescueIntents.policyId, policyId))
          .orderBy(desc(rescueIntents.createdAt))
          .limit(50),
        latestReadiness([[chainId, policyId]]),
        db
          .select()
          .from(lendingPositions)
          .where(and(eq(lendingPositions.chainId, chainId), eq(lendingPositions.account, policy.account)))
          .limit(5),
      ]);
      return json({
        policy,
        versions,
        authorizations,
        budgets,
        rescues,
        positions: position,
        readiness: readiness.get(`${chainId}:${policyId}`) ?? null,
        provenance: PROVENANCE_NOTE,
      });
    },
  );

  r.get(
    "/policies/:chainId/:policyId/readiness",
    {
      schema: {
        tags: ["policies"],
        summary: "Guardian readiness history",
        params: PolicyParams,
        querystring: z.object({ limit: Limit }),
      },
    },
    async (req) =>
      json({
        items: await needDb(ctx)
          .select()
          .from(readinessSnapshots)
          .where(
            and(
              eq(readinessSnapshots.chainId, req.params.chainId),
              eq(readinessSnapshots.policyId, req.params.policyId),
            ),
          )
          .orderBy(desc(readinessSnapshots.evaluatedAt))
          .limit(req.query.limit),
      }),
  );

  r.get(
    "/positions",
    {
      schema: {
        tags: ["positions"],
        summary: "Observed lending positions",
        querystring: z.object({ chainId: ChainIdQ.optional(), account: Address.optional(), limit: Limit }),
      },
    },
    async (req) =>
      json({
        items: await needDb(ctx)
          .select()
          .from(lendingPositions)
          .where(
            where(
              req.query.chainId ? eq(lendingPositions.chainId, req.query.chainId) : undefined,
              req.query.account ? eq(lendingPositions.account, req.query.account) : undefined,
            ),
          )
          .orderBy(desc(lendingPositions.observedAt))
          .limit(req.query.limit),
        provenance: PROVENANCE_NOTE,
      }),
  );

  r.get(
    "/positions/:id",
    {
      schema: {
        tags: ["positions"],
        summary: "One observed lending position (latest indexed state)",
        params: z.object({ id: z.string().uuid() }),
      },
    },
    async (req) => {
      const [row] = await needDb(ctx)
        .select()
        .from(lendingPositions)
        .where(eq(lendingPositions.id, req.params.id));
      if (!row) throw new HttpError(404, "POSITION_NOT_FOUND");
      return json({ ...row, provenance: PROVENANCE_NOTE });
    },
  );

  r.get(
    "/positions/:id/observations",
    {
      schema: {
        tags: ["positions"],
        summary: "Health-factor history for a position",
        params: z.object({ id: z.string().uuid() }),
        querystring: z.object({ limit: Limit }),
      },
    },
    async (req) =>
      json({
        items: await needDb(ctx)
          .select()
          .from(positionObservations)
          .where(eq(positionObservations.positionId, req.params.id))
          .orderBy(desc(positionObservations.observedAt))
          .limit(req.query.limit),
      }),
  );

  r.get(
    "/risk-observations",
    {
      schema: {
        tags: ["rescues"],
        summary: "On-chain trigger observations",
        querystring: z.object({ chainId: ChainIdQ.optional(), policyId: Bytes32.optional(), limit: Limit }),
      },
    },
    async (req) =>
      json({
        items: await needDb(ctx)
          .select()
          .from(riskObservations)
          .where(
            where(
              req.query.chainId ? eq(riskObservations.chainId, req.query.chainId) : undefined,
              req.query.policyId ? eq(riskObservations.policyId, req.query.policyId) : undefined,
            ),
          )
          .orderBy(desc(riskObservations.id))
          .limit(req.query.limit),
      }),
  );

  r.get(
    "/rescues",
    {
      schema: {
        tags: ["rescues"],
        summary: "Rescue intents (ledger state machine)",
        querystring: z.object({
          chainId: ChainIdQ.optional(),
          policyId: Bytes32.optional(),
          state: z.string().max(32).optional(),
          limit: Limit,
        }),
      },
    },
    async (req) => {
      const q = req.query;
      const db = needDb(ctx);
      const intents = await db
        .select()
        .from(rescueIntents)
        .where(
          where(
            q.chainId ? eq(rescueIntents.chainId, q.chainId) : undefined,
            q.policyId ? eq(rescueIntents.policyId, q.policyId) : undefined,
            q.state ? sql`${rescueIntents.state}::text = ${q.state}` : undefined,
          ),
        )
        .orderBy(desc(rescueIntents.createdAt))
        .limit(q.limit);
      const execs = intents.length
        ? await db
            .select()
            .from(rescueExecutions)
            .where(
              inArray(
                rescueExecutions.rescueId,
                intents.map((i) => i.rescueId),
              ),
            )
        : [];
      return json({
        items: intents.map((i) => ({ ...i, executions: execs.filter((e) => e.rescueId === i.rescueId) })),
        provenance: PROVENANCE_NOTE,
      });
    },
  );

  r.get(
    "/rescues/:rescueId",
    {
      schema: {
        tags: ["rescues"],
        summary: "Full rescue receipt: intent, executions, solver fill, settlement claim and events",
        params: z.object({ rescueId: Bytes32 }),
      },
    },
    async (req) => {
      const db = needDb(ctx);
      const id = req.params.rescueId;
      const [intent] = await db.select().from(rescueIntents).where(eq(rescueIntents.rescueId, id));
      const [executions, fills, claim, events] = await Promise.all([
        db
          .select()
          .from(rescueExecutions)
          .where(eq(rescueExecutions.rescueId, id))
          .orderBy(asc(rescueExecutions.blockNumber)),
        db.select().from(solverFills).where(eq(solverFills.rescueId, id)),
        db.select().from(settlementClaims).where(eq(settlementClaims.rescueId, id)),
        db
          .select()
          .from(settlementEvents)
          .where(eq(settlementEvents.rescueId, id))
          .orderBy(asc(settlementEvents.blockNumber), asc(settlementEvents.logIndex)),
      ]);
      if (!intent && !executions.length) throw new HttpError(404, "RESCUE_NOT_FOUND");
      return json({
        intent: intent ?? null,
        executions,
        solverFills: fills,
        settlementClaim: claim[0] ?? null,
        settlementEvents: events,
        provenance: PROVENANCE_NOTE,
      });
    },
  );

  r.get(
    "/settlements",
    {
      schema: {
        tags: ["settlement"],
        summary: "Cross-chain settlement claims",
        querystring: z.object({
          state: z.enum(["Pending", "Reimbursed", "RecoveryRequired", "Disputed"]).optional(),
          limit: Limit,
        }),
      },
    },
    async (req) =>
      json({
        items: await needDb(ctx)
          .select()
          .from(settlementClaims)
          .where(req.query.state ? eq(settlementClaims.state, req.query.state) : undefined)
          .orderBy(desc(settlementClaims.updatedAt))
          .limit(req.query.limit),
      }),
  );

  r.get(
    "/solvers",
    {
      schema: {
        tags: ["solvers"],
        summary: "Registered solvers and their committed liquidity",
        querystring: z.object({ chainId: ChainIdQ.optional() }),
      },
    },
    async (req) => {
      const db = needDb(ctx);
      const regs = await db
        .select()
        .from(solverRegistrations)
        .where(req.query.chainId ? eq(solverRegistrations.chainId, req.query.chainId) : undefined);
      const commits = await db
        .select()
        .from(solverLiquidityCommitments)
        .where(eq(solverLiquidityCommitments.state, "active"));
      return json({
        items: regs.map((s) => {
          const mine = commits.filter((c) => c.solver === s.solver && c.chainId === s.chainId);
          return {
            ...s,
            activeCommitments: mine.length,
            committedRemaining: mine.reduce((a, c) => a + BigInt(c.remaining), 0n),
          };
        }),
      });
    },
  );

  r.get(
    "/solvers/:chainId/:address",
    {
      schema: {
        tags: ["solvers"],
        summary: "Solver detail: commitments and fills",
        params: z.object({ chainId: ChainIdQ, address: Address }),
      },
    },
    async (req) => {
      const db = needDb(ctx);
      const { chainId, address } = req.params;
      const [reg] = await db
        .select()
        .from(solverRegistrations)
        .where(and(eq(solverRegistrations.chainId, chainId), eq(solverRegistrations.solver, address)));
      if (!reg) throw new HttpError(404, "SOLVER_NOT_FOUND");
      const [commitments, fills] = await Promise.all([
        db
          .select()
          .from(solverLiquidityCommitments)
          .where(
            and(
              eq(solverLiquidityCommitments.chainId, chainId),
              eq(solverLiquidityCommitments.solver, address),
            ),
          )
          .orderBy(desc(solverLiquidityCommitments.updatedAt)),
        db
          .select()
          .from(solverFills)
          .where(and(eq(solverFills.chainId, chainId), eq(solverFills.solver, address)))
          .orderBy(desc(solverFills.blockNumber)),
      ]);
      return json({ solver: reg, commitments, fills });
    },
  );

  r.get(
    "/analytics/daily",
    {
      schema: {
        tags: ["analytics"],
        summary: "Daily metrics computed by analytics-worker from indexed data",
        querystring: z.object({
          chainId: ChainIdQ,
          from: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
          to: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
        }),
      },
    },
    async (req) => {
      const q = req.query;
      const rows = await needDb(ctx)
        .select()
        .from(analyticsDaily)
        .where(
          where(
            eq(analyticsDaily.chainId, q.chainId),
            q.from ? gte(analyticsDaily.day, q.from) : undefined,
            q.to ? lte(analyticsDaily.day, q.to) : undefined,
          ),
        )
        .orderBy(asc(analyticsDaily.day), asc(analyticsDaily.metric))
        .limit(5000);
      const days: Record<string, Record<string, string>> = {};
      for (const x of rows) (days[x.day] ??= {})[x.metric] = x.value;
      return {
        chainId: q.chainId,
        days,
        note: "*_raw metrics are summed token base units (single debt asset per chain in the local simulation).",
      };
    },
  );
};
