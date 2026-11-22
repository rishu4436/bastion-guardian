"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useConnection } from "wagmi";
import { useApi } from "@/lib/hooks";
import { useStream } from "@/lib/use-stream";
import { Q } from "@/components/query";
import { Badge, Card, Empty, Hash, PageHeader, Provenance, ReadinessBadge, inputCls } from "@/components/ui";
import { ago, hf, isLocal } from "@/lib/format";

interface Policy {
  chainId: number;
  policyId: string;
  status: string;
  account: string;
  readiness: { status: string } | null;
}
interface Snapshot {
  id: number;
  status: string;
  evaluatedAt: string;
  dataAsOf: string | null;
  checks: { checks?: Record<string, string>; reasons?: string[] };
}
interface RiskObs {
  id: number;
  healthFactorWad: string;
  triggerHealthFactorWad: string;
  observedAt: string;
  txHash: string;
}
interface Rescue {
  rescueId: string;
  state: string;
  createdAt: string;
  executions: {
    path: number;
    success: boolean;
    reason: string | null;
    txHash: string;
    blockTimestamp: string | null;
    healthFactorAfterWad: string | null;
  }[];
}

type Item = {
  at: string;
  kind: string;
  tone: "armed" | "limited" | "unavailable" | "unknown" | "accent";
  title: string;
  body?: React.ReactNode;
};

const DOT: Record<Item["tone"], string> = {
  armed: "bg-armed",
  limited: "bg-limited",
  unavailable: "bg-unavailable",
  unknown: "bg-unknown",
  accent: "bg-accent",
};
const TONE: Record<string, Item["tone"]> = {
  ARMED: "armed",
  LIMITED: "limited",
  UNAVAILABLE: "unavailable",
  UNKNOWN: "unknown",
};

export function GuardianMode() {
  const sp = useSearchParams();
  const router = useRouter();
  const { address } = useConnection();
  const chainId = Number(sp.get("chainId") ?? 31337);
  const mine = useApi<{ items: Policy[] }>(address ? `/v1/policies?owner=${address}` : null);
  const policyId = sp.get("policyId") ?? mine.data?.items[0]?.policyId ?? null;
  const base = policyId ? `/v1/policies/${chainId}/${policyId}` : null;
  const detail = useApi<{ policy: Policy; readiness: Snapshot | null }>(base, { refetchInterval: 10_000 });
  const history = useApi<{ items: Snapshot[] }>(base ? `${base}/readiness?limit=100` : null, {
    refetchInterval: 10_000,
  });
  const risk = useApi<{ items: RiskObs[] }>(
    policyId ? `/v1/risk-observations?chainId=${chainId}&policyId=${policyId}` : null,
    { refetchInterval: 10_000 },
  );
  const rescues = useApi<{ items: Rescue[] }>(
    policyId ? `/v1/rescues?chainId=${chainId}&policyId=${policyId}` : null,
    { refetchInterval: 10_000 },
  );
  const live = useStream(policyId ? { chainId, policyId } : { chainId }, 20);

  const items: Item[] = [];
  let prev: string | undefined;
  for (const s of [...(history.data?.items ?? [])].reverse()) {
    if (s.status !== prev)
      items.push({
        at: s.evaluatedAt,
        kind: "readiness",
        tone: TONE[s.status] ?? "unknown",
        title: prev ? `Readiness ${prev} → ${s.status}` : `Guardian evaluated: ${s.status}`,
        body: s.checks.reasons?.length ? s.checks.reasons.join(" · ") : undefined,
      });
    prev = s.status;
  }
  for (const r of risk.data?.items ?? [])
    items.push({
      at: r.observedAt,
      kind: "risk",
      tone: "limited",
      title: `Trigger observed on-chain: HF ${hf(r.healthFactorWad)} < ${hf(r.triggerHealthFactorWad)}`,
      body: <Hash value={r.txHash} />,
    });
  for (const r of rescues.data?.items ?? [])
    for (const e of r.executions)
      items.push({
        at: e.blockTimestamp ?? r.createdAt,
        kind: "rescue",
        tone: e.success ? "armed" : "unavailable",
        title: `${e.path === 1 ? "Flash" : "Solver"} rescue ${e.success ? "executed" : `failed${e.reason ? ` (${e.reason})` : ""}`}${e.healthFactorAfterWad ? ` · HF → ${hf(e.healthFactorAfterWad)}` : ""}`,
        body: (
          <Link className="text-accent" href={`/rescues/${r.rescueId}`}>
            Receipt →
          </Link>
        ),
      });
  items.sort((a, b) => b.at.localeCompare(a.at));
  const snap = detail.data?.readiness;

  return (
    <>
      <PageHeader
        title="Guardian Mode"
        subtitle="Continuous readiness evaluation of everything a rescue depends on, and the timeline of what Guardian saw and did."
        right={isLocal(chainId) ? <Provenance kind="local" /> : null}
      />
      {mine.data && mine.data.items.length > 1 && (
        <select
          aria-label="Policy"
          className={`${inputCls} mb-6 max-w-md`}
          value={policyId ?? ""}
          onChange={(e) => {
            const p = mine.data!.items.find((x) => x.policyId === e.target.value)!;
            router.replace(`/guardian?chainId=${p.chainId}&policyId=${p.policyId}`);
          }}
        >
          {mine.data.items.map((p) => (
            <option key={p.policyId} value={p.policyId}>
              {p.policyId.slice(0, 12)}… · {p.status}
            </option>
          ))}
        </select>
      )}
      {!policyId ? (
        <Empty>
          Open Guardian Mode from a policy, or connect the wallet that owns one.{" "}
          <Link className="text-accent" href="/policies">
            Browse policies
          </Link>
          .
        </Empty>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6">
            <Card title="Current readiness" right={<ReadinessBadge status={snap?.status} />}>
              <Q q={detail}>
                {(d) =>
                  d.readiness ? (
                    <div className="space-y-3 text-sm">
                      <p className="text-xs text-muted">
                        Evaluated {ago(d.readiness.evaluatedAt)}
                        {d.readiness.dataAsOf ? ` · inputs as of ${ago(d.readiness.dataAsOf)}` : ""}. Policy{" "}
                        {d.policy.status}.
                      </p>
                      <ul data-testid="guardian-checks" className="space-y-1">
                        {Object.entries(d.readiness.checks.checks ?? {}).map(([k, v]) => (
                          <li key={k} className="flex justify-between gap-2">
                            <span>{k}</span>
                            <Badge
                              tone={
                                v === "pass"
                                  ? "armed"
                                  : v === "warn"
                                    ? "limited"
                                    : v === "fail"
                                      ? "unavailable"
                                      : "unknown"
                              }
                            >
                              {v}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                      {!!d.readiness.checks.reasons?.length && (
                        <div
                          className="rounded-lg border border-limited/40 bg-limited/10 p-3 text-xs"
                          data-testid="partial-readiness"
                        >
                          {d.readiness.checks.reasons.join(" · ")}
                        </div>
                      )}
                    </div>
                  ) : (
                    <Empty>
                      Guardian has not evaluated this policy yet. Status stays UNKNOWN until it does.
                    </Empty>
                  )
                }
              </Q>
            </Card>
            <Card
              title="Live"
              right={
                <Badge
                  tone={live.state === "open" ? "armed" : live.state === "error" ? "unavailable" : "unknown"}
                >
                  {live.state}
                </Badge>
              }
            >
              {live.events.filter((e) => e.event !== "hello").length ? (
                <ul className="space-y-1 text-xs">
                  {live.events
                    .filter((e) => e.event !== "hello")
                    .map((e, i) => (
                      <li key={i}>
                        <span className="font-mono">{e.event}</span> ·{" "}
                        {new Date(e.receivedAt).toLocaleTimeString()}
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="text-xs text-muted">Waiting for events on the stream.</p>
              )}
            </Card>
          </div>
          <Card title="Timeline" className="lg:col-span-2">
            {history.isLoading || risk.isLoading || rescues.isLoading ? (
              <p className="text-sm text-muted">Loading timeline…</p>
            ) : !items.length ? (
              <Empty>No readiness changes, triggers or rescues recorded for this policy yet.</Empty>
            ) : (
              <ol data-testid="guardian-timeline" className="relative space-y-4 border-l border-border pl-5">
                {(history.isError || risk.isError || rescues.isError) && (
                  <li role="status" className="text-xs text-limited">
                    Part of the timeline could not be loaded; showing what is available.
                  </li>
                )}
                {items.map((it, i) => (
                  <li key={i} className="relative">
                    <span
                      className={`absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full ${DOT[it.tone]}`}
                      aria-hidden
                    />
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge tone={it.tone}>{it.kind}</Badge>
                      <span className="font-medium">{it.title}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      {new Date(it.at).toLocaleString()} {it.body && <> · {it.body}</>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
