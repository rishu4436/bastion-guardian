import { randomInt } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  deviceSubscriptions,
  incidentRecords,
  notificationChannels,
  notificationDeliveries,
  notificationPreferences,
  protectionPolicies,
  users,
  walletIdentities,
} from "@bastion-guardian/db";
import { HttpError, Limit, json, needDb, sha256, type ApiContext } from "../context.js";
import { audit, requireAuth } from "../auth.js";

const CODE_TTL_MS = 10 * 60_000;
const MAX_CODE_ATTEMPTS = 5;

const ChannelBody = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("telegram"),
    destination: z.string().regex(/^-?\d{1,20}$/, "Telegram chat id"),
  }),
  z.object({ kind: z.literal("email"), destination: z.string().email().max(254) }),
  z.object({
    kind: z.literal("sms"),
    destination: z.string().regex(/^\+[1-9]\d{6,14}$/, "E.164 phone number"),
  }),
]);

export const meRoutes: FastifyPluginAsync<{ ctx: ApiContext }> = async (app, { ctx }) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  app.addHook("preHandler", requireAuth(ctx));

  const wallets = async (userId: string) =>
    (
      await needDb(ctx)
        .select({ a: walletIdentities.address })
        .from(walletIdentities)
        .where(eq(walletIdentities.userId, userId))
    ).map((w) => w.a);

  r.get("/me", { schema: { tags: ["me"], summary: "Signed-in user, wallets and roles" } }, async (req) => {
    const db = needDb(ctx);
    const [u] = await db.select().from(users).where(eq(users.id, req.auth!.userId));
    return json({
      user: { id: u!.id, displayName: u!.displayName, createdAt: u!.createdAt },
      address: req.auth!.address,
      chainId: req.auth!.chainId,
      roles: req.auth!.roles,
      wallets: await wallets(req.auth!.userId),
    });
  });

  r.get(
    "/me/policies",
    { schema: { tags: ["me"], summary: "Policies owned by any of the user's verified wallets" } },
    async (req) => {
      const ws = await wallets(req.auth!.userId);
      return json({
        items: await needDb(ctx)
          .select()
          .from(protectionPolicies)
          .where(inArray(protectionPolicies.owner, ws))
          .orderBy(desc(protectionPolicies.registeredAt)),
      });
    },
  );

  r.get(
    "/me/incidents",
    { schema: { tags: ["me"], summary: "Open incidents affecting the user's policies" } },
    async (req) => {
      const db = needDb(ctx);
      const ws = await wallets(req.auth!.userId);
      const pids = (
        await db
          .select({ p: protectionPolicies.policyId })
          .from(protectionPolicies)
          .where(inArray(protectionPolicies.owner, ws))
      ).map((x) => x.p);
      return json({
        items: pids.length
          ? await db
              .select()
              .from(incidentRecords)
              .where(inArray(incidentRecords.policyId, pids))
              .orderBy(desc(incidentRecords.openedAt))
              .limit(100)
          : [],
      });
    },
  );

  const Prefs = z.object({
    minSeverity: z.enum(["info", "warning", "critical"]),
    quietHoursStart: z.number().int().min(0).max(23).nullable(),
    quietHoursEnd: z.number().int().min(0).max(23).nullable(),
    timezone: z
      .string()
      .max(64)
      .refine((tz) => {
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, "unknown IANA timezone"),
    escalateCritical: z.boolean(),
    privateLockScreen: z.boolean(),
    weeklyDigest: z.boolean(),
    eventOptOuts: z.array(z.string().max(64)).max(32),
  });

  r.get(
    "/me/notification-preferences",
    { schema: { tags: ["notifications"], summary: "Delivery preferences (defaults when never set)" } },
    async (req) => {
      const [p] = await needDb(ctx)
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, req.auth!.userId));
      return json(
        p ?? {
          userId: req.auth!.userId,
          minSeverity: "warning",
          quietHoursStart: null,
          quietHoursEnd: null,
          timezone: "UTC",
          escalateCritical: true,
          privateLockScreen: true,
          weeklyDigest: false,
          eventOptOuts: [],
          isDefault: true,
        },
      );
    },
  );

  r.put(
    "/me/notification-preferences",
    { schema: { tags: ["notifications"], summary: "Replace delivery preferences", body: Prefs } },
    async (req) => {
      const db = needDb(ctx);
      const b = req.body;
      if ((b.quietHoursStart === null) !== (b.quietHoursEnd === null))
        throw new HttpError(400, "QUIET_HOURS_INCOMPLETE");
      const v = { ...b, userId: req.auth!.userId, updatedAt: new Date() };
      await db
        .insert(notificationPreferences)
        .values(v)
        .onConflictDoUpdate({ target: notificationPreferences.userId, set: v });
      await audit(db, req, "notifications.preferences_updated", req.auth!.userId, b);
      return json(v);
    },
  );

  r.get(
    "/me/channels",
    { schema: { tags: ["notifications"], summary: "Linked notification channels" } },
    async (req) =>
      json({
        items: (
          await needDb(ctx)
            .select()
            .from(notificationChannels)
            .where(
              and(eq(notificationChannels.userId, req.auth!.userId), isNull(notificationChannels.unlinkedAt)),
            )
        ).map(({ verificationCodeHash: _h, ...c }) => c),
        providers: Object.fromEntries(
          (["telegram", "email", "sms", "webpush"] as const).map((k) => [
            k,
            ctx.providers?.[k]?.configured ?? false,
          ]),
        ),
      }),
  );

  r.post(
    "/me/channels",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags: ["notifications"],
        summary: "Link a channel; a 6-digit code is sent through it for verification",
        body: ChannelBody,
      },
    },
    async (req, reply) => {
      const db = needDb(ctx);
      const { kind, destination } = req.body;
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      const v = {
        verificationCodeHash: sha256(ctx.pepper, code),
        verificationExpiresAt: new Date(Date.now() + CODE_TTL_MS),
        verificationAttempts: 0,
        status: "pending",
        unlinkedAt: null,
        verifiedAt: null,
      };
      const [ch] = await db
        .insert(notificationChannels)
        .values({ userId: req.auth!.userId, kind, destination, ...v })
        .onConflictDoUpdate({
          target: [notificationChannels.userId, notificationChannels.kind, notificationChannels.destination],
          set: v,
        })
        .returning({ id: notificationChannels.id });
      const provider = ctx.providers?.[kind];
      let codeDelivery: "sent" | "PROVIDER_NOT_CONFIGURED" | "PROVIDER_ERROR" = "PROVIDER_NOT_CONFIGURED";
      if (provider?.configured) {
        try {
          const text = `BASTION verification code: ${code}. It expires in 10 minutes. If you did not request this, ignore it.`;
          await provider.send(destination, {
            title: "BASTION verification",
            body: text,
            lockScreen: text,
            url: ctx.env.API_PUBLIC_ORIGIN,
            severity: "info",
          });
          codeDelivery = "sent";
        } catch {
          codeDelivery = "PROVIDER_ERROR";
        }
      }
      await audit(db, req, "notifications.channel_linked", ch!.id, { kind, codeDelivery });
      return reply.status(201).send({ id: ch!.id, status: "pending", codeDelivery });
    },
  );

  r.post(
    "/me/channels/:id/verify",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        tags: ["notifications"],
        summary: "Confirm a channel with its code",
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ code: z.string().regex(/^\d{6}$/) }),
      },
    },
    async (req) => {
      const db = needDb(ctx);
      const [ch] = await db
        .select()
        .from(notificationChannels)
        .where(
          and(eq(notificationChannels.id, req.params.id), eq(notificationChannels.userId, req.auth!.userId)),
        );
      if (!ch || ch.status !== "pending" || !ch.verificationCodeHash)
        throw new HttpError(404, "CHANNEL_NOT_PENDING");
      if (!ch.verificationExpiresAt || ch.verificationExpiresAt < new Date())
        throw new HttpError(410, "CODE_EXPIRED");
      if (ch.verificationAttempts >= MAX_CODE_ATTEMPTS) throw new HttpError(429, "TOO_MANY_ATTEMPTS");
      if (sha256(ctx.pepper, req.body.code) !== ch.verificationCodeHash) {
        await db
          .update(notificationChannels)
          .set({ verificationAttempts: sql`${notificationChannels.verificationAttempts} + 1` })
          .where(eq(notificationChannels.id, ch.id));
        throw new HttpError(400, "CODE_INVALID");
      }
      await db
        .update(notificationChannels)
        .set({
          status: "active",
          verifiedAt: new Date(),
          verificationCodeHash: null,
          verificationExpiresAt: null,
        })
        .where(eq(notificationChannels.id, ch.id));
      await audit(db, req, "notifications.channel_verified", ch.id, { kind: ch.kind });
      return { id: ch.id, status: "active" };
    },
  );

  r.delete(
    "/me/channels/:id",
    {
      schema: {
        tags: ["notifications"],
        summary: "Unlink a channel",
        params: z.object({ id: z.string().uuid() }),
      },
    },
    async (req) => {
      const db = needDb(ctx);
      const res = await db
        .update(notificationChannels)
        .set({ status: "unlinked", unlinkedAt: new Date() })
        .where(
          and(eq(notificationChannels.id, req.params.id), eq(notificationChannels.userId, req.auth!.userId)),
        )
        .returning({ id: notificationChannels.id });
      if (!res.length) throw new HttpError(404, "CHANNEL_NOT_FOUND");
      await audit(db, req, "notifications.channel_unlinked", req.params.id);
      return { ok: true };
    },
  );

  r.post(
    "/me/devices",
    {
      schema: {
        tags: ["notifications"],
        summary: "Register a browser Web Push subscription",
        body: z.object({
          endpoint: z
            .string()
            .url()
            .max(2048)
            .refine(
              (u) => u.startsWith("https://") || ctx.env.NODE_ENV !== "production",
              "https endpoint required",
            ),
          keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(64) }),
        }),
      },
    },
    async (req, reply) => {
      const db = needDb(ctx);
      const b = req.body;
      const v = {
        userId: req.auth!.userId,
        kind: "webpush",
        endpoint: b.endpoint,
        p256dh: b.keys.p256dh,
        auth: b.keys.auth,
        userAgent: req.headers["user-agent"]?.slice(0, 256),
        revokedAt: null,
      };
      const [d] = await db
        .insert(deviceSubscriptions)
        .values(v)
        .onConflictDoUpdate({ target: deviceSubscriptions.endpoint, set: v })
        .returning({ id: deviceSubscriptions.id });
      await audit(db, req, "notifications.device_registered", d!.id);
      return reply.status(201).send({ id: d!.id });
    },
  );

  r.delete(
    "/me/devices/:id",
    {
      schema: {
        tags: ["notifications"],
        summary: "Revoke a push subscription",
        params: z.object({ id: z.string().uuid() }),
      },
    },
    async (req) => {
      const res = await needDb(ctx)
        .update(deviceSubscriptions)
        .set({ revokedAt: new Date() })
        .where(
          and(eq(deviceSubscriptions.id, req.params.id), eq(deviceSubscriptions.userId, req.auth!.userId)),
        )
        .returning({ id: deviceSubscriptions.id });
      if (!res.length) throw new HttpError(404, "DEVICE_NOT_FOUND");
      return { ok: true };
    },
  );

  r.post(
    "/me/notifications/test",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      schema: {
        tags: ["notifications"],
        summary: "Queue a clearly labeled [TEST] notification",
        body: z.object({ kind: z.enum(["webpush", "telegram", "email", "sms"]) }),
      },
    },
    async (req, reply) => {
      if (!ctx.notifier)
        throw new HttpError(
          503,
          "NOTIFIER_UNAVAILABLE",
          "Notification queue (Redis) is not configured for this API instance",
        );
      const id = await ctx.notifier.sendTest(req.auth!.userId, req.body.kind);
      if (!id) throw new HttpError(409, "NO_VERIFIED_CHANNEL", `No verified ${req.body.kind} channel`);
      return reply.status(202).send({ deliveryId: id });
    },
  );

  r.get(
    "/me/deliveries",
    {
      schema: {
        tags: ["notifications"],
        summary: "Delivery history with lifecycle state",
        querystring: z.object({ limit: Limit }),
      },
    },
    async (req) =>
      json({
        items: await needDb(ctx)
          .select()
          .from(notificationDeliveries)
          .where(eq(notificationDeliveries.userId, req.auth!.userId))
          .orderBy(desc(notificationDeliveries.createdAt))
          .limit(req.query.limit),
      }),
  );
};
