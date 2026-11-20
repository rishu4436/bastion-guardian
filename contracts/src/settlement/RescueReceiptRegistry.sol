// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { Ownable, Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { BastionErrors } from "../libraries/BastionErrors.sol";

/// @title RescueReceiptRegistry
/// @notice Immutable on-chain Proof-of-Protection facts. Only values measured on-chain at execution time are stored;
///         derived analytics (USD values, forecasts) live off-chain and are labeled as such.
contract RescueReceiptRegistry is Ownable2Step {
    struct Receipt {
        bytes32 rescueId;
        bytes32 policyId;
        uint64 policyVersion;
        bytes32 originEventId;
        uint256 originChainId;
        address account;
        bytes32 protocolId;
        uint8 path;
        address debtAsset;
        uint256 repaid;
        uint256 debtBefore;
        uint256 debtAfter;
        uint256 healthFactorBefore;
        uint256 healthFactorAfter;
        address solver;
        uint256 fee;
        uint64 executedAt;
        uint256 executedBlock;
        bytes32 settlementRef;
    }

    mapping(address => bool) public isWriter;
    mapping(bytes32 => Receipt) private _receipts;
    mapping(address => bytes32[]) private _byAccount;

    event WriterSet(address indexed writer, bool enabled);
    event ReceiptRecorded(
        bytes32 indexed rescueId,
        bytes32 indexed policyId,
        address indexed account,
        uint8 path,
        uint256 repaid,
        uint256 fee,
        uint256 healthFactorBefore,
        uint256 healthFactorAfter
    );
    event ReceiptSettled(bytes32 indexed rescueId, bytes32 settlementRef);

    constructor(address owner_) Ownable(owner_) { }

    function setWriter(address writer, bool enabled) external onlyOwner {
        isWriter[writer] = enabled;
        emit WriterSet(writer, enabled);
    }

    function record(Receipt calldata r) external {
        if (!isWriter[msg.sender]) revert BastionErrors.Unauthorized(msg.sender);
        if (_receipts[r.rescueId].rescueId != bytes32(0)) revert BastionErrors.AlreadyProcessed(r.rescueId);
        _receipts[r.rescueId] = r;
        _byAccount[r.account].push(r.rescueId);
        emit ReceiptRecorded(
            r.rescueId, r.policyId, r.account, r.path, r.repaid, r.fee, r.healthFactorBefore, r.healthFactorAfter
        );
    }

    function attachSettlement(bytes32 rescueId, bytes32 settlementRef) external {
        if (!isWriter[msg.sender]) revert BastionErrors.Unauthorized(msg.sender);
        Receipt storage r = _receipts[rescueId];
        if (r.rescueId == bytes32(0) || r.settlementRef != bytes32(0)) return;
        r.settlementRef = settlementRef;
        emit ReceiptSettled(rescueId, settlementRef);
    }

    function getReceipt(bytes32 rescueId) external view returns (Receipt memory) {
        return _receipts[rescueId];
    }

    function receiptsOf(address account) external view returns (bytes32[] memory) {
        return _byAccount[account];
    }
}
