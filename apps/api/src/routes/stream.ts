import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { and, asc, eq, gt, sql, type SQL } from "drizzle-orm";
import {
  incidentRecords,
  readinessSnapshots,
  rescueExecutions,
  riskObservations,
  settlementEvents,
} from "@bastion-guardian/db";
import { Bytes32, ChainIdQ, HttpError, json, needDb, type ApiContext } from "../context.js";

/** Composite cursor across event tables; serialized as the SSE `id` so `Last-Event-ID` resumes losslessly. */
interface Cursor {
  r: number; // risk_observations.id
  e: number; // rescue_executions.id
  s: number; // settlement_events.id
  d: number; // readiness_snapshots.id
  i: string; // incident_records.last_seen_at (ISO)
}
const enc = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString("base64url");
function dec(v: string | undefined): Cursor | null {
  if (!v) return null;
  try {
    const c = JSON.parse(Buffer.from(v, "base64url").toString()) as Cursor;
    if (
      [c.r, c.e, c.s, c.d].every((n) => Number.isSafeInteger(n) && n >= 0) &&
      !Number.isNaN(Date.parse(c.i))
    )
      return c;
  } catch {
    /* fall through */
  }
  return null;
}

const MAX_STREAMS = 500;
let open = 0;

export const streamRoutes: FastifyPluginAsync<{ ctx: ApiContext }> = async (app, { ctx }) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const live = new Set<() => void>();
  app.addHook("onClose", async () => {
    for (const end of [...live]) end();
  });
  r.get(
    "/stream",
    {
      schema: {
        tags: ["stream"],
        summary:
          "Server-Sent Events: risk observations, rescue executions, settlement events, readiness and incidents",
        description:
          "text/event-stream. Event names: risk.observed, rescue.executed, settlement.event, readiness.updated, incident.updated. Resume with the Last-Event-ID header. Heartbeat comments every 15 s.",
        querystring: z.object({ chainId: ChainIdQ.optional(), policyId: Bytes32.optional() }),
      },
    },
    async (req, reply) => {
      const db = needDb(ctx);
      if (open >= MAX_STREAMS) throw new HttpError(503, "STREAM_CAPACITY");
      const { chainId, policyId } = req.query;
      const f = (chainCol: SQL | undefined, policyCol: SQL | undefined) =>
        [chainCol, policyCol].filter((x): x is SQL => !!x);

      let cur = dec(req.headers["last-event-id"] as string | undefined);
      if (!cur) {
        const [m] = (
          await db.execute(sql`select
            (select coalesce(max(id),0) from risk_observations) r,
            (select coalesce(max(id),0) from rescue_executions) e,
            (select coalesce(max(id),0) from settlement_events) s,
            (select coalesce(max(id),0) from readiness_snapshots) d,
            (select coalesce(max(last_seen_at), now()) from incident_records) i`)
        ).rows as { r: string; e: string; s: string; d: string; i: Date | string }[];
        cur = {
          r: Number(m!.r),
          e: Number(m!.e),
          s: Number(m!.s),
          d: Number(m!.d),
          i: new Date(m!.i).toISOString(),
        };
      }

      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
        ...(ctx.env.API_PUBLIC_ORIGIN
          ? {
              "access-control-allow-origin": ctx.env.API_PUBLIC_ORIGIN,
              "access-control-allow-credentials": "true",
            }
          : {}),
      });
      open++;
      let closed = false;
      const send = (event: string, data: unknown, id?: string) => {
        if (closed) return;
        res.write(`${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(json(data))}\n\n`);
      };
      send(
        "hello",
        {
          liveExecutionEnabled: ctx.env.ENABLE_LIVE_EXECUTION,
          mainnetEnabled: false,
          filter: { chainId: chainId ?? null, policyId: policyId ?? null },
        },
        enc(cur),
      );

      const poll = async () => {
        const c = cur!;
        const risks = await db
          .select()
          .from(riskObservations)
          .where(
            and(
              gt(riskObservations.id, c.r),
              ...f(
                chainId ? eq(riskObservations.chainId, chainId) : undefined,
                policyId ? eq(riskObservations.policyId, policyId) : undefined,
              ),
            ),
          )
          .orderBy(asc(riskObservations.id))
          .limit(100);
        for (const x of risks) {
          c.r = x.id;
          send("risk.observed", x, enc(c));
        }
        const execs = await db
          .select()
          .from(rescueExecutions)
          .where(
            and(
              gt(rescueExecutions.id, c.e),
              ...f(chainId ? eq(rescueExecutions.chainId, chainId) : undefined, undefined),
            ),
          )
          .orderBy(asc(rescueExecutions.id))
          .limit(100);
        for (const x of execs) {
          c.e = x.id;
          send("rescue.executed", x, enc(c));
        }
        const sets = await db
          .select()
          .from(settlementEvents)
          .where(
            and(
              gt(settlementEvents.id, c.s),
              ...f(chainId ? eq(settlementEvents.chainId, chainId) : undefined, undefined),
            ),
          )
          .orderBy(asc(settlementEvents.id))
          .limit(100);
        for (const x of sets) {
          c.s = x.id;
          send("settlement.event", x, enc(c));
        }
        const rd = await db
          .select()
          .from(readinessSnapshots)
          .where(
            and(
              gt(readinessSnapshots.id, c.d),
              ...f(
                chainId ? eq(readinessSnapshots.chainId, chainId) : undefined,
                policyId ? eq(readinessSnapshots.policyId, policyId) : undefined,
              ),
            ),
          )
          .orderBy(asc(readinessSnapshots.id))
          .limit(100);
        for (const x of rd) {
          c.d = x.id;
          send(
            "readiness.updated",
            {
              id: x.id,
              chainId: x.chainId,
              policyId: x.policyId,
              status: x.status,
              evaluatedAt: x.evaluatedAt,
            },
            enc(c),
          );
        }
        const inc = await db
          .select()
          .from(incidentRecords)
          .where(
            and(
              gt(incidentRecords.lastSeenAt, new Date(c.i)),
              ...f(
                chainId ? eq(incidentRecords.chainId, chainId) : undefined,
                policyId ? eq(incidentRecords.policyId, policyId) : undefined,
              ),
            ),
          )
          .orderBy(asc(incidentRecords.lastSeenAt))
          .limit(100);
        for (const x of inc) {
          c.i = x.lastSeenAt.toISOString();
          send(
            "incident.updated",
            {
              id: x.id,
              kind: x.kind,
              severity: x.severity,
              status: x.status,
              title: x.title,
              policyId: x.policyId,
              chainId: x.chainId,
              lastSeenAt: x.lastSeenAt,
            },
            enc(c),
          );
        }
      };

      let busy = false;
      const timer = setInterval(() => {
        if (busy || closed) return;
        busy = true;
        poll()
          .catch((e) =>
            send("error", { code: "STREAM_POLL_FAILED", message: String((e as Error).message ?? e) }),
          )
          .finally(() => (busy = false));
      }, ctx.sseIntervalMs);
      const hb = setInterval(() => !closed && res.write(`: heartbeat ${Date.now()}\n\n`), 15_000);
      const close = () => {
        if (closed) return;
        closed = true;
        open--;
        clearInterval(timer);
        clearInterval(hb);
      };
      const end = () => {
        close();
        res.end();
      };
      live.add(end);
      res.on("close", () => {
        close();
        live.delete(end);
      });
    },
  );
};
