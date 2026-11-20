import type { CSSProperties } from "react";
import type { Address } from "../api-types.js";
import { useProtectionStatus, type ProtectionStatus } from "./hooks.js";

export interface ProtectWithBastionProps {
  /** Borrower account whose lending position should be protected. */
  account?: Address;
  /** Destination chain of the lending position (e.g. 84532 Base Sepolia, 31337 local simulation). */
  chainId?: number;
  /** BASTION web app origin; the button links to its policy wizard. */
  appUrl: string;
  theme?: "dark" | "light";
  /** Refresh interval for the status badge (ms). Default 30 s. */
  refreshMs?: number;
  /** Called instead of navigating, e.g. to open the wizard in a modal. */
  onProtect?: (url: string) => void;
  style?: CSSProperties;
}

const LABEL: Record<ProtectionStatus["status"], string> = {
  ARMED: "Protected · Guardian armed",
  LIMITED: "Protected · limited readiness",
  UNAVAILABLE: "Protection unavailable",
  UNKNOWN: "Protection status unknown",
  UNPROTECTED: "Protect with BASTION",
  PAUSED: "Protection paused",
  REVOKED: "Protection revoked",
};
const TONE: Record<ProtectionStatus["status"], string> = {
  ARMED: "#16a34a",
  LIMITED: "#d97706",
  UNAVAILABLE: "#dc2626",
  UNKNOWN: "#64748b",
  UNPROTECTED: "#2563eb",
  PAUSED: "#d97706",
  REVOKED: "#64748b",
};

/** Builds the policy-wizard deep link the embed opens. */
export function protectUrl(appUrl: string, account?: Address, chainId?: number): string {
  const u = new URL("/policies/new", appUrl);
  if (account) u.searchParams.set("account", account);
  if (chainId) u.searchParams.set("chainId", String(chainId));
  u.searchParams.set("ref", "embed");
  return u.toString();
}

/**
 * Embeddable "Protect with BASTION" button. Shows the live protection state when a policy exists; otherwise links to
 * the policy wizard where the user reviews and signs the policy in their own wallet. Never signs anything itself.
 */
export function ProtectWithBastion({
  account,
  chainId,
  appUrl,
  theme = "dark",
  refreshMs = 30_000,
  onProtect,
  style,
}: ProtectWithBastionProps) {
  const r = useProtectionStatus({ account, chainId }, { refreshMs });
  const dark = theme === "dark";
  const status: ProtectionStatus["status"] = r.data?.status ?? "UNPROTECTED";
  const url = r.data?.policy
    ? new URL(`/policies/${r.data.policy.chainId}/${r.data.policy.policyId}`, appUrl).toString()
    : protectUrl(appUrl, account, chainId);
  const label = !account
    ? "Connect a wallet to protect"
    : r.status === "loading"
      ? "Checking protection…"
      : r.status === "error"
        ? "BASTION status unavailable"
        : LABEL[status];
  const tone = !account || r.status === "error" ? "#64748b" : TONE[status];
  const local = (r.data?.policy?.chainId ?? chainId) === 31337;
  return (
    <a
      href={account ? url : undefined}
      role="button"
      aria-disabled={!account}
      data-bastion-status={account ? (r.status === "success" ? status : r.status) : "no-account"}
      onClick={(e) => {
        if (!account) return e.preventDefault();
        if (onProtect) {
          e.preventDefault();
          onProtect(url);
        }
      }}
      target={onProtect ? undefined : "_blank"}
      rel="noopener noreferrer"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        borderRadius: 10,
        border: `1px solid ${dark ? "#1f2a3a" : "#d6dde8"}`,
        background: dark ? "#0b1220" : "#ffffff",
        color: dark ? "#e6edf7" : "#0b1220",
        font: "600 14px/1.2 ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
        textDecoration: "none",
        cursor: account ? "pointer" : "not-allowed",
        ...style,
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3z" fill={tone} />
      </svg>
      <span>{label}</span>
      {local && (
        <span
          title="Data from a private local anvil chain"
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.4,
            padding: "2px 6px",
            borderRadius: 6,
            background: "#78350f",
            color: "#fde68a",
          }}
        >
          LOCAL SIM
        </span>
      )}
    </a>
  );
}
