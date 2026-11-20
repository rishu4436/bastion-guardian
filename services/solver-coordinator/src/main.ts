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
import { SolverCoordinator } from "./coordinator.js";

/** LOCAL SIMULATION entry point. Quote intake is served by the API (POST /v1/solver/quotes); this loop reconciles. */
const log = createLogger("solver-coordinator");
const RPC = process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8645";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const a = loadLocalDeployment(process.env.LOCAL_ADDRESSES ?? "contracts/out-evidence/local/addresses.json");
const co = new SolverCoordinator(createDatabase(process.env.DATABASE_URL), createReadClient(31337, RPC), {
  chainId: 31337,
  solverLiquidityVault: a.solverLiquidityVault,
  solverQuoteManager: a.solverQuoteManager,
  policyRegistry: a.policyRegistry,
});
const ac = new AbortController();
const status = newStatus("solver-coordinator");
startHealthServer(Number(process.env.HEALTH_PORT ?? 9104), [status], 60_000);
onShutdown(() => ac.abort());
await runLoop(
  {
    name: "solver-coordinator",
    intervalMs: 5000,
    signal: ac.signal,
    logger: log,
    tick: async () => void (await co.tick()),
  },
  status,
);
