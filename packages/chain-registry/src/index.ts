import type { Address, SupportedChainId } from "@bastion-guardian/types";
import { TESTNET_DEPLOYMENTS } from "./deployments.js";

export * from "./deployments.js";

/**
 * Every address below is copied from an official source recorded in docs/integrations/VERIFIED-ADDRESSES.md
 * (verified 2026-11-20). BASTION's own testnet deployments live in ./deployments.ts and come only from real receipts
 * recorded under evidence/deployments/.
 */
export interface SourceRef {
  url: string;
  verifiedOn: string;
}

export interface ChainInfo {
  id: SupportedChainId;
  name: string;
  role: "destination-lending" | "reserve-settlement" | "reactive";
  nativeSymbol: string;
  rpcUrls: readonly string[];
  explorer: { name: string; url: string } | null;
  reactiveCallbackProxy: Address;
  callbackProxySource: SourceRef;
  /** Block-time note relevant for timers (hackathon rule: use timestamps on Base Sepolia). */
  blockTimeNote: string;
}

const REACTIVE_DOCS: SourceRef = {
  url: "https://dev.reactive.network/origins-and-destinations",
  verifiedOn: "2026-11-20",
};

export const CHAINS: Readonly<Record<SupportedChainId, ChainInfo>> = {
  84532: {
    id: 84532,
    name: "Base Sepolia",
    role: "destination-lending",
    nativeSymbol: "ETH",
    rpcUrls: ["https://sepolia.base.org"],
    explorer: { name: "BaseScan (Sepolia)", url: "https://sepolia.basescan.org" },
    reactiveCallbackProxy: "0x476F44b11F5C942c58f4c8E3d0300E5710743585",
    callbackProxySource: REACTIVE_DOCS,
    blockTimeNote: "200ms blocks since the Denim upgrade — use timestamps, not block counts.",
  },
  1301: {
    id: 1301,
    name: "Unichain Sepolia",
    role: "reserve-settlement",
    nativeSymbol: "ETH",
    rpcUrls: ["https://sepolia.unichain.org"],
    explorer: { name: "Uniscan (Sepolia)", url: "https://sepolia.uniscan.xyz" },
    reactiveCallbackProxy: "0x775c9B990ADe401060B78D0e98684eEf8d2466C1",
    callbackProxySource: REACTIVE_DOCS,
    blockTimeNote: "~1s blocks.",
  },
  5318007: {
    id: 5318007,
    name: "Reactive Lasna",
    role: "reactive",
    nativeSymbol: "REACT",
    rpcUrls: ["https://lasna-rpc.rnk.dev/"],
    explorer: { name: "Reactscan (Lasna)", url: "https://lasna.reactscan.net" },
    reactiveCallbackProxy: "0x8888888888888888888888888888888888888888",
    callbackProxySource: REACTIVE_DOCS,
    blockTimeNote: "Reactive Omni: ~1s blocks, CometBFT instant finality.",
  },
};

/** Reactive system contract (same address on Lasna and Reactive mainnet). */
export const REACTIVE_SYSTEM_CONTRACT: Address = "0x8888888888888888888888888888888888888888";
export const REACTIVE_IGNORE = 0xa65f96fc951c35ead38878e0f0b7a3c744a6f5ccc1476b313353ce31712313adn;

/** Official Aave V3 Base Sepolia deployment (aave-dao/aave-address-book, commit 6e03278). */
export const AAVE_V3_BASE_SEPOLIA = {
  source: {
    url: "https://github.com/aave-dao/aave-address-book/blob/6e0327854db38052b8f5d8962185b96b95c10d3d/src/AaveV3BaseSepolia.sol",
    verifiedOn: "2026-11-20",
  },
  poolAddressesProvider: "0xE4C23309117Aa30342BFaae6c95c6478e0A4Ad00",
  pool: "0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27",
  oracle: "0x943b0dE18d4abf4eF02A85912F8fc07684C141dF",
  poolDataProvider: "0xBc9f5b7E248451CdD7cA54e717a2BFe1F32b566b",
  uiPoolDataProvider: "0x3cB7B00B6C09B71998124196691e8bF2694De863",
  /** On-chain reads 2026-11-20: POOL_REVISION 10, FLASHLOAN_PREMIUM_TOTAL 5 bps. */
  flashLoanPremiumBps: 5,
  assets: {
    USDC: {
      underlying: "0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f",
      decimals: 6,
      aToken: "0x10F1A9D11CDf50041f3f8cB7191CBE2f31750ACC",
      vToken: "0xFB3e85601b7fEb3691bbb8779Ef0E1069E347204",
    },
    USDT: {
      underlying: "0x0a215D8ba66387DCA84B284D18c3B4ec3de6E54a",
      decimals: 6,
      aToken: "0xcE3CAae5Ed17A7AafCEEbc897DE843fA6CC0c018",
      vToken: "0xE3C742c88EE6A610157C16b60bBDD62351daeE39",
    },
    WBTC: {
      underlying: "0x54114591963CF60EF3aA63bEfD6eC263D98145a4",
      decimals: 8,
      aToken: "0x47Db195BAf46898302C06c31bCF46c01C64ACcF9",
      vToken: "0x638291B5Ccb9fEd339FdD351Eb086e607fCA9561",
    },
    WETH: {
      underlying: "0x4200000000000000000000000000000000000006",
      decimals: 18,
      aToken: "0x73a5bB60b0B0fc35710DDc0ea9c407031E31Bdbb",
      vToken: "0x562abf6562d6A2b165aDa02b5946bc3E7b4dD653",
    },
    cbETH: {
      underlying: "0xD171b9694f7A2597Ed006D41f7509aaD4B485c4B",
      decimals: 18,
      aToken: "0x9Fd6d1DBAd7c052e0c43f46df36eEc6a68814B63",
      vToken: "0xa1a483652b157FF006292CDb0e9EB7FFad2a5142",
    },
    LINK: {
      underlying: "0x810D46F9a9027E28F9B01F75E2bdde839dA61115",
      decimals: 18,
      aToken: "0x0aD46dE765522399d7b25B438b230A894d72272B",
      vToken: "0xBA42C6752F347e3c22DD0A4e5578dCB0137C1325",
    },
  },
} as const satisfies { pool: Address; oracle: Address; [k: string]: unknown };

/** Uniswap deployments on Base Sepolia (docs.uniswap.org, verified 2026-11-20). */
export const UNISWAP_BASE_SEPOLIA = {
  source: {
    url: "https://docs.uniswap.org/contracts/v3/reference/deployments/base-deployments",
    verifiedOn: "2026-11-20",
  },
  v3Factory: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24",
  v3SwapRouter02: "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4",
  v3QuoterV2: "0xC5290058841028F1614F3A6F0F5816cAd0df5E27",
  v4PoolManager: "0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408",
  universalRouter: "0x492E6456D9528771018DeB9E87ef7750EF184104",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
} as const;

export type BastionContractName =
  | "BastionReactiveCore"
  | "BastionCallbackRouter"
  | "BastionPolicyRegistry"
  | "BastionProtectionVault"
  | "CrossChainReserveEscrow"
  | "SolverRescueExecutor"
  | "FlashRescueExecutor"
  | "SolverRegistry"
  | "SolverLiquidityVault"
  | "SolverQuoteManager"
  | "RescueSettlementLedger"
  | "RescueReceiptRegistry"
  | "BastionEmergencyControl"
  | "BastionRiskObserver"
  | "AaveV3LendingAdapter";

export interface DeploymentRecord {
  chainId: SupportedChainId;
  address: Address;
  txHash: `0x${string}`;
  block: number;
}

/** Every BASTION contract name, in deployment order. */
export const BASTION_CONTRACT_NAMES: readonly BastionContractName[] = [
  "BastionReactiveCore",
  "BastionCallbackRouter",
  "BastionPolicyRegistry",
  "BastionProtectionVault",
  "CrossChainReserveEscrow",
  "SolverRescueExecutor",
  "FlashRescueExecutor",
  "SolverRegistry",
  "SolverLiquidityVault",
  "SolverQuoteManager",
  "RescueSettlementLedger",
  "RescueReceiptRegistry",
  "BastionEmergencyControl",
  "BastionRiskObserver",
  "AaveV3LendingAdapter",
];
const BASTION_NAMES: ReadonlySet<string> = new Set<string>(BASTION_CONTRACT_NAMES);

/**
 * BASTION testnet deployments (non-fixture contracts only), derived from `TESTNET_DEPLOYMENTS`, which is copied from
 * real receipts under evidence/deployments/. Mainnet is intentionally absent.
 */
export const BASTION_DEPLOYMENTS: Partial<Record<BastionContractName, DeploymentRecord[]>> = (() => {
  const out: Partial<Record<BastionContractName, DeploymentRecord[]>> = {};
  for (const d of TESTNET_DEPLOYMENTS) {
    if (d.fixture || !BASTION_NAMES.has(d.contract)) continue;
    const name = d.contract as BastionContractName;
    (out[name] ??= []).push({ chainId: d.chainId, address: d.address, txHash: d.txHash, block: d.block });
  }
  return out;
})();

export function getChain(id: number): ChainInfo {
  const c = (CHAINS as Record<number, ChainInfo | undefined>)[id];
  if (!c) throw new Error(`Unsupported chain id ${id}`);
  return c;
}

export function isSupportedChain(id: number): id is SupportedChainId {
  return id in CHAINS;
}

export function explorerTxUrl(chainId: number, txHash: string): string | null {
  const c = getChain(chainId);
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error("not a transaction hash");
  return c.explorer ? `${c.explorer.url}/tx/${txHash}` : null;
}

export function explorerAddressUrl(chainId: number, address: string): string | null {
  const c = getChain(chainId);
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("not an address");
  return c.explorer ? `${c.explorer.url}/address/${address}` : null;
}

export function deploymentStatus(
  name: BastionContractName,
  chainId: SupportedChainId,
): DeploymentRecord | null {
  return BASTION_DEPLOYMENTS[name]?.find((d) => d.chainId === chainId) ?? null;
}
