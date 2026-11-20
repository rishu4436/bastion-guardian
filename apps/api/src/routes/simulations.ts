import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  compareStrategies,
  runScenario,
  stressTest,
  SECTION_10_SHOCKS_BPS,
  type ScenarioBase,
  type ScenarioSpec,
} from "@bastion-guardian/simulator";
import { json } from "../context.js";

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

  r.get(
    "/simulations/presets",
    {
      schema: {
        tags: ["simulations"],
        summary: "Labeled fixture presets (same market as the Foundry vectors); not live data",
      },
    },
    async () =>
      json({
        presets: [
          {
            id: "local-fixture-weth-usdc",
            label: "LOCAL FIXTURE: 10 fWETH @ 2000, 13,000 fUSDC debt",
            base: FIXTURE_BASE,
          },
        ],
      }),
  );

  r.post(
    "/simulations/scenario",
    {
      schema: {
        tags: ["simulations"],
        summary: "Run one Section 10 scenario (12 kinds) and the strategy comparison",
        body: ScenarioBody,
      },
    },
    async (req) => {
      const { base, spec } = req.body;
      const b = toBase(base);
      const result = runScenario(b, spec as unknown as ScenarioSpec);
      const shock = "shockBps" in spec && typeof spec.shockBps === "number" ? spec.shockBps : 0;
      return json({
        provenance: "SIMULATED",
        disclaimer:
          "Hypothetical scenario output from the BASTION model (bit-exact with the Foundry vectors). Not a prediction and not a guarantee of rescue.",
        result,
        comparison: compareStrategies(b, shock),
      });
    },
  );
};

const big = z
  .union([z.string().regex(/^\d{1,78}$/), z.number().int().nonnegative()])
  .transform((v) => BigInt(v));
const addr = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((v) => v.toLowerCase() as `0x${string}`);
const BaseSchema = z.object({
  state: z.object({
    reserves: z
      .array(
        z.object({
          asset: addr,
          symbol: z.string().max(16),
          decimals: z.number().int().min(0).max(36),
          price: big,
          ltBps: big,
          ltvBps: big,
        }),
      )
      .min(1)
      .max(8),
    collateral: z.record(z.string(), big),
    debt: z.record(z.string(), big),
  }),
  policy: z.object({
    collateralAsset: addr,
    debtAsset: addr,
    triggerHf: big,
    targetHf: big,
    remainingRepay: big,
    remainingFees: big,
    maxSlippageBps: big,
    maxFeeBps: big,
    allowPartial: z.boolean(),
    allowFlash: z.boolean(),
    allowSolver: z.boolean(),
  }),
  flash: z.object({
    flashLoanAvailable: z.boolean(),
    flashPremiumBps: big,
    flashLiquidity: big,
    venueAvailable: z.boolean(),
    venueExecutionCostBps: big,
    collateralAuthorization: big,
  }),
  commitments: z
    .array(
      z.object({
        id: z.string().max(80),
        solver: addr,
        amount: big,
        feeBps: big,
        failures: z.number().int().min(0),
      }),
    )
    .max(50),
  funding: z
    .object({
      destinationCallbackBalanceWei: big,
      reactiveCoreBalanceWei: big,
      minDestinationWei: big,
      minReactiveWei: big,
    })
    .optional(),
  reserveBudget: z.object({ principal: big, fee: big }).optional(),
});
const shock = z.number().int().min(0).max(9999);
const SpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("price_shock"), shockBps: shock }),
  z.object({ kind: z.literal("multi_step_crash"), stepsBps: z.array(shock).min(1).max(10) }),
  z.object({
    kind: z.literal("oracle_delay"),
    shockBps: shock,
    delaySec: z.number().int().min(0).max(86400),
    driftDuringDelayBps: shock,
  }),
  z.object({ kind: z.literal("liquidity_deterioration"), shockBps: shock, venueExecutionCostBps: big }),
  z.object({
    kind: z.literal("solver_liquidity_disappearance"),
    shockBps: shock,
    remainingFraction: z.number().min(0).max(1).optional(),
  }),
  z.object({
    kind: z.literal("callback_delay"),
    shockBps: shock,
    delaySec: z.number().int().min(0).max(86400),
  }),
  z.object({ kind: z.literal("callback_failure"), shockBps: shock, failedPath: z.enum(["flash", "solver"]) }),
  z.object({ kind: z.literal("reactive_balance_depletion"), shockBps: shock }),
  z.object({ kind: z.literal("flash_unavailable"), shockBps: shock }),
  z.object({ kind: z.literal("partial_rescue"), shockBps: shock, remainingRepay: big }),
  z.object({ kind: z.literal("concurrent_repayment"), shockBps: shock, userRepay: big }),
  z.object({
    kind: z.literal("settlement_delay"),
    shockBps: shock,
    delaySec: z.number().int().min(0).max(86400),
    reserveUnderfunded: z.boolean().optional(),
  }),
]);
const ScenarioBody = z.object({ base: BaseSchema, spec: SpecSchema });

function toBase(b: z.infer<typeof BaseSchema>): ScenarioBase {
  const lower = (r: Record<string, bigint>) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toLowerCase(), v])) as Record<
      `0x${string}`,
      bigint
    >;
  return { ...b, state: { ...b.state, collateral: lower(b.state.collateral), debt: lower(b.state.debt) } };
}

const USDC = "0x00000000000000000000000000000000000000c1";
const WETH = "0x00000000000000000000000000000000000000e1";
/** Same labeled fixture market as contracts/test/BastionTestBase and SimulatorVectors.t.sol. */
export const FIXTURE_BASE = {
  state: {
    reserves: [
      { asset: WETH, symbol: "fWETH", decimals: 18, price: "200000000000", ltBps: "8500", ltvBps: "8000" },
      { asset: USDC, symbol: "fUSDC", decimals: 6, price: "100000000", ltBps: "8000", ltvBps: "7500" },
    ],
    collateral: { [WETH]: "10000000000000000000" },
    debt: { [USDC]: "13000000000" },
  },
  policy: {
    collateralAsset: WETH,
    debtAsset: USDC,
    triggerHf: "1250000000000000000",
    targetHf: "1500000000000000000",
    remainingRepay: "8000000000",
    remainingFees: "200000000",
    maxSlippageBps: "200",
    maxFeeBps: "100",
    allowPartial: false,
    allowFlash: true,
    allowSolver: true,
  },
  flash: {
    flashLoanAvailable: true,
    flashPremiumBps: "5",
    flashLiquidity: "500000000000",
    venueAvailable: true,
    venueExecutionCostBps: "30",
    collateralAuthorization: "5000000000000000000",
  },
  commitments: [
    {
      id: "0x01",
      solver: "0x00000000000000000000000000000000000000aa",
      amount: "8000000000",
      feeBps: "50",
      failures: 0,
    },
  ],
  funding: {
    destinationCallbackBalanceWei: "100000000000000000",
    reactiveCoreBalanceWei: "1000000000000000000",
    minDestinationWei: "10000000000000000",
    minReactiveWei: "100000000000000000",
  },
  reserveBudget: { principal: "10000000000", fee: "200000000" },
  shocksBps: [...SECTION_10_SHOCKS_BPS],
};
