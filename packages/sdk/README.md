# @bastion-guardian/sdk

Developer SDK for BASTION Guardian: a typed HTTP client for the `/v1` API, React hooks, the embeddable
**Protect with BASTION** component, and EIP-712 policy drafting helpers that match `BastionPolicyRegistry` bit for bit.

The SDK never holds private keys. Sign-In with Ethereum messages, policy signatures and transactions are signed in the
user's wallet; the SDK only carries the resulting session.

- Status: implemented and tested against a local anvil deployment (LOCAL SIMULATION). Not yet tested against a testnet
  deployment, and not published to npm.
- Generated references: [SDK API](./docs/api/README.md) (TypeDoc) · [HTTP API](../../docs/api/HTTP-REFERENCE.md) (OpenAPI)

## Install

```bash
npm install @bastion-guardian/sdk viem   # react is an optional peer for @bastion-guardian/sdk/react
```

The published package bundles the internal `types`, `risk-engine` and `chain-registry` modules, so it depends only on
`viem` and `zod`. `examples/sdk-react-example` installs it from the packed tarball to prove that.

## Client

```ts
import { BastionClient } from "@bastion-guardian/sdk";

const bastion = new BastionClient({ baseUrl: "https://api.example" });
const { items } = await bastion.policies({ owner: "0x…" });
const detail = await bastion.policy(items[0].chainId, items[0].policyId);
detail.readiness?.status; // "ARMED" | "LIMITED" | "UNAVAILABLE" | "UNKNOWN" (readiness is not a guarantee)

const proof = await bastion.proof(rescueId); // Proof of Protection JSON with a reproducible sha256 content hash
bastion.proofPdfUrl(rescueId); // PDF rendering

await bastion.stream((e) => console.log(e.event, e.data), { chainId: 84532, signal });
```

Amounts, health factors (1e18 WAD) and block numbers are decimal integer strings; convert with `BigInt`, never floats.
Errors are thrown as `BastionApiError { status, code, message }`; `status: 0` with `API_UNREACHABLE` means the network
request itself failed.

### Signing in (SIWE)

```ts
import { createSiweMessage } from "viem/siwe";

const { nonce } = await bastion.nonce();
const message = createSiweMessage({
  address,
  chainId,
  domain: location.host,
  nonce,
  uri: location.origin,
  version: "1",
});
const signature = await walletClient.signMessage({ account: address, message }); // the user's wallet signs
await bastion.verify(message, signature);
await bastion.myPolicies();
```

Browsers keep the httpOnly session cookie (`credentials: "include"`); Node and React Native pass `cookie: ""` and the
client stores the session cookie returned by `verify`. CSRF tokens are minted with `POST /v1/auth/csrf` and attached to
state-changing calls automatically.

## React

```tsx
import { BastionProvider, ProtectWithBastion, useProtectionStatus } from "@bastion-guardian/sdk/react";

<BastionProvider options={{ baseUrl: "https://api.example" }}>
  <ProtectWithBastion account={address} chainId={84532} appUrl="https://app.example" />
</BastionProvider>;
```

| Hook                                          | Returns                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| `useBastionPositions({ account, chainId })`   | indexed lending positions with the latest observed health factor         |
| `useProtectionStatus({ account, chainId })`   | combined status (`ARMED`…`UNKNOWN`, `UNPROTECTED`, `PAUSED`, `REVOKED`)  |
| `useRescuePolicies({ owner \| account })`     | policies for an owner or protected account                               |
| `useRescueHistory({ chainId, policyId })`     | rescue intents with their on-chain executions                            |
| `useGuardianReadiness({ chainId, policyId })` | Guardian Mode readiness timeline (newest first)                          |
| `useRescueSimulation()`                       | `presets`, `run(request)`, `result` for Section 10 scenarios (SIMULATED) |

Every hook returns `{ data, error, status, isLoading, refetch, updatedAt }`. `status` is `idle`, `loading`, `success`,
`error`, or `stale` (a refresh failed and the previous data is still shown; label it as partial in your UI). Pass
`{ refreshMs }` to poll and `{ enabled: false }` to defer.

`<ProtectWithBastion>` shows the live protection state when a policy exists and otherwise links to the BASTION policy
wizard (`/policies/new?account=…&chainId=…&ref=embed`), where the user reviews and signs in their own wallet. On chain
31337 it shows a `LOCAL SIM` badge.

## Policy drafting

```ts
import { buildPolicy, policyTypedData, policyIdOf } from "@bastion-guardian/sdk";

const policy = buildPolicy(draft); // validates caps and HF ordering
const typed = policyTypedData(policy, chainId, registry); // pass to eth_signTypedData_v4 in the wallet
const id = policyIdOf(policy);
```

## Development

```bash
pnpm --filter @bastion-guardian/sdk build      # tsup bundle + d.ts
pnpm --filter @bastion-guardian/sdk test       # unit + integration (needs Docker Postgres; anvil from Foundry)
pnpm --filter @bastion-guardian/sdk docs       # regenerate docs/api (TypeDoc markdown)
```

The integration tests boot the real API over a private anvil chain with the LOCAL SIMULATION deployment, run a crash and
rescue, then exercise every client method, the SSE stream, SIWE, all six hooks (in jsdom) and the embed.
