# Project status

_Last updated: 2026-11-20 (IST)_ · Hackathon deadline: 2026-12-05 20:00 UTC (2026-12-06 01:30 IST)

| State | Meaning | Current |
|---|---|---|
| Implemented | code exists | contracts (26 files), 8 packages, api, web skeleton |
| Locally tested | Foundry / Vitest on the dev box | **yes**: 82 local Foundry tests + 34 Vitest tests, all passing |
| Fork-tested | local fork of a real testnet, nothing broadcast | **yes**: 3 tests against official Aave V3 Base Sepolia @ block 61193053 |
| Testnet deployed | real deployment with tx hashes | **no** |
| Live E2E verified | full loop on live testnets | **no** |
| Production-security-reviewed | independent audit | **no** |

## Phase progress
- **Phase 0 (discovery and verification): done.** No pre-existing repo. Official sources verified; addresses recorded
  with sources and on-chain reads.
- **Phase 1 (foundation): done.** pnpm + turbo monorepo, pinned versions, TS/ESLint/Prettier, Foundry config, Docker
  Compose (Postgres 17.6 and Redis 7.4 started healthy locally), `.env.example`, CI workflow (first run happens on push).
- **Phase 2 (contracts): done for the Section 4 contract set.** Unit, fuzz, invariant and fork tests pass. Slither run and triaged;
  one finding fixed (escrow CEI and re-entrancy guard).
- **Phase 3 (live Reactive integration): not started.** Blocked on owner authorization and the resources below.

## Last verified commands (2026-11-20)
| Command | Result |
|---|---|
| `cd contracts && BASE_SEPOLIA_RPC_URL=https://sepolia.base.org BASE_SEPOLIA_FORK_BLOCK=61193053 forge test` | 13 suites, **85 passed, 0 failed** (82 local + 3 fork); invariants 128 runs × 64 depth = 8,192 calls, 0 reverts; fuzz 512 runs |
| `cd contracts && forge test` (no RPC) | 82 passed, 3 skipped (fork) |
| `cd contracts && forge fmt --check` / `forge build --sizes` | clean; largest runtime: PolicyRegistry 10,923 B (EIP-170 limit 24,576 B) |
| `pnpm turbo run lint typecheck test build --force` | 40/40 tasks, 0 cached; **34 Vitest tests passed** |
| `pnpm format:check` | clean |
| `docker compose -f infrastructure/docker/docker-compose.yml up -d --wait` | postgres + redis healthy |
| `slither .` (contracts) | 122 findings, triaged in `evidence/security/SLITHER-TRIAGE.md` |

Raw outputs: `evidence/test-results/`, `evidence/benchmark-results/`, `evidence/security/`, `evidence/integrations/`.

## Blockers (external; need the owner)
1. **Deployment authorization**: hard rule, nothing gets broadcast without it.
2. **Deployer account**: an encrypted keystore or hardware wallet controlled by the owner. No key has been generated or stored.
3. **Testnet ETH** on Base Sepolia and Unichain Sepolia, for deployment gas and for the callback contracts' Reactive debt.
4. **Lasna REACT** (faucet) to deploy and fund BastionReactiveCore subscriptions and callbacks.
5. **Notification provider credentials** (Telegram bot token, email API) for Phase 6.

## Open technical items
- Verify on Lasna: Omni single-instance state for owner config plus `react()`; `evm_version = cancun` support.
- R-07: bind the reserve-chain budget owner to the policy owner.
- R-02: optional per-account caps on adapter collateral pulls.
- Uniswap venue adapter. Base Sepolia v3 WETH/USDC liquidity is about 674 USDC, so demos use the labeled fixture venue.
- Services (`services/*`), mobile and docs apps are not implemented.
