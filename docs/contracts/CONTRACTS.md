# Contracts

Solidity 0.8.29, `via_ir`, `evm_version = cancun`, Foundry 1.9.0. Source: `contracts/src`. Tests: `contracts/test`
(unit, fuzz, invariant, and fork tests against official Aave V3 Base Sepolia). Typed ABIs for TypeScript are generated
into `packages/contracts` (`@bastion-guardian/contracts/abis` is browser-safe).

| Chain role                 | Contract                   | Responsibility                                                                                                  |
| -------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Reactive (Lasna)           | `BastionReactiveCore`      | Reactive Omni contract: subscribes to allowlisted origin events and requests authenticated callbacks            |
| Destination (Base Sepolia) | `BastionPolicyRegistry`    | Source of truth for EIP-712-signed protection policies, versions, nonces and spending limits                    |
|                            | `BastionRiskObserver`      | Emits the observable risk events Reactive subscribes to (a threshold comparison alone emits nothing)            |
|                            | `OracleRiskAdapter`        | Classifies price signals so risk decisions never conflate data sources                                          |
|                            | `BastionCallbackRouter`    | Entry point for Reactive callbacks; authenticates the proxy and RVM id; deterministic path selection            |
|                            | `FlashRescueExecutor`      | FlashNet: atomic, self-funded deleveraging via flash loan + allowlisted swap venue                              |
|                            | `SolverRescueExecutor`     | Repays debt from a solver's on-chain commitment; opens the settlement claim                                     |
|                            | `SolverRegistry`           | Solver registration, bond, payout address, exit delay                                                           |
|                            | `SolverLiquidityVault`     | Solver inventory and executable per-policy commitments (amount, fee, expiry)                                    |
|                            | `SolverQuoteManager`       | EIP-712 solver quotes                                                                                           |
|                            | `RescueSettlementLedger`   | Per-rescue state machine; a rescue id opens exactly once                                                        |
|                            | `RescueReceiptRegistry`    | Immutable Proof-of-Protection facts measured on-chain at execution time                                         |
|                            | `AaveV3LendingAdapter`     | `IBastionLendingAdapter` for Aave V3 pools, with an account-controlled collateral-pull cap (R-02)               |
|                            | `BastionEmergencyControl`  | Instant guardian pause; resume needs owner + guardian quorum; never blocks owner withdrawals                    |
| Reserve (Unichain Sepolia) | `BastionProtectionVault`   | Users' reserve budgets per policy: deposit, allocate, pause, delayed release                                    |
|                            | `CrossChainReserveEscrow`  | Reactive callback target that reimburses solvers from the reserve for verified destination repayments           |
| Fixtures (labeled)         | `Fixture*`                 | Test-only market, oracle, swap venue and tokens for local simulation and labeled demos; never production        |

Deployment order and scripts: `docs/operations/DEPLOYMENT-RUNBOOK.md`. Live addresses: `docs/integrations/TESTNET-DEPLOYMENTS.md`.
Security analysis: `THREAT-MODEL.md`, `evidence/security/SLITHER-TRIAGE.md`.
