import { CHAINS, deploymentStatus, type BastionContractName } from "@bastion-guardian/chain-registry";

const contracts: BastionContractName[] = [
  "BastionReactiveCore",
  "BastionCallbackRouter",
  "BastionPolicyRegistry",
  "CrossChainReserveEscrow",
];

export default function StatusPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <h1 className="text-3xl font-semibold">System status</h1>
      <p className="mt-2 text-sm text-muted">
        Values come from the typed chain registry. A contract shows as deployed only when a deployment record
        with a transaction hash exists.
      </p>
      <div className="mt-8 space-y-4">
        {Object.values(CHAINS).map((c) => (
          <section key={c.id} className="rounded-xl border border-border bg-surface p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-medium">{c.name}</h2>
              <span className="font-mono text-xs text-muted">chainId {c.id}</span>
            </div>
            <p className="mt-1 font-mono text-xs text-muted">
              Reactive callback proxy {c.reactiveCallbackProxy}
            </p>
            <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
              {contracts.map((n) => {
                const d = deploymentStatus(n, c.id);
                return (
                  <li key={n} className="flex justify-between">
                    <span>{n}</span>
                    <span className={d ? "text-armed" : "text-muted"}>{d ? d.address : "not deployed"}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
