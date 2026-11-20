export const WAD = 10n ** 18n;

/** Formats an integer string in token base units with the token's decimals; exact (no float rounding). */
export function units(raw: string | null | undefined, decimals: number, maxFrac = 4): string {
  if (raw === null || raw === undefined || raw === "") return "—";
  const v = BigInt(raw);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const int = a / base;
  let frac = (a % base).toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  if (decimals === 0) frac = "";
  return `${neg ? "-" : ""}${int.toLocaleString("en-US")}${frac ? `.${frac}` : ""}`;
}

/** Health factor from WAD; `type(uint256).max` (no debt) renders as ∞. */
export function hf(raw: string | null | undefined): string {
  if (!raw) return "—";
  const v = BigInt(raw);
  if (v > 10n ** 30n) return "∞";
  return units(raw, 18, 4);
}

export const short = (h: string | null | undefined, n = 6) =>
  h ? `${h.slice(0, n + 2)}…${h.slice(-4)}` : "—";

export function ago(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleString();
}

export const bps = (v: number | string) => `${(Number(v) / 100).toFixed(2)}%`;

export const CHAIN_NAMES: Record<number, string> = {
  31337: "Local Anvil (simulation)",
  84532: "Base Sepolia",
  1301: "Unichain Sepolia",
  5318007: "Reactive Lasna",
};
export const isLocal = (chainId: number) => chainId === 31337;
