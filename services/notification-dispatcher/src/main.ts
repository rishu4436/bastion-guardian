import { createDatabase } from "@bastion-guardian/db";
import {
  createLogger,
  createReadClient,
  newStatus,
  onShutdown,
  runLoop,
  startHealthServer,
} from "@bastion-guardian/service-kit";
import { NotificationDispatcher } from "./dispatcher.js";
import { providersFromEnv } from "./providers/index.js";

/**
 * Providers are configured from the environment (VAPID_*, TELEGRAM_BOT_TOKEN, EMAIL_API_KEY/EMAIL_FROM, TWILIO_*).
 * Missing credentials are reported at startup and those deliveries dead-letter with PROVIDER_NOT_CONFIGURED.
 */
const log = createLogger("notification-dispatcher");
if (!process.env.DATABASE_URL || !process.env.REDIS_URL)
  throw new Error("DATABASE_URL and REDIS_URL are required");
const chainId = Number(process.env.NOTIFY_CHAIN_ID ?? "31337");
const rpc = process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8645";
const providers = providersFromEnv();
for (const [k, p] of Object.entries(providers))
  if (!p.configured) log.warn({ channel: k }, "provider not configured (credentials missing)");
const d = new NotificationDispatcher(createDatabase(process.env.DATABASE_URL), providers, {
  redisUrl: process.env.REDIS_URL,
  appUrl: process.env.APP_PUBLIC_URL ?? "http://localhost:3000",
});
d.startWorker();
const client = createReadClient(chainId, rpc);
const ac = new AbortController();
const status = newStatus("notification-dispatcher");
startHealthServer(Number(process.env.HEALTH_PORT ?? 9107), [status], 120_000);
onShutdown(async () => {
  ac.abort();
  await d.close();
});
await runLoop(
  {
    name: "notification-dispatcher",
    intervalMs: 3000,
    signal: ac.signal,
    logger: log,
    tick: async () =>
      void (await d.produce(chainId, await client.getBlockNumber(), new Date(Date.now() - 24 * 3600_000))),
  },
  status,
);
