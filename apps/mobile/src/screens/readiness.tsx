import { Linking, Pressable, Text, View } from "react-native";
import type { BastionClient, ProtectionPolicy } from "@bastion-guardian/sdk";
import { ago, readinessTone, short, webLinks } from "../lib/model";
import { useLoad } from "../lib/use-load";
import type { Settings } from "../lib/settings";
import { Button, Card, Loaded, Pill, s } from "../ui";

export function ReadinessScreen({ client, settings }: { client: BastionClient; settings: Settings }) {
  const addr = settings.address;
  const sys = useLoad(() => client.systemStatus(), [client], 30_000);
  const pols = useLoad(
    addr ? () => client.policies({ owner: addr, limit: 50 }) : null,
    [client, addr],
    15_000,
  );
  return (
    <View>
      <Text style={s.h1}>Readiness</Text>
      <Text style={s.small}>
        Readiness indicators are not a guarantee of rescue success. This app is read-only and never holds
        keys.
      </Text>
      <Card title="System">
        <Loaded q={sys} empty="">
          {(d) => (
            <View style={{ gap: 6 }}>
              <Pill tone={d.database ? "good" : "bad"}>
                {d.database ? "database connected" : "database down"}
              </Pill>
              <Pill tone="muted">mainnet disabled</Pill>
              <Pill tone={d.liveExecutionEnabled ? "warn" : "muted"}>
                {d.liveExecutionEnabled ? "live execution enabled" : "live execution disabled"}
              </Pill>
            </View>
          )}
        </Loaded>
      </Card>
      {!addr ? (
        <Card title="Your policies">
          <Text style={s.muted}>Add the wallet address you want to watch in Settings.</Text>
        </Card>
      ) : (
        <Card title={`Policies owned by ${short(addr)}`}>
          <Loaded q={pols} empty="No BASTION policies for this address yet." isEmpty={(d) => !d.items.length}>
            {(d) => (
              <View>
                {d.items.map((p: ProtectionPolicy) => (
                  <Pressable
                    key={`${p.chainId}:${p.policyId}`}
                    accessibilityRole="link"
                    onPress={() =>
                      void Linking.openURL(webLinks.policy(settings.webUrl, p.chainId, p.policyId))
                    }
                    style={{ paddingVertical: 8, borderBottomColor: "#22304d", borderBottomWidth: 1 }}
                  >
                    <View
                      style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
                    >
                      <Text style={s.text}>{short(p.policyId)}</Text>
                      <Pill tone={readinessTone(p.readiness?.status)}>
                        {p.readiness?.status ?? "UNKNOWN"}
                      </Pill>
                    </View>
                    <Text style={s.small}>
                      chain {p.chainId} · {p.status} · evaluated {ago(p.readiness?.evaluatedAt)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </Loaded>
        </Card>
      )}
      <Card title="Act (signs in your wallet, on the web)">
        <Button onPress={() => void Linking.openURL(webLinks.emergency(settings.webUrl))}>
          Open Emergency Action Center
        </Button>
        <Button
          kind="ghost"
          onPress={() => void Linking.openURL(webLinks.newPolicy(settings.webUrl, addr ?? undefined))}
        >
          Create a protection policy
        </Button>
      </Card>
    </View>
  );
}
