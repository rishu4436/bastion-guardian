// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { FixtureOracle } from "./FixtureOracle.sol";
import { IFlashLoanSimpleReceiver } from "../interfaces/IAaveV3.sol";
import { HealthFactorMath } from "../libraries/HealthFactorMath.sol";

/// @title FixtureCollateralToken — BASTION TEST FIXTURE
/// @notice Transferable 1:1 collateral receipt (aToken analogue). Transfers are health-factor checked by the market.
contract FixtureCollateralToken is ERC20 {
    FixtureLendingMarket public immutable MARKET;
    address public immutable UNDERLYING;
    uint8 private immutable _decimals;

    constructor(string memory n, string memory s, uint8 d, address underlying_) ERC20(n, s) {
        MARKET = FixtureLendingMarket(msg.sender);
        UNDERLYING = underlying_;
        _decimals = d;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == address(MARKET), "ONLY_MARKET");
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        require(msg.sender == address(MARKET), "ONLY_MARKET");
        _burn(from, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        // User-to-user transfers must keep the sender healthy (Aave validates HF on aToken transfer).
        if (from != address(0) && to != address(0)) MARKET.validateCollateralTransfer(from);
    }
}

/// @title FixtureDebtToken — BASTION TEST FIXTURE
/// @notice Non-transferable view of a user's fixture debt (variableDebtToken analogue).
contract FixtureDebtToken {
    FixtureLendingMarket public immutable MARKET;
    address public immutable UNDERLYING;

    constructor(address underlying_) {
        MARKET = FixtureLendingMarket(msg.sender);
        UNDERLYING = underlying_;
    }

    function balanceOf(address user) external view returns (uint256) {
        return MARKET.debtOf(user, UNDERLYING);
    }

    function totalSupply() external view returns (uint256) {
        return MARKET.totalDebt(UNDERLYING);
    }
}

/// @title FixtureLendingMarket — BASTION TEST FIXTURE, NOT AAVE
/// @notice A deliberately small, fully functional over-collateralized lending market that implements the subset of
///         the Aave V3 Pool interface BASTION uses (getUserAccountData, supply, borrow, repay, withdraw,
///         flashLoanSimple, getConfiguration, getReserveAToken, getReserveVariableDebtToken,
///         FLASHLOAN_PREMIUM_TOTAL) with the same units and health-factor formula. It exists so controlled liquidation
///         scenarios can be reproduced deterministically. It accrues no interest. It is NOT an official Aave deployment.
contract FixtureLendingMarket is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    string public constant FIXTURE_LABEL = "BASTION TEST FIXTURE LENDING MARKET - NOT AAVE";

    struct Reserve {
        bool listed;
        uint16 ltvBps;
        uint16 liquidationThresholdBps;
        uint16 liquidationBonusBps; // e.g. 10500
        uint8 decimals;
        FixtureCollateralToken aToken;
        FixtureDebtToken debtToken;
    }

    FixtureOracle public immutable ORACLE;
    uint128 public FLASHLOAN_PREMIUM_TOTAL = 5; // bps, same default as Aave V3 Base Sepolia (verified 2026-11-20)

    address[] public reservesList;
    mapping(address => Reserve) public reserves;
    mapping(address => mapping(address => uint256)) public debtOf; // user => asset => amount
    mapping(address => uint256) public totalDebt; // asset => total

    event Supply(address indexed asset, address indexed onBehalfOf, uint256 amount);
    event Withdraw(address indexed asset, address indexed user, address indexed to, uint256 amount);
    event Borrow(address indexed asset, address indexed user, uint256 amount);
    event Repay(address indexed asset, address indexed user, address indexed repayer, uint256 amount);
    event FlashLoan(address indexed receiver, address indexed asset, uint256 amount, uint256 premium);
    event LiquidationCall(
        address indexed collateralAsset,
        address indexed debtAsset,
        address indexed user,
        uint256 debtToCover,
        uint256 liquidatedCollateral,
        address liquidator
    );

    constructor(FixtureOracle oracle_, address owner_) Ownable(owner_) {
        ORACLE = oracle_;
    }

    function listReserve(address asset, uint16 ltvBps, uint16 ltBps, uint16 bonusBps) external onlyOwner {
        require(!reserves[asset].listed, "LISTED");
        require(ltvBps <= ltBps && ltBps < 10_000 && bonusBps >= 10_000, "CONFIG");
        uint8 d = IERC20Metadata(asset).decimals();
        FixtureCollateralToken a = new FixtureCollateralToken(
            string.concat("Fixture a", IERC20Metadata(asset).symbol()),
            string.concat("fa", IERC20Metadata(asset).symbol()),
            d,
            asset
        );
        reserves[asset] = Reserve(true, ltvBps, ltBps, bonusBps, d, a, new FixtureDebtToken(asset));
        reservesList.push(asset);
    }

    function setFlashPremium(uint128 bps) external onlyOwner {
        require(bps <= 100, "PREMIUM");
        FLASHLOAN_PREMIUM_TOTAL = bps;
    }

    // ------------------------------------------------------------------ Aave-compatible surface

    function supply(address asset, uint256 amount, address onBehalfOf, uint16) external nonReentrant {
        Reserve storage r = _reserve(asset);
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        r.aToken.mint(onBehalfOf, amount);
        emit Supply(asset, onBehalfOf, amount);
    }

    function withdraw(address asset, uint256 amount, address to) external nonReentrant returns (uint256) {
        Reserve storage r = _reserve(asset);
        uint256 bal = r.aToken.balanceOf(msg.sender);
        if (amount == type(uint256).max) amount = bal;
        require(amount <= bal, "BALANCE");
        r.aToken.burn(msg.sender, amount);
        require(_healthFactor(msg.sender) >= 1e18, "HF_BELOW_ONE");
        IERC20(asset).safeTransfer(to, amount);
        emit Withdraw(asset, msg.sender, to, amount);
        return amount;
    }

    function borrow(address asset, uint256 amount, uint256 rateMode, uint16, address onBehalfOf) external nonReentrant {
        require(rateMode == 2, "VARIABLE_ONLY");
        require(onBehalfOf == msg.sender, "NO_CREDIT_DELEGATION");
        _reserve(asset);
        debtOf[msg.sender][asset] += amount;
        totalDebt[asset] += amount;
        (uint256 coll, uint256 debt,,, uint256 ltv,) = getUserAccountData(msg.sender);
        require(debt * 10_000 <= coll * ltv, "LTV");
        IERC20(asset).safeTransfer(msg.sender, amount);
        emit Borrow(asset, msg.sender, amount);
    }

    function repay(address asset, uint256 amount, uint256 rateMode, address onBehalfOf)
        external
        nonReentrant
        returns (uint256)
    {
        require(rateMode == 2, "VARIABLE_ONLY");
        uint256 owed = debtOf[onBehalfOf][asset];
        uint256 pay = amount < owed ? amount : owed;
        require(pay > 0, "NO_DEBT");
        IERC20(asset).safeTransferFrom(msg.sender, address(this), pay);
        debtOf[onBehalfOf][asset] = owed - pay;
        totalDebt[asset] -= pay;
        emit Repay(asset, onBehalfOf, msg.sender, pay);
        return pay;
    }

    /// @dev Like Aave, not reentrancy-locked: receivers may repay/withdraw inside the callback. Solvency is
    ///      enforced by pulling principal + premium and checking the pool balance afterwards.
    function flashLoanSimple(address receiver, address asset, uint256 amount, bytes calldata params, uint16) external {
        _reserve(asset);
        uint256 premium = Math.mulDiv(amount, FLASHLOAN_PREMIUM_TOTAL, 10_000, Math.Rounding.Ceil);
        uint256 balBefore = IERC20(asset).balanceOf(address(this));
        IERC20(asset).safeTransfer(receiver, amount);
        require(
            IFlashLoanSimpleReceiver(receiver).executeOperation(asset, amount, premium, msg.sender, params),
            "FLASH_CALLBACK"
        );
        IERC20(asset).safeTransferFrom(receiver, address(this), amount + premium);
        require(IERC20(asset).balanceOf(address(this)) >= balBefore + premium, "FLASH_UNPAID");
        emit FlashLoan(receiver, asset, amount, premium);
    }

    /// @notice Simplified Aave-style liquidation (close factor 50%) so endangered fixture positions have real stakes.
    function liquidationCall(address collateralAsset, address debtAsset, address user, uint256 debtToCover)
        external
        nonReentrant
    {
        require(_healthFactor(user) < 1e18, "HEALTHY");
        Reserve storage c = _reserve(collateralAsset);
        Reserve storage d = _reserve(debtAsset);
        uint256 maxCover = debtOf[user][debtAsset] / 2;
        if (debtToCover > maxCover) debtToCover = maxCover;
        uint256 debtValue = HealthFactorMath.tokenToBase(debtToCover, ORACLE.getAssetPrice(debtAsset), d.decimals);
        uint256 seize = HealthFactorMath.baseToTokenUp(
            debtValue * c.liquidationBonusBps / 10_000, ORACLE.getAssetPrice(collateralAsset), c.decimals
        );
        uint256 available = c.aToken.balanceOf(user);
        if (seize > available) seize = available;
        IERC20(debtAsset).safeTransferFrom(msg.sender, address(this), debtToCover);
        debtOf[user][debtAsset] -= debtToCover;
        totalDebt[debtAsset] -= debtToCover;
        c.aToken.burn(user, seize);
        IERC20(collateralAsset).safeTransfer(msg.sender, seize);
        emit LiquidationCall(collateralAsset, debtAsset, user, debtToCover, seize, msg.sender);
    }

    function getUserAccountData(address user)
        public
        view
        returns (
            uint256 totalCollateralBase,
            uint256 totalDebtBase,
            uint256 availableBorrowsBase,
            uint256 currentLiquidationThreshold,
            uint256 ltv,
            uint256 healthFactor
        )
    {
        uint256 weightedLt;
        uint256 weightedLtv;
        for (uint256 i; i < reservesList.length; ++i) {
            address asset = reservesList[i];
            Reserve storage r = reserves[asset];
            uint256 price = ORACLE.getAssetPrice(asset);
            uint256 cBal = r.aToken.balanceOf(user);
            if (cBal > 0) {
                uint256 v = HealthFactorMath.tokenToBase(cBal, price, r.decimals);
                totalCollateralBase += v;
                weightedLt += v * r.liquidationThresholdBps;
                weightedLtv += v * r.ltvBps;
            }
            uint256 dBal = debtOf[user][asset];
            if (dBal > 0) totalDebtBase += Math.mulDiv(dBal, price, 10 ** r.decimals, Math.Rounding.Ceil);
        }
        if (totalCollateralBase > 0) {
            currentLiquidationThreshold = weightedLt / totalCollateralBase;
            ltv = weightedLtv / totalCollateralBase;
        }
        uint256 maxBorrow = totalCollateralBase * ltv / 10_000;
        availableBorrowsBase = maxBorrow > totalDebtBase ? maxBorrow - totalDebtBase : 0;
        healthFactor = HealthFactorMath.healthFactor(totalCollateralBase, totalDebtBase, currentLiquidationThreshold);
    }

    /// @dev Aave ReserveConfigurationMap layout: ltv bits 0-15, LT 16-31, bonus 32-47, decimals 48-55,
    ///      active bit 56, flash-loan-enabled bit 63.
    function getConfiguration(address asset) external view returns (uint256 data) {
        Reserve storage r = reserves[asset];
        if (!r.listed) return 0;
        data = uint256(r.ltvBps) | (uint256(r.liquidationThresholdBps) << 16) | (uint256(r.liquidationBonusBps) << 32)
            | (uint256(r.decimals) << 48) | (uint256(1) << 56) | (uint256(1) << 63);
    }

    function getReserveAToken(address asset) external view returns (address) {
        return address(reserves[asset].aToken);
    }

    function getReserveVariableDebtToken(address asset) external view returns (address) {
        return address(reserves[asset].debtToken);
    }

    function validateCollateralTransfer(address from) external view {
        require(msg.sender == address(reserves[FixtureCollateralToken(msg.sender).UNDERLYING()].aToken), "ONLY_ATOKEN");
        require(_healthFactor(from) >= 1e18, "HF_BELOW_ONE");
    }

    function _healthFactor(address user) internal view returns (uint256 hf) {
        (,,,,, hf) = getUserAccountData(user);
    }

    function _reserve(address asset) internal view returns (Reserve storage r) {
        r = reserves[asset];
        require(r.listed, "NOT_LISTED");
    }
}
