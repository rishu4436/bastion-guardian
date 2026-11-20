"use client";

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { api } from "./api";

export function useApi<T>(path: string | null, opts: Partial<UseQueryOptions<T>> = {}) {
  return useQuery<T>({ queryKey: [path], queryFn: () => api<T>(path!), enabled: !!path, ...opts });
}

export interface Token {
  chainId: number;
  address: string;
  symbol: string;
  decimals: number;
  isFixture: boolean;
}

/** Token metadata lookup; unknown tokens fall back to raw base units (never guessed decimals). */
export function useTokens() {
  const q = useApi<{ items: Token[] }>("/v1/tokens", { staleTime: 60_000 });
  const find = (chainId: number, address: string | null | undefined): Token | undefined =>
    address
      ? q.data?.items.find((t) => t.chainId === chainId && t.address === address.toLowerCase())
      : undefined;
  return { find, isLoading: q.isLoading };
}
