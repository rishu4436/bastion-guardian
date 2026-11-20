import {
  checkHttp,
  ProviderError,
  type FetchLike,
  type NotificationProvider,
  type RenderedMessage,
} from "./types.js";

/** SMS through the Twilio Messages REST API. Needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM. */
export class SmsProvider implements NotificationProvider {
  readonly kind = "sms" as const;
  constructor(
    private readonly sid: string | undefined,
    private readonly token: string | undefined,
    private readonly from: string | undefined,
    private readonly baseUrl = "https://api.twilio.com",
    private readonly fetchImpl: FetchLike = fetch,
  ) {}
  get configured() {
    return Boolean(this.sid && this.token && this.from);
  }
  async send(to: string, m: RenderedMessage) {
    if (!this.sid || !this.token || !this.from) throw new ProviderError("PROVIDER_NOT_CONFIGURED", false);
    if (!/^\+[1-9]\d{6,14}$/.test(to)) throw new ProviderError("INVALID_E164", false);
    // SMS is plain text on a lock screen: always the privacy-safe text.
    const res = await this.fetchImpl(`${this.baseUrl}/2010-04-01/Accounts/${this.sid}/Messages.json`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${Buffer.from(`${this.sid}:${this.token}`).toString("base64")}`,
      },
      body: new URLSearchParams({ To: to, From: this.from, Body: `${m.lockScreen} ${m.url}` }).toString(),
    });
    const j = (await checkHttp(res, "sms")) as { sid?: string };
    return { providerMessageId: j.sid ?? null };
  }
}
