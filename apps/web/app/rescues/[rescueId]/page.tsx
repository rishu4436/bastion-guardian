"use client";

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
  Stat,
  Table,
} from "@/components/ui";
import { CHAIN_NAMES, hf, isLocal } from "@/lib/format";

interface Receipt {
  intent: {
    rescueId: string;
    chainId: number;
    policyId: string;
    state: string;
    originTxHash: string | null;
    reactiveTxHash: string | null;
  } | null;
  executions: {
    chainId: number;
    path: number;
    success: boolean;
    reason: string | null;
    repaid: string | null;
    fee: string | null;
    debtBefore: string | null;
    debtAfter: string | null;
    healthFactorBeforeWad: string | null;
    healthFactorAfterWad: string | null;
    txHash: string;
    blockNumber: string;
    solver: string | null;
  }[];
  solverFills: { solver: string; principal: string; fee: string; txHash: string }[];
  settlementClaim: {
    state: string;
    principal: string;
    fee: string;
    attempts: number;
    lastError: string | null;
    reserveChainId: number;
    recipient: string;
  } | null;
  settlementEvents: {
    kind: string;
    txHash: string;
    blockNumber: string;
    logIndex: number;
    chainId: number;
  }[];
}

export default function RescuePage() {
  const { rescueId } = useParams<{ rescueId: string }>();
  const q = useApi<Receipt>(`/v1/rescues/${rescueId}`, { refetchInterval: 10_000 });
  const policy = useApi<{ policy: { debtAsset: string } }>(
    q.data?.intent ? `/v1/policies/${q.data.intent.chainId}/${q.data.intent.policyId}` : null,
  );
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const r = q.data!;
  const cid = r.intent?.chainId ?? r.executions[0]?.chainId ?? 0;
  const debt = policy.data?.policy.debtAsset;
  return (
    <>
      <PageHeader
        title="Rescue receipt"
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Hash value={rescueId} n={10} /> · {CHAIN_NAMES[cid] ?? cid}{" "}
            {isLocal(cid) ? <Provenance kind="local" /> : <Provenance kind="onchain" />}
          </span>
        }
        right={
          r.intent && (
            <Badge tone={r.intent.state === "ReimbursementComplete" ? "armed" : "accent"}>
              {r.intent.state}
            </Badge>
          )
        }
      />
      <div className="space-y-6">
        <Card title="Execution">
          <Table
            head={["Path", "Result", "Repaid", "Fee", "Debt", "Health factor", "Tx"]}
            empty="No destination execution recorded yet."
            rows={r.executions.map((e) => [
              e.path === 1 ? "Flash deleverage" : "Solver liquidity",
              e.success ? (
                <Badge key="s" tone="armed">
                  success
                </Badge>
              ) : (
                <Badge key="s" tone="unavailable">
                  {e.reason ?? "failed"}
                </Badge>
              ),
              <Amount key="r" chainId={e.chainId} token={debt} raw={e.repaid} />,
              <Amount key="f" chainId={e.chainId} token={debt} raw={e.fee} />,
              <span key="d">
                <Amount chainId={e.chainId} token={debt} raw={e.debtBefore} /> →{" "}
                <Amount chainId={e.chainId} token={debt} raw={e.debtAfter} />
              </span>,
              <span key="h" className="tabular">
                {hf(e.healthFactorBeforeWad)} → {hf(e.healthFactorAfterWad)}
              </span>,
              <Hash key="t" value={e.txHash} />,
            ])}
          />
        </Card>
        {r.solverFills.length > 0 && (
          <Card title="Solver fill">
            {r.solverFills.map((f) => (
              <div key={f.txHash} className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <Stat label="Solver" value={<Hash value={f.solver} />} />
                <Stat
                  label="Principal fronted"
                  value={<Amount chainId={cid} token={debt} raw={f.principal} />}
                />
                <Stat label="Solver fee" value={<Amount chainId={cid} token={debt} raw={f.fee} />} />
                <Stat label="Tx" value={<Hash value={f.txHash} />} />
              </div>
            ))}
          </Card>
        )}
        <Card title="Cross-chain settlement">
          {r.settlementClaim ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
              <Stat
                label="Claim state"
                value={
                  <Badge
                    tone={
                      r.settlementClaim.state === "Reimbursed"
                        ? "armed"
                        : r.settlementClaim.state === "Pending"
                          ? "accent"
                          : "unavailable"
                    }
                  >
                    {r.settlementClaim.state}
                  </Badge>
                }
              />
              <Stat
                label="Principal"
                value={
                  <Amount
                    chainId={r.settlementClaim.reserveChainId}
                    token={debt}
                    raw={r.settlementClaim.principal}
                  />
                }
              />
              <Stat
                label="Fee"
                value={
                  <Amount
                    chainId={r.settlementClaim.reserveChainId}
                    token={debt}
                    raw={r.settlementClaim.fee}
                  />
                }
              />
              <Stat label="Attempts" value={r.settlementClaim.attempts} />
              <Stat label="Recipient" value={<Hash value={r.settlementClaim.recipient} />} />
            </div>
          ) : (
            <p className="text-sm text-muted">Flash rescues are self-funded and need no settlement.</p>
          )}
          <div className="mt-5">
            <Table
              head={["Event", "Chain", "Block", "Tx"]}
              empty="No settlement events."
              rows={r.settlementEvents.map((e) => [
                e.kind,
                CHAIN_NAMES[e.chainId] ?? e.chainId,
                e.blockNumber,
                <Hash key="t" value={e.txHash} />,
              ])}
            />
          </div>
        </Card>
      </div>
    </>
  );
}
