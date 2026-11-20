import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { stressTest } from "@bastion-guardian/simulator";

const uint = z
  .string()
  .regex(/^\d{1,40}$/)
  .transform((s) => BigInt(s));
const Body = z.object({
  position: z.object({
    collateralBase: uint,
    debtBase: uint,
    ltBps: z.number().int().min(1).max(10_000),
    collateralLtBps: z.number().int().min(1).max(10_000),
  }),
  policy: z.object({
    triggerHf: uint,
    targetHf: uint,
    maxRepayPerActionBase: uint,
    flashPremiumBps: z.number().int().min(0).max(1000),
    maxSlippageBps: z.number().int().min(0).max(1000),
  }),
  shocksBps: z.array(z.number().int().min(0).max(9999)).min(1).max(20).optional(),
});

const s = (v: bigint | null) => (v === null ? null : v.toString());

export const simulationRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.post("/simulations/stress", { schema: { body: Body } }, async (req) => {
    const { position: p, policy, shocksBps } = req.body;
    if (policy.targetHf <= policy.triggerHf) {
      const e = new Error("targetHf must exceed triggerHf") as Error & { statusCode: number };
      e.statusCode = 400;
      throw e;
    }
    const results = stressTest(
      {
        collateralBase: p.collateralBase,
        debtBase: p.debtBase,
        ltBps: BigInt(p.ltBps),
        collateralLtBps: BigInt(p.collateralLtBps),
      },
      {
        ...policy,
        flashPremiumBps: BigInt(policy.flashPremiumBps),
        maxSlippageBps: BigInt(policy.maxSlippageBps),
      },
      shocksBps,
    );
    return {
      provenance: "SIMULATED",
      disclaimer: "Hypothetical scenario output. Not a prediction and not a guarantee of rescue.",
      results: results.map((x) => ({
        shockBps: x.shockBps,
        triggered: x.triggered,
        liquidatable: x.liquidatable,
        hfBefore: s(x.hfBefore),
        hfAfterShock: s(x.hfAfterShock),
        solverRepayBase: s(x.solverRepayBase),
        solverHfAfter: s(x.solverHfAfter),
        solverWithinCap: x.solverWithinCap,
        flashRepayBase: s(x.flashRepayBase),
        flashHfAfter: s(x.flashHfAfter),
      })),
    };
  });
};
