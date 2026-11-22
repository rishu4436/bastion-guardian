import { useEffect, useMemo, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { BastionClient } from "@bastion-guardian/sdk";
import { DEFAULTS, loadSettings, saveSettings, type Settings } from "./src/lib/settings";
import { ReadinessScreen } from "./src/screens/readiness";
import { AlertsScreen } from "./src/screens/alerts";
import { ReceiptScreen } from "./src/screens/receipt";
import { SettingsScreen } from "./src/screens/settings";
import { C } from "./src/ui";

type Tab = "readiness" | "alerts" | "settings";
const TABS: [Tab, string][] = [
  ["readiness", "Readiness"],
  ["alerts", "Alerts"],
  ["settings", "Settings"],
];

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tab, setTab] = useState<Tab>("readiness");
  const [rescue, setRescue] = useState<`0x${string}` | null>(null);
  useEffect(() => {
    loadSettings()
      .then(setSettings)
      .catch(() => setSettings(DEFAULTS));
  }, []);
  const client = useMemo(
    () => (settings ? new BastionClient({ baseUrl: settings.apiUrl }) : null),
    [settings],
  );
  const save = async (s: Settings) => {
    await saveSettings(s);
    setSettings(s);
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar style="light" />
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 }}>
        <Text style={{ color: C.text, fontWeight: "700", fontSize: 16 }}>
          BASTION <Text style={{ color: C.muted, fontWeight: "400" }}>Guardian</Text>
        </Text>
        <Text style={{ color: C.warn, fontSize: 11 }}>Testnet software · not audited · mainnet disabled</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {!settings || !client ? null : rescue ? (
          <ReceiptScreen
            client={client}
            settings={settings}
            rescueId={rescue}
            onBack={() => setRescue(null)}
          />
        ) : tab === "readiness" ? (
          <ReadinessScreen client={client} settings={settings} />
        ) : tab === "alerts" ? (
          <AlertsScreen client={client} settings={settings} onOpenRescue={setRescue} />
        ) : (
          <SettingsScreen settings={settings} onSave={save} />
        )}
      </ScrollView>
      <View style={{ flexDirection: "row", borderTopColor: C.border, borderTopWidth: 1 }}>
        {TABS.map(([k, label]) => (
          <Pressable
            key={k}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === k && !rescue }}
            onPress={() => {
              setRescue(null);
              setTab(k);
            }}
            style={{ flex: 1, paddingVertical: 14, alignItems: "center" }}
          >
            <Text style={{ color: tab === k && !rescue ? C.accent : C.muted, fontWeight: "600" }}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}
