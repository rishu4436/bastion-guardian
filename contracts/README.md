# BASTION contracts (Foundry)

solc 0.8.29 · via-IR · EVM cancun · OpenZeppelin v5.7.0 · forge-std v1.17.0 · reactive-lib-omni v0.1.0 (git submodules).

```bash
forge build --sizes
forge test                          # unit + fuzz (512 runs) + invariant (128 × 64); fork suite skips without RPC
FOUNDRY_PROFILE=ci forge test       # heavier fuzz/invariant settings
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org BASE_SEPOLIA_FORK_BLOCK=61193053 forge test --match-path "test/fork/*"
```

| Dir | Contracts |
|---|---|
| `src/reactive` | `BastionReactiveCore`: Lasna reactive contract (subscriptions, dedup, callbacks) |
| `src/callbacks` | `BastionCallbackRouter`: Base Sepolia callback entrypoint |
| `src/policies` | `BastionPolicyRegistry`: EIP-712/1271 policies, limits, versions |
| `src/rescue` | `FlashRescueExecutor`, `SolverRescueExecutor`, `BastionExecutorBase` |
| `src/adapters` | `AaveV3LendingAdapter` |
| `src/solvers` | `SolverRegistry`, `SolverLiquidityVault`, `SolverQuoteManager` |
| `src/settlement` | `CrossChainReserveEscrow` (Unichain callback), `RescueSettlementLedger`, `RescueReceiptRegistry` |
| `src/vaults` | `BastionProtectionVault` (Unichain reserve budgets) |
| `src/oracles` | `BastionRiskObserver`, `OracleRiskAdapter` |
| `src/governance` | `BastionEmergencyControl` |
| `src/fixtures` | **Test fixtures. Not Aave and not Uniswap.** |

There are no deployment scripts yet. Deployment is Phase 3 and needs owner authorization.
