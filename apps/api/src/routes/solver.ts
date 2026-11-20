import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { QuoteRejected, QUOTE_TYPES, quoteDomain } from "@bastion-guardian/solver-coordinator";
import { Address, Bytes32, ChainIdQ, HttpError, json, type ApiContext } from "../context.js";

const uint = z
  .union([z.string().regex(/^\d{1,78}$/), z.number().int().nonnegative()])
  .transform((v) => BigInt(v));

export const solverRoutes: FastifyPluginAsync<{ ctx: ApiContext }> = async (app, { ctx }) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const coordinator = (chainId: number) => {
    const c = ctx.coordinators[chainId];
    if (!c)
      throw new HttpError(
        503,
        "SOLVER_COORDINATOR_UNAVAILABLE",
        `No solver coordinator configured for chain ${chainId}`,
      );
    return c;
  };

  r.get(
    "/solver/demand",
    {
      schema: {
        tags: ["solvers"],
        summary:
          "Coverage shortfalls derived from the latest readiness snapshots (what solvers should commit on-chain)",
        querystring: z.object({ chainId: ChainIdQ }),
      },
    },
    async (req) =>
      json({
        chainId: req.query.chainId,
        items: await coordinator(req.query.chainId).demand(),
        note: "Quotes are indicative; only on-chain SolverLiquidityVault commitments count as coverage.",
      }),
  );

  r.get(
    "/solver/quote-schema",
    {
      schema: {
        tags: ["solvers"],
        summary: "EIP-712 domain and types for signing quotes",
        querystring: z.object({ chainId: ChainIdQ }),
      },
    },
    async (req) => {
      const c = coordinator(req.query.chainId);
      return {
        domain: quoteDomain(req.query.chainId, c.cfg.solverLiquidityVault),
        types: QUOTE_TYPES,
        primaryType: "SolverQuote",
      };
    },
  );

  r.post(
    "/solver/quotes",
    {
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        tags: ["solvers"],
        summary:
          "Submit an EIP-712-signed indicative quote (authenticated by signature; no session required)",
        querystring: z.object({ chainId: ChainIdQ.default(31337) }),
        body: z.object({
          quote: z.object({
            solver: Address,
            policyId: Bytes32,
            token: Address,
            amount: uint,
            feeBps: z.number().int().min(0).max(10_000),
            validUntil: uint,
            nonce: uint,
          }),
          signature: z.string().regex(/^0x[0-9a-fA-F]{130,}$/),
        }),
        response: { 201: z.object({ id: z.string() }) },
      },
    },
    async (req, reply) => {
      try {
        const id = await coordinator(req.query.chainId).submitQuote(
          req.body.quote,
          req.body.signature as `0x${string}`,
        );
        return reply.status(201).send({ id });
      } catch (e) {
        if (e instanceof QuoteRejected) throw new HttpError(422, e.code, `Quote rejected: ${e.code}`);
        throw e;
      }
    },
  );
};
