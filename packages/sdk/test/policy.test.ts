import { describe, expect, it } from "vitest";
import { buildPolicy, policyDigest, policyIdOf, addressListHash } from "../src/index.js";

/**
 * Cross-language vector: contracts/test/unit/CrossLanguageVectors.t.sol deploys BastionPolicyRegistry at REGISTRY
 * on chain 84532 and asserts the same digest/policyId for the same policy.
 */
export const REGISTRY = "0x00000000000000000000000000000000000B4571" as const;
export const DRAFT = {
  owner: "0x1111111111111111111111111111111111111111",
  account: "0x1111111111111111111111111111111111111111",
  sourceChainId: 1301,
  destChainId: 84532,
  adapter: "0x2222222222222222222222222222222222222222",
  market: "0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27",
  debtAsset: "0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f",
  collateralAsset: "0x4200000000000000000000000000000000000006",
  triggerHealthFactor: "1250000000000000000",
  targetHealthFactor: "1500000000000000000",
  maxTotalRepay: "10000000000",
  maxRepayPerAction: "6000000000",
  maxTotalFees: "200000000",
  maxSlippageBps: 200,
  maxFeeBps: 100,
  allowedPaths: 3,
  allowPartial: true,
  expiry: 1800000000,
  cooldown: 60,
  nonce: "0",
  solvers: ["0x3333333333333333333333333333333333333333"],
  recipients: ["0x4444444444444444444444444444444444444444"],
};

describe("policy EIP-712", () => {
  it("validates drafts", () => {
    expect(() => buildPolicy({ ...DRAFT, targetHealthFactor: "1200000000000000000" })).toThrow(/target/);
    expect(() => buildPolicy({ ...DRAFT, maxRepayPerAction: "20000000000" })).toThrow(/per-action/);
    expect(() => buildPolicy({ ...DRAFT, owner: "0x12" })).toThrow();
  });
  it("matches the Solidity digest and policy id (cross-language vector)", () => {
    const p = buildPolicy(DRAFT);
    expect(addressListHash([])).toBe("0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
    // Values asserted identically in contracts/test/unit/CrossLanguageVectors.t.sol
    expect(policyIdOf(p)).toMatchInlineSnapshot(
      `"0xd0480283075890a1a0f5f91d0b5cd8905f52e42dae5a8f588e4390dd6cc452ce"`,
    );
    expect(policyDigest(p, 84532, REGISTRY)).toMatchInlineSnapshot(
      `"0x185166c9c909ad3d5336f6d0bdb0e2a9e4e98caf05749f8d2436d3a30b3a3aac"`,
    );
  });
});
