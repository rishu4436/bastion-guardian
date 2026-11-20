// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { BastionTypes } from "../libraries/BastionTypes.sol";
import { BastionPolicyRegistry } from "../policies/BastionPolicyRegistry.sol";
import { IBastionLendingAdapter } from "../interfaces/IBastionLendingAdapter.sol";

/// @title BastionRiskObserver
/// @notice Event-producing observation contract. Reactive cannot subscribe to a threshold comparison that emits no
///         event, so anyone (keeper, solver, user, or a Reactive CRON self-callback) may call `observe`, which reads
///         the *authoritative* on-chain position through the lending adapter and emits `RiskObserved` only when the
///         policy's intervention threshold is actually crossed. Callers cannot forge the health factor.
contract BastionRiskObserver {
    BastionPolicyRegistry public immutable POLICIES;
    uint64 public immutable MIN_INTERVAL; // per-policy rate limit (seconds) — DoS / cost bound for Reactive

    mapping(bytes32 => uint64) public lastEmittedAt;

    /// @dev opCode 4 log: topics = [sig, policyId, account, version]; data = (healthFactor, trigger, observedAt).
    event RiskObserved(
        bytes32 indexed policyId,
        address indexed account,
        uint64 indexed version,
        uint256 healthFactor,
        uint256 triggerHealthFactor,
        uint64 observedAt
    );

    constructor(BastionPolicyRegistry policies_, uint64 minInterval_) {
        POLICIES = policies_;
        MIN_INTERVAL = minInterval_;
    }

    /// @return emitted True if a RiskObserved event was emitted.
    /// @return healthFactor Current authoritative health factor.
    function observe(bytes32 policyId) external returns (bool emitted, uint256 healthFactor) {
        (BastionTypes.Policy memory p, BastionTypes.PolicyState memory s) = POLICIES.getPolicy(policyId);
        if (s.status != BastionTypes.PolicyStatus.Active || p.expiry <= block.timestamp) return (false, 0);
        healthFactor = IBastionLendingAdapter(p.adapter).getHealthFactor(p.account);
        if (healthFactor >= p.triggerHealthFactor) return (false, healthFactor);
        uint64 last = lastEmittedAt[policyId];
        if (last != 0 && block.timestamp < uint256(last) + MIN_INTERVAL) return (false, healthFactor);
        lastEmittedAt[policyId] = uint64(block.timestamp);
        emit RiskObserved(policyId, p.account, s.version, healthFactor, p.triggerHealthFactor, uint64(block.timestamp));
        return (true, healthFactor);
    }
}
