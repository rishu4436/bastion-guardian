import type { PublicClient } from "viem";
import { Redis } from "ioredis";
import { loadEnv } from "@bastion-guardian/config";
import { createDatabase, recordDeployments, recordTestnetDeployments } from "@bastion-guardian/db";
import { TESTNET_DEPLOYER, TESTNET_DEPLOYMENTS } from "@bastion-guardian/chain-registry";
import { loadLocalDeployment } from "@bastion-guardian/contracts";
import { createReadClient } from "@bastion-guardian/service-kit";
import { SolverCoordinator } from "@bastion-guardian/solver-coordinator";
import { NotificationDispatcher, providersFromEnv } from "@bastion-guardian/notification-dispatcher";
import { buildApp, type BuildOptions } from "./app.js";

const env = loadEnv();
const opts: BuildOptions = { env, logger: true };
if (env.REDIS_URL) opts.rateLimitRedis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 });
if (env.DATABASE_URL) {
  const db = createDatabase(env.DATABASE_URL);
  opts.db = db;
  opts.providers = providersFromEnv();
  opts.vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
  if (env.REDIS_URL)
    opts.notifier = new NotificationDispatcher(db, opts.providers, {
      redisUrl: env.REDIS_URL,
      appUrl: env.API_PUBLIC_ORIGIN,
    });
  // Real testnet deployments (Lasna, Base Sepolia, Unichain Sepolia) from the chain registry; idempotent upsert.
  await recordTestnetDeployments(db, TESTNET_DEPLOYMENTS, TESTNET_DEPLOYER);
  // LOCAL SIMULATION wiring (chain 31337). Read-only: the API never signs or sends transactions.
  if (env.LOCAL_RPC_URL && env.LOCAL_ADDRESSES) {
    const client = createReadClient(31337, env.LOCAL_RPC_URL) as PublicClient;
    const a = loadLocalDeployment(env.LOCAL_ADDRESSES);
    await recordDeployments(db, 31337, a, "local_simulation");
    opts.clients = { 31337: client };
    opts.coordinators = {
      31337: new SolverCoordinator(db, client, {
        chainId: 31337,
        solverLiquidityVault: a.solverLiquidityVault,
        solverQuoteManager: a.solverQuoteManager,
        policyRegistry: a.policyRegistry,
      }),
    };
  }
}
const app = await buildApp(opts);
try {
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => void app.close().then(() => process.exit(0)));
