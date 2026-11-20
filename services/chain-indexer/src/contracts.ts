import { decodeEventLog, type Abi, type Address, type Log } from "viem";
import {
  bastionCallbackRouterAbi,
  bastionPolicyRegistryAbi,
  bastionProtectionVaultAbi,
  bastionRiskObserverAbi,
  crossChainReserveEscrowAbi,
  flashRescueExecutorAbi,
  rescueReceiptRegistryAbi,
  rescueSettlementLedgerAbi,
  solverLiquidityVaultAbi,
  solverRegistryAbi,
  solverRescueExecutorAbi,
} from "@bastion-guardian/contracts";

export const INDEXED_ABIS = {
  policyRegistry: bastionPolicyRegistryAbi,
  riskObserver: bastionRiskObserverAbi,
  callbackRouter: bastionCallbackRouterAbi,
  ledger: rescueSettlementLedgerAbi,
  receipts: rescueReceiptRegistryAbi,
  solverRescueExecutor: solverRescueExecutorAbi,
  flashRescueExecutor: flashRescueExecutorAbi,
  solverRegistry: solverRegistryAbi,
  solverLiquidityVault: solverLiquidityVaultAbi,
  reserveEscrow: crossChainReserveEscrowAbi,
  protectionVault: bastionProtectionVaultAbi,
} as const satisfies Record<string, Abi>;

export type IndexedContractName = keyof typeof INDEXED_ABIS;
export interface IndexedContract {
  name: IndexedContractName;
  address: Address;
}

export interface DecodedLog {
  contract: IndexedContractName;
  address: Address;
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  blockHash: `0x${string}`;
  txHash: `0x${string}`;
  logIndex: number;
}

/** Decodes a raw log with the ABI of the contract that emitted it. Unknown events return null (kept out of the DB). */
export function decode(log: Log, byAddress: Map<string, IndexedContractName>): DecodedLog | null {
  const name = byAddress.get(log.address.toLowerCase());
  if (
    !name ||
    log.blockNumber == null ||
    log.blockHash == null ||
    log.transactionHash == null ||
    log.logIndex == null
  )
    return null;
  try {
    const ev = decodeEventLog({
      abi: INDEXED_ABIS[name] as Abi,
      data: log.data,
      topics: log.topics,
      strict: true,
    });
    return {
      contract: name,
      address: log.address.toLowerCase() as Address,
      eventName: ev.eventName ?? "unknown",
      args: (ev.args ?? {}) as Record<string, unknown>,
      blockNumber: log.blockNumber,
      blockHash: log.blockHash.toLowerCase() as `0x${string}`,
      txHash: log.transactionHash.toLowerCase() as `0x${string}`,
      logIndex: log.logIndex,
    };
  } catch {
    return null;
  }
}

/** jsonb-safe args: bigint → decimal string, addresses/bytes lowercased. */
export function jsonArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] =
      typeof v === "bigint"
        ? v.toString()
        : typeof v === "string" && v.startsWith("0x")
          ? v.toLowerCase()
          : v;
  }
  return out;
}
