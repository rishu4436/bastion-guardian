import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aaveV3LendingAdapterAbi } from "@bastion-guardian/contracts";
import { startLocalStack, type LocalStack } from "../src/stack.js";

describe("local stack harness (LOCAL SIMULATION, chain 31337)", () => {
  let s: LocalStack;
  beforeAll(async () => {
    s = await startLocalStack();
  }, 240_000);
  afterAll(async () => s?.stop());

  it("runs the full observe → react → callback rescue loop on the real contracts", async () => {
    const debt = () =>
      s.public.readContract({
        address: s.addresses.fixtureAdapter,
        abi: aaveV3LendingAdapterAbi,
        functionName: "getDebt",
        args: [s.addresses.borrowerA, s.addresses.fUSDC],
      });
    expect(await debt()).toBe(13_000_000_000n);
    const from = (await s.public.getBlockNumber()) + 1n;
    await s.setWethPrice(1800n * 10n ** 8n);
    await s.observe(s.addresses.policyA);
    const delivered = await s.relayRange(from, await s.public.getBlockNumber());
    expect(delivered).toBe(1);
    expect(await debt()).toBe(10_199_989_800n);
  }, 120_000);
});
