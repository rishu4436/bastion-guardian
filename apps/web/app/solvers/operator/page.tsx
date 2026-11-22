"use client";

import Link from "next/link";
import { useConnection } from "wagmi";
import { solverRegistryAbi } from "@bastion-guardian/contracts/abis";
import { useApi } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { useDeployments } from "@/lib/deployments";
import { Q, SignInRequired } from "@/components/query";
import { SolverProfileView } from "@/components/solver-profile";
import { TxAction } from "@/components/tx";
import { Amount, Card, Empty, PageHeader, Provenance, Table } from "@/components/ui";
import { bps } from "@/lib/format";

interface Demand {
  policyId: `0x${string}`;
  debtAsset: string;
  requiredRepayAtTrigger: string;
  committedCoverage: string;
  shortfall: string;
  maxFeeBps: number;
  readiness: string;
}

const CHAIN = 31337;

export default function Operator() {
  const { address } = useConnection();
  const { session } = useSession();
  const isSolver = session?.roles.includes("solver");
  const demand = useApi<{ items: Demand[]; note: string }>(
    session ? `/v1/solver/demand?chainId=${CHAIN}` : null,
    {
      refetchInterval: 15_000,
    },
  );
  const schema = useApi<{ domain: Record<string, unknown>; primaryType: string }>(
    session ? `/v1/solver/quote-schema?chainId=${CHAIN}` : null,
  );
  const dep = useDeployments(CHAIN);
  return (
    <>
      <PageHeader
        title="Solver operator dashboard"
        subtitle="Your registration, on-chain commitments, fills and current coverage demand. Quotes are indicative; only on-chain commitments count as coverage."
        right={<Provenance kind="local" />}
      />
      {!session ? (
        <SignInRequired what="open the operator dashboard" />
      ) : !isSolver ? (
        <Empty>
          This wallet is not a registered solver on chain {CHAIN}. Registration is on-chain
          (SolverRegistry.register with a bond); the solver role is derived from it automatically. See the{" "}
          <Link className="text-accent" href="/developers#solvers">
            solver guide
          </Link>
          .
        </Empty>
      ) : (
        <div className="space-y-6">
          <SolverProfileView chainId={CHAIN} address={address!.toLowerCase()} />
          <Card title="Coverage demand">
            <Q
              q={demand}
              isEmpty={(d) => !d.items.length}
              empty="No shortfalls: every armed policy is covered."
            >
              {(d) => (
                <>
                  <Table
                    head={["Policy", "Needed at trigger", "Committed", "Shortfall", "Max fee", "Readiness"]}
                    empty="None."
                    rows={d.items.map((x) => [
                      <Link
                        key="p"
                        className="font-mono text-xs text-accent"
                        href={`/policies/${CHAIN}/${x.policyId}`}
                      >
                        {x.policyId.slice(0, 10)}…
                      </Link>,
                      <Amount key="r" chainId={CHAIN} token={x.debtAsset} raw={x.requiredRepayAtTrigger} />,
                      <Amount key="c" chainId={CHAIN} token={x.debtAsset} raw={x.committedCoverage} />,
                      <Amount key="s" chainId={CHAIN} token={x.debtAsset} raw={x.shortfall} />,
                      bps(x.maxFeeBps),
                      x.readiness,
                    ])}
                  />
                  <p className="mt-2 text-xs text-muted">{d.note}</p>
                </>
              )}
            </Q>
          </Card>
          <Card title="Operate">
            <div className="grid gap-4 md:grid-cols-2">
              <TxAction
                title="Request exit"
                description="Starts the exit delay; your bond unlocks after it. Active commitments must be released first."
                to={dep.data?.contracts.solverRegistry}
                abi={solverRegistryAbi}
                functionName="requestExit"
                args={[]}
                chainId={CHAIN}
                danger
              />
            </div>
            <details className="mt-4 text-xs">
              <summary className="cursor-pointer text-muted">
                EIP-712 quote schema (for solver-node / SDK)
              </summary>
              <pre className="mt-2 overflow-auto rounded bg-bg p-2">
                {JSON.stringify(schema.data ?? schema.error?.message ?? "loading", null, 2)}
              </pre>
            </details>
          </Card>
        </div>
      )}
    </>
  );
}
