import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { isAddress, normalizeUrl } from "../lib/model";
import type { Settings } from "../lib/settings";
import { Button, C, Card, s } from "../ui";

export function SettingsScreen({
  settings,
  onSave,
}: {
  settings: Settings;
  onSave: (s: Settings) => Promise<void>;
}) {
  const [api, setApi] = useState(settings.apiUrl);
  const [web, setWeb] = useState(settings.webUrl);
  const [addr, setAddr] = useState(settings.address ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const save = async () => {
    const a = normalizeUrl(api);
    const w = normalizeUrl(web);
    if (!a || !w) return setMsg("API and web URLs must be http(s) URLs.");
    if (addr && !isAddress(addr)) return setMsg("Address must be 0x followed by 40 hex characters.");
    await onSave({ apiUrl: a, webUrl: w, address: addr ? (addr.trim() as `0x${string}`) : null });
    setMsg("Saved.");
  };
  return (
    <View>
      <Text style={s.h1}>Settings</Text>
      <Card title="Watch">
        <Text style={s.muted}>Wallet address (read-only; no keys are stored)</Text>
        <TextInput
          accessibilityLabel="Wallet address"
          style={s.input}
          value={addr}
          onChangeText={setAddr}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="0x…"
          placeholderTextColor={C.muted}
        />
      </Card>
      <Card title="Endpoints">
        <Text style={s.muted}>BASTION API URL</Text>
        <TextInput
          accessibilityLabel="API URL"
          style={s.input}
          value={api}
          onChangeText={setApi}
          autoCapitalize="none"
        />
        <Text style={s.muted}>BASTION web app URL (wallet actions open here)</Text>
        <TextInput
          accessibilityLabel="Web URL"
          style={s.input}
          value={web}
          onChangeText={setWeb}
          autoCapitalize="none"
        />
        <Text style={s.small}>
          Android emulator: use http://10.0.2.2:4000 to reach an API on your computer.
        </Text>
      </Card>
      <Button onPress={() => void save()}>Save</Button>
      {msg ? <Text style={[s.small, { marginTop: 8 }]}>{msg}</Text> : null}
      <Text style={[s.small, { marginTop: 16 }]}>
        Testnet software, not audited. BASTION never takes custody of your collateral.
      </Text>
    </View>
  );
}
