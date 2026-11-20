// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable, Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { BastionErrors } from "../libraries/BastionErrors.sol";
import { BastionTypes } from "../libraries/BastionTypes.sol";
import { SolverRegistry } from "./SolverRegistry.sol";
import { BastionEmergencyControl } from "../governance/BastionEmergencyControl.sol";

/// @title SolverLiquidityVault
/// @notice Holds solver inventory on the destination chain and turns it into *executable* commitments reserved for a
///         specific policy before any risk event occurs. An off-chain quote is never counted as liquidity: only
///         tokens locked here can be drawn by an executor.
contract SolverLiquidityVault is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_COMMITMENTS_PER_POLICY = 8;

    struct Commitment {
        address solver;
        bytes32 policyId;
        address token;
        uint256 amount; // remaining reserved amount
        uint16 feeBps;
        uint64 expiry;
        uint64 createdAt;
        bool active;
    }

    SolverRegistry public immutable REGISTRY;
    BastionEmergencyControl public immutable EMERGENCY;

    mapping(address => mapping(address => uint256)) public available; // solver => token => free inventory
    mapping(address => mapping(address => uint256)) public committed; // solver => token => reserved
    mapping(address => uint256) public totalCommittedOf;
    mapping(bytes32 => Commitment) private _commitments;
    mapping(bytes32 => bytes32[]) private _policyCommitments;
    mapping(address => bool) public isExecutor;
    uint256 public commitmentNonce;

    event Deposited(address indexed solver, address indexed token, uint256 amount);
    event Withdrawn(address indexed solver, address indexed token, uint256 amount);
    event CommitmentCreated(
        bytes32 indexed commitmentId,
        address indexed solver,
        bytes32 indexed policyId,
        address token,
        uint256 amount,
        uint16 feeBps,
        uint64 expiry
    );
    event CommitmentReleased(bytes32 indexed commitmentId, uint256 amountReleased, bytes32 reason);
    event CommitmentDrawn(bytes32 indexed commitmentId, address indexed executor, uint256 amount);
    event UnusedReturned(bytes32 indexed commitmentId, uint256 amount);
    event ExecutorSet(address indexed executor, bool enabled);

    constructor(SolverRegistry registry_, BastionEmergencyControl emergency_, address owner_) Ownable(owner_) {
        REGISTRY = registry_;
        EMERGENCY = emergency_;
    }

    function setExecutor(address executor, bool enabled) external onlyOwner {
        isExecutor[executor] = enabled;
        emit ExecutorSet(executor, enabled);
    }

    // ------------------------------------------------------------------ solver inventory

    function deposit(address token, uint256 amount) external nonReentrant {
        if (!REGISTRY.getSolver(msg.sender).registered) revert BastionErrors.InvalidParameter("NOT_REGISTERED");
        uint256 before = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 got = IERC20(token).balanceOf(address(this)) - before;
        if (got != amount) revert BastionErrors.FeeOnTransferNotSupported(token, amount, got);
        available[msg.sender][token] += amount;
        emit Deposited(msg.sender, token, amount);
    }

    /// @notice Withdraws free (uncommitted) inventory. Never blocked by pauses.
    function withdraw(address token, uint256 amount) external nonReentrant {
        uint256 a = available[msg.sender][token];
        if (amount > a) revert BastionErrors.InsufficientBalance(amount, a);
        available[msg.sender][token] = a - amount;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, token, amount);
    }

    function commit(bytes32 policyId, address token, uint256 amount, uint16 feeBps, uint64 expiry)
        external
        returns (bytes32 id)
    {
        EMERGENCY.requireNotPaused(BastionTypes.SCOPE_SOLVER);
        if (!REGISTRY.isEligible(msg.sender)) revert BastionErrors.InvalidParameter("SOLVER_INELIGIBLE");
        if (amount == 0 || expiry <= block.timestamp || feeBps > 1000) revert BastionErrors.InvalidParameter("QUOTE");
        uint256 a = available[msg.sender][token];
        if (amount > a) revert BastionErrors.InsufficientBalance(amount, a);
        _prune(policyId);
        if (_policyCommitments[policyId].length >= MAX_COMMITMENTS_PER_POLICY) {
            revert BastionErrors.InvalidParameter("TOO_MANY_COMMITMENTS");
        }
        available[msg.sender][token] = a - amount;
        committed[msg.sender][token] += amount;
        totalCommittedOf[msg.sender] += amount;
        id = keccak256(abi.encode(block.chainid, address(this), ++commitmentNonce));
        _commitments[id] =
            Commitment(msg.sender, policyId, token, amount, feeBps, expiry, uint64(block.timestamp), true);
        _policyCommitments[policyId].push(id);
        emit CommitmentCreated(id, msg.sender, policyId, token, amount, feeBps, expiry);
    }

    /// @notice Solver cancels an unexecuted commitment (any time), or anyone reclaims an expired one for the solver.
    function release(bytes32 id) external {
        Commitment storage c = _commitments[id];
        if (!c.active) revert BastionErrors.InvalidParameter("INACTIVE");
        if (msg.sender != c.solver && block.timestamp < c.expiry) revert BastionErrors.Unauthorized(msg.sender);
        _release(id, c, msg.sender == c.solver ? bytes32("CANCELLED") : bytes32("EXPIRED"));
    }

    // ------------------------------------------------------------------ executor

    function draw(bytes32 id, uint256 amount, address to) external nonReentrant {
        if (!isExecutor[msg.sender]) revert BastionErrors.Unauthorized(msg.sender);
        Commitment storage c = _commitments[id];
        if (!c.active || block.timestamp >= c.expiry) revert BastionErrors.InvalidParameter("COMMITMENT_UNAVAILABLE");
        if (amount > c.amount) revert BastionErrors.InsufficientBalance(amount, c.amount);
        c.amount -= amount;
        committed[c.solver][c.token] -= amount;
        totalCommittedOf[c.solver] -= amount;
        if (c.amount == 0) c.active = false;
        IERC20(c.token).safeTransfer(to, amount);
        emit CommitmentDrawn(id, msg.sender, amount);
    }

    /// @notice Returns undrawn tokens from an executor back to the solver's free inventory.
    function returnUnused(bytes32 id, uint256 amount) external nonReentrant {
        if (!isExecutor[msg.sender]) revert BastionErrors.Unauthorized(msg.sender);
        if (amount == 0) return;
        Commitment storage c = _commitments[id];
        IERC20(c.token).safeTransferFrom(msg.sender, address(this), amount);
        available[c.solver][c.token] += amount;
        emit UnusedReturned(id, amount);
    }

    // ------------------------------------------------------------------ views

    function getCommitment(bytes32 id) external view returns (Commitment memory) {
        return _commitments[id];
    }

    function commitmentsOf(bytes32 policyId) external view returns (bytes32[] memory) {
        return _policyCommitments[policyId];
    }

    function _release(bytes32 id, Commitment storage c, bytes32 reason) internal {
        uint256 amt = c.amount;
        c.active = false;
        c.amount = 0;
        committed[c.solver][c.token] -= amt;
        totalCommittedOf[c.solver] -= amt;
        available[c.solver][c.token] += amt;
        emit CommitmentReleased(id, amt, reason);
    }

    /// @dev Removes inactive commitment ids from the bounded per-policy list.
    function _prune(bytes32 policyId) internal {
        bytes32[] storage list = _policyCommitments[policyId];
        uint256 i;
        while (i < list.length) {
            if (!_commitments[list[i]].active) {
                list[i] = list[list.length - 1];
                list.pop();
            } else {
                ++i;
            }
        }
    }
}
