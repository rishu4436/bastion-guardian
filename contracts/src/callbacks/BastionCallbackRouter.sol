// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { IPayable } from "@reactive/src/interfaces/IPayable.sol";
import { AbstractCallback } from "@reactive/src/base/AbstractCallback.sol";
import { Ownable, Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { BastionTypes } from "../libraries/BastionTypes.sol";
import { BastionErrors } from "../libraries/BastionErrors.sol";
import { IBastionExecutor } from "../interfaces/IBastionExecutor.sol";
import { BastionPolicyRegistry } from "../policies/BastionPolicyRegistry.sol";
import { RescueSettlementLedger } from "../settlement/RescueSettlementLedger.sol";
import { RescueReceiptRegistry } from "../settlement/RescueReceiptRegistry.sol";
import { BastionEmergencyControl } from "../governance/BastionEmergencyControl.sol";

/// @title BastionCallbackRouter
/// @notice Destination-chain entry point for Reactive callbacks (Base Sepolia). Authenticates every callback with
///         BOTH `onlyServiceProvider` (msg.sender is the official Callback Proxy) and
///         `onlyCallbackSender(rvm)` (the proxy-injected first argument is our BastionReactiveCore), deduplicates
///         origin events, rejects stale signals, deterministically chooses a rescue path and records every outcome.
/// @dev A failing executor never reverts the callback: the failure is recorded in the ledger so Guardian Mode can
///      surface it, and the proxy still charges for the attempt (documented Reactive behaviour).
contract BastionCallbackRouter is AbstractCallback, Ownable2Step {
    uint256 public immutable DEST_CHAIN_ID;
    BastionPolicyRegistry public immutable POLICIES;
    RescueSettlementLedger public immutable LEDGER;
    RescueReceiptRegistry public immutable RECEIPTS;
    BastionEmergencyControl public immutable EMERGENCY;

    IBastionExecutor public flashExecutor;
    IBastionExecutor public solverExecutor;
    uint64 public maxSignalAge = 120; // seconds between observation and execution
    uint256 public executorGasReserve = 60_000; // gas kept back so failures can always be recorded

    mapping(bytes32 => bool) public processedEvents;
    mapping(bytes32 => bool) public processedAcks;

    event ExecutorsSet(address flash, address solver);
    event SignalAgeSet(uint64 maxSignalAge);
    event CallbackReceived(bytes32 indexed originEventId, bytes32 indexed policyId, address indexed rvm, uint8 kind);
    event DuplicateIgnored(bytes32 indexed id, uint8 kind);
    event SignalRejected(bytes32 indexed originEventId, bytes32 indexed policyId, bytes32 reason);
    event RescueAttempted(bytes32 indexed rescueId, bytes32 indexed policyId, uint8 path, bool success, bytes32 reason);
    event SettlementAcknowledged(bytes32 indexed rescueId, bytes32 settlementEventId, bool changed);

    constructor(
        IPayable callbackProxy_,
        address reactiveCore_,
        BastionPolicyRegistry policies_,
        RescueSettlementLedger ledger_,
        RescueReceiptRegistry receipts_,
        BastionEmergencyControl emergency_,
        address owner_
    ) payable AbstractCallback(callbackProxy_, reactiveCore_) Ownable(owner_) {
        DEST_CHAIN_ID = block.chainid;
        POLICIES = policies_;
        LEDGER = ledger_;
        RECEIPTS = receipts_;
        EMERGENCY = emergency_;
    }

    function setExecutors(IBastionExecutor flash, IBastionExecutor solver) external onlyOwner {
        flashExecutor = flash;
        solverExecutor = solver;
        emit ExecutorsSet(address(flash), address(solver));
    }

    function setMaxSignalAge(uint64 age) external onlyOwner {
        if (age == 0 || age > 1 hours) revert BastionErrors.InvalidParameter("AGE");
        maxSignalAge = age;
        emit SignalAgeSet(age);
    }

    /// @notice Settles outstanding Callback Proxy debt from this contract's balance (permissionless top-up path).
    function coverDebt() external {
        _coverDebt();
    }

    // ------------------------------------------------------------------ Reactive callbacks

    /// @notice Risk-signal callback requested by BastionReactiveCore on Reactive Lasna.
    /// @param rvm Injected by the Callback Proxy: address of the requesting reactive contract.
    function onRiskSignal(
        address rvm,
        bytes32 originEventId,
        uint256 originChainId,
        bytes32 policyId,
        uint64 policyVersion,
        uint256 observedHealthFactor,
        uint64 observedAt
    ) external onlyServiceProvider onlyCallbackSender(rvm) {
        if (block.chainid != DEST_CHAIN_ID) {
            revert BastionErrors.WrongChain(DEST_CHAIN_ID, block.chainid);
        }
        emit CallbackReceived(originEventId, policyId, rvm, 1);
        _handleSignal(originEventId, originChainId, policyId, policyVersion, observedHealthFactor, observedAt);
    }

    /// @notice Second-cycle acknowledgement: the reserve chain reimbursed the solver for `rescueId`.
    function onSettlementAck(address rvm, bytes32 rescueId, bytes32 settlementEventId)
        external
        onlyServiceProvider
        onlyCallbackSender(rvm)
    {
        emit CallbackReceived(settlementEventId, rescueId, rvm, 2);
        if (processedAcks[settlementEventId]) {
            emit DuplicateIgnored(settlementEventId, 2);
            return;
        }
        processedAcks[settlementEventId] = true;
        if (LEDGER.stateOf(rescueId) == RescueSettlementLedger.State.None) {
            emit SignalRejected(settlementEventId, rescueId, "UNKNOWN_RESCUE");
            return;
        }
        bool changed;
        try LEDGER.recordReimbursed(rescueId, settlementEventId) returns (bool c) {
            changed = c;
        } catch {
            emit SignalRejected(settlementEventId, rescueId, "INVALID_ACK_STATE");
            return;
        }
        if (changed) RECEIPTS.attachSettlement(rescueId, settlementEventId);
        emit SettlementAcknowledged(rescueId, settlementEventId, changed);
    }

    // ------------------------------------------------------------------ owner self-service (no Reactive needed)

    /// @notice The policy owner may trigger their own authorized rescue directly (Emergency Action Center).
    ///         The same destination-side limits apply; the frontend is never authoritative.
    function requestManualRescue(bytes32 policyId) external returns (bytes32 rescueId) {
        (BastionTypes.Policy memory p, BastionTypes.PolicyState memory s) = POLICIES.getPolicy(policyId);
        if (msg.sender != p.owner) revert BastionErrors.Unauthorized(msg.sender);
        bytes32 eventId = keccak256(abi.encode("MANUAL", block.chainid, policyId, s.version, block.timestamp));
        return _handleSignal(eventId, block.chainid, policyId, s.version, 0, uint64(block.timestamp));
    }

    // ------------------------------------------------------------------ internal

    function _handleSignal(
        bytes32 originEventId,
        uint256 originChainId,
        bytes32 policyId,
        uint64 policyVersion,
        uint256 observedHf,
        uint64 observedAt
    ) internal returns (bytes32 rescueId) {
        originChainId;
        observedHf;
        if (processedEvents[originEventId]) {
            emit DuplicateIgnored(originEventId, 1);
            return bytes32(0);
        }
        processedEvents[originEventId] = true;
        rescueId = BastionTypes.rescueIdOf(originEventId, policyId, policyVersion);
        if (LEDGER.exists(rescueId)) {
            emit DuplicateIgnored(rescueId, 1);
            return rescueId;
        }
        LEDGER.open(rescueId, policyId, policyVersion, originEventId);

        if (EMERGENCY.isPaused(BastionTypes.SCOPE_RESCUE)) {
            LEDGER.recordExpired(rescueId, "GLOBAL_PAUSE");
            emit SignalRejected(originEventId, policyId, "GLOBAL_PAUSE");
            return rescueId;
        }
        if (observedAt > block.timestamp + 30 || block.timestamp > uint256(observedAt) + maxSignalAge) {
            LEDGER.recordExpired(rescueId, "STALE_SIGNAL");
            emit SignalRejected(originEventId, policyId, "STALE_SIGNAL");
            return rescueId;
        }
        (bool ok, bytes32 reason) = POLICIES.checkExecutable(policyId, policyVersion, 0);
        if (!ok) {
            LEDGER.recordExpired(rescueId, reason);
            emit SignalRejected(originEventId, policyId, reason);
            return rescueId;
        }

        BastionTypes.RescueRequest memory req =
            BastionTypes.RescueRequest(rescueId, policyId, policyVersion, originEventId, observedAt);
        (IBastionExecutor first, IBastionExecutor second) = _choosePaths(policyId);
        if (address(first) == address(0)) {
            LEDGER.recordFailure(rescueId, "NO_FEASIBLE_PATH");
            emit RescueAttempted(rescueId, policyId, 0, false, "NO_FEASIBLE_PATH");
            return rescueId;
        }
        LEDGER.authorize(rescueId, first.path());
        if (_try(first, req)) return rescueId;
        if (address(second) != address(0) && _try(second, req)) return rescueId;
        LEDGER.recordFailure(rescueId, "ALL_PATHS_FAILED");
    }

    /// @dev Deterministic path order: FlashNet first when feasible (self-funded, no cross-chain settlement risk),
    ///      Solver second. Only paths the policy allows and whose feasibility probe passes are returned.
    function _choosePaths(bytes32 policyId) internal view returns (IBastionExecutor first, IBastionExecutor second) {
        bool flashOk = _feasible(flashExecutor, policyId);
        bool solverOk = _feasible(solverExecutor, policyId);
        if (flashOk) {
            first = flashExecutor;
            if (solverOk) second = solverExecutor;
        } else if (solverOk) {
            first = solverExecutor;
        }
    }

    function _feasible(IBastionExecutor ex, bytes32 policyId) internal view returns (bool) {
        if (address(ex) == address(0)) return false;
        try ex.isFeasible(policyId) returns (bool ok, bytes32) {
            return ok;
        } catch {
            return false;
        }
    }

    function _try(IBastionExecutor ex, BastionTypes.RescueRequest memory req) internal returns (bool) {
        uint256 g = gasleft();
        uint256 forward = g > executorGasReserve ? g - executorGasReserve : 0;
        try ex.execute{ gas: forward }(req) returns (BastionTypes.RescueResult memory) {
            emit RescueAttempted(req.rescueId, req.policyId, ex.path(), true, 0);
            return true;
        } catch (bytes memory err) {
            bytes32 reason = err.length >= 4 ? bytes32(bytes4(err)) : bytes32("REVERT");
            emit RescueAttempted(req.rescueId, req.policyId, ex.path(), false, reason);
            return false;
        }
    }
}
