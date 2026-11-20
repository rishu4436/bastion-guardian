import { describe, expect, it } from "vitest";
import { assertWriteAllowed, chainFor, runLoop, newStatus, toJsonSafe } from "../src/index.js";

describe("service-kit guards", () => {
  it("never allows mainnet chains", () => {
    expect(() => chainFor(1)).toThrow(/not allowlisted/);
    expect(() => chainFor(8453)).toThrow(/not allowlisted/);
    expect(() => assertWriteAllowed(1, "http://127.0.0.1:8545")).toThrow();
  });
  it("allows local writes only via localhost RPC", () => {
    expect(() => assertWriteAllowed(31337, "http://127.0.0.1:8645")).not.toThrow();
    expect(() => assertWriteAllowed(31337, "https://evil.example")).toThrow(/localhost/);
  });
  it("requires explicit live-execution authorization for testnets", () => {
    expect(() => assertWriteAllowed(84532, "https://sepolia.base.org", {})).toThrow(/ENABLE_LIVE_EXECUTION/);
    expect(() =>
      assertWriteAllowed(84532, "https://sepolia.base.org", { ENABLE_LIVE_EXECUTION: "true" }),
    ).not.toThrow();
  });
  it("loop survives failing ticks and records status", async () => {
    const ac = new AbortController();
    const st = newStatus("t");
    let n = 0;
    await runLoop(
      {
        name: "t",
        intervalMs: 1,
        maxBackoffMs: 2,
        signal: ac.signal,
        tick: async () => {
          if (++n === 1) throw new Error("boom");
          if (n >= 3) ac.abort();
        },
      },
      st,
    );
    expect(st.ticks).toBe(3);
    expect(st.lastError).toBe("boom");
    expect(st.consecutiveFailures).toBe(0);
  });
  it("serializes bigints exactly", () => {
    expect(toJsonSafe({ a: 2n ** 255n })).toEqual({ a: (2n ** 255n).toString() });
  });
});
