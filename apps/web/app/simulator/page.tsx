"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import {
  Badge,
  Button,
  Card,
  ErrorBox,
  Field,
  Loading,
  PageHeader,
  Provenance,
  Stat,
  Table,
  inputCls,
} from "@/components/ui";
import { hf, units } from "@/lib/format";

const KINDS = [
  ["price_shock", "Price shock"],
  ["multi_step_crash", "Multi-step crash"],
  ["oracle_delay", "Oracle delay"],
  ["liquidity_deterioration", "Venue liquidity deterioration"],
  ["solver_liquidity_disappearance", "Solver liquidity disappears"],
  ["callback_delay", "Callback delay"],
  ["callback_failure", "Callback failure"],
  ["reactive_balance_depletion", "Reactive balance depleted"],
  ["flash_unavailable", "Flash loan unavailable"],
  ["partial_rescue", "Partial rescue"],
  ["concurrent_repayment", "Concurrent user repayment"],
  ["settlement_delay", "Settlement delay"],
] as const;

interface PathReport {
  feasible: boolean;
  reason: string | null;
  repay: string;
  fee: string;
  collateralSold: string;
  surplusToBorrower: string;
  capitalRequired: string;
  resultingHf: string | null;
}
interface Result {
  result: {
    label: string;
    forecast: boolean;
    initial: { healthFactor: string };
    shocked: { healthFactor: string };
    liquidationPrice: string | null;
    triggered: boolean;
    liquidatable: boolean;
    requiredRepay: string;
    outcome: string;
    resultingHf: string;
    timeToProtectionSec: number | null;
    failureConditions: string[];
    recoveryOptions: string[];
    flash: PathReport;
    solver: PathReport;
  };
  comparison: {
    unprotected: { hf: string; liquidatable: boolean };
    manual: { repayNeeded: string; hf: string };
  };
  disclaimer: string;
}

function spec(kind: string, shockBps: number, delaySec: number) {
  switch (kind) {
    case "multi_step_crash":
      return { kind, stepsBps: [shockBps / 2, shockBps / 2].map(Math.round) };
    case "oracle_delay":
      return { kind, shockBps, delaySec, driftDuringDelayBps: 100 };
    case "liquidity_deterioration":
      return { kind, shockBps, venueExecutionCostBps: "400" };
    case "solver_liquidity_disappearance":
      return { kind, shockBps, remainingFraction: 0 };
    case "callback_delay":
      return { kind, shockBps, delaySec };
    case "callback_failure":
      return { kind, shockBps, failedPath: "flash" };
    case "partial_rescue":
      return { kind, shockBps, remainingRepay: "1000000000" };
    case "concurrent_repayment":
      return { kind, shockBps, userRepay: "1000000000" };
    case "settlement_delay":
      return { kind, shockBps, delaySec, reserveUnderfunded: true };
    default:
      return { kind, shockBps };
  }
}

const usdc = (v: string | null | undefined) => (v ? `${units(v, 6)} fUSDC` : "—");

function Path({ title, p }: { title: string; p: PathReport }) {
  return (
    <Card
      title={title}
      right={
        p.feasible ? (
          <Badge tone="armed">feasible</Badge>
        ) : (
          <Badge tone="unavailable">{p.reason ?? "infeasible"}</Badge>
        )
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Repay" value={usdc(p.repay)} />
        <Stat label="Fee" value={usdc(p.fee)} />
        <Stat label="Capital fronted" value={usdc(p.capitalRequired)} />
        <Stat label="Resulting HF" value={hf(p.resultingHf)} />
        <Stat
          label="Collateral sold"
          value={p.collateralSold === "0" ? "0" : `${units(p.collateralSold, 18)} fWETH`}
        />
        <Stat label="Surplus to borrower" value={usdc(p.surplusToBorrower)} />
      </div>
    </Card>
  );
}

export default function Simulator() {
  const presets = useApi<{ presets: { id: string; label: string; base: Record<string, unknown> }[] }>(
    "/v1/simulations/presets",
    { staleTime: Infinity },
  );
  const [kind, setKind] = useState("price_shock");
  const [shock, setShock] = useState(1000);
  const [delay, setDelay] = useState(60);
  const run = useMutation({
    mutationFn: () =>
      api<Result>("/v1/simulations/scenario", {
        method: "POST",
        json: { base: presets.data!.presets[0]!.base, spec: spec(kind, shock, delay) },
      }),
  });
  const r = run.data?.result;
  return (
    <>
      <PageHeader
        title="Stress simulator"
        subtitle="Runs the BASTION rescue model (bit-exact with the Foundry vectors) on a labeled fixture position. Results are hypothetical and are not a guarantee of rescue."
        right={<Provenance kind="simulated" />}
      />
      <Card title="Scenario">
        {presets.isLoading ? (
          <Loading />
        ) : presets.error ? (
          <ErrorBox error={presets.error} />
        ) : (
          <form
            className="grid items-end gap-4 md:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              run.mutate();
            }}
          >
            <Field label="Position" hint="Fixture market, not a live position">
              <div className="rounded-lg border border-border bg-raised px-3 py-2 text-sm">
                {presets.data!.presets[0]!.label}
              </div>
            </Field>
            <Field label="Scenario">
              <select
                aria-label="Scenario"
                className={inputCls}
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                {KINDS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={`Collateral price shock: ${(shock / 100).toFixed(0)}%`}>
              <input
                aria-label="Shock"
                type="range"
                min={0}
                max={6000}
                step={100}
                value={shock}
                onChange={(e) => setShock(Number(e.target.value))}
                className="w-full accent-[var(--accent)]"
              />
            </Field>
            <div className="flex items-end gap-3">
              {["oracle_delay", "callback_delay", "settlement_delay"].includes(kind) && (
                <Field label="Delay (s)">
                  <input
                    className={inputCls}
                    type="number"
                    min={0}
                    max={86400}
                    value={delay}
                    onChange={(e) => setDelay(Number(e.target.value))}
                  />
                </Field>
              )}
              <Button type="submit" disabled={run.isPending}>
                {run.isPending ? "Running…" : "Run scenario"}
              </Button>
            </div>
          </form>
        )}
      </Card>
      {run.error && (
        <div className="mt-6">
          <ErrorBox error={run.error} />
        </div>
      )}
      {r && (
        <div className="mt-6 space-y-6" data-testid="sim-result">
          <Card
            title={r.label}
            right={
              <span className="flex gap-2">
                {r.forecast && <Badge tone="limited">forecast</Badge>}
                <Provenance kind="simulated" />
              </span>
            }
          >
            <div className="grid grid-cols-2 gap-4 md:grid-cols-6">
              <Stat label="HF before" value={hf(r.initial.healthFactor)} />
              <Stat
                label="HF after shock"
                value={hf(r.shocked.healthFactor)}
                hint={r.liquidatable ? "liquidatable" : r.triggered ? "trigger crossed" : "above trigger"}
              />
              <Stat label="Outcome" value={<span data-testid="sim-outcome">{r.outcome}</span>} />
              <Stat label="HF after rescue" value={hf(r.resultingHf)} />
              <Stat label="Required repay" value={usdc(r.requiredRepay)} />
              <Stat
                label="Liquidation price"
                value={r.liquidationPrice ? `$${units(r.liquidationPrice, 8, 2)}` : "—"}
                hint="fWETH, oracle base units"
              />
            </div>
            {r.failureConditions.length > 0 && (
              <div className="mt-4 text-sm">
                <div className="text-muted">Failure conditions</div>
                <ul className="mt-1 list-inside list-disc text-limited">
                  {r.failureConditions.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            )}
            {r.recoveryOptions.length > 0 && (
              <p className="mt-3 text-sm text-muted">Recovery: {r.recoveryOptions.join(" · ")}</p>
            )}
          </Card>
          <div className="grid gap-6 md:grid-cols-2">
            <Path title="Flash deleverage path" p={r.flash} />
            <Path title="Solver liquidity path" p={r.solver} />
          </div>
          <Card title="Versus doing nothing">
            <Table
              head={["Strategy", "Health factor", "Note"]}
              empty=""
              rows={[
                [
                  "Unprotected",
                  hf(run.data!.comparison.unprotected.hf),
                  run.data!.comparison.unprotected.liquidatable
                    ? "liquidatable"
                    : "not yet liquidatable at this shock; no buffer restored",
                ],
                [
                  "Manual repay to target",
                  hf(run.data!.comparison.manual.hf),
                  `needs ${usdc(run.data!.comparison.manual.repayNeeded)} in wallet`,
                ],
                ["BASTION", hf(r.resultingHf), r.outcome],
              ]}
            />
            <p className="mt-3 text-xs text-muted">{run.data!.disclaimer}</p>
          </Card>
        </div>
      )}
    </>
  );
}
