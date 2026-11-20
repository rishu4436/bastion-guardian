// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

/// @title BastionErrors
/// @notice Shared custom errors.
library BastionErrors {
    error Unauthorized(address caller);
    error ZeroAddress();
    error InvalidParameter(bytes32 what);
    error ScopePaused(bytes32 scope);
    error PolicyNotActive(bytes32 policyId);
    error PolicyExpired(bytes32 policyId);
    error PolicyVersionMismatch(bytes32 policyId, uint64 expected, uint64 provided);
    error PathNotAllowed(uint8 path);
    error CooldownActive(bytes32 policyId, uint64 readyAt);
    error PerActionLimitExceeded(uint256 requested, uint256 limit);
    error TotalRepayLimitExceeded(uint256 requested, uint256 remaining);
    error FeeLimitExceeded(uint256 requested, uint256 remaining);
    error FeeRateExceeded(uint256 fee, uint256 principal, uint16 maxFeeBps);
    error NotExposed(uint256 healthFactor, uint256 trigger);
    error InsufficientRescue(uint256 achievable, uint256 required);
    error NoEconomicEffect();
    error UnsupportedToken(address token);
    error FeeOnTransferNotSupported(address token, uint256 expected, uint256 received);
    error InsufficientBalance(uint256 requested, uint256 available);
    error AlreadyProcessed(bytes32 id);
    error InvalidStateTransition(uint8 from, uint8 to);
    error CollateralManagementUnavailable();
    error FlashLoanCallbackInvalid();
    error WrongChain(uint256 expected, uint256 actual);
}
