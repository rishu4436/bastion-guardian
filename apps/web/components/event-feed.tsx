"use client";

import Link from "next/link";
import { useStream } from "@/lib/use-stream";
import { Amount, Badge, Card, Empty, Hash, ReadinessBadge } from "./ui";
import { hf } from "@/lib/format";

export function EventFeed({
  chainId,
  policyId,
  title = "Live events",
}: {
  chainId?: number;
  policyId?: string;
  title?: string;
}) {
  const { events, state } = useStream({ chainId, policyId });
  const shown = events.filter((e) => e.event !== "hello");
  return (
    <Card
      title={title}
      right={
        <Badge tone={state === "open" ? "armed" : state === "error" ? "unavailable" : "unknown"}>
          {state === "open" ? "streaming" : state === "error" ? "disconnected (retrying)" : "connecting"}
        </Badge>
      }
    >
      {shown.length === 0 ? (
        <Empty>
          No new events since this page opened. Events appear here as the indexer records them on-chain.
        </Empty>
      ) : (
        <ul className="space-y-2" data-testid="event-feed">
          {shown.map((e, i) => (
            <li
              key={i}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 px-3 py-2 text-sm"
            >
              <Badge
                tone={
                  e.event.startsWith("rescue")
                    ? "accent"
                    : e.event.startsWith("incident")
                      ? "unavailable"
                      : "unknown"
                }
              >
                {e.event}
              </Badge>
              <EventBody e={e.event} d={e.data} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function EventBody({ e, d }: { e: string; d: Record<string, unknown> }) {
  const chainId = Number(d.chainId ?? 0);
  if (e === "risk.observed")
    return (
      <span>
        HF <span className="tabular">{hf(d.healthFactorWad as string)}</span> crossed trigger{" "}
        <span className="tabular">{hf(d.triggerHealthFactorWad as string)}</span> · account{" "}
        <Hash value={d.account as string} />
      </span>
    );
  if (e === "rescue.executed")
    return (
      <span>
        {d.path === 1 ? "Flash" : "Solver"} rescue {d.success ? "executed" : "failed"} · repaid{" "}
        <Amount chainId={chainId} token={null} raw={d.repaid as string} /> · HF{" "}
        {hf(d.healthFactorBeforeWad as string)} → {hf(d.healthFactorAfterWad as string)} ·{" "}
        <Link className="text-accent hover:underline" href={`/rescues/${d.rescueId as string}`}>
          receipt
        </Link>
      </span>
    );
  if (e === "settlement.event")
    return (
      <span>
        Settlement <b>{String(d.kind)}</b> · rescue{" "}
        <Link
          className="font-mono text-xs text-accent hover:underline"
          href={`/rescues/${d.rescueId as string}`}
        >
          {String(d.rescueId).slice(0, 10)}…
        </Link>
      </span>
    );
  if (e === "readiness.updated")
    return (
      <span className="flex items-center gap-2">
        Policy <Hash value={d.policyId as string} /> <ReadinessBadge status={d.status as string} />
      </span>
    );
  return <span>{String(d.title ?? JSON.stringify(d))}</span>;
}
