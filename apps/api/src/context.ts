import { createHash } from "node:crypto";
import { z } from "zod";
import type { PublicClient } from "viem";
import type { Env } from "@bastion-guardian/config";
import type { Database } from "@bastion-guardian/db";
import type { SolverCoordinator } from "@bastion-guardian/solver-coordinator";
import type { ChannelKind, NotificationProvider } from "@bastion-guardian/notification-dispatcher";

export interface Notifier {
  sendTest(userId: string, kind: ChannelKind): Promise<string | null>;
}

/** Everything a route may need. Optional parts degrade to explicit 503 errors, never to fabricated data. */
export interface ApiContext {
  env: Env;
  db?: Database;
  /** Read clients by chain id, used for SIWE smart-account verification and chain reads. */
  clients: Record<number, PublicClient>;
  coordinators: Record<number, SolverCoordinator>;
  notifier?: Notifier;
  providers?: Partial<Record<ChannelKind, NotificationProvider>>;
  vapidPublicKey?: string;
  sseIntervalMs: number;
  /** Secret pepper for hashing session tokens and verification codes. */
  pepper: string;
}

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export function needDb(ctx: ApiContext): Database {
  if (!ctx.db) throw new HttpError(503, "DB_UNAVAILABLE", "Database is not configured for this API instance");
  return ctx.db;
}

export const sha256 = (pepper: string, v: string) =>
  createHash("sha256").update(pepper).update(":").update(v).digest("hex");

export const Address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "expected a 20-byte hex address")
  .transform((s) => s.toLowerCase() as `0x${string}`);
export const Bytes32 = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "expected a 32-byte hex value")
  .transform((s) => s.toLowerCase() as `0x${string}`);
export const ChainIdQ = z.coerce.number().int().positive();
export const Limit = z.coerce.number().int().min(1).max(200).default(50);
export const Uint = z.string().regex(/^\d{1,78}$/, "expected a base-10 unsigned integer string");

/** Recursively converts bigint → string and Date → ISO for JSON responses. */
export function json<T>(v: T): unknown {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
}
