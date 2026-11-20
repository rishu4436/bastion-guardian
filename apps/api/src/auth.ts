import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import {
  auditEvents,
  sessions,
  solverRegistrations,
  userRoles,
  users,
  walletIdentities,
  type Database,
} from "@bastion-guardian/db";
import { HttpError, sha256, type ApiContext } from "./context.js";

export const SESSION_COOKIE = "bastion_session";
export type Role = "borrower" | "solver" | "auditor" | "integrator" | "admin";

export interface AuthState {
  sessionId: string;
  userId: string;
  address: `0x${string}`;
  chainId: number;
  roles: Role[];
  csrfTokenHash: string;
}

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthState | null;
  }
}

export async function rolesFor(
  db: Database,
  env: ApiContext["env"],
  userId: string,
  address: string,
): Promise<Role[]> {
  const out = new Set<Role>(["borrower"]);
  for (const r of await db.select().from(userRoles).where(eq(userRoles.userId, userId))) out.add(r.role);
  const admins = env.ADMIN_ADDRESSES.split(",")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
  if (admins.includes(address.toLowerCase())) out.add("admin");
  const [solver] = await db
    .select({ s: solverRegistrations.solver })
    .from(solverRegistrations)
    .where(
      and(eq(solverRegistrations.solver, address.toLowerCase()), eq(solverRegistrations.status, "active")),
    )
    .limit(1);
  if (solver) out.add("solver");
  return [...out].sort();
}

export async function audit(
  db: Database,
  req: FastifyRequest,
  action: string,
  target: string | null,
  details: Record<string, unknown> = {},
) {
  await db.insert(auditEvents).values({
    actorUserId: req.auth?.userId ?? null,
    actorAddress: req.auth?.address ?? null,
    action,
    target,
    details,
  });
}

/** Creates (or reuses) the user for a verified wallet and issues a fresh session. Returns raw tokens once. */
export async function createSession(
  ctx: ApiContext,
  db: Database,
  address: `0x${string}`,
  chainId: number,
  userAgent: string | undefined,
) {
  const addr = address.toLowerCase();
  const userId = await db.transaction(async (tx) => {
    const [w] = await tx
      .select()
      .from(walletIdentities)
      .where(eq(walletIdentities.address, addr))
      .for("update");
    if (w) {
      await tx.update(walletIdentities).set({ lastSeenAt: new Date() }).where(eq(walletIdentities.id, w.id));
      return w.userId;
    }
    const [u] = await tx.insert(users).values({}).returning({ id: users.id });
    await tx.insert(walletIdentities).values({ userId: u!.id, address: addr, firstVerifiedChainId: chainId });
    await tx.insert(userRoles).values({ userId: u!.id, role: "borrower" }).onConflictDoNothing();
    return u!.id;
  });
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (user?.disabledAt) throw new HttpError(403, "USER_DISABLED");
  const token = randomBytes(32).toString("base64url");
  const csrf = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ctx.env.SESSION_TTL_HOURS * 3600_000);
  const [s] = await db
    .insert(sessions)
    .values({
      userId,
      walletAddress: addr,
      chainId,
      tokenHash: sha256(ctx.pepper, token),
      csrfTokenHash: sha256(ctx.pepper, csrf),
      expiresAt,
      userAgent: userAgent?.slice(0, 256),
    })
    .returning({ id: sessions.id });
  return { sessionId: s!.id, userId, token, csrf, expiresAt };
}

export function setSessionCookie(ctx: ApiContext, reply: FastifyReply, token: string, expiresAt: Date) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: ctx.env.COOKIE_SECURE || ctx.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export function registerAuth(app: FastifyInstance, ctx: ApiContext) {
  app.decorateRequest("auth", null);
  app.addHook("onRequest", async (req) => {
    req.auth = null;
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token || !ctx.db) return;
    const [s] = await ctx.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.tokenHash, sha256(ctx.pepper, token)),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, sql`now()`),
        ),
      )
      .limit(1);
    if (!s) return;
    req.auth = {
      sessionId: s.id,
      userId: s.userId,
      address: s.walletAddress as `0x${string}`,
      chainId: s.chainId,
      roles: await rolesFor(ctx.db, ctx.env, s.userId, s.walletAddress),
      csrfTokenHash: s.csrfTokenHash,
    };
  });
}

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/** preHandler: requires a session, and for state-changing methods a matching X-CSRF-Token header. */
export function requireAuth(ctx: ApiContext, ...roles: Role[]) {
  return async (req: FastifyRequest) => {
    if (!req.auth) throw new HttpError(401, "UNAUTHENTICATED", "Sign in with Ethereum first");
    if (!SAFE.has(req.method)) {
      const h = req.headers["x-csrf-token"];
      if (typeof h !== "string" || sha256(ctx.pepper, h) !== req.auth.csrfTokenHash)
        throw new HttpError(403, "CSRF_TOKEN_INVALID");
    }
    if (roles.length && !roles.some((r) => req.auth!.roles.includes(r)))
      throw new HttpError(403, "FORBIDDEN_ROLE", `Requires role: ${roles.join(" or ")}`);
  };
}

/**
 * preHandler for the CSRF-token mint (R-11): requires a session, an application/json content type (forces a CORS
 * preflight for any cross-origin caller), and, when the browser sends one, an Origin equal to API_PUBLIC_ORIGIN.
 */
export function requireJsonSameOrigin(ctx: ApiContext) {
  return async (req: FastifyRequest) => {
    if (!req.auth) throw new HttpError(401, "UNAUTHENTICATED", "Sign in with Ethereum first");
    const ct = String(req.headers["content-type"] ?? "")
      .split(";")[0]!
      .trim()
      .toLowerCase();
    if (ct !== "application/json")
      throw new HttpError(415, "JSON_REQUIRED", "POST /v1/auth/csrf requires Content-Type: application/json");
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== ctx.env.API_PUBLIC_ORIGIN)
      throw new HttpError(403, "ORIGIN_NOT_ALLOWED");
  };
}
