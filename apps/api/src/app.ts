import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { Env } from "@bastion-guardian/config";
import { HttpError, type ApiContext } from "./context.js";
import { registerAuth } from "./auth.js";
import { healthRoutes } from "./routes/health.js";
import { chainRoutes } from "./routes/chains.js";
import { simulationRoutes } from "./routes/simulations.js";
import { authRoutes } from "./routes/auth.js";
import { dataRoutes } from "./routes/data.js";
import { solverRoutes } from "./routes/solver.js";
import { meRoutes } from "./routes/me.js";
import { adminRoutes } from "./routes/admin.js";
import { streamRoutes } from "./routes/stream.js";

export const API_VERSION = "1.0.0";
const DEV_PEPPER = "bastion-dev-only-pepper-not-for-production-use";

export interface BuildOptions extends Partial<Omit<ApiContext, "env" | "pepper">> {
  env: Env;
  logger?: boolean;
}

export async function buildApp({ env, logger = false, ...rest }: BuildOptions): Promise<FastifyInstance> {
  const ctx: ApiContext = {
    env,
    db: rest.db,
    clients: rest.clients ?? {},
    coordinators: rest.coordinators ?? {},
    notifier: rest.notifier,
    providers: rest.providers,
    vapidPublicKey: rest.vapidPublicKey,
    sseIntervalMs: rest.sseIntervalMs ?? 1500,
    pepper: env.SESSION_SECRET ?? DEV_PEPPER,
  };
  const app = Fastify({
    logger: logger
      ? {
          level: env.LOG_LEVEL,
          redact: ["req.headers.authorization", "req.headers.cookie", "req.headers['x-csrf-token']"],
        }
      : false,
    bodyLimit: 64 * 1024,
    trustProxy: false,
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, { contentSecurityPolicy: false }); // CSP relaxed only so /docs (swagger-ui) can render
  await app.register(cors, {
    origin: [env.API_PUBLIC_ORIGIN],
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "DELETE"],
    allowedHeaders: ["content-type", "x-csrf-token", "last-event-id"],
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "BASTION Guardian API",
        version: API_VERSION,
        description:
          "Versioned (/v1) API. Sessions use Sign-In with Ethereum (EIP-4361): GET /v1/auth/nonce → sign → POST /v1/auth/verify. State-changing authenticated calls require the X-CSRF-Token header. Data on chain 31337 is LOCAL SIMULATION output.",
      },
      components: {
        securitySchemes: {
          session: { type: "apiKey", in: "cookie", name: "bastion_session" },
          csrf: { type: "apiKey", in: "header", name: "X-CSRF-Token" },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.setErrorHandler((error, req, reply) => {
    const err = error as FastifyError;
    if (error instanceof HttpError)
      return reply.status(error.statusCode).send({ error: error.code, message: error.message });
    if (err.validation) return reply.status(400).send({ error: "VALIDATION_ERROR", message: err.message });
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    return reply.status(status).send({
      error: status >= 500 ? "INTERNAL_ERROR" : (err.code ?? "ERROR"),
      message: status >= 500 ? "Internal error" : err.message,
    });
  });

  registerAuth(app, ctx);
  await app.register(healthRoutes, { env });
  await app.register(chainRoutes, { prefix: "/v1" });
  await app.register(simulationRoutes, { prefix: "/v1" });
  await app.register(authRoutes, { prefix: "/v1", ctx });
  await app.register(dataRoutes, { prefix: "/v1", ctx });
  await app.register(solverRoutes, { prefix: "/v1", ctx });
  await app.register(meRoutes, { prefix: "/v1", ctx });
  await app.register(adminRoutes, { prefix: "/v1", ctx });
  await app.register(streamRoutes, { prefix: "/v1", ctx });
  app.get(
    "/v1/notifications/webpush-key",
    {
      schema: {
        tags: ["notifications"],
        summary: "VAPID public key for browser push subscription (null when not configured)",
      },
    },
    async () => ({
      publicKey: ctx.vapidPublicKey ?? null,
    }),
  );
  app.get("/openapi.json", { schema: { hide: true } }, async () => app.swagger());
  return app;
}
