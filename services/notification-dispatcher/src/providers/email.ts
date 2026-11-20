import {
  checkHttp,
  ProviderError,
  type FetchLike,
  type NotificationProvider,
  type RenderedMessage,
} from "./types.js";

/** Transactional e-mail over the Resend-compatible HTTP API. Needs EMAIL_API_KEY and EMAIL_FROM. */
export class EmailProvider implements NotificationProvider {
  readonly kind = "email" as const;
  constructor(
    private readonly apiKey: string | undefined,
    private readonly from: string | undefined,
    private readonly baseUrl = "https://api.resend.com",
    private readonly fetchImpl: FetchLike = fetch,
  ) {}
  get configured() {
    return Boolean(this.apiKey && this.from);
  }
  async send(to: string, m: RenderedMessage) {
    if (!this.apiKey || !this.from) throw new ProviderError("PROVIDER_NOT_CONFIGURED", false);
    const res = await this.fetchImpl(`${this.baseUrl}/emails`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ from: this.from, to: [to], subject: m.title, text: `${m.body}\n\n${m.url}` }),
    });
    const j = (await checkHttp(res, "email")) as { id?: string };
    return { providerMessageId: j.id ?? null };
  }
}
