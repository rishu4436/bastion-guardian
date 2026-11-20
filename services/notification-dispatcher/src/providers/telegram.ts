import {
  checkHttp,
  ProviderError,
  type FetchLike,
  type NotificationProvider,
  type RenderedMessage,
} from "./types.js";

/** Telegram Bot API sendMessage. Needs TELEGRAM_BOT_TOKEN; destination = chat id. */
export class TelegramProvider implements NotificationProvider {
  readonly kind = "telegram" as const;
  constructor(
    private readonly token: string | undefined,
    private readonly baseUrl = "https://api.telegram.org",
    private readonly fetchImpl: FetchLike = fetch,
  ) {}
  get configured() {
    return Boolean(this.token);
  }
  async send(chatId: string, m: RenderedMessage) {
    if (!this.token) throw new ProviderError("PROVIDER_NOT_CONFIGURED", false);
    const res = await this.fetchImpl(`${this.baseUrl}/bot${this.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: `${m.title}\n\n${m.body}\n${m.url}`,
        disable_web_page_preview: true,
      }),
    });
    const j = (await checkHttp(res, "telegram")) as { ok?: boolean; result?: { message_id?: number } };
    if (!j.ok) throw new ProviderError("telegram returned ok=false", true);
    return { providerMessageId: j.result?.message_id != null ? String(j.result.message_id) : null };
  }
}
