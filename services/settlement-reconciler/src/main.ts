import { createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
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
import { SettlementReconciler } from "./reconciler.js";

/** LOCAL SIMULATION entry point. RETRIER_PRIVATE_KEY (local dev key) enables permissionless retries. */
const log = createLogger("settlement-reconciler");
const RPC = process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8645";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const a = loadLocalDeployment(process.env.LOCAL_ADDRESSES ?? "contracts/out-evidence/local/addresses.json");
const retrier = process.env.RETRIER_PRIVATE_KEY
  ? privateKeyToAccount(process.env.RETRIER_PRIVATE_KEY as Hex)
  : undefined;
const rec = new SettlementReconciler(
  createDatabase(process.env.DATABASE_URL),
  createReadClient(31337, RPC),
  retrier ? createWalletClient({ chain: foundry, transport: http(RPC) }) : null,
  {
    reserveChainId: 31337,
    reserveRpcUrl: RPC,
    reserveEscrow: a.reserveEscrow,
    protectionVault: a.protectionVault,
    overdueAfterSec: 600,
    ackTimeoutSec: 600,
    retrier,
  },
  log,
);
const ac = new AbortController();
const status = newStatus("settlement-reconciler");
startHealthServer(Number(process.env.HEALTH_PORT ?? 9106), [status], 120_000);
onShutdown(() => ac.abort());
await runLoop(
  {
    name: "settlement-reconciler",
    intervalMs: 15_000,
    signal: ac.signal,
    logger: log,
    tick: async () => void (await rec.tick()),
  },
  status,
);
