"use client";

import { useApi } from "@/lib/hooks";
import { Amount, Badge, Card, ErrorBox, Hash, Loading, PageHeader, Table } from "@/components/ui";
import { CHAIN_NAMES, bps } from "@/lib/format";

interface Solver {
  chainId: number;
  solver: string;
  payout: string;
  bond: string;
  status: string;
  fills: number;
  failures: number;
  totalFilled: string;
  activeCommitments: number;
  committedRemaining: string;
}
interface Demand {
  policyId: string;
  debtAsset: string;
  requiredRepayAtTrigger: string;
  committedCoverage: string;
  shortfall: string;
  maxFeeBps: number;
  readiness: string;
}

export default function Solvers() {
  const s = useApi<{ items: Solver[] }>("/v1/solvers");
  const d = useApi<{ items: Demand[]; note: string }>("/v1/solver/demand?chainId=31337");
  return (
    <>
      <PageHeader
        title="Solver marketplace"
        subtitle="Bonded solvers pre-commit liquidity on-chain per policy. Off-chain quotes are indicative and never counted as coverage."
      />
      <div className="space-y-6">
        <Card title="Registered solvers">
          {s.isLoading ? (
            <Loading />
          ) : s.error ? (
            <ErrorBox error={s.error} />
          ) : (
            <Table
              head={["Solver", "Chain", "Status", "Bond", "Committed (remaining)", "Fills", "Failures"]}
              empty="No solvers registered on indexed chains."
              rows={s.data!.items.map((x) => [
                <Hash key="s" value={x.solver} />,
                CHAIN_NAMES[x.chainId] ?? x.chainId,
                <Badge key="st" tone={x.status === "active" ? "armed" : "limited"}>
                  {x.status}
                </Badge>,
                <span key="b" className="tabular">
                  {x.bond} wei
                </span>,
                <span key="c">
                  {x.activeCommitments} · <span className="tabular">{x.committedRemaining}</span> units
                </span>,
                x.fills,
                x.failures,
              ])}
            />
          )}
        </Card>
        <Card
          title="Coverage demand · local simulation chain"
          right={<Badge tone="limited">from Guardian readiness</Badge>}
        >
          {d.isLoading ? (
            <Loading />
          ) : d.error ? (
            <ErrorBox error={d.error} />
          ) : (
            <Table
              head={["Policy", "Required at trigger", "Committed", "Shortfall", "Max fee", "Guardian"]}
              empty="No readiness snapshots yet, so no demand can be computed."
              rows={d.data!.items.map((x) => [
                <Hash key="p" value={x.policyId} />,
                <Amount key="r" chainId={31337} token={x.debtAsset} raw={x.requiredRepayAtTrigger} />,
                <Amount key="c" chainId={31337} token={x.debtAsset} raw={x.committedCoverage} />,
                <Amount key="s" chainId={31337} token={x.debtAsset} raw={x.shortfall} />,
                bps(x.maxFeeBps),
                x.readiness,
              ])}
            />
          )}
        </Card>
      </div>
    </>
  );
}
