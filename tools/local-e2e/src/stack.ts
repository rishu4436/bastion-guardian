/**
 * LOCAL SIMULATION test harness: boots a private anvil (chain 31337, random localhost port) preloaded with the full
 * BASTION stack from contracts/script/LocalSimulationDeploy.s.sol, so service integration tests run against the real
 * contracts. The deployed state is cached (anvil_dumpState) and invalidated whenever the deploy script's compiled
 * bytecode changes. Never connects to a non-local RPC.
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Address,
  type Hex,
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  publicActions,
  type PublicClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import {
  bastionRiskObserverAbi,
  fixtureOracleAbi,
  parseLocalDeployment,
  type LocalDeployment,
} from "@bastion-guardian/contracts";
import { LocalReactiveRelay } from "./relay.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "../../..");
const CONTRACTS = join(REPO_ROOT, "contracts");
const CACHE = join(CONTRACTS, "out-evidence/local/stack-cache.json");
const SYSTEM = "0x8888888888888888888888888888888888888888";

/** Anvil's PUBLICLY KNOWN development keys. Valueless outside a local devnet. */
export const DEV_KEYS = {
  gov: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  borrowerA: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  solver: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  lp: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  keeper: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  borrowerB: "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
} as const satisfies Record<string, Hex>;

function foundryBin(name: string): string {
  const p = join(process.env.HOME ?? "", ".foundry/bin", name);
  return existsSync(p) ? p : name;
}

async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      s.close(() => (typeof a === "object" && a ? res(a.port) : rej(new Error("no port"))));
    });
  });
}

async function startAnvil(port: number): Promise<ChildProcess> {
  const p = spawn(foundryBin("anvil"), ["--chain-id", "31337", "--port", String(port), "--silent"], {
    stdio: "ignore",
  });
  const rpc = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (r.ok) return p;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  p.kill();
  throw new Error("anvil did not start");
}

async function rpcCall(rpc: string, method: string, params: unknown[]): Promise<unknown> {
  const r = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = (await r.json()) as { result?: unknown; error?: { message: string } };
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

function artifactFingerprint(): string {
  const f = join(CONTRACTS, "out/LocalSimulationDeploy.s.sol/LocalSimulationDeploy.json");
  if (!existsSync(f))
    execFileSync(foundryBin("forge"), ["build", "--quiet"], { cwd: CONTRACTS, stdio: "inherit" });
  return createHash("sha256").update(readFileSync(f)).digest("hex");
}

interface Cache {
  fingerprint: string;
  state: Hex;
  addresses: unknown;
}

async function buildCache(fingerprint: string): Promise<Cache> {
  const port = await freePort();
  const anvil = await startAnvil(port);
  const rpc = `http://127.0.0.1:${port}`;
  try {
    const sys = JSON.parse(
      readFileSync(join(CONTRACTS, "out/MockReactiveSystem.sol/MockReactiveSystem.json"), "utf8"),
    ) as { deployedBytecode: { object: Hex } };
    await rpcCall(rpc, "anvil_setCode", [SYSTEM, sys.deployedBytecode.object]);
    execFileSync(
      foundryBin("forge"),
      ["script", "script/LocalSimulationDeploy.s.sol", "--rpc-url", rpc, "--broadcast", "-q"],
      { cwd: CONTRACTS, stdio: ["ignore", "ignore", "inherit"] },
    );
    const addresses = JSON.parse(readFileSync(join(CONTRACTS, "out-evidence/local/addresses.json"), "utf8"));
    const state = (await rpcCall(rpc, "anvil_dumpState", [])) as Hex;
    const cache = { fingerprint, state, addresses };
    mkdirSync(dirname(CACHE), { recursive: true });
    writeFileSync(CACHE, JSON.stringify(cache));
    return cache;
  } finally {
    anvil.kill();
  }
}

/** Cross-process lock (exclusive mkdir) so parallel test files never run two deployments into the same cache. */
async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const lock = `${CACHE}.lock`;
  mkdirSync(dirname(CACHE), { recursive: true });
  const deadline = Date.now() + 300_000;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${lock}`);
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

export interface LocalStack {
  rpcUrl: string;
  addresses: LocalDeployment;
  public: PublicClient;
  test: ReturnType<typeof makeTest>;
  wallet: ReturnType<typeof makeWallet>;
  accounts: Record<keyof typeof DEV_KEYS, PrivateKeyAccount>;
  relay: LocalReactiveRelay;
  /** Sets the fixture oracle fWETH price (8-decimals USD) as governance. */
  setWethPrice(price: bigint): Promise<void>;
  /** Permissionless RiskObserver.observe(policyId) from the keeper. */
  observe(policyId: Hex): Promise<void>;
  /** Plays Reactive: relays every subscribed log in [from, to] through react() and delivers callbacks. */
  relayRange(from: bigint, to: bigint): Promise<number>;
  mine(blocks?: number): Promise<void>;
  stop(): Promise<void>;
}

const makeTest = (rpc: string) =>
  createTestClient({ chain: foundry, mode: "anvil", transport: http(rpc) }).extend(publicActions);
const makeWallet = (rpc: string) => createWalletClient({ chain: foundry, transport: http(rpc) });

export async function startLocalStack(): Promise<LocalStack> {
  const fp = artifactFingerprint();
  let cache: Cache | null = null;
  if (existsSync(CACHE)) {
    const c = JSON.parse(readFileSync(CACHE, "utf8")) as Cache;
    if (c.fingerprint === fp) cache = c;
  }
  cache ??= await withLock(async () => {
    // Another test process may have built it while we waited.
    if (existsSync(CACHE)) {
      const c = JSON.parse(readFileSync(CACHE, "utf8")) as Cache;
      if (c.fingerprint === fp) return c;
    }
    return buildCache(fp);
  });
  const port = await freePort();
  const anvil = await startAnvil(port);
  const rpcUrl = `http://127.0.0.1:${port}`;
  await rpcCall(rpcUrl, "anvil_loadState", [cache.state]);
  const addresses = parseLocalDeployment(cache.addresses);
  const pub = createPublicClient({
    chain: foundry,
    transport: http(rpcUrl),
    cacheTime: 0,
    pollingInterval: 50,
  }) as PublicClient;
  const test = makeTest(rpcUrl);
  const wallet = makeWallet(rpcUrl);
  const accounts = Object.fromEntries(
    Object.entries(DEV_KEYS).map(([k, v]) => [k, privateKeyToAccount(v)]),
  ) as LocalStack["accounts"];
  const relay = new LocalReactiveRelay(
    { public: pub as never, test: test as never, wallet: wallet as never, relayer: accounts.keeper.address },
    addresses.reactiveCore,
    {
      [addresses.callbackRouter]: addresses.destCallbackProxy,
      [addresses.reserveEscrow]: addresses.reserveCallbackProxy,
    },
  );
  const wait = async (hash: Hex) => {
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`tx reverted ${hash}`);
  };
  return {
    rpcUrl,
    addresses,
    public: pub,
    test,
    wallet,
    accounts,
    relay,
    async setWethPrice(price) {
      await wait(
        await wallet.writeContract({
          account: accounts.gov,
          chain: foundry,
          address: addresses.fixtureOracle,
          abi: fixtureOracleAbi,
          functionName: "setAssetPrice",
          args: [addresses.fWETH, price],
        }),
      );
    },
    async observe(policyId) {
      await wait(
        await wallet.writeContract({
          account: accounts.keeper,
          chain: foundry,
          address: addresses.riskObserver,
          abi: bastionRiskObserverAbi,
          functionName: "observe",
          args: [policyId],
        }),
      );
    },
    async relayRange(from, to) {
      const logs = await relay.collect(from, to);
      let delivered = 0;
      for (const l of logs) {
        const r = await relay.react(l, 31337n);
        if (r.callback) {
          const d = await relay.deliver(r.callback);
          if (d.success) delivered++;
        }
      }
      return delivered;
    },
    async mine(blocks = 1) {
      await test.mine({ blocks });
    },
    async stop() {
      anvil.kill();
    },
  };
}

export type { Address };
