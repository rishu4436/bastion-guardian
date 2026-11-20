"use client";

declare global {
  interface Window {
    __BASTION__?: { apiUrl: string };
  }
}

export function apiUrl(): string {
  if (typeof window !== "undefined" && window.__BASTION__?.apiUrl) return window.__BASTION__.apiUrl;
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

let csrfToken: string | null = null;
export const setCsrf = (t: string | null) => void (csrfToken = t);

/** Fetches the BASTION API with the session cookie. State-changing calls carry the CSRF token. */
export async function api<T = unknown>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set("content-type", "application/json");
  if (method !== "GET" && method !== "HEAD") {
    if (!csrfToken) {
      try {
        const r = await fetch(`${apiUrl()}/v1/auth/csrf`, { credentials: "include" });
        if (r.ok) csrfToken = ((await r.json()) as { csrfToken: string }).csrfToken;
      } catch {
        /* surfaced by the request below */
      }
    }
    if (csrfToken) headers.set("x-csrf-token", csrfToken);
  }
  let res: Response;
  try {
    res = await fetch(`${apiUrl()}${path}`, {
      ...init,
      method,
      headers,
      credentials: "include",
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    });
  } catch {
    throw new ApiError(0, "API_UNREACHABLE", `BASTION API unreachable at ${apiUrl()}`);
  }
  const text = await res.text();
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok)
    throw new ApiError(res.status, String(body.error ?? "ERROR"), String(body.message ?? res.statusText));
  return body as T;
}
