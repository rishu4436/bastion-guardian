"use client";

import Link from "next/link";
import { useState } from "react";
import { useApi } from "@/lib/hooks";
import { Q } from "@/components/query";
import { Amount, Badge, Card, Hash, PageHeader, Stat, Table, inputCls } from "@/components/ui";
import { CHAIN_NAMES, ago } from "@/lib/format";

interface Claim {
  rescueId: string;
  reserveChainId: number;
  destChainId: number;
  policyId: string;
  policyOwner: string;
  recipient: string;
  principal: string;
  fee: string;
  state: "Pending" | "Reimbursed" | "RecoveryRequired" | "Disputed";
  attempts: number;
  lastError: string | null;
  overdueSince: string | null;
  updatedAt: string;
}
interface Budget {
  token: string;
}
const TONE = {
  Pending: "limited",
  Reimbursed: "armed",
  RecoveryRequired: "unavailable",
  Disputed: "unavailable",
} as const;

export default function Settlements() {
  const [state, setState] = useState("");
  const q = useApi<{ items: Claim[] }>(`/v1/settlements?limit=200${state ? `&state=${state}` : ""}`, {
    refetchInterval: 10_000,
  });
  // Token for amounts: claims are denominated in the reserve budget token of the policy.
  const budgets = useApi<{ budgets: Budget[] }>(
    q.data?.items[0] ? `/v1/policies/${q.data.items[0].destChainId}/${q.data.items[0].policyId}` : null,
  );
  const token = budgets.data?.budgets[0]?.token;
  return (
    <>
      <PageHeader
        title="Settlement history"
        subtitle="Cross-chain reimbursement of solvers from users' reserve budgets, reconciled against destination-chain fills."
        right={
          <select
            aria-label="State filter"
            className={`${inputCls} w-48`}
            value={state}
            onChange={(e) => setState(e.target.value)}
          >
            <option value="">All states</option>
            {Object.keys(TONE).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        }
      />
      <Q q={q} isEmpty={(d) => !d.items.length} empty="No settlement claims recorded yet.">
        {(d) => (
          <div className="space-y-6">
            <Card>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {(Object.keys(TONE) as (keyof typeof TONE)[]).map((s) => (
                  <Stat key={s} label={s} value={d.items.filter((c) => c.state === s).length} />
                ))}
              </div>
            </Card>
            <Card title="Claims">
              <Table
                head={["Rescue", "Route", "Principal", "Fee", "Recipient", "State", "Attempts", "Updated"]}
                empty="None."
                rows={d.items.map((c) => [
                  <Link key="r" className="font-mono text-xs text-accent" href={`/rescues/${c.rescueId}`}>
                    {c.rescueId.slice(0, 10)}…
                  </Link>,
                  `${CHAIN_NAMES[c.reserveChainId] ?? c.reserveChainId} → ${CHAIN_NAMES[c.destChainId] ?? c.destChainId}`,
                  <Amount key="p" chainId={c.reserveChainId} token={token} raw={c.principal} />,
                  <Amount key="f" chainId={c.reserveChainId} token={token} raw={c.fee} />,
                  <Hash key="h" value={c.recipient} />,
                  <span key="s" className="flex flex-col gap-1">
                    <Badge tone={TONE[c.state]}>{c.state}</Badge>
                    {c.overdueSince && <Badge tone="unavailable">overdue since {ago(c.overdueSince)}</Badge>}
                    {c.lastError && <span className="text-xs text-unavailable">{c.lastError}</span>}
                  </span>,
                  c.attempts,
                  ago(c.updatedAt),
                ])}
              />
            </Card>
          </div>
        )}
      </Q>
    </>
  );
}
