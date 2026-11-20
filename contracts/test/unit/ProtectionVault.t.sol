// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { BastionTestBase } from "../BastionTestBase.sol";
import { BastionTypes } from "../../src/libraries/BastionTypes.sol";
import { BastionErrors } from "../../src/libraries/BastionErrors.sol";
import { BastionProtectionVault } from "../../src/vaults/BastionProtectionVault.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract FeeOnTransferToken is ERC20 {
    constructor() ERC20("FoT", "FOT") {
        _mint(msg.sender, 1e30);
    }

    function _update(address f, address t, uint256 v) internal override {
        if (f != address(0) && t != address(0)) {
            super._update(f, address(0xdead), v / 100);
            v -= v / 100;
        }
        super._update(f, t, v);
    }
}

contract ProtectionVaultTest is BastionTestBase {
    bytes32 internal constant PID = keccak256("policy");

    function setUp() public override {
        super.setUp();
        vm.startPrank(borrower);
        reserveUsdc.approve(address(vault), type(uint256).max);
        vault.deposit(address(reserveUsdc), 10_000e6);
        vm.stopPrank();
    }

    function test_depositWithdrawFree() public {
        assertEq(vault.freeBalance(borrower, address(reserveUsdc)), 10_000e6);
        vm.prank(borrower);
        vault.withdraw(address(reserveUsdc), 4000e6);
        assertEq(vault.freeBalance(borrower, address(reserveUsdc)), 6000e6);
        vm.prank(borrower);
        vm.expectRevert();
        vault.withdraw(address(reserveUsdc), 6000e6 + 1);
    }

    function test_unsupportedAndFeeOnTransferTokensRejected() public {
        FeeOnTransferToken fot = new FeeOnTransferToken();
        vm.expectRevert(abi.encodeWithSelector(BastionErrors.UnsupportedToken.selector, address(fot)));
        vault.deposit(address(fot), 1e18);
        vm.prank(gov);
        vault.setSupportedToken(address(fot), true);
        fot.approve(address(vault), type(uint256).max);
        vm.expectRevert();
        vault.deposit(address(fot), 1e18);
    }

    function test_committedFundsNotWithdrawableButFreeAlwaysIs() public {
        vm.startPrank(borrower);
        vault.allocate(PID, address(reserveUsdc), 7000e6, 100e6, 100);
        vm.expectRevert();
        vault.withdraw(address(reserveUsdc), 3000e6);
        vault.withdraw(address(reserveUsdc), 2900e6);
        vm.stopPrank();
        // I4: global emergency pause never blocks withdrawal of free funds.
        vm.prank(gov);
        emergency.pause(BastionTypes.SCOPE_ALL, "incident");
        vm.prank(borrower);
        vault.deposit(address(reserveUsdc), 1e6);
        vm.prank(borrower);
        vault.withdraw(address(reserveUsdc), 1e6);
    }

    function test_releaseRequiresDelay() public {
        vm.startPrank(borrower);
        vault.allocate(PID, address(reserveUsdc), 5000e6, 50e6, 100);
        vm.expectRevert(abi.encodeWithSelector(BastionErrors.InvalidParameter.selector, bytes32("RELEASE_DELAY")));
        vault.release(PID, 5000e6, 50e6);
        vault.requestRelease(PID);
        vm.warp(block.timestamp + 1 hours - 1);
        vm.expectRevert();
        vault.release(PID, 5000e6, 50e6);
        vm.warp(block.timestamp + 1);
        vault.release(PID, 5000e6, 50e6);
        assertEq(vault.freeBalance(borrower, address(reserveUsdc)), 10_000e6);
        vm.stopPrank();
    }

    function test_settleOnlySettlerWithinLimits() public {
        vm.prank(borrower);
        vault.allocate(PID, address(reserveUsdc), 5000e6, 50e6, 100);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(BastionErrors.Unauthorized.selector, attacker));
        vault.settle(PID, attacker, 1e6, 0, uint64(block.timestamp));
        vm.startPrank(address(escrow));
        vm.expectRevert();
        vault.settle(PID, solverPayout, 5000e6 + 1, 0, uint64(block.timestamp));
        vm.expectRevert(abi.encodeWithSelector(BastionErrors.FeeRateExceeded.selector, 11e6, 1000e6, 100));
        vault.settle(PID, solverPayout, 1000e6, 11e6, uint64(block.timestamp));
        vault.settle(PID, solverPayout, 1000e6, 10e6, uint64(block.timestamp));
        vm.stopPrank();
        assertEq(reserveUsdc.balanceOf(solverPayout), 1010e6);
        assertEq(vault.totalHeld(address(reserveUsdc)), reserveUsdc.balanceOf(address(vault)));
    }

    function test_pausedBudgetPreservesEarlierObligations() public {
        vm.prank(borrower);
        vault.allocate(PID, address(reserveUsdc), 5000e6, 50e6, 100);
        uint64 before = uint64(block.timestamp);
        vm.warp(block.timestamp + 10);
        vm.prank(borrower);
        vault.pauseBudget(PID);
        vm.startPrank(address(escrow));
        vault.settle(PID, solverPayout, 1000e6, 0, before); // executed before pause: honored
        vm.expectRevert(abi.encodeWithSelector(BastionErrors.PolicyNotActive.selector, PID));
        vault.settle(PID, solverPayout, 1000e6, 0, uint64(block.timestamp + 1)); // after pause: rejected
        vm.stopPrank();
    }

    function test_feeCeilingCannotBeRaisedSilently() public {
        vm.startPrank(borrower);
        vault.allocate(PID, address(reserveUsdc), 1000e6, 10e6, 50);
        vm.expectRevert(abi.encodeWithSelector(BastionErrors.InvalidParameter.selector, bytes32("FEE_CEILING_RAISE")));
        vault.allocate(PID, address(reserveUsdc), 1000e6, 10e6, 100);
        vm.stopPrank();
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(BastionErrors.Unauthorized.selector, attacker));
        vault.allocate(PID, address(reserveUsdc), 0, 0, 50);
    }

    function testFuzz_freeFundsAlwaysWithdrawable(uint256 dep, uint256 alloc) public {
        dep = bound(dep, 1, 40_000e6);
        alloc = bound(alloc, 0, dep);
        vm.startPrank(borrower);
        vault.deposit(address(reserveUsdc), dep);
        vault.allocate(keccak256("p2"), address(reserveUsdc), alloc, 0, 0);
        uint256 free = vault.freeBalance(borrower, address(reserveUsdc));
        uint256 balBefore = reserveUsdc.balanceOf(borrower);
        vault.withdraw(address(reserveUsdc), free);
        vm.stopPrank();
        assertEq(reserveUsdc.balanceOf(borrower) - balBefore, free);
        assertEq(vault.totalHeld(address(reserveUsdc)), reserveUsdc.balanceOf(address(vault)));
    }
}
