import { createDatabase, seedLocalSimulation, seedReferenceData } from "@bastion-guardian/db";
import { loadLocalDeployment } from "@bastion-guardian/contracts";
import {
  createReadClient,
  createLogger,
  newStatus,
  onShutdown,
  runLoop,
  startHealthServer,
} from "@bastion-guardian/service-kit";
import { ChainIndexer } from "./indexer.js";
import { localContracts } from "./config.js";

/**
 * Entry point. Phase 3 (testnet) wiring needs the deployment registry produced by an authorized broadcast; until then
 * only the LOCAL SIMULATION stack (chain 31337) is supported here.
 */
const log = createLogger("chain-indexer");
const DATABASE_URL = process.env.DATABASE_URL;
const RPC = process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8645";
const ADDRS = process.env.LOCAL_ADDRESSES ?? "contracts/out-evidence/local/addresses.json";
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
const a = loadLocalDeployment(ADDRS);
const db = createDatabase(DATABASE_URL);
await seedReferenceData(db);
await seedLocalSimulation(db, { fixtureMarket: a.fixtureMarket });
const indexer = new ChainIndexer(db, createReadClient(31337, RPC), {
  chainId: 31337,
  contracts: localContracts(a),
  startBlock: BigInt(process.env.INDEXER_START_BLOCK ?? "0"),
  reserveChainId: 31337,
});
const ac = new AbortController();
const status = newStatus("chain-indexer");
startHealthServer(Number(process.env.HEALTH_PORT ?? 9101), [status], 60_000);
onShutdown(() => ac.abort());
log.info({ rpc: RPC }, "starting (LOCAL SIMULATION)");
await runLoop(
  {
    name: "chain-indexer",
    intervalMs: 1000,
    signal: ac.signal,
    logger: log,
    tick: async () => void (await indexer.catchUp()),
  },
  status,
);
