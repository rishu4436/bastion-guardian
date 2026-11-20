"use client";

import { useApi } from "@/lib/hooks";
import { Badge, Card, ErrorBox, Hash, Loading, Table } from "@/components/ui";
import { CHAIN_NAMES, ago } from "@/lib/format";
import { apiUrl } from "@/lib/api";

interface Sys {
  liveExecutionEnabled: boolean;
  mainnetEnabled: boolean;
  database: boolean;
  checkpoints: {
    chainId: number;
    stream: string;
    lastBlock: string;
    lastBlockHash: string;
    updatedAt: string;
  }[];
  deployments: {
    chainId: number;
    contractName: string;
    address: string;
    mode: string;
    txHash: string | null;
  }[];
}

export function SystemStatus() {
  const q = useApi<Sys>("/v1/system/status", { refetchInterval: 10_000 });
  return (
    <div className="mt-8">
      <Card
        title="Off-chain services"
        right={
          <a className="text-xs text-accent hover:underline" href={`${apiUrl()}/docs`}>
            API docs (OpenAPI)
          </a>
        }
      >
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              <Badge tone={q.data!.database ? "armed" : "unavailable"}>
                database {q.data!.database ? "connected" : "not configured"}
              </Badge>
              <Badge tone={q.data!.liveExecutionEnabled ? "limited" : "armed"}>
                live execution {q.data!.liveExecutionEnabled ? "ENABLED" : "disabled"}
              </Badge>
              <Badge tone="armed">mainnet disabled</Badge>
            </div>
            <Table
              head={["Chain", "Indexer stream", "Last block", "Hash", "Updated"]}
              empty="The chain indexer has not recorded a checkpoint yet."
              rows={q.data!.checkpoints.map((c) => [
                CHAIN_NAMES[c.chainId] ?? c.chainId,
                c.stream,
                c.lastBlock,
                <Hash key="h" value={c.lastBlockHash} />,
                <span key="u" className="text-xs text-muted">
                  {ago(c.updatedAt)}
                </span>,
              ])}
            />
            <div className="mt-5">
              <Table
                head={["Chain", "Contract", "Address", "Mode", "Deploy tx"]}
                empty="No deployment records."
                rows={q.data!.deployments.map((d) => [
                  CHAIN_NAMES[d.chainId] ?? d.chainId,
                  d.contractName,
                  <Hash key="a" value={d.address} />,
                  <Badge key="m" tone={d.mode === "testnet" ? "accent" : "limited"}>
                    {d.mode}
                  </Badge>,
                  <Hash key="t" value={d.txHash} />,
                ])}
              />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
