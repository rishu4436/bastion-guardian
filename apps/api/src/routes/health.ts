import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Env } from "@bastion-guardian/config";
import { BASTION_DEPLOYMENTS } from "@bastion-guardian/chain-registry";

const startedAt = Date.now();

export const healthRoutes: FastifyPluginAsync<{ env: Env }> = async (app, { env }) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get(
    "/health",
    {
      schema: {
        response: {
          200: z.object({
            status: z.literal("ok"),
            service: z.literal("bastion-api"),
            version: z.string(),
            uptimeSec: z.number(),
            liveExecutionEnabled: z.boolean(),
            mainnetEnabled: z.literal(false),
            deployments: z.object({ recorded: z.number(), note: z.string() }),
          }),
        },
      },
    },
    async () => {
      const recorded = Object.values(BASTION_DEPLOYMENTS).reduce((n, v) => n + (v?.length ?? 0), 0);
      return {
        status: "ok" as const,
        service: "bastion-api" as const,
        version: "0.1.0",
        uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
        liveExecutionEnabled: env.ENABLE_LIVE_EXECUTION,
        mainnetEnabled: false as const,
        deployments: {
          recorded,
          note: recorded === 0 ? "No BASTION contracts deployed to any network yet" : "See /v1/chains",
        },
      };
    },
  );
};
