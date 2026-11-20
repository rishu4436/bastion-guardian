"use client";

import { useApi } from "@/lib/hooks";
import { Card, ErrorBox, Loading, PageHeader, Provenance, Table } from "@/components/ui";
import { units } from "@/lib/format";

const LABELS: Record<string, string> = {
  "risk.observations": "Trigger observations",
  "risk.accounts_triggered": "Accounts triggered",
  "rescue.executed": "Rescues executed",
  "rescue.failed": "Rescues failed",
  "rescue.path_flash": "Flash path",
  "rescue.path_solver": "Solver path",
  "rescue.repaid_raw": "Debt repaid",
  "rescue.fee_raw": "Rescue fees",
  "solver.fills": "Solver fills",
  "solver.fee_raw": "Solver fees",
  "settlement.reimbursed": "Reimbursements",
  "settlement.reimbursed_raw": "Reimbursed amount",
  "settlement.failed": "Settlement failures",
  "settlement.disputed": "Disputes",
  "readiness.snapshots": "Readiness evaluations",
  "readiness.armed_bps": "Time armed",
  "notifications.accepted": "Notifications accepted",
  "notifications.suppressed": "Notifications suppressed",
  "notifications.dead_letter": "Notifications dead-lettered",
  "incidents.opened": "Incidents opened",
};
const fmt = (m: string, v: string) =>
  m.endsWith("_raw")
    ? `${units(v, 6)} fUSDC`
    : m === "readiness.armed_bps"
      ? `${(Number(v) / 100).toFixed(1)}%`
      : Number(v).toLocaleString();

export default function Analytics() {
  const q = useApi<{ days: Record<string, Record<string, string>>; note: string }>(
    "/v1/analytics/daily?chainId=31337",
  );
  const days = Object.keys(q.data?.days ?? {})
    .sort()
    .reverse()
    .slice(0, 7);
  return (
    <>
      <PageHeader
        title="Protocol analytics"
        subtitle="Daily metrics recomputed by the analytics worker from indexed chain data (UTC days)."
        right={<Provenance kind="local" />}
      />
      <Card title="Local simulation chain · last 7 days with activity">
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : (
          <>
            <Table
              head={["Metric", ...days]}
              empty="The analytics worker has not computed any days yet."
              rows={
                days.length
                  ? Object.keys(LABELS).map((m) => [
                      LABELS[m],
                      ...days.map((d) =>
                        q.data!.days[d]?.[m] !== undefined ? fmt(m, q.data!.days[d]![m]!) : "—",
                      ),
                    ])
                  : []
              }
            />
            <p className="mt-3 text-xs text-muted">
              {q.data?.note} Amount rows assume the local fixture debt asset (fUSDC, 6 decimals).
            </p>
          </>
        )}
      </Card>
    </>
  );
}
