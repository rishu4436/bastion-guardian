// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { BastionTestBase } from "../BastionTestBase.sol";
import { BastionTypes } from "../../src/libraries/BastionTypes.sol";
import { BastionErrors } from "../../src/libraries/BastionErrors.sol";

contract EmergencyControlTest is BastionTestBase {
    function test_guardianPausesOwnerResumesWithQuorum() public {
        vm.prank(guardian);
        emergency.pause(BastionTypes.SCOPE_RESCUE, "oracle");
        assertTrue(emergency.isPaused(BastionTypes.SCOPE_RESCUE));
        vm.prank(gov);
        vm.expectRevert(abi.encodeWithSelector(BastionErrors.InvalidParameter.selector, bytes32("RESUME_QUORUM")));
        emergency.resume(BastionTypes.SCOPE_RESCUE);
        vm.prank(guardian);
        emergency.approveResume(BastionTypes.SCOPE_RESCUE);
        vm.prank(guardian);
        vm.expectRevert();
        emergency.resume(BastionTypes.SCOPE_RESCUE); // guardian cannot resume alone
        vm.prank(gov);
        emergency.resume(BastionTypes.SCOPE_RESCUE);
        assertFalse(emergency.isPaused(BastionTypes.SCOPE_RESCUE));
    }

    function test_approvalsDoNotCarryAcrossPauseEpochs() public {
        vm.prank(guardian);
        emergency.pause(BastionTypes.SCOPE_RESCUE, "a");
        vm.prank(guardian);
        emergency.approveResume(BastionTypes.SCOPE_RESCUE);
        vm.prank(gov);
        emergency.resume(BastionTypes.SCOPE_RESCUE);
        vm.prank(guardian);
        emergency.pause(BastionTypes.SCOPE_RESCUE, "b");
        vm.prank(gov);
        vm.expectRevert();
        emergency.resume(BastionTypes.SCOPE_RESCUE);
    }

    function test_strangerCannotPause() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(BastionErrors.Unauthorized.selector, attacker));
        emergency.pause(BastionTypes.SCOPE_ALL, "x");
    }

    function test_globalScopeCoversAll() public {
        vm.prank(gov);
        emergency.pause(BastionTypes.SCOPE_ALL, "x");
        assertTrue(emergency.isPaused(BastionTypes.SCOPE_SETTLEMENT));
        assertTrue(emergency.isPaused(BastionTypes.SCOPE_SOLVER));
    }
}
