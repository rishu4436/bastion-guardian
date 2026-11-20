// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { Vm } from "forge-std/Test.sol";
import { IReactive } from "@reactive/src/interfaces/IReactive.sol";
import { ISystemContract } from "@reactive/src/interfaces/ISystemContract.sol";
import { AbstractCallback } from "@reactive/src/base/AbstractCallback.sol";
import { AbstractPayer } from "@reactive/src/base/AbstractPayer.sol";
import { BastionTestBase } from "../BastionTestBase.sol";
import { BastionTypes } from "../../src/libraries/BastionTypes.sol";
import { BastionRiskObserver } from "../../src/oracles/BastionRiskObserver.sol";
import { SolverRescueExecutor } from "../../src/rescue/SolverRescueExecutor.sol";
import { CrossChainReserveEscrow } from "../../src/settlement/CrossChainReserveEscrow.sol";
import { RescueSettlementLedger } from "../../src/settlement/RescueSettlementLedger.sol";
import { RescueReceiptRegistry } from "../../src/settlement/RescueReceiptRegistry.sol";
import { BastionCallbackRouter } from "../../src/callbacks/BastionCallbackRouter.sol";

/// @notice LOCAL SIMULATION of the complete BASTION Solver Rescue loop:
///   market crash (fixture oracle) → BastionRiskObserver.RiskObserved (Base) → BastionReactiveCore.react (Lasna)
///   → requestCallbackV_1_0 → Callback Proxy → BastionCallbackRouter.onRiskSignal → SolverRescueExecutor repays
///   real fixture-market debt → SolverRescueExecuted (Base) → react → CrossChainReserveEscrow.settleRescue (Unichain)
///   → vault reimburses solver → ReimbursementCompleted → react → router.onSettlementAck (Base) → ledger complete.
contract EndToEndSolverRescueTest is BastionTestBase {
    bytes32 internal policyId;
    uint64 internal version;

    function setUp() public override {
        super.setUp();
        _openBorrowerPosition(13_000e6);
        (policyId, version) = _registerDefault();
        _onboardSolver(solver, solverPayout, 50_000e6);
        _commit(solver, policyId, 8000e6, 50);
        _fundReserve(policyId, 10_000e6, 200e6);
        vm.prank(gov);
        core.setPolicyMirror(policyId, true, version, 0);
    }

    function _observeAndReact()
        internal
        returns (IReactive.LogRecord memory rec, ISystemContract.CallbackConfiguration_V_1_0 memory cfg)
    {
        vm.recordLogs();
        (bool emitted,) = observer.observe(policyId);
        assertTrue(emitted, "risk observed");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        (Vm.Log memory l, bool found) = _findLog(logs, address(observer), BastionRiskObserver.RiskObserved.selector);
        assertTrue(found);
        rec = _toLogRecord(l, BASE_SEPOLIA);
        bool requested;
        (requested, cfg) = _react(rec);
        assertTrue(requested, "callback requested");
        assertEq(cfg.chainId, BASE_SEPOLIA);
        assertEq(cfg.recipient, address(router));
    }

    function test_fullTwoCycleLoop() public {
        uint256 debtBefore = adapter.getDebt(borrower, address(usdc));
        _crash(1800e8); // HF 18000*0.85/13000 ≈ 1.177 < 1.25 trigger
        uint256 hfBefore = _hf();
        assertLt(hfBefore, 1.25e18);

        (IReactive.LogRecord memory rec, ISystemContract.CallbackConfiguration_V_1_0 memory cfg) = _observeAndReact();

        // Cycle 1 destination callback.
        vm.recordLogs();
        assertTrue(_deliver(baseProxy, cfg), "router callback ok");
        Vm.Log[] memory logs = vm.getRecordedLogs();

        uint256 debtAfter = adapter.getDebt(borrower, address(usdc));
        uint256 hfAfter = _hf();
        assertLt(debtAfter, debtBefore, "debt decreased");
        assertGe(hfAfter, 1.5e18, "target HF reached");

        bytes32 rescueId = BastionTypes.rescueIdOf(core.eventIdOf(rec), policyId, version);
        RescueSettlementLedger.Record memory lr = ledger.getRecord(rescueId);
        assertEq(uint8(lr.state), uint8(RescueSettlementLedger.State.SettlementPending));
        assertEq(lr.principal, debtBefore - debtAfter, "claim == actual debt reduction");
        assertEq(lr.solver, solver);

        RescueReceiptRegistry.Receipt memory receipt = receipts.getReceipt(rescueId);
        assertEq(receipt.debtBefore, debtBefore);
        assertEq(receipt.debtAfter, debtAfter);
        assertEq(receipt.healthFactorBefore, hfBefore);
        assertEq(receipt.healthFactorAfter, hfAfter);

        // Cycle 2: SolverRescueExecuted → Reactive → escrow on reserve chain.
        (Vm.Log memory exLog, bool found) =
            _findLog(logs, address(solverExec), SolverRescueExecutor.SolverRescueExecuted.selector);
        assertTrue(found, "SolverRescueExecuted emitted");
        (bool req2, ISystemContract.CallbackConfiguration_V_1_0 memory cfg2) = _react(_toLogRecord(exLog, BASE_SEPOLIA));
        assertTrue(req2);
        assertEq(cfg2.chainId, UNICHAIN_SEPOLIA);
        assertEq(cfg2.recipient, address(escrow));

        uint256 payoutBefore = reserveUsdc.balanceOf(solverPayout);
        vm.recordLogs();
        assertTrue(_deliver(uniProxy, cfg2), "escrow callback ok");
        Vm.Log[] memory logs2 = vm.getRecordedLogs();
        uint256 expectedFee = lr.fee;
        assertEq(reserveUsdc.balanceOf(solverPayout) - payoutBefore, lr.principal + expectedFee, "solver reimbursed");
        CrossChainReserveEscrow.Claim memory claim = escrow.getClaim(rescueId);
        assertEq(uint8(claim.state), uint8(CrossChainReserveEscrow.SettlementState.Reimbursed));

        // Cycle 3: ReimbursementCompleted → Reactive → router ack on destination.
        (Vm.Log memory rcLog, bool f3) =
            _findLog(logs2, address(escrow), CrossChainReserveEscrow.ReimbursementCompleted.selector);
        assertTrue(f3);
        (bool req3, ISystemContract.CallbackConfiguration_V_1_0 memory cfg3) =
            _react(_toLogRecord(rcLog, UNICHAIN_SEPOLIA));
        assertTrue(req3);
        assertTrue(_deliver(baseProxy, cfg3));
        assertEq(uint8(ledger.stateOf(rescueId)), uint8(RescueSettlementLedger.State.ReimbursementComplete));
        assertTrue(receipts.getReceipt(rescueId).settlementRef != bytes32(0));
        assertEq(ledger.pendingSettlements(), 0);
    }

    function test_replayedCallbackDoesNotRepayTwice() public {
        _crash(1800e8);
        (, ISystemContract.CallbackConfiguration_V_1_0 memory cfg) = _observeAndReact();
        assertTrue(_deliver(baseProxy, cfg));
        uint256 debtAfterFirst = adapter.getDebt(borrower, address(usdc));
        (, uint256 repaidBefore) = _spent();
        // Unauthorized replay of the exact same authenticated payload.
        vm.expectEmit(false, false, false, false, address(router));
        emit BastionCallbackRouter.DuplicateIgnored(bytes32(0), 1);
        assertTrue(_deliver(baseProxy, cfg));
        assertEq(adapter.getDebt(borrower, address(usdc)), debtAfterFirst, "no second repayment");
        (, uint256 repaidAfter) = _spent();
        assertEq(repaidAfter, repaidBefore);
    }

    function test_duplicateOriginLogIgnoredByReactiveCore() public {
        _crash(1800e8);
        (IReactive.LogRecord memory rec,) = _observeAndReact();
        (bool requested,) = _react(rec);
        assertFalse(requested, "duplicate origin log must not request a second callback");
    }

    function test_duplicateSettlementCallbackPaysOnce() public {
        _crash(1800e8);
        (, ISystemContract.CallbackConfiguration_V_1_0 memory cfg) = _observeAndReact();
        vm.recordLogs();
        _deliver(baseProxy, cfg);
        (Vm.Log memory exLog,) =
            _findLog(vm.getRecordedLogs(), address(solverExec), SolverRescueExecutor.SolverRescueExecuted.selector);
        (, ISystemContract.CallbackConfiguration_V_1_0 memory cfg2) = _react(_toLogRecord(exLog, BASE_SEPOLIA));
        _deliver(uniProxy, cfg2);
        uint256 paid = reserveUsdc.balanceOf(solverPayout);
        _deliver(uniProxy, cfg2); // replay at the proxy level
        assertEq(reserveUsdc.balanceOf(solverPayout), paid, "no second payout");
    }

    function test_directCallToRouterRejected() public {
        _crash(1800e8);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(AbstractPayer.NotAuthorized.selector, attacker, address(baseProxy)));
        router.onRiskSignal(address(core), bytes32("x"), BASE_SEPOLIA, policyId, version, 1e18, uint64(block.timestamp));
    }

    function test_callbackFromForeignReactiveContractRejected() public {
        _crash(1800e8);
        bytes memory payload = abi.encodeWithSignature(
            "onRiskSignal(address,bytes32,uint256,bytes32,uint64,uint256,uint64)",
            address(0),
            bytes32("evil"),
            BASE_SEPOLIA,
            policyId,
            version,
            1e18,
            uint64(block.timestamp)
        );
        uint256 debtBefore = adapter.getDebt(borrower, address(usdc));
        (bool ok, bytes memory ret) = baseProxy.deliver(address(router), payload, attacker, 2_000_000);
        assertFalse(ok);
        assertEq(bytes4(ret), AbstractCallback.CallbackNotAuthorized.selector);
        assertEq(adapter.getDebt(borrower, address(usdc)), debtBefore, "invalid callback moved no funds");
    }

    function test_forgedSettlementToEscrowRejected() public {
        bytes memory payload = abi.encodeWithSignature(
            "settleRescue(address,bytes32,bytes32,address,uint256,address,address,uint256,uint256,uint64,bytes32)",
            address(0),
            bytes32("r"),
            policyId,
            borrower,
            BASE_SEPOLIA,
            address(solverExec),
            attacker,
            1000e6,
            0,
            uint64(block.timestamp),
            bytes32("e")
        );
        (bool ok,) = uniProxy.deliver(address(escrow), payload, attacker, 1_000_000);
        assertFalse(ok);
        assertEq(reserveUsdc.balanceOf(attacker), 0);
        vm.prank(attacker);
        vm.expectRevert();
        escrow.settleRescue(
            address(core), bytes32("r"), policyId, borrower, BASE_SEPOLIA, address(solverExec), attacker, 1, 0, 0, 0
        );
    }

    function test_untrustedDestinationExecutorRejectedByEscrow() public {
        bytes memory payload = abi.encodeWithSignature(
            "settleRescue(address,bytes32,bytes32,address,uint256,address,address,uint256,uint256,uint64,bytes32)",
            address(0),
            bytes32("r"),
            policyId,
            borrower,
            BASE_SEPOLIA,
            attacker,
            attacker,
            1000e6,
            0,
            uint64(block.timestamp),
            bytes32("e")
        );
        (bool ok,) = uniProxy.deliver(address(escrow), payload, address(core), 1_000_000);
        assertTrue(ok);
        assertEq(reserveUsdc.balanceOf(attacker), 0, "untrusted emitter cannot be reimbursed");
        assertEq(uint8(escrow.getClaim(bytes32("r")).state), 0);
    }

    function test_staleSignalExpiresWithoutExecution() public {
        _crash(1800e8);
        (, ISystemContract.CallbackConfiguration_V_1_0 memory cfg) = _observeAndReact();
        vm.warp(block.timestamp + 1 hours);
        uint256 debtBefore = adapter.getDebt(borrower, address(usdc));
        _deliver(baseProxy, cfg);
        assertEq(adapter.getDebt(borrower, address(usdc)), debtBefore);
    }

    function test_pausedPolicyCannotRescue() public {
        _crash(1800e8);
        (, ISystemContract.CallbackConfiguration_V_1_0 memory cfg) = _observeAndReact();
        vm.prank(borrower);
        policies.pausePolicy(policyId);
        uint256 debtBefore = adapter.getDebt(borrower, address(usdc));
        _deliver(baseProxy, cfg);
        assertEq(adapter.getDebt(borrower, address(usdc)), debtBefore, "paused policy must not execute");
    }

    function test_settlementFailureIsRecoverableWithoutDestinationReplay() public {
        _crash(1800e8);
        // Underfund: user releases budget after delay → reserve empty when claim arrives.
        vm.prank(borrower);
        vault.requestRelease(policyId);
        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(borrower);
        vault.release(policyId, 10_000e6, 200e6);

        (, ISystemContract.CallbackConfiguration_V_1_0 memory cfg) = _observeAndReact();
        vm.recordLogs();
        _deliver(baseProxy, cfg);
        (Vm.Log memory exLog,) =
            _findLog(vm.getRecordedLogs(), address(solverExec), SolverRescueExecutor.SolverRescueExecuted.selector);
        uint256 debtAfterRescue = adapter.getDebt(borrower, address(usdc));
        (, ISystemContract.CallbackConfiguration_V_1_0 memory cfg2) = _react(_toLogRecord(exLog, BASE_SEPOLIA));
        assertTrue(_deliver(uniProxy, cfg2));
        bytes32 rescueId = bytes32(exLog.topics[1]);
        assertEq(
            uint8(escrow.getClaim(rescueId).state), uint8(CrossChainReserveEscrow.SettlementState.RecoveryRequired)
        );
        assertEq(escrow.pendingRecovery(), 1);

        // Partial completion: destination repayment stands, reimbursement pending. Re-fund and retry.
        _fundReserve(policyId, 10_000e6, 200e6);
        escrow.retrySettlement(rescueId);
        assertEq(uint8(escrow.getClaim(rescueId).state), uint8(CrossChainReserveEscrow.SettlementState.Reimbursed));
        assertEq(escrow.pendingRecovery(), 0);
        assertEq(adapter.getDebt(borrower, address(usdc)), debtAfterRescue, "destination repayment never replayed");
        vm.expectRevert();
        escrow.retrySettlement(rescueId);
    }

    function test_manualRescueByOwner() public {
        _crash(1800e8);
        uint256 debtBefore = adapter.getDebt(borrower, address(usdc));
        vm.prank(borrower);
        router.requestManualRescue(policyId);
        assertLt(adapter.getDebt(borrower, address(usdc)), debtBefore);
        vm.prank(attacker);
        vm.expectRevert();
        router.requestManualRescue(policyId);
    }

    function test_healthyPositionNotRescued() public {
        // HF ≈ 1.3077 > 1.25: observer emits nothing, executor would refuse.
        (bool emitted,) = observer.observe(policyId);
        assertFalse(emitted);
        uint256 debtBefore = adapter.getDebt(borrower, address(usdc));
        vm.prank(borrower);
        router.requestManualRescue(policyId);
        assertEq(adapter.getDebt(borrower, address(usdc)), debtBefore);
    }

    function _spent() internal view returns (uint256 fees, uint256 repaid) {
        (, BastionTypes.PolicyState memory s) = policies.getPolicy(policyId);
        return (s.totalFees, s.totalRepaid);
    }
}
