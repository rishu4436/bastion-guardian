"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useApi, useTokens } from "@/lib/hooks";
import { Q } from "@/components/query";
import { Badge, Card, Hash, PageHeader, Provenance, Stat, Table } from "@/components/ui";
import { CHAIN_NAMES, ago, bps, hf, isLocal, units } from "@/lib/format";
import { band, dropToLiquidationBps } from "@/lib/radar";
import { hfSeries } from "@/lib/positions";

interface Position {
  id: string;
  chainId: number;
  protocolId: string;
  account: string;
  collateralAsset: string;
  debtAsset: string;
  collateralAmount: string;
  debtAmount: string;
  healthFactorWad: string;
  liquidationThresholdBps: number;
  observedAt: string;
  observedBlock: string;
  provenance: string;
}
interface Observation {
  id: number;
  blockNumber: string;
  blockHash: string;
  observedAt: string;
  collateralAmount: string;
  debtAmount: string;
  healthFactorWad: string;
  source: "chain" | "simulated";
}
interface Policy {
  chainId: number;
  account: string;
  policyId: string;
}

/** Health-factor sparkline drawn only from indexed observations (oldest → newest). No interpolation. */
function HfChart({ items }: { items: Observation[] }) {
  const s = hfSeries(items.filter((o) => o.source === "chain").map((o) => BigInt(o.healthFactorWad)));
  if (!s)
    return <p className="text-sm text-muted">Fewer than two on-chain observations; no trend to draw yet.</p>;
  return (
    <figure>
      <svg viewBox="0 0 600 160" className="h-40 w-full" role="img" aria-label="Health factor history">
        {s.liquidationY !== null && (
          <line
            x1="0"
            x2="600"
            y1={s.liquidationY}
            y2={s.liquidationY}
            className="stroke-unavailable"
            strokeDasharray="4 4"
          />
        )}
        <polyline fill="none" strokeWidth="2" className="stroke-accent" points={s.points} />
      </svg>
      <figcaption className="text-xs text-muted">
        HF range {s.minLabel} – {s.maxLabel} across {s.count} on-chain observations. Dashed line = HF 1.00
        (liquidation) when in range.
      </figcaption>
    </figure>
  );
}

export default function PositionDetail() {
  const { id } = useParams<{ id: string }>();
  const q = useApi<Position>(`/v1/positions/${id}`, { refetchInterval: 10_000 });
  const obs = useApi<{ items: Observation[] }>(`/v1/positions/${id}/observations?limit=200`, {
    refetchInterval: 10_000,
  });
  const pols = useApi<{ items: Policy[] }>("/v1/policies?limit=200&status=Active");
  const { find } = useTokens();
  return (
    <>
      <PageHeader
        title="Position"
        subtitle="Latest indexed state of one lending position and its health-factor history, read from the lender."
        right={
          <Link href="/radar" className="text-sm text-accent">
            ← Liquidation Radar
          </Link>
        }
      />
      <Q q={q}>
        {(p) => {
          const h = BigInt(p.healthFactorWad);
          const b = band(h);
          const drop = dropToLiquidationBps(h);
          const dt = find(p.chainId, p.debtAsset);
          const ct = find(p.chainId, p.collateralAsset);
          const pol = pols.data?.items.find((x) => x.chainId === p.chainId && x.account === p.account);
          return (
            <div className="space-y-6">
              <Card
                title={
                  <span className="flex items-center gap-2">
                    {CHAIN_NAMES[p.chainId] ?? p.chainId} · {p.protocolId}{" "}
                    {isLocal(p.chainId) && <Provenance kind="local" />}
                  </span>
                }
                right={<Badge tone={b.tone}>{b.label}</Badge>}
              >
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <Stat
                    label="Health factor"
                    value={<span data-testid="position-hf">{hf(p.healthFactorWad)}</span>}
                  />
                  <Stat
                    label="Price drop to liquidation"
                    value={drop === null ? "—" : `${units(drop.toString(), 2, 2)}%`}
                    hint="derived estimate (single-asset 1 − 1/HF)"
                  />
                  <Stat
                    label="Debt"
                    value={
                      dt ? `${units(p.debtAmount, dt.decimals)} ${dt.symbol}` : `${p.debtAmount} base units`
                    }
                  />
                  <Stat
                    label="Collateral"
                    value={
                      ct
                        ? `${units(p.collateralAmount, ct.decimals)} ${ct.symbol}`
                        : `${p.collateralAmount} base units`
                    }
                  />
                  <Stat label="Account" value={<Hash value={p.account} n={8} />} />
                  <Stat label="Liquidation threshold" value={bps(p.liquidationThresholdBps)} />
                  <Stat label="Observed" value={ago(p.observedAt)} hint={`block ${p.observedBlock}`} />
                  <Stat
                    label="Protection"
                    value={
                      pol ? (
                        <Link className="text-accent" href={`/policies/${pol.chainId}/${pol.policyId}`}>
                          Active policy
                        </Link>
                      ) : (
                        <Link
                          className="text-accent"
                          href={`/policies/new?account=${p.account}&chainId=${p.chainId}`}
                        >
                          Unprotected · create a policy
                        </Link>
                      )
                    }
                  />
                </div>
                <p className="mt-3 text-xs text-muted">{p.provenance}</p>
              </Card>
              <Card title="Health-factor history">
                <Q
                  q={obs}
                  isEmpty={(d) => !d.items.length}
                  empty="No observations recorded for this position yet."
                >
                  {(d) => (
                    <div className="space-y-4">
                      <HfChart items={[...d.items].reverse()} />
                      <Table
                        head={["Block", "HF", "Debt", "Collateral", "Source", "Observed"]}
                        empty="No observations."
                        rows={d.items.map((o) => [
                          <span key="b" title={o.blockHash}>
                            {o.blockNumber}
                          </span>,
                          hf(o.healthFactorWad),
                          dt ? `${units(o.debtAmount, dt.decimals)} ${dt.symbol}` : o.debtAmount,
                          ct ? `${units(o.collateralAmount, ct.decimals)} ${ct.symbol}` : o.collateralAmount,
                          o.source === "chain" ? (
                            <Provenance key="s" kind="onchain" />
                          ) : (
                            <Provenance key="s" kind="simulated" />
                          ),
                          ago(o.observedAt),
                        ])}
                      />
                    </div>
                  )}
                </Q>
              </Card>
            </div>
          );
        }}
      </Q>
    </>
  );
}
