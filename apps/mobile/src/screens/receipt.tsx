import { Linking, Text, View } from "react-native";
import type { BastionClient } from "@bastion-guardian/sdk";
import { RESCUE_PROBLEM_STATES, hf, short, units, webLinks } from "../lib/model";
import { useLoad } from "../lib/use-load";
import type { Settings } from "../lib/settings";
import { Button, Card, Loaded, Pill, Row, s } from "../ui";

export function ReceiptScreen({
  client,
  settings,
  rescueId,
  onBack,
}: {
  client: BastionClient;
  settings: Settings;
  rescueId: `0x${string}`;
  onBack: () => void;
}) {
  const q = useLoad(() => client.rescue(rescueId), [client, rescueId]);
  const tokens = useLoad(() => client.tokens(), [client]);
  const intent = q.data?.intent;
  // Amounts are in the policy's debt asset; without its metadata they are shown as raw base units (never guessed).
  const policy = useLoad(intent ? () => client.policy(intent.chainId, intent.policyId) : null, [
    client,
    intent?.policyId,
  ]);
  const dec = (chainId: number, addr: string | null | undefined) =>
    tokens.data?.items.find((t) => t.chainId === chainId && t.address === addr?.toLowerCase());
  return (
    <View>
      <Button kind="ghost" onPress={onBack}>
        ← Back
      </Button>
      <Text style={[s.h1, { marginTop: 8 }]}>Rescue receipt</Text>
      <Text style={s.small}>{short(rescueId, 10)}</Text>
      <Loaded q={q} empty="">
        {(r) => (
          <View>
            <Card title="Intent">
              {r.intent ? (
                <View>
                  <Pill tone={RESCUE_PROBLEM_STATES.has(r.intent.state) ? "bad" : "good"}>
                    {r.intent.state}
                  </Pill>
                  <Row label="Chain" value={String(r.intent.chainId)} />
                  <Row label="Policy" value={short(r.intent.policyId)} />
                  <Row label="Origin tx" value={short(r.intent.originTxHash)} />
                  <Row label="Reactive tx" value={short(r.intent.reactiveTxHash)} />
                </View>
              ) : (
                <Text style={s.muted}>No intent indexed for this rescue.</Text>
              )}
            </Card>
            <Card title="Executions">
              {r.executions.length === 0 ? (
                <Text style={s.muted}>No execution indexed yet.</Text>
              ) : (
                r.executions.map((e) => {
                  const t = dec(e.chainId, policy.data?.policy.debtAsset);
                  return (
                    <View key={e.id} style={{ marginBottom: 8 }}>
                      <Pill tone={e.success ? "good" : "bad"}>
                        {`${e.path === 1 ? "Flash" : "Solver"} · ${e.success ? "succeeded" : "failed"}`}
                      </Pill>
                      <Row
                        label="HF before → after"
                        value={`${hf(e.healthFactorBeforeWad)} → ${hf(e.healthFactorAfterWad)}`}
                      />
                      <Row
                        label="Repaid"
                        value={
                          t ? `${units(e.repaid, t.decimals)} ${t.symbol}` : `${e.repaid ?? "—"} base units`
                        }
                      />
                      <Row
                        label="Fee"
                        value={t ? `${units(e.fee, t.decimals)} ${t.symbol}` : `${e.fee ?? "—"} base units`}
                      />
                      <Row label="Tx" value={short(e.txHash)} />
                      {e.reason ? <Row label="Reason" value={e.reason} /> : null}
                    </View>
                  );
                })
              )}
            </Card>
            <Card title="Settlement">
              {r.settlementClaim ? (
                <View>
                  <Row label="State" value={String(r.settlementClaim.state)} />
                  <Row label="Events" value={String(r.settlementEvents.length)} />
                </View>
              ) : (
                <Text style={s.muted}>No settlement claim (flash rescues settle in-transaction).</Text>
              )}
            </Card>
            <Text style={s.small}>{r.provenance}</Text>
            <Button onPress={() => void Linking.openURL(webLinks.proof(settings.webUrl, rescueId))}>
              Open Proof of Protection
            </Button>
            <Button kind="ghost" onPress={() => void Linking.openURL(client.proofPdfUrl(rescueId))}>
              Download proof PDF
            </Button>
          </View>
        )}
      </Loaded>
    </View>
  );
}
