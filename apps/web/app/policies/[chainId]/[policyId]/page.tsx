"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useApi } from "@/lib/hooks";
import {
  Amount,
  Badge,
  Card,
  ErrorBox,
  Hash,
  Loading,
  PageHeader,
  Provenance,
  ReadinessBadge,
  Stat,
  Table,
} from "@/components/ui";
import { EventFeed } from "@/components/event-feed";
import { CHAIN_NAMES, ago, bps, hf, isLocal } from "@/lib/format";

interface Detail {
  policy: {
    chainId: number;
    policyId: string;
    owner: string;
    account: string;
    adapter: string;
    market: string;
    debtAsset: string;
    collateralAsset: string;
    status: string;
    currentVersion: number;
    registeredAt: string;
  };
  versions: {
    version: number;
    triggerHealthFactorWad: string;
    targetHealthFactorWad: string;
    maxTotalRepay: string;
    maxRepayPerAction: string;
    maxTotalFees: string;
    maxSlippageBps: number;
    maxFeeBps: number;
    allowedPaths: number;
    allowPartial: boolean;
    expiry: string;
    cooldownSeconds: number;
    registeredTxHash: string;
    solvers: string[];
  }[];
  budgets: {
    chainId: number;
    token: string;
    repayReserve: string;
    feeReserve: string;
    totalReimbursed: string;
    pausedAt: string | null;
    maxFeeBps: number;
  }[];
  rescues: { rescueId: string; state: string; createdAt: string; originTxHash: string | null }[];
  positions: {
    collateralAmount: string;
    debtAmount: string;
    healthFactorWad: string;
    observedAt: string;
    observedBlock: string;
    collateralAsset: string;
    debtAsset: string;
  }[];
  readiness: {
    status: string;
    evaluatedAt: string;
    checks: { checks: Record<string, string>; reasons: string[] };
  } | null;
}

const CHECK_TONE = { pass: "armed", warn: "limited", fail: "unavailable", unknown: "unknown" } as const;

export default function PolicyPage() {
  const { chainId, policyId } = useParams<{ chainId: string; policyId: string }>();
  const q = useApi<Detail>(`/v1/policies/${chainId}/${policyId}`, { refetchInterval: 10_000 });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data!;
  const p = d.policy;
  const v = d.versions[0];
  const pos = d.positions[0];
  const cid = p.chainId;
  return (
    <>
      <PageHeader
        title="Protection policy"
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Hash value={p.policyId} n={10} /> · {CHAIN_NAMES[cid] ?? cid}{" "}
            {isLocal(cid) ? <Provenance kind="local" /> : <Provenance kind="onchain" />}
          </span>
        }
        right={<ReadinessBadge status={d.readiness?.status} />}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Position">
            {pos ? (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <Stat
                  label="Health factor"
                  value={hf(pos.healthFactorWad)}
                  hint={`block ${pos.observedBlock} · ${ago(pos.observedAt)}`}
                />
                <Stat
                  label="Collateral"
                  value={<Amount chainId={cid} token={pos.collateralAsset} raw={pos.collateralAmount} />}
                />
                <Stat
                  label="Debt"
                  value={<Amount chainId={cid} token={pos.debtAsset} raw={pos.debtAmount} />}
                />
                <Stat label="Account" value={<Hash value={p.account} />} />
              </div>
            ) : (
              <p className="text-sm text-muted">No position observation recorded yet for this account.</p>
            )}
          </Card>
          {v && (
            <Card title={`Signed limits · version ${v.version}`} right={<Hash value={v.registeredTxHash} />}>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <Stat label="Trigger HF" value={hf(v.triggerHealthFactorWad)} />
                <Stat label="Target HF" value={hf(v.targetHealthFactorWad)} />
                <Stat
                  label="Max repay / action"
                  value={<Amount chainId={cid} token={p.debtAsset} raw={v.maxRepayPerAction} />}
                />
                <Stat
                  label="Max total repay"
                  value={<Amount chainId={cid} token={p.debtAsset} raw={v.maxTotalRepay} />}
                />
                <Stat
                  label="Max total fees"
                  value={<Amount chainId={cid} token={p.debtAsset} raw={v.maxTotalFees} />}
                />
                <Stat label="Max fee" value={bps(v.maxFeeBps)} />
                <Stat label="Max slippage" value={bps(v.maxSlippageBps)} />
                <Stat
                  label="Paths"
                  value={
                    [v.allowedPaths & 1 ? "Flash" : null, v.allowedPaths & 2 ? "Solver" : null]
                      .filter(Boolean)
                      .join(" + ") || "none"
                  }
                  hint={v.allowPartial ? "partial allowed" : "full target only"}
                />
                <Stat label="Expiry" value={new Date(v.expiry).toLocaleDateString()} />
                <Stat label="Cooldown" value={`${v.cooldownSeconds}s`} />
                <Stat
                  label="Status"
                  value={<Badge tone={p.status === "Active" ? "armed" : "limited"}>{p.status}</Badge>}
                />
                <Stat label="Owner" value={<Hash value={p.owner} />} />
              </div>
            </Card>
          )}
          <Card title="Rescues">
            <Table
              head={["Rescue", "State", "Created", "Origin tx"]}
              empty="No rescues have been requested for this policy."
              rows={d.rescues.map((r) => [
                <Link
                  key="r"
                  className="font-mono text-xs text-accent hover:underline"
                  href={`/rescues/${r.rescueId}`}
                >
                  {r.rescueId.slice(0, 12)}…
                </Link>,
                <Badge
                  key="s"
                  tone={
                    r.state === "ReimbursementComplete"
                      ? "armed"
                      : r.state.includes("Fail") || r.state === "RecoveryRequired"
                        ? "unavailable"
                        : "accent"
                  }
                >
                  {r.state}
                </Badge>,
                <span key="c" className="text-xs text-muted">
                  {ago(r.createdAt)}
                </span>,
                <Hash key="o" value={r.originTxHash} />,
              ])}
            />
          </Card>
        </div>
        <div className="space-y-6">
          <Card
            title="Guardian checks"
            right={d.readiness && <span className="text-xs text-muted">{ago(d.readiness.evaluatedAt)}</span>}
          >
            {d.readiness ? (
              <>
                <ul className="space-y-1.5 text-sm" data-testid="readiness-checks">
                  {Object.entries(d.readiness.checks.checks).map(([k, s]) => (
                    <li key={k} className="flex items-center justify-between">
                      <span className="text-muted">{k}</span>
                      <Badge tone={CHECK_TONE[s as keyof typeof CHECK_TONE] ?? "unknown"}>{s}</Badge>
                    </li>
                  ))}
                </ul>
                {d.readiness.checks.reasons.length > 0 && (
                  <p className="mt-3 text-xs text-limited">{d.readiness.checks.reasons.join(" · ")}</p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted">
                Guardian health has not evaluated this policy yet. Status is Unknown.
              </p>
            )}
          </Card>
          <Card title="Reserve budget">
            {d.budgets.length ? (
              d.budgets.map((b) => (
                <div key={b.chainId + b.token} className="grid grid-cols-2 gap-3">
                  <Stat
                    label="Repay reserve"
                    value={<Amount chainId={b.chainId} token={b.token} raw={b.repayReserve} />}
                  />
                  <Stat
                    label="Fee reserve"
                    value={<Amount chainId={b.chainId} token={b.token} raw={b.feeReserve} />}
                  />
                  <Stat
                    label="Reimbursed"
                    value={<Amount chainId={b.chainId} token={b.token} raw={b.totalReimbursed} />}
                  />
                  <Stat
                    label="State"
                    value={
                      b.pausedAt ? <Badge tone="limited">paused</Badge> : <Badge tone="armed">active</Badge>
                    }
                  />
                </div>
              ))
            ) : (
              <p className="text-sm text-muted">
                No reserve budget allocated: solver rescues cannot be reimbursed.
              </p>
            )}
          </Card>
          <EventFeed chainId={cid} policyId={p.policyId} title="Policy events" />
        </div>
      </div>
    </>
  );
}
