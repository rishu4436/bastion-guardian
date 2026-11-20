export type ChannelKind = "webpush" | "telegram" | "email" | "sms";

export interface RenderedMessage {
  title: string;
  /** Full text for authenticated channels (email, Telegram, SMS). */
  body: string;
  /** Lock-screen-safe text for push (no amounts or positions when private mode is on). */
  lockScreen: string;
  url: string;
  severity: "info" | "warning" | "critical";
}

export interface SendResult {
  providerMessageId: string | null;
  /** The destination is permanently gone (e.g. Web Push 404/410) and should be revoked. */
  gone?: boolean;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    /** false → do not retry (bad credentials, invalid destination). */
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}

export interface NotificationProvider {
  readonly kind: ChannelKind;
  /** false when credentials are missing: deliveries fail fast with PROVIDER_NOT_CONFIGURED (never silently dropped). */
  readonly configured: boolean;
  send(destination: string, msg: RenderedMessage): Promise<SendResult>;
}

export type FetchLike = typeof fetch;

export async function checkHttp(res: Response, what: string): Promise<unknown> {
  const text = await res.text();
  if (res.ok) return text ? JSON.parse(text) : {};
  // 4xx (except 408/429) are permanent; 5xx/408/429 are retryable.
  const retryable = res.status >= 500 || res.status === 408 || res.status === 429;
  throw new ProviderError(`${what} HTTP ${res.status}: ${text.slice(0, 200)}`, retryable);
}
