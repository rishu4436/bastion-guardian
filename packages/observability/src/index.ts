import { pino, type Logger, type LoggerOptions } from "pino";

/** Keys that must never appear in logs. */
export const REDACT_PATHS = [
  "privateKey",
  "*.privateKey",
  "mnemonic",
  "*.mnemonic",
  "secret",
  "*.secret",
  "password",
  "*.password",
  "authorization",
  "req.headers.authorization",
  "req.headers.cookie",
  "apiKey",
  "*.apiKey",
  "token",
  "*.token",
];

export function createLogger(service: string, opts: LoggerOptions = {}): Logger {
  return pino({
    level: process.env.LOG_LEVEL ?? "info",
    base: { service },
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...opts,
  });
}
export type { Logger };
