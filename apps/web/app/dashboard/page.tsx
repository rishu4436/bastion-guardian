"use client";

import { useConnection } from "wagmi";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/hooks";
import { Card, ErrorBox, Loading, PageHeader } from "@/components/ui";
import { PolicyTable, type PolicyRow } from "@/components/policy-table";
import { EventFeed } from "@/components/event-feed";

export default function Dashboard() {
  const { address, isConnected } = useConnection();
  const { session } = useSession();
  const owner = session?.address ?? address?.toLowerCase();
  const mine = useApi<{ items: PolicyRow[] }>(owner ? `/v1/policies?owner=${owner}` : null);
  const all = useApi<{ items: PolicyRow[] }>("/v1/policies?limit=20");
  const incidents = useApi<{ items: { id: string; title: string; severity: string }[] }>(
    session ? "/v1/me/incidents" : null,
  );

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={
          owner
            ? "Policies owned by your wallet, with live Guardian readiness. Sign in to manage notifications."
            : "Connect a wallet to see the policies it owns. Public policy data is listed below."
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {isConnected && (
            <Card title="Your policies">
              {mine.isLoading ? (
                <Loading />
              ) : mine.error ? (
                <ErrorBox error={mine.error} />
              ) : (
                <PolicyTable
                  items={mine.data?.items ?? []}
                  empty="This wallet owns no registered policies on indexed chains."
                />
              )}
            </Card>
          )}
          {session && incidents.data && incidents.data.items.length > 0 && (
            <Card title="Open incidents on your policies">
              <ul className="space-y-1 text-sm">
                {incidents.data.items.map((i) => (
                  <li key={i.id} className={i.severity === "critical" ? "text-unavailable" : "text-limited"}>
                    {i.title}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title="Recently registered policies (all owners)">
            {all.isLoading ? (
              <Loading />
            ) : all.error ? (
              <ErrorBox error={all.error} />
            ) : (
              <PolicyTable items={all.data?.items ?? []} empty="No policies have been indexed yet." />
            )}
          </Card>
        </div>
        <EventFeed />
      </div>
    </>
  );
}
