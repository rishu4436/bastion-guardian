"use client";

import Link from "next/link";
import { useState } from "react";
import { useConnection } from "wagmi";
import { useApi } from "@/lib/hooks";
import { Q } from "@/components/query";
import { PolicyTable, type PolicyRow } from "@/components/policy-table";
import { Card, PageHeader, inputCls } from "@/components/ui";

export default function Policies() {
  const { address } = useConnection();
  const [status, setStatus] = useState("");
  const mine = useApi<{ items: PolicyRow[] }>(address ? `/v1/policies?owner=${address}` : null, {
    refetchInterval: 15_000,
  });
  const all = useApi<{ items: PolicyRow[] }>(`/v1/policies?limit=100${status ? `&status=${status}` : ""}`, {
    refetchInterval: 15_000,
  });
  return (
    <>
      <PageHeader
        title="Protection policies"
        subtitle="Signed, on-chain rescue limits. Public data, indexed from BastionPolicyRegistry events."
        right={
          <Link
            href="/policies/new"
            className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-contrast"
          >
            New policy
          </Link>
        }
      />
      <div className="space-y-6">
        {address && (
          <Card title="Owned by your wallet">
            <Q
              q={mine}
              isEmpty={(d) => !d.items.length}
              empty={
                <>
                  None yet.{" "}
                  <Link className="text-accent" href="/policies/new">
                    Create a policy
                  </Link>
                  .
                </>
              }
            >
              {(d) => <PolicyTable items={d.items} empty="None." />}
            </Q>
          </Card>
        )}
        <Card
          title="All policies"
          right={
            <select
              aria-label="Status filter"
              className={`${inputCls} w-40`}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">Any status</option>
              <option>Active</option>
              <option>Paused</option>
              <option>Revoked</option>
            </select>
          }
        >
          <Q q={all} isEmpty={(d) => !d.items.length} empty="No policies match.">
            {(d) => <PolicyTable items={d.items} empty="None." />}
          </Q>
        </Card>
      </div>
    </>
  );
}
