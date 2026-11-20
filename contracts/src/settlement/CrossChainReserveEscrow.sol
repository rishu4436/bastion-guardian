// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { IPayable } from "@reactive/src/interfaces/IPayable.sol";
import { AbstractCallback } from "@reactive/src/base/AbstractCallback.sol";
import { Ownable, Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { BastionErrors } from "../libraries/BastionErrors.sol";
import { BastionProtectionVault } from "../vaults/BastionProtectionVault.sol";

/// @title CrossChainReserveEscrow
/// @notice Reserve-chain (Unichain Sepolia) callback contract that reimburses solvers from users' pre-funded
///         BastionProtectionVault budgets after Reactive delivers a verified `SolverRescueExecuted` destination event.
/// @dev Trust model (see docs/CROSS-CHAIN-SETTLEMENT.md): settlement relies on authenticated Reactive event delivery
///      (Callback Proxy + injected ReactiveCore sender) and on the ReactiveCore only forwarding logs emitted by the
///      allowlisted SolverRescueExecutor. It is NOT a cryptographic proof of destination-chain finality.
///      State machine per rescueId: None → Reimbursed | RecoveryRequired → Reimbursed. A rescueId can pay out at most
///      once (I3). Failed payouts are stored and can be retried permissionlessly without re-executing anything on
///      the destination chain (I10).
contract CrossChainReserveEscrow is AbstractCallback, Ownable2Step, ReentrancyGuard {
    enum SettlementState {
        None,
        Reimbursed,
        RecoveryRequired,
        Disputed
    }

    struct Claim {
        SettlementState state;
        bytes32 policyId;
        uint256 destChainId;
        address destExecutor;
        address recipient;
        uint256 principal;
        uint256 fee;
        uint64 executedAt;
        bytes32 originEventId;
        uint32 attempts;
        bytes32 lastError;
    }

    BastionProtectionVault public immutable VAULT;
    mapping(uint256 => mapping(address => bool)) public trustedExecutor; // destChainId => SolverRescueExecutor
    mapping(bytes32 => Claim) private _claims;
    uint256 public pendingRecovery;

    event TrustedExecutorSet(uint256 indexed chainId, address indexed executor, bool trusted);
    event ReimbursementCompleted(
        bytes32 indexed rescueId, bytes32 indexed policyId, address indexed recipient, uint256 principal, uint256 fee
    );
    event SettlementFailed(bytes32 indexed rescueId, bytes32 indexed policyId, bytes32 reason, uint32 attempts);
    event DuplicateSettlementIgnored(bytes32 indexed rescueId, SettlementState state);
    event UntrustedSourceRejected(bytes32 indexed rescueId, uint256 chainId, address executor);
    event ClaimDisputed(bytes32 indexed rescueId, bytes32 reason);

    constructor(IPayable callbackProxy_, address reactiveCore_, BastionProtectionVault vault_, address owner_)
        payable
        AbstractCallback(callbackProxy_, reactiveCore_)
        Ownable(owner_)
    {
        VAULT = vault_;
    }

    function setTrustedExecutor(uint256 chainId, address executor, bool trusted) external onlyOwner {
        trustedExecutor[chainId][executor] = trusted;
        emit TrustedExecutorSet(chainId, executor, trusted);
    }

    function coverDebt() external {
        _coverDebt();
    }

    /// @notice Reactive callback: reimburse the solver for a verified destination repayment.
    function settleRescue(
        address rvm,
        bytes32 rescueId,
        bytes32 policyId,
        uint256 destChainId,
        address destExecutor,
        address recipient,
        uint256 principal,
        uint256 fee,
        uint64 executedAt,
        bytes32 originEventId
    ) external nonReentrant onlyServiceProvider onlyCallbackSender(rvm) {
        Claim storage c = _claims[rescueId];
        if (c.state != SettlementState.None) {
            emit DuplicateSettlementIgnored(rescueId, c.state);
            return;
        }
        if (!trustedExecutor[destChainId][destExecutor]) {
            emit UntrustedSourceRejected(rescueId, destChainId, destExecutor);
            return;
        }
        c.policyId = policyId;
        c.destChainId = destChainId;
        c.destExecutor = destExecutor;
        c.recipient = recipient;
        c.principal = principal;
        c.fee = fee;
        c.executedAt = executedAt;
        c.originEventId = originEventId;
        _attempt(rescueId, c);
    }

    /// @notice Permissionless retry of a claim whose payout previously failed (e.g. budget underfunded or paused
    ///         settlement scope). Never re-executes anything on the destination chain.
    function retrySettlement(bytes32 rescueId) external nonReentrant {
        Claim storage c = _claims[rescueId];
        if (c.state != SettlementState.RecoveryRequired) revert BastionErrors.InvalidParameter("NOT_RECOVERABLE");
        _attempt(rescueId, c);
    }

    /// @notice Governance can freeze a suspicious claim (e.g. reorg evidence). Disputed claims cannot pay out.
    function dispute(bytes32 rescueId, bytes32 reason) external onlyOwner {
        Claim storage c = _claims[rescueId];
        if (c.state != SettlementState.RecoveryRequired) revert BastionErrors.InvalidParameter("NOT_DISPUTABLE");
        c.state = SettlementState.Disputed;
        pendingRecovery -= 1;
        emit ClaimDisputed(rescueId, reason);
    }

    function getClaim(bytes32 rescueId) external view returns (Claim memory) {
        return _claims[rescueId];
    }

    /// @dev Checks-effects-interactions: the claim is marked Reimbursed BEFORE the external payout so that a token with
    ///      transfer hooks cannot observe a payable state while the payout is in flight. If the payout reverts, the
    ///      try/catch keeps our pre-write and the catch branch moves the claim to RecoveryRequired.
    function _attempt(bytes32 rescueId, Claim storage c) internal {
        bool wasRecovery = c.state == SettlementState.RecoveryRequired;
        c.attempts += 1;
        c.state = SettlementState.Reimbursed;
        if (wasRecovery) pendingRecovery -= 1;
        try VAULT.settle(c.policyId, c.recipient, c.principal, c.fee, c.executedAt) {
            c.lastError = 0;
            emit ReimbursementCompleted(rescueId, c.policyId, c.recipient, c.principal, c.fee);
        } catch (bytes memory err) {
            bytes32 reason = err.length >= 4 ? bytes32(bytes4(err)) : bytes32("REVERT");
            c.lastError = reason;
            c.state = SettlementState.RecoveryRequired;
            pendingRecovery += 1;
            emit SettlementFailed(rescueId, c.policyId, reason, c.attempts);
        }
    }
}
