"use client";

import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { Badge, Button, Card, Empty, ErrorBox, Loading, PageHeader, Table } from "@/components/ui";
import { ago } from "@/lib/format";

interface Incident {
  id: string;
  kind: string;
  severity: string;
  status: string;
  title: string;
  recommendedAction: string;
  occurrences: number;
  lastSeenAt: string;
}

export default function Operations() {
  const { session, loading } = useSession();
  const allowed = !!session?.roles.some((r) => r === "admin" || r === "auditor");
  const isAdmin = !!session?.roles.includes("admin");
  const qc = useQueryClient();
  const inc = useApi<{ items: Incident[] }>(allowed ? "/v1/incidents?limit=100" : null, {
    refetchInterval: 10_000,
  });
  const audit = useApi<{
    items: {
      id: number;
      action: string;
      actorAddress: string | null;
      target: string | null;
      createdAt: string;
    }[];
  }>(allowed ? "/v1/admin/audit-events?limit=50" : null);
  if (loading) return <Loading />;
  if (!allowed)
    return (
      <>
        <PageHeader title="Operations" />
        <Empty>This console requires the auditor or admin role.</Empty>
      </>
    );
  return (
    <>
      <PageHeader
        title="Operations"
        subtitle="Incidents raised by guardian-health, settlement-reconciler and the indexer, with the audit trail."
      />
      <div className="space-y-6">
        <Card title="Incidents">
          {inc.isLoading ? (
            <Loading />
          ) : inc.error ? (
            <ErrorBox error={inc.error} />
          ) : (
            <Table
              head={["Severity", "Incident", "Recommended action", "Seen", "Status", ""]}
              empty="No incidents."
              rows={inc.data!.items.map((i) => [
                <Badge
                  key="s"
                  tone={
                    i.severity === "critical"
                      ? "unavailable"
                      : i.severity === "warning"
                        ? "limited"
                        : "unknown"
                  }
                >
                  {i.severity}
                </Badge>,
                <span key="t">
                  <div>{i.title}</div>
                  <div className="text-xs text-muted">{i.kind}</div>
                </span>,
                <span key="r" className="text-xs">
                  {i.recommendedAction}
                </span>,
                <span key="o" className="text-xs text-muted">
                  ×{i.occurrences} · {ago(i.lastSeenAt)}
                </span>,
                i.status,
                isAdmin && i.status === "open" ? (
                  <Button
                    key="a"
                    variant="ghost"
                    onClick={async () => (
                      await api(`/v1/incidents/${i.id}/acknowledge`, { method: "POST" }),
                      await qc.invalidateQueries()
                    )}
                  >
                    Acknowledge
                  </Button>
                ) : null,
              ])}
            />
          )}
        </Card>
        <Card title="Audit trail">
          <Table
            head={["Action", "Actor", "Target", "When"]}
            empty="No audit events."
            rows={(audit.data?.items ?? []).map((a) => [
              a.action,
              <span key="a" className="font-mono text-xs">
                {a.actorAddress ?? "system"}
              </span>,
              <span key="t" className="font-mono text-xs">
                {a.target ?? ""}
              </span>,
              <span key="w" className="text-xs text-muted">
                {ago(a.createdAt)}
              </span>,
            ])}
          />
        </Card>
      </div>
    </>
  );
}
