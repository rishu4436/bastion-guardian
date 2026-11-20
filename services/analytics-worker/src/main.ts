import { createDatabase } from "@bastion-guardian/db";
import {
  createLogger,
  createReadClient,
  newStatus,
  onShutdown,
  runLoop,
  startHealthServer,
} from "@bastion-guardian/service-kit";
import { AnalyticsWorker, rpcBlockTimes } from "./worker.js";

/** LOCAL SIMULATION entry point (chain 31337). Read-only: never writes to any chain. */
const log = createLogger("analytics-worker");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const RPC = process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8645";
const worker = new AnalyticsWorker(
  createDatabase(process.env.DATABASE_URL),
  rpcBlockTimes({ 31337: createReadClient(31337, RPC) }),
);
const ac = new AbortController();
const status = newStatus("analytics-worker");
startHealthServer(Number(process.env.HEALTH_PORT ?? 9108), [status], 600_000);
onShutdown(() => ac.abort());
await runLoop(
  {
    name: "analytics-worker",
    intervalMs: 300_000,
    signal: ac.signal,
    logger: log,
    tick: () => worker.tick([31337]),
  },
  status,
);
