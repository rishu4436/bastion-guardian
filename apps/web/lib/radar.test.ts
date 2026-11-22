import { describe, expect, it } from "vitest";
import { band, dropToLiquidationBps } from "./radar";

const W = 10n ** 18n;
describe("liquidation radar math (exact bigint)", () => {
  it("price drop to liquidation is 1 - 1/HF in bps", () => {
    expect(dropToLiquidationBps(2n * W)).toBe(5000n);
    expect(dropToLiquidationBps((W * 125n) / 100n)).toBe(2000n);
    expect(dropToLiquidationBps(W)).toBe(0n);
    expect(dropToLiquidationBps(W / 2n)).toBe(0n);
    expect(dropToLiquidationBps(2n ** 256n - 1n)).toBeNull(); // no debt
  });
  it("bands", () => {
    expect(band(W - 1n).label).toBe("Liquidatable");
    expect(band((W * 105n) / 100n).label).toBe("Critical");
    expect(band((W * 120n) / 100n).label).toBe("At risk");
    expect(band((W * 150n) / 100n).label).toBe("Healthy");
  });
});
