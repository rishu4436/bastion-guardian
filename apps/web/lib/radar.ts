import { WAD } from "./format";

/** Collateral price drop (bps) that takes HF to 1.0 when collateral and debt are single assets: 1 − 1/HF. */
export function dropToLiquidationBps(hfWad: bigint): bigint | null {
  if (hfWad <= 0n || hfWad > 10n ** 30n) return null;
  if (hfWad <= WAD) return 0n;
  return ((hfWad - WAD) * 10_000n) / hfWad;
}

export function band(hfWad: bigint): { label: string; tone: "unavailable" | "limited" | "accent" | "armed" } {
  if (hfWad < WAD) return { label: "Liquidatable", tone: "unavailable" };
  if (hfWad < (WAD * 110n) / 100n) return { label: "Critical", tone: "unavailable" };
  if (hfWad < (WAD * 130n) / 100n) return { label: "At risk", tone: "limited" };
  return { label: "Healthy", tone: "armed" };
}
