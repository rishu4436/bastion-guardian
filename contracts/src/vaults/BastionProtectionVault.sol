// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable, Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { BastionTypes } from "../libraries/BastionTypes.sol";
import { BastionErrors } from "../libraries/BastionErrors.sol";
import { BastionEmergencyControl } from "../governance/BastionEmergencyControl.sol";

/// @title BastionProtectionVault
/// @notice User-controlled reserve on the source (reserve) chain. Users deposit approved tokens and allocate
///         policy-specific budgets that back solver reimbursements. Repayment reserves and fee reserves are separate.
/// @dev Invariants:
///      I4  free balances are always withdrawable by their owner — no pause, admin or settler can block or move them.
///      I6  only an authorized settler (CrossChainReserveEscrow) can debit a budget, and only within its reserves
///          and fee-rate ceiling.
///      Releasing a budget back to free balance is delayed by `releaseDelay` so solvers that already repaid debt in
///      reliance on that budget have time to settle (the `ReleaseRequested` event is their warning signal).
///      Pausing a budget blocks reimbursement for rescues executed after the pause, preserving earlier obligations.
contract BastionProtectionVault is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Budget {
        address owner;
        address token;
        uint256 repayReserve;
        uint256 feeReserve;
        uint16 maxFeeBps;
        uint64 releaseRequestedAt;
        uint64 pausedAt; // 0 = active
        uint256 totalReimbursed;
    }

    BastionEmergencyControl public immutable EMERGENCY;
    uint64 public immutable RELEASE_DELAY;

    mapping(address => bool) public isSupportedToken;
    mapping(address => bool) public isSettler;
    mapping(address => mapping(address => uint256)) public freeBalance; // user => token => amount
    mapping(bytes32 => Budget) private _budgets;
    mapping(address => uint256) public totalHeld; // token => sum(free + budgets) for solvency checks

    event TokenSupported(address indexed token, bool supported);
    event SettlerSet(address indexed settler, bool enabled);
    event Deposited(address indexed user, address indexed token, uint256 amount);
    event Withdrawn(address indexed user, address indexed token, uint256 amount);
    event BudgetAllocated(
        bytes32 indexed policyId,
        address indexed owner,
        address token,
        uint256 repayAdded,
        uint256 feeAdded,
        uint16 maxFeeBps
    );
    event ReleaseRequested(bytes32 indexed policyId, uint64 executableAt);
    event BudgetReleased(bytes32 indexed policyId, uint256 repayReleased, uint256 feeReleased);
    event BudgetPaused(bytes32 indexed policyId, uint64 at);
    event BudgetResumed(bytes32 indexed policyId);
    event Reimbursed(bytes32 indexed policyId, address indexed recipient, uint256 principal, uint256 fee);

    constructor(BastionEmergencyControl emergency_, uint64 releaseDelay_, address owner_) Ownable(owner_) {
        EMERGENCY = emergency_;
        RELEASE_DELAY = releaseDelay_;
    }

    function setSupportedToken(address token, bool supported) external onlyOwner {
        isSupportedToken[token] = supported;
        emit TokenSupported(token, supported);
    }

    function setSettler(address settler, bool enabled) external onlyOwner {
        isSettler[settler] = enabled;
        emit SettlerSet(settler, enabled);
    }

    // ------------------------------------------------------------------ user

    function deposit(address token, uint256 amount) external nonReentrant {
        if (!isSupportedToken[token]) revert BastionErrors.UnsupportedToken(token);
        uint256 before = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 got = IERC20(token).balanceOf(address(this)) - before;
        if (got != amount) revert BastionErrors.FeeOnTransferNotSupported(token, amount, got);
        freeBalance[msg.sender][token] += amount;
        totalHeld[token] += amount;
        emit Deposited(msg.sender, token, amount);
    }

    /// @notice Withdraw unencumbered funds. Intentionally NOT gated by any pause.
    function withdraw(address token, uint256 amount) external nonReentrant {
        uint256 f = freeBalance[msg.sender][token];
        if (amount > f) revert BastionErrors.InsufficientBalance(amount, f);
        freeBalance[msg.sender][token] = f - amount;
        totalHeld[token] -= amount;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, token, amount);
    }

    /// @notice Moves free balance into a policy budget. Allocating cancels a pending release request.
    function allocate(bytes32 policyId, address token, uint256 repayAmount, uint256 feeAmount, uint16 maxFeeBps)
        external
    {
        Budget storage b = _budgets[policyId];
        if (b.owner == address(0)) {
            b.owner = msg.sender;
            b.token = token;
        } else {
            if (b.owner != msg.sender) revert BastionErrors.Unauthorized(msg.sender);
            if (b.token != token) revert BastionErrors.UnsupportedToken(token);
            // A fee ceiling may only be lowered while obligations may exist (never silently raised).
            if (maxFeeBps > b.maxFeeBps && (b.repayReserve != 0 || b.feeReserve != 0)) {
                revert BastionErrors.InvalidParameter("FEE_CEILING_RAISE");
            }
        }
        if (maxFeeBps > 1000) revert BastionErrors.InvalidParameter("FEE_BPS");
        uint256 total = repayAmount + feeAmount;
        uint256 f = freeBalance[msg.sender][token];
        if (total > f) revert BastionErrors.InsufficientBalance(total, f);
        freeBalance[msg.sender][token] = f - total;
        b.repayReserve += repayAmount;
        b.feeReserve += feeAmount;
        b.maxFeeBps = maxFeeBps;
        b.releaseRequestedAt = 0;
        emit BudgetAllocated(policyId, msg.sender, token, repayAmount, feeAmount, maxFeeBps);
    }

    function requestRelease(bytes32 policyId) external {
        Budget storage b = _owned(policyId);
        b.releaseRequestedAt = uint64(block.timestamp);
        emit ReleaseRequested(policyId, uint64(block.timestamp) + RELEASE_DELAY);
    }

    function release(bytes32 policyId, uint256 repayAmount, uint256 feeAmount) external nonReentrant {
        Budget storage b = _owned(policyId);
        if (b.releaseRequestedAt == 0 || block.timestamp < uint256(b.releaseRequestedAt) + RELEASE_DELAY) {
            revert BastionErrors.InvalidParameter("RELEASE_DELAY");
        }
        if (repayAmount > b.repayReserve) revert BastionErrors.InsufficientBalance(repayAmount, b.repayReserve);
        if (feeAmount > b.feeReserve) revert BastionErrors.InsufficientBalance(feeAmount, b.feeReserve);
        b.repayReserve -= repayAmount;
        b.feeReserve -= feeAmount;
        freeBalance[b.owner][b.token] += repayAmount + feeAmount;
        emit BudgetReleased(policyId, repayAmount, feeAmount);
    }

    function pauseBudget(bytes32 policyId) external {
        Budget storage b = _owned(policyId);
        if (b.pausedAt == 0) b.pausedAt = uint64(block.timestamp);
        emit BudgetPaused(policyId, b.pausedAt);
    }

    function resumeBudget(bytes32 policyId) external {
        Budget storage b = _owned(policyId);
        b.pausedAt = 0;
        emit BudgetResumed(policyId);
    }

    // ------------------------------------------------------------------ settler (escrow)

    /// @notice Debits a policy budget to reimburse a verified solver claim.
    /// @param executedAt Destination execution timestamp (rescues executed after a budget pause are rejected).
    function settle(bytes32 policyId, address recipient, uint256 principal, uint256 fee, uint64 executedAt)
        external
        nonReentrant
    {
        if (!isSettler[msg.sender]) revert BastionErrors.Unauthorized(msg.sender);
        EMERGENCY.requireNotPaused(BastionTypes.SCOPE_SETTLEMENT);
        if (recipient == address(0)) revert BastionErrors.ZeroAddress();
        Budget storage b = _budgets[policyId];
        if (b.owner == address(0)) revert BastionErrors.InvalidParameter("NO_BUDGET");
        if (b.pausedAt != 0 && executedAt > b.pausedAt) revert BastionErrors.PolicyNotActive(policyId);
        if (principal == 0) revert BastionErrors.NoEconomicEffect();
        if (principal > b.repayReserve) revert BastionErrors.InsufficientBalance(principal, b.repayReserve);
        if (fee > b.feeReserve) revert BastionErrors.FeeLimitExceeded(fee, b.feeReserve);
        if (fee * BastionTypes.BPS > principal * b.maxFeeBps) {
            revert BastionErrors.FeeRateExceeded(fee, principal, b.maxFeeBps);
        }
        b.repayReserve -= principal;
        b.feeReserve -= fee;
        b.totalReimbursed += principal + fee;
        totalHeld[b.token] -= principal + fee;
        IERC20(b.token).safeTransfer(recipient, principal + fee);
        emit Reimbursed(policyId, recipient, principal, fee);
    }

    // ------------------------------------------------------------------ views

    function getBudget(bytes32 policyId) external view returns (Budget memory) {
        return _budgets[policyId];
    }

    function _owned(bytes32 policyId) internal view returns (Budget storage b) {
        b = _budgets[policyId];
        if (b.owner != msg.sender) revert BastionErrors.Unauthorized(msg.sender);
    }
}
