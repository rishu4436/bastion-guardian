// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { console2 } from "forge-std/Script.sol";
import { BastionDeployBase } from "./BastionDeployBase.sol";
import { BastionReactiveCore } from "../src/reactive/BastionReactiveCore.sol";

/// @notice STEP 4 (Reactive Lasna): register the three origin sources, the three callback destinations and (only when
///         ACTIVATE_SUBSCRIPTIONS=true) subscribe. Subscriptions consume REACT; fund the core first (step 5 covers the
///         destination callback contracts' Reactive debt via their `coverDebt()`).
/// @dev forge script script/ConfigureReactiveCore.s.sol --rpc-url lasna --account <keystore> --broadcast
///      Required env: REACTIVE_CORE_ADDRESS, DEST_RISK_OBSERVER, DEST_SOLVER_EXECUTOR, DEST_CALLBACK_ROUTER, RESERVE_ESCROW.
///      Optional: CORE_FUNDING_WEI (REACT sent to the core before subscribing).
contract ConfigureReactiveCore is BastionDeployBase {
    function run() external {
        _requireAllowedChain(LASNA);
        _requireAuthorizedIfLive();
        BastionReactiveCore core = BastionReactiveCore(payable(vm.envAddress("REACTIVE_CORE_ADDRESS")));
        bool activate = vm.envOr("ACTIVATE_SUBSCRIPTIONS", false);
        uint256 funding = vm.envOr("CORE_FUNDING_WEI", uint256(0));
        vm.startBroadcast();
        if (funding > 0) {
            (bool ok,) = payable(address(core)).call{ value: funding }("");
            require(ok, "fund core");
        }
        _configureCore(
            core,
            BASE_SEPOLIA,
            vm.envAddress("DEST_RISK_OBSERVER"),
            vm.envAddress("DEST_SOLVER_EXECUTOR"),
            vm.envAddress("DEST_CALLBACK_ROUTER"),
            UNICHAIN_SEPOLIA,
            vm.envAddress("RESERVE_ESCROW"),
            activate
        );
        vm.stopBroadcast();
        console2.log("sources", core.sourceCount());
        console2.log("subscriptions activated", activate);
    }
}
