// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { BastionTestBase } from "../BastionTestBase.sol";
import { BastionErrors } from "../../src/libraries/BastionErrors.sol";
import { SolverQuoteManager } from "../../src/solvers/SolverQuoteManager.sol";
import { SolverLiquidityVault } from "../../src/solvers/SolverLiquidityVault.sol";

contract SolverMarketplaceTest is BastionTestBase {
    bytes32 internal pid;

    function setUp() public override {
        super.setUp();
        (pid,) = _registerDefault();
        _onboardSolver(solver, solverPayout, 50_000e6);
        _onboardSolver(solver2, makeAddr("payout2"), 50_000e6);
    }

    function test_registrationRequiresBond() public {
        address s3 = makeAddr("s3");
        vm.prank(gov);
        usdc.mint(s3, 50e6);
        vm.startPrank(s3);
        usdc.approve(address(solverRegistry), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(BastionErrors.InvalidParameter.selector, bytes32("BOND")));
        solverRegistry.register(s3, 50e6, "");
        vm.stopPrank();
        assertTrue(solverRegistry.isEligible(solver));
    }

    function test_commitReservesInventory() public {
        bytes32 id = _commit(solver, pid, 10_000e6, 40);
        assertEq(liquidity.available(solver, address(usdc)), 40_000e6);
        assertEq(liquidity.committed(solver, address(usdc)), 10_000e6);
        vm.prank(solver);
        vm.expectRevert();
        liquidity.withdraw(address(usdc), 40_000e6 + 1); // committed funds locked
        vm.prank(solver);
        liquidity.release(id);
        assertEq(liquidity.available(solver, address(usdc)), 50_000e6);
    }

    function test_commitBeyondInventoryRejected() public {
        vm.prank(solver);
        vm.expectRevert();
        liquidity.commit(pid, address(usdc), 50_000e6 + 1, 10, uint64(block.timestamp + 1));
    }

    function test_expiredCommitmentReclaimableByAnyoneOnlyAfterExpiry() public {
        bytes32 id = _commit(solver, pid, 1000e6, 40);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(BastionErrors.Unauthorized.selector, attacker));
        liquidity.release(id);
        vm.warp(block.timestamp + 1 days);
        vm.prank(attacker);
        liquidity.release(id);
        assertEq(liquidity.available(solver, address(usdc)), 50_000e6);
    }

    function test_rankingIsDeterministic() public {
        bytes32 a = _commit(solver, pid, 5000e6, 50);
        bytes32 b = _commit(solver2, pid, 5000e6, 30); // cheaper
        bytes32 c = _commit(solver2, pid, 1000e6, 10); // cheapest but partial
        SolverQuoteManager.Candidate[] memory r = quotes.rankedCandidates(pid, address(usdc), 3000e6, 100);
        assertEq(r.length, 3);
        assertEq(r[0].id, b);
        assertEq(r[1].id, a);
        assertEq(r[2].id, c);
        // fee ceiling filters
        r = quotes.rankedCandidates(pid, address(usdc), 3000e6, 40);
        assertEq(r.length, 2);
        assertEq(r[0].id, b);
    }

    function test_suspendedOrDisallowedSolverSkipped() public {
        _commit(solver, pid, 5000e6, 50);
        vm.prank(gov);
        solverRegistry.setSuspended(solver, true, "risk");
        (bool found,) = quotes.selectBest(pid, address(usdc), 1000e6, 100);
        assertFalse(found);
    }

    function test_onlyExecutorCanDraw() public {
        bytes32 id = _commit(solver, pid, 5000e6, 50);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(BastionErrors.Unauthorized.selector, attacker));
        liquidity.draw(id, 1, attacker);
    }

    function test_exitBlockedWhileCommitted() public {
        bytes32 id = _commit(solver, pid, 5000e6, 50);
        vm.startPrank(solver);
        solverRegistry.requestExit();
        assertFalse(solverRegistry.isEligible(solver));
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(abi.encodeWithSelector(BastionErrors.InvalidParameter.selector, bytes32("COMMITTED_LIQUIDITY")));
        solverRegistry.completeExit();
        liquidity.release(id);
        uint256 before = usdc.balanceOf(solver);
        solverRegistry.completeExit();
        assertEq(usdc.balanceOf(solver) - before, 100e6);
        vm.stopPrank();
    }

    function test_commitmentListIsBounded() public {
        for (uint256 i; i < 8; ++i) {
            _commit(solver, pid, 100e6, 10);
        }
        vm.prank(solver);
        vm.expectRevert(
            abi.encodeWithSelector(BastionErrors.InvalidParameter.selector, bytes32("TOO_MANY_COMMITMENTS"))
        );
        liquidity.commit(pid, address(usdc), 100e6, 10, uint64(block.timestamp + 1 days));
    }
}
