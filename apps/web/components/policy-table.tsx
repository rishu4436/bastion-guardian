"use client";

import Link from "next/link";
import { Badge, Hash, ReadinessBadge, Table } from "./ui";
import { CHAIN_NAMES, ago, isLocal } from "@/lib/format";

export interface PolicyRow {
  chainId: number;
  policyId: string;
  owner: string;
  account: string;
  status: string;
  currentVersion: number;
  registeredAt: string;
  readiness?: { status: string; evaluatedAt: string } | null;
}

export function PolicyTable({ items, empty }: { items: PolicyRow[]; empty: React.ReactNode }) {
  return (
    <Table
      head={["Policy", "Chain", "Account", "Status", "Guardian", "Evaluated"]}
      empty={empty}
      rows={items.map((p) => [
        <Link
          key="l"
          href={`/policies/${p.chainId}/${p.policyId}`}
          className="font-mono text-xs text-accent hover:underline"
        >
          {p.policyId.slice(0, 10)}…
        </Link>,
        <span key="c" className="text-xs">
          {CHAIN_NAMES[p.chainId] ?? p.chainId}{" "}
          {isLocal(p.chainId) && <Badge tone="limited">simulation</Badge>}
        </span>,
        <Hash key="a" value={p.account} />,
        <Badge
          key="s"
          tone={p.status === "Active" ? "armed" : p.status === "Paused" ? "limited" : "unavailable"}
        >
          {p.status} · v{p.currentVersion}
        </Badge>,
        <ReadinessBadge key="r" status={p.readiness?.status} />,
        <span key="e" className="text-xs text-muted">
          {ago(p.readiness?.evaluatedAt)}
        </span>,
      ])}
    />
  );
}
