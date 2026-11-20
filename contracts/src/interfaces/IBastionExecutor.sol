// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { BastionTypes } from "../libraries/BastionTypes.sol";

/// @title IBastionExecutor
/// @notice Common interface implemented by FlashRescueExecutor and SolverRescueExecutor.
interface IBastionExecutor {
    function path() external view returns (uint8);

    /// @notice Cheap read-only feasibility check used by the router for deterministic path selection.
    function isFeasible(bytes32 policyId) external view returns (bool feasible, bytes32 reason);

    /// @notice Executes an authorized rescue. Reverts atomically if any financial constraint fails.
    function execute(BastionTypes.RescueRequest calldata req) external returns (BastionTypes.RescueResult memory);
}
