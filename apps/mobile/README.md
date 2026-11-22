# BASTION mobile (Expo)

**Status: implemented and locally tested (typecheck, lint, unit tests, Android JS bundle export). Not run on a physical
device or emulator yet, and not published to any store.**

A read-only companion to the web app. It **never holds keys and never signs**: every action that needs a signature opens
the BASTION web app, where the user's own wallet signs.

| Screen    | Data (all from the BASTION API through `@bastion-guardian/sdk`)                                                   |
| --------- | ----------------------------------------------------------------------------------------------------------------- |
| Readiness | `GET /v1/system/status`; policies owned by the watched address with their latest readiness snapshot               |
| Alerts    | Inbox derived on-device from at-risk positions (HF bands match the web radar), non-armed active policies, rescues |
| Receipt   | `GET /v1/rescues/:id` (intent, executions, settlement) + links to Proof of Protection (web) and the proof PDF     |
| Settings  | API URL, web URL, watched address (stored with `expo-secure-store`; validated, no keys)                           |

Alerts refresh every 15 s while the app is open. **Background push for the mobile app is not implemented** (it needs an
Expo/EAS project and push credentials); use the web app's Web Push, Telegram, email or SMS channels meanwhile.

## Run

```bash
pnpm install
pnpm --filter @bastion-guardian/sdk build
cd apps/mobile
pnpm start            # Expo dev server; open in Expo Go (SDK 58)
```

On the Android emulator the API on your computer is `http://10.0.2.2:4000`; on a phone use your computer's LAN IP.

## Verify

```bash
pnpm typecheck && pnpm lint && pnpm test   # 9 unit tests: validation, exact bigint formatting, alert derivation, deep links
pnpm build                                 # expo export --platform android (Metro + Hermes bundle in dist/)
```
