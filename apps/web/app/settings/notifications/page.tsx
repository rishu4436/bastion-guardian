"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorBox,
  Field,
  Loading,
  PageHeader,
  Table,
  inputCls,
} from "@/components/ui";
import { ago } from "@/lib/format";

interface Channel {
  id: string;
  kind: string;
  destination: string;
  status: string;
  verifiedAt: string | null;
}
interface Prefs {
  minSeverity: "info" | "warning" | "critical";
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  timezone: string;
  escalateCritical: boolean;
  privateLockScreen: boolean;
  weeklyDigest: boolean;
  eventOptOuts: string[];
}

function msg(e: unknown) {
  return e instanceof ApiError ? `${e.code}: ${e.message}` : String(e);
}

export default function NotificationSettings() {
  const { session, loading } = useSession();
  const qc = useQueryClient();
  const channels = useApi<{ items: Channel[]; providers: Record<string, boolean> }>(
    session ? "/v1/me/channels" : null,
  );
  const prefs = useApi<Prefs>(session ? "/v1/me/notification-preferences" : null);
  const deliveries = useApi<{
    items: {
      id: string;
      eventType: string;
      channelKind: string;
      state: string;
      lastError: string | null;
      createdAt: string;
      isTest: boolean;
    }[];
  }>(session ? "/v1/me/deliveries" : null, { refetchInterval: 5000 });
  const [kind, setKind] = useState<"telegram" | "email" | "sms">("telegram");
  const [dest, setDest] = useState("");
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Prefs | null>(null);
  const refresh = () => qc.invalidateQueries();

  if (loading) return <Loading />;
  if (!session)
    return (
      <>
        <PageHeader title="Notifications" />
        <Empty>Sign in with Ethereum to manage alert channels and preferences.</Empty>
      </>
    );
  const p = draft ?? prefs.data;

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Alerts are generated only from verified on-chain events and Guardian incidents. Critical alerts can bypass quiet hours."
      />
      {notice && (
        <div role="status" className="mb-6 rounded-lg border border-border bg-raised p-3 text-sm">
          {notice}
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Channels">
          {channels.error ? (
            <ErrorBox error={channels.error} />
          ) : (
            <>
              <Table
                head={["Channel", "Destination", "Status", ""]}
                empty="No channels linked yet."
                rows={(channels.data?.items ?? []).map((c) => [
                  c.kind,
                  <span key="d" className="font-mono text-xs">
                    {c.destination}
                  </span>,
                  <Badge key="s" tone={c.status === "active" ? "armed" : "limited"}>
                    {c.status}
                  </Badge>,
                  c.status === "pending" ? (
                    <form
                      key="v"
                      className="flex gap-2"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        try {
                          await api(`/v1/me/channels/${c.id}/verify`, {
                            method: "POST",
                            json: { code: codes[c.id] ?? "" },
                          });
                          setNotice(`${c.kind} verified.`);
                          await refresh();
                        } catch (err) {
                          setNotice(msg(err));
                        }
                      }}
                    >
                      <input
                        aria-label={`Code for ${c.kind}`}
                        className={`${inputCls} w-24`}
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="code"
                        value={codes[c.id] ?? ""}
                        onChange={(e) => setCodes({ ...codes, [c.id]: e.target.value })}
                      />
                      <Button type="submit" variant="ghost">
                        Verify
                      </Button>
                    </form>
                  ) : (
                    <span key="t" className="flex gap-2">
                      <Button
                        variant="ghost"
                        onClick={async () => {
                          try {
                            await api("/v1/me/notifications/test", {
                              method: "POST",
                              json: { kind: c.kind },
                            });
                            setNotice(`[TEST] notification queued for ${c.kind}.`);
                            await refresh();
                          } catch (err) {
                            setNotice(msg(err));
                          }
                        }}
                      >
                        Send test
                      </Button>
                      <Button
                        variant="danger"
                        onClick={async () => {
                          await api(`/v1/me/channels/${c.id}`, { method: "DELETE" }).catch((err) =>
                            setNotice(msg(err)),
                          );
                          await refresh();
                        }}
                      >
                        Unlink
                      </Button>
                    </span>
                  ),
                ])}
              />
              <form
                className="mt-5 grid grid-cols-[auto_1fr_auto] items-end gap-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    const r = await api<{ codeDelivery: string }>("/v1/me/channels", {
                      method: "POST",
                      json: { kind, destination: dest },
                    });
                    setNotice(
                      r.codeDelivery === "sent"
                        ? "Verification code sent. Enter it next to the channel."
                        : r.codeDelivery === "PROVIDER_NOT_CONFIGURED"
                          ? `The ${kind} provider has no credentials configured on this deployment, so no code could be sent.`
                          : "The provider rejected the message. Check the destination and try again.",
                    );
                    setDest("");
                    await refresh();
                  } catch (err) {
                    setNotice(msg(err));
                  }
                }}
              >
                <Field label="Type">
                  <select
                    aria-label="Channel type"
                    className={inputCls}
                    value={kind}
                    onChange={(e) => setKind(e.target.value as typeof kind)}
                  >
                    <option value="telegram">Telegram (chat id)</option>
                    <option value="email">Email</option>
                    <option value="sms">SMS (E.164)</option>
                  </select>
                </Field>
                <Field label="Destination">
                  <input
                    aria-label="Destination"
                    className={inputCls}
                    value={dest}
                    onChange={(e) => setDest(e.target.value)}
                    placeholder={
                      kind === "email" ? "you@example.com" : kind === "sms" ? "+15551234567" : "123456789"
                    }
                    required
                  />
                </Field>
                <Button type="submit">Link</Button>
              </form>
              {channels.data && (
                <p className="mt-3 text-xs text-muted">
                  Provider credentials on this deployment:{" "}
                  {Object.entries(channels.data.providers)
                    .map(([k, v]) => `${k} ${v ? "configured" : "not configured"}`)
                    .join(" · ")}
                </p>
              )}
            </>
          )}
        </Card>
        <Card title="Preferences">
          {!p ? (
            prefs.error ? (
              <ErrorBox error={prefs.error} />
            ) : (
              <Loading />
            )
          ) : (
            <form
              className="grid grid-cols-2 gap-4"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await api("/v1/me/notification-preferences", {
                    method: "PUT",
                    json: {
                      minSeverity: p.minSeverity,
                      quietHoursStart: p.quietHoursStart,
                      quietHoursEnd: p.quietHoursEnd,
                      timezone: p.timezone,
                      escalateCritical: p.escalateCritical,
                      privateLockScreen: p.privateLockScreen,
                      weeklyDigest: p.weeklyDigest,
                      eventOptOuts: p.eventOptOuts,
                    },
                  });
                  setNotice("Preferences saved.");
                  setDraft(null);
                  await refresh();
                } catch (err) {
                  setNotice(msg(err));
                }
              }}
            >
              <Field label="Minimum severity">
                <select
                  aria-label="Minimum severity"
                  className={inputCls}
                  value={p.minSeverity}
                  onChange={(e) => setDraft({ ...p, minSeverity: e.target.value as Prefs["minSeverity"] })}
                >
                  <option value="info">Info</option>
                  <option value="warning">Warning</option>
                  <option value="critical">Critical only</option>
                </select>
              </Field>
              <Field label="Timezone">
                <input
                  aria-label="Timezone"
                  className={inputCls}
                  value={p.timezone}
                  onChange={(e) => setDraft({ ...p, timezone: e.target.value })}
                />
              </Field>
              <Field label="Quiet hours start (0-23)">
                <input
                  aria-label="Quiet start"
                  className={inputCls}
                  type="number"
                  min={0}
                  max={23}
                  value={p.quietHoursStart ?? ""}
                  onChange={(e) =>
                    setDraft({ ...p, quietHoursStart: e.target.value === "" ? null : Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="Quiet hours end (0-23)">
                <input
                  aria-label="Quiet end"
                  className={inputCls}
                  type="number"
                  min={0}
                  max={23}
                  value={p.quietHoursEnd ?? ""}
                  onChange={(e) =>
                    setDraft({ ...p, quietHoursEnd: e.target.value === "" ? null : Number(e.target.value) })
                  }
                />
              </Field>
              {(
                [
                  ["escalateCritical", "Critical alerts bypass quiet hours"],
                  ["privateLockScreen", "Hide amounts on lock screen"],
                  ["weeklyDigest", "Weekly digest"],
                ] as const
              ).map(([k, l]) => (
                <label key={k} className="col-span-2 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={p[k]}
                    onChange={(e) => setDraft({ ...p, [k]: e.target.checked })}
                  />
                  {l}
                </label>
              ))}
              <div className="col-span-2">
                <Button type="submit">Save preferences</Button>
              </div>
            </form>
          )}
        </Card>
      </div>
      <div className="mt-6">
        <Card title="Delivery history">
          <Table
            head={["Event", "Channel", "State", "Error", "When"]}
            empty="No notifications yet."
            rows={(deliveries.data?.items ?? []).map((d) => [
              <span key="e">
                {d.eventType} {d.isTest && <Badge tone="limited">test</Badge>}
              </span>,
              d.channelKind,
              <Badge
                key="s"
                tone={
                  d.state === "provider_accepted" || d.state === "provider_delivered"
                    ? "armed"
                    : d.state === "dead_letter" || d.state === "failed"
                      ? "unavailable"
                      : "unknown"
                }
              >
                {d.state}
              </Badge>,
              <span key="x" className="text-xs text-muted">
                {d.lastError ?? ""}
              </span>,
              <span key="w" className="text-xs text-muted">
                {ago(d.createdAt)}
              </span>,
            ])}
          />
        </Card>
      </div>
    </>
  );
}
