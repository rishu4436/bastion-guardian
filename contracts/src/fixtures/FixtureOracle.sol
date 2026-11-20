// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @title FixtureOracle — BASTION TEST FIXTURE, NOT A PRODUCTION ORACLE
/// @notice Aave-oracle-compatible (`getAssetPrice`, `BASE_CURRENCY_UNIT`) price source with update timestamps,
///         used to create deterministic, on-chain market events for controlled demonstrations.
///         Emits `PriceUpdated`, an observable origin event for Reactive subscriptions.
contract FixtureOracle is Ownable {
    string public constant FIXTURE_LABEL = "BASTION TEST FIXTURE - NOT A PRODUCTION ORACLE";
    uint256 public constant BASE_CURRENCY_UNIT = 1e8;

    struct PriceData {
        uint256 price;
        uint64 updatedAt;
    }

    mapping(address => PriceData) private _prices;

    event PriceUpdated(address indexed asset, uint256 previousPrice, uint256 newPrice, uint64 updatedAt);

    constructor(address owner_) Ownable(owner_) { }

    function setAssetPrice(address asset, uint256 price) external onlyOwner {
        uint256 prev = _prices[asset].price;
        _prices[asset] = PriceData(price, uint64(block.timestamp));
        emit PriceUpdated(asset, prev, price, uint64(block.timestamp));
    }

    function getAssetPrice(address asset) external view returns (uint256) {
        return _prices[asset].price;
    }

    function latestUpdate(address asset) external view returns (uint256 price, uint64 updatedAt) {
        PriceData memory d = _prices[asset];
        return (d.price, d.updatedAt);
    }
}
