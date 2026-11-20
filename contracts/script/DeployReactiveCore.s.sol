// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { console2 } from "forge-std/Script.sol";
import { BastionDeployBase } from "./BastionDeployBase.sol";
import { BastionReactiveCore } from "../src/reactive/BastionReactiveCore.sol";

/// @notice STEP 1 (Reactive Lasna, chain 5318007): deploy BastionReactiveCore with nothing subscribed.
/// @dev Requires explicit owner authorization (BASTION_DEPLOY_AUTHORIZED=true) and an encrypted keystore account:
///      forge script script/DeployReactiveCore.s.sol --rpc-url lasna --account <keystore> --broadcast
///      Never run with --broadcast until the owner has authorized Phase 3.
contract DeployReactiveCore is BastionDeployBase {
    function run() external returns (BastionReactiveCore core) {
        _requireAllowedChain(LASNA);
        _requireAuthorizedIfLive();
        uint256 initialFunding = vm.envOr("REACTIVE_CORE_INITIAL_FUNDING_WEI", uint256(0));
        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        core = _deployReactiveCore(deployer);
        if (initialFunding > 0) {
            (bool ok,) = payable(address(core)).call{ value: initialFunding }("");
            require(ok, "fund core");
        }
        vm.stopBroadcast();
        console2.log("BastionReactiveCore", address(core));
        console2.log("Next: set REACTIVE_CORE_ADDRESS and run DeployBaseSepolia + DeployUnichainSepolia.");
    }
}
