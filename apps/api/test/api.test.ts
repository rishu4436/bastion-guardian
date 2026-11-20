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
    expect(body.deployments.recorded).toBe(0);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
  it("GET /v1/chains lists verified proxies and no fake deployments", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/chains" });
    const { chains } = res.json();
    expect(chains).toHaveLength(3);
    for (const c of chains)
      for (const v of Object.values(c.bastionContracts) as { deployed: boolean }[])
        expect(v.deployed).toBe(false);
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
