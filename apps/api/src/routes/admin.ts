import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { and, desc, eq } from "drizzle-orm";
import { auditEvents, incidentRecords, userRoles, walletIdentities } from "@bastion-guardian/db";
import { Address, HttpError, Limit, json, needDb, type ApiContext } from "../context.js";
import { audit, requireAuth } from "../auth.js";

export const adminRoutes: FastifyPluginAsync<{ ctx: ApiContext }> = async (app, { ctx }) => {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/incidents",
    {
      preHandler: requireAuth(ctx, "auditor", "admin"),
      schema: {
        tags: ["operations"],
        summary: "All incidents (auditor/admin)",
        querystring: z.object({
          status: z.enum(["open", "acknowledged", "resolved"]).optional(),
          limit: Limit,
        }),
      },
    },
    async (req) =>
      json({
        items: await needDb(ctx)
          .select()
          .from(incidentRecords)
          .where(req.query.status ? eq(incidentRecords.status, req.query.status) : undefined)
          .orderBy(desc(incidentRecords.lastSeenAt))
          .limit(req.query.limit),
      }),
  );

  r.post(
    "/incidents/:id/acknowledge",
    {
      preHandler: requireAuth(ctx, "admin"),
      schema: {
        tags: ["operations"],
        summary: "Acknowledge an open incident (admin)",
        params: z.object({ id: z.string().uuid() }),
      },
    },
    async (req) => {
      const db = needDb(ctx);
      const res = await db
        .update(incidentRecords)
        .set({ status: "acknowledged" })
        .where(and(eq(incidentRecords.id, req.params.id), eq(incidentRecords.status, "open")))
        .returning({ id: incidentRecords.id });
      if (!res.length) throw new HttpError(404, "INCIDENT_NOT_OPEN");
      await audit(db, req, "incident.acknowledged", req.params.id);
      return { id: req.params.id, status: "acknowledged" };
    },
  );

  r.get(
    "/admin/audit-events",
    {
      preHandler: requireAuth(ctx, "auditor", "admin"),
      schema: {
        tags: ["operations"],
        summary: "Audit trail (auditor/admin)",
        querystring: z.object({ limit: Limit }),
      },
    },
    async (req) =>
      json({
        items: await needDb(ctx)
          .select()
          .from(auditEvents)
          .orderBy(desc(auditEvents.id))
          .limit(req.query.limit),
      }),
  );

  r.post(
    "/admin/roles",
    {
      preHandler: requireAuth(ctx, "admin"),
      schema: {
        tags: ["operations"],
        summary: "Grant or revoke a role for a verified wallet (admin)",
        body: z.object({
          address: Address,
          role: z.enum(["solver", "auditor", "integrator", "admin"]),
          grant: z.boolean(),
        }),
      },
    },
    async (req) => {
      const db = needDb(ctx);
      const [w] = await db
        .select()
        .from(walletIdentities)
        .where(eq(walletIdentities.address, req.body.address));
      if (!w)
        throw new HttpError(
          404,
          "WALLET_NOT_REGISTERED",
          "The wallet must sign in once before roles can be granted",
        );
      if (req.body.grant)
        await db
          .insert(userRoles)
          .values({ userId: w.userId, role: req.body.role, grantedBy: req.auth!.userId })
          .onConflictDoNothing();
      else
        await db
          .delete(userRoles)
          .where(and(eq(userRoles.userId, w.userId), eq(userRoles.role, req.body.role)));
      await audit(db, req, req.body.grant ? "role.granted" : "role.revoked", w.userId, {
        role: req.body.role,
      });
      return { ok: true };
    },
  );
};
