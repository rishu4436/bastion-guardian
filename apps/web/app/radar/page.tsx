"use client";

import Link from "next/link";
import { useState } from "react";
import { useApi, useTokens } from "@/lib/hooks";
import { Q } from "@/components/query";
import { Badge, Card, Hash, PageHeader, Provenance, Stat, Table, inputCls } from "@/components/ui";
import { CHAIN_NAMES, ago, hf, units } from "@/lib/format";
import { band, dropToLiquidationBps } from "@/lib/radar";

interface Position {
  id: string;
  chainId: number;
  account: string;
  collateralAsset: string;
  debtAsset: string;
  collateralAmount: string;
  debtAmount: string;
  healthFactorWad: string;
  observedAt: string;
  observedBlock: string;
}
interface Policy {
  chainId: number;
  account: string;
  policyId: string;
  status: string;
}

export default function Radar() {
  const [chain, setChain] = useState<string>("");
  const q = useApi<{ items: Position[]; provenance: string }>(
    `/v1/positions?limit=200${chain ? `&chainId=${chain}` : ""}`,
    {
      refetchInterval: 10_000,
    },
  );
  const pols = useApi<{ items: Policy[] }>("/v1/policies?limit=200&status=Active");
  const { find } = useTokens();
  const protectedBy = (p: Position) =>
    pols.data?.items.find((x) => x.chainId === p.chainId && x.account === p.account);
  return (
    <>
      <PageHeader
        title="Liquidation Radar"
        subtitle="Every indexed lending position ranked by distance to liquidation. Health factors are read from the lender; distances are derived estimates."
        right={
          <select
            aria-label="Chain filter"
            className={`${inputCls} w-56`}
            value={chain}
            onChange={(e) => setChain(e.target.value)}
          >
            <option value="">All chains</option>
            {[31337, 84532, 1301].map((c) => (
              <option key={c} value={c}>
                {CHAIN_NAMES[c]}
              </option>
            ))}
          </select>
        }
      />
      <Q
        q={q}
        isEmpty={(d) => !d.items.length}
        empty="No positions indexed yet. The risk observer records positions as it watches policies."
      >
        {(d) => {
          const rows = [...d.items].sort((a, b) =>
            BigInt(a.healthFactorWad) < BigInt(b.healthFactorWad) ? -1 : 1,
          );
          const count = (l: string) => rows.filter((r) => band(BigInt(r.healthFactorWad)).label === l).length;
          return (
            <div className="space-y-6">
              <Card>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
                  <Stat label="Positions" value={rows.length} />
                  <Stat label="Liquidatable" value={count("Liquidatable")} />
                  <Stat label="Critical (<1.10)" value={count("Critical")} />
                  <Stat label="At risk (<1.30)" value={count("At risk")} />
                  <Stat
                    label="Protected"
                    value={rows.filter((r) => protectedBy(r)).length}
                    hint={pols.isError ? "policy lookup failed" : undefined}
                  />
                </div>
                <p className="mt-3 text-xs text-muted">{d.provenance}</p>
              </Card>
              <Card title="Ranked positions">
                <Table
                  head={[
                    "Band",
                    "HF",
                    "Price drop to liquidation",
                    "Account",
                    "Debt",
                    "Collateral",
                    "Protection",
                    "Observed",
                  ]}
                  empty="No positions."
                  rows={rows.map((p) => {
                    const h = BigInt(p.healthFactorWad);
                    const b = band(h);
                    const drop = dropToLiquidationBps(h);
                    const pol = protectedBy(p);
                    const dt = find(p.chainId, p.debtAsset);
                    const ct = find(p.chainId, p.collateralAsset);
                    return [
                      <Badge key="b" tone={b.tone}>
                        {b.label}
                      </Badge>,
                      <Link
                        key="h"
                        data-testid="radar-hf"
                        className="text-accent"
                        href={`/positions/${p.id}`}
                      >
                        {hf(p.healthFactorWad)}
                      </Link>,
                      <span key="d" title="Derived estimate: 1 − 1/HF for single-asset positions">
                        {drop === null ? "—" : `${units(drop.toString(), 2, 2)}%`}{" "}
                        <Provenance kind="estimate" />
                      </span>,
                      <Hash key="a" value={p.account} />,
                      dt ? `${units(p.debtAmount, dt.decimals)} ${dt.symbol}` : `${p.debtAmount} units`,
                      ct
                        ? `${units(p.collateralAmount, ct.decimals)} ${ct.symbol}`
                        : `${p.collateralAmount} units`,
                      pol ? (
                        <Link
                          key="p"
                          className="text-accent"
                          href={`/guardian?chainId=${pol.chainId}&policyId=${pol.policyId}`}
                        >
                          Protected
                        </Link>
                      ) : (
                        <Link
                          key="p"
                          className="text-muted hover:text-accent"
                          href={`/policies/new?account=${p.account}&chainId=${p.chainId}`}
                        >
                          Unprotected · protect
                        </Link>
                      ),
                      <span key="o" title={`block ${p.observedBlock}`}>
                        {ago(p.observedAt)}
                      </span>,
                    ];
                  })}
                />
              </Card>
            </div>
          );
        }}
      </Q>
    </>
  );
}
