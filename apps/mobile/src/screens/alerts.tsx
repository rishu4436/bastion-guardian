import { Linking, Pressable, Text, View } from "react-native";
import type { BastionClient } from "@bastion-guardian/sdk";
import { ago, buildAlerts, webLinks, type Alert } from "../lib/model";
import { useLoad } from "../lib/use-load";
import type { Settings } from "../lib/settings";
import { C, Card, Loaded, s } from "../ui";

/** Gathers the watched address's policies, positions and rescues, then derives the alert inbox locally. */
export async function loadInbox(client: BastionClient, address: `0x${string}`) {
  const [pols, pos] = await Promise.all([
    client.policies({ owner: address, limit: 50 }),
    client.positions({ account: address, limit: 50 }),
  ]);
  const rescues = (
    await Promise.all(
      pols.items.map((p) => client.rescues({ chainId: p.chainId, policyId: p.policyId, limit: 10 })),
    )
  ).flatMap((r) => r.items);
  return buildAlerts({ policies: pols.items, positions: pos.items, rescues });
}

export function AlertsScreen({
  client,
  settings,
  onOpenRescue,
}: {
  client: BastionClient;
  settings: Settings;
  onOpenRescue: (id: `0x${string}`) => void;
}) {
  const addr = settings.address;
  const q = useLoad(addr ? () => loadInbox(client, addr) : null, [client, addr], 15_000);
  const open = (a: Alert) => {
    if (a.ref.kind === "rescue") onOpenRescue(a.ref.id as `0x${string}`);
    else if (a.ref.kind === "position") void Linking.openURL(webLinks.position(settings.webUrl, a.ref.id));
    else void Linking.openURL(webLinks.policy(settings.webUrl, a.ref.chainId, a.ref.policyId));
  };
  return (
    <View>
      <Text style={s.h1}>Alerts</Text>
      <Text style={s.small}>
        Refreshed every 15 s while the app is open. Background push for the mobile app is not configured yet;
        use the web app&apos;s Web Push, Telegram, email or SMS channels for alerts while closed.
      </Text>
      <Card>
        {!addr ? (
          <Text style={s.muted}>Add a wallet address in Settings to see alerts.</Text>
        ) : (
          <Loaded
            q={q}
            empty="No alerts: no at-risk positions, all active policies armed, no rescues."
            isEmpty={(d) => !d.length}
          >
            {(d) => (
              <View>
                {d.map((a) => (
                  <Pressable
                    key={a.key}
                    accessibilityRole="button"
                    onPress={() => open(a)}
                    style={{ paddingVertical: 8, borderBottomColor: C.border, borderBottomWidth: 1 }}
                  >
                    <Text
                      style={[
                        s.text,
                        {
                          color:
                            a.severity === "critical" ? C.bad : a.severity === "warning" ? C.warn : C.text,
                        },
                      ]}
                    >
                      {a.title}
                    </Text>
                    <Text style={s.small}>
                      {a.detail} · {ago(a.at)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </Loaded>
        )}
      </Card>
    </View>
  );
}
