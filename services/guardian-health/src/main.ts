import { createDatabase } from "@bastion-guardian/db";
import { loadLocalDeployment } from "@bastion-guardian/contracts";
import {
  createLogger,
  createReadClient,
  newStatus,
  onShutdown,
  runLoop,
  startHealthServer,
} from "@bastion-guardian/service-kit";
import { GuardianHealthService } from "./health.js";

/** LOCAL SIMULATION entry point (chain 31337 plays destination, reserve and Reactive). Read-only. */
const log = createLogger("guardian-health");
const RPC = process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8645";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const a = loadLocalDeployment(process.env.LOCAL_ADDRESSES ?? "contracts/out-evidence/local/addresses.json");
const client = createReadClient(31337, RPC);
const svc = new GuardianHealthService(
  createDatabase(process.env.DATABASE_URL),
  { destination: client, reactive: client, reserve: client },
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
  },
  log,
);
const ac = new AbortController();
const status = newStatus("guardian-health");
startHealthServer(Number(process.env.HEALTH_PORT ?? 9103), [status], 120_000);
onShutdown(() => ac.abort());
await runLoop(
  {
    name: "guardian-health",
    intervalMs: 15_000,
    signal: ac.signal,
    logger: log,
    tick: async () => void (await svc.tick()),
  },
  status,
);
