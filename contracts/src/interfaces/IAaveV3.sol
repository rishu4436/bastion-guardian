// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

/// @notice Minimal subset of the Aave V3 Pool interface used by BASTION (verified against Aave V3 Base Sepolia,
///         POOL_REVISION 10, address-book commit 6e0327854db38052b8f5d8962185b96b95c10d3d).
interface IAaveV3Pool {
    function getUserAccountData(address user)
        external
        view
        returns (
            uint256 totalCollateralBase,
            uint256 totalDebtBase,
            uint256 availableBorrowsBase,
            uint256 currentLiquidationThreshold,
            uint256 ltv,
            uint256 healthFactor
        );

    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)
        external;
    function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf)
        external
        returns (uint256);
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;

    /// @dev Returns ReserveConfigurationMap { uint256 data } — ABI-identical to a single uint256.
    function getConfiguration(address asset) external view returns (uint256);
    function getReserveAToken(address asset) external view returns (address);
    function getReserveVariableDebtToken(address asset) external view returns (address);
    function FLASHLOAN_PREMIUM_TOTAL() external view returns (uint128);
}

interface IAaveV3Oracle {
    function getAssetPrice(address asset) external view returns (uint256);
    function BASE_CURRENCY_UNIT() external view returns (uint256);
}

/// @notice Aave V3 flash-loan simple receiver interface.
interface IFlashLoanSimpleReceiver {
    function executeOperation(address asset, uint256 amount, uint256 premium, address initiator, bytes calldata params)
        external
        returns (bool);
}
