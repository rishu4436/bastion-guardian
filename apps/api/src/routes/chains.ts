import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { CHAINS, deploymentStatus, type BastionContractName } from "@bastion-guardian/chain-registry";

const CONTRACTS: BastionContractName[] = [
  "BastionReactiveCore",
  "BastionCallbackRouter",
  "BastionPolicyRegistry",
  "CrossChainReserveEscrow",
];

export const chainRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get(
    "/chains",
    {
      schema: {
        response: {
          200: z.object({
            chains: z.array(
              z.object({
                id: z.number(),
                name: z.string(),
                role: z.string(),
                callbackProxy: z.string(),
                source: z.string(),
                bastionContracts: z.record(
                  z.string(),
                  z.object({ deployed: z.boolean(), address: z.string().nullable() }),
                ),
              }),
            ),
          }),
        },
      },
    },
    async () => ({
      chains: Object.values(CHAINS).map((c) => ({
        id: c.id,
        name: c.name,
        role: c.role,
        callbackProxy: c.reactiveCallbackProxy,
        source: c.callbackProxySource.url,
        bastionContracts: Object.fromEntries(
          CONTRACTS.map((n) => {
            const d = deploymentStatus(n, c.id);
            return [n, { deployed: d !== null, address: d?.address ?? null }];
          }),
        ),
      })),
    }),
  );
};
