import { generateRequestDetails } from "web-push";
import { ProviderError, type FetchLike, type NotificationProvider, type RenderedMessage } from "./types.js";

/**
 * Standards Web Push (RFC 8030 + VAPID RFC 8292, aes128gcm payload encryption). Needs VAPID keys. Destination is the
 * JSON PushSubscription {endpoint, keys:{p256dh, auth}}. Payload carries only lock-screen-safe text.
 */
export class WebPushProvider implements NotificationProvider {
  readonly kind = "webpush" as const;
  constructor(
    private readonly vapid: { subject: string; publicKey: string; privateKey: string } | undefined,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}
  get configured() {
    return Boolean(this.vapid);
  }
  async send(subscriptionJson: string, m: RenderedMessage) {
    if (!this.vapid) throw new ProviderError("PROVIDER_NOT_CONFIGURED", false);
    const sub = JSON.parse(subscriptionJson) as { endpoint: string; keys: { p256dh: string; auth: string } };
    const payload = JSON.stringify({ title: m.title, body: m.lockScreen, url: m.url, severity: m.severity });
    const req = generateRequestDetails(sub, payload, {
      vapidDetails: this.vapid,
      TTL: m.severity === "critical" ? 3600 : 86_400,
      urgency: m.severity === "critical" ? "high" : "normal",
    });
    const res = await this.fetchImpl(req.endpoint, {
      method: req.method,
      headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)])),
      body: req.body ? new Uint8Array(req.body) : null,
    });
    if (res.status === 404 || res.status === 410) return { providerMessageId: null, gone: true };
    if (!res.ok)
      throw new ProviderError(`webpush HTTP ${res.status}`, res.status >= 500 || res.status === 429);
    return { providerMessageId: res.headers.get("location") };
  }
}
