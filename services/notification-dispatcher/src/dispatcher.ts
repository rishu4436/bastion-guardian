import { randomUUID } from "node:crypto";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { Queue, UnrecoverableError, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import {
  deviceSubscriptions,
  notificationChannels,
  notificationDeliveries,
  notificationPreferences,
  walletIdentities,
  type Database,
} from "@bastion-guardian/db";
import { createLogger, type Logger } from "@bastion-guardian/service-kit";
import { collectEvents, type NotificationEvent } from "./events.js";
import { DEFAULT_PREFERENCES, decide, type Preferences } from "./policy.js";
import { ProviderError, type ChannelKind, type NotificationProvider } from "./providers/types.js";
import { render } from "./render.js";

export interface DispatcherConfig {
  redisUrl: string;
  queueName?: string;
  appUrl: string;
  attempts?: number;
  backoffMs?: number;
}

interface StoredRefs {
  refs: Record<string, unknown>;
  facts: NotificationEvent["facts"];
  policyId: string | null;
  chainId: number;
}

export class NotificationDispatcher {
  readonly queue: Queue;
  private worker: Worker | null = null;
  private readonly log: Logger;
  private readonly connection: Redis;
  private readonly queueName: string;

  constructor(
    private readonly db: Database,
    private readonly providers: Partial<Record<ChannelKind, NotificationProvider>>,
    private readonly cfg: DispatcherConfig,
    logger?: Logger,
  ) {
    this.log = logger ?? createLogger("notification-dispatcher");
    this.connection = new Redis(cfg.redisUrl, { maxRetriesPerRequest: null });
    this.queueName = cfg.queueName ?? "bastion-notifications";
    this.queue = new Queue(this.queueName, { connection: this.connection });
  }

  private async prefs(userId: string): Promise<Preferences> {
    const [p] = await this.db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId));
    return p
      ? {
          minSeverity: p.minSeverity,
          quietHoursStart: p.quietHoursStart,
          quietHoursEnd: p.quietHoursEnd,
          timezone: p.timezone,
          escalateCritical: p.escalateCritical,
          privateLockScreen: p.privateLockScreen,
          eventOptOuts: p.eventOptOuts,
        }
      : DEFAULT_PREFERENCES;
  }

  /** Channel kinds the user can currently receive on (verified + active, or a live push subscription). */
  private async channelsFor(userId: string): Promise<{ kind: ChannelKind; channelId: string | null }[]> {
    const out: { kind: ChannelKind; channelId: string | null }[] = [];
    const chans = await this.db
      .select()
      .from(notificationChannels)
      .where(
        and(
          eq(notificationChannels.userId, userId),
          eq(notificationChannels.status, "active"),
          isNotNull(notificationChannels.verifiedAt),
        ),
      );
    for (const c of chans)
      if (c.kind === "telegram" || c.kind === "email" || c.kind === "sms")
        out.push({ kind: c.kind, channelId: c.id });
    const subs = await this.db
      .select({ id: deviceSubscriptions.id })
      .from(deviceSubscriptions)
      .where(
        and(
          eq(deviceSubscriptions.userId, userId),
          eq(deviceSubscriptions.kind, "webpush"),
          isNull(deviceSubscriptions.revokedAt),
        ),
      );
    if (subs.length) out.push({ kind: "webpush", channelId: null });
    return out;
  }

  /** Scans verified sources and enqueues one delivery per (event, channel kind). Idempotent by dedup key. */
  async produce(
    chainId: number,
    head: bigint,
    since: Date,
    now = new Date(),
  ): Promise<{ queued: number; suppressed: number }> {
    let queued = 0;
    let suppressed = 0;
    for (const e of await collectEvents(this.db, chainId, since, head)) {
      if (!e.owner) continue;
      const [ident] = await this.db
        .select()
        .from(walletIdentities)
        .where(eq(walletIdentities.address, e.owner));
      if (!ident) continue; // owner has no BASTION account: nothing to deliver to
      const p = await this.prefs(ident.userId);
      const verdict = decide(p, e.eventType, e.severity, now);
      for (const ch of await this.channelsFor(ident.userId)) {
        const r = await this.enqueue(ident.userId, ch, e, verdict.deliver ? null : verdict.reason, false);
        if (r === "queued") queued++;
        if (r === "suppressed") suppressed++;
      }
    }
    return { queued, suppressed };
  }

  /** User-initiated test notification on one channel kind; always labeled [TEST]. */
  async sendTest(userId: string, kind: ChannelKind): Promise<string | null> {
    const ch = (await this.channelsFor(userId)).find((c) => c.kind === kind);
    if (!ch) return null;
    const e: NotificationEvent = {
      dedupKey: `test:${randomUUID()}`,
      eventType: "test",
      severity: "info",
      chainId: 0,
      policyId: null,
      owner: null,
      sourceRefs: {},
      confirmation: "not_applicable",
      facts: { title: "Test notification", action: "No action needed." },
    };
    await this.enqueue(userId, ch, e, null, true);
    const [d] = await this.db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.dedupKey, e.dedupKey));
    return d?.id ?? null;
  }

  private async enqueue(
    userId: string,
    ch: { kind: ChannelKind; channelId: string | null },
    e: NotificationEvent,
    suppressReason: string | null,
    isTest: boolean,
  ): Promise<"queued" | "suppressed" | "duplicate"> {
    const refs: StoredRefs = { refs: e.sourceRefs, facts: e.facts, policyId: e.policyId, chainId: e.chainId };
    const [row] = await this.db
      .insert(notificationDeliveries)
      .values({
        dedupKey: e.dedupKey,
        userId,
        channelKind: ch.kind,
        channelId: ch.channelId,
        eventType: e.eventType,
        severity: e.severity,
        sourceRefs: refs,
        eventConfirmation: e.confirmation,
        isTest,
        state: suppressReason ? "suppressed" : "queued",
        lastError: suppressReason,
      })
      .onConflictDoNothing()
      .returning({ id: notificationDeliveries.id });
    if (!row) return "duplicate";
    if (suppressReason) return "suppressed";
    await this.queue.add(
      "deliver",
      { deliveryId: row.id },
      {
        jobId: row.id,
        attempts: this.cfg.attempts ?? 5,
        backoff: { type: "exponential", delay: this.cfg.backoffMs ?? 2000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    );
    return "queued";
  }

  /** Delivers one queued notification. Exposed for direct testing; the BullMQ worker calls it. */
  async deliver(deliveryId: string, attemptsMade = 0, maxAttempts = this.cfg.attempts ?? 5): Promise<void> {
    const [d] = await this.db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.id, deliveryId));
    if (!d || (d.state !== "queued" && d.state !== "failed")) return; // already handled (idempotent)
    const provider = this.providers[d.channelKind as ChannelKind];
    const fail = async (msg: string, finalState: "failed" | "dead_letter") =>
      this.db
        .update(notificationDeliveries)
        .set({
          state: finalState,
          lastError: msg.slice(0, 500),
          attempts: sql`${notificationDeliveries.attempts} + 1`,
        })
        .where(eq(notificationDeliveries.id, deliveryId));
    if (!provider || !provider.configured) {
      await fail("PROVIDER_NOT_CONFIGURED", "dead_letter");
      throw new UnrecoverableError("PROVIDER_NOT_CONFIGURED");
    }
    const p = await this.prefs(d.userId);
    const refs = d.sourceRefs as StoredRefs;
    const msg = render(
      {
        dedupKey: d.dedupKey,
        eventType: d.eventType,
        severity: d.severity,
        chainId: refs.chainId,
        policyId: refs.policyId,
        owner: null,
        sourceRefs: refs.refs,
        confirmation: d.eventConfirmation as NotificationEvent["confirmation"],
        facts: refs.facts,
      },
      { privateLockScreen: p.privateLockScreen, appUrl: this.cfg.appUrl, isTest: d.isTest },
    );
    const destinations: { dest: string; subId?: string }[] = [];
    if (d.channelKind === "webpush") {
      const subs = await this.db
        .select()
        .from(deviceSubscriptions)
        .where(
          and(
            eq(deviceSubscriptions.userId, d.userId),
            eq(deviceSubscriptions.kind, "webpush"),
            isNull(deviceSubscriptions.revokedAt),
          ),
        );
      for (const s of subs)
        destinations.push({
          dest: JSON.stringify({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }),
          subId: s.id,
        });
    } else if (d.channelId) {
      const [c] = await this.db
        .select()
        .from(notificationChannels)
        .where(eq(notificationChannels.id, d.channelId));
      if (c && c.status === "active") destinations.push({ dest: c.destination });
    }
    if (!destinations.length) {
      await fail("NO_DESTINATION", "dead_letter");
      throw new UnrecoverableError("NO_DESTINATION");
    }
    let ok = false;
    let messageId: string | null = null;
    let lastErr: unknown = null;
    for (const t of destinations) {
      try {
        const r = await provider.send(t.dest, msg);
        if (r.gone && t.subId) {
          await this.db
            .update(deviceSubscriptions)
            .set({ revokedAt: new Date() })
            .where(eq(deviceSubscriptions.id, t.subId));
          continue;
        }
        ok = true;
        messageId = r.providerMessageId ?? messageId;
      } catch (e) {
        lastErr = e;
      }
    }
    if (ok) {
      await this.db
        .update(notificationDeliveries)
        .set({
          state: "provider_accepted",
          providerMessageId: messageId,
          acceptedAt: new Date(),
          lastError: null,
          attempts: sql`${notificationDeliveries.attempts} + 1`,
        })
        .where(eq(notificationDeliveries.id, deliveryId));
      return;
    }
    const message = lastErr instanceof Error ? lastErr.message : "ALL_DESTINATIONS_GONE";
    const retryable = lastErr instanceof ProviderError ? lastErr.retryable : lastErr !== null;
    const final = !retryable || attemptsMade + 1 >= maxAttempts;
    await fail(message, final ? "dead_letter" : "failed");
    if (!retryable) throw new UnrecoverableError(message);
    throw lastErr instanceof Error ? lastErr : new Error(message);
  }

  startWorker(concurrency = 4): Worker {
    this.worker = new Worker(
      this.queueName,
      async (job: Job<{ deliveryId: string }>) =>
        this.deliver(job.data.deliveryId, job.attemptsMade, job.opts.attempts ?? 1),
      { connection: new Redis(this.cfg.redisUrl, { maxRetriesPerRequest: null }), concurrency },
    );
    this.worker.on("failed", (job, err) =>
      this.log.warn({ id: job?.id, err: err.message }, "delivery attempt failed"),
    );
    return this.worker;
  }

  async close() {
    await this.worker?.close();
    await this.queue.close();
    this.connection.disconnect();
  }
}
