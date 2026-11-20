# Slither triage

- Tool: Slither 0.11.6 (`slither-version.txt`), Foundry 1.9.0, solc 0.8.29 (via-IR)
- Command (from `contracts/`): `slither . --filter-paths "lib/|test/" --exclude-dependencies --json ../evidence/security/slither-raw.json`
- Run: 2026-11-20 (IST), after the escrow hardening below. Raw output: `slither-output.txt`, `slither-raw.json`.
- Result: 122 findings (High 9, Medium 15, Low 55, Informational 41, Optimization 2). Slither exits non-zero
  whenever it reports findings.
- **This is automated static analysis, not an audit.**

## Fixed as a result of this run
| Finding | Change | Regression test |
|---|---|---|
| `reentrancy-no-eth` — `CrossChainReserveEscrow._attempt` wrote `state = Reimbursed` after the external `VAULT.settle` call | Escrow now inherits `ReentrancyGuard`; `settleRescue` and `retrySettlement` are `nonReentrant`; state is set to `Reimbursed` **before** the call and reverted to `RecoveryRequired` in the catch branch (CEI). Previously, double payment was only prevented indirectly by the vault's own guard, and a re-entrant attempt recorded a phantom failed attempt | `test_hookTokenRecipientCannotReenterSettlement` (an ERC777-style hook token recipient tries to re-enter: it fails, the payout happens exactly once, `attempts == 2`) |

## High — triaged
| Finding | Location | Assessment |
|---|---|---|
| `arbitrary-send-erc20` | `FixtureLendingMarket.flashLoanSimple` | Fixture only. This mirrors Aave semantics, where the receiver repays via `transferFrom(receiver)`. Receivers must authenticate the callback; `FlashRescueExecutor.executeOperation` checks the active context hash, `initiator == address(this)`, and `msg.sender == adapter.flashLender()` (`test_flashCallbackCannotBeInvokedDirectly`). |
| `arbitrary-send-erc20` | `AaveV3LendingAdapter.withdrawCollateralFor` | By design: it uses Aave's native aToken allowance as the user's authorization for flash deleverage. Restricted to `isCollateralOperator` (only `FlashRescueExecutor`), which acts only inside a `consume()`-authorized policy for an account that owns or delegated that policy. **Open risk R-02**: an approval to the adapter is usable by any allowlisted operator. Mitigations: bounded approvals in the UX, and per-account caps planned. |
| `reentrancy-balance` ×5 | `SolverRescueExecutor.execute`, `FlashRescueExecutor.execute/executeOperation` | Balance reads around calls to immutable/allowlisted, `nonReentrant` contracts (`SolverLiquidityVault`, adapter, allowlisted venue, lender). Executors are `nonReentrant` and router-only (`test_executorOnlyCallableByRouter`). The post-checks deliberately use balance deltas plus lender state (debt decreased, HF improved). Accepted (R-06). |
| `reentrancy-balance` ×2 | `FixtureLendingMarket.flashLoanSimple` | Fixture only. The balance check after the callback *is* the repayment check (Aave semantics). |

## Medium — triaged
| Finding | Assessment |
|---|---|
| `reentrancy-no-eth` (escrow, residual) | Only `lastError` / failure-branch state is written after the call. All entry points are now `nonReentrant`; `dispute` is `onlyOwner`. Accepted. |
| `incorrect-equality` ×3 (adapter) | Comparisons against the sentinel `type(uint256).max` and exact-zero debt are intentional, not balance-manipulation-sensitive. False positive. |
| `uninitialized-local` ×4 | Zero-initialised accumulators/flags, intentional. False positive. |
| `unused-return` ×7 | `getUserAccountData` tuple fields not needed; `isFeasible` reason code not needed by router; `repayOnBehalf` return superseded by the balance-delta check; executor `execute` result recorded via events/ledger. Accepted. |

## Low / Informational
`timestamp` (deliberate: Base Sepolia has 200 ms blocks, so all timers use timestamps), `calls-loop` (bounded loops: ≤16
sources, ≤8 commitments per policy), `reentrancy-events/benign`, `missing-zero-check` (ReactiveCore owner/transfer,
`SolverRegistry.setLiquidityVault`, fixtures; tracked for hardening), `events-maths` (fixtures), naming conventions
(immutable UPPER_CASE style). None affect fund safety; revisit before any production review.
