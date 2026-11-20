import { describe, expect, it } from "vitest";
import { fromDbAmount, normAddress, toDbAmount } from "../src/amounts.js";

describe("amount codecs", () => {
  it("round-trips exact integers", () => {
    for (const v of [0n, 1n, 10n ** 30n + 7n, (1n << 256n) - 1n]) expect(fromDbAmount(toDbAmount(v))).toBe(v);
  });
  it("rejects negatives, overflow, decimals and scientific notation", () => {
    expect(() => toDbAmount(-1n)).toThrow();
    expect(() => toDbAmount(1n << 256n)).toThrow();
    expect(() => fromDbAmount("1.5")).toThrow();
    expect(() => fromDbAmount("1e18")).toThrow();
  });
  it("normalises addresses to lowercase", () => {
    expect(normAddress("0xBA50Cd2A20f6DA35D788639E581bca8d0B5d4D5f")).toBe(
      "0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f",
    );
  });
});
