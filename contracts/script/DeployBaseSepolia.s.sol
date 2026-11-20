// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { console2 } from "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IPayable } from "@reactive/src/interfaces/IPayable.sol";
import { BastionDeployBase } from "./BastionDeployBase.sol";
import { AaveV3LendingAdapter } from "../src/adapters/AaveV3LendingAdapter.sol";

/// @notice STEP 2 (Base Sepolia, chain 84532): destination stack wired to the official Callback Proxy and the
///         already-deployed BastionReactiveCore (callback sender is immutable, hence the order).
///         Deploys the real AaveV3LendingAdapter against the official Aave V3 Base Sepolia Pool and, when
///         DEPLOY_FIXTURE_MARKET=true, the clearly-labeled BASTION fixture market + its own adapter for controlled demos.
/// @dev forge script script/DeployBaseSepolia.s.sol --rpc-url base_sepolia --account <keystore> --broadcast
///      Required env: REACTIVE_CORE_ADDRESS. Optional: DEPLOY_FIXTURE_MARKET, SOLVER_MIN_BOND, SOLVER_EXIT_DELAY,
///      OBSERVER_MIN_INTERVAL, CALLBACK_FUNDING_WEI, BASTION_GOVERNANCE, BASTION_GUARDIAN.
contract DeployBaseSepolia is BastionDeployBase {
    function run() external {
        _requireAllowedChain(BASE_SEPOLIA);
        _requireAuthorizedIfLive();
        address core = vm.envAddress("REACTIVE_CORE_ADDRESS");
        bool withFixture = vm.envOr("DEPLOY_FIXTURE_MARKET", true);
        uint256 minBond = vm.envOr("SOLVER_MIN_BOND", uint256(100e6));
        uint64 exitDelay = uint64(vm.envOr("SOLVER_EXIT_DELAY", uint256(1 days)));
        uint64 minInterval = uint64(vm.envOr("OBSERVER_MIN_INTERVAL", uint256(10)));
        uint256 callbackFunding = vm.envOr("CALLBACK_FUNDING_WEI", uint256(0));
        address guardian = vm.envOr("BASTION_GUARDIAN", address(0));

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        AaveV3LendingAdapter aave = _deployAaveAdapter(deployer, AAVE_BASE_SEPOLIA_POOL, AAVE_BASE_SEPOLIA_ORACLE);
        FixtureMarket memory f;
        address bondToken = AAVE_BASE_SEPOLIA_USDC;
        if (withFixture) {
            f = _deployFixtureMarket(deployer);
            bondToken = address(f.usdc);
        }
        DestinationStack memory d = _deployDestination(
            deployer,
            IPayable(payable(BASE_SEPOLIA_CALLBACK_PROXY)),
            core,
            IERC20(bondToken),
            minBond,
            exitDelay,
            minInterval
        );
        _enableAdapter(d, aave);
        if (withFixture) {
            _enableAdapter(d, f.adapter);
            d.flashExec.setVenue(address(f.venue), true, true);
        }
        if (guardian != address(0)) d.emergency.setGuardian(guardian, true);
        if (callbackFunding > 0) {
            (bool ok,) = payable(address(d.router)).call{ value: callbackFunding }("");
            require(ok, "fund router");
        }
        vm.stopBroadcast();

        _logDestination(d);
        console2.log("AaveV3LendingAdapter (official Aave V3 Base Sepolia)", address(aave));
        if (withFixture) {
            console2.log("FIXTURE market (BASTION test fixture, not Aave)", address(f.market));
            console2.log("FIXTURE adapter", address(f.adapter));
            console2.log("FIXTURE venue", address(f.venue));
            console2.log("FIXTURE oracle", address(f.oracle));
            console2.log("FIXTURE fUSDC", address(f.usdc));
            console2.log("FIXTURE fWETH", address(f.weth));
        }
        _writeDestinationJson(_outPath("destination"), d, address(aave));
    }
}
