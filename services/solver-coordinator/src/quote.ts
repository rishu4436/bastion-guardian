import type { Address, Hex } from "viem";

/**
 * Off-chain solver quote (EIP-712). A quote is an INDICATIVE intent: it never counts as rescue liquidity. Only an
 * on-chain SolverLiquidityVault commitment backs a rescue; the coordinator links quotes to such commitments.
 */
export const QUOTE_TYPES = {
  SolverQuote: [
    { name: "solver", type: "address" },
    { name: "policyId", type: "bytes32" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "feeBps", type: "uint16" },
    { name: "validUntil", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export interface SolverQuote {
  solver: Address;
  policyId: Hex;
  token: Address;
  amount: bigint;
  feeBps: number;
  validUntil: bigint;
  nonce: bigint;
}

export function quoteDomain(chainId: number, verifyingContract: Address) {
  return { name: "BASTION Solver Quote", version: "1", chainId, verifyingContract } as const;
}
