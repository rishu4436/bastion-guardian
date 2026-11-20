// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { Ownable, Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { BastionTypes } from "../libraries/BastionTypes.sol";
import { BastionErrors } from "../libraries/BastionErrors.sol";

/// @title BastionEmergencyControl
/// @notice Protocol-wide emergency pause with asymmetric powers:
///         - Guardians (and the owner) can pause a scope instantly.
///         - Resuming requires the owner (intended to be a TimelockController / multisig) AND `resumeQuorum`
///           distinct guardian approvals recorded for the current pause epoch.
///         Pausing never grants custody: paused scopes only block *new* rescue/settlement actions. Owner
///         withdrawals of unencumbered funds are never gated by this contract.
contract BastionEmergencyControl is Ownable2Step {
    mapping(address => bool) public isGuardian;
    mapping(bytes32 => bool) private _paused;
    mapping(bytes32 => uint64) public pauseEpoch;
    mapping(bytes32 => mapping(uint64 => mapping(address => bool))) public resumeApproved;
    mapping(bytes32 => mapping(uint64 => uint256)) public resumeApprovals;
    uint256 public resumeQuorum;

    event GuardianSet(address indexed guardian, bool enabled);
    event ResumeQuorumSet(uint256 quorum);
    event ScopePaused(bytes32 indexed scope, address indexed by, uint64 epoch, bytes32 reason);
    event ResumeApproved(bytes32 indexed scope, address indexed guardian, uint64 epoch);
    event ScopeResumed(bytes32 indexed scope, address indexed by, uint64 epoch);

    constructor(address owner_, uint256 resumeQuorum_) Ownable(owner_) {
        resumeQuorum = resumeQuorum_;
    }

    function setGuardian(address guardian, bool enabled) external onlyOwner {
        if (guardian == address(0)) revert BastionErrors.ZeroAddress();
        isGuardian[guardian] = enabled;
        emit GuardianSet(guardian, enabled);
    }

    function setResumeQuorum(uint256 quorum) external onlyOwner {
        resumeQuorum = quorum;
        emit ResumeQuorumSet(quorum);
    }

    function pause(bytes32 scope, bytes32 reason) external {
        if (!isGuardian[msg.sender] && msg.sender != owner()) revert BastionErrors.Unauthorized(msg.sender);
        if (_paused[scope]) return;
        _paused[scope] = true;
        uint64 epoch = ++pauseEpoch[scope];
        emit ScopePaused(scope, msg.sender, epoch, reason);
    }

    function approveResume(bytes32 scope) external {
        if (!isGuardian[msg.sender]) revert BastionErrors.Unauthorized(msg.sender);
        uint64 epoch = pauseEpoch[scope];
        if (!_paused[scope] || resumeApproved[scope][epoch][msg.sender]) return;
        resumeApproved[scope][epoch][msg.sender] = true;
        resumeApprovals[scope][epoch] += 1;
        emit ResumeApproved(scope, msg.sender, epoch);
    }

    function resume(bytes32 scope) external onlyOwner {
        uint64 epoch = pauseEpoch[scope];
        if (!_paused[scope]) return;
        if (resumeApprovals[scope][epoch] < resumeQuorum) {
            revert BastionErrors.InvalidParameter("RESUME_QUORUM");
        }
        _paused[scope] = false;
        emit ScopeResumed(scope, msg.sender, epoch);
    }

    /// @notice True if `scope` or the global scope is paused.
    function isPaused(bytes32 scope) public view returns (bool) {
        return _paused[scope] || _paused[BastionTypes.SCOPE_ALL];
    }

    function requireNotPaused(bytes32 scope) external view {
        if (isPaused(scope)) revert BastionErrors.ScopePaused(scope);
    }
}
