import { createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { createDatabase, LOCAL_FIXTURE_PROTOCOL_ID } from "@bastion-guardian/db";
import { loadLocalDeployment } from "@bastion-guardian/contracts";
import {
  createLogger,
  createReadClient,
  newStatus,
  onShutdown,
  runLoop,
  startHealthServer,
} from "@bastion-guardian/service-kit";
import { RiskObserverService } from "./observer.js";

/** LOCAL SIMULATION entry point (chain 31337). KEEPER_PRIVATE_KEY must be a local dev key; never commit one. */
const log = createLogger("risk-observer");
const RPC = process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8645";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const a = loadLocalDeployment(process.env.LOCAL_ADDRESSES ?? "contracts/out-evidence/local/addresses.json");
const keeper = process.env.KEEPER_PRIVATE_KEY
  ? privateKeyToAccount(process.env.KEEPER_PRIVATE_KEY as Hex)
  : undefined;
const svc = new RiskObserverService(
  createDatabase(process.env.DATABASE_URL),
  createReadClient(31337, RPC),
  keeper ? createWalletClient({ chain: foundry, transport: http(RPC) }) : null,
  {
    chainId: 31337,
    rpcUrl: RPC,
    protocolId: LOCAL_FIXTURE_PROTOCOL_ID,
    riskObserver: a.riskObserver,
    keeper,
  },
  log,
);
const ac = new AbortController();
const status = newStatus("risk-observer");
startHealthServer(Number(process.env.HEALTH_PORT ?? 9102), [status], 60_000);
onShutdown(() => ac.abort());
await runLoop(
  {
    name: "risk-observer",
    intervalMs: 2000,
    signal: ac.signal,
    logger: log,
    tick: async () => void (await svc.tick()),
  },
  status,
);
