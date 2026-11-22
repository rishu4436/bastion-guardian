import { describe, expect, it } from "vitest";
import { WAD } from "./format";
import { hfSeries } from "./positions";

describe("hfSeries", () => {
  it("needs at least two observations", () => {
    expect(hfSeries([])).toBeNull();
    expect(hfSeries([WAD])).toBeNull();
  });
  it("maps min to the bottom and max to the top, and places the liquidation line when in range", () => {
    const s = hfSeries([WAD * 2n, WAD / 2n], 600, 160, 8)!;
    expect(s.points).toBe("0.0,8.0 600.0,152.0");
    expect(s.liquidationY).toBeCloseTo(104, 0);
    expect(s.count).toBe(2);
  });
  it("omits the liquidation line when every observation is healthy, and clamps idle outliers", () => {
    const s = hfSeries([WAD * 2n, WAD * 3n, 10n ** 30n])!;
    expect(s.liquidationY).toBeNull();
    expect(s.points.split(" ")).toHaveLength(3);
  });
  it("handles a flat series without dividing by zero", () => {
    expect(hfSeries([WAD, WAD])!.points).toBe("0.0,8.0 600.0,8.0");
  });
});
