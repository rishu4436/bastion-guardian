"use client";

import { useApi } from "./hooks";

export interface Deployments {
  chainId: number;
  mode: "local_simulation" | "testnet" | null;
  contracts: Record<string, `0x${string}`>;
}

/** Contract addresses recorded by the API for a chain. Empty when nothing is deployed there (never guessed). */
export function useDeployments(chainId: number | undefined) {
  return useApi<Deployments>(chainId ? `/v1/deployments?chainId=${chainId}` : null, { staleTime: 60_000 });
}
