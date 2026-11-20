# BASTION Guardian — Threat model

Scope: contracts in `contracts/src`, the Reactive trust boundary, and the off-chain packages. **No independent audit has
been performed.** Static analysis (Slither 0.11.6) results and triage are in `evidence/security/SLITHER-TRIAGE.md`.

## Assets

User collateral and debt positions (Aave), user reserve budgets (ProtectionVault), solver liquidity and bonds,
policy integrity (signed limits), and the correctness of displayed status.

## Actors

Borrower/policy owner · delegated policy owner · solver · keeper (anyone calling `observe`) · Reactive Network
(callback proxy + system contract) · protocol governance (allowlists, emergency pause) · arbitrary attacker.

## Threats and controls

| ID   | Threat                                                         | Control                                                                                                                   | Test evidence                                                                                                                   |
| ---- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| T-01 | Forged callback to router/escrow                               | `onlyServiceProvider` + `onlyCallbackSender(rvm)`; direct calls revert                                                    | `test_directCallToRouterRejected`, `test_callbackFromForeignReactiveContractRejected`, `test_forgedSettlementToEscrowRejected`  |
| T-02 | Replay of a risk callback → double repay                       | `processedEvents`, ledger existence check, policy cooldown                                                                | `test_replayedCallbackDoesNotRepayTwice`                                                                                        |
| T-03 | Duplicate origin log on Reactive                               | `seenEvent[eventIdOf(...)]`                                                                                               | `test_duplicateOriginLogIgnoredByReactiveCore`, ReactiveCore unit tests                                                         |
| T-04 | Double reimbursement                                           | escrow once-only state, `nonReentrant`, CEI, vault `nonReentrant`                                                         | `test_duplicateSettlementCallbackPaysOnce`, `test_hookTokenRecipientCannotReenterSettlement`, invariant `noDoubleReimbursement` |
| T-05 | Reimbursement for a rescue that never happened                 | escrow `trustedExecutor[chain][emitter]`; core forwards only allowlisted emitter+topic0+exact data length                 | `test_untrustedDestinationExecutorRejectedByEscrow`                                                                             |
| T-06 | Exceeding user limits                                          | `consume()` enforces total/per-action/fee/fee-rate/expiry/cooldown/path/adapter; spend persists across versions           | PolicyRegistry unit + fuzz, invariant `totalSpendWithinAuthorization`                                                           |
| T-07 | Hostile policy on a victim's account (forced flash deleverage) | policy account must equal owner or have delegated via `setAccountDelegate`; flash also needs the victim's aToken approval | PolicyRegistry tests                                                                                                            |
| T-08 | Signature replay / tampering                                   | EIP-712 domain (chainId + registry), per-owner nonce, ERC-1271 support                                                    | `test_signatureReplayRejectedByNonce`, `test_tamperedFieldInvalidatesSignature`, `test_forgedSignatureRejected`                 |
| T-09 | Stale risk signal executes late                                | `maxSignalAge` (120 s); executors recompute from live state                                                               | `test_staleSignalExpiresWithoutExecution`                                                                                       |
| T-10 | Executing when position is already healthy                     | executor recomputes; zero repay → no-op                                                                                   | `test_healthyPositionNotRescued`                                                                                                |
| T-11 | Flash-loan callback spoofing                                   | context hash + `initiator == this` + `msg.sender == lender`                                                               | Flash tests                                                                                                                     |
| T-12 | Swap sandwich / bad venue                                      | venue allowlist, `minOut = owed`, slippage bounded by policy                                                              | Flash tests (malicious venue mode)                                                                                              |
| T-13 | Fee-on-transfer / rebasing tokens break accounting             | vault + adapter reject balance-delta mismatch                                                                             | `ProtectionVault` FoT test                                                                                                      |
| T-14 | Reactive debt blocks delivery silently                         | readiness `callbackDebt` check → UNAVAILABLE; `coverDebt()` exposed                                                       | risk-engine readiness tests                                                                                                     |
| T-15 | Emergency                                                      | guardian/owner pause per scope; resume needs owner + quorum per pause epoch; **user withdrawals never paused**            | EmergencyControl tests, `test_pausedPolicyCannotRescue`                                                                         |
| T-16 | UI misrepresentation (fake deployments, fake success)          | registry deployments empty until evidence exists; provenance labels; API `/health` reports `deployments.recorded = 0`     | chain-registry + api tests                                                                                                      |
| T-17 | Secret leakage                                                 | `.env` gitignored, logger redaction, no keys generated or stored                                                          | observability test                                                                                                              |

## Open risks (accepted for Phase 0–2, tracked)

| ID   | Risk                                                                                                                                    | Plan                                                                                                                      |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| R-01 | Settlement trusts Reactive delivery, not Base finality (deep reorg)                                                                     | confirmation delay + `dispute()` already present; document in demo                                                        |
| R-02 | `AaveV3LendingAdapter.withdrawCollateralFor` can pull any aToken amount an account approved to the adapter, by any allowlisted operator | only the FlashRescueExecutor is an operator; UI must recommend bounded approvals; consider per-account allowance caps     |
| R-03 | Solver's reimbursement depends on the user's reserve remaining funded                                                                   | release delay + budget pause timestamp; solver UX must show reserve coverage                                              |
| R-04 | Thin Uniswap liquidity on Base Sepolia (~674 USDC in v3 WETH/USDC 0.3%)                                                                 | flash path demos use labeled fixture venue; real venue adapter later                                                      |
| R-05 | Omni single-instance and `cancun` assumptions unverified                                                                                | verify on Lasna in Phase 3 before any claim                                                                               |
| R-06 | Executors make external calls to allowlisted contracts after balance reads (Slither reentrancy-balance)                                 | all entrypoints `nonReentrant`, router-gated, callees are allowlisted + `nonReentrant`; documented in triage              |
| R-07 | Reserve-chain budget for a `policyId` is created first-come; a griefer could pre-create it and leave it unfunded                        | bind budget owner to policy owner (carry owner in `SolverRescueExecuted` or key budgets by `(owner, policyId)`) — Phase 3 |
| R-08 | Off-chain services are stubs                                                                                                            | no safety dependency on them by design                                                                                    |
