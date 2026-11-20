// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { Ownable, Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { SignatureChecker } from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import { BastionTypes } from "../libraries/BastionTypes.sol";
import { BastionErrors } from "../libraries/BastionErrors.sol";
import { BastionEmergencyControl } from "../governance/BastionEmergencyControl.sol";

/// @title BastionPolicyRegistry
/// @notice Destination-chain source of truth for user protection policies and their spending limits.
/// @dev Invariants enforced here (see docs/THREAT-MODEL.md):
///      I1  totalRepaid(policy) <= maxTotalRepay of the active version, across all paths and versions.
///      I2  each action <= maxRepayPerAction.
///      I5  paused / revoked / expired policies cannot consume budget.
///      I9  both rescue paths draw from the same counters, so they cannot jointly exceed the budget.
///      Only the policy owner (directly or via EIP-712/ERC-1271 signature) can create, replace, pause, resume or
///      revoke a policy. The registry owner can only manage the executor/adapter allowlists and can never raise a cap.
contract BastionPolicyRegistry is Ownable2Step, EIP712 {
    using BastionTypes for *;

    bytes32 public constant POLICY_TYPEHASH = keccak256(
        "Policy(address owner,address account,uint256 sourceChainId,uint256 destChainId,address adapter,address market,"
        "address debtAsset,address collateralAsset,uint256 triggerHealthFactor,uint256 targetHealthFactor,"
        "uint256 maxTotalRepay,uint256 maxRepayPerAction,uint256 maxTotalFees,uint16 maxSlippageBps,uint16 maxFeeBps,"
        "uint8 allowedPaths,bool allowPartial,uint64 expiry,uint32 cooldown,uint256 nonce,bytes32 solversHash,"
        "bytes32 recipientsHash)"
    );

    uint256 public constant MAX_SOLVERS = 16;
    uint256 public constant MAX_RECIPIENTS = 8;
    uint16 public constant MAX_SLIPPAGE_BPS = 1000; // 10%
    uint16 public constant MAX_FEE_BPS = 1000; // 10%

    BastionEmergencyControl public immutable emergency;

    mapping(bytes32 => BastionTypes.Policy) private _policies;
    mapping(bytes32 => BastionTypes.PolicyState) private _states;
    mapping(bytes32 => mapping(uint64 => mapping(address => bool))) private _solverAllowed;
    mapping(bytes32 => mapping(uint64 => mapping(address => bool))) private _recipientAllowed;
    mapping(address => uint256) public nonces;
    mapping(address => mapping(address => bool)) public accountDelegate; // account => owner => allowed
    mapping(address => bool) public isExecutor;
    mapping(address => bool) public isAdapter;
    mapping(address => bytes32[]) private _ownerPolicies;

    event ExecutorSet(address indexed executor, bool enabled);
    event AdapterSet(address indexed adapter, bool enabled);
    event AccountDelegateSet(address indexed account, address indexed owner, bool enabled);
    event PolicyRegistered(
        bytes32 indexed policyId, address indexed owner, address indexed account, uint64 version, bytes32 policyHash
    );
    event PolicyPaused(bytes32 indexed policyId, uint64 version);
    event PolicyResumed(bytes32 indexed policyId, uint64 version);
    event PolicyRevoked(bytes32 indexed policyId, uint64 version);
    event BudgetConsumed(
        bytes32 indexed policyId,
        uint64 indexed version,
        uint8 path,
        uint256 repaid,
        uint256 fee,
        uint256 totalRepaid,
        uint256 totalFees
    );

    constructor(address owner_, BastionEmergencyControl emergency_)
        Ownable(owner_)
        EIP712("BASTION Policy Registry", "1")
    {
        if (address(emergency_) == address(0)) revert BastionErrors.ZeroAddress();
        emergency = emergency_;
    }

    // ------------------------------------------------------------------ admin (allowlists only)

    function setExecutor(address executor, bool enabled) external onlyOwner {
        if (executor == address(0)) revert BastionErrors.ZeroAddress();
        isExecutor[executor] = enabled;
        emit ExecutorSet(executor, enabled);
    }

    function setAdapter(address adapter, bool enabled) external onlyOwner {
        if (adapter == address(0)) revert BastionErrors.ZeroAddress();
        isAdapter[adapter] = enabled;
        emit AdapterSet(adapter, enabled);
    }

    // ------------------------------------------------------------------ account delegation

    /// @notice An account may let another address own policies protecting it (e.g. a smart-account's signer).
    function setAccountDelegate(address owner_, bool enabled) external {
        accountDelegate[msg.sender][owner_] = enabled;
        emit AccountDelegateSet(msg.sender, owner_, enabled);
    }

    // ------------------------------------------------------------------ policy lifecycle

    function policyIdOf(BastionTypes.Policy calldata p) public pure returns (bytes32) {
        return
            keccak256(
                abi.encode(p.owner, p.account, p.adapter, p.market, p.debtAsset, p.collateralAsset, p.destChainId)
            );
    }

    function hashPolicy(BastionTypes.Policy calldata p) public pure returns (bytes32) {
        bytes memory a = abi.encode(
            POLICY_TYPEHASH,
            p.owner,
            p.account,
            p.sourceChainId,
            p.destChainId,
            p.adapter,
            p.market,
            p.debtAsset,
            p.collateralAsset,
            p.triggerHealthFactor,
            p.targetHealthFactor,
            p.maxTotalRepay
        );
        bytes memory b = abi.encode(
            p.maxRepayPerAction,
            p.maxTotalFees,
            p.maxSlippageBps,
            p.maxFeeBps,
            p.allowedPaths,
            p.allowPartial,
            p.expiry,
            p.cooldown,
            p.nonce,
            p.solversHash,
            p.recipientsHash
        );
        return keccak256(bytes.concat(a, b));
    }

    function policyDigest(BastionTypes.Policy calldata p) public view returns (bytes32) {
        return _hashTypedDataV4(hashPolicy(p));
    }

    /// @notice Registers a new policy or atomically replaces the current version. Cumulative spend carries over.
    /// @param signature EIP-712 signature by `p.owner` (ECDSA or ERC-1271). Ignored when msg.sender == p.owner.
    function registerPolicy(
        BastionTypes.Policy calldata p,
        address[] calldata solvers,
        address[] calldata recipients,
        bytes calldata signature
    ) external returns (bytes32 policyId, uint64 version) {
        _validate(p, solvers, recipients);
        bytes32 structHash = hashPolicy(p);
        if (msg.sender != p.owner) {
            if (!SignatureChecker.isValidSignatureNow(p.owner, _hashTypedDataV4(structHash), signature)) {
                revert BastionErrors.Unauthorized(msg.sender);
            }
        }
        if (p.nonce != nonces[p.owner]) revert BastionErrors.InvalidParameter("NONCE");
        nonces[p.owner] = p.nonce + 1;

        policyId = policyIdOf(p);
        BastionTypes.PolicyState storage s = _states[policyId];
        if (s.version == 0) _ownerPolicies[p.owner].push(policyId);
        version = s.version + 1;
        s.version = version;
        s.status = BastionTypes.PolicyStatus.Active;
        s.pausedAt = 0;
        _policies[policyId] = p;
        for (uint256 i; i < solvers.length; ++i) {
            _solverAllowed[policyId][version][solvers[i]] = true;
        }
        for (uint256 i; i < recipients.length; ++i) {
            _recipientAllowed[policyId][version][recipients[i]] = true;
        }
        emit PolicyRegistered(policyId, p.owner, p.account, version, structHash);
    }

    function pausePolicy(bytes32 policyId) external {
        BastionTypes.PolicyState storage s = _ownedState(policyId);
        if (s.status != BastionTypes.PolicyStatus.Active) revert BastionErrors.PolicyNotActive(policyId);
        s.status = BastionTypes.PolicyStatus.Paused;
        s.pausedAt = uint64(block.timestamp);
        emit PolicyPaused(policyId, s.version);
    }

    function resumePolicy(bytes32 policyId) external {
        BastionTypes.PolicyState storage s = _ownedState(policyId);
        if (s.status != BastionTypes.PolicyStatus.Paused) revert BastionErrors.PolicyNotActive(policyId);
        if (_policies[policyId].expiry <= block.timestamp) revert BastionErrors.PolicyExpired(policyId);
        if (!isAdapter[_policies[policyId].adapter]) revert BastionErrors.InvalidParameter("ADAPTER");
        s.status = BastionTypes.PolicyStatus.Active;
        s.pausedAt = 0;
        emit PolicyResumed(policyId, s.version);
    }

    function revokePolicy(bytes32 policyId) external {
        BastionTypes.PolicyState storage s = _ownedState(policyId);
        if (s.status == BastionTypes.PolicyStatus.Revoked) return;
        s.status = BastionTypes.PolicyStatus.Revoked;
        emit PolicyRevoked(policyId, s.version);
    }

    // ------------------------------------------------------------------ executor accounting

    /// @notice Records an executed rescue against the policy budget. Reverts (rolling back the whole rescue) if any
    ///         limit would be exceeded.
    function consume(bytes32 policyId, uint64 version, uint8 path_, uint256 repaid, uint256 fee) external {
        if (!isExecutor[msg.sender]) revert BastionErrors.Unauthorized(msg.sender);
        emergency.requireNotPaused(BastionTypes.SCOPE_RESCUE);
        BastionTypes.PolicyState storage s = _states[policyId];
        BastionTypes.Policy storage p = _policies[policyId];
        _requireExecutable(policyId, version, path_, s, p);
        if (repaid == 0) revert BastionErrors.NoEconomicEffect();
        if (repaid > p.maxRepayPerAction) revert BastionErrors.PerActionLimitExceeded(repaid, p.maxRepayPerAction);
        uint256 remaining = p.maxTotalRepay > s.totalRepaid ? p.maxTotalRepay - s.totalRepaid : 0;
        if (repaid > remaining) revert BastionErrors.TotalRepayLimitExceeded(repaid, remaining);
        uint256 feeRemaining = p.maxTotalFees > s.totalFees ? p.maxTotalFees - s.totalFees : 0;
        if (fee > feeRemaining) revert BastionErrors.FeeLimitExceeded(fee, feeRemaining);
        if (fee * BastionTypes.BPS > repaid * p.maxFeeBps) {
            revert BastionErrors.FeeRateExceeded(fee, repaid, p.maxFeeBps);
        }
        s.totalRepaid += repaid;
        s.totalFees += fee;
        s.lastActionAt = uint64(block.timestamp);
        emit BudgetConsumed(policyId, version, path_, repaid, fee, s.totalRepaid, s.totalFees);
    }

    // ------------------------------------------------------------------ views

    function getPolicy(bytes32 policyId)
        external
        view
        returns (BastionTypes.Policy memory, BastionTypes.PolicyState memory)
    {
        return (_policies[policyId], _states[policyId]);
    }

    function policiesOf(address owner_) external view returns (bytes32[] memory) {
        return _ownerPolicies[owner_];
    }

    function isSolverAllowed(bytes32 policyId, address solver) external view returns (bool) {
        return _solverAllowed[policyId][_states[policyId].version][solver];
    }

    function isRecipientAllowed(bytes32 policyId, address recipient) external view returns (bool) {
        return _recipientAllowed[policyId][_states[policyId].version][recipient];
    }

    /// @notice Remaining repayment budget for this action, honoring per-action and cumulative caps.
    function remainingRepay(bytes32 policyId) public view returns (uint256) {
        BastionTypes.Policy storage p = _policies[policyId];
        BastionTypes.PolicyState storage s = _states[policyId];
        uint256 remaining = p.maxTotalRepay > s.totalRepaid ? p.maxTotalRepay - s.totalRepaid : 0;
        return remaining < p.maxRepayPerAction ? remaining : p.maxRepayPerAction;
    }

    function remainingFees(bytes32 policyId) external view returns (uint256) {
        BastionTypes.Policy storage p = _policies[policyId];
        BastionTypes.PolicyState storage s = _states[policyId];
        return p.maxTotalFees > s.totalFees ? p.maxTotalFees - s.totalFees : 0;
    }

    /// @notice Non-reverting readiness probe used by executors, the risk observer and Guardian Mode.
    function checkExecutable(bytes32 policyId, uint64 version, uint8 path_)
        external
        view
        returns (bool ok, bytes32 reason)
    {
        BastionTypes.PolicyState storage s = _states[policyId];
        BastionTypes.Policy storage p = _policies[policyId];
        if (emergency.isPaused(BastionTypes.SCOPE_RESCUE)) return (false, "GLOBAL_PAUSE");
        if (s.status != BastionTypes.PolicyStatus.Active) return (false, "NOT_ACTIVE");
        if (version != 0 && version != s.version) return (false, "VERSION_MISMATCH");
        if (p.expiry <= block.timestamp) return (false, "EXPIRED");
        if (path_ != 0 && (p.allowedPaths & path_) == 0) return (false, "PATH_NOT_ALLOWED");
        if (!isAdapter[p.adapter]) return (false, "ADAPTER_DISABLED");
        if (s.lastActionAt != 0 && block.timestamp < uint256(s.lastActionAt) + p.cooldown) return (false, "COOLDOWN");
        if (remainingRepay(policyId) == 0) return (false, "BUDGET_EXHAUSTED");
        return (true, 0);
    }

    // ------------------------------------------------------------------ internal

    function _requireExecutable(
        bytes32 policyId,
        uint64 version,
        uint8 path_,
        BastionTypes.PolicyState storage s,
        BastionTypes.Policy storage p
    ) internal view {
        if (s.status != BastionTypes.PolicyStatus.Active) {
            revert BastionErrors.PolicyNotActive(policyId);
        }
        if (version != s.version) revert BastionErrors.PolicyVersionMismatch(policyId, s.version, version);
        if (p.expiry <= block.timestamp) revert BastionErrors.PolicyExpired(policyId);
        if ((p.allowedPaths & path_) == 0 || path_ == 0) revert BastionErrors.PathNotAllowed(path_);
        if (!isAdapter[p.adapter]) revert BastionErrors.InvalidParameter("ADAPTER");
        if (s.lastActionAt != 0 && block.timestamp < uint256(s.lastActionAt) + p.cooldown) {
            revert BastionErrors.CooldownActive(policyId, uint64(uint256(s.lastActionAt) + p.cooldown));
        }
    }

    function _ownedState(bytes32 policyId) internal view returns (BastionTypes.PolicyState storage s) {
        s = _states[policyId];
        if (s.version == 0) revert BastionErrors.InvalidParameter("UNKNOWN_POLICY");
        if (_policies[policyId].owner != msg.sender) revert BastionErrors.Unauthorized(msg.sender);
    }

    function _validate(BastionTypes.Policy calldata p, address[] calldata solvers, address[] calldata recipients)
        internal
        view
    {
        if (p.owner == address(0) || p.account == address(0)) revert BastionErrors.ZeroAddress();
        if (p.account != p.owner && !accountDelegate[p.account][p.owner]) {
            revert BastionErrors.InvalidParameter("ACCOUNT_NOT_DELEGATED");
        }
        if (p.destChainId != block.chainid) revert BastionErrors.WrongChain(block.chainid, p.destChainId);
        if (!isAdapter[p.adapter]) revert BastionErrors.InvalidParameter("ADAPTER");
        if (p.debtAsset == address(0) || p.collateralAsset == address(0)) revert BastionErrors.ZeroAddress();
        if (p.triggerHealthFactor <= BastionTypes.WAD) revert BastionErrors.InvalidParameter("TRIGGER_HF");
        if (p.targetHealthFactor <= p.triggerHealthFactor) revert BastionErrors.InvalidParameter("TARGET_HF");
        if (p.maxRepayPerAction == 0 || p.maxRepayPerAction > p.maxTotalRepay) {
            revert BastionErrors.InvalidParameter("REPAY_LIMITS");
        }
        if (p.maxSlippageBps > MAX_SLIPPAGE_BPS) revert BastionErrors.InvalidParameter("SLIPPAGE");
        if (p.maxFeeBps > MAX_FEE_BPS) revert BastionErrors.InvalidParameter("FEE_BPS");
        if (p.allowedPaths == 0 || (p.allowedPaths & ~BastionTypes.PATH_MASK) != 0) {
            revert BastionErrors.InvalidParameter("PATHS");
        }
        if (p.expiry <= block.timestamp) revert BastionErrors.InvalidParameter("EXPIRY");
        if (solvers.length > MAX_SOLVERS || recipients.length > MAX_RECIPIENTS) {
            revert BastionErrors.InvalidParameter("LIST_TOO_LONG");
        }
        if (keccak256(abi.encodePacked(solvers)) != p.solversHash) revert BastionErrors.InvalidParameter("SOLVERS");
        if (keccak256(abi.encodePacked(recipients)) != p.recipientsHash) {
            revert BastionErrors.InvalidParameter("RECIPIENTS");
        }
    }
}
