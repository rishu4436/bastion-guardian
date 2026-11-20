"use client";

import type { ReactNode } from "react";
import { ApiError } from "@/lib/api";
import { short, units } from "@/lib/format";
import { useTokens } from "@/lib/hooks";

export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-muted">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function Card({
  title,
  children,
  right,
  className = "",
}: {
  title?: ReactNode;
  children: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-border bg-surface p-5 ${className}`}>
      {(title || right) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-sm font-medium uppercase tracking-wide text-muted">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="tabular mt-1 text-lg font-medium">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

const TONES = {
  armed: "text-armed border-armed/40 bg-armed/10",
  limited: "text-limited border-limited/40 bg-limited/10",
  unavailable: "text-unavailable border-unavailable/40 bg-unavailable/10",
  unknown: "text-unknown border-border bg-raised",
  accent: "text-accent border-accent/40 bg-accent/10",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({
  tone = "unknown",
  children,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

const READINESS: Record<string, { tone: Tone; label: string; help: string }> = {
  ARMED: {
    tone: "armed",
    label: "Armed",
    help: "All Guardian checks pass. Readiness is not a guarantee of rescue success.",
  },
  LIMITED: {
    tone: "limited",
    label: "Limited",
    help: "Protection available with reduced capacity or degraded signals.",
  },
  UNAVAILABLE: {
    tone: "unavailable",
    label: "Unavailable",
    help: "A required component failed: automatic rescue cannot currently run.",
  },
  UNKNOWN: {
    tone: "unknown",
    label: "Unknown",
    help: "Some Guardian inputs could not be read or have not been observed yet.",
  },
};
export function ReadinessBadge({ status }: { status: string | null | undefined }) {
  const r = READINESS[status ?? "UNKNOWN"] ?? READINESS.UNKNOWN!;
  return (
    <Badge tone={r.tone} title={r.help}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {r.label}
    </Badge>
  );
}

/** Every number shown is labeled with where it came from. */
export function Provenance({ kind }: { kind: "onchain" | "local" | "simulated" | "fixture" | "estimate" }) {
  const m = {
    onchain: ["On-chain", "accent"],
    local: ["Local simulation", "limited"],
    simulated: ["Simulated", "limited"],
    fixture: ["Fixture", "limited"],
    estimate: ["Estimate", "unknown"],
  } as const;
  const [label, tone] = m[kind];
  return <Badge tone={tone}>{label}</Badge>;
}

export function Hash({ value, n = 6 }: { value: string | null | undefined; n?: number }) {
  if (!value) return <span className="text-muted">—</span>;
  return (
    <button
      type="button"
      title={`${value} (click to copy)`}
      onClick={() => void navigator.clipboard?.writeText(value)}
      className="font-mono text-xs text-text hover:text-accent"
    >
      {short(value, n)}
    </button>
  );
}

export function Amount({
  chainId,
  token,
  raw,
}: {
  chainId: number;
  token: string | null | undefined;
  raw: string | null | undefined;
}) {
  const { find } = useTokens();
  const t = find(chainId, token);
  if (!t)
    return (
      <span className="tabular" title="token metadata unavailable: raw base units">
        {raw ?? "—"} <span className="text-xs text-muted">units</span>
      </span>
    );
  return (
    <span className="tabular" title={`${raw} base units`}>
      {units(raw, t.decimals)} <span className="text-xs text-muted">{t.symbol}</span>
    </span>
  );
}

export function Table({ head, rows, empty }: { head: ReactNode[]; rows: ReactNode[][]; empty: ReactNode }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
            {head.map((h, i) => (
              <th key={i} className="py-2 pr-4 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border/60 last:border-0">
              {r.map((c, j) => (
                <td key={j} className="tabular py-2.5 pr-4 align-top">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
      {children}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  const e = error instanceof ApiError ? error : null;
  return (
    <div role="alert" className="rounded-lg border border-unavailable/40 bg-unavailable/10 p-4 text-sm">
      <div className="font-medium text-unavailable">{e?.code ?? "Error"}</div>
      <div className="mt-1 text-muted">
        {e?.code === "API_UNREACHABLE"
          ? `${e.message}. No data is shown rather than placeholder values.`
          : e?.code === "DB_UNAVAILABLE"
            ? "The API has no database configured, so no indexed data exists to show."
            : (error as Error)?.message}
      </div>
    </div>
  );
}

export function Loading() {
  return <div className="animate-pulse text-sm text-muted">Loading…</div>;
}

export function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "danger";
  type?: "button" | "submit";
}) {
  const v = {
    primary: "bg-accent text-accent-contrast hover:opacity-90",
    ghost: "border border-border hover:bg-raised",
    danger: "border border-unavailable/50 text-unavailable hover:bg-unavailable/10",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${v}`}
    >
      {children}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="text-muted">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none";
