import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { loadEnv } from "@bastion-guardian/config";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp({ env: loadEnv({ NODE_ENV: "test" }) });
});
afterAll(async () => {
  await app.close();
});

describe("api", () => {
  it("GET /health reports honest deployment state", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.mainnetEnabled).toBe(false);
    expect(body.liveExecutionEnabled).toBe(false);
    // 16 non-fixture testnet contracts recorded from real receipts (Lasna 1, Base Sepolia 12, Unichain Sepolia 3)
    expect(body.deployments.recorded).toBe(16);
    expect(body.deployments.note).toBe("See /v1/chains");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
  it("GET /v1/chains reports only recorded testnet deployments", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/chains" });
    const { chains } = res.json();
    expect(chains).toHaveLength(3);
    const deployed = (id: number) =>
      Object.entries(
        chains.find((c: { id: number }) => c.id === id).bastionContracts as Record<
          string,
          { deployed: boolean }
        >,
      )
        .filter(([, v]) => v.deployed)
        .map(([k]) => k)
        .sort();
    expect(deployed(5318007)).toEqual(["BastionReactiveCore"]);
    expect(deployed(1301)).toEqual(
      ["BastionEmergencyControl", "BastionProtectionVault", "CrossChainReserveEscrow"].sort(),
    );
    expect(deployed(84532)).not.toContain("BastionReactiveCore");
    expect(deployed(84532)).toContain("BastionCallbackRouter");
  });
  it("POST /v1/simulations/stress returns labeled simulated output", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/simulations/stress",
      payload: {
        position: {
          collateralBase: "1000000000000",
          debtBase: "600000000000",
          ltBps: 8500,
          collateralLtBps: 8500,
        },
        policy: {
          triggerHf: "1250000000000000000",
          targetHf: "1500000000000000000",
          maxRepayPerActionBase: "600000000000",
          flashPremiumBps: 5,
          maxSlippageBps: 200,
        },
        shocksBps: [2000],
      },
    });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.provenance).toBe("SIMULATED");
    expect(b.results[0].triggered).toBe(true);
  });
  it("rejects invalid input with 400", async () => {
    const bad = await app.inject({
      method: "POST",
      url: "/v1/simulations/stress",
      payload: { position: { collateralBase: "-1" } },
    });
    expect(bad.statusCode).toBe(400);
    const inverted = await app.inject({
      method: "POST",
      url: "/v1/simulations/stress",
      payload: {
        position: { collateralBase: "1", debtBase: "1", ltBps: 8500, collateralLtBps: 8500 },
        policy: {
          triggerHf: "2",
          targetHf: "1",
          maxRepayPerActionBase: "1",
          flashPremiumBps: 5,
          maxSlippageBps: 200,
        },
      },
    });
    expect(inverted.statusCode).toBe(400);
  });
  it("serves an OpenAPI document", async () => {
    const res = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(res.json().openapi).toMatch(/^3\./);
  });
});

describe("api without a database", () => {
  it("DB-backed routes fail explicitly instead of returning fabricated data", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/policies" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("DB_UNAVAILABLE");
  });
  it("runs a Section 10 scenario on the labeled fixture preset (matches Foundry vectors)", async () => {
    const { presets } = (await app.inject({ method: "GET", url: "/v1/simulations/presets" })).json();
    expect(presets[0].label).toMatch(/LOCAL FIXTURE/);
    const res = await app.inject({
      method: "POST",
      url: "/v1/simulations/scenario",
      payload: { base: presets[0].base, spec: { kind: "price_shock", shockBps: 1000 } },
    });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.provenance).toBe("SIMULATED");
    expect(b.result.outcome).toBe("flash");
    expect(b.result.flash.surplusToBorrower).toBe("112560361");
  });
});
