# Project status

_Last updated: 2026-11-20 (IST)_ · Hackathon deadline: 2026-12-05 20:00 UTC (2026-12-06 01:30 IST)

| State                        | Meaning                                              | Current                                                                                          |
| ---------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Implemented                  | code exists                                          | contracts (26 files), 11 packages/tools, 8 services, API, web (11 pages)                         |
| Locally tested               | Foundry / Vitest / Playwright on the dev box         | **yes**: 87 Foundry + 144 Vitest (0 skipped, real anvil + Postgres + Redis) + 6 Playwright       |
| Local simulation E2E         | full two-cycle loop on a private anvil (chain 31337) | **yes**: `contracts/script/local-e2e.sh`, all checks pass (not testnet evidence)                 |
| Fork-tested                  | local fork of a real testnet, nothing broadcast      | **yes**: 3 tests against official Aave V3 Base Sepolia @ block 61193053 (earlier run, see below) |
| Testnet deployed             | real deployment with tx hashes                       | **no**: the owner is funding a testnet deployer and will run the deployment                      |
| Live E2E verified            | full loop on live testnets                           | **no**                                                                                           |
| Production-security-reviewed | independent audit                                    | **no**                                                                                           |

## Phase progress

- **Phase 0 (discovery and verification): done.** Official sources verified; addresses recorded with sources and on-chain reads.
- **Phase 1 (foundation): done.** pnpm + turbo monorepo, pinned versions, TS/ESLint/Prettier, Foundry, Docker Compose, CI.
- **Phase 2 (contracts): done.** Section 4 contract set with unit, fuzz, invariant and fork tests; R-02 and R-07 fixed
  (104f290); deployment scripts for the Section 4B order (refuse public broadcasts unless `BASTION_DEPLOY_AUTHORIZED=true`).
- **Off-chain core: done locally (PR #2).** Drizzle schema, exact TS rescue model (bit-exact with Foundry vectors), chain
  indexer with reorg handling, risk-observer, guardian-health, solver-coordinator, solver-node, settlement-reconciler,
  notification-dispatcher (BullMQ; Web Push/Telegram/email/SMS adapters, fixture-tested), analytics-worker, SIWE API with
  versioned `/v1` endpoints + OpenAPI + SSE, and the web app (wagmi/viem, dark/light) with Playwright E2E.
- **Phase 3 (live Reactive integration): not started.** Owner-run deployment; see blockers.

## Last verified commands (2026-11-20 IST, this branch)

| Command                                                                                                | Result                                                                                        |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `cd contracts && forge fmt --check && forge test`                                                      | clean; 15 suites, **87 passed, 0 failed, 3 skipped** (fork tests need an RPC)                 |
| `REQUIRE_INTEGRATION_INFRA=true pnpm format:check && pnpm turbo run lint typecheck test build --force` | **91/91 tasks, 0 cached**; **144 Vitest tests passed, 0 skipped**                             |
| `cd apps/web && pnpm test:e2e`                                                                         | **6 Playwright tests passed** (web + API + anvil + Postgres + Redis/BullMQ)                   |
| `bash contracts/script/local-e2e.sh`                                                                   | **ALL LOCAL SIMULATION CHECKS PASSED** (evidence `contracts/out-evidence/local/e2e-run.json`) |

Vitest per package: risk-engine 19, simulator 29, db 10, service-kit 5, chain-registry 5, contracts 5, config 3, sdk 2,
observability 1, ui 1, local-e2e 3, chain-indexer 4, risk-observer 4, guardian-health 3, solver-coordinator 11,
solver-node 4, settlement-reconciler 2, notification-dispatcher 14, analytics-worker 2, api 14, web 3.

Earlier verified (not re-run on this branch): fork suite `BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
BASE_SEPOLIA_FORK_BLOCK=61193053 forge test` (3 fork tests passed), `slither .` (122 findings, triaged in
`evidence/security/SLITHER-TRIAGE.md`).

## Blockers (external; need the owner)

1. **Testnet deployment**: owner-run with an owner-controlled deployer (keystore or hardware wallet). Nothing has been
   broadcast to any public network; no keys were generated or stored by the agent.
2. **Testnet ETH** (Base Sepolia, Unichain Sepolia) and **Lasna REACT** for deployment, subscriptions and callback debt.
3. **Notification provider credentials**: VAPID keys, Telegram bot token, Resend-compatible email key, Twilio account.
   Without them each channel reports "not configured" and deliveries dead-letter with `PROVIDER_NOT_CONFIGURED`.

## Open technical items

- Verify on Lasna: Omni single-instance state for owner config plus `react()`; `evm_version = cancun` support.
- Uniswap venue adapter (Base Sepolia v3 WETH/USDC liquidity ≈ 674 USDC, so demos use the labeled fixture venue).
- Per-asset analytics (rescue rows do not yet store the debt token); Redis-backed API rate limiting for multi-instance.
- Mobile and docs apps are not implemented.
