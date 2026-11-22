# solver-node

**Status: implemented for the LOCAL SIMULATION (tests in `test/`); not yet run against a public testnet.** Reads coverage
demand from the API, manages commitments in SolverLiquidityVault and submits signed EIP-712 quotes. The key comes from
`SOLVER_PRIVATE_KEY` in the environment (local dev keys only; never commit keys).

Reference solver: manages commitments in SolverLiquidityVault and monitors payouts.
