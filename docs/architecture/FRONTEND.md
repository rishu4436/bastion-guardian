# Product surface (web, PWA, mobile, SDK)

`ARCHITECTURE.md` (repo root) covers contracts, Reactive flow and services. This file covers what users touch.

## Web app (`apps/web`, Next.js 16, wagmi/viem, TanStack Query)

26 pages. Every data view handles loading, error, empty and partial (stale-but-labeled) states and never substitutes
placeholder values. Reads come from the BASTION API (`/v1`) or wallet `readContract`; writes are user-signed wallet
transactions through a shared `TxAction` component that shows the exact raw call (target, chain, function, arguments,
encoded calldata), refuses a wrong-chain wallet, and is disabled with a stated reason when the contract is not deployed.

| Area                 | Pages                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Protect              | `/` landing, `/dashboard`, `/policies`, `/policies/new` (17-step wizard), `/policies/[chainId]/[policyId]`, `/guardian`, `/emergency` |
| Observe              | `/radar`, `/positions/[id]`, `/activity`, `/rescues/[rescueId]`, `/proof/[rescueId]`, `/analytics`, `/simulator`, `/status`           |
| Solvers & settlement | `/solvers`, `/solvers/[chainId]/[address]`, `/solvers/operator`, `/settlements`, `/reserve`                                           |
| Account & developers | `/settings`, `/settings/notifications`, `/developers`, `/install`, `/offline`, `/operations` (admin/auditor)                          |

Contract addresses are never hard-coded in the UI: pages read `/v1/deployments?chainId=` and disable on-chain actions
when nothing is recorded for the connected chain. Provenance badges distinguish On-chain, Local simulation, Simulated,
Fixture and Estimate values.

## PWA

Web manifest, maskable icons, service worker with an offline fallback (API responses are never cached), Web Push
(VAPID from the API; "not configured" when absent), iOS install guidance.

## Mobile (`apps/mobile`, Expo SDK 58)

Read-only readiness, alerts and receipts through `@bastion-guardian/sdk`; deep links into the web app for anything that
needs a signature.

## SDK (`packages/sdk`)

Typed client for every `/v1` endpoint, React hooks, the "Protect with BASTION" embed and EIP-712 policy drafting.
Generated reference: `packages/sdk/docs`. HTTP reference: `docs/api/HTTP-REFERENCE.md` (from `docs/api/openapi.json`).
