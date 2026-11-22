# Solver guide

Solvers repay a borrower's debt on the destination chain from liquidity they locked in advance, and are reimbursed with
a fee from the borrower's reserve on the reserve chain once Reactive relays the verified repayment.

1. **Register** in `SolverRegistry` with a payout address and a bond (≥ `SOLVER_MIN_BOND`).
2. **Deposit** inventory into `SolverLiquidityVault`, then **commit** it to a policy (`token`, `amount`, `feeBps`,
   `expiry`). Only on-chain commitments count as coverage; quotes submitted to the API are indicative.
3. Watch **coverage demand** on the Solver operator dashboard (`/solvers/operator`) or `GET /v1/solver/demand`.
4. Optionally submit signed EIP-712 quotes (`GET /v1/solver/quote-schema`, `POST /v1/solver/quotes`).
5. When a rescue executes against your commitment, the fill and the reimbursement state appear on your profile and
   in **Settlements**.
6. Withdraw free (uncommitted) inventory at any time; pauses never block it. **Request exit** starts the exit delay
   before the bond can be withdrawn.

`services/solver-node` is a reference solver that automates steps 2–4 on the local simulation.
