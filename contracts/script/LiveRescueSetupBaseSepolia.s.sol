// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { console2 } from "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { BastionDeployBase } from "./BastionDeployBase.sol";
import { BastionTypes } from "../src/libraries/BastionTypes.sol";
import { BastionPolicyRegistry } from "../src/policies/BastionPolicyRegistry.sol";
import { FixtureToken } from "../src/fixtures/FixtureToken.sol";
import { FixtureLendingMarket } from "../src/fixtures/FixtureLendingMarket.sol";
import { AaveV3LendingAdapter } from "../src/adapters/AaveV3LendingAdapter.sol";

/// @title LiveRescueSetupBaseSepolia
/// @notice TESTNET ONLY (Base Sepolia). Prepares a controlled live flash-rescue demo on the clearly-labeled BASTION
///         FIXTURE market (fUSDC / fWETH are owner-mintable test tokens, NOT real assets). The single deployer acts as
///         liquidity provider and borrower: supplies fUSDC liquidity, stocks the fixture venue, opens a 10 fWETH /
///         13,000 fUSDC position (HF ≈ 1.3077), registers a flash-only policy (trigger 1.25, target 1.5) and grants a
///         bounded 5 fWETH aToken approval + pull cap. The Reactive policy mirror is set separately on Lasna.
/// @dev Required env: BASTION_DEPLOY_AUTHORIZED=true, POLICY_REGISTRY, FIXTURE_MARKET, FIXTURE_ADAPTER, FIXTURE_VENUE,
///      FUSDC, FWETH.
contract LiveRescueSetupBaseSepolia is BastionDeployBase {
    address internal constant FIXTURE_LP = address(uint160(uint256(keccak256("bastion.fixture.lp"))));

    function run() external {
        _requireAllowedChain(BASE_SEPOLIA);
        _requireAuthorizedIfLive();
        BastionPolicyRegistry policies = BastionPolicyRegistry(vm.envAddress("POLICY_REGISTRY"));
        FixtureLendingMarket market = FixtureLendingMarket(vm.envAddress("FIXTURE_MARKET"));
        AaveV3LendingAdapter adapter = AaveV3LendingAdapter(vm.envAddress("FIXTURE_ADAPTER"));
        address venue = vm.envAddress("FIXTURE_VENUE");
        FixtureToken usdc = FixtureToken(vm.envAddress("FUSDC"));
        FixtureToken weth = FixtureToken(vm.envAddress("FWETH"));

        vm.startBroadcast();
        address me = msg.sender;
        usdc.mint(me, 500_000e6);
        usdc.mint(venue, 1_000_000e6);
        weth.mint(me, 10e18);
        usdc.approve(address(market), type(uint256).max);
        // Liquidity is credited to a dedicated keyless FIXTURE LP address so it does not count as the borrower's
        // collateral (it stays permanently in the fixture market as fixture-only fUSDC liquidity).
        market.supply(address(usdc), 500_000e6, FIXTURE_LP, 0);
        weth.approve(address(market), type(uint256).max);
        market.supply(address(weth), 10e18, me, 0);
        market.borrow(address(usdc), 13_000e6, 2, 0, me); // HF = 20000*0.85/13000 ≈ 1.3077

        BastionTypes.Policy memory p = BastionTypes.Policy({
            owner: me,
            account: me,
            sourceChainId: block.chainid,
            destChainId: block.chainid,
            adapter: address(adapter),
            market: address(market),
            debtAsset: address(usdc),
            collateralAsset: address(weth),
            triggerHealthFactor: 1.25e18,
            targetHealthFactor: 1.5e18,
            maxTotalRepay: 10_000e6,
            maxRepayPerAction: 8000e6,
            maxTotalFees: 200e6,
            maxSlippageBps: 200,
            maxFeeBps: 100,
            allowedPaths: BastionTypes.PATH_FLASH,
            allowPartial: false,
            expiry: uint64(block.timestamp + 30 days),
            cooldown: 0,
            nonce: policies.nonces(me),
            solversHash: keccak256(abi.encodePacked(new address[](0))),
            recipientsHash: keccak256(abi.encodePacked(new address[](0)))
        });
        (bytes32 policyId, uint64 version) = policies.registerPolicy(p, new address[](0), new address[](0), "");
        IERC20(market.getReserveAToken(address(weth))).approve(address(adapter), 5e18);
        adapter.setCollateralPullCap(address(weth), 5e18, true);
        vm.stopBroadcast();

        console2.log("policyId", vm.toString(policyId));
        console2.log("version", version);
        console2.log("healthFactor", adapter.getHealthFactor(me));
        console2.log("fixtureLp", FIXTURE_LP);
    }
}
