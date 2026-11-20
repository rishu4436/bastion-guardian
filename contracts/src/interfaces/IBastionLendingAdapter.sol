// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { BastionTypes } from "../libraries/BastionTypes.sol";

/// @title IBastionLendingAdapter
/// @notice Protocol-agnostic lending interface. New markets integrate by implementing this interface; core contracts
///         (registry, executors, router) never reference a specific protocol.
interface IBastionLendingAdapter {
    /// @notice Stable identifier of the integrated protocol deployment, e.g. keccak256("AAVE_V3_BASE_SEPOLIA").
    function protocolId() external view returns (bytes32);

    /// @notice The lending market this adapter instance is bound to.
    function market() external view returns (address);

    function getPosition(address account, address collateralAsset, address debtAsset)
        external
        view
        returns (BastionTypes.Position memory);

    function getHealthFactor(address account) external view returns (uint256);
    function getDebt(address account, address debtAsset) external view returns (uint256);
    function getCollateral(address account, address collateralAsset) external view returns (uint256);

    /// @return liquidationThresholdBps Liquidation threshold for `asset`.
    /// @return liquidationBonusBps Liquidation bonus (e.g. 10500 == 5% bonus).
    function getLiquidationParameters(address asset)
        external
        view
        returns (uint256 liquidationThresholdBps, uint256 liquidationBonusBps);

    /// @notice Debt-asset amount that must be repaid with external funds to reach `targetHf` (rounded up, capped at debt).
    function estimateRepayment(address account, address debtAsset, uint256 targetHf) external view returns (uint256);

    /// @notice Debt-asset amount to repay via collateral-funded deleveraging to reach `targetHf`.
    /// @param costFactorBps 10_000 + flash premium bps + slippage buffer bps.
    function estimateDeleverage(
        address account,
        address collateralAsset,
        address debtAsset,
        uint256 targetHf,
        uint256 costFactorBps
    ) external view returns (uint256);

    /// @notice Read-only pre-flight validation. Returns (true, 0) if a rescue is structurally possible.
    function validateRescue(address account, address collateralAsset, address debtAsset)
        external
        view
        returns (bool ok, bytes32 reason);

    /// @notice Repays `amount` of `debtAsset` on behalf of `account`, pulling tokens from msg.sender.
    ///         Unused tokens are returned to msg.sender. Open to any caller: it can only spend the caller's tokens.
    /// @return repaid Actual amount applied to the debt.
    function repayOnBehalf(address debtAsset, uint256 amount, address account) external returns (uint256 repaid);

    // -------- Optional collateral management (only where the account explicitly authorized it) --------

    /// @notice Whether `account` has granted this adapter enough collateral authorization for `amount`.
    function collateralAuthorization(address account, address collateralAsset) external view returns (uint256);

    /// @notice Withdraws `amount` of the underlying collateral owned by `account` to `to`.
    /// @dev MUST be restricted to authorized executors and MUST rely on an explicit, protocol-native authorization
    ///      from `account` (e.g. aToken allowance). Never bypasses ownership.
    function withdrawCollateralFor(address account, address collateralAsset, uint256 amount, address to)
        external
        returns (uint256 withdrawn);

    /// @notice Flash-loan facility for the debt asset (zero if unavailable).
    function flashLender() external view returns (address);
    function flashPremiumBps() external view returns (uint256);
}
