// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable, Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IBastionLendingAdapter } from "../interfaces/IBastionLendingAdapter.sol";
import { IAaveV3Pool, IAaveV3Oracle } from "../interfaces/IAaveV3.sol";
import { BastionTypes } from "../libraries/BastionTypes.sol";
import { BastionErrors } from "../libraries/BastionErrors.sol";
import { HealthFactorMath } from "../libraries/HealthFactorMath.sol";

/// @title AaveV3LendingAdapter
/// @notice Lending adapter for any market exposing the Aave V3 Pool interface subset in `IAaveV3Pool`.
///         Deployed once per market. The production instance targets the official Aave V3 Base Sepolia Pool
///         (0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27, see docs/integrations/VERIFIED-ADDRESSES.md). A *separate*
///         instance with protocolId "BASTION_FIXTURE_MARKET" targets the clearly-labeled FixtureLendingMarket.
/// @dev Collateral management uses the protocol-native authorization only: the borrower must approve this adapter on
///      their aToken. Without that allowance `withdrawCollateralFor` reverts and FlashNet is reported unavailable.
contract AaveV3LendingAdapter is IBastionLendingAdapter, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant VARIABLE_RATE = 2;
    /// @dev Aave computes HF with per-asset ray/percent rounding that our closed-form estimate cannot reproduce
    ///      bit-exactly (fork test on Base Sepolia undershot the target by ~1e-10). Estimates therefore aim for
    ///      target * (1 + 1 ppm). Over-repayment is bounded by ~1 ppm of the remaining debt.
    uint256 public constant TARGET_BUFFER_PPM = 1;

    IAaveV3Pool public immutable POOL;
    IAaveV3Oracle public immutable ORACLE;
    bytes32 private immutable _PROTOCOL_ID;

    mapping(address => bool) public isCollateralOperator;
    /// @dev R-02: optional per-account, per-asset cumulative cap on collateral pulls, set by the account itself.
    ///      When `pullCapEnabled[account]` is true every pull must fit in (and decrements) the remaining allowance,
    ///      independently of how large the aToken approval is. Accounts that never opt in rely on their bounded
    ///      aToken approval alone (the UI recommends bounded approvals and opting in).
    mapping(address => bool) public pullCapEnabled;
    mapping(address => mapping(address => uint256)) public collateralPullAllowance; // account => asset => remaining

    event CollateralOperatorSet(address indexed operator, bool enabled);
    event RepaidOnBehalf(address indexed payer, address indexed account, address indexed asset, uint256 repaid);
    event CollateralPullCapSet(address indexed account, address indexed asset, uint256 allowance, bool enabled);
    event CollateralWithdrawnFor(
        address indexed operator, address indexed account, address indexed asset, uint256 amount, address to
    );

    constructor(IAaveV3Pool pool_, IAaveV3Oracle oracle_, bytes32 protocolId_, address owner_) Ownable(owner_) {
        if (address(pool_) == address(0) || address(oracle_) == address(0)) revert BastionErrors.ZeroAddress();
        POOL = pool_;
        ORACLE = oracle_;
        _PROTOCOL_ID = protocolId_;
    }

    function setCollateralOperator(address operator, bool enabled) external onlyOwner {
        if (operator == address(0)) revert BastionErrors.ZeroAddress();
        isCollateralOperator[operator] = enabled;
        emit CollateralOperatorSet(operator, enabled);
    }

    // ------------------------------------------------------------------ views

    function protocolId() external view returns (bytes32) {
        return _PROTOCOL_ID;
    }

    function market() external view returns (address) {
        return address(POOL);
    }

    function getPosition(address account, address collateralAsset, address debtAsset)
        public
        view
        returns (BastionTypes.Position memory pos)
    {
        (pos.totalCollateralBase, pos.totalDebtBase,, pos.currentLiquidationThreshold,, pos.healthFactor) =
            POOL.getUserAccountData(account);
        pos.debtAmount = getDebt(account, debtAsset);
        pos.collateralAmount = getCollateral(account, collateralAsset);
        pos.debtPrice = ORACLE.getAssetPrice(debtAsset);
        pos.collateralPrice = ORACLE.getAssetPrice(collateralAsset);
        uint256 dCfg = POOL.getConfiguration(debtAsset);
        uint256 cCfg = POOL.getConfiguration(collateralAsset);
        pos.debtDecimals = uint8((dCfg >> 48) & 0xff);
        pos.collateralDecimals = uint8((cCfg >> 48) & 0xff);
        pos.collateralLiquidationThreshold = (cCfg >> 16) & 0xffff;
    }

    function getHealthFactor(address account) external view returns (uint256 hf) {
        (,,,,, hf) = POOL.getUserAccountData(account);
    }

    function getDebt(address account, address debtAsset) public view returns (uint256) {
        address vToken = POOL.getReserveVariableDebtToken(debtAsset);
        if (vToken == address(0)) return 0;
        return IERC20(vToken).balanceOf(account);
    }

    function getCollateral(address account, address collateralAsset) public view returns (uint256) {
        address aToken = POOL.getReserveAToken(collateralAsset);
        if (aToken == address(0)) return 0;
        return IERC20(aToken).balanceOf(account);
    }

    function getLiquidationParameters(address asset) external view returns (uint256 ltBps, uint256 bonusBps) {
        uint256 cfg = POOL.getConfiguration(asset);
        ltBps = (cfg >> 16) & 0xffff;
        bonusBps = (cfg >> 32) & 0xffff;
    }

    function estimateRepayment(address account, address debtAsset, uint256 targetHf) external view returns (uint256) {
        (uint256 tc, uint256 td,, uint256 lt,,) = POOL.getUserAccountData(account);
        uint256 xBase = HealthFactorMath.repayBaseForTarget(tc, td, lt, _buffered(targetHf));
        if (xBase == 0) return 0;
        uint8 dec = uint8((POOL.getConfiguration(debtAsset) >> 48) & 0xff);
        uint256 amount = HealthFactorMath.baseToTokenUp(xBase, ORACLE.getAssetPrice(debtAsset), dec);
        uint256 debt = getDebt(account, debtAsset);
        return amount > debt ? debt : amount;
    }

    function estimateDeleverage(
        address account,
        address collateralAsset,
        address debtAsset,
        uint256 targetHf,
        uint256 costFactorBps
    ) external view returns (uint256) {
        BastionTypes.Position memory p = getPosition(account, collateralAsset, debtAsset);
        uint256 xBase = HealthFactorMath.deleverageBaseForTarget(
            p.totalCollateralBase,
            p.totalDebtBase,
            p.currentLiquidationThreshold,
            p.collateralLiquidationThreshold,
            costFactorBps,
            _buffered(targetHf)
        );
        if (xBase == type(uint256).max) return type(uint256).max; // target unreachable via deleveraging
        if (xBase == 0) return 0;
        uint256 amount = HealthFactorMath.baseToTokenUp(xBase, p.debtPrice, p.debtDecimals);
        return amount > p.debtAmount ? p.debtAmount : amount;
    }

    function validateRescue(address account, address collateralAsset, address debtAsset)
        external
        view
        returns (bool ok, bytes32 reason)
    {
        uint256 dCfg = POOL.getConfiguration(debtAsset);
        uint256 cCfg = POOL.getConfiguration(collateralAsset);
        if (dCfg == 0 || cCfg == 0) return (false, "RESERVE_NOT_LISTED");
        if ((dCfg >> 56) & 1 == 0 || (cCfg >> 56) & 1 == 0) return (false, "RESERVE_INACTIVE");
        if ((dCfg >> 60) & 1 == 1 || (cCfg >> 60) & 1 == 1) return (false, "RESERVE_PAUSED");
        if (getDebt(account, debtAsset) == 0) return (false, "NO_DEBT");
        return (true, 0);
    }

    function collateralAuthorization(address account, address collateralAsset) external view returns (uint256) {
        address aToken = POOL.getReserveAToken(collateralAsset);
        if (aToken == address(0)) return 0;
        uint256 allowance = IERC20(aToken).allowance(account, address(this));
        uint256 bal = IERC20(aToken).balanceOf(account);
        uint256 usable = allowance < bal ? allowance : bal;
        if (pullCapEnabled[account]) {
            uint256 cap = collateralPullAllowance[account][collateralAsset];
            if (cap < usable) usable = cap;
        }
        return usable;
    }

    function flashLender() external view returns (address) {
        return address(POOL);
    }

    function flashPremiumBps() external view returns (uint256) {
        return POOL.FLASHLOAN_PREMIUM_TOTAL();
    }

    function _buffered(uint256 targetHf) internal pure returns (uint256) {
        return targetHf + targetHf * TARGET_BUFFER_PPM / 1e6;
    }

    // ------------------------------------------------------------------ mutations

    /// @inheritdoc IBastionLendingAdapter
    function repayOnBehalf(address debtAsset, uint256 amount, address account)
        external
        nonReentrant
        returns (uint256 repaid)
    {
        if (amount == 0) revert BastionErrors.NoEconomicEffect();
        IERC20 token = IERC20(debtAsset);
        uint256 balBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - balBefore;
        if (received != amount) revert BastionErrors.FeeOnTransferNotSupported(debtAsset, amount, received);
        token.forceApprove(address(POOL), amount);
        repaid = POOL.repay(debtAsset, amount, VARIABLE_RATE, account);
        token.forceApprove(address(POOL), 0);
        if (repaid < amount) token.safeTransfer(msg.sender, amount - repaid);
        emit RepaidOnBehalf(msg.sender, account, debtAsset, repaid);
    }

    /// @notice Account-controlled cap on cumulative collateral pulls by operators (R-02). Setting `enabled = false`
    ///         removes the extra cap; the aToken approval remains the protocol-native authorization in both cases.
    function setCollateralPullCap(address asset, uint256 allowance, bool enabled) external {
        pullCapEnabled[msg.sender] = enabled;
        collateralPullAllowance[msg.sender][asset] = allowance;
        emit CollateralPullCapSet(msg.sender, asset, allowance, enabled);
    }

    /// @inheritdoc IBastionLendingAdapter
    function withdrawCollateralFor(address account, address collateralAsset, uint256 amount, address to)
        external
        nonReentrant
        returns (uint256 withdrawn)
    {
        if (!isCollateralOperator[msg.sender]) revert BastionErrors.Unauthorized(msg.sender);
        if (pullCapEnabled[account]) {
            uint256 remaining = collateralPullAllowance[account][collateralAsset];
            if (amount > remaining) revert BastionErrors.InsufficientBalance(amount, remaining);
            collateralPullAllowance[account][collateralAsset] = remaining - amount;
        }
        address aToken = POOL.getReserveAToken(collateralAsset);
        if (aToken == address(0)) revert BastionErrors.CollateralManagementUnavailable();
        // Protocol-native authorization: fails unless `account` approved this adapter on its aToken.
        IERC20(aToken).safeTransferFrom(account, address(this), amount);
        withdrawn = POOL.withdraw(collateralAsset, amount, to);
        emit CollateralWithdrawnFor(msg.sender, account, collateralAsset, withdrawn, to);
    }
}
