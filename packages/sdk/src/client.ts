import type {
  Address,
  AnalyticsDaily,
  ChainInfo,
  Hex,
  LendingPosition,
  Paged,
  PolicyDetail,
  PositionObservation,
  ProofOfProtection,
  ProtectionPolicy,
  Protocol,
  ReadinessSnapshot,
  RescueReceipt,
  RescueSummary,
  RiskObservation,
  ScenarioRequest,
  ScenarioResponse,
  Session,
  SettlementClaim,
  SettlementStateName,
  SimulationPreset,
  SolverDetail,
  SolverSummary,
  StreamEvent,
  SystemStatus,
  Token,
} from "./api-types.js";

export class BastionApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "BastionApiError";
  }
}

export interface BastionClientOptions {
  /** API origin, e.g. "https://api.example.com" (no trailing /v1). */
  baseUrl: string;
  /** Custom fetch (tests, React Native, SSR). Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
  /**
   * "include" (browsers on an allowed origin) sends the httpOnly session cookie. Native apps that cannot hold cookies
   * pass `cookie` instead (see `sessionCookie`).
   */
  credentials?: RequestCredentials;
  /** Explicit Cookie header for non-browser runtimes (Node, React Native). */
  cookie?: string;
  /** Extra headers on every request. */
  headers?: Record<string, string>;
}

type Query = Record<string, string | number | boolean | undefined | null>;

const qs = (q?: Query) => {
  if (!q) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

/**
 * Typed client for the BASTION Guardian API. Read methods are public; `me*` methods need a SIWE session.
 * The client never holds private keys: signing (SIWE, EIP-712 policies, transactions) happens in the user's wallet.
 */
export class BastionClient {
  readonly baseUrl: string;
  private readonly f: typeof fetch;
  private csrf: string | null = null;
  private cookie: string | undefined;

  constructor(private readonly opts: BastionClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    const f = opts.fetch ?? globalThis.fetch;
    if (!f) throw new Error("BastionClient: no fetch implementation available");
    this.f = f.bind(globalThis);
    this.cookie = opts.cookie;
  }

  /** Session cookie captured from verify() in non-browser runtimes. */
  get sessionCookie(): string | undefined {
    return this.cookie;
  }

  private async raw(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(this.opts.headers);
    new Headers(init.headers).forEach((v, k) => headers.set(k, v));
    if (init.json !== undefined) headers.set("content-type", "application/json");
    if (this.cookie) headers.set("cookie", this.cookie);
    if (method !== "GET" && method !== "HEAD" && path !== "/v1/auth/verify" && path !== "/v1/auth/csrf") {
      if (!this.csrf) await this.refreshCsrf().catch(() => undefined);
      if (this.csrf) headers.set("x-csrf-token", this.csrf);
    }
    let res: Response;
    try {
      res = await this.f(`${this.baseUrl}${path}`, {
        ...init,
        method,
        headers,
        credentials: this.opts.credentials ?? "include",
        body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
      });
    } catch (e) {
      throw new BastionApiError(
        0,
        "API_UNREACHABLE",
        `BASTION API unreachable at ${this.baseUrl}: ${String(e)}`,
      );
    }
    return res;
  }

  private async req<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
    const res = await this.raw(path, init);
    const text = await res.text();
    let body: Record<string, unknown> = {};
    if (text) {
      try {
        body = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new BastionApiError(res.status, "INVALID_RESPONSE", text.slice(0, 200));
      }
    }
    if (!res.ok)
      throw new BastionApiError(
        res.status,
        String(body.error ?? `HTTP_${res.status}`),
        typeof body.message === "string" ? body.message : undefined,
      );
    return body as T;
  }

  // ---- system ------------------------------------------------------------------------------------------------
  health = () => this.req<{ status: string; [k: string]: unknown }>("/health");
  chains = () => this.req<{ chains: ChainInfo[] }>("/v1/chains");
  systemStatus = () => this.req<SystemStatus>("/v1/system/status");
  protocols = () => this.req<Paged<Protocol>>("/v1/protocols");
  tokens = (q?: { chainId?: number }) => this.req<Paged<Token>>(`/v1/tokens${qs(q)}`);

  // ---- policies & positions ----------------------------------------------------------------------------------
  policies = (q?: {
    chainId?: number;
    owner?: Address;
    account?: Address;
    status?: "Active" | "Paused" | "Revoked";
    limit?: number;
  }) => this.req<Paged<ProtectionPolicy>>(`/v1/policies${qs(q)}`);
  policy = (chainId: number, policyId: Hex) => this.req<PolicyDetail>(`/v1/policies/${chainId}/${policyId}`);
  readinessHistory = (chainId: number, policyId: Hex, limit?: number) =>
    this.req<Paged<ReadinessSnapshot>>(`/v1/policies/${chainId}/${policyId}/readiness${qs({ limit })}`);
  positions = (q?: { chainId?: number; account?: Address; limit?: number }) =>
    this.req<Paged<LendingPosition>>(`/v1/positions${qs(q)}`);
  positionObservations = (positionId: string, limit?: number) =>
    this.req<Paged<PositionObservation>>(`/v1/positions/${positionId}/observations${qs({ limit })}`);
  riskObservations = (q?: { chainId?: number; policyId?: Hex; limit?: number }) =>
    this.req<Paged<RiskObservation>>(`/v1/risk-observations${qs(q)}`);

  // ---- rescues & settlement ----------------------------------------------------------------------------------
  rescues = (q?: { chainId?: number; policyId?: Hex; state?: string; limit?: number }) =>
    this.req<Paged<RescueSummary>>(`/v1/rescues${qs(q)}`);
  rescue = (rescueId: Hex) => this.req<RescueReceipt>(`/v1/rescues/${rescueId}`);
  proof = (rescueId: Hex) => this.req<ProofOfProtection>(`/v1/rescues/${rescueId}/proof`);
  /** URL of the PDF rendering (open or download it directly). */
  proofPdfUrl = (rescueId: Hex) => `${this.baseUrl}/v1/rescues/${rescueId}/proof.pdf`;
  settlements = (q?: { state?: SettlementStateName; limit?: number }) =>
    this.req<Paged<SettlementClaim>>(`/v1/settlements${qs(q)}`);

  // ---- solvers -----------------------------------------------------------------------------------------------
  solvers = (q?: { chainId?: number }) => this.req<Paged<SolverSummary>>(`/v1/solvers${qs(q)}`);
  solver = (chainId: number, address: Address) => this.req<SolverDetail>(`/v1/solvers/${chainId}/${address}`);
  solverDemand = (chainId: number) =>
    this.req<{ chainId: number; items: Record<string, unknown>[]; note: string }>(
      `/v1/solver/demand${qs({ chainId })}`,
    );

  // ---- analytics & simulation --------------------------------------------------------------------------------
  analyticsDaily = (q: { chainId: number; from?: string; to?: string }) =>
    this.req<AnalyticsDaily>(`/v1/analytics/daily${qs(q)}`);
  simulationPresets = () => this.req<{ presets: SimulationPreset[] }>("/v1/simulations/presets");
  simulateScenario = (body: ScenarioRequest) =>
    this.req<ScenarioResponse>("/v1/simulations/scenario", { method: "POST", json: body });

  // ---- auth (SIWE) -------------------------------------------------------------------------------------------
  nonce = () => this.req<{ nonce: string }>("/v1/auth/nonce");
  /** Exchange a signed EIP-4361 message for a session. The wallet signs; this SDK never sees a private key. */
  async verify(message: string, signature: Hex): Promise<Session> {
    const res = await this.raw("/v1/auth/verify", { method: "POST", json: { message, signature } });
    const body = (await res.json()) as Session & { error?: string; message?: string };
    if (!res.ok) throw new BastionApiError(res.status, body.error ?? `HTTP_${res.status}`, body.message);
    const set = res.headers.get("set-cookie");
    const m = set ? /bastion_session=([^;]+)/.exec(set) : null;
    if (m && (this.opts.cookie !== undefined || typeof document === "undefined"))
      this.cookie = `bastion_session=${m[1]}`;
    this.csrf = body.csrfToken ?? null;
    return body;
  }
  session = () => this.req<Session>("/v1/auth/session");
  async refreshCsrf(): Promise<string> {
    const r = await this.req<{ csrfToken: string }>("/v1/auth/csrf", { method: "POST", json: {} });
    this.csrf = r.csrfToken;
    return r.csrfToken;
  }
  async logout(): Promise<void> {
    await this.req("/v1/auth/logout", { method: "POST" });
    this.csrf = null;
    this.cookie = this.opts.cookie;
  }

  // ---- signed-in user ----------------------------------------------------------------------------------------
  me = () =>
    this.req<{
      user: { id: string; displayName: string | null; createdAt: string };
      address: Address;
      chainId: number;
      roles: string[];
      wallets: Address[];
    }>("/v1/me");
  myPolicies = () => this.req<Paged<ProtectionPolicy>>("/v1/me/policies");
  myIncidents = () => this.req<Paged<Record<string, unknown>>>("/v1/me/incidents");
  notificationPreferences = () => this.req<Record<string, unknown>>("/v1/me/notification-preferences");
  setNotificationPreferences = (p: Record<string, unknown>) =>
    this.req<Record<string, unknown>>("/v1/me/notification-preferences", { method: "PUT", json: p });
  channels = () =>
    this.req<{ items: Record<string, unknown>[]; providers: Record<string, boolean> }>("/v1/me/channels");
  linkChannel = (kind: "telegram" | "email" | "sms", destination: string) =>
    this.req<{ id: string; [k: string]: unknown }>("/v1/me/channels", {
      method: "POST",
      json: { kind, destination },
    });
  verifyChannel = (id: string, code: string) =>
    this.req<{ id: string; status: "active" }>(`/v1/me/channels/${id}/verify`, {
      method: "POST",
      json: { code },
    });
  unlinkChannel = (id: string) => this.req<{ ok: boolean }>(`/v1/me/channels/${id}`, { method: "DELETE" });
  /** Register a Web Push subscription (PushSubscription.toJSON()). */
  registerDevice = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    this.req<{ id: string }>("/v1/me/devices", { method: "POST", json: sub });
  removeDevice = (id: string) => this.req<{ ok: boolean }>(`/v1/me/devices/${id}`, { method: "DELETE" });
  sendTestNotification = (kind: string) =>
    this.req<{ deliveryId: string }>("/v1/me/notifications/test", { method: "POST", json: { kind } });
  deliveries = () => this.req<Paged<Record<string, unknown>>>("/v1/me/deliveries");
  webPushKey = () => this.req<{ publicKey: string | null }>("/v1/notifications/webpush-key");

  /**
   * Server-Sent Events over fetch (works in browsers, Node and React Native with streaming fetch). Resumes from
   * `lastEventId`. Resolves when the stream ends or `signal` aborts.
   */
  async stream(
    onEvent: (e: StreamEvent) => void,
    o: { chainId?: number; policyId?: Hex; lastEventId?: string; signal?: AbortSignal } = {},
  ): Promise<string | undefined> {
    const headers: Record<string, string> = { accept: "text/event-stream" };
    if (o.lastEventId) headers["last-event-id"] = o.lastEventId;
    const res = await this.raw(`/v1/stream${qs({ chainId: o.chainId, policyId: o.policyId })}`, {
      headers,
      signal: o.signal,
    });
    if (!res.ok || !res.body) throw new BastionApiError(res.status, "STREAM_FAILED");
    let last = o.lastEventId;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = parseSse(chunk);
          if (ev) {
            last = ev.id || last;
            onEvent(ev);
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") throw e;
    }
    return last;
  }
}

/** Parse one SSE frame. Comment-only frames (heartbeats) return null. */
export function parseSse(chunk: string): StreamEvent | null {
  let id = "";
  let event = "message";
  const data: string[] = [];
  for (const line of chunk.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const c = line.indexOf(":");
    const k = c < 0 ? line : line.slice(0, c);
    const v = c < 0 ? "" : line.slice(c + 1).replace(/^ /, "");
    if (k === "id") id = v;
    else if (k === "event") event = v;
    else if (k === "data") data.push(v);
  }
  if (!data.length) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(data.join("\n")) as Record<string, unknown>;
  } catch {
    parsed = { raw: data.join("\n") };
  }
  return { id, event, data: parsed };
}
