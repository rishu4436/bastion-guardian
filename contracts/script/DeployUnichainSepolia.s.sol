// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { console2 } from "forge-std/Script.sol";
import { IPayable } from "@reactive/src/interfaces/IPayable.sol";
import { BastionDeployBase } from "./BastionDeployBase.sol";

/// @notice STEP 3 (Unichain Sepolia, chain 1301): reserve stack — EmergencyControl → ProtectionVault →
///         CrossChainReserveEscrow(official Callback Proxy, ReactiveCore). Trusts only the destination
///         SolverRescueExecutor given in DEST_SOLVER_EXECUTOR.
/// @dev forge script script/DeployUnichainSepolia.s.sol --rpc-url unichain_sepolia --account <keystore> --broadcast
///      Required env: REACTIVE_CORE_ADDRESS, DEST_SOLVER_EXECUTOR, RESERVE_TOKENS (comma-separated addresses).
contract DeployUnichainSepolia is BastionDeployBase {
    function run() external {
        _requireAllowedChain(UNICHAIN_SEPOLIA);
        _requireAuthorizedIfLive();
        address core = vm.envAddress("REACTIVE_CORE_ADDRESS");
        address destSolverExec = vm.envAddress("DEST_SOLVER_EXECUTOR");
        address[] memory tokens = vm.envAddress("RESERVE_TOKENS", ",");
        uint64 releaseDelay = uint64(vm.envOr("RESERVE_RELEASE_DELAY", uint256(1 hours)));
        uint256 callbackFunding = vm.envOr("CALLBACK_FUNDING_WEI", uint256(0));

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        ReserveStack memory r =
            _deployReserve(deployer, IPayable(payable(UNICHAIN_SEPOLIA_CALLBACK_PROXY)), core, releaseDelay);
        for (uint256 i; i < tokens.length; ++i) {
            r.vault.setSupportedToken(tokens[i], true);
        }
        r.escrow.setTrustedExecutor(BASE_SEPOLIA, destSolverExec, true);
        if (callbackFunding > 0) {
            (bool ok,) = payable(address(r.escrow)).call{ value: callbackFunding }("");
            require(ok, "fund escrow");
        }
        vm.stopBroadcast();

        console2.log("BastionEmergencyControl ", address(r.emergency));
        console2.log("BastionProtectionVault  ", address(r.vault));
        console2.log("CrossChainReserveEscrow ", address(r.escrow));
        string memory k = "reserve";
        vm.serializeString(k, "mode", _mode());
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeAddress(k, "emergency", address(r.emergency));
        vm.serializeAddress(k, "protectionVault", address(r.vault));
        string memory json = vm.serializeAddress(k, "reserveEscrow", address(r.escrow));
        vm.writeJson(json, _outPath("reserve"));
    }
}
