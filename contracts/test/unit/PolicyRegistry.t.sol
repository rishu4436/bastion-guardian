// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { BastionTestBase } from "../BastionTestBase.sol";
import { BastionTypes } from "../../src/libraries/BastionTypes.sol";
import { BastionErrors } from "../../src/libraries/BastionErrors.sol";

contract PolicyRegistryTest is BastionTestBase {
    function test_ownerRegistersDirectly() public {
        (bytes32 id, uint64 v) = _registerDefault();
        assertEq(v, 1);
        (BastionTypes.Policy memory p, BastionTypes.PolicyState memory s) = policies.getPolicy(id);
        assertEq(p.owner, borrower);
        assertEq(uint8(s.status), uint8(BastionTypes.PolicyStatus.Active));
        assertTrue(policies.isSolverAllowed(id, solver));
        assertFalse(policies.isSolverAllowed(id, attacker));
        assertEq(policies.nonces(borrower), 1);
        assertEq(policies.policiesOf(borrower).length, 1);
    }

    function test_relayerRegistersWithEip712Signature() public {
        (BastionTypes.Policy memory p, address[] memory s, address[] memory r) = _defaultPolicy();
        bytes32 digest = policies.policyDigest(p);
        (uint8 v, bytes32 rr, bytes32 ss) = vm.sign(borrowerPk, digest);
        vm.prank(attacker); // any relayer
        (bytes32 id,) = policies.registerPolicy(p, s, r, abi.encodePacked(rr, ss, v));
        (BastionTypes.Policy memory stored,) = policies.getPolicy(id);
        assertEq(stored.owner, borrower);
    }

    function test_signatureReplayRejectedByNonce() public {
        (BastionTypes.Policy memory p, address[] memory s, address[] memory r) = _defaultPolicy();
        (uint8 v, bytes32 rr, bytes32 ss) = vm.sign(borrowerPk, policies.policyDigest(p));
        bytes memory sig = abi.encodePacked(rr, ss, v);
        policies.registerPolicy(p, s, r, sig);
        vm.expectRevert(abi.encodeWithSelector(BastionErrors.InvalidParameter.selector, bytes32("NONCE")));
        policies.registerPolicy(p, s, r, sig);
    }

    function test_forgedSignatureRejected() public {
        (BastionTypes.Policy memory p, address[] memory s, address[] memory r) = _defaultPolicy();
        (uint8 v, bytes32 rr, bytes32 ss) = vm.sign(0xBAD, policies.policyDigest(p));
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(BastionErrors.Unauthorized.selector, attacker));
        policies.registerPolicy(p, s, r, abi.encodePacked(rr, ss, v));
    }

    function test_tamperedFieldInvalidatesSignature() public {
        (BastionTypes.Policy memory p, address[] memory s, address[] memory r) = _defaultPolicy();
        (uint8 v, bytes32 rr, bytes32 ss) = vm.sign(borrowerPk, policies.policyDigest(p));
        p.maxTotalRepay = 1_000_000e6; // escalation attempt
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(BastionErrors.Unauthorized.selector, attacker));
        policies.registerPolicy(p, s, r, abi.encodePacked(rr, ss, v));
    }

    function test_cannotProtectSomeoneElsesAccountWithoutDelegation() public {
        (BastionTypes.Policy memory p, address[] memory s, address[] memory r) = _defaultPolicy();
        p.owner = attacker;
        p.nonce = 0;
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(BastionErrors.InvalidParameter.selector, bytes32("ACCOUNT_NOT_DELEGATED"))
        );
        policies.registerPolicy(p, s, r, "");
        vm.prank(borrower);
        policies.setAccountDelegate(attacker, true);
        vm.prank(attacker);
        policies.registerPolicy(p, s, r, "");
    }

    function test_validationRejectsBadParameters() public {
        (BastionTypes.Policy memory q, address[] memory s, address[] memory r) = _defaultPolicy();
        q.triggerHealthFactor = 1e18;
        _expectInvalid(q, s, r, "TRIGGER_HF");
        (q,,) = _defaultPolicy();
        q.targetHealthFactor = q.triggerHealthFactor;
        _expectInvalid(q, s, r, "TARGET_HF");
        (q,,) = _defaultPolicy();
        q.maxRepayPerAction = q.maxTotalRepay + 1;
        _expectInvalid(q, s, r, "REPAY_LIMITS");
        (q,,) = _defaultPolicy();
        q.maxSlippageBps = 1001;
        _expectInvalid(q, s, r, "SLIPPAGE");
        (q,,) = _defaultPolicy();
        q.allowedPaths = 4;
        _expectInvalid(q, s, r, "PATHS");
        (q,,) = _defaultPolicy();
        q.expiry = uint64(block.timestamp);
        _expectInvalid(q, s, r, "EXPIRY");
        (q,,) = _defaultPolicy();
        q.solversHash = bytes32(0);
        _expectInvalid(q, s, r, "SOLVERS");
        (q,,) = _defaultPolicy();
        q.adapter = attacker;
        _expectInvalid(q, s, r, "ADAPTER");
    }

    function _expectInvalid(BastionTypes.Policy memory p, address[] memory s, address[] memory r, bytes32 what)
        internal
    {
        vm.prank(borrower);
        vm.expectRevert(abi.encodeWithSelector(BastionErrors.InvalidParameter.selector, what));
        policies.registerPolicy(p, s, r, "");
    }

    function test_wrongDestinationChainRejected() public {
        (BastionTypes.Policy memory p, address[] memory s, address[] memory r) = _defaultPolicy();
        p.destChainId = 1;
        vm.prank(borrower);
        vm.expectRevert(abi.encodeWithSelector(BastionErrors.WrongChain.selector, BASE_SEPOLIA, 1));
        policies.registerPolicy(p, s, r, "");
    }

    function test_pauseResumeRevokeOwnerOnly() public {
        (bytes32 id,) = _registerDefault();
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(BastionErrors.Unauthorized.selector, attacker));
        policies.pausePolicy(id);
        vm.prank(solver); // solvers can never modify borrower policies
        vm.expectRevert(abi.encodeWithSelector(BastionErrors.Unauthorized.selector, solver));
        policies.revokePolicy(id);
        vm.startPrank(borrower);
        policies.pausePolicy(id);
        (bool ok, bytes32 reason) = policies.checkExecutable(id, 1, BastionTypes.PATH_SOLVER);
        assertFalse(ok);
        assertEq(reason, bytes32("NOT_ACTIVE"));
        policies.resumePolicy(id);
        (ok,) = policies.checkExecutable(id, 1, BastionTypes.PATH_SOLVER);
        assertTrue(ok);
        policies.revokePolicy(id);
        vm.expectRevert();
        policies.resumePolicy(id);
        vm.stopPrank();
    }

    function test_versionReplacementCarriesSpendAndInvalidatesOldVersion() public {
        (bytes32 id, uint64 v1) = _registerDefault();
        vm.prank(gov);
        policies.setExecutor(address(this), true);
        policies.consume(id, v1, BastionTypes.PATH_SOLVER, 4000e6, 10e6);
        (BastionTypes.Policy memory p, address[] memory s, address[] memory r) = _defaultPolicy();
        p.allowedPaths = BastionTypes.PATH_SOLVER;
        (, uint64 v2) = _register(p, s, r);
        assertEq(v2, 2);
        (, BastionTypes.PolicyState memory st) = policies.getPolicy(id);
        assertEq(st.totalRepaid, 4000e6, "spend persists across versions");
        vm.expectRevert(abi.encodeWithSelector(BastionErrors.PolicyVersionMismatch.selector, id, 2, 1));
        policies.consume(id, v1, BastionTypes.PATH_SOLVER, 1e6, 0);
        // Only 6,000 remain of the 10,000 cumulative cap.
        policies.consume(id, v2, BastionTypes.PATH_SOLVER, 6000e6, 0);
        vm.expectRevert(abi.encodeWithSelector(BastionErrors.TotalRepayLimitExceeded.selector, 1, 0));
        policies.consume(id, v2, BastionTypes.PATH_SOLVER, 1, 0);
    }

    function test_consumeEnforcesEveryLimit() public {
        (BastionTypes.Policy memory p, address[] memory s, address[] memory r) = _defaultPolicy();
        p.allowedPaths = BastionTypes.PATH_SOLVER;
        p.cooldown = 600;
        (bytes32 id, uint64 v) = _register(p, s, r);
        vm.expectRevert(abi.encodeWithSelector(BastionErrors.Unauthorized.selector, address(this)));
        policies.consume(id, v, 2, 1, 0);
        vm.prank(gov);
        policies.setExecutor(address(this), true);
        vm.expectRevert(abi.encodeWithSelector(BastionErrors.PathNotAllowed.selector, 1));
        policies.consume(id, v, 1, 1e6, 0);
        vm.expectRevert(abi.encodeWithSelector(BastionErrors.PerActionLimitExceeded.selector, 6000e6 + 1, 6000e6));
        policies.consume(id, v, 2, 6000e6 + 1, 0);
        vm.expectRevert(abi.encodeWithSelector(BastionErrors.FeeRateExceeded.selector, 11e6, 1000e6, 100));
        policies.consume(id, v, 2, 1000e6, 11e6);
        policies.consume(id, v, 2, 1000e6, 10e6);
        vm.expectRevert();
        policies.consume(id, v, 2, 1000e6, 0); // cooldown
        vm.warp(block.timestamp + 601);
        policies.consume(id, v, 2, 1000e6, 0);
        vm.warp(p.expiry);
        vm.expectRevert(abi.encodeWithSelector(BastionErrors.PolicyExpired.selector, id));
        policies.consume(id, v, 2, 1000e6, 0);
    }

    function test_globalPauseBlocksConsumption() public {
        (bytes32 id, uint64 v) = _registerDefault();
        vm.prank(gov);
        policies.setExecutor(address(this), true);
        vm.prank(guardian);
        emergency.pause(BastionTypes.SCOPE_ALL, "incident");
        vm.expectRevert(abi.encodeWithSelector(BastionErrors.ScopePaused.selector, BastionTypes.SCOPE_RESCUE));
        policies.consume(id, v, 2, 1e6, 0);
    }

    function test_adminCannotRaiseUserCaps() public {
        // The registry owner has no function that mutates a policy; only allowlist setters exist.
        (bytes32 id,) = _registerDefault();
        (BastionTypes.Policy memory before_,) = policies.getPolicy(id);
        vm.startPrank(gov);
        policies.setAdapter(address(adapter), false);
        policies.setAdapter(address(adapter), true);
        vm.stopPrank();
        (BastionTypes.Policy memory after_,) = policies.getPolicy(id);
        assertEq(after_.maxTotalRepay, before_.maxTotalRepay);
        assertEq(after_.maxRepayPerAction, before_.maxRepayPerAction);
    }

    function testFuzz_consumeNeverExceedsCaps(uint256[8] memory amounts) public {
        (bytes32 id, uint64 v) = _registerDefault();
        vm.prank(gov);
        policies.setExecutor(address(this), true);
        for (uint256 i; i < amounts.length; ++i) {
            uint256 a = bound(amounts[i], 1, 7000e6);
            try policies.consume(id, v, 2, a, 0) { } catch { }
        }
        (BastionTypes.Policy memory p, BastionTypes.PolicyState memory s) = policies.getPolicy(id);
        assertLe(s.totalRepaid, p.maxTotalRepay);
        assertLe(s.totalFees, p.maxTotalFees);
    }
}
