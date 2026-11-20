export * from "./types.js";
export * from "./telegram.js";
export * from "./email.js";
export * from "./sms.js";
export * from "./webpush.js";
import { EmailProvider } from "./email.js";
import { SmsProvider } from "./sms.js";
import { TelegramProvider } from "./telegram.js";
import type { ChannelKind, NotificationProvider } from "./types.js";
import { WebPushProvider } from "./webpush.js";

/** Builds providers from the environment. Missing credentials → `configured = false` (documented blocker). */
export function providersFromEnv(
  env: Record<string, string | undefined> = process.env,
): Record<ChannelKind, NotificationProvider> {
  const vapid =
    env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT
      ? { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY }
      : undefined;
  return {
    webpush: new WebPushProvider(vapid),
    telegram: new TelegramProvider(env.TELEGRAM_BOT_TOKEN),
    email: new EmailProvider(env.EMAIL_API_KEY, env.EMAIL_FROM),
    sms: new SmsProvider(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_FROM),
  };
}
