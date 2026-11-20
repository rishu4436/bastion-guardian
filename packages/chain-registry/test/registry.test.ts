import { describe, expect, it } from "vitest";
import {
  CHAINS,
  getChain,
  explorerTxUrl,
  deploymentStatus,
  isSupportedChain,
  AAVE_V3_BASE_SEPOLIA,
} from "../src/index.js";

describe("chain registry", () => {
  it("contains exactly the three target networks with verified callback proxies", () => {
    expect(
      Object.keys(CHAINS)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual([1301, 84532, 5318007]);
    expect(getChain(84532).reactiveCallbackProxy).toBe("0x476F44b11F5C942c58f4c8E3d0300E5710743585");
    expect(getChain(1301).reactiveCallbackProxy).toBe("0x775c9B990ADe401060B78D0e98684eEf8d2466C1");
    expect(getChain(5318007).reactiveCallbackProxy).toBe("0x8888888888888888888888888888888888888888");
  });
  it("rejects unsupported chains and malformed hashes", () => {
    expect(() => getChain(1)).toThrow();
    expect(isSupportedChain(1)).toBe(false);
    expect(() => explorerTxUrl(84532, "0x1234")).toThrow();
  });
  it("builds explorer links only for real-looking hashes", () => {
    const h = `0x${"ab".repeat(32)}`;
    expect(explorerTxUrl(84532, h)).toBe(`https://sepolia.basescan.org/tx/${h}`);
  });
  it("reports no BASTION deployments (nothing deployed yet)", () => {
    expect(deploymentStatus("BastionReactiveCore", 5318007)).toBeNull();
  });
  it("pins the official Aave V3 Base Sepolia pool", () => {
    expect(AAVE_V3_BASE_SEPOLIA.pool).toBe("0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27");
  });
});
