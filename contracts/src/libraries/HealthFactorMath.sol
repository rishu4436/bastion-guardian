// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title HealthFactorMath
/// @notice Aave-compatible health-factor arithmetic. Mirrored exactly by `packages/risk-engine` (TypeScript).
/// @dev Aave V3: HF = (sum(collateral_i * price_i * LT_i) / 1e4) * 1e18 / totalDebtBase.
///      `weightedCollateralBase` = totalCollateralBase * currentLiquidationThreshold / 1e4.
library HealthFactorMath {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS = 10_000;

    /// @notice Health factor from base-currency totals. Returns type(uint256).max when there is no debt (Aave semantics).
    function healthFactor(uint256 totalCollateralBase, uint256 totalDebtBase, uint256 liquidationThresholdBps)
        internal
        pure
        returns (uint256)
    {
        if (totalDebtBase == 0) return type(uint256).max;
        return Math.mulDiv(totalCollateralBase * liquidationThresholdBps, WAD, totalDebtBase * BPS);
    }

    /// @notice Debt (in base currency) that must be repaid with external funds so HF reaches `targetHf`.
    /// @dev Solves target = W / (D - x)  =>  x = D - W * 1e18 / target. Rounds up (conservative).
    function repayBaseForTarget(uint256 totalCollateralBase, uint256 totalDebtBase, uint256 ltBps, uint256 targetHf)
        internal
        pure
        returns (uint256)
    {
        if (targetHf == 0) return totalDebtBase;
        uint256 weighted = Math.mulDiv(totalCollateralBase, ltBps, BPS);
        uint256 maxDebtAtTarget = Math.mulDiv(weighted, WAD, targetHf); // rounds down => repay rounds up
        if (totalDebtBase <= maxDebtAtTarget) return 0;
        return totalDebtBase - maxDebtAtTarget;
    }

    /// @notice Debt (base) to repay when the repayment is funded by withdrawing collateral (flash deleverage).
    /// @dev Withdrawing collateral worth x * costFactor (costFactor = 1 + premium + slippage, in bps) reduces weighted
    ///      collateral by x * costFactor * LTc. Solve target = (W - x*k*LTc) / (D - x)
    ///      => x = (target*D - W) / (target - k*LTc). Returns type(uint256).max if the target is unreachable
    ///      (target <= k*LTc means deleveraging cannot raise HF to the target).
    function deleverageBaseForTarget(
        uint256 totalCollateralBase,
        uint256 totalDebtBase,
        uint256 ltBps,
        uint256 collateralLtBps,
        uint256 costFactorBps,
        uint256 targetHf
    ) internal pure returns (uint256) {
        uint256 weighted = Math.mulDiv(totalCollateralBase, ltBps, BPS); // W (base)
        uint256 targetTimesDebt = Math.mulDiv(targetHf, totalDebtBase, WAD); // target*D (base)
        if (targetTimesDebt <= weighted) return 0;
        // k * LTc expressed in WAD: costFactorBps * collateralLtBps / 1e8 * 1e18
        uint256 kLt = Math.mulDiv(costFactorBps * collateralLtBps, WAD, BPS * BPS);
        if (targetHf <= kLt) return type(uint256).max;
        return Math.mulDiv(targetTimesDebt - weighted, WAD, targetHf - kLt, Math.Rounding.Ceil);
    }

    /// @notice Convert a base-currency value to token units, rounding up.
    function baseToTokenUp(uint256 baseValue, uint256 price, uint8 decimals) internal pure returns (uint256) {
        if (price == 0) return type(uint256).max;
        return Math.mulDiv(baseValue, 10 ** decimals, price, Math.Rounding.Ceil);
    }

    /// @notice Convert token units to base-currency value, rounding down.
    function tokenToBase(uint256 amount, uint256 price, uint8 decimals) internal pure returns (uint256) {
        return Math.mulDiv(amount, price, 10 ** decimals);
    }
}
