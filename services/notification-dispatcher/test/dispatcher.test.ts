import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { Redis } from "ioredis";
import { generateVAPIDKeys } from "web-push";
import {
  deviceSubscriptions,
  notificationChannels,
  notificationDeliveries,
  notificationPreferences,
  users,
  walletIdentities,
} from "@bastion-guardian/db";
import { createTestEnv, probePostgres, type TestEnv } from "@bastion/test-env";
import {
  EmailProvider,
  NotificationDispatcher,
  SmsProvider,
  TelegramProvider,
  WebPushProvider,
} from "../src/index.js";
import { fakeSubscription, startFixtureServer } from "./fixture-server.js";

const pgUrl = await probePostgres();
const redisUrl = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6379";
async function probeRedis(): Promise<boolean> {
  const r = new Redis(redisUrl, { lazyConnect: true, connectTimeout: 1500, maxRetriesPerRequest: 0 });
  try {
    await r.connect();
    return (await r.ping()) === "PONG";
  } catch (e) {
    if (process.env.REQUIRE_INTEGRATION_INFRA === "true")
      throw new Error(`Redis required but unreachable: ${String(e)}`);
    return false;
  } finally {
    r.disconnect();
  }
}
const redisOk = await probeRedis();

const waitFor = async (fn: () => Promise<boolean>, ms = 15_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("timeout");
};

describe.skipIf(!pgUrl || !redisOk)(
  "notification-dispatcher (LOCAL SIMULATION: anvil + Postgres + Redis/BullMQ)",
  () => {
    let env: TestEnv;
    let fx: Awaited<ReturnType<typeof startFixtureServer>>;
    let d: NotificationDispatcher;
    let userA: string;
    let userB: string;

    beforeAll(async () => {
      [env, fx] = await Promise.all([createTestEnv(pgUrl!), startFixtureServer()]);
      const db = env.db;
      [{ id: userA }, { id: userB }] = (await db
        .insert(users)
        .values([{ displayName: "A" }, { displayName: "B" }])
        .returning({ id: users.id })) as [{ id: string }, { id: string }];
      await db.insert(walletIdentities).values([
        { userId: userA, address: env.stack.addresses.borrowerA.toLowerCase(), firstVerifiedChainId: 31337 },
        { userId: userB, address: env.stack.addresses.borrowerB.toLowerCase(), firstVerifiedChainId: 31337 },
      ]);
      const v = new Date();
      await db.insert(notificationChannels).values([
        { userId: userA, kind: "telegram", destination: "1001", status: "active", verifiedAt: v },
        { userId: userA, kind: "email", destination: "a@example.com", status: "active", verifiedAt: v },
        { userId: userA, kind: "sms", destination: "+919876543210", status: "pending" }, // unverified → never used
        { userId: userB, kind: "sms", destination: "+919800000000", status: "active", verifiedAt: v },
      ]);
      const sub = await fakeSubscription(`${fx.url}/push/a1`);
      await db.insert(deviceSubscriptions).values({
        userId: userA,
        kind: "webpush",
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
      });
      // B only wants critical alerts.
      await db.insert(notificationPreferences).values({ userId: userB, minSeverity: "critical" });
      d = new NotificationDispatcher(
        db,
        {
          telegram: new TelegramProvider("1:t", fx.url),
          email: new EmailProvider("re_x", "alerts@bastion.local", fx.url),
          sms: new SmsProvider("AC1", "tok", "+15550001111", fx.url),
          webpush: new WebPushProvider({ subject: "mailto:ops@bastion.local", ...generateVAPIDKeys() }),
        },
        {
          redisUrl,
          queueName: `bastion-test-${randomBytes(4).toString("hex")}`,
          appUrl: "http://localhost:3000",
          backoffMs: 50,
          attempts: 3,
        },
      );
      d.startWorker();
    }, 240_000);
    afterAll(async () => {
      await d?.close();
      await fx?.close();
      await env?.close();
    });

    it("fans verified rescue events out to verified channels, respecting preferences, exactly once", async () => {
      await env.crashAndRescue();
      const head = await env.stack.public.getBlockNumber();
      const since = new Date(Date.now() - 3600_000);
      const r1 = await d.produce(31337, head, since);
      expect(r1.queued).toBeGreaterThan(0);
      const r2 = await d.produce(31337, head, since);
      expect(r2).toEqual({ queued: 0, suppressed: 0 }); // dedup
      await waitFor(async () =>
        (await env.db.select().from(notificationDeliveries)).every((x) => x.state !== "queued"),
      );
      const rows = await env.db.select().from(notificationDeliveries);
      const a = rows.filter((x) => x.userId === userA);
      // A: risk.trigger_crossed + rescue.executed (+ settlement acknowledgments produce no events) × telegram/email/webpush.
      expect(new Set(a.map((x) => x.channelKind))).toEqual(new Set(["telegram", "email", "webpush"]));
      expect(a.every((x) => x.state === "provider_accepted")).toBe(true);
      expect(a.some((x) => x.eventType === "rescue.executed")).toBe(true);
      // B wants critical only → warnings recorded as suppressed, nothing sent by SMS.
      const b = rows.filter((x) => x.userId === userB);
      expect(b.length).toBeGreaterThan(0);
      expect(b.every((x) => x.state === "suppressed" && x.lastError === "BELOW_MIN_SEVERITY")).toBe(true);
      expect(fx.captured.some((c) => c.path.endsWith("Messages.json"))).toBe(false);
      // Telegram (authenticated channel) carries the exact repaid amount from the verified execution row.
      const tg = fx.captured
        .filter((c) => c.path.includes("sendMessage"))
        .map((c) => JSON.parse(c.body.toString()).text as string);
      expect(tg.some((t) => t.includes("2800010200"))).toBe(true);
      // Local anvil finality depth 2: events within 2 blocks of head are flagged observed, older confirmed.
      expect(rows.every((x) => ["observed", "confirmed"].includes(x.eventConfirmation))).toBe(true);
    }, 120_000);

    it("retries transient provider failures, then succeeds", async () => {
      fx.failNext(503, 1);
      const id = await d.sendTest(userA, "telegram");
      await waitFor(
        async () =>
          (await env.db.select().from(notificationDeliveries).where(eq(notificationDeliveries.id, id!)))[0]!
            .state === "provider_accepted",
      );
      const [row] = await env.db
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.id, id!));
      expect(row!.isTest).toBe(true);
      expect(row!.attempts).toBe(2);
    }, 60_000);

    it("permanent failures dead-letter without retry", async () => {
      fx.failNext(400, 5);
      const id = await d.sendTest(userA, "email");
      await waitFor(
        async () =>
          (await env.db.select().from(notificationDeliveries).where(eq(notificationDeliveries.id, id!)))[0]!
            .state === "dead_letter",
      );
      const [row] = await env.db
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.id, id!));
      expect(row!.attempts).toBe(1);
      expect(row!.lastError).toMatch(/HTTP 400/);
      fx.failNext(0, 0);
    }, 60_000);
  },
);
