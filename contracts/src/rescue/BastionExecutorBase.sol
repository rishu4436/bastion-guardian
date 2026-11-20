// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { Ownable, Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { BastionTypes } from "../libraries/BastionTypes.sol";
import { BastionErrors } from "../libraries/BastionErrors.sol";
import { BastionPolicyRegistry } from "../policies/BastionPolicyRegistry.sol";
import { RescueSettlementLedger } from "../settlement/RescueSettlementLedger.sol";
import { RescueReceiptRegistry } from "../settlement/RescueReceiptRegistry.sol";
import { IBastionLendingAdapter } from "../interfaces/IBastionLendingAdapter.sol";

/// @title BastionExecutorBase
/// @notice Shared plumbing for rescue executors: router gating, policy loading, exposure checks, receipts.
abstract contract BastionExecutorBase is Ownable2Step, ReentrancyGuard {
    BastionPolicyRegistry public immutable POLICIES;
    RescueSettlementLedger public immutable LEDGER;
    RescueReceiptRegistry public immutable RECEIPTS;
    address public router;

    event RouterSet(address indexed router);

    constructor(
        BastionPolicyRegistry policies_,
        RescueSettlementLedger ledger_,
        RescueReceiptRegistry receipts_,
        address owner_
    ) Ownable(owner_) {
        POLICIES = policies_;
        LEDGER = ledger_;
        RECEIPTS = receipts_;
    }

    function setRouter(address router_) external onlyOwner {
        if (router_ == address(0)) revert BastionErrors.ZeroAddress();
        router = router_;
        emit RouterSet(router_);
    }

    modifier onlyRouter() {
        if (msg.sender != router) revert BastionErrors.Unauthorized(msg.sender);
        _;
    }

    function _load(bytes32 policyId, uint64 version)
        internal
        view
        returns (BastionTypes.Policy memory p, IBastionLendingAdapter adapter, BastionTypes.Position memory pos)
    {
        BastionTypes.PolicyState memory s;
        (p, s) = POLICIES.getPolicy(policyId);
        if (s.version != version) revert BastionErrors.PolicyVersionMismatch(policyId, s.version, version);
        adapter = IBastionLendingAdapter(p.adapter);
        pos = adapter.getPosition(p.account, p.collateralAsset, p.debtAsset);
        if (pos.healthFactor >= p.triggerHealthFactor) {
            revert BastionErrors.NotExposed(pos.healthFactor, p.triggerHealthFactor);
        }
    }

    function _receipt(
        BastionTypes.RescueRequest calldata req,
        BastionTypes.Policy memory p,
        IBastionLendingAdapter adapter,
        BastionTypes.RescueResult memory r,
        uint256 originChainId
    ) internal {
        RECEIPTS.record(
            RescueReceiptRegistry.Receipt({
                rescueId: req.rescueId,
                policyId: req.policyId,
                policyVersion: req.policyVersion,
                originEventId: req.originEventId,
                originChainId: originChainId,
                account: p.account,
                protocolId: adapter.protocolId(),
                path: r.path,
                debtAsset: p.debtAsset,
                repaid: r.repaid,
                debtBefore: r.debtBefore,
                debtAfter: r.debtAfter,
                healthFactorBefore: r.healthFactorBefore,
                healthFactorAfter: r.healthFactorAfter,
                solver: r.solver,
                fee: r.fee,
                executedAt: uint64(block.timestamp),
                executedBlock: block.number,
                settlementRef: bytes32(0)
            })
        );
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}
