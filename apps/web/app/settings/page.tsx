"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApi } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { Q, SignInRequired } from "@/components/query";
import { PushEnrol } from "@/components/push";
import { Badge, Button, Card, Hash, PageHeader, Table } from "@/components/ui";
import { ago } from "@/lib/format";

interface Me {
  user: { id: string; displayName: string | null; createdAt: string };
  address: string;
  chainId: number;
  roles: string[];
  wallets: string[];
}
interface Delivery {
  id: string;
  channelKind: string;
  isTest: boolean;
  eventType: string;
  state: string;
  createdAt: string;
}

export default function Settings() {
  const { session, signOut } = useSession();
  const me = useApi<Me>(session ? "/v1/me" : null);
  const deliveries = useApi<{ items: Delivery[] }>(session ? "/v1/me/deliveries?limit=20" : null);
  const [theme, setTheme] = useState<string>();
  useEffect(() => setTheme(document.documentElement.dataset.theme), []);
  return (
    <>
      <PageHeader
        title="Account & settings"
        subtitle="Your BASTION identity is your wallet. There is no password and no custody."
      />
      {!session ? (
        <SignInRequired what="see your account" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Identity">
            <Q q={me}>
              {(m) => (
                <div className="space-y-2 text-sm">
                  <div>
                    Signed in as <Hash value={m.address} n={10} /> on chain {m.chainId}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    Roles:{" "}
                    {m.roles.map((r) => (
                      <Badge key={r} tone="accent">
                        {r}
                      </Badge>
                    ))}
                  </div>
                  <div>
                    Verified wallets:{" "}
                    {m.wallets.map((w) => (
                      <Hash key={w} value={w} />
                    ))}
                  </div>
                  <div className="text-xs text-muted">Account created {ago(m.user.createdAt)}</div>
                  <Button variant="ghost" onClick={() => void signOut()}>
                    Sign out (revokes this session)
                  </Button>
                </div>
              )}
            </Q>
          </Card>
          <Card title="Notifications">
            <PushEnrol />
            <p className="mt-3 text-sm">
              Channels, quiet hours and severity:{" "}
              <Link className="text-accent" href="/settings/notifications">
                notification settings →
              </Link>
            </p>
          </Card>
          <Card title="Recent deliveries" className="lg:col-span-2">
            <Q q={deliveries} isEmpty={(d) => !d.items.length} empty="No notifications delivered yet.">
              {(d) => (
                <Table
                  head={["Channel", "Event", "State", "When"]}
                  empty="None"
                  rows={d.items.map((x) => [
                    x.channelKind,
                    `${x.isTest ? "[TEST] " : ""}${x.eventType}`,
                    <Badge key="s">{x.state}</Badge>,
                    ago(x.createdAt),
                  ])}
                />
              )}
            </Q>
          </Card>
          <Card title="Appearance & app">
            <p className="text-sm">Theme: {theme ?? "…"} (toggle in the top bar; saved on this device).</p>
            <p className="mt-2 text-sm">
              <Link className="text-accent" href="/install">
                Install the app / iOS instructions →
              </Link>
            </p>
          </Card>
        </div>
      )}
    </>
  );
}
