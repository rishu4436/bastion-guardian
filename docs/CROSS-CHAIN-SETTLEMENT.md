# Cross-chain settlement (solver reimbursement)

## Flow

1. **Base Sepolia** — `SolverRescueExecutor` repays the borrower's debt with liquidity drawn from a solver's
   commitment in `SolverLiquidityVault`, verifies the debt decrease against the lender, consumes policy budget in
   `BastionPolicyRegistry`, records the ledger + receipt, and emits
   `SolverRescueExecuted(rescueId, policyId, solver, payout, principal, fee, executedAt, originEventId)`.
2. **Reactive Lasna** — `BastionReactiveCore` is subscribed to exactly that emitter + topic0 on 84532. It checks the exact
   data length, dedups by `eventIdOf(chainId, emitter, txHash, logIndex, topic0)`, and requests a callback to
   `CrossChainReserveEscrow.settleRescue` on 1301.
3. **Unichain Sepolia** — the escrow accepts the call only from the Callback Proxy (`onlyServiceProvider`) with the
   injected RVM id equal to the configured ReactiveCore (`onlyCallbackSender`). It rejects (without reverting) any
   claim whose `(destChainId, destExecutor)` is not allowlisted, ignores duplicates, then pays the solver's payout
   address from the user's pre-funded `BastionProtectionVault` budget and emits `ReimbursementCompleted`.
4. **Reactive Lasna → Base Sepolia** — `ReimbursementCompleted` is forwarded back to `BastionCallbackRouter.onSettlementAck`,
   which moves the ledger to `ReimbursementComplete`.

## Trust model (honest)

- Settlement trusts **authenticated Reactive event delivery**, not a cryptographic proof of Base Sepolia finality.
  A deep reorg on Base Sepolia after Reactive forwarded the log could, in principle, leave a reimbursement without a
  surviving repayment. Mitigation: owner `dispute()` for claims in recovery; production would add a confirmation delay.
- Reimbursement assumes the same economic asset on both chains (destination USDC repaid ⇄ reserve USDC paid, 1:1 base
  units). Cross-asset reimbursement is out of scope.
- The vault enforces: per-policy repay and fee reserves, fee-rate ceiling, settler allowlist, budget pause that
  rejects rescues executed after the pause timestamp, and a release delay so a user cannot front-run a solver's
  pending reimbursement by withdrawing instantly.

## Failure handling

- Underfunded / paused budget → claim stored as `RecoveryRequired` (never reverts the Reactive callback, so no
  silent loss); anyone can call `retrySettlement(rescueId)` later. Destination repayment is never re-executed.
- Each `rescueId` pays at most once (`Reimbursed` is terminal). The escrow is `nonReentrant` and writes the
  `Reimbursed` state before the external payout (tested with a hook-token recipient that attempts re-entry).
- Open risk: budget slots are first-come per `policyId` on the reserve chain (see THREAT-MODEL R-07).
