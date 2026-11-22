// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { console2 } from "forge-std/Script.sol";
import { BastionDeployBase } from "./BastionDeployBase.sol";
import { BastionTypes } from "../src/libraries/BastionTypes.sol";
import { BastionPolicyRegistry } from "../src/policies/BastionPolicyRegistry.sol";
import { BastionProtectionVault } from "../src/vaults/BastionProtectionVault.sol";
import { SolverRegistry } from "../src/solvers/SolverRegistry.sol";
import { SolverLiquidityVault } from "../src/solvers/SolverLiquidityVault.sol";
import { FixtureToken } from "../src/fixtures/FixtureToken.sol";

/// @notice TESTNET ONLY. Live solver-funded rescue + cross-chain settlement demo on the labeled BASTION FIXTURE market.
///         Three steps, each run (simulated, then broadcast) with the signer named below:
///           1. SolverSetupBaseDeployer   (Base Sepolia, deployer): small gas + fUSDC fixture inventory to the solver,
///              replace the flash-only demo policy with version 2 (solver-only, allows exactly that solver).
///           2. SolverSetupUnichainDeployer (Unichain Sepolia, deployer): small gas to the solver, mint frUSDC fixture,
///              deposit it in the ProtectionVault and allocate the reserve budget for the solver policy.
///           3. SolverSetupBaseSolver     (Base Sepolia, solver): register (fUSDC bond), deposit liquidity, commit it.
///         fUSDC / frUSDC are owner-mintable test fixtures, not real assets.

contract SolverSetupBaseDeployer is BastionDeployBase {
    function run() external {
        _requireAllowedChain(BASE_SEPOLIA);
        _requireAuthorizedIfLive();
        BastionPolicyRegistry policies = BastionPolicyRegistry(vm.envAddress("POLICY_REGISTRY"));
        address solver = vm.envAddress("SOLVER_ADDRESS");
        FixtureToken usdc = FixtureToken(vm.envAddress("FUSDC"));
        uint256 gasWei = vm.envUint("SOLVER_GAS_WEI");

        vm.startBroadcast();
        address me = msg.sender;
        (bool ok,) = payable(solver).call{ value: gasWei }("");
        require(ok, "gas transfer");
        usdc.mint(solver, 20_000e6);
        // Same owner/account/adapter/market/assets => same policyId: this atomically replaces the flash-only demo
        // policy with version 2 (solver-only). Cumulative spend carries over, so the total caps are raised.
        address[] memory solvers = new address[](1);
        solvers[0] = solver;
        BastionTypes.Policy memory p = BastionTypes.Policy({
            owner: me,
            account: me,
            sourceChainId: UNICHAIN_SEPOLIA,
            destChainId: block.chainid,
            adapter: vm.envAddress("FIXTURE_ADAPTER"),
            market: vm.envAddress("FIXTURE_MARKET"),
            debtAsset: address(usdc),
            collateralAsset: vm.envAddress("FWETH"),
            triggerHealthFactor: 1.25e18,
            targetHealthFactor: 1.5e18,
            maxTotalRepay: 20_000e6,
            maxRepayPerAction: 6000e6,
            maxTotalFees: 400e6,
            maxSlippageBps: 200,
            maxFeeBps: 100,
            allowedPaths: BastionTypes.PATH_SOLVER,
            allowPartial: false,
            expiry: uint64(block.timestamp + 30 days),
            cooldown: 0,
            nonce: policies.nonces(me),
            solversHash: keccak256(abi.encodePacked(solvers)),
            recipientsHash: keccak256(abi.encodePacked(new address[](0)))
        });
        (bytes32 policyId, uint64 version) = policies.registerPolicy(p, solvers, new address[](0), "");
        vm.stopBroadcast();
        console2.log("solverPolicyId", vm.toString(policyId));
        console2.log("version", version);
    }
}

contract SolverSetupUnichainDeployer is BastionDeployBase {
    function run() external {
        _requireAllowedChain(UNICHAIN_SEPOLIA);
        _requireAuthorizedIfLive();
        BastionProtectionVault vault = BastionProtectionVault(vm.envAddress("PROTECTION_VAULT"));
        FixtureToken frUsdc = FixtureToken(vm.envAddress("FRUSDC"));
        bytes32 policyId = vm.envBytes32("SOLVER_POLICY_ID");
        address solver = vm.envAddress("SOLVER_ADDRESS");
        uint256 gasWei = vm.envUint("SOLVER_GAS_WEI");

        vm.startBroadcast();
        (bool ok,) = payable(solver).call{ value: gasWei }("");
        require(ok, "gas transfer");
        frUsdc.mint(msg.sender, 10_200e6);
        frUsdc.approve(address(vault), 10_200e6);
        vault.deposit(address(frUsdc), 10_200e6);
        vault.allocate(policyId, address(frUsdc), 10_000e6, 200e6, 100);
        vm.stopBroadcast();
        console2.log("budget allocated for", vm.toString(policyId));
    }
}

contract SolverSetupBaseSolver is BastionDeployBase {
    function run() external {
        _requireAllowedChain(BASE_SEPOLIA);
        _requireAuthorizedIfLive();
        SolverRegistry registry = SolverRegistry(vm.envAddress("SOLVER_REGISTRY"));
        SolverLiquidityVault liquidity = SolverLiquidityVault(vm.envAddress("SOLVER_LIQUIDITY_VAULT"));
        FixtureToken usdc = FixtureToken(vm.envAddress("FUSDC"));
        bytes32 policyId = vm.envBytes32("SOLVER_POLICY_ID");

        vm.startBroadcast();
        address me = msg.sender;
        usdc.approve(address(registry), 100e6);
        usdc.approve(address(liquidity), 15_000e6);
        // Payout = the solver's own address; reimbursement arrives in frUSDC on Unichain Sepolia.
        registry.register(me, 100e6, "testnet://bastion-solver-1");
        liquidity.deposit(address(usdc), 15_000e6);
        bytes32 commitmentId = liquidity.commit(policyId, address(usdc), 8000e6, 50, uint64(block.timestamp + 1 days));
        vm.stopBroadcast();
        console2.log("commitmentId", vm.toString(commitmentId));
    }
}
