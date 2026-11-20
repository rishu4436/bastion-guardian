// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { Test } from "forge-std/Test.sol";
import { RescueSettlementLedger } from "../../src/settlement/RescueSettlementLedger.sol";
import { BastionErrors } from "../../src/libraries/BastionErrors.sol";

contract SettlementLedgerTest is Test {
    RescueSettlementLedger internal ledger;

    function setUp() public {
        ledger = new RescueSettlementLedger(address(this));
        ledger.setWriter(address(this), true);
    }

    function test_happyPathSolver() public {
        ledger.open("r", "p", 1, "e");
        ledger.authorize("r", 2);
        ledger.recordSolverExecution("r", address(1), address(2), 100, 1);
        assertEq(uint8(ledger.stateOf("r")), uint8(RescueSettlementLedger.State.SettlementPending));
        assertTrue(ledger.recordReimbursed("r", "s"));
        assertFalse(ledger.recordReimbursed("r", "s"), "idempotent ack");
        assertEq(ledger.pendingSettlements(), 0);
    }

    function test_cannotReopen() public {
        ledger.open("r", "p", 1, "e");
        vm.expectRevert(abi.encodeWithSelector(BastionErrors.AlreadyProcessed.selector, bytes32("r")));
        ledger.open("r", "p", 1, "e");
    }

    function test_terminalStatesAreFinal() public {
        ledger.open("r", "p", 1, "e");
        ledger.recordFailure("r", "x");
        vm.expectRevert();
        ledger.authorize("r", 1);
    }

    function test_recoveryPath() public {
        ledger.open("r", "p", 1, "e");
        ledger.authorize("r", 2);
        ledger.recordSolverExecution("r", address(1), address(2), 100, 1);
        ledger.recordRecoveryRequired("r", "timeout");
        ledger.recordReimbursed("r", "s");
        assertEq(uint8(ledger.stateOf("r")), uint8(RescueSettlementLedger.State.ReimbursementComplete));
    }

    function test_onlyWriter() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert();
        ledger.open("x", "p", 1, "e");
    }

    function testFuzz_transitionTableNeverLeavesTerminal(uint8 a) public view {
        RescueSettlementLedger.State to = RescueSettlementLedger.State(bound(a, 0, 11));
        assertFalse(ledger.isValidTransition(RescueSettlementLedger.State.ReimbursementComplete, to));
        assertFalse(ledger.isValidTransition(RescueSettlementLedger.State.ExecutionFailed, to));
        assertFalse(
            ledger.isValidTransition(
                RescueSettlementLedger.State.DestinationExecuted, RescueSettlementLedger.State.Requested
            )
        );
    }
}
