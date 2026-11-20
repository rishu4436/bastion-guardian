import { createServer, type Server } from "node:http";
import { createPublicClient, http, type Chain, type PublicClient } from "viem";
import { baseSepolia, foundry, unichainSepolia } from "viem/chains";
import { createLogger, type Logger } from "@bastion-guardian/observability";

/** Chains BASTION services may talk to. Mainnets are deliberately absent (Section 2: mainnet disabled by default). */
export const ALLOWED_CHAINS: Record<number, { chain: Chain; local: boolean }> = {
  31337: { chain: foundry, local: true },
  84532: { chain: baseSepolia, local: false },
  1301: { chain: unichainSepolia, local: false },
  5318007: {
    chain: {
      id: 5318007,
      name: "Reactive Lasna",
      nativeCurrency: { name: "REACT", symbol: "REACT", decimals: 18 },
      rpcUrls: { default: { http: ["https://lasna-rpc.rnk.dev/"] } },
    },
    local: false,
  },
};

export class ChainNotAllowedError extends Error {}

/**
 * Read clients are allowed for every chain in ALLOWED_CHAINS. Transaction-sending services must additionally call
 * `assertWriteAllowed`: writes are permitted on the local devnet only, unless ENABLE_LIVE_EXECUTION=true was set by the
 * operator for an allowlisted testnet. Mainnet is never permitted.
 */
export function chainFor(chainId: number): Chain {
  const c = ALLOWED_CHAINS[chainId];
  if (!c) throw new ChainNotAllowedError(`chain ${chainId} is not allowlisted (mainnet is disabled)`);
  return c.chain;
}

export function assertWriteAllowed(
  chainId: number,
  rpcUrl: string,
  env: Record<string, string | undefined> = process.env,
) {
  const c = ALLOWED_CHAINS[chainId];
  if (!c) throw new ChainNotAllowedError(`chain ${chainId} is not allowlisted`);
  if (c.local) {
    if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(rpcUrl))
      throw new ChainNotAllowedError(`local chain must use a localhost RPC, got ${rpcUrl}`);
    return;
  }
  if (env.ENABLE_LIVE_EXECUTION !== "true")
    throw new ChainNotAllowedError(
      `writes to chain ${chainId} require ENABLE_LIVE_EXECUTION=true (owner authorization)`,
    );
}

export function createReadClient(chainId: number, rpcUrl: string): PublicClient {
  return createPublicClient({
    chain: chainFor(chainId),
    transport: http(rpcUrl),
    cacheTime: 0,
  }) as PublicClient;
}

export interface LoopOptions {
  name: string;
  intervalMs: number;
  tick: () => Promise<void>;
  logger?: Logger;
  signal?: AbortSignal;
  /** Max consecutive failures before backoff caps; the loop never exits on error. */
  maxBackoffMs?: number;
}

export interface LoopStatus {
  name: string;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  ticks: number;
}

/** Runs `tick` forever with exponential backoff on error; resolves when `signal` aborts. */
export async function runLoop(o: LoopOptions, status?: LoopStatus): Promise<void> {
  const log = o.logger ?? createLogger(o.name);
  const st = status ?? newStatus(o.name);
  const maxBackoff = o.maxBackoffMs ?? 60_000;
  while (!o.signal?.aborted) {
    let delay = o.intervalMs;
    try {
      await o.tick();
      st.lastSuccessAt = Date.now();
      st.consecutiveFailures = 0;
    } catch (e) {
      st.lastErrorAt = Date.now();
      st.lastError = e instanceof Error ? e.message : String(e);
      st.consecutiveFailures++;
      delay = Math.min(maxBackoff, o.intervalMs * 2 ** Math.min(st.consecutiveFailures, 10));
      log.error({ err: st.lastError, failures: st.consecutiveFailures }, "tick failed");
    }
    st.ticks++;
    await sleep(delay, o.signal);
  }
}

export function newStatus(name: string): LoopStatus {
  return { name, lastSuccessAt: null, lastErrorAt: null, lastError: null, consecutiveFailures: 0, ticks: 0 };
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((res) => {
    if (signal?.aborted) return res();
    const t = setTimeout(res, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), res()), { once: true });
  });
}

/** Minimal liveness/readiness endpoint: GET /healthz → 200 when the last tick succeeded within `staleMs`. */
export function startHealthServer(port: number, statuses: LoopStatus[], staleMs: number): Server {
  const s = createServer((req, res) => {
    if (req.url !== "/healthz") {
      res.statusCode = 404;
      return res.end();
    }
    const now = Date.now();
    const healthy = statuses.every((x) => x.lastSuccessAt !== null && now - x.lastSuccessAt < staleMs);
    res.statusCode = healthy ? 200 : 503;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ healthy, loops: statuses }));
  });
  s.listen(port, "127.0.0.1");
  return s;
}

/** JSON with bigint → decimal string (exact). */
export function toJsonSafe<T>(v: T): unknown {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
}

export function onShutdown(fn: () => void | Promise<void>) {
  const h = () => void Promise.resolve(fn()).finally(() => process.exit(0));
  process.once("SIGINT", h);
  process.once("SIGTERM", h);
}

export { createLogger, type Logger };
