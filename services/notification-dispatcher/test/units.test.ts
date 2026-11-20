import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateVAPIDKeys } from "web-push";
import {
  DEFAULT_PREFERENCES,
  EmailProvider,
  ProviderError,
  SmsProvider,
  TelegramProvider,
  WebPushProvider,
  decide,
  inQuietHours,
  providersFromEnv,
  render,
  type NotificationEvent,
  type RenderedMessage,
} from "../src/index.js";
import { fakeSubscription, startFixtureServer } from "./fixture-server.js";

const msg: RenderedMessage = {
  title: "Rescue executed",
  body: "repaid 2800010200",
  lockScreen: "BASTION: protection update.",
  url: "http://app/p/1",
  severity: "warning",
};

describe("delivery policy", () => {
  const p = { ...DEFAULT_PREFERENCES, quietHoursStart: 22, quietHoursEnd: 7, timezone: "Asia/Kolkata" };
  it("quiet hours wrap midnight in the user's timezone", () => {
    expect(inQuietHours(p, new Date("2026-11-20T18:00:00Z"))).toBe(true); // 23:30 IST
    expect(inQuietHours(p, new Date("2026-11-20T06:00:00Z"))).toBe(false); // 11:30 IST
  });
  it("critical escalates through quiet hours; warnings do not", () => {
    const night = new Date("2026-11-20T18:00:00Z");
    expect(decide(p, "rescue.failed", "critical", night).deliver).toBe(true);
    expect(decide(p, "risk.trigger_crossed", "warning", night)).toEqual({
      deliver: false,
      reason: "QUIET_HOURS",
    });
    expect(decide({ ...p, escalateCritical: false }, "rescue.failed", "critical", night).deliver).toBe(false);
  });
  it("min severity and opt-outs (critical cannot be opted out)", () => {
    expect(decide(DEFAULT_PREFERENCES, "x", "info", new Date())).toEqual({
      deliver: false,
      reason: "BELOW_MIN_SEVERITY",
    });
    const o = { ...DEFAULT_PREFERENCES, eventOptOuts: ["rescue.executed", "rescue.failed"] };
    expect(decide(o, "rescue.executed", "warning", new Date())).toEqual({
      deliver: false,
      reason: "OPTED_OUT",
    });
    expect(decide(o, "rescue.failed", "critical", new Date()).deliver).toBe(true);
  });
});

describe("rendering", () => {
  const e: NotificationEvent = {
    dedupKey: "k",
    eventType: "rescue.executed",
    severity: "warning",
    chainId: 31337,
    policyId: "0xabc",
    owner: null,
    sourceRefs: {},
    confirmation: "observed",
    facts: {
      path: "Solver",
      repaid: "2800010200",
      fee: "14000051",
      hfBefore: "1.1769",
      hfAfter: "1.5000",
      reason: null,
    },
  };
  it("private lock screen omits amounts; full body keeps them and marks unconfirmed events", () => {
    const r = render(e, { privateLockScreen: true, appUrl: "http://app" });
    expect(r.lockScreen).not.toMatch(/2800010200|1\.1769/);
    expect(r.body).toMatch(/2800010200/);
    expect(r.body).toMatch(/awaiting finality/);
    expect(render(e, { privateLockScreen: false, appUrl: "http://app" }).lockScreen).toMatch(/2800010200/);
  });
  it("test notifications are labeled", () => {
    expect(render(e, { privateLockScreen: true, appUrl: "http://app", isTest: true }).title).toMatch(
      /^\[TEST\]/,
    );
  });
});

describe("provider adapters against a local fixture server", () => {
  let fx: Awaited<ReturnType<typeof startFixtureServer>>;
  beforeAll(async () => (fx = await startFixtureServer()));
  afterAll(async () => fx.close());

  it("missing credentials → not configured, PROVIDER_NOT_CONFIGURED (never silent)", async () => {
    const ps = providersFromEnv({});
    expect(Object.values(ps).every((p) => !p.configured)).toBe(true);
    await expect(ps.telegram.send("1", msg)).rejects.toThrow("PROVIDER_NOT_CONFIGURED");
  });

  it("telegram sendMessage", async () => {
    const r = await new TelegramProvider("123:abc", fx.url).send("42", msg);
    expect(r.providerMessageId).toBeTruthy();
    const c = fx.captured.at(-1)!;
    expect(c.path).toBe("/bot123:abc/sendMessage");
    expect(JSON.parse(c.body.toString())).toMatchObject({ chat_id: "42" });
  });

  it("email (Resend-compatible) with bearer auth", async () => {
    const r = await new EmailProvider("re_test", "alerts@bastion.local", fx.url).send("u@example.com", msg);
    expect(r.providerMessageId).toMatch(/^email_/);
    expect(fx.captured.at(-1)!.headers.authorization).toBe("Bearer re_test");
  });

  it("sms (Twilio-compatible) sends only the lock-screen-safe text and validates E.164", async () => {
    const sms = new SmsProvider("AC1", "tok", "+15550001111", fx.url);
    await sms.send("+919876543210", msg);
    const body = new URLSearchParams(fx.captured.at(-1)!.body.toString());
    expect(body.get("Body")).toMatch(/^BASTION: protection update\./);
    expect(body.get("Body")).not.toMatch(/2800010200/);
    await expect(sms.send("12345", msg)).rejects.toMatchObject({ retryable: false });
  });

  it("classifies HTTP errors: 5xx/429 retryable, 4xx permanent", async () => {
    const t = new TelegramProvider("1:x", fx.url);
    fx.failNext(503);
    await expect(t.send("1", msg)).rejects.toSatisfy(
      (e: unknown) => e instanceof ProviderError && e.retryable,
    );
    fx.failNext(400);
    await expect(t.send("1", msg)).rejects.toSatisfy(
      (e: unknown) => e instanceof ProviderError && !e.retryable,
    );
  });

  it("web push: VAPID-signed, aes128gcm-encrypted request; 410 marks the subscription gone", async () => {
    const vapid = { subject: "mailto:ops@bastion.local", ...generateVAPIDKeys() };
    const wp = new WebPushProvider(vapid);
    const sub = await fakeSubscription(`${fx.url}/push/abc`);
    const r = await wp.send(JSON.stringify(sub), msg);
    expect(r.providerMessageId).toMatch(/^\/msg\//);
    const c = fx.captured.at(-1)!;
    expect(c.headers["content-encoding"]).toBe("aes128gcm");
    expect(String(c.headers.authorization)).toMatch(/^vapid t=/);
    expect(c.body.length).toBeGreaterThan(0);
    expect(c.body.toString("utf8")).not.toMatch(/protection update/); // encrypted
    const gone = await wp.send(JSON.stringify(await fakeSubscription(`${fx.url}/push/gone`)), msg);
    expect(gone.gone).toBe(true);
  });
});
