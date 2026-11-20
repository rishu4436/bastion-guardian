import { describe, expect, it } from "vitest";
import { WAD } from "@bastion-guardian/risk-engine";
import { simulateShock, stressTest } from "../src/index.js";

const pos = {
  collateralBase: 1_000_000_000_000n,
  debtBase: 600_000_000_000n,
  ltBps: 8500n,
  collateralLtBps: 8500n,
};
const policy = {
  triggerHf: (125n * WAD) / 100n,
  targetHf: (15n * WAD) / 10n,
  maxRepayPerActionBase: 600_000_000_000n,
  flashPremiumBps: 5n,
  maxSlippageBps: 200n,
};

describe("stress simulator", () => {
  it("5% shock on HF 1.4167 does not trigger", () => {
    const r = simulateShock(pos, policy, 500);
    expect(r.provenance).toBe("SIMULATED");
    expect(r.triggered).toBe(false);
  });
  it("20% shock triggers and both rescue paths restore target", () => {
    const r = simulateShock(pos, policy, 2000);
    expect(r.triggered).toBe(true);
    expect(r.solverHfAfter! >= policy.targetHf).toBe(true);
    expect(r.flashHfAfter! >= policy.targetHf).toBe(true);
  });
  it("40% shock leaves the position liquidatable before rescue", () => {
    const r = simulateShock(pos, policy, 4000);
    expect(r.liquidatable).toBe(true);
  });
  it("runs the default shock ladder and rejects invalid shocks", () => {
    expect(stressTest(pos, policy)).toHaveLength(4);
    expect(() => simulateShock(pos, policy, 10_000)).toThrow();
  });
});
