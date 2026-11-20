import { z } from "zod";

const bool = z.enum(["true", "false"]).transform((v) => v === "true");

/** Strict environment schema shared by API and services. Unknown financial toggles default to OFF. */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_PUBLIC_ORIGIN: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
  BASE_SEPOLIA_RPC_URL: z.string().url().default("https://sepolia.base.org"),
  UNICHAIN_SEPOLIA_RPC_URL: z.string().url().default("https://sepolia.unichain.org"),
  REACTIVE_LASNA_RPC_URL: z.string().url().default("https://lasna-rpc.rnk.dev/"),
  /** Mainnet execution is disabled by default and cannot be enabled through this schema in Phase 0-2. */
  ENABLE_MAINNET: z
    .literal("false")
    .default("false")
    .transform(() => false as const),
  ENABLE_LIVE_EXECUTION: bool.default(false),
  SESSION_SECRET: z.string().min(32).optional(),
});
export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  if (parsed.data.NODE_ENV === "production" && !parsed.data.SESSION_SECRET) {
    throw new Error("Invalid environment: SESSION_SECRET is required in production");
  }
  return parsed.data;
}
