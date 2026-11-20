// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { ISystemContract } from "@reactive/src/interfaces/ISystemContract.sol";
import { IReactive } from "@reactive/src/interfaces/IReactive.sol";
import { AbstractReactive } from "@reactive/src/base/AbstractReactive.sol";

/// @title BastionReactiveCore
/// @notice Reactive Omni contract (Reactive Lasna, chain 5318007). Subscribes to allowlisted origin events,
///         validates their identity and structure, deduplicates them, applies bounded pre-filters and requests
///         authenticated destination callbacks via `SYSTEM.requestCallbackV_1_0`.
///
///         Event kinds:
///           RISK_SIGNAL            BastionRiskObserver.RiskObserved (Base Sepolia)      → BastionCallbackRouter.onRiskSignal
///           SOLVER_RESCUE_EXECUTED SolverRescueExecutor.SolverRescueExecuted (Base)     → CrossChainReserveEscrow.settleRescue (Unichain)
///           REIMBURSEMENT_DONE     CrossChainReserveEscrow.ReimbursementCompleted (Uni) → BastionCallbackRouter.onSettlementAck (Base)
///
/// @dev Built against reactive-lib-omni v0.1.0 (commit 3ade0dc): AbstractReactive, react(LogRecord) onlySystem,
///      SYSTEM.subscribe/unsubscribe, SYSTEM.requestCallbackV_1_0. No legacy vmOnly / service.subscribe / emit Callback.
///      The policy mirror here is a cost-saving pre-filter only; all financial rules are re-checked on destination.
///      Non-matching or malformed logs return early (never revert) because reverting in react() is still billed.
contract BastionReactiveCore is AbstractReactive {
    uint8 public constant KIND_RISK_SIGNAL = 1;
    uint8 public constant KIND_SOLVER_RESCUE_EXECUTED = 2;
    uint8 public constant KIND_REIMBURSEMENT_DONE = 3;
    uint256 public constant MAX_SOURCES = 16;

    struct Source {
        uint256 chainId;
        address emitter;
        uint256 topic0;
        uint8 kind;
        uint8 opCode;
        uint16 dataLength; // exact expected ABI data length in bytes
        bool active;
    }

    struct Destination {
        uint256 chainId;
        address recipient;
        uint64 gasLimit;
    }

    struct PolicyMirror {
        bool active;
        uint64 version;
        uint32 cooldown;
        uint64 lastTriggerAt;
    }

    address public owner;
    address public pendingOwner;
    bool public paused;

    Source[] private _sources;
    mapping(bytes32 => uint256) private _sourceIndex; // keccak(chainId, emitter, topic0) => index + 1

    Destination public riskDestination; // BastionCallbackRouter on Base Sepolia
    Destination public settlementDestination; // CrossChainReserveEscrow on Unichain Sepolia
    Destination public ackDestination; // BastionCallbackRouter on Base Sepolia

    mapping(bytes32 => PolicyMirror) public policyMirror;
    mapping(bytes32 => bool) public seenEvent;

    uint64 public rateWindow = 60;
    uint32 public maxCallbacksPerWindow = 30;
    uint64 public windowStart;
    uint32 public callbacksInWindow;

    uint256 public eventsAccepted;
    uint256 public eventsIgnored;
    uint256 public callbacksRequested;

    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event SourceAdded(uint256 indexed index, uint256 chainId, address emitter, uint256 topic0, uint8 kind);
    event SourceActivated(uint256 indexed index, bool active);
    event DestinationSet(uint8 indexed kind, uint256 chainId, address recipient, uint64 gasLimit);
    event PolicyMirrorSet(bytes32 indexed policyId, bool active, uint64 version, uint32 cooldown);
    event PausedSet(bool paused);
    event RateLimitSet(uint64 window, uint32 maxCallbacks);
    event EventIgnored(bytes32 indexed eventId, uint256 chainId, address emitter, bytes32 reason);
    event EventAccepted(bytes32 indexed eventId, uint8 kind, uint256 chainId, uint256 txHash, uint256 logIndex);
    event CallbackRequested(bytes32 indexed eventId, uint8 kind, uint256 destChainId, address recipient);

    error NotOwner(address caller);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }

    constructor(address owner_) payable {
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
    }

    // ------------------------------------------------------------------ ownership (two-step)

    function transferOwnership(address newOwner) external onlyOwner {
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotOwner(msg.sender);
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    // ------------------------------------------------------------------ configuration

    function addSource(uint256 chainId, address emitter, uint256 topic0, uint8 kind, uint8 opCode, uint16 dataLength)
        external
        onlyOwner
        returns (uint256 index)
    {
        require(_sources.length < MAX_SOURCES, "MAX_SOURCES");
        require(chainId != 0 && emitter != address(0) && topic0 != 0, "SPECIFIC_CRITERIA");
        require(kind >= KIND_RISK_SIGNAL && kind <= KIND_REIMBURSEMENT_DONE && opCode <= 4, "KIND");
        bytes32 key = keccak256(abi.encode(chainId, emitter, topic0));
        require(_sourceIndex[key] == 0, "DUPLICATE");
        _sources.push(Source(chainId, emitter, topic0, kind, opCode, dataLength, false));
        index = _sources.length - 1;
        _sourceIndex[key] = index + 1;
        emit SourceAdded(index, chainId, emitter, topic0, kind);
    }

    /// @notice Subscribes (activate) or unsubscribes (deactivate) with exactly the same six criteria.
    function setSourceActive(uint256 index, bool active) external onlyOwner {
        Source storage s = _sources[index];
        if (s.active == active) return;
        s.active = active;
        if (active) {
            _coverDebt();
            SYSTEM.subscribe(s.chainId, s.emitter, s.topic0, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
        } else {
            SYSTEM.unsubscribe(s.chainId, s.emitter, s.topic0, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
        }
        emit SourceActivated(index, active);
    }

    function setDestination(uint8 kind, uint256 chainId, address recipient, uint64 gasLimit) external onlyOwner {
        require(recipient != address(0) && chainId != 0 && gasLimit >= 100_000 && gasLimit <= 5_000_000, "DEST");
        Destination memory d = Destination(chainId, recipient, gasLimit);
        if (kind == KIND_RISK_SIGNAL) riskDestination = d;
        else if (kind == KIND_SOLVER_RESCUE_EXECUTED) settlementDestination = d;
        else if (kind == KIND_REIMBURSEMENT_DONE) ackDestination = d;
        else revert("KIND");
        emit DestinationSet(kind, chainId, recipient, gasLimit);
    }

    function setPolicyMirror(bytes32 policyId, bool active, uint64 version, uint32 cooldown) external onlyOwner {
        PolicyMirror storage m = policyMirror[policyId];
        m.active = active;
        m.version = version;
        m.cooldown = cooldown;
        emit PolicyMirrorSet(policyId, active, version, cooldown);
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit PausedSet(p);
    }

    function setRateLimit(uint64 window, uint32 maxCallbacks) external onlyOwner {
        require(window > 0 && maxCallbacks > 0, "RATE");
        rateWindow = window;
        maxCallbacksPerWindow = maxCallbacks;
        emit RateLimitSet(window, maxCallbacks);
    }

    /// @notice Settle outstanding REACT debt from this contract's balance; callable by anyone (top-up path).
    function coverDebt() external {
        _coverDebt();
    }

    // ------------------------------------------------------------------ views / diagnostics

    function sourceCount() external view returns (uint256) {
        return _sources.length;
    }

    function getSource(uint256 index) external view returns (Source memory) {
        return _sources[index];
    }

    function outstandingDebt() external view returns (uint256) {
        return SYSTEM.debt(address(this));
    }

    /// @notice Deterministic origin-event identifier (chain, emitter, tx hash, log index, signature).
    function eventIdOf(LogRecord memory log_) public pure returns (bytes32) {
        return keccak256(abi.encode(log_.chainId, log_.contractAddress, log_.txHash, log_.logIndex, log_.topic0));
    }

    // ------------------------------------------------------------------ react

    /// @inheritdoc IReactive
    function react(LogRecord calldata log_) external onlySystem {
        bytes32 eventId = eventIdOf(log_);
        uint256 idx = _sourceIndex[keccak256(abi.encode(log_.chainId, log_.contractAddress, log_.topic0))];
        if (idx == 0) return _ignore(eventId, log_, "UNKNOWN_SOURCE");
        Source storage s = _sources[idx - 1];
        if (!s.active) return _ignore(eventId, log_, "SOURCE_INACTIVE");
        if (log_.opCode != s.opCode) return _ignore(eventId, log_, "OPCODE");
        if (log_.data.length != s.dataLength) return _ignore(eventId, log_, "DATA_LENGTH");
        if (seenEvent[eventId]) return _ignore(eventId, log_, "DUPLICATE");
        if (paused) return _ignore(eventId, log_, "PAUSED");
        seenEvent[eventId] = true;

        if (s.kind == KIND_RISK_SIGNAL) _onRiskSignal(eventId, log_);
        else if (s.kind == KIND_SOLVER_RESCUE_EXECUTED) _onSolverRescue(eventId, log_);
        else _onReimbursement(eventId, log_);
    }

    /// RiskObserved(bytes32 indexed policyId, address indexed account, uint64 indexed version,
    ///              uint256 healthFactor, uint256 triggerHealthFactor, uint64 observedAt)
    function _onRiskSignal(bytes32 eventId, LogRecord calldata log_) internal {
        bytes32 policyId = bytes32(log_.topic1);
        uint64 version = uint64(log_.topic3);
        (uint256 hf, uint256 trigger, uint64 observedAt) = abi.decode(log_.data, (uint256, uint256, uint64));
        PolicyMirror storage m = policyMirror[policyId];
        if (!m.active) return _ignore(eventId, log_, "POLICY_NOT_MIRRORED");
        if (m.version != version) return _ignore(eventId, log_, "POLICY_VERSION");
        if (hf >= trigger) return _ignore(eventId, log_, "NOT_BELOW_TRIGGER");
        if (m.lastTriggerAt != 0 && block.timestamp < uint256(m.lastTriggerAt) + m.cooldown) {
            return _ignore(eventId, log_, "COOLDOWN");
        }
        Destination memory d = riskDestination;
        if (d.recipient == address(0)) return _ignore(eventId, log_, "NO_DESTINATION");
        if (!_takeRateSlot()) return _ignore(eventId, log_, "RATE_LIMITED");
        m.lastTriggerAt = uint64(block.timestamp);
        bytes memory payload = abi.encodeWithSignature(
            "onRiskSignal(address,bytes32,uint256,bytes32,uint64,uint256,uint64)",
            address(0),
            eventId,
            log_.chainId,
            policyId,
            version,
            hf,
            observedAt
        );
        _request(eventId, KIND_RISK_SIGNAL, d, payload);
    }

    /// SolverRescueExecuted(bytes32 indexed rescueId, bytes32 indexed policyId, address indexed solver,
    ///                      address payout, uint256 principal, uint256 fee, uint64 executedAt, bytes32 originEventId)
    function _onSolverRescue(bytes32 eventId, LogRecord calldata log_) internal {
        Destination memory d = settlementDestination;
        if (d.recipient == address(0)) return _ignore(eventId, log_, "NO_DESTINATION");
        (address payout, uint256 principal, uint256 fee, uint64 executedAt, bytes32 originEventId) =
            abi.decode(log_.data, (address, uint256, uint256, uint64, bytes32));
        originEventId;
        bytes memory payload = abi.encodeWithSignature(
            "settleRescue(address,bytes32,bytes32,uint256,address,address,uint256,uint256,uint64,bytes32)",
            address(0),
            bytes32(log_.topic1),
            bytes32(log_.topic2),
            log_.chainId,
            log_.contractAddress,
            payout,
            principal,
            fee,
            executedAt,
            eventId
        );
        _request(eventId, KIND_SOLVER_RESCUE_EXECUTED, d, payload);
    }

    /// ReimbursementCompleted(bytes32 indexed rescueId, bytes32 indexed policyId, address indexed recipient,
    ///                        uint256 principal, uint256 fee)
    function _onReimbursement(bytes32 eventId, LogRecord calldata log_) internal {
        Destination memory d = ackDestination;
        if (d.recipient == address(0)) return _ignore(eventId, log_, "NO_DESTINATION");
        bytes memory payload = abi.encodeWithSignature(
            "onSettlementAck(address,bytes32,bytes32)", address(0), bytes32(log_.topic1), eventId
        );
        _request(eventId, KIND_REIMBURSEMENT_DONE, d, payload);
    }

    function _request(bytes32 eventId, uint8 kind, Destination memory d, bytes memory payload) internal {
        eventsAccepted += 1;
        callbacksRequested += 1;
        SYSTEM.requestCallbackV_1_0(
            ISystemContract.CallbackConfiguration_V_1_0({
                chainId: d.chainId, recipient: d.recipient, gasLimit: d.gasLimit, payload: payload
            })
        );
        emit CallbackRequested(eventId, kind, d.chainId, d.recipient);
    }

    function _takeRateSlot() internal returns (bool) {
        if (block.timestamp >= uint256(windowStart) + rateWindow) {
            windowStart = uint64(block.timestamp);
            callbacksInWindow = 0;
        }
        if (callbacksInWindow >= maxCallbacksPerWindow) return false;
        callbacksInWindow += 1;
        return true;
    }

    function _ignore(bytes32 eventId, LogRecord calldata log_, bytes32 reason) internal {
        eventsIgnored += 1;
        emit EventIgnored(eventId, log_.chainId, log_.contractAddress, reason);
    }
}
