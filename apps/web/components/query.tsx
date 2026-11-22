"use client";

import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Empty, ErrorBox, Loading } from "./ui";

/**
 * Renders the four states every data view must handle:
 * loading (no data yet), error (no data), empty, and partial (a refresh failed; last known data stays visible and is
 * labeled). Never substitutes placeholder values for missing data.
 */
export function Q<T>({
  q,
  empty,
  isEmpty,
  children,
}: {
  q: UseQueryResult<T>;
  empty?: ReactNode;
  isEmpty?: (d: T) => boolean;
  children: (d: T) => ReactNode;
}) {
  if (q.isLoading) return <Loading />;
  if (q.data === undefined) return q.error ? <ErrorBox error={q.error} /> : <Loading />;
  const partial = q.isError ? (
    <div
      role="status"
      data-testid="partial"
      className="mb-3 rounded-lg border border-limited/40 bg-limited/10 px-3 py-2 text-xs text-limited"
    >
      Showing last known data from {new Date(q.dataUpdatedAt).toLocaleTimeString()}; the latest refresh failed
      ({(q.error as Error)?.message}).
    </div>
  ) : null;
  if (isEmpty?.(q.data))
    return (
      <>
        {partial}
        <Empty>{empty ?? "Nothing to show yet."}</Empty>
      </>
    );
  return (
    <>
      {partial}
      {children(q.data)}
    </>
  );
}

export function SignInRequired({ what }: { what: string }) {
  return (
    <Empty>
      Connect your wallet and <strong>Sign in with Ethereum</strong> to {what}. Signing in proves address
      ownership and authorizes no transaction.
    </Empty>
  );
}
