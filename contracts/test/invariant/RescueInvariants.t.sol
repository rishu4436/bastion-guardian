// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { Test, Vm } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ISystemContract } from "@reactive/src/interfaces/ISystemContract.sol";
import { BastionTestBase } from "../BastionTestBase.sol";
import { BastionTypes } from "../../src/libraries/BastionTypes.sol";
import { BastionRiskObserver } from "../../src/oracles/BastionRiskObserver.sol";
import { SolverRescueExecutor } from "../../src/rescue/SolverRescueExecutor.sol";
import { CrossChainReserveEscrow } from "../../src/settlement/CrossChainReserveEscrow.sol";

/// @notice Stateful fuzzing handler that drives the full stack through Reactive-simulated cycles with adversarial
///         interleavings: crashes, recoveries, replays, duplicate settlements, borrower repayments racing a rescue,
///         policy version replacement, budget pause, solver cancellations and reserve withdrawals.
contract RescueHandler is Test {
    RescueInvariantsTest internal t;
    ISystemContract.CallbackConfiguration_V_1_0[] internal riskCallbacks;
    ISystemContract.CallbackConfiguration_V_1_0[] internal settleCallbacks;

    uint256 public ghostDebtIncreasesByRescue;
    uint256 public ghostRescues;
    uint256 public ghostReplays;
    uint256 public ghostSettlementDeliveries;

    constructor(RescueInvariantsTest t_) {
        t = t_;
    }

    function crash(uint256 price) external {
        price = bound(price, 1300e8, 2400e8);
        t.h_setPrice(price);
        vm.warp(block.timestamp + 11);
    }

    function observeAndRescue() external {
        vm.warp(block.timestamp + 11);
        uint256 debtBefore = t.h_debt();
        vm.recordLogs();
        (bool emitted,) = t.observer_().observe(t.policyId());
        if (!emitted) return;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        (bool req, ISystemContract.CallbackConfiguration_V_1_0 memory cfg) =
            t.h_reactFrom(logs, address(t.observer_()), BastionRiskObserver.RiskObserved.selector, 84_532);
        if (!req) return;
        riskCallbacks.push(cfg);
        vm.recordLogs();
        t.h_deliverBase(cfg);
        logs = vm.getRecordedLogs();
        if (t.h_debt() > debtBefore) ghostDebtIncreasesByRescue++;
        if (t.h_debt() < debtBefore) ghostRescues++;
        (bool req2, ISystemContract.CallbackConfiguration_V_1_0 memory cfg2) =
            t.h_reactFrom(logs, address(t.solverExec_()), SolverRescueExecutor.SolverRescueExecuted.selector, 84_532);
        if (req2) settleCallbacks.push(cfg2);
    }

    function replayRisk(uint256 i) external {
        if (riskCallbacks.length == 0) return;
        uint256 debtBefore = t.h_debt();
        t.h_deliverBase(riskCallbacks[bound(i, 0, riskCallbacks.length - 1)]);
        if (t.h_debt() != debtBefore) ghostReplays++;
    }

    function deliverSettlement(uint256 i) external {
        if (settleCallbacks.length == 0) return;
        t.h_deliverUni(settleCallbacks[bound(i, 0, settleCallbacks.length - 1)]);
        ghostSettlementDeliveries++;
    }

    function borrowerRepays(uint256 amt) external {
        amt = bound(amt, 1e6, 2000e6);
        t.h_borrowerRepay(amt);
    }

    function replacePolicy() external {
        t.h_replacePolicy();
    }

    function toggleBudgetPause(bool p) external {
        t.h_budgetPause(p);
    }

    function withdrawFreeReserve(uint256 amt) external {
        t.h_withdrawFree(amt);
    }

    function retry(uint256 i) external {
        t.h_retryAll(i);
    }
}

contract RescueInvariantsTest is BastionTestBase {
    RescueHandler internal handler;
    bytes32 public policyId;
    uint64 public version;
    bytes32[] internal rescueIds;
    address internal payout2;

    function setUp() public override {
        super.setUp();
        _openBorrowerPosition(13_000e6);
        (BastionTypes.Policy memory p, address[] memory s, address[] memory r) = _defaultPolicy();
        p.allowPartial = true;
        p.maxRepayPerAction = 3000e6;
        p.maxTotalRepay = 9000e6;
        (policyId, version) = _register(p, s, r);
        _onboardSolver(solver, solverPayout, 60_000e6);
        payout2 = makeAddr("payout2");
        _onboardSolver(solver2, payout2, 60_000e6);
        _commit(solver, policyId, 20_000e6, 50);
        _commit(solver2, policyId, 20_000e6, 80);
        address aToken = market.getReserveAToken(address(weth));
        vm.prank(borrower);
        IERC20(aToken).approve(address(adapter), type(uint256).max);
        _fundReserve(policyId, 9000e6, 200e6);
        vm.startPrank(borrower);
        vault.deposit(address(reserveUsdc), 5000e6); // extra free balance
        usdc.approve(address(market), type(uint256).max);
        vm.stopPrank();
        vm.prank(gov);
        core.setPolicyMirror(policyId, true, version, 0);

        handler = new RescueHandler(this);
        targetContract(address(handler));
    }

    // ---------------- helper surface used by the handler (keeps prank context inside the test contract)

    function observer_() external view returns (BastionRiskObserver) {
        return observer;
    }

    function solverExec_() external view returns (SolverRescueExecutor) {
        return solverExec;
    }

    function h_setPrice(uint256 p) external {
        _crash(p);
    }

    function h_debt() external view returns (uint256) {
        return adapter.getDebt(borrower, address(usdc));
    }

    function h_reactFrom(Vm.Log[] memory logs, address emitter, bytes32 topic0, uint256 chainId)
        external
        returns (bool, ISystemContract.CallbackConfiguration_V_1_0 memory cfg)
    {
        (Vm.Log memory l, bool found) = _findLog(logs, emitter, topic0);
        if (!found) return (false, cfg);
        if (topic0 == SolverRescueExecutor.SolverRescueExecuted.selector) rescueIds.push(l.topics[1]);
        return _react(_toLogRecord(l, chainId));
    }

    function h_deliverBase(ISystemContract.CallbackConfiguration_V_1_0 memory cfg) external {
        _deliver(baseProxy, cfg);
    }

    function h_deliverUni(ISystemContract.CallbackConfiguration_V_1_0 memory cfg) external {
        _deliver(uniProxy, cfg);
    }

    function h_borrowerRepay(uint256 amt) external {
        uint256 d = adapter.getDebt(borrower, address(usdc));
        if (d == 0) return;
        if (amt > d) amt = d;
        vm.prank(gov);
        usdc.mint(borrower, amt);
        vm.prank(borrower);
        market.repay(address(usdc), amt, 2, borrower);
    }

    function h_replacePolicy() external {
        (BastionTypes.Policy memory p, address[] memory s, address[] memory r) = _defaultPolicy();
        p.allowPartial = true;
        p.maxRepayPerAction = 3000e6;
        p.maxTotalRepay = 9000e6;
        (, version) = _register(p, s, r);
        vm.prank(gov);
        core.setPolicyMirror(policyId, true, version, 0);
    }

    function h_budgetPause(bool p) external {
        vm.prank(borrower);
        if (p) vault.pauseBudget(policyId);
        else vault.resumeBudget(policyId);
    }

    function h_withdrawFree(uint256 amt) external {
        uint256 free = vault.freeBalance(borrower, address(reserveUsdc));
        amt = bound(amt, 0, free);
        uint256 before = reserveUsdc.balanceOf(borrower);
        vm.prank(borrower);
        vault.withdraw(address(reserveUsdc), amt);
        require(reserveUsdc.balanceOf(borrower) - before == amt, "I4 violated");
    }

    function h_retryAll(uint256) external {
        for (uint256 i; i < rescueIds.length; ++i) {
            if (escrow.getClaim(rescueIds[i]).state == CrossChainReserveEscrow.SettlementState.RecoveryRequired) {
                escrow.retrySettlement(rescueIds[i]);
            }
        }
    }

    /// @notice Non-vacuity guard: the handler's Reactive-simulated path really repays debt and settles.
    function test_handlerPathExecutesRealRescueAndSettlement() public {
        handler.crash(1300e8);
        handler.observeAndRescue();
        assertEq(handler.ghostRescues(), 1, "rescue executed through handler path");
        handler.deliverSettlement(0);
        assertGt(reserveUsdc.balanceOf(solverPayout) + reserveUsdc.balanceOf(payout2), 0, "solver reimbursed");
        handler.replayRisk(0);
        handler.deliverSettlement(0);
        invariant_noDoubleReimbursement();
        invariant_replaysAndRescuesSafe();
    }

    function afterInvariant() external view {
        // Surface how much real activity each run produced (visible with -vv).
        handler.ghostRescues();
    }

    // ---------------- invariants (Section 21)

    /// I1/I2/I9: cumulative spend across both paths never exceeds the user authorization.
    function invariant_totalSpendWithinAuthorization() public view {
        (BastionTypes.Policy memory p, BastionTypes.PolicyState memory s) = policies.getPolicy(policyId);
        assertLe(s.totalRepaid, p.maxTotalRepay);
        assertLe(s.totalFees, p.maxTotalFees);
    }

    /// I3/I6: each rescue reimbursed at most once, and total paid to solvers equals the sum of reimbursed claims.
    function invariant_noDoubleReimbursement() public view {
        uint256 claimed;
        for (uint256 i; i < rescueIds.length; ++i) {
            CrossChainReserveEscrow.Claim memory c = escrow.getClaim(rescueIds[i]);
            if (c.state == CrossChainReserveEscrow.SettlementState.Reimbursed) claimed += c.principal + c.fee;
        }
        uint256 paid = reserveUsdc.balanceOf(solverPayout) + reserveUsdc.balanceOf(payout2);
        assertEq(paid, claimed, "payouts == reimbursed claims");
        assertEq(vault.getBudget(borrower, policyId).totalReimbursed, claimed);
    }

    /// I4: vault accounting is fully backed — every free and budgeted unit exists in the vault.
    function invariant_vaultFullyBacked() public view {
        assertEq(vault.totalHeld(address(reserveUsdc)), reserveUsdc.balanceOf(address(vault)));
    }

    /// I7: executors never retain tokens (no unpaid flash loan, no stuck solver liquidity).
    function invariant_executorsHoldNothing() public view {
        assertEq(usdc.balanceOf(address(flashExec)), 0);
        assertEq(weth.balanceOf(address(flashExec)), 0);
        assertEq(usdc.balanceOf(address(solverExec)), 0);
    }

    /// I8/I10: replayed callbacks never move funds; rescues never increase debt.
    function invariant_replaysAndRescuesSafe() public view {
        assertEq(handler.ghostReplays(), 0, "replay changed debt");
        assertEq(handler.ghostDebtIncreasesByRescue(), 0, "rescue increased debt");
    }

    /// Solver vault accounting: committed + available is backed by vault balance.
    function invariant_solverInventoryBacked() public view {
        uint256 tracked = liquidity.available(solver, address(usdc)) + liquidity.committed(solver, address(usdc))
            + liquidity.available(solver2, address(usdc)) + liquidity.committed(solver2, address(usdc));
        assertEq(tracked, usdc.balanceOf(address(liquidity)));
    }

    function invariant_pendingSettlementsConsistent() public view {
        uint256 pending;
        for (uint256 i; i < rescueIds.length; ++i) {
            if (uint8(ledger.stateOf(rescueIds[i])) == 6) pending++; // SettlementPending
        }
        assertEq(ledger.pendingSettlements(), pending);
    }
}
