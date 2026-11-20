import { describe, expect, it } from "vitest";
import { hf, units, short, bps } from "./format";

describe("format", () => {
  it("formats base units exactly", () => {
    expect(units("2800010200", 6)).toBe("2,800.0102");
    expect(units("13000000000", 6, 2)).toBe("13,000");
    expect(units("10000000000000000000", 18)).toBe("10");
    expect(units(null, 6)).toBe("—");
  });
  it("formats health factors", () => {
    expect(hf("1176923076923076923")).toBe("1.1769");
    expect(hf((2n ** 256n - 1n).toString())).toBe("∞");
  });
  it("shortens hashes and bps", () => {
    expect(short("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x123456…5678");
    expect(bps(50)).toBe("0.50%");
  });
});
