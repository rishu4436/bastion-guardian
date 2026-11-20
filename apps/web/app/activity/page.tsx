"use client";

import Link from "next/link";
import { useApi } from "@/lib/hooks";
import { Badge, Card, ErrorBox, Hash, Loading, PageHeader, Table } from "@/components/ui";
import { EventFeed } from "@/components/event-feed";
import { CHAIN_NAMES, ago, hf } from "@/lib/format";

interface Rescue {
  rescueId: string;
  chainId: number;
  policyId: string;
  state: string;
  createdAt: string;
  executions: {
    path: number;
    success: boolean;
    healthFactorBeforeWad: string | null;
    healthFactorAfterWad: string | null;
  }[];
}

export default function Activity() {
  const q = useApi<{ items: Rescue[] }>("/v1/rescues?limit=50", { refetchInterval: 10_000 });
  const s = useApi<{
    items: {
      rescueId: string;
      state: string;
      attempts: number;
      updatedAt: string;
      overdueSince: string | null;
    }[];
  }>("/v1/settlements?limit=50", { refetchInterval: 10_000 });
  return (
    <>
      <PageHeader
        title="Network activity"
        subtitle="Every rescue and settlement indexed from chain events, newest first."
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Rescues">
            {q.isLoading ? (
              <Loading />
            ) : q.error ? (
              <ErrorBox error={q.error} />
            ) : (
              <Table
                head={["Rescue", "Chain", "Policy", "Path", "HF", "State", "When"]}
                empty="No rescues indexed yet."
                rows={q.data!.items.map((r) => {
                  const e = r.executions.find((x) => x.success) ?? r.executions[0];
                  return [
                    <Link
                      key="r"
                      href={`/rescues/${r.rescueId}`}
                      className="font-mono text-xs text-accent hover:underline"
                    >
                      {r.rescueId.slice(0, 10)}…
                    </Link>,
                    <span key="c" className="text-xs">
                      {CHAIN_NAMES[r.chainId] ?? r.chainId}
                    </span>,
                    <Link
                      key="p"
                      href={`/policies/${r.chainId}/${r.policyId}`}
                      className="font-mono text-xs hover:text-accent"
                    >
                      {r.policyId.slice(0, 10)}…
                    </Link>,
                    e ? (e.path === 1 ? "Flash" : "Solver") : "—",
                    e ? `${hf(e.healthFactorBeforeWad)} → ${hf(e.healthFactorAfterWad)}` : "—",
                    <Badge
                      key="s"
                      tone={
                        r.state === "ReimbursementComplete" || r.state === "DestinationExecuted"
                          ? "armed"
                          : "accent"
                      }
                    >
                      {r.state}
                    </Badge>,
                    <span key="w" className="text-xs text-muted">
                      {ago(r.createdAt)}
                    </span>,
                  ];
                })}
              />
            )}
          </Card>
          <Card title="Settlement claims">
            {s.error ? (
              <ErrorBox error={s.error} />
            ) : (
              <Table
                head={["Rescue", "State", "Attempts", "Updated"]}
                empty="No settlement claims."
                rows={(s.data?.items ?? []).map((c) => [
                  <Hash key="r" value={c.rescueId} />,
                  <Badge
                    key="s"
                    tone={
                      c.state === "Reimbursed"
                        ? "armed"
                        : c.state === "Pending"
                          ? c.overdueSince
                            ? "limited"
                            : "accent"
                          : "unavailable"
                    }
                  >
                    {c.state}
                    {c.overdueSince ? " · overdue" : ""}
                  </Badge>,
                  c.attempts,
                  <span key="u" className="text-xs text-muted">
                    {ago(c.updatedAt)}
                  </span>,
                ])}
              />
            )}
          </Card>
        </div>
        <EventFeed />
      </div>
    </>
  );
}
