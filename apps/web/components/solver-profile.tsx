"use client";

import Link from "next/link";
import { useApi } from "@/lib/hooks";
import { Q } from "@/components/query";
import { Amount, Badge, Card, Hash, Stat, Table } from "@/components/ui";
import { bps } from "@/lib/format";

interface Detail {
  solver: {
    chainId: number;
    solver: string;
    payout: string;
    bond: string;
    metadataUri: string | null;
    status: string;
    totalFilled: string;
    fills: number;
    failures: number;
    registeredBlock: string;
  };
  commitments: {
    commitmentId: string;
    policyId: string;
    token: string;
    amount: string;
    remaining: string;
    feeBps: number;
    expiry: string;
    state: string;
  }[];
  fills: { rescueId: string; principal: string; fee: string; txHash: string; blockNumber: string }[];
}

export function SolverProfileView({ chainId, address }: { chainId: number; address: string }) {
  const q = useApi<Detail>(`/v1/solvers/${chainId}/${address}`, { refetchInterval: 15_000 });
  return (
    <Q q={q}>
      {(d) => {
        const s = d.solver;
        const token = d.commitments[0]?.token;
        const success = s.fills + s.failures ? (s.fills * 10000) / (s.fills + s.failures) : null;
        return (
          <div className="space-y-6">
            <Card
              title="Registration"
              right={<Badge tone={s.status === "active" ? "armed" : "limited"}>{s.status}</Badge>}
            >
              <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
                <Stat label="Solver" value={<Hash value={s.solver} />} />
                <Stat label="Payout" value={<Hash value={s.payout} />} />
                <Stat
                  label="Bond"
                  value={<Amount chainId={s.chainId} token={token} raw={s.bond} />}
                  hint={token ? undefined : "bond token unknown"}
                />
                <Stat
                  label="Fills / failures"
                  value={`${s.fills} / ${s.failures}`}
                  hint={success === null ? "no history" : `${bps(Math.round(success))} success`}
                />
                <Stat
                  label="Total filled"
                  value={<Amount chainId={s.chainId} token={token} raw={s.totalFilled} />}
                />
              </div>
              {s.metadataUri && <p className="mt-3 text-xs text-muted">Metadata: {s.metadataUri}</p>}
            </Card>
            <Card title="On-chain liquidity commitments">
              <Table
                head={["Commitment", "Policy", "Remaining / amount", "Fee", "Expiry", "State"]}
                empty="No commitments."
                rows={d.commitments.map((c) => [
                  <Hash key="c" value={c.commitmentId} />,
                  <Link
                    key="p"
                    className="font-mono text-xs text-accent"
                    href={`/policies/${s.chainId}/${c.policyId}`}
                  >
                    {c.policyId.slice(0, 10)}…
                  </Link>,
                  <span key="a">
                    <Amount chainId={s.chainId} token={c.token} raw={c.remaining} /> /{" "}
                    <Amount chainId={s.chainId} token={c.token} raw={c.amount} />
                  </span>,
                  bps(c.feeBps),
                  new Date(c.expiry).toLocaleString(),
                  <Badge key="s" tone={c.state === "active" ? "armed" : "unknown"}>
                    {c.state}
                  </Badge>,
                ])}
              />
            </Card>
            <Card title="Fills">
              <Table
                head={["Rescue", "Principal", "Fee", "Block", "Tx"]}
                empty="No fills yet."
                rows={d.fills.map((f) => [
                  <Link key="r" className="font-mono text-xs text-accent" href={`/rescues/${f.rescueId}`}>
                    {f.rescueId.slice(0, 10)}…
                  </Link>,
                  <Amount key="p" chainId={s.chainId} token={token} raw={f.principal} />,
                  <Amount key="f" chainId={s.chainId} token={token} raw={f.fee} />,
                  f.blockNumber,
                  <Hash key="t" value={f.txHash} />,
                ])}
              />
            </Card>
          </div>
        );
      }}
    </Q>
  );
}
