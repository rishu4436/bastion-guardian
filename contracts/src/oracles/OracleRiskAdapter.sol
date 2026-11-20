// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { Ownable, Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { IAaveV3Oracle } from "../interfaces/IAaveV3.sol";

interface ITimestampedPriceSource {
    function latestUpdate(address asset) external view returns (uint256 price, uint64 updatedAt);
}

/// @title OracleRiskAdapter
/// @notice Classifies price signals so risk decisions never conflate data sources:
///         - AUTHORITATIVE: the lending market's own oracle (only this drives financial execution, via the adapter).
///         - EARLY_WARNING: an external signal (e.g. a DEX TWAP or fixture feed). It can raise an alert but never
///           redefines collateral valuation, and a contradiction with the authoritative price is flagged.
contract OracleRiskAdapter is Ownable2Step {
    enum SignalStatus {
        OK,
        STALE,
        CONTRADICTORY,
        UNAVAILABLE
    }

    struct FeedConfig {
        ITimestampedPriceSource earlyWarning; // optional
        uint64 maxAge; // seconds
        uint16 maxDeviationBps; // allowed early-warning vs authoritative deviation
    }

    IAaveV3Oracle public immutable AUTHORITATIVE;
    mapping(address => FeedConfig) public feeds;

    event FeedConfigured(address indexed asset, address earlyWarning, uint64 maxAge, uint16 maxDeviationBps);

    constructor(IAaveV3Oracle authoritative_, address owner_) Ownable(owner_) {
        AUTHORITATIVE = authoritative_;
    }

    function configureFeed(address asset, ITimestampedPriceSource earlyWarning, uint64 maxAge, uint16 maxDeviationBps)
        external
        onlyOwner
    {
        feeds[asset] = FeedConfig(earlyWarning, maxAge, maxDeviationBps);
        emit FeedConfigured(asset, address(earlyWarning), maxAge, maxDeviationBps);
    }

    /// @return status Classification of the early-warning signal relative to the authoritative oracle.
    /// @return authoritativePrice Lending-market oracle price (base currency units).
    /// @return signalPrice Early-warning price (0 if none).
    /// @return signalUpdatedAt Early-warning timestamp (0 if none).
    function assess(address asset)
        external
        view
        returns (SignalStatus status, uint256 authoritativePrice, uint256 signalPrice, uint64 signalUpdatedAt)
    {
        authoritativePrice = AUTHORITATIVE.getAssetPrice(asset);
        FeedConfig memory f = feeds[asset];
        if (authoritativePrice == 0) return (SignalStatus.UNAVAILABLE, 0, 0, 0);
        if (address(f.earlyWarning) == address(0)) return (SignalStatus.OK, authoritativePrice, 0, 0);
        try f.earlyWarning.latestUpdate(asset) returns (uint256 p, uint64 t) {
            signalPrice = p;
            signalUpdatedAt = t;
        } catch {
            return (SignalStatus.UNAVAILABLE, authoritativePrice, 0, 0);
        }
        if (signalPrice == 0) return (SignalStatus.UNAVAILABLE, authoritativePrice, 0, signalUpdatedAt);
        if (block.timestamp > uint256(signalUpdatedAt) + f.maxAge) {
            return (SignalStatus.STALE, authoritativePrice, signalPrice, signalUpdatedAt);
        }
        uint256 diff =
            signalPrice > authoritativePrice ? signalPrice - authoritativePrice : authoritativePrice - signalPrice;
        if (diff * 10_000 > authoritativePrice * f.maxDeviationBps) {
            return (SignalStatus.CONTRADICTORY, authoritativePrice, signalPrice, signalUpdatedAt);
        }
        return (SignalStatus.OK, authoritativePrice, signalPrice, signalUpdatedAt);
    }
}
