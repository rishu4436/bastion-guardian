/**
 * Playwright harness (TEST ONLY, never deployed): boots a private anvil chain with the LOCAL SIMULATION deployment, an
 * isolated Postgres database, the indexer, guardian-health, analytics and the real API on 127.0.0.1:4100. A side
 * channel on 4101 exposes harness controls (verification codes captured by a fixture Telegram provider, re-evaluate).
 */
import { createServer } from "node:http";
import { buildApp } from "@bastion-guardian/api/app";
import { loadEnv } from "@bastion-guardian/config";
import { LOCAL_FIXTURE_PROTOCOL_ID } from "@bastion-guardian/db";
import { GuardianHealthService } from "@bastion-guardian/guardian-health";
import { RiskObserverService } from "@bastion-guardian/risk-observer";
import { AnalyticsWorker, rpcBlockTimes, utcDay } from "@bastion-guardian/analytics-worker";
import { SolverCoordinator } from "@bastion-guardian/solver-coordinator";
import {
  NotificationDispatcher,
  type NotificationProvider,
  type RenderedMessage,
} from "@bastion-guardian/notification-dispatcher";
import { createTestEnv } from "@bastion/test-env";

const pg = process.env.TEST_DATABASE_URL ?? "postgres://bastion:bastion_local_only@127.0.0.1:5432/bastion";
const redisUrl = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6379";
const WEB = process.env.E2E_WEB_ORIGIN ?? "http://127.0.0.1:3100";

const env = await createTestEnv(pg);
const a = env.stack.addresses;
const c = env.stack.public;
const health = new GuardianHealthService(
  env.db,
  { destination: c, reactive: c, reserve: c },
  {
    chainId: 31337,
    policyRegistry: a.policyRegistry,
    flashRescueExecutor: a.flashRescueExecutor,
    solverLiquidityVault: a.solverLiquidityVault,
    solverRegistry: a.solverRegistry,
    emergency: a.emergency,
    reactiveCore: a.reactiveCore,
    callbackDebtors: [
      { proxy: a.destCallbackProxy, debtor: a.callbackRouter },
      { proxy: a.reserveCallbackProxy, debtor: a.reserveEscrow },
    ],
    protectionVault: a.protectionVault,
    heartbeatMaxAgeSec: 3600,
  },
);
const observer = new RiskObserverService(env.db, c, null, {
  chainId: 31337,
  rpcUrl: env.stack.rpcUrl,
  protocolId: LOCAL_FIXTURE_PROTOCOL_ID,
  riskObserver: a.riskObserver,
});
await observer.tick();
await health.tick();
await env.crashAndRescue();
await observer.tick();
await health.tick();
const block = await c.getBlock();
await new AnalyticsWorker(env.db, rpcBlockTimes({ 31337: c })).computeDay(
  utcDay(new Date(Number(block.timestamp) * 1000)),
  31337,
);

const codes: string[] = [];
const telegram: NotificationProvider = {
  kind: "telegram",
  configured: true,
  async send(_to: string, msg: RenderedMessage) {
    const m = /code: (\d{6})/.exec(msg.body);
    if (m) codes.push(m[1]!);
    return { providerMessageId: `fixture-${Date.now()}` };
  },
};
const providers = { telegram };
const dispatcher = new NotificationDispatcher(env.db, providers, {
  redisUrl,
  queueName: `bastion-e2e-${process.pid}`,
  appUrl: WEB,
  backoffMs: 50,
});
dispatcher.startWorker();

const app = await buildApp({
  env: loadEnv({
    NODE_ENV: "test",
    API_PUBLIC_ORIGIN: WEB,
    SIWE_DOMAIN: new URL(WEB).host,
    ADMIN_ADDRESSES: a.gov,
    SESSION_SECRET: "e2e-only-".padEnd(40, "x"),
  }),
  db: env.db,
  clients: { 31337: c },
  coordinators: {
    31337: new SolverCoordinator(env.db, c, {
      chainId: 31337,
      solverLiquidityVault: a.solverLiquidityVault,
      solverQuoteManager: a.solverQuoteManager,
      policyRegistry: a.policyRegistry,
    }),
  },
  providers,
  notifier: dispatcher,
  sseIntervalMs: 300,
});
await app.listen({ host: "127.0.0.1", port: 4100 });

createServer(async (req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.url === "/ready")
    return res.end(JSON.stringify({ ok: true, policyA: a.policyA, policyB: a.policyB }));
  if (req.url === "/codes") return res.end(JSON.stringify({ codes }));
  if (req.url === "/evaluate" && req.method === "POST") {
    await observer.tick();
    const r = await health.tick();
    return res.end(JSON.stringify({ evaluated: r.length }));
  }
  res.statusCode = 404;
  res.end("{}");
}).listen(4101, "127.0.0.1");

const stop = async () => {
  await app.close();
  await dispatcher.close();
  await env.close();
  process.exit(0);
};
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
console.log("e2e stack ready");
