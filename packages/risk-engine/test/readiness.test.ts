import { describe, expect, it } from "vitest";
import { evaluateReadiness, type ReadinessInput } from "../src/index.js";

const now = 1_790_000_000;
const good = (): ReadinessInput => ({
  now,
  policy: { active: true, paused: false, expiresAt: now + 30 * 86_400 },
  reactive: { coreActive: true, subscriptionsActive: true, callbackDebt: 0n, lastHeartbeatAt: now - 10 },
  protection: {
    requiredRepay: 1000n,
    remainingPolicyBudget: 5000n,
    vaultBudget: 5000n,
    solverCoverage: 2000n,
    flashFeasible: false,
  },
  oracle: { status: "OK" },
  emergencyPaused: false,
});

describe("Guardian readiness", () => {
  it("ARMED when every check passes", () => expect(evaluateReadiness(good()).status).toBe("ARMED"));
  it("UNAVAILABLE when callback debt blocks delivery", () => {
    const i = good();
    i.reactive.callbackDebt = 1n;
    expect(evaluateReadiness(i).status).toBe("UNAVAILABLE");
  });
  it("UNAVAILABLE when emergency paused or policy expired", () => {
    const a = good();
    a.emergencyPaused = true;
    const b = good();
    b.policy = { active: true, paused: false, expiresAt: now - 1 };
    expect(evaluateReadiness(a).status).toBe("UNAVAILABLE");
    expect(evaluateReadiness(b).status).toBe("UNAVAILABLE");
  });
  it("LIMITED with stale heartbeat or partial capacity", () => {
    const a = good();
    a.reactive.lastHeartbeatAt = now - 3600;
    const b = good();
    b.protection.solverCoverage = 500n;
    expect(evaluateReadiness(a).status).toBe("LIMITED");
    expect(evaluateReadiness(b).status).toBe("LIMITED");
  });
  it("UNKNOWN (never ARMED) when an input was not observed", () => {
    const i = good();
    i.reactive.lastHeartbeatAt = null;
    expect(evaluateReadiness(i).status).toBe("UNKNOWN");
  });
  it("flash feasibility alone can arm protection", () => {
    const i = good();
    i.protection.solverCoverage = 0n;
    i.protection.flashFeasible = true;
    expect(evaluateReadiness(i).status).toBe("ARMED");
  });
});
