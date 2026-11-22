import { describe, expect, it } from "vitest";
import {
  CHAINS,
  getChain,
  explorerTxUrl,
  deploymentStatus,
  isSupportedChain,
  AAVE_V3_BASE_SEPOLIA,
  TESTNET_DEPLOYMENTS,
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
  it("reports the recorded testnet deployments and nothing else", () => {
    expect(deploymentStatus("BastionReactiveCore", 5318007)?.address).toBe(
      "0x811111D0a5DaBBD16180Ba42d11992863EF17e33",
    );
    expect(deploymentStatus("BastionCallbackRouter", 84532)?.block).toBe(62051422);
    expect(deploymentStatus("CrossChainReserveEscrow", 1301)?.txHash).toBe(
      "0x1a72737aab18093c2924364ffdefbdb21887f5272cf6a72ba90f9b500e699214",
    );
    // the official-pool adapter, not the fixture-market adapter
    expect(deploymentStatus("AaveV3LendingAdapter", 84532)?.address).toBe(
      "0x811111D0a5DaBBD16180Ba42d11992863EF17e33",
    );
    expect(deploymentStatus("BastionCallbackRouter", 5318007)).toBeNull();
    expect(deploymentStatus("BastionReactiveCore", 84532)).toBeNull();
  });
  it("keeps every testnet record well-formed, unique per chain and on a supported chain", () => {
    const seen = new Set<string>();
    for (const d of TESTNET_DEPLOYMENTS) {
      expect(isSupportedChain(d.chainId)).toBe(true);
      expect(d.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(d.txHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(d.block).toBeGreaterThan(0);
      const k = `${d.chainId}:${d.key}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
    expect(
      TESTNET_DEPLOYMENTS.filter((d) => d.fixture)
        .map((d) => d.key)
        .sort(),
    ).toEqual(
      ["fUSDC", "fWETH", "fixtureAdapter", "fixtureMarket", "fixtureOracle", "fixtureVenue", "frUSDC"].sort(),
    );
  });
  it("pins the official Aave V3 Base Sepolia pool", () => {
    expect(AAVE_V3_BASE_SEPOLIA.pool).toBe("0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27");
  });
});
