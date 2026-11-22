/**
 * Pure view-model logic for the mobile companion. Everything here is exact (bigint) and derived only from API data;
 * nothing is invented when data is missing.
 */

export const WAD = 10n ** 18n;
const MAX_HF = 10n ** 30n; // type(uint256).max-ish sentinel used for "no debt"

export function isAddress(s: string): s is `0x${string}` {
  return /^0x[0-9a-fA-F]{40}$/.test(s.trim());
}

/** Accepts only http(s) origins; returns the origin without a trailing slash, or null. */
export function normalizeUrl(s: string): string | null {
  try {
    const u = new URL(s.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

export function units(raw: string | null | undefined, decimals: number, maxFrac = 4): string {
  if (raw === null || raw === undefined || !/^\d+$/.test(raw)) return "—";
  const v = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  let frac = (v % base).toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  if (decimals === 0) frac = "";
  const w = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${w}.${frac}` : w;
}

export function hf(raw: string | null | undefined): string {
  if (!raw || !/^\d+$/.test(raw)) return "—";
  return BigInt(raw) > MAX_HF ? "∞" : units(raw, 18, 4);
}

export type Band = "Liquidatable" | "Critical" | "At risk" | "Healthy";
export function band(hfWad: bigint): Band {
  if (hfWad < WAD) return "Liquidatable";
  if (hfWad < (WAD * 110n) / 100n) return "Critical";
  if (hfWad < (WAD * 130n) / 100n) return "At risk";
  return "Healthy";
}

export type Tone = "good" | "warn" | "bad" | "muted";
export function readinessTone(status: string | null | undefined): Tone {
  if (status === "ARMED") return "good";
  if (status === "LIMITED") return "warn";
  if (status === "UNAVAILABLE") return "bad";
  return "muted";
}

export interface PolicyLite {
  chainId: number;
  policyId: string;
  account: string;
  status: string;
  readiness?: { status: string; evaluatedAt: string } | null;
}
export interface PositionLite {
  id: string;
  chainId: number;
  account: string;
  healthFactorWad: string;
  observedAt: string;
}
export interface RescueLite {
  rescueId: string;
  chainId: number;
  policyId: string;
  state: string;
  updatedAt: string;
  executions?: { success: boolean; path: number }[];
}

export interface Alert {
  key: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  at: string;
  ref:
    | { kind: "position"; id: string }
    | { kind: "policy"; chainId: number; policyId: string }
    | { kind: "rescue"; id: string };
}

const SEV = { critical: 0, warning: 1, info: 2 } as const;

/** Rescue states that need the owner's attention (names match the on-chain RescueState enum). */
export const RESCUE_PROBLEM_STATES = new Set([
  "ExecutionFailed",
  "ReimbursementDisputed",
  "RecoveryRequired",
  "Expired",
  "Cancelled",
]);

/** Derives an alert inbox from indexed data: risky positions, non-armed active policies, and rescue outcomes. */
export function buildAlerts(input: {
  policies: PolicyLite[];
  positions: PositionLite[];
  rescues: RescueLite[];
}): Alert[] {
  const out: Alert[] = [];
  for (const p of input.positions) {
    if (!/^\d+$/.test(p.healthFactorWad)) continue;
    const b = band(BigInt(p.healthFactorWad));
    if (b === "Healthy") continue;
    out.push({
      key: `pos:${p.id}`,
      severity: b === "At risk" ? "warning" : "critical",
      title: `${b} position · HF ${hf(p.healthFactorWad)}`,
      detail: `Account ${short(p.account)} on chain ${p.chainId}`,
      at: p.observedAt,
      ref: { kind: "position", id: p.id },
    });
  }
  for (const p of input.policies) {
    if (p.status !== "Active") continue;
    const s = p.readiness?.status ?? "UNKNOWN";
    if (s === "ARMED") continue;
    out.push({
      key: `pol:${p.chainId}:${p.policyId}`,
      severity: s === "UNAVAILABLE" ? "critical" : "warning",
      title: `Protection ${s}`,
      detail: `Policy ${short(p.policyId)} is not fully armed; open it to see which readiness check failed.`,
      at: p.readiness?.evaluatedAt ?? "",
      ref: { kind: "policy", chainId: p.chainId, policyId: p.policyId },
    });
  }
  for (const r of input.rescues) {
    const ok = r.executions?.some((e) => e.success) ?? false;
    out.push({
      key: `res:${r.rescueId}`,
      severity: RESCUE_PROBLEM_STATES.has(r.state) ? "critical" : "info",
      title: ok ? `Rescue executed · ${r.state}` : `Rescue ${r.state}`,
      detail: `Policy ${short(r.policyId)} on chain ${r.chainId}`,
      at: r.updatedAt,
      ref: { kind: "rescue", id: r.rescueId },
    });
  }
  return out.sort((a, b) => SEV[a.severity] - SEV[b.severity] || (b.at > a.at ? 1 : b.at < a.at ? -1 : 0));
}

export function short(h: string | null | undefined, n = 6): string {
  return h ? `${h.slice(0, n + 2)}…${h.slice(-4)}` : "—";
}

/**
 * Signing never happens in this app: actions open the BASTION web app, where the user's own wallet signs. These are
 * the only deep links the app builds.
 */
export const webLinks = {
  emergency: (web: string) => `${web}/emergency`,
  newPolicy: (web: string, account?: string) =>
    account ? `${web}/policies/new?account=${account}` : `${web}/policies/new`,
  policy: (web: string, chainId: number, policyId: string) => `${web}/policies/${chainId}/${policyId}`,
  position: (web: string, id: string) => `${web}/positions/${id}`,
  proof: (web: string, rescueId: string) => `${web}/proof/${rescueId}`,
  rescue: (web: string, rescueId: string) => `${web}/rescues/${rescueId}`,
};

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
