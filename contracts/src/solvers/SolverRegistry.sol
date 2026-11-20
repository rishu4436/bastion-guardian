// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable, Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { BastionErrors } from "../libraries/BastionErrors.sol";

/// @title SolverRegistry
/// @notice Solver identity, bond, payout address, eligibility and performance statistics (destination chain).
contract SolverRegistry is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Solver {
        bool registered;
        bool suspended;
        address payout; // reimbursement recipient on the reserve (source) chain
        uint256 bond;
        uint64 registeredAt;
        uint64 exitRequestedAt;
        uint64 fills;
        uint64 failures;
        uint256 volume;
        string metadataURI;
    }

    IERC20 public immutable BOND_TOKEN;
    uint256 public minBond;
    uint64 public exitDelay;
    address public liquidityVault;
    mapping(address => bool) public isRecorder; // executors
    mapping(address => Solver) private _solvers;
    address[] private _solverList;

    event SolverRegistered(address indexed solver, address payout, uint256 bond, string metadataURI);
    event PayoutUpdated(address indexed solver, address payout);
    event BondAdded(address indexed solver, uint256 amount, uint256 total);
    event ExitRequested(address indexed solver, uint64 at);
    event ExitCompleted(address indexed solver, uint256 bondReturned);
    event SolverSuspended(address indexed solver, bool suspended, bytes32 reason);
    event FillRecorded(address indexed solver, uint256 amount);
    event FailureRecorded(address indexed solver, bytes32 reason);
    event ParamsSet(uint256 minBond, uint64 exitDelay);

    constructor(IERC20 bondToken_, uint256 minBond_, uint64 exitDelay_, address owner_) Ownable(owner_) {
        BOND_TOKEN = bondToken_;
        minBond = minBond_;
        exitDelay = exitDelay_;
    }

    function setParams(uint256 minBond_, uint64 exitDelay_) external onlyOwner {
        minBond = minBond_;
        exitDelay = exitDelay_;
        emit ParamsSet(minBond_, exitDelay_);
    }

    function setLiquidityVault(address vault) external onlyOwner {
        liquidityVault = vault;
    }

    function setRecorder(address recorder, bool enabled) external onlyOwner {
        isRecorder[recorder] = enabled;
    }

    function register(address payout, uint256 bond, string calldata metadataURI) external nonReentrant {
        Solver storage s = _solvers[msg.sender];
        if (s.registered) revert BastionErrors.AlreadyProcessed(bytes32(uint256(uint160(msg.sender))));
        if (payout == address(0)) revert BastionErrors.ZeroAddress();
        if (bond < minBond) revert BastionErrors.InvalidParameter("BOND");
        _pullBond(bond);
        s.registered = true;
        s.payout = payout;
        s.bond = bond;
        s.registeredAt = uint64(block.timestamp);
        s.metadataURI = metadataURI;
        _solverList.push(msg.sender);
        emit SolverRegistered(msg.sender, payout, bond, metadataURI);
    }

    function addBond(uint256 amount) external nonReentrant {
        Solver storage s = _registered(msg.sender);
        _pullBond(amount);
        s.bond += amount;
        emit BondAdded(msg.sender, amount, s.bond);
    }

    function updatePayout(address payout) external {
        Solver storage s = _registered(msg.sender);
        if (payout == address(0)) revert BastionErrors.ZeroAddress();
        s.payout = payout;
        emit PayoutUpdated(msg.sender, payout);
    }

    /// @notice Starts the exit timer. The solver becomes ineligible for new rescues immediately.
    function requestExit() external {
        Solver storage s = _registered(msg.sender);
        s.exitRequestedAt = uint64(block.timestamp);
        emit ExitRequested(msg.sender, s.exitRequestedAt);
    }

    /// @notice Returns the bond after the exit delay, provided no liquidity remains committed.
    function completeExit() external nonReentrant {
        Solver storage s = _registered(msg.sender);
        if (s.exitRequestedAt == 0 || block.timestamp < uint256(s.exitRequestedAt) + exitDelay) {
            revert BastionErrors.InvalidParameter("EXIT_DELAY");
        }
        if (liquidityVault != address(0) && ISolverCommittedView(liquidityVault).totalCommittedOf(msg.sender) != 0) {
            revert BastionErrors.InvalidParameter("COMMITTED_LIQUIDITY");
        }
        uint256 bond = s.bond;
        s.bond = 0;
        s.registered = false;
        BOND_TOKEN.safeTransfer(msg.sender, bond);
        emit ExitCompleted(msg.sender, bond);
    }

    function setSuspended(address solver, bool suspended, bytes32 reason) external onlyOwner {
        Solver storage s = _registered(solver);
        s.suspended = suspended;
        emit SolverSuspended(solver, suspended, reason);
    }

    function recordFill(address solver, uint256 amount) external {
        if (!isRecorder[msg.sender]) revert BastionErrors.Unauthorized(msg.sender);
        Solver storage s = _solvers[solver];
        s.fills += 1;
        s.volume += amount;
        emit FillRecorded(solver, amount);
    }

    function recordFailure(address solver, bytes32 reason) external {
        if (!isRecorder[msg.sender]) revert BastionErrors.Unauthorized(msg.sender);
        _solvers[solver].failures += 1;
        emit FailureRecorded(solver, reason);
    }

    function isEligible(address solver) public view returns (bool) {
        Solver storage s = _solvers[solver];
        return s.registered && !s.suspended && s.exitRequestedAt == 0 && s.bond >= minBond;
    }

    function getSolver(address solver) external view returns (Solver memory) {
        return _solvers[solver];
    }

    function payoutOf(address solver) external view returns (address) {
        return _solvers[solver].payout;
    }

    function solvers() external view returns (address[] memory) {
        return _solverList;
    }

    function _registered(address solver) internal view returns (Solver storage s) {
        s = _solvers[solver];
        if (!s.registered) revert BastionErrors.InvalidParameter("NOT_REGISTERED");
    }

    function _pullBond(uint256 amount) internal {
        if (amount == 0) return;
        uint256 before = BOND_TOKEN.balanceOf(address(this));
        BOND_TOKEN.safeTransferFrom(msg.sender, address(this), amount);
        uint256 got = BOND_TOKEN.balanceOf(address(this)) - before;
        if (got != amount) revert BastionErrors.FeeOnTransferNotSupported(address(BOND_TOKEN), amount, got);
    }
}

interface ISolverCommittedView {
    function totalCommittedOf(address solver) external view returns (uint256);
}
