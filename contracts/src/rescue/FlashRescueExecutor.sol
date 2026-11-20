// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { BastionExecutorBase } from "./BastionExecutorBase.sol";
import { IBastionExecutor } from "../interfaces/IBastionExecutor.sol";
import { IBastionLendingAdapter } from "../interfaces/IBastionLendingAdapter.sol";
import { IAaveV3Pool, IFlashLoanSimpleReceiver } from "../interfaces/IAaveV3.sol";
import { ISwapVenue } from "../interfaces/ISwapVenue.sol";
import { BastionTypes } from "../libraries/BastionTypes.sol";
import { BastionErrors } from "../libraries/BastionErrors.sol";
import { HealthFactorMath } from "../libraries/HealthFactorMath.sol";
import { BastionPolicyRegistry } from "../policies/BastionPolicyRegistry.sol";
import { RescueSettlementLedger } from "../settlement/RescueSettlementLedger.sol";
import { RescueReceiptRegistry } from "../settlement/RescueReceiptRegistry.sol";

/// @title FlashRescueExecutor
/// @notice FlashNet Rescue: atomic self-funded deleveraging.
///         flash-borrow debt token → repay borrower debt → withdraw authorized collateral → swap only the collateral
///         needed on an allowlisted venue → repay flash principal + premium → verify final loan state.
///         Any unmet constraint reverts the entire transaction (I7: the executor can never end owing a flash loan).
/// @dev Requires a protocol-native collateral authorization from the borrower to the adapter (Aave: aToken
///      allowance). Without it, `isFeasible` reports COLLATERAL_NOT_AUTHORIZED and nothing is attempted.
contract FlashRescueExecutor is BastionExecutorBase, IBastionExecutor, IFlashLoanSimpleReceiver {
    using SafeERC20 for IERC20;

    struct FlashContext {
        bytes32 rescueId;
        address adapter;
        address account;
        address collateralAsset;
        address debtAsset;
        address venue;
        uint16 maxSlippageBps;
        uint256 collateralPrice;
        uint256 debtPrice;
        uint8 collateralDecimals;
        uint8 debtDecimals;
    }

    mapping(address => bool) public isVenue;
    address public defaultVenue;
    bytes32 private _activeContext; // hash of the in-flight FlashContext; zero when idle

    event VenueSet(address indexed venue, bool enabled, bool isDefault);
    event FlashRescueExecuted(
        bytes32 indexed rescueId,
        bytes32 indexed policyId,
        address indexed account,
        uint256 repaid,
        uint256 premium,
        uint256 collateralSold,
        uint256 surplusReturned
    );

    constructor(
        BastionPolicyRegistry policies_,
        RescueSettlementLedger ledger_,
        RescueReceiptRegistry receipts_,
        address owner_
    ) BastionExecutorBase(policies_, ledger_, receipts_, owner_) { }

    function setVenue(address venue, bool enabled, bool makeDefault) external onlyOwner {
        if (venue == address(0)) revert BastionErrors.ZeroAddress();
        isVenue[venue] = enabled;
        if (makeDefault && enabled) defaultVenue = venue;
        if (!enabled && defaultVenue == venue) defaultVenue = address(0);
        emit VenueSet(venue, enabled, makeDefault);
    }

    function path() external pure returns (uint8) {
        return BastionTypes.PATH_FLASH;
    }

    function costFactorBps(IBastionLendingAdapter adapter, uint16 maxSlippageBps) public view returns (uint256) {
        // Collateral withdrawn = (principal * (1 + premium)) * (1 + slippage buffer): multiplicative, rounded up,
        // plus 1 bp to absorb integer rounding in price conversions so the post-rescue HF does not undershoot.
        return Math.mulDiv(
            BastionTypes.BPS + adapter.flashPremiumBps(),
            BastionTypes.BPS + maxSlippageBps,
            BastionTypes.BPS,
            Math.Rounding.Ceil
        ) + 1;
    }

    function isFeasible(bytes32 policyId) external view returns (bool, bytes32) {
        (BastionTypes.Policy memory p, BastionTypes.PolicyState memory s) = POLICIES.getPolicy(policyId);
        (bool ok, bytes32 reason) = POLICIES.checkExecutable(policyId, s.version, BastionTypes.PATH_FLASH);
        if (!ok) return (false, reason);
        if (defaultVenue == address(0)) return (false, "NO_SWAP_VENUE");
        IBastionLendingAdapter adapter = IBastionLendingAdapter(p.adapter);
        if (adapter.flashLender() == address(0)) return (false, "NO_FLASH_LENDER");
        uint256 x = adapter.estimateDeleverage(
            p.account, p.collateralAsset, p.debtAsset, p.targetHealthFactor, costFactorBps(adapter, p.maxSlippageBps)
        );
        if (x == type(uint256).max && !p.allowPartial) return (false, "TARGET_UNREACHABLE");
        if (x == 0) return (false, "NOTHING_TO_REPAY");
        BastionTypes.Position memory pos = adapter.getPosition(p.account, p.collateralAsset, p.debtAsset);
        uint256 repay = _min(_min(x, POLICIES.remainingRepay(policyId)), pos.debtAmount);
        if (repay < x && !p.allowPartial) return (false, "BUDGET_BELOW_REQUIRED");
        uint256 collNeeded = _collateralFor(repay, adapter.flashPremiumBps(), p.maxSlippageBps, pos);
        if (adapter.collateralAuthorization(p.account, p.collateralAsset) < collNeeded) {
            return (false, "COLLATERAL_NOT_AUTHORIZED");
        }
        return (true, 0);
    }

    function execute(BastionTypes.RescueRequest calldata req)
        external
        onlyRouter
        nonReentrant
        returns (BastionTypes.RescueResult memory r)
    {
        (BastionTypes.Policy memory p, IBastionLendingAdapter adapter, BastionTypes.Position memory pos) =
            _load(req.policyId, req.policyVersion);
        if (defaultVenue == address(0)) revert BastionErrors.InvalidParameter("NO_SWAP_VENUE");
        address lender = adapter.flashLender();
        if (lender == address(0)) revert BastionErrors.CollateralManagementUnavailable();
        r.path = BastionTypes.PATH_FLASH;
        r.debtBefore = pos.debtAmount;
        r.healthFactorBefore = pos.healthFactor;

        uint256 x = adapter.estimateDeleverage(
            p.account, p.collateralAsset, p.debtAsset, p.targetHealthFactor, costFactorBps(adapter, p.maxSlippageBps)
        );
        uint256 cap = _min(POLICIES.remainingRepay(req.policyId), pos.debtAmount);
        uint256 repay = x > cap ? cap : x;
        if (repay == 0) revert BastionErrors.NoEconomicEffect();
        if (repay < x && !p.allowPartial) revert BastionErrors.InsufficientRescue(repay, x);

        FlashContext memory ctx = FlashContext({
            rescueId: req.rescueId,
            adapter: address(adapter),
            account: p.account,
            collateralAsset: p.collateralAsset,
            debtAsset: p.debtAsset,
            venue: defaultVenue,
            maxSlippageBps: p.maxSlippageBps,
            collateralPrice: pos.collateralPrice,
            debtPrice: pos.debtPrice,
            collateralDecimals: pos.collateralDecimals,
            debtDecimals: pos.debtDecimals
        });
        bytes memory params = abi.encode(ctx);
        _activeContext = keccak256(params);
        uint256 premiumBefore = IERC20(p.debtAsset).balanceOf(address(this));
        IAaveV3Pool(lender).flashLoanSimple(address(this), p.debtAsset, repay, params, 0);
        if (_activeContext != bytes32(0)) revert BastionErrors.FlashLoanCallbackInvalid();
        // Executor must hold no residual debt token beyond what it held before (no stuck user funds).
        if (IERC20(p.debtAsset).balanceOf(address(this)) > premiumBefore) {
            revert BastionErrors.FlashLoanCallbackInvalid();
        }

        BastionTypes.Position memory after_ = adapter.getPosition(p.account, p.collateralAsset, p.debtAsset);
        if (after_.debtAmount >= pos.debtAmount) revert BastionErrors.NoEconomicEffect();
        if (after_.healthFactor <= pos.healthFactor) revert BastionErrors.NoEconomicEffect();

        r.repaid = pos.debtAmount - after_.debtAmount;
        r.fee = _lastPremium;
        r.debtAfter = after_.debtAmount;
        r.healthFactorAfter = after_.healthFactor;
        _lastPremium = 0;

        POLICIES.consume(req.policyId, req.policyVersion, BastionTypes.PATH_FLASH, r.repaid, r.fee);
        LEDGER.recordFlashExecution(req.rescueId, r.repaid, r.fee);
        _receipt(req, p, adapter, r, p.destChainId);
        emit FlashRescueExecuted(req.rescueId, req.policyId, p.account, r.repaid, r.fee, _lastSold, _lastSurplus);
        _lastSold = 0;
        _lastSurplus = 0;
    }

    uint256 private _lastPremium;
    uint256 private _lastSold;
    uint256 private _lastSurplus;

    /// @inheritdoc IFlashLoanSimpleReceiver
    function executeOperation(address asset, uint256 amount, uint256 premium, address initiator, bytes calldata params)
        external
        returns (bool)
    {
        if (_activeContext == bytes32(0) || keccak256(params) != _activeContext || initiator != address(this)) {
            revert BastionErrors.FlashLoanCallbackInvalid();
        }
        FlashContext memory ctx = abi.decode(params, (FlashContext));
        IBastionLendingAdapter adapter = IBastionLendingAdapter(ctx.adapter);
        if (msg.sender != adapter.flashLender() || asset != ctx.debtAsset) {
            revert BastionErrors.FlashLoanCallbackInvalid();
        }
        _activeContext = bytes32(0);

        IERC20 debt = IERC20(ctx.debtAsset);
        // 1. Repay the borrower's debt with flash liquidity.
        debt.forceApprove(address(adapter), amount);
        uint256 repaid = adapter.repayOnBehalf(ctx.debtAsset, amount, ctx.account);
        debt.forceApprove(address(adapter), 0);
        if (repaid != amount) revert BastionErrors.NoEconomicEffect();

        // 2. Withdraw only the collateral needed to cover principal + premium (+ slippage buffer).
        uint256 owed = amount + premium;
        uint256 collNeeded = _collateralForOwed(owed, ctx);
        uint256 got = adapter.withdrawCollateralFor(ctx.account, ctx.collateralAsset, collNeeded, address(this));
        if (got != collNeeded) revert BastionErrors.CollateralManagementUnavailable();

        // 3. Swap on the allowlisted venue with an explicit minimum output.
        if (!isVenue[ctx.venue]) revert BastionErrors.InvalidParameter("VENUE");
        IERC20(ctx.collateralAsset).forceApprove(ctx.venue, collNeeded);
        uint256 balBefore = debt.balanceOf(address(this));
        ISwapVenue(ctx.venue).swapExactIn(ctx.collateralAsset, ctx.debtAsset, collNeeded, owed, address(this));
        IERC20(ctx.collateralAsset).forceApprove(ctx.venue, 0);
        uint256 out = debt.balanceOf(address(this)) - balBefore;
        if (out < owed) revert BastionErrors.InsufficientRescue(out, owed); // malicious/failed venue

        // 4. Return any surplus to the borrower; approve exactly principal + premium to the lender.
        uint256 surplus = out - owed;
        if (surplus > 0) debt.safeTransfer(ctx.account, surplus);
        debt.forceApprove(msg.sender, owed);
        _lastPremium = premium;
        _lastSold = collNeeded;
        _lastSurplus = surplus;
        return true;
    }

    function _collateralFor(uint256 repay, uint256 premiumBps, uint16 slip, BastionTypes.Position memory pos)
        internal
        pure
        returns (uint256)
    {
        uint256 owed = repay + Math.mulDiv(repay, premiumBps, BastionTypes.BPS, Math.Rounding.Ceil);
        uint256 owedBase = Math.mulDiv(owed, pos.debtPrice, 10 ** pos.debtDecimals, Math.Rounding.Ceil);
        uint256 withSlip = Math.mulDiv(owedBase, BastionTypes.BPS + slip, BastionTypes.BPS, Math.Rounding.Ceil);
        return HealthFactorMath.baseToTokenUp(withSlip, pos.collateralPrice, pos.collateralDecimals);
    }

    function _collateralForOwed(uint256 owed, FlashContext memory ctx) internal pure returns (uint256) {
        uint256 owedBase = Math.mulDiv(owed, ctx.debtPrice, 10 ** ctx.debtDecimals, Math.Rounding.Ceil);
        uint256 withSlip =
            Math.mulDiv(owedBase, BastionTypes.BPS + ctx.maxSlippageBps, BastionTypes.BPS, Math.Rounding.Ceil);
        return HealthFactorMath.baseToTokenUp(withSlip, ctx.collateralPrice, ctx.collateralDecimals);
    }
}
