// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @title FixtureToken — BASTION TEST FIXTURE, NOT A REAL ASSET
/// @notice Owner-mintable ERC-20 used for local tests and clearly-labeled controlled testnet demonstrations.
contract FixtureToken is ERC20, Ownable {
    string public constant FIXTURE_LABEL = "BASTION TEST FIXTURE - NOT A REAL ASSET";
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_, address owner_)
        ERC20(name_, symbol_)
        Ownable(owner_)
    {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
