import { createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { loadLocalDeployment } from "@bastion-guardian/contracts";
import {
  createLogger,
  createReadClient,
  newStatus,
  onShutdown,
  runLoop,
  startHealthServer,
} from "@bastion-guardian/service-kit";
import type { DemandItem, SolverQuote } from "@bastion-guardian/solver-coordinator";
import { SolverNode } from "./node.js";

/**
 * LOCAL SIMULATION reference solver. Talks to the BASTION API (BASTION_API_URL) for demand and quote submission.
 * SOLVER_PRIVATE_KEY must be a local dev key supplied via the environment; never commit keys.
 */
const log = createLogger("solver-node");
const RPC = process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8645";
const API = process.env.BASTION_API_URL ?? "http://127.0.0.1:4000";
const key = process.env.SOLVER_PRIVATE_KEY as Hex | undefined;
if (!key) throw new Error("SOLVER_PRIVATE_KEY is required (local dev key only)");
const a = loadLocalDeployment(process.env.LOCAL_ADDRESSES ?? "contracts/out-evidence/local/addresses.json");
const account = privateKeyToAccount(key);
const big = (v: unknown) => BigInt(String(v));
const node = new SolverNode(
  createReadClient(31337, RPC),
  createWalletClient({ chain: foundry, transport: http(RPC) }),
  {
    async demand() {
      const r = await fetch(`${API}/v1/solver/demand?chainId=31337`);
      if (!r.ok) throw new Error(`demand ${r.status}`);
      const j = (await r.json()) as { items: Record<string, unknown>[] };
      return j.items.map((x) => ({
        ...x,
        requiredRepayAtTrigger: big(x.requiredRepayAtTrigger),
        committedCoverage: big(x.committedCoverage),
        shortfall: big(x.shortfall),
        evaluatedAt: new Date(String(x.evaluatedAt)),
      })) as DemandItem[];
    },
  },
  {
    async submitQuote(q: SolverQuote, signature: Hex) {
      const r = await fetch(`${API}/v1/solver/quotes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quote: q, signature }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
      });
      if (!r.ok) throw new Error(`quote ${r.status}: ${await r.text()}`);
      return ((await r.json()) as { id: string }).id;
    },
  },
  {
    chainId: 31337,
    rpcUrl: RPC,
    solverLiquidityVault: a.solverLiquidityVault,
    account,
    limits: {
      tokens: [a.fUSDC],
      maxPerPolicy: BigInt(process.env.SOLVER_MAX_PER_POLICY ?? "10000000000"),
      maxTotalCommitted: BigInt(process.env.SOLVER_MAX_TOTAL ?? "40000000000"),
      feeBps: Number(process.env.SOLVER_FEE_BPS ?? "50"),
      commitmentTtlSec: Number(process.env.SOLVER_COMMITMENT_TTL ?? "86400"),
      minCommit: BigInt(process.env.SOLVER_MIN_COMMIT ?? "1000000"),
    },
  },
  log,
);
const ac = new AbortController();
const status = newStatus("solver-node");
startHealthServer(Number(process.env.HEALTH_PORT ?? 9105), [status], 120_000);
onShutdown(() => ac.abort());
await runLoop(
  {
    name: "solver-node",
    intervalMs: 10_000,
    signal: ac.signal,
    logger: log,
    tick: async () => void (await node.tick()),
  },
  status,
);
