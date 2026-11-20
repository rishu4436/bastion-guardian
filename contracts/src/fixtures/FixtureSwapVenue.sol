// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { ISwapVenue } from "../interfaces/ISwapVenue.sol";
import { FixtureOracle } from "./FixtureOracle.sol";

/// @title FixtureSwapVenue — BASTION TEST FIXTURE, NOT A REAL DEX
/// @notice Inventory-backed swap venue that fills at the fixture oracle price minus a configurable execution cost.
///         Used to make FlashNet scenarios deterministic. Can be set to "malicious" mode for adversarial tests.
contract FixtureSwapVenue is ISwapVenue, Ownable {
    using SafeERC20 for IERC20;

    string public constant FIXTURE_LABEL = "BASTION TEST FIXTURE SWAP VENUE - NOT A REAL DEX";
    FixtureOracle public immutable ORACLE;
    uint256 public executionCostBps; // simulated price impact
    bool public malicious; // returns less than promised (ignores minOut) to test executor checks

    constructor(FixtureOracle oracle_, address owner_) Ownable(owner_) {
        ORACLE = oracle_;
    }

    function venueId() external pure returns (bytes32) {
        return keccak256("BASTION_FIXTURE_SWAP_VENUE");
    }

    function setExecutionCostBps(uint256 bps) external onlyOwner {
        require(bps < 10_000, "BPS");
        executionCostBps = bps;
    }

    function setMalicious(bool m) external onlyOwner {
        malicious = m;
    }

    function quote(address tokenIn, address tokenOut, uint256 amountIn) public view returns (uint256) {
        uint256 pIn = ORACLE.getAssetPrice(tokenIn);
        uint256 pOut = ORACLE.getAssetPrice(tokenOut);
        uint8 dIn = IERC20Metadata(tokenIn).decimals();
        uint8 dOut = IERC20Metadata(tokenOut).decimals();
        uint256 valueBase = Math.mulDiv(amountIn, pIn, 10 ** dIn);
        uint256 gross = Math.mulDiv(valueBase, 10 ** dOut, pOut);
        return gross * (10_000 - executionCostBps) / 10_000;
    }

    function swapExactIn(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, address recipient)
        external
        returns (uint256 amountOut)
    {
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        amountOut = quote(tokenIn, tokenOut, amountIn);
        if (malicious) {
            amountOut = amountOut / 2;
        } else {
            require(amountOut >= minAmountOut, "SLIPPAGE");
        }
        IERC20(tokenOut).safeTransfer(recipient, amountOut);
    }
}
