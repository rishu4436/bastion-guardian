/**
 * Boots, in the Node context (outside jsdom), the real API over a private anvil chain with the LOCAL SIMULATION
 * deployment, an isolated Postgres database and the indexer / risk-observer / guardian-health services. A crash and
 * rescue is executed up front so receipts, proofs and solver fills exist. Nothing touches a public network.
 */
import type { TestProject } from "vitest/node";
import { buildApp } from "@bastion-guardian/api/app";
import { loadEnv } from "@bastion-guardian/config";
import { LOCAL_FIXTURE_PROTOCOL_ID, probePostgres } from "@bastion-guardian/db";
import { GuardianHealthService } from "@bastion-guardian/guardian-health";
import { RiskObserverService } from "@bastion-guardian/risk-observer";
import { createTestEnv } from "@bastion/test-env";

export const ORIGIN = "http://localhost:3000";

export interface SdkStack {
  baseUrl: string;
  borrowerA: `0x${string}`;
  policyA: `0x${string}`;
}

declare module "vitest" {
  export interface ProvidedContext {
    sdkStack: SdkStack | null;
  }
}

export default async function setup(project: TestProject) {
  const pgUrl = await probePostgres();
  if (!pgUrl) {
    project.provide("sdkStack", null);
    return;
  }
  const env = await createTestEnv(pgUrl);
  const a = env.stack.addresses;
  const c = env.stack.public;
  const observer = new RiskObserverService(env.db, c, null, {
    chainId: 31337,
    rpcUrl: env.stack.rpcUrl,
    protocolId: LOCAL_FIXTURE_PROTOCOL_ID,
    riskObserver: a.riskObserver,
  });
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
  await observer.tick();
  await health.tick();
  await env.crashAndRescue();
  await observer.tick();
  await health.tick();
  const app = await buildApp({
    env: loadEnv({
      NODE_ENV: "test",
      API_PUBLIC_ORIGIN: ORIGIN,
      SESSION_SECRET: "sdk-test-".padEnd(40, "x"),
    }),
    db: env.db,
    clients: { 31337: c },
    sseIntervalMs: 100,
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  project.provide("sdkStack", {
    baseUrl: `http://127.0.0.1:${port}`,
    borrowerA: a.borrowerA,
    policyA: a.policyA.toLowerCase() as `0x${string}`,
  });
  return async () => {
    await app.close();
    await env.close();
  };
}
