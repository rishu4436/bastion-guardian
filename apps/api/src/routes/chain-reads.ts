import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { and, eq } from "drizzle-orm";
import { deploymentRegistry } from "@bastion-guardian/db";
import { bastionPolicyRegistryAbi } from "@bastion-guardian/contracts";
import { Address, ChainIdQ, HttpError, needDb, type ApiContext } from "../context.js";

/** Read-only chain lookups the web wizard needs. The API never signs or sends transactions. */
export const chainReadRoutes: FastifyPluginAsync<{ ctx: ApiContext }> = async (app, { ctx }) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get(
    "/policy-registry/nonce",
    {
      schema: {
        tags: ["policies"],
        summary:
          "Next policy nonce for an owner, read from BastionPolicyRegistry.nonces(owner) at the latest block",
        querystring: z.object({ chainId: ChainIdQ, owner: Address }),
      },
    },
    async (req) => {
      const { chainId, owner } = req.query;
      const client = ctx.clients[chainId];
      if (!client)
        throw new HttpError(503, "CHAIN_UNAVAILABLE", `No RPC client configured for chain ${chainId}`);
      const [reg] = await needDb(ctx)
        .select()
        .from(deploymentRegistry)
        .where(
          and(eq(deploymentRegistry.chainId, chainId), eq(deploymentRegistry.contractName, "policyRegistry")),
        );
      if (!reg)
        throw new HttpError(404, "NOT_DEPLOYED", `BastionPolicyRegistry is not recorded on chain ${chainId}`);
      const [nonce, block] = await Promise.all([
        client.readContract({
          address: reg.address as `0x${string}`,
          abi: bastionPolicyRegistryAbi,
          functionName: "nonces",
          args: [owner],
        }),
        client.getBlockNumber(),
      ]);
      return {
        chainId,
        owner,
        registry: reg.address,
        nonce: nonce.toString(),
        blockNumber: block.toString(),
      };
    },
  );
};
