// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

/// @title BastionTypes
/// @notice Shared data structures, constants and enums used across BASTION Guardian contracts.
library BastionTypes {
    /// @dev Health factors use 1e18 fixed-point (Aave convention): 1e18 == 1.0.
    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS = 10_000;

    /// @dev Rescue path bitmask values.
    uint8 internal constant PATH_FLASH = 1; // FlashNet self-funded deleveraging
    uint8 internal constant PATH_SOLVER = 2; // BASTION Solver-funded repayment
    uint8 internal constant PATH_MASK = 3;

    /// @dev Emergency scopes.
    bytes32 internal constant SCOPE_ALL = keccak256("BASTION.SCOPE.ALL");
    bytes32 internal constant SCOPE_RESCUE = keccak256("BASTION.SCOPE.RESCUE");
    bytes32 internal constant SCOPE_SETTLEMENT = keccak256("BASTION.SCOPE.SETTLEMENT");
    bytes32 internal constant SCOPE_SOLVER = keccak256("BASTION.SCOPE.SOLVER");

    enum PolicyStatus {
        None,
        Active,
        Paused,
        Revoked
    }

    /// @notice A user-signed protection policy. Every financial limit is enforced on the destination chain.
    struct Policy {
        address owner; // policy owner / signer
        address account; // protected borrower account on the lending market
        uint256 sourceChainId; // chain holding the reserve escrow (solver reimbursement)
        uint256 destChainId; // chain holding the lending position (must equal block.chainid of registry)
        address adapter; // approved lending adapter
        address market; // lending market (e.g. Aave Pool)
        address debtAsset;
        address collateralAsset;
        uint256 triggerHealthFactor; // WAD; intervene when HF < trigger
        uint256 targetHealthFactor; // WAD; desired post-rescue HF
        uint256 maxTotalRepay; // cumulative repayment cap (debt-asset units)
        uint256 maxRepayPerAction; // per-rescue cap (debt-asset units)
        uint256 maxTotalFees; // cumulative fee cap (debt-asset units)
        uint16 maxSlippageBps; // max swap slippage for flash path
        uint16 maxFeeBps; // max fee (solver premium or flash premium) per action, in bps of principal
        uint8 allowedPaths; // bitmask of PATH_*
        bool allowPartial; // allow partial rescue when target unreachable
        uint64 expiry; // unix timestamp
        uint32 cooldown; // seconds between rescues
        uint256 nonce; // must equal owner's current registry nonce
        bytes32 solversHash; // keccak256(abi.encodePacked(address[] allowedSolvers)); empty list => no solvers
        bytes32 recipientsHash; // keccak256(abi.encodePacked(address[] allowedRecipients))
    }

    /// @notice Mutable state of a policy across versions. Spending counters persist across version replacement.
    struct PolicyState {
        uint64 version;
        PolicyStatus status;
        uint64 lastActionAt;
        uint64 pausedAt;
        uint256 totalRepaid;
        uint256 totalFees;
    }

    /// @notice Lending position snapshot returned by adapters. All "Base" values are in the market oracle base currency.
    struct Position {
        uint256 totalCollateralBase;
        uint256 totalDebtBase;
        uint256 currentLiquidationThreshold; // bps, weighted average
        uint256 healthFactor; // WAD
        uint256 debtAmount; // debt-asset units owed by account for `debtAsset`
        uint256 collateralAmount; // collateral-asset units supplied by account for `collateralAsset`
        uint256 debtPrice; // oracle base units per 1 whole debt token
        uint256 collateralPrice; // oracle base units per 1 whole collateral token
        uint8 debtDecimals;
        uint8 collateralDecimals;
        uint256 collateralLiquidationThreshold; // bps for collateralAsset
    }

    /// @notice A rescue request delivered by the callback router to an executor.
    struct RescueRequest {
        bytes32 rescueId;
        bytes32 policyId;
        uint64 policyVersion;
        bytes32 originEventId;
        uint64 observedAt;
    }

    /// @notice Result reported by an executor after a successful rescue.
    struct RescueResult {
        uint8 path;
        uint256 repaid; // actual debt-asset units spent on repayment
        uint256 fee; // fee charged (flash premium or solver premium)
        uint256 debtBefore;
        uint256 debtAfter;
        uint256 healthFactorBefore;
        uint256 healthFactorAfter;
        address solver; // zero for flash path
        bytes32 commitmentId; // zero for flash path
    }

    function rescueIdOf(bytes32 originEventId, bytes32 policyId, uint64 version) internal pure returns (bytes32) {
        return keccak256(abi.encode(originEventId, policyId, version));
    }
}
