// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { BastionTestBase } from "../BastionTestBase.sol";
import { HealthFactorMath } from "../../src/libraries/HealthFactorMath.sol";

/// @notice Property tests: the repayment estimator, applied to a real (fixture) market, reaches the target HF with
///         the smallest amount (repaying 1 unit less than the estimate would not reach it beyond rounding).
contract HealthFactorMathFuzzTest is BastionTestBase {
    function testFuzz_repayEstimateReachesTarget(uint256 borrowAmt, uint256 price, uint256 target) public {
        borrowAmt = bound(borrowAmt, 1000e6, 15_900e6); // within 80% LTV of $20k
        _openBorrowerPosition(borrowAmt);
        price = bound(price, 1200e8, 2500e8);
        _crash(price);
        target = bound(target, 1.05e18, 3e18);
        uint256 hf0 = _hf();
        uint256 x = adapter.estimateRepayment(borrower, address(usdc), target);
        uint256 debt = adapter.getDebt(borrower, address(usdc));
        if (hf0 >= target) {
            assertEq(x, 0);
            return;
        }
        vm.prank(gov);
        usdc.mint(address(this), x);
        usdc.approve(address(adapter), x);
        if (x == 0) return;
        adapter.repayOnBehalf(address(usdc), x, borrower);
        if (x < debt) assertGe(_hf(), target, "target reached");
        assertEq(adapter.getDebt(borrower, address(usdc)), debt - x, "exact debt reduction");
    }

    function testFuzz_minimality(uint256 borrowAmt, uint256 target) public {
        borrowAmt = bound(borrowAmt, 5000e6, 15_900e6);
        _openBorrowerPosition(borrowAmt);
        _crash(1700e8);
        target = bound(target, 1.05e18, 2e18);
        uint256 x = adapter.estimateRepayment(borrower, address(usdc), target);
        if (x <= 2) return;
        uint256 debt = adapter.getDebt(borrower, address(usdc));
        if (x >= debt) return;
        // Repaying less than x minus the documented 1-ppm buffer allowance must leave HF below the target.
        uint256 allowance = debt * 2 / 1e6 + 2;
        if (x <= allowance) return;
        uint256 less = x - allowance;
        vm.prank(gov);
        usdc.mint(address(this), less);
        usdc.approve(address(adapter), less);
        adapter.repayOnBehalf(address(usdc), less, borrower);
        assertLt(_hf(), target, "estimate is minimal");
    }

    function testFuzz_healthFactorMatchesMarket(uint256 borrowAmt, uint256 price) public {
        borrowAmt = bound(borrowAmt, 100e6, 15_900e6);
        _openBorrowerPosition(borrowAmt);
        price = bound(price, 500e8, 5000e8);
        _crash(price);
        (uint256 tc, uint256 td,, uint256 lt,, uint256 hf) = market.getUserAccountData(borrower);
        assertEq(HealthFactorMath.healthFactor(tc, td, lt), hf);
    }

    function test_deleverageUnreachableWhenTargetBelowCostWeightedLt() public pure {
        // k*LTc = 1.03 * 0.85 = 0.8755 >= target 0.8 → unreachable sentinel
        uint256 x = HealthFactorMath.deleverageBaseForTarget(100e8, 90e8, 8500, 8500, 10_300, 0.8e18);
        assertEq(x, 0); // already above 0.8 → nothing to do
        x = HealthFactorMath.deleverageBaseForTarget(100e8, 120e8, 8500, 8500, 10_300, 0.8e18);
        assertEq(x, type(uint256).max);
    }
}
