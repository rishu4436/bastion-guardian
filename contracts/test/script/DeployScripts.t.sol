// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { Test } from "forge-std/Test.sol";
import { DeployReactiveCore } from "../../script/DeployReactiveCore.s.sol";
import { DeployBaseSepolia } from "../../script/DeployBaseSepolia.s.sol";
import { DeployUnichainSepolia } from "../../script/DeployUnichainSepolia.s.sol";
import { ConfigureReactiveCore } from "../../script/ConfigureReactiveCore.s.sol";
import { BastionReactiveCore } from "../../src/reactive/BastionReactiveCore.sol";
import { BastionCallbackRouter } from "../../src/callbacks/BastionCallbackRouter.sol";
import { CrossChainReserveEscrow } from "../../src/settlement/CrossChainReserveEscrow.sol";
import { BastionPolicyRegistry } from "../../src/policies/BastionPolicyRegistry.sol";
import { SolverRescueExecutor } from "../../src/rescue/SolverRescueExecutor.sol";
import { MockReactiveSystem } from "../mocks/MockReactiveSystem.sol";

/// @notice Exercises the four live deployment scripts in the documented order (ARCHITECTURE.md §6) inside one local
///         EVM with simulated chain ids. Nothing is broadcast; this verifies ordering, wiring and the safety guards.
contract DeployScriptsTest is Test {
    address internal constant SYSTEM_ADDR = 0x8888888888888888888888888888888888888888;

    function setUp() public {
        vm.etch(SYSTEM_ADDR, address(new MockReactiveSystem()).code);
        vm.warp(1_790_000_000);
    }

    function test_fullDeployOrderWiresEverything() public {
        vm.chainId(5_318_007);
        BastionReactiveCore core = new DeployReactiveCore().run();
        assertEq(core.sourceCount(), 0, "nothing subscribed at deploy");

        vm.chainId(84_532);
        vm.setEnv("REACTIVE_CORE_ADDRESS", vm.toString(address(core)));
        vm.setEnv("DEPLOY_FIXTURE_MARKET", "true");
        new DeployBaseSepolia().run();
        string memory dj = vm.readFile("out-evidence/dry-run/84532-destination.json");
        assertEq(vm.parseJsonString(dj, ".mode"), "DRY_RUN_SIMULATION_NOT_DEPLOYED");
        BastionCallbackRouter router = BastionCallbackRouter(payable(vm.parseJsonAddress(dj, ".callbackRouter")));
        address solverExec = vm.parseJsonAddress(dj, ".solverRescueExecutor");
        address observer = vm.parseJsonAddress(dj, ".riskObserver");
        BastionPolicyRegistry policies = BastionPolicyRegistry(vm.parseJsonAddress(dj, ".policyRegistry"));
        assertEq(router._CALLBACK_SENDER(), address(core), "router authenticates the core");
        assertEq(address(router._SERVICE_PROVIDER()), 0x476F44b11F5C942c58f4c8E3d0300E5710743585, "official proxy");
        assertTrue(policies.isExecutor(solverExec));
        assertTrue(policies.isAdapter(vm.parseJsonAddress(dj, ".adapter")), "official Aave adapter enabled");
        assertEq(SolverRescueExecutor(solverExec).router(), address(router));

        vm.chainId(1301);
        vm.setEnv("DEST_SOLVER_EXECUTOR", vm.toString(solverExec));
        vm.setEnv("RESERVE_TOKENS", "0x31d0220469e10c4E71834a79b1f276d740d3768F");
        new DeployUnichainSepolia().run();
        string memory rj = vm.readFile("out-evidence/dry-run/1301-reserve.json");
        CrossChainReserveEscrow escrow = CrossChainReserveEscrow(payable(vm.parseJsonAddress(rj, ".reserveEscrow")));
        assertEq(escrow._CALLBACK_SENDER(), address(core));
        assertEq(address(escrow._SERVICE_PROVIDER()), 0x775c9B990ADe401060B78D0e98684eEf8d2466C1, "official proxy");
        assertTrue(escrow.trustedExecutor(84_532, solverExec));

        vm.chainId(5_318_007);
        vm.setEnv("DEST_RISK_OBSERVER", vm.toString(observer));
        vm.setEnv("DEST_CALLBACK_ROUTER", vm.toString(address(router)));
        vm.setEnv("RESERVE_ESCROW", vm.toString(address(escrow)));
        vm.setEnv("ACTIVATE_SUBSCRIPTIONS", "true");
        new ConfigureReactiveCore().run();
        assertEq(core.sourceCount(), 3);
        assertEq(MockReactiveSystem(payable(SYSTEM_ADDR)).activeSubscriptions(address(core)), 3);
        BastionReactiveCore.Source memory s1 = core.getSource(1);
        assertEq(s1.emitter, solverExec);
        assertEq(s1.dataLength, 192, "SolverRescueExecuted data length incl. policyOwner");
        (uint256 cid, address rcpt,) = core.settlementDestination();
        assertEq(cid, 1301);
        assertEq(rcpt, address(escrow));
    }

    function test_scriptsRefuseWrongChain() public {
        vm.chainId(1); // Ethereum mainnet
        DeployReactiveCore s = new DeployReactiveCore();
        vm.expectRevert(bytes("BASTION: wrong chain for this script"));
        s.run();
    }
}
