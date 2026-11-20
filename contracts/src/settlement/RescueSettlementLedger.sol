// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { Ownable, Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { BastionErrors } from "../libraries/BastionErrors.sol";

/// @title RescueSettlementLedger
/// @notice Destination-chain state machine for every rescue. A rescue ID can be opened exactly once, so a completed
///         destination repayment can never be executed again because a settlement acknowledgement was lost (I10).
///
///   None ─open→ Requested ─authorize→ Authorized ─┬→ DestinationExecuted (flash: terminal success)
///                                                 ├→ SolverCommitted → DestinationExecuted → SettlementPending
///                                                 │      → ReimbursementComplete | ReimbursementDisputed | RecoveryRequired
///                                                 └→ ExecutionFailed
///   Requested/Authorized ─→ Expired | Cancelled
///   RecoveryRequired ─→ SettlementPending (retry) | ReimbursementComplete
contract RescueSettlementLedger is Ownable2Step {
    enum State {
        None,
        Requested,
        Authorized,
        SolverCommitted,
        DestinationExecuted,
        ExecutionFailed,
        SettlementPending,
        ReimbursementComplete,
        ReimbursementDisputed,
        RecoveryRequired,
        Expired,
        Cancelled
    }

    struct Record {
        State state;
        bytes32 policyId;
        uint64 policyVersion;
        bytes32 originEventId;
        uint8 path;
        address solver;
        address payout;
        uint256 principal;
        uint256 fee;
        uint64 openedAt;
        uint64 updatedAt;
        bytes32 settlementRef;
        bytes32 failureReason;
    }

    mapping(address => bool) public isWriter;
    mapping(bytes32 => Record) private _records;
    uint256 public pendingSettlements;

    event WriterSet(address indexed writer, bool enabled);
    event RescueStateChanged(bytes32 indexed rescueId, bytes32 indexed policyId, State from, State to, bytes32 detail);
    event SolverClaimRecorded(
        bytes32 indexed rescueId, address indexed solver, address payout, uint256 principal, uint256 fee
    );

    constructor(address owner_) Ownable(owner_) { }

    modifier onlyWriter() {
        if (!isWriter[msg.sender]) revert BastionErrors.Unauthorized(msg.sender);
        _;
    }

    function setWriter(address writer, bool enabled) external onlyOwner {
        isWriter[writer] = enabled;
        emit WriterSet(writer, enabled);
    }

    function open(bytes32 rescueId, bytes32 policyId, uint64 version, bytes32 originEventId) external onlyWriter {
        Record storage r = _records[rescueId];
        if (r.state != State.None) revert BastionErrors.AlreadyProcessed(rescueId);
        r.policyId = policyId;
        r.policyVersion = version;
        r.originEventId = originEventId;
        r.openedAt = uint64(block.timestamp);
        _transition(rescueId, r, State.Requested, 0);
    }

    function authorize(bytes32 rescueId, uint8 path_) external onlyWriter {
        Record storage r = _records[rescueId];
        r.path = path_;
        _transition(rescueId, r, State.Authorized, bytes32(uint256(path_)));
    }

    function recordFlashExecution(bytes32 rescueId, uint256 principal, uint256 fee) external onlyWriter {
        Record storage r = _records[rescueId];
        r.principal = principal;
        r.fee = fee;
        _transition(rescueId, r, State.DestinationExecuted, "FLASH");
    }

    function recordSolverExecution(bytes32 rescueId, address solver, address payout, uint256 principal, uint256 fee)
        external
        onlyWriter
    {
        Record storage r = _records[rescueId];
        _transition(rescueId, r, State.SolverCommitted, 0);
        r.solver = solver;
        r.payout = payout;
        r.principal = principal;
        r.fee = fee;
        _transition(rescueId, r, State.DestinationExecuted, "SOLVER");
        _transition(rescueId, r, State.SettlementPending, 0);
        pendingSettlements += 1;
        emit SolverClaimRecorded(rescueId, solver, payout, principal, fee);
    }

    function recordFailure(bytes32 rescueId, bytes32 reason) external onlyWriter {
        Record storage r = _records[rescueId];
        r.failureReason = reason;
        _transition(rescueId, r, State.ExecutionFailed, reason);
    }

    function recordExpired(bytes32 rescueId, bytes32 reason) external onlyWriter {
        Record storage r = _records[rescueId];
        r.failureReason = reason;
        _transition(rescueId, r, State.Expired, reason);
    }

    /// @notice Idempotent: acknowledging an already-complete settlement is a no-op returning false.
    function recordReimbursed(bytes32 rescueId, bytes32 settlementRef) external onlyWriter returns (bool changed) {
        Record storage r = _records[rescueId];
        if (r.state == State.ReimbursementComplete) return false;
        r.settlementRef = settlementRef;
        _transition(rescueId, r, State.ReimbursementComplete, settlementRef);
        pendingSettlements -= 1;
        return true;
    }

    function recordRecoveryRequired(bytes32 rescueId, bytes32 reason) external onlyWriter {
        Record storage r = _records[rescueId];
        _transition(rescueId, r, State.RecoveryRequired, reason);
    }

    function recordDisputed(bytes32 rescueId, bytes32 reason) external onlyWriter {
        Record storage r = _records[rescueId];
        _transition(rescueId, r, State.ReimbursementDisputed, reason);
    }

    function getRecord(bytes32 rescueId) external view returns (Record memory) {
        return _records[rescueId];
    }

    function stateOf(bytes32 rescueId) external view returns (State) {
        return _records[rescueId].state;
    }

    function exists(bytes32 rescueId) external view returns (bool) {
        return _records[rescueId].state != State.None;
    }

    function isValidTransition(State from, State to) public pure returns (bool) {
        if (from == State.None) return to == State.Requested;
        if (from == State.Requested) {
            return to == State.Authorized || to == State.Expired || to == State.Cancelled || to == State.ExecutionFailed;
        }
        if (from == State.Authorized) {
            return to == State.SolverCommitted || to == State.DestinationExecuted || to == State.ExecutionFailed
                || to == State.Expired || to == State.Cancelled;
        }
        if (from == State.SolverCommitted) return to == State.DestinationExecuted || to == State.ExecutionFailed;
        if (from == State.DestinationExecuted) return to == State.SettlementPending;
        if (from == State.SettlementPending) {
            return
                to == State.ReimbursementComplete || to == State.ReimbursementDisputed || to == State.RecoveryRequired;
        }
        if (from == State.RecoveryRequired) {
            return
                to == State.SettlementPending || to == State.ReimbursementComplete || to == State.ReimbursementDisputed;
        }
        if (from == State.ReimbursementDisputed) {
            return to == State.ReimbursementComplete || to == State.RecoveryRequired;
        }
        return false; // ExecutionFailed, ReimbursementComplete, Expired, Cancelled are terminal
    }

    function _transition(bytes32 rescueId, Record storage r, State to, bytes32 detail) internal {
        State from = r.state;
        if (!isValidTransition(from, to)) revert BastionErrors.InvalidStateTransition(uint8(from), uint8(to));
        r.state = to;
        r.updatedAt = uint64(block.timestamp);
        emit RescueStateChanged(rescueId, r.policyId, from, to, detail);
    }
}
