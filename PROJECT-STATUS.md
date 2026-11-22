# Project status

_Last updated: 2026-11-22 (IST)_ · Hackathon deadline: 2026-12-05 20:00 UTC (2026-12-06 01:30 IST)

| State                        | Meaning                                                                                                                    | Current                                                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Implemented                  | code exists                                                                                                                | contracts (26 files), packages/tools, 8 services, API, web (26 pages + PWA), Expo mobile app, SDK, Section 27 docs                         |
| Locally tested               | Foundry / Vitest / Playwright on the dev box                                                                               | **yes**: 87 Foundry + 185 Vitest (0 skipped; real anvil + Postgres + Redis) + 10 Playwright                                                |
| Local simulation E2E         | full two-cycle loop on a private anvil (chain 31337)                                                                       | **yes**: `contracts/script/local-e2e.sh`, all checks pass (not testnet evidence)                                                           |
| Fork-tested                  | local fork of a real testnet, nothing broadcast                                                                            | **yes**: 3 tests against official Aave V3 Base Sepolia @ block 61193053 (earlier run, see below)                                           |
| Testnet deployed             | real deployment with tx hashes                                                                                             | **yes**: Lasna core (configured, 3 subscriptions, funded), Base Sepolia destination stack + FIXTURE market, Unichain Sepolia reserve stack |
| Live E2E verified            | **flash path yes** (2026-11-22 13:08 IST, Base → Lasna → Base, HF 1.18 → 1.50); solver path + settlement cycle **not yet** |
| Production-security-reviewed | independent audit                                                                                                          | **no**                                                                                                                                     |

## Phase progress

- **Phase 0 (discovery and verification): done.** Official sources verified; addresses recorded with sources and on-chain reads.
- **Phase 1 (foundation): done.** pnpm + turbo monorepo, pinned versions, TS/ESLint/Prettier, Foundry, Docker Compose, CI.
- **Phase 2 (contracts): done.** Section 4 contract set with unit, fuzz, invariant and fork tests; R-02 and R-07 fixed
  (104f290); deployment scripts for the Section 4B order (refuse public broadcasts unless `BASTION_DEPLOY_AUTHORIZED=true`).
- **Off-chain core: done locally (PR #2).** Drizzle schema, exact TS rescue model (bit-exact with Foundry vectors), chain
  indexer with reorg handling, risk-observer, guardian-health, solver-coordinator, solver-node, settlement-reconciler,
  notification-dispatcher (BullMQ; Web Push/Telegram/email/SMS adapters, fixture-tested), analytics-worker, SIWE API with
  versioned `/v1` endpoints + OpenAPI + SSE, and the web app (wagmi/viem, dark/light) with Playwright E2E.
- **Product surface: done locally (PR #3).** 26 web pages (Section 17) on real API/wallet data paths, PWA (manifest,
  service worker, offline page, Web Push), Expo SDK 58 mobile companion (read-only; signing via web deep links), Section 27
  docs (`docs/README.md` index).
- **Phase 3 (live Reactive integration): flash loop verified live.** Lasna core deployed (09:14 IST), Base Sepolia
  destination stack (12:51 IST, 43 txs), Unichain Sepolia reserve stack (12:59 IST, 8 txs), core configured with 3
  active subscriptions and 1 REACT (13:02 IST). Live rescue at 13:08 IST: Base `observe` tx `0x7553faf2…f9369e` →
  Lasna `react` tx `0xa5238116…57c369` → Base callback tx `0x24cef533…6d8f17` (flash rescue, debt 13,000 → 6,358.67
  fUSDC, HF 1.1769 → 1.5002). Every address and hash: `docs/integrations/TESTNET-DEPLOYMENTS.md`. Remaining: the solver
  path and the second (Unichain settlement) cycle live.

## Last verified commands (2026-11-22 IST, branch feat/product-surface)

| Command                                                                                                | Result                                                                                        |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `cd contracts && forge fmt --check && forge test`                                                      | clean; 15 suites, **87 passed, 0 failed, 3 skipped** (fork tests need an RPC)                 |
| `pnpm format:check`                                                                                    | clean                                                                                         |
| `REQUIRE_INTEGRATION_INFRA=true pnpm turbo run lint typecheck test build --force`                      | **95/95 tasks, 0 cached**; **185 Vitest tests passed, 0 skipped**; web + mobile builds pass   |
| `pnpm --filter @bastion-guardian/api openapi:check` / `pnpm --filter @bastion-guardian/sdk docs:check` | up to date                                                                                    |
| `cd apps/web && pnpm test:e2e`                                                                         | **10 Playwright tests passed** (all 26 pages render with real data, radar → position, PWA)    |
| `bash contracts/script/local-e2e.sh`                                                                   | **ALL LOCAL SIMULATION CHECKS PASSED** (evidence `contracts/out-evidence/local/e2e-run.json`) |
| GitHub Actions CI on `aebc5d7`                                                                         | success                                                                                       |

Vitest per package: risk-engine 19, simulator 29, db 10, service-kit 5, chain-registry 5, contracts 5, config 3, sdk 16,
observability 1, ui 1, local-e2e 3, chain-indexer 4, risk-observer 4, guardian-health 3, solver-coordinator 11,
solver-node 4, settlement-reconciler 2, notification-dispatcher 14, analytics-worker 2, api 21, web 14, mobile 9.

Mobile: `expo export --platform android` produces the Hermes bundle (1,110 modules). The app has **not** been run on a
device or emulator.

Earlier verified (not re-run on this branch): fork suite `BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
BASE_SEPOLIA_FORK_BLOCK=61193053 forge test` (3 fork tests passed), `slither .` (122 findings, triaged in
`evidence/security/SLITHER-TRIAGE.md`).

## Blockers (external; need the owner)

1. **Testnet funds are in place** (deployer `0xED64A84B841E8fFeFFd5670cf627984332b3835F`, 2026-11-22 13:13 IST):
   Base Sepolia 0.00886 ETH, Unichain Sepolia 0.07400 ETH, Lasna 9.1952 REACT (core holds 0.978 REACT).
2. **Solver path live run** needs a second (solver) testnet account; the deployer cannot be its own solver cleanly.
3. **Notification provider credentials**: VAPID keys, Telegram bot token, Resend-compatible email key, Twilio account.
   Without them each channel reports "not configured" and deliveries dead-letter with `PROVIDER_NOT_CONFIGURED`.

## Open technical items

- Live solver rescue + Unichain reimbursement + Base settlement ack (configured and subscribed, not yet exercised).
  Lasna `react()` delivery and owner config visible to the ReactVM are verified by the live flash loop.
- Uniswap venue adapter (Base Sepolia v3 WETH/USDC liquidity ≈ 674 USDC, so demos use the labeled fixture venue).
- Per-asset analytics (rescue rows do not yet store the debt token) (Redis-backed shared rate limiting landed in efbf4eb, R-10).
- Mobile: background push (Expo/EAS credentials) and an on-device run. Docs: a rendered docs site (`apps/docs`); the
  markdown docs are complete.
- Record testnet deployments in `deployment_registry` (mode `testnet`) from service config so the web app shows them.
