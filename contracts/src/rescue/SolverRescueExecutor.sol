// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { BastionExecutorBase } from "./BastionExecutorBase.sol";
import { IBastionExecutor } from "../interfaces/IBastionExecutor.sol";
import { IBastionLendingAdapter } from "../interfaces/IBastionLendingAdapter.sol";
import { BastionTypes } from "../libraries/BastionTypes.sol";
import { BastionErrors } from "../libraries/BastionErrors.sol";
import { BastionPolicyRegistry } from "../policies/BastionPolicyRegistry.sol";
import { RescueSettlementLedger } from "../settlement/RescueSettlementLedger.sol";
import { RescueReceiptRegistry } from "../settlement/RescueReceiptRegistry.sol";
import { SolverRegistry } from "../solvers/SolverRegistry.sol";
import { SolverLiquidityVault } from "../solvers/SolverLiquidityVault.sol";
import { SolverQuoteManager } from "../solvers/SolverQuoteManager.sol";

/// @title SolverRescueExecutor
/// @notice BASTION Solver Rescue: repays a borrower's debt on the destination chain using liquidity a solver locked
///         for that policy in advance, then records a reimbursable claim and emits `SolverRescueExecuted` — the origin
///         event of the second Reactive cycle that reimburses the solver from the borrower's source-chain reserve.
/// @dev Economic guarantees:
///      - The borrower's debt strictly decreases by at least the tokens spent (minus 1 wei protocol rounding).
///      - The claim principal equals tokens actually spent (balance delta), never the requested amount.
///      - Budget, per-action, fee and fee-rate limits are enforced by BastionPolicyRegistry.consume (atomic).
///      - No user token is ever transferred: only solver inventory moves.
contract SolverRescueExecutor is BastionExecutorBase, IBastionExecutor {
    using SafeERC20 for IERC20;

    SolverRegistry public immutable SOLVERS;
    SolverLiquidityVault public immutable LIQUIDITY;
    SolverQuoteManager public immutable QUOTES;

    event SolverRescueExecuted(
        bytes32 indexed rescueId,
        bytes32 indexed policyId,
        address indexed solver,
        address payout,
        uint256 principal,
        uint256 fee,
        uint64 executedAt,
        bytes32 originEventId
    );

    constructor(
        BastionPolicyRegistry policies_,
        RescueSettlementLedger ledger_,
        RescueReceiptRegistry receipts_,
        SolverRegistry solvers_,
        SolverLiquidityVault liquidity_,
        SolverQuoteManager quotes_,
        address owner_
    ) BastionExecutorBase(policies_, ledger_, receipts_, owner_) {
        SOLVERS = solvers_;
        LIQUIDITY = liquidity_;
        QUOTES = quotes_;
    }

    function path() external pure returns (uint8) {
        return BastionTypes.PATH_SOLVER;
    }

    function isFeasible(bytes32 policyId) external view returns (bool, bytes32) {
        (BastionTypes.Policy memory p, BastionTypes.PolicyState memory s) = POLICIES.getPolicy(policyId);
        (bool ok, bytes32 reason) = POLICIES.checkExecutable(policyId, s.version, BastionTypes.PATH_SOLVER);
        if (!ok) return (false, reason);
        IBastionLendingAdapter adapter = IBastionLendingAdapter(p.adapter);
        uint256 need = adapter.estimateRepayment(p.account, p.debtAsset, p.targetHealthFactor);
        if (need == 0) return (false, "NOTHING_TO_REPAY");
        uint256 cap = _min(POLICIES.remainingRepay(policyId), adapter.getDebt(p.account, p.debtAsset));
        if (need > cap) {
            if (!p.allowPartial) return (false, "BUDGET_BELOW_REQUIRED");
            need = cap;
        }
        (bool found, SolverQuoteManager.Candidate memory best) =
            QUOTES.selectBest(policyId, p.debtAsset, need, p.maxFeeBps);
        if (!found) return (false, "NO_SOLVER_COMMITMENT");
        if (best.amount < need && !p.allowPartial) return (false, "INSUFFICIENT_SOLVER_LIQUIDITY");
        return (true, 0);
    }

    function execute(BastionTypes.RescueRequest calldata req)
        external
        onlyRouter
        nonReentrant
        returns (BastionTypes.RescueResult memory r)
    {
        (BastionTypes.Policy memory p, IBastionLendingAdapter adapter, BastionTypes.Position memory pos) =
            _load(req.policyId, req.policyVersion);
        r.path = BastionTypes.PATH_SOLVER;
        r.debtBefore = pos.debtAmount;
        r.healthFactorBefore = pos.healthFactor;

        // Smallest repayment reaching the target, bounded by policy limits and actual debt.
        uint256 need = adapter.estimateRepayment(p.account, p.debtAsset, p.targetHealthFactor);
        uint256 cap = _min(POLICIES.remainingRepay(req.policyId), pos.debtAmount);
        bool capped = need > cap;
        if (capped) need = cap;
        if (need == 0) revert BastionErrors.NoEconomicEffect();

        (bool found, SolverQuoteManager.Candidate memory best) =
            QUOTES.selectBest(req.policyId, p.debtAsset, need, p.maxFeeBps);
        if (!found) revert BastionErrors.InvalidParameter("NO_SOLVER_COMMITMENT");
        uint256 amount = _min(need, best.amount);
        if ((amount < need || capped) && !p.allowPartial) revert BastionErrors.InsufficientRescue(amount, need);

        IERC20 debtToken = IERC20(p.debtAsset);
        uint256 balBefore = debtToken.balanceOf(address(this));
        LIQUIDITY.draw(best.id, amount, address(this));
        debtToken.forceApprove(address(adapter), amount);
        adapter.repayOnBehalf(p.debtAsset, amount, p.account);
        debtToken.forceApprove(address(adapter), 0);
        uint256 balAfter = debtToken.balanceOf(address(this));
        uint256 spent = balBefore + amount - balAfter;
        if (balAfter > balBefore) {
            uint256 unused = balAfter - balBefore;
            debtToken.forceApprove(address(LIQUIDITY), unused);
            LIQUIDITY.returnUnused(best.id, unused);
        }

        // Verify economic effect against the lender's authoritative state.
        BastionTypes.Position memory after_ = adapter.getPosition(p.account, p.collateralAsset, p.debtAsset);
        if (after_.debtAmount >= pos.debtAmount || pos.debtAmount - after_.debtAmount + 1 < spent) {
            revert BastionErrors.NoEconomicEffect();
        }
        if (after_.healthFactor <= pos.healthFactor) revert BastionErrors.NoEconomicEffect();

        r.repaid = spent;
        r.fee = Math.mulDiv(spent, best.feeBps, BastionTypes.BPS);
        r.debtAfter = after_.debtAmount;
        r.healthFactorAfter = after_.healthFactor;
        r.solver = best.solver;
        r.commitmentId = best.id;

        POLICIES.consume(req.policyId, req.policyVersion, BastionTypes.PATH_SOLVER, r.repaid, r.fee);
        SOLVERS.recordFill(best.solver, spent);
        address payout = SOLVERS.payoutOf(best.solver);
        LEDGER.recordSolverExecution(req.rescueId, best.solver, payout, r.repaid, r.fee);
        _receipt(req, p, adapter, r, p.destChainId);
        emit SolverRescueExecuted(
            req.rescueId, req.policyId, best.solver, payout, r.repaid, r.fee, uint64(block.timestamp), req.originEventId
        );
    }
}
