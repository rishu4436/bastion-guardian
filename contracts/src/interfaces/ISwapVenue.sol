// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

/// @title ISwapVenue
/// @notice Allowlisted swap venue used by the FlashNet path. Pulls `amountIn` of `tokenIn` from msg.sender.
interface ISwapVenue {
    function venueId() external view returns (bytes32);
    function swapExactIn(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, address recipient)
        external
        returns (uint256 amountOut);
}
