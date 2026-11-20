import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { Env } from "@bastion-guardian/config";
import { healthRoutes } from "./routes/health.js";
import { chainRoutes } from "./routes/chains.js";
import { simulationRoutes } from "./routes/simulations.js";

export interface BuildOptions {
  env: Env;
  logger?: boolean;
}

export async function buildApp({ env, logger = false }: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger
      ? { level: env.LOG_LEVEL, redact: ["req.headers.authorization", "req.headers.cookie"] }
      : false,
    bodyLimit: 64 * 1024,
    trustProxy: false,
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet);
  await app.register(cors, { origin: [env.API_PUBLIC_ORIGIN], credentials: false });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  await app.register(swagger, {
    openapi: { info: { title: "BASTION Guardian API", version: "0.1.0" } },
    transform: jsonSchemaTransform,
  });

  app.setErrorHandler((error, _req, reply) => {
    const err = error as FastifyError;
    const status = err.statusCode ?? 500;
    if (err.validation) return reply.status(400).send({ error: "VALIDATION_ERROR", message: err.message });
    return reply.status(status).send({
      error: status >= 500 ? "INTERNAL_ERROR" : (err.code ?? "ERROR"),
      message: status >= 500 ? "Internal error" : err.message,
    });
  });

  await app.register(healthRoutes, { env });
  await app.register(chainRoutes, { prefix: "/v1" });
  await app.register(simulationRoutes, { prefix: "/v1" });
  app.get("/openapi.json", { schema: { hide: true } }, async () => app.swagger());
  return app;
}
