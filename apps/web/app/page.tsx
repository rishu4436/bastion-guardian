import Link from "next/link";

const steps = [
  ["Observe", "Reactive Network subscribes to authoritative risk events emitted on the lending chain."],
  [
    "Decide",
    "A Reactive contract validates your signed policy, deduplicates and rate-limits, then triggers an authenticated destination callback.",
  ],
  [
    "Rescue",
    "Flash deleverage or pre-committed solver liquidity repays debt to your target health factor, never beyond your signed limits.",
  ],
  [
    "Settle",
    "The solver-executed event triggers reimbursement from your reserve on the settlement chain, exactly once.",
  ],
] as const;

const facts = [
  [
    "Non-custodial",
    "Collateral stays in your lending position. Executors hold no funds after a rescue (enforced by invariant tests).",
  ],
  [
    "Policy-bounded",
    "EIP-712 policies cap repay per action, total repay, fees and slippage. Revoke at any time.",
  ],
  ["Verifiable", "Every rescue has an on-chain receipt: trigger, execution, fill and settlement events."],
] as const;

export default function Home() {
  return (
    <div className="py-6">
      <p className="text-xs uppercase tracking-[0.2em] text-muted">
        Reactive Network · Cross-chain liquidation protection
      </p>
      <h1 className="mt-4 max-w-3xl text-5xl font-semibold tracking-tight">
        Your position, defended before the liquidator arrives.
      </h1>
      <p className="mt-6 max-w-2xl text-lg text-muted">
        BASTION Guardian watches your lending position and, when your health factor crosses the trigger you
        chose, repays debt through the cheapest feasible path, within limits you signed.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/dashboard" className="rounded-lg bg-accent px-5 py-2.5 font-medium text-accent-contrast">
          Open dashboard
        </Link>
        <Link href="/simulator" className="rounded-lg border border-border px-5 py-2.5 font-medium">
          Run a stress scenario
        </Link>
        <Link href="/status" className="rounded-lg border border-border px-5 py-2.5 font-medium">
          Deployment status
        </Link>
      </div>
      <div className="mt-14 grid gap-4 md:grid-cols-4">
        {steps.map(([t, d], i) => (
          <div key={t} className="rounded-xl border border-border bg-surface p-5">
            <div className="text-xs text-muted">0{i + 1}</div>
            <div className="mt-1 text-lg font-medium">{t}</div>
            <p className="mt-2 text-sm text-muted">{d}</p>
          </div>
        ))}
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {facts.map(([t, d]) => (
          <div key={t} className="rounded-xl border border-border p-5">
            <div className="font-medium">{t}</div>
            <p className="mt-2 text-sm text-muted">{d}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
