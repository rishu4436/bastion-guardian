import { CHAINS, deploymentStatus, type BastionContractName } from "@bastion-guardian/chain-registry";
import { SystemStatus } from "./system-status";

const contracts: BastionContractName[] = [
  "BastionReactiveCore",
  "BastionCallbackRouter",
  "BastionPolicyRegistry",
  "CrossChainReserveEscrow",
];

export const metadata = { title: "Status" };

export default function StatusPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">System status</h1>
      <p className="mt-1 text-sm text-muted">
        A contract shows as deployed only when a deployment record with a transaction hash exists in the chain
        registry.
      </p>
      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        {Object.values(CHAINS).map((c) => (
          <section key={c.id} className="rounded-xl border border-border bg-surface p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="font-medium">{c.name}</h2>
              <span className="font-mono text-xs text-muted">chainId {c.id}</span>
            </div>
            <p className="mt-1 break-all font-mono text-xs text-muted">
              Reactive callback proxy {c.reactiveCallbackProxy}
            </p>
            <ul className="mt-3 space-y-1 text-sm">
              {contracts.map((n) => {
                const d = deploymentStatus(n, c.id);
                return (
                  <li key={n} className="flex justify-between gap-2">
                    <span>{n}</span>
                    <span className={d ? "text-armed" : "text-muted"}>{d ? d.address : "not deployed"}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <SystemStatus />
    </>
  );
}
