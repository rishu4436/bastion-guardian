# BASTION Guardian — Architecture

> Status labels used throughout: **Implemented** (code exists) · **Locally tested** (Foundry/Vitest on this machine) ·
> **Fork-tested** (local fork of a real testnet, nothing broadcast) · **Testnet deployed** · **Live E2E verified** ·
> **Production-security-reviewed**. As of 2026-11-20 nothing is beyond _Locally tested / Fork-tested_.

## 1. System overview

```
           Base Sepolia (84532)                    Reactive Lasna (5318007)               Unichain Sepolia (1301)
 ┌─────────────────────────────────────┐   ┌────────────────────────────────┐   ┌────────────────────────────────┐
 │ Aave V3 Pool  (or FixtureLending)   │   │ BastionReactiveCore            │   │ CrossChainReserveEscrow        │
 │   ▲ repay / withdraw                │   │  · subscriptions (≤16 sources) │   │  (AbstractCallback)            │
 │ AaveV3LendingAdapter                │   │  · exact data-length checks    │   │  · trusted-executor allowlist  │
 │   ▲                                 │   │  · event dedup + rate limit    │   │  · once-only payout            │
 │ FlashRescueExecutor  SolverRescueEx │   │  · non-authoritative policy    │   │  · RecoveryRequired + retry    │
 │   ▲   ▲ draw          ▲             │   │    mirror, never reverts       │   │        │ settle()              │
 │   │  SolverLiquidityVault / Registry│   └──────┬───────────▲─────────────┘   │ BastionProtectionVault          │
 │   │  SolverQuoteManager             │          │callback   │logs            │  (user reserve budgets)        │
 │ BastionCallbackRouter ◄─────────────┼──────────┘           │                └────────────┬───────────────────┘
 │  (AbstractCallback, dedup, stale,   │   RiskObserved ───────┤                             │ReimbursementCompleted
 │   flash→solver fallback)            │   SolverRescueExecuted┤◄────────────────────────────┘
 │ BastionPolicyRegistry (EIP-712)     │                       │
 │ BastionRiskObserver ── RiskObserved ┼───────────────────────┘
 │ RescueSettlementLedger · Receipts   │
 │ BastionEmergencyControl             │
 └─────────────────────────────────────┘
```

**Two Reactive cycles close the loop**:

1. _Risk cycle_ — `BastionRiskObserver.observe(policyId)` (permissionless) reads the authoritative HF from the lender
   and emits `RiskObserved` only when HF < trigger → ReactiveCore → `BastionCallbackRouter.onRiskSignal` → executor.
2. _Settlement cycle_ — `SolverRescueExecuted` → ReactiveCore → `CrossChainReserveEscrow.settleRescue` → vault payout →
   `ReimbursementCompleted` → ReactiveCore → `BastionCallbackRouter.onSettlementAck` → ledger final state.

## 2. Authority boundaries

| Layer                 | Trusted for                                              | Not trusted for                                        |
| --------------------- | -------------------------------------------------------- | ------------------------------------------------------ |
| Reactive core (Lasna) | Deciding _that_ a callback should be requested           | Policy limits, amounts, HF — re-checked on destination |
| Callback router       | Authenticating the Reactive sender, dedup, staleness     | Amounts (executors compute from live lender state)     |
| Policy registry       | User-signed limits; the only budget authority            | —                                                      |
| Executors             | Computing minimal repay, verifying economic effect       | Selecting solvers outside the policy allowlist         |
| Lender (Aave)         | Position state, HF                                       | —                                                      |
| Off-chain services    | Nothing safety-critical (observation, UX, notifications) | Any fund movement                                      |

Every safety check that matters is enforced **on the chain that holds the funds**. The Reactive policy mirror is an
optimisation (cheap early filtering), never a source of truth.

## 3. Rescue paths

- **Flash deleverage** (`PATH_FLASH`): flashLoanSimple(debt) → repay → withdraw just enough collateral (borrower must
  have approved its aToken to the adapter) → swap via allowlisted venue with `minOut = owed` → return surplus to
  borrower. Cost factor `ceil((1+premium)(1+slippage)) + 1 bp`. Fully self-funded, no solver needed.
- **Solver repayment** (`PATH_SOLVER`): pre-committed solver liquidity repays debt; solver is reimbursed principal +
  fee cross-chain from the user's reserve budget.
- Router order is deterministic: flash first if feasible, solver as fallback; each attempt runs under try/catch with a
  gas reserve so a failing path is recorded, never bricks the callback.

## 4. Math

`HealthFactorMath.sol` (Aave semantics, WAD) is mirrored bit-for-bit by `packages/risk-engine` (bigint). Cross-language
vectors are asserted in both `contracts/test/unit/CrossLanguageVectors.t.sol` and `packages/risk-engine/test/math.test.ts`;
the EIP-712 policy digest from `packages/sdk` equals `BastionPolicyRegistry.policyDigest` for a fixed vector.

## 5. Monorepo

| Path                                | Contents                                                                    | Status                                     |
| ----------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------ |
| `contracts/`                        | Foundry project, 26 source files, 13 test suites                            | Implemented · Locally tested · Fork-tested |
| `packages/types`                    | Zod schemas, enums mirroring Solidity                                       | Implemented · Tested via dependents        |
| `packages/chain-registry`           | Source-cited addresses; BASTION deployments intentionally empty             | Implemented · Tested                       |
| `packages/config`                   | Strict env schema (mainnet cannot be enabled)                               | Implemented · Tested                       |
| `packages/risk-engine`              | HF math mirror + Guardian readiness                                         | Implemented · Tested                       |
| `packages/simulator`                | Deterministic shock simulator (labeled SIMULATED)                           | Implemented · Tested                       |
| `packages/sdk`                      | Policy builder, EIP-712 typed data/digest, policyId                         | Implemented · Tested (cross-language)      |
| `packages/observability`            | pino logger with secret redaction                                           | Implemented · Tested                       |
| `packages/ui`                       | Design tokens, readiness/provenance copy                                    | Implemented · Tested                       |
| `packages/db`                       | Drizzle schema (numeric(78,0) amounts), migrations, seeds, test databases   | Implemented · Locally tested               |
| `packages/service-kit`              | Chain allowlist, write guard, read clients, run loop, health server         | Implemented · Locally tested               |
| `services/chain-indexer`            | Checkpointed log ingestion, reorg rollback, derived projections             | Implemented · Locally tested (anvil + PG)  |
| `services/risk-observer`            | Position snapshots; permissionless `observe()` below trigger (local writes) | Implemented · Locally tested               |
| `services/guardian-health`          | Per-policy readiness at the trigger boundary; snapshots + incidents         | Implemented · Locally tested               |
| `services/solver-coordinator`       | EIP-712 quote intake, commitment linking, demand feed                       | Implemented · Locally tested               |
| `services/solver-node`              | Reference solver: on-chain commitments within risk limits + signed quotes   | Implemented · Locally tested               |
| `services/settlement-reconciler`    | Fill↔reimbursement reconciliation, recovery retry, ack monitoring           | Implemented · Locally tested               |
| `services/notification-dispatcher`  | BullMQ fan-out; Web Push/Telegram/email/SMS adapters                        | Implemented · Locally tested (fixtures)    |
| `services/analytics-worker`         | Daily metrics from indexed data                                             | Implemented · Locally tested               |
| `apps/api`                          | Fastify 5: SIWE sessions, roles, `/v1` REST, OpenAPI + `/docs`, SSE         | Implemented · Locally tested               |
| `apps/web`                          | Next.js 16 + wagmi/viem: 11 pages, dark/light design system                 | Implemented · Playwright E2E (local)       |
| `tools/local-e2e`, `tools/test-env` | Cached anvil stack, Reactive relay, integration test environment            | Implemented · Locally tested               |
| `apps/mobile`, `apps/docs`          | README scope stubs only                                                     | **Not implemented**                        |
| `infrastructure/docker`             | Postgres 17 + Redis 7 compose                                               | Implemented (config validated)             |

## 6. Off-chain data flow

```
 anvil / testnet RPC ──► chain-indexer ──► Postgres (chain_logs → events → derived state) ◄── risk-observer (positions)
                                              │            ▲                                 guardian-health (readiness, incidents)
                                              │            └── settlement-reconciler, solver-coordinator, analytics-worker
                                              ├──► notification-dispatcher ──► BullMQ (Redis) ──► Web Push / Telegram / email / SMS
                                              └──► apps/api (/v1 REST, SSE /v1/stream, SIWE) ──► apps/web (wagmi/viem)
```

- Event rows are unique on `(chain, blockHash, logIndex)`; derived tables are recomputed from canonical logs, so reorgs
  and re-ingestion are idempotent. Readiness is UNKNOWN whenever an input cannot be read.
- Only `risk-observer` (permissionless `observe`) and `settlement-reconciler` (permissionless `retrySettlement`) can
  write, and `assertWriteAllowed` restricts them to the local chain unless `ENABLE_LIVE_EXECUTION=true`.
  The API and web never sign transactions.
- API surface: `GET /v1/auth/nonce`, `POST /v1/auth/verify|logout`, `GET /v1/auth/session|csrf`; public reads
  (`/v1/system/status`, `/protocols`, `/tokens`, `/policies[/:chainId/:policyId[/readiness]]`, `/positions`,
  `/risk-observations`, `/rescues[/:rescueId]`, `/settlements`, `/solvers[/:chainId/:address]`, `/analytics/daily`,
  `/solver/demand`, `/solver/quote-schema`, `/simulations/*`), signature-authenticated `POST /v1/solver/quotes`,
  session routes under `/v1/me/*`, role-gated `/v1/incidents`, `/v1/admin/*`, and SSE `GET /v1/stream`. OpenAPI at
  `/openapi.json`, Swagger UI at `/docs`.

## 7. Deployment order (Phase 3, requires owner authorization)

The callback contracts authenticate the ReactiveCore as RVM id in their constructors, and the core receives its
destinations through post-deploy configuration, so the order is:

1. **Lasna**: deploy `BastionReactiveCore` (owner-only config, nothing subscribed yet).
2. **Base Sepolia**: EmergencyControl → PolicyRegistry → Ledger/Receipts → Solver registry/vault/quotes → Adapter →
   Executors → RiskObserver → CallbackRouter(callbackProxy 0x476F…3585, reactiveCore).
3. **Unichain Sepolia**: EmergencyControl → ProtectionVault → CrossChainReserveEscrow(callbackProxy 0x775c…66C1, reactiveCore).
4. **Lasna**: `addSource` ×3, `setDestination` ×3, `setSourceActive` (subscribes), fund REACT.
5. Fund the callback contracts so `coverDebt()` keeps their Reactive debt at zero (debt blocks delivery).

## 8. Unverified assumptions (to confirm in Phase 3)

- Under Reactive Omni, owner configuration calls (`addSource`, `setSourceActive`) and `react()` execute against the
  same contract state on Lasna. The core is written so it works if they do; if Omni separates RVM state, configuration
  must move into the constructor.
- `evm_version = cancun` is accepted by Lasna.
