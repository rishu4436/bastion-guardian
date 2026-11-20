import Link from "next/link";

const steps = [
  ["Observe", "Reactive Network subscribes to authoritative risk events on Base Sepolia."],
  ["Decide", "A Reactive contract validates the policy, deduplicates and triggers a destination callback."],
  ["Rescue", "Flash deleverage or pre-committed solver liquidity repays debt within your signed limits."],
  ["Settle", "The solver-executed event triggers reimbursement from your reserve on Unichain Sepolia."],
] as const;

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-20">
      <p className="text-sm uppercase tracking-[0.2em] text-muted">Reactive Network · Every Second Counts</p>
      <h1 className="mt-4 text-5xl font-semibold tracking-tight">BASTION Guardian</h1>
      <p className="mt-6 max-w-2xl text-lg text-muted">
        Autonomous, non-custodial liquidation protection. Your position is defended by policy-bounded rescue
        paths — and every step is verifiable on-chain.
      </p>
      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        {steps.map(([t, d], i) => (
          <div key={t} className="rounded-xl border border-border bg-surface p-5">
            <div className="text-xs text-muted">0{i + 1}</div>
            <div className="mt-1 text-lg font-medium">{t}</div>
            <p className="mt-2 text-sm text-muted">{d}</p>
          </div>
        ))}
      </div>
      <div className="mt-12 flex gap-4">
        <Link href="/status" className="rounded-lg bg-accent px-5 py-2.5 font-medium text-bg">
          System status
        </Link>
      </div>
      <p className="mt-16 text-xs text-muted">
        Testnet software under active development. Not audited. Readiness indicators are not a guarantee of
        rescue success.
      </p>
    </main>
  );
}
