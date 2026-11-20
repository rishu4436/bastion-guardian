// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { Test } from "forge-std/Test.sol";
import { BastionTypes } from "../../src/libraries/BastionTypes.sol";
import { HealthFactorMath } from "../../src/libraries/HealthFactorMath.sol";
import { BastionPolicyRegistry } from "../../src/policies/BastionPolicyRegistry.sol";
import { BastionEmergencyControl } from "../../src/governance/BastionEmergencyControl.sol";

/// @notice Shared vectors asserted identically in packages/risk-engine/test/math.test.ts and
///         packages/sdk/test/policy.test.ts, so the TypeScript mirrors cannot silently diverge from Solidity.
contract CrossLanguageVectorsTest is Test {
    address constant REGISTRY = 0x00000000000000000000000000000000000B4571;

    function test_healthFactorVectors() public pure {
        uint256 c = 1_000_000_000_000;
        uint256 d = 800_000_000_000;
        assertEq(HealthFactorMath.healthFactor(c, d, 8500), 1_062_500_000_000_000_000);
        assertEq(HealthFactorMath.repayBaseForTarget(c, d, 8500, 1.5e18), 233_333_333_334);
        // FlashRescueExecutor cost factor for 5 bps premium + 200 bps slippage: ceil(10005*10200/1e4)+1
        uint256 k = 10_207;
        assertEq(HealthFactorMath.deleverageBaseForTarget(c, d, 8500, 8500, k, 1.5e18), 553_442_809_592);
        assertEq(HealthFactorMath.baseToTokenUp(233_333_333_334, 1e8, 6), 2_333_333_334);
        assertEq(HealthFactorMath.tokenToBase(5e18, 2000e8, 18), 1_000_000_000_000);
    }

    function test_policyDigestAndIdMatchSdk() public {
        vm.chainId(84_532);
        BastionEmergencyControl em = new BastionEmergencyControl(address(this), 1);
        deployCodeTo("BastionPolicyRegistry.sol:BastionPolicyRegistry", abi.encode(address(this), em), REGISTRY);
        BastionPolicyRegistry reg = BastionPolicyRegistry(REGISTRY);

        address[] memory solvers = new address[](1);
        solvers[0] = 0x3333333333333333333333333333333333333333;
        address[] memory recipients = new address[](1);
        recipients[0] = 0x4444444444444444444444444444444444444444;

        BastionTypes.Policy memory p = BastionTypes.Policy({
            owner: 0x1111111111111111111111111111111111111111,
            account: 0x1111111111111111111111111111111111111111,
            sourceChainId: 1301,
            destChainId: 84_532,
            adapter: 0x2222222222222222222222222222222222222222,
            market: 0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27,
            debtAsset: 0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f,
            collateralAsset: 0x4200000000000000000000000000000000000006,
            triggerHealthFactor: 1.25e18,
            targetHealthFactor: 1.5e18,
            maxTotalRepay: 10_000e6,
            maxRepayPerAction: 6000e6,
            maxTotalFees: 200e6,
            maxSlippageBps: 200,
            maxFeeBps: 100,
            allowedPaths: 3,
            allowPartial: true,
            expiry: 1_800_000_000,
            cooldown: 60,
            nonce: 0,
            solversHash: keccak256(abi.encodePacked(solvers)),
            recipientsHash: keccak256(abi.encodePacked(recipients))
        });
        assertEq(
            keccak256(abi.encodePacked(new address[](0))),
            0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470
        );
        assertEq(reg.policyIdOf(p), 0xd0480283075890a1a0f5f91d0b5cd8905f52e42dae5a8f588e4390dd6cc452ce);
        assertEq(reg.policyDigest(p), 0x185166c9c909ad3d5336f6d0bdb0e2a9e4e98caf05749f8d2436d3a30b3a3aac);
    }
}
