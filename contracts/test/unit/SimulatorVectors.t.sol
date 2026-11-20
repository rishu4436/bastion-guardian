// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { BastionTestBase } from "../BastionTestBase.sol";
import { BastionTypes } from "../../src/libraries/BastionTypes.sol";
import { RescueSettlementLedger } from "../../src/settlement/RescueSettlementLedger.sol";

/// @notice Runs the REAL executors on the labeled fixture market for the Section 10 shock levels and writes the
///         results to out-evidence/vectors/foundry-vectors.json. packages/simulator asserts its bigint model reproduces
///         every number exactly (copy committed at packages/simulator/test/fixtures/foundry-vectors.json; CI diffs).
contract SimulatorVectorsTest is BastionTestBase {
    uint256[4] internal SHOCKS = [uint256(500), 1000, 2000, 4000];

    function setUp() public override {
        super.setUp();
        _openBorrowerPosition(13_000e6);
        _onboardSolver(solver, solverPayout, 50_000e6);
    }

    function _policy(uint8 paths) internal returns (bytes32 id) {
        (BastionTypes.Policy memory p, address[] memory s, address[] memory r) = _defaultPolicy();
        p.allowedPaths = paths;
        p.maxRepayPerAction = 8000e6;
        (id,) = _register(p, s, r);
    }

    function _row(string memory key, uint256 shock, string memory path, bool ok, uint256 hfShock)
        internal
        returns (string memory)
    {
        string memory k = string.concat(key, "-", path);
        vm.serializeUint(k, "shockBps", shock);
        vm.serializeString(k, "path", path);
        vm.serializeBool(k, "success", ok);
        vm.serializeUint(k, "hfAfterShock", hfShock);
        vm.serializeUint(k, "debtAfter", adapter.getDebt(borrower, address(usdc)));
        vm.serializeUint(k, "collateralAfter", adapter.getCollateral(borrower, address(weth)));
        vm.serializeUint(k, "borrowerUsdcWallet", usdc.balanceOf(borrower));
        return vm.serializeUint(k, "hfAfter", _hf());
    }

    function _str(bytes32 b) internal pure returns (string memory) {
        uint256 n;
        while (n < 32 && b[n] != 0) ++n;
        bytes memory out = new bytes(n);
        for (uint256 i; i < n; ++i) {
            out[i] = b[i];
        }
        return string(out);
    }

    function test_writeShockVectors() public {
        string memory root = "vectors";
        string memory out;
        for (uint256 i; i < SHOCKS.length; ++i) {
            uint256 price = 2000e8 * (10_000 - SHOCKS[i]) / 10_000;
            string memory key = vm.toString(SHOCKS[i]);

            // Solver path.
            uint256 snap = vm.snapshotState();
            bytes32 pid = _policy(BastionTypes.PATH_SOLVER);
            _commit(solver, pid, 8000e6, 50);
            _crash(price);
            uint256 hfShock = _hf();
            (, bytes32 sWhy) = solverExec.isFeasible(pid);
            vm.serializeString(string.concat(key, "-solver"), "reason", _str(sWhy));
            vm.prank(borrower);
            bytes32 rid = router.requestManualRescue(pid);
            bool ok = ledger.stateOf(rid) == RescueSettlementLedger.State.SettlementPending;
            string memory solverJson = _row(key, SHOCKS[i], "solver", ok, hfShock);
            vm.revertToState(snap);

            // Flash path (bounded aToken approval of 5 fWETH).
            snap = vm.snapshotState();
            pid = _policy(BastionTypes.PATH_FLASH);
            IERC20 aToken = IERC20(market.getReserveAToken(address(weth)));
            vm.prank(borrower);
            aToken.approve(address(adapter), 5e18);
            _crash(price);
            (, bytes32 why) = flashExec.isFeasible(pid);
            vm.prank(borrower);
            rid = router.requestManualRescue(pid);
            ok = ledger.stateOf(rid) == RescueSettlementLedger.State.DestinationExecuted;
            vm.serializeString(string.concat(key, "-flash"), "reason", _str(why));
            string memory flashJson = _row(key, SHOCKS[i], "flash", ok, hfShock);
            vm.revertToState(snap);

            vm.serializeString(root, string.concat(key, "_solver"), solverJson);
            out = vm.serializeString(root, string.concat(key, "_flash"), flashJson);
        }
        vm.createDir("out-evidence/vectors", true);
        vm.writeJson(out, "out-evidence/vectors/foundry-vectors.json");
    }
}
