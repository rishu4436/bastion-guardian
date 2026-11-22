"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { apiUrl } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { contentHash } from "@/lib/proof";
import { Q } from "@/components/query";
import { Badge, Button, Card, Hash, PageHeader, Provenance, Stat } from "@/components/ui";
import { hf, units } from "@/lib/format";

interface Proof {
  schema: string;
  rescueId: string;
  environment: "LOCAL_SIMULATION" | "TESTNET";
  facts: {
    chainId: number;
    chainName: string;
    policy: Record<string, unknown> | null;
    executions: {
      success: boolean;
      path: number;
      txHash: string;
      blockNumber: string;
      repaid: string | null;
    }[];
    solverFills: { solver: string; principal: string; fee: string; txHash: string }[];
    settlementEvents: { kind: string; chainId: number; txHash: string; blockNumber: string }[];
    debtToken: { symbol: string; decimals: number } | null;
  };
  outcome: {
    rescued: boolean;
    path: string | null;
    healthFactorBeforeWad: string | null;
    healthFactorAfterWad: string | null;
    repaid: string | null;
    fee: string | null;
    settlement: string | null;
  };
  verification: { contentHash: string; algorithm: string; howTo: string[] };
  disclaimer: string;
  generatedAt: string;
}

export default function ProofPage() {
  const { rescueId } = useParams<{ rescueId: string }>();
  const q = useApi<Proof>(`/v1/rescues/${rescueId}/proof`);
  const [local, setLocal] = useState<string>();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (q.data) void contentHash(q.data.facts).then(setLocal);
  }, [q.data]);
  const download = () => {
    const blob = new Blob([JSON.stringify(q.data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `bastion-proof-${rescueId.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <>
      <PageHeader
        title="Proof of Protection"
        subtitle="A shareable, verifiable record of what the BASTION contracts did for this position."
        right={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(window.location.href);
                setCopied(true);
              }}
            >
              {copied ? "Link copied" : "Copy share link"}
            </Button>
            <Button variant="ghost" onClick={download} disabled={!q.data}>
              Download JSON
            </Button>
            <a
              className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-contrast"
              href={`${apiUrl()}/v1/rescues/${rescueId}/proof.pdf`}
              target="_blank"
              rel="noreferrer"
            >
              Download PDF
            </a>
          </div>
        }
      />
      <Q q={q}>
        {(p) => {
          const d = p.facts.debtToken;
          return (
            <div className="space-y-6">
              {p.environment === "LOCAL_SIMULATION" && (
                <div
                  role="note"
                  className="rounded-lg border border-limited/40 bg-limited/10 p-3 text-sm text-limited"
                >
                  LOCAL SIMULATION: these transactions exist only on a private anvil chain, not on a testnet
                  or mainnet.
                </div>
              )}
              <Card
                title="Outcome"
                right={
                  p.outcome.rescued ? (
                    <Badge tone="armed">Rescued</Badge>
                  ) : (
                    <Badge tone="unavailable">Not rescued</Badge>
                  )
                }
              >
                <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
                  <Stat label="Path" value={p.outcome.path ?? "—"} />
                  <Stat
                    label="Health factor"
                    value={`${hf(p.outcome.healthFactorBeforeWad)} → ${hf(p.outcome.healthFactorAfterWad)}`}
                  />
                  <Stat
                    label="Repaid"
                    value={
                      d ? `${units(p.outcome.repaid, d.decimals)} ${d.symbol}` : (p.outcome.repaid ?? "—")
                    }
                  />
                  <Stat
                    label="Fee"
                    value={d ? `${units(p.outcome.fee, d.decimals)} ${d.symbol}` : (p.outcome.fee ?? "—")}
                  />
                  <Stat label="Settlement" value={p.outcome.settlement ?? "none"} />
                </div>
              </Card>
              <Card title="Verification">
                <div className="space-y-2 text-sm">
                  <div>
                    {p.verification.algorithm}:{" "}
                    <span className="font-mono text-xs break-all">{p.verification.contentHash}</span>
                  </div>
                  <div data-testid="proof-verify">
                    {local === undefined ? (
                      "Recomputing in your browser…"
                    ) : local === p.verification.contentHash ? (
                      <Badge tone="armed">Verified in your browser: hash matches the facts</Badge>
                    ) : (
                      <Badge tone="unavailable">Hash mismatch: do not trust this document</Badge>
                    )}
                  </div>
                  <ul className="list-disc pl-5 text-xs text-muted">
                    {p.verification.howTo.map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                </div>
              </Card>
              <Card
                title="On-chain evidence"
                right={
                  p.environment === "LOCAL_SIMULATION" ? (
                    <Provenance kind="local" />
                  ) : (
                    <Provenance kind="onchain" />
                  )
                }
              >
                <ul className="space-y-1 text-xs">
                  {p.facts.executions.map((e) => (
                    <li key={e.txHash}>
                      execution {e.success ? "ok" : "failed"} · {e.path === 1 ? "flash" : "solver"} · block{" "}
                      {e.blockNumber} · <Hash value={e.txHash} />
                    </li>
                  ))}
                  {p.facts.solverFills.map((f) => (
                    <li key={f.txHash}>
                      solver fill <Hash value={f.solver} /> · <Hash value={f.txHash} />
                    </li>
                  ))}
                  {p.facts.settlementEvents.map((e) => (
                    <li key={e.txHash + e.kind}>
                      settlement {e.kind} · chain {e.chainId} · block {e.blockNumber} ·{" "}
                      <Hash value={e.txHash} />
                    </li>
                  ))}
                </ul>
              </Card>
              <p className="text-xs text-muted">
                {p.disclaimer} Generated {new Date(p.generatedAt).toLocaleString()} · {p.schema} ·{" "}
                <Link className="text-accent" href={`/rescues/${p.rescueId}`}>
                  full receipt
                </Link>
              </p>
            </div>
          );
        }}
      </Q>
    </>
  );
}
