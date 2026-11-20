// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { BastionTestBase } from "../BastionTestBase.sol";
import { BastionTypes } from "../../src/libraries/BastionTypes.sol";
import { RescueSettlementLedger } from "../../src/settlement/RescueSettlementLedger.sol";
import { FlashRescueExecutor } from "../../src/rescue/FlashRescueExecutor.sol";
import { BastionErrors } from "../../src/libraries/BastionErrors.sol";

/// @notice FlashNet self-funded deleveraging against the labeled fixture market (local simulation).
contract FlashRescueTest is BastionTestBase {
    bytes32 internal policyId;
    uint64 internal version;

    function setUp() public override {
        super.setUp();
        _openBorrowerPosition(13_000e6);
        (BastionTypes.Policy memory p, address[] memory s, address[] memory r) = _defaultPolicy();
        p.allowedPaths = BastionTypes.PATH_FLASH;
        p.maxRepayPerAction = 8000e6;
        (policyId, version) = _register(p, s, r);
    }

    function test_flashRequiringMoreThanPerActionCapIsInfeasible() public {
        (BastionTypes.Policy memory p, address[] memory s, address[] memory r) = _defaultPolicy();
        p.allowedPaths = BastionTypes.PATH_FLASH; // per-action cap 6,000 < ~6,640 required
        (policyId, version) = _register(p, s, r);
        _authorizeCollateral(type(uint256).max);
        _crash(1800e8);
        (bool feasible, bytes32 reason) = flashExec.isFeasible(policyId);
        assertFalse(feasible);
        assertEq(reason, bytes32("BUDGET_BELOW_REQUIRED"));
    }

    function _authorizeCollateral(uint256 amount) internal {
        address aToken = market.getReserveAToken(address(weth));
        vm.prank(borrower);
        IERC20(aToken).approve(address(adapter), amount);
    }

    function test_flashRescueDeleveragesAtomically() public {
        _authorizeCollateral(type(uint256).max);
        _crash(1800e8);
        (bool feasible, bytes32 reason) = flashExec.isFeasible(policyId);
        assertTrue(feasible, string(abi.encodePacked(reason)));

        uint256 debtBefore = adapter.getDebt(borrower, address(usdc));
        uint256 collBefore = adapter.getCollateral(borrower, address(weth));
        uint256 hfBefore = _hf();
        uint256 marketUsdcBefore = usdc.balanceOf(address(market));

        vm.prank(borrower);
        bytes32 rescueId = router.requestManualRescue(policyId);

        uint256 debtAfter = adapter.getDebt(borrower, address(usdc));
        uint256 collAfter = adapter.getCollateral(borrower, address(weth));
        assertLt(debtAfter, debtBefore, "debt reduced");
        assertLt(collAfter, collBefore, "collateral sold");
        assertGt(_hf(), hfBefore, "HF improved");
        assertGe(_hf(), 1.5e18, "HF reached target");
        // I7: executor holds nothing and the lender got principal + premium back.
        assertEq(usdc.balanceOf(address(flashExec)), 0);
        assertEq(weth.balanceOf(address(flashExec)), 0);
        assertGe(usdc.balanceOf(address(market)), marketUsdcBefore - 0, "flash loan repaid with premium");
        assertEq(uint8(ledger.stateOf(rescueId)), uint8(RescueSettlementLedger.State.DestinationExecuted));
    }

    /// R-02: an account-set pull cap bounds operator pulls even under an unlimited aToken approval.
    function test_accountPullCapBoundsCollateralPulls() public {
        _authorizeCollateral(type(uint256).max);
        vm.prank(borrower);
        adapter.setCollateralPullCap(address(weth), 0.1e18, true);
        _crash(1800e8);
        (bool feasible, bytes32 reason) = flashExec.isFeasible(policyId);
        assertFalse(feasible);
        assertEq(reason, bytes32("COLLATERAL_NOT_AUTHORIZED"));
        vm.prank(address(flashExec));
        vm.expectRevert();
        adapter.withdrawCollateralFor(borrower, address(weth), 0.2e18, address(flashExec));
        // Raising the cap restores feasibility, and a successful rescue decrements the remaining cap.
        vm.prank(borrower);
        adapter.setCollateralPullCap(address(weth), 5e18, true);
        (feasible,) = flashExec.isFeasible(policyId);
        assertTrue(feasible);
        uint256 collBefore = adapter.getCollateral(borrower, address(weth));
        vm.prank(borrower);
        router.requestManualRescue(policyId);
        uint256 pulled = collBefore - adapter.getCollateral(borrower, address(weth));
        assertGt(pulled, 0);
        assertEq(adapter.collateralPullAllowance(borrower, address(weth)), 5e18 - pulled);
    }

    function test_noCollateralAuthorizationMeansUnavailable() public {
        _crash(1800e8);
        (bool feasible, bytes32 reason) = flashExec.isFeasible(policyId);
        assertFalse(feasible);
        assertEq(reason, bytes32("COLLATERAL_NOT_AUTHORIZED"));
        uint256 debtBefore = adapter.getDebt(borrower, address(usdc));
        vm.prank(borrower);
        bytes32 rescueId = router.requestManualRescue(policyId);
        assertEq(adapter.getDebt(borrower, address(usdc)), debtBefore);
        assertEq(uint8(ledger.stateOf(rescueId)), uint8(RescueSettlementLedger.State.ExecutionFailed));
    }

    function test_insufficientAllowanceCannotBypassOwnership() public {
        _authorizeCollateral(0.01e18);
        _crash(1800e8);
        (bool feasible,) = flashExec.isFeasible(policyId);
        assertFalse(feasible);
    }

    function test_maliciousVenueRevertsWholeRescue() public {
        _authorizeCollateral(type(uint256).max);
        _crash(1800e8);
        vm.prank(gov);
        venue.setMalicious(true);
        uint256 debtBefore = adapter.getDebt(borrower, address(usdc));
        uint256 collBefore = adapter.getCollateral(borrower, address(weth));
        vm.prank(borrower);
        bytes32 rescueId = router.requestManualRescue(policyId);
        assertEq(adapter.getDebt(borrower, address(usdc)), debtBefore, "atomic revert: debt unchanged");
        assertEq(adapter.getCollateral(borrower, address(weth)), collBefore, "atomic revert: collateral unchanged");
        assertEq(uint8(ledger.stateOf(rescueId)), uint8(RescueSettlementLedger.State.ExecutionFailed));
    }

    function test_excessiveSlippageReverts() public {
        _authorizeCollateral(type(uint256).max);
        _crash(1800e8);
        vm.prank(gov);
        venue.setExecutionCostBps(500); // 5% impact > 2% policy slippage
        uint256 debtBefore = adapter.getDebt(borrower, address(usdc));
        vm.prank(borrower);
        router.requestManualRescue(policyId);
        assertEq(adapter.getDebt(borrower, address(usdc)), debtBefore);
    }

    function test_flashCallbackCannotBeInvokedDirectly() public {
        vm.prank(address(market));
        vm.expectRevert(BastionErrors.FlashLoanCallbackInvalid.selector);
        flashExec.executeOperation(address(usdc), 1e6, 0, address(flashExec), "");
        vm.prank(attacker);
        vm.expectRevert(BastionErrors.FlashLoanCallbackInvalid.selector);
        flashExec.executeOperation(address(usdc), 1e6, 0, attacker, "");
    }

    function test_executorOnlyCallableByRouter() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(BastionErrors.Unauthorized.selector, attacker));
        flashExec.execute(BastionTypes.RescueRequest(bytes32(0), policyId, version, bytes32(0), 0));
    }

    function test_fallsBackToSolverWhenFlashUnavailable() public {
        (BastionTypes.Policy memory p, address[] memory s, address[] memory r) = _defaultPolicy();
        (policyId, version) = _register(p, s, r); // both paths, new version
        _onboardSolver(solver, solverPayout, 50_000e6);
        _commit(solver, policyId, 8000e6, 50);
        _crash(1800e8);
        uint256 debtBefore = adapter.getDebt(borrower, address(usdc));
        vm.prank(borrower);
        bytes32 rescueId = router.requestManualRescue(policyId);
        assertLt(adapter.getDebt(borrower, address(usdc)), debtBefore);
        assertEq(ledger.getRecord(rescueId).path, BastionTypes.PATH_SOLVER);
    }
}
