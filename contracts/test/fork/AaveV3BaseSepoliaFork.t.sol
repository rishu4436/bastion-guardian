// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IPayable } from "@reactive/src/interfaces/IPayable.sol";
import { IAaveV3Pool, IAaveV3Oracle } from "../../src/interfaces/IAaveV3.sol";
import { BastionTypes } from "../../src/libraries/BastionTypes.sol";
import { BastionEmergencyControl } from "../../src/governance/BastionEmergencyControl.sol";
import { BastionPolicyRegistry } from "../../src/policies/BastionPolicyRegistry.sol";
import { AaveV3LendingAdapter } from "../../src/adapters/AaveV3LendingAdapter.sol";
import { RescueSettlementLedger } from "../../src/settlement/RescueSettlementLedger.sol";
import { RescueReceiptRegistry } from "../../src/settlement/RescueReceiptRegistry.sol";
import { SolverRegistry } from "../../src/solvers/SolverRegistry.sol";
import { SolverLiquidityVault } from "../../src/solvers/SolverLiquidityVault.sol";
import { SolverQuoteManager } from "../../src/solvers/SolverQuoteManager.sol";
import { SolverRescueExecutor } from "../../src/rescue/SolverRescueExecutor.sol";
import { FlashRescueExecutor } from "../../src/rescue/FlashRescueExecutor.sol";
import { BastionCallbackRouter } from "../../src/callbacks/BastionCallbackRouter.sol";
import { IBastionExecutor } from "../../src/interfaces/IBastionExecutor.sol";
import { FixtureOracle } from "../../src/fixtures/FixtureOracle.sol";
import { FixtureSwapVenue } from "../../src/fixtures/FixtureSwapVenue.sol";

/// @notice LOCAL FORK SIMULATION against the official Aave V3 Base Sepolia deployment (aave-dao/aave-address-book).
///         Nothing is broadcast. Runs only when BASE_SEPOLIA_RPC_URL is set. Token balances are created with
///         Foundry `deal` on the fork (cheatcode, not a real faucet). The swap venue is the labeled fixture venue
///         priced from the real Aave oracle, because public Base Sepolia DEX liquidity for Aave test assets is thin.
contract AaveV3BaseSepoliaForkTest is Test {
    IAaveV3Pool internal constant POOL = IAaveV3Pool(0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27);
    IAaveV3Oracle internal constant ORACLE = IAaveV3Oracle(0x943b0dE18d4abf4eF02A85912F8fc07684C141dF);
    address internal constant USDC = 0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f;
    address internal constant WETH = 0x4200000000000000000000000000000000000006;
    address internal constant CALLBACK_PROXY = 0x476F44b11F5C942c58f4c8E3d0300E5710743585;

    bool internal enabled;
    address internal borrower = makeAddr("forkBorrower");
    address internal solver = makeAddr("forkSolver");
    address internal gov = makeAddr("forkGov");

    AaveV3LendingAdapter internal adapter;
    BastionPolicyRegistry internal policies;
    SolverLiquidityVault internal liquidity;
    SolverRegistry internal solvers;
    BastionCallbackRouter internal router;
    FlashRescueExecutor internal flashExec;
    RescueSettlementLedger internal ledger;
    FixtureSwapVenue internal venue;

    function setUp() public {
        string memory rpc = vm.envOr("BASE_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        uint256 forkBlock = vm.envOr("BASE_SEPOLIA_FORK_BLOCK", uint256(0));
        if (forkBlock == 0) vm.createSelectFork(rpc);
        else vm.createSelectFork(rpc, forkBlock);
        enabled = true;
        assertEq(block.chainid, 84_532);

        vm.startPrank(gov);
        BastionEmergencyControl emergency = new BastionEmergencyControl(gov, 1);
        policies = new BastionPolicyRegistry(gov, emergency);
        adapter = new AaveV3LendingAdapter(POOL, ORACLE, keccak256("AAVE_V3_BASE_SEPOLIA"), gov);
        policies.setAdapter(address(adapter), true);
        ledger = new RescueSettlementLedger(gov);
        RescueReceiptRegistry receipts = new RescueReceiptRegistry(gov);
        solvers = new SolverRegistry(IERC20(USDC), 0, 1 days, gov);
        liquidity = new SolverLiquidityVault(solvers, emergency, gov);
        SolverQuoteManager quotes = new SolverQuoteManager(liquidity, solvers, policies);
        SolverRescueExecutor solverExec =
            new SolverRescueExecutor(policies, ledger, receipts, solvers, liquidity, quotes, gov);
        flashExec = new FlashRescueExecutor(policies, ledger, receipts, gov);
        router = new BastionCallbackRouter(
            IPayable(payable(CALLBACK_PROXY)), address(0xC0DE), policies, ledger, receipts, emergency, gov
        );
        router.setExecutors(IBastionExecutor(address(flashExec)), IBastionExecutor(address(solverExec)));
        solverExec.setRouter(address(router));
        flashExec.setRouter(address(router));
        policies.setExecutor(address(solverExec), true);
        policies.setExecutor(address(flashExec), true);
        liquidity.setExecutor(address(solverExec), true);
        solvers.setRecorder(address(solverExec), true);
        adapter.setCollateralOperator(address(flashExec), true);
        ledger.setWriter(address(router), true);
        ledger.setWriter(address(solverExec), true);
        ledger.setWriter(address(flashExec), true);
        receipts.setWriter(address(solverExec), true);
        receipts.setWriter(address(flashExec), true);
        receipts.setWriter(address(router), true);

        FixtureOracle fo = new FixtureOracle(gov);
        fo.setAssetPrice(WETH, ORACLE.getAssetPrice(WETH));
        fo.setAssetPrice(USDC, ORACLE.getAssetPrice(USDC));
        venue = new FixtureSwapVenue(fo, gov);
        venue.setExecutionCostBps(30);
        flashExec.setVenue(address(venue), true, true);
        vm.stopPrank();
        deal(USDC, address(venue), 1_000_000e6);

        // Real Aave position: supply 2 WETH, borrow ~78% of collateral value in USDC.
        deal(WETH, borrower, 2e18);
        vm.startPrank(borrower);
        IERC20(WETH).approve(address(POOL), type(uint256).max);
        POOL.supply(WETH, 2e18, borrower, 0);
        (uint256 tc,,,,,) = POOL.getUserAccountData(borrower);
        uint256 borrowUsdc = tc * 78 / 100 * 1e6 / ORACLE.getAssetPrice(USDC);
        POOL.borrow(USDC, borrowUsdc, 2, 0, borrower);
        vm.stopPrank();
    }

    function _policy(uint8 paths) internal returns (bytes32 id, uint64 v) {
        address[] memory s = new address[](1);
        s[0] = solver;
        address[] memory r = new address[](0);
        BastionTypes.Policy memory p = BastionTypes.Policy({
            owner: borrower,
            account: borrower,
            sourceChainId: 1301,
            destChainId: 84_532,
            adapter: address(adapter),
            market: address(POOL),
            debtAsset: USDC,
            collateralAsset: WETH,
            // Aave's oracle cannot be moved on testnet, so "risk" is defined by a conservative user threshold.
            triggerHealthFactor: 1.3e18,
            targetHealthFactor: 1.45e18,
            maxTotalRepay: 5000e6,
            maxRepayPerAction: 5000e6,
            maxTotalFees: 100e6,
            maxSlippageBps: 100,
            maxFeeBps: 100,
            allowedPaths: paths,
            allowPartial: false,
            expiry: uint64(block.timestamp + 1 days),
            cooldown: 0,
            nonce: policies.nonces(borrower),
            solversHash: keccak256(abi.encodePacked(s)),
            recipientsHash: keccak256(abi.encodePacked(r))
        });
        vm.prank(borrower);
        (id, v) = policies.registerPolicy(p, s, r, "");
    }

    function test_fork_adapterReadsRealAavePosition() public {
        if (!enabled) return vm.skip(true);
        BastionTypes.Position memory pos = adapter.getPosition(borrower, WETH, USDC);
        (,,,,, uint256 hf) = POOL.getUserAccountData(borrower);
        assertEq(pos.healthFactor, hf);
        assertGt(pos.debtAmount, 0);
        assertApproxEqAbs(pos.collateralAmount, 2e18, 10, "aToken ray rounding");
        assertEq(pos.debtDecimals, 6);
        assertEq(pos.collateralDecimals, 18);
        assertEq(pos.collateralLiquidationThreshold, 8500);
        assertEq(adapter.flashPremiumBps(), 5);
        (bool ok,) = adapter.validateRescue(borrower, WETH, USDC);
        assertTrue(ok);
    }

    function test_fork_solverRescueRepaysRealAaveDebt() public {
        if (!enabled) return vm.skip(true);
        (bytes32 id,) = _policy(BastionTypes.PATH_SOLVER);
        deal(USDC, solver, 20_000e6);
        vm.startPrank(solver);
        IERC20(USDC).approve(address(solvers), type(uint256).max);
        IERC20(USDC).approve(address(liquidity), type(uint256).max);
        solvers.register(solver, 0, "fork");
        liquidity.deposit(USDC, 10_000e6);
        liquidity.commit(id, USDC, 5000e6, 50, uint64(block.timestamp + 1 hours));
        vm.stopPrank();

        uint256 debtBefore = adapter.getDebt(borrower, USDC);
        (,,,,, uint256 hfBefore) = POOL.getUserAccountData(borrower);
        vm.prank(borrower);
        bytes32 rescueId = router.requestManualRescue(id);
        uint256 debtAfter = adapter.getDebt(borrower, USDC);
        (,,,,, uint256 hfAfter) = POOL.getUserAccountData(borrower);
        assertLt(debtAfter, debtBefore, "real Aave debt reduced");
        assertGt(hfAfter, hfBefore);
        assertGe(hfAfter, 1.45e18);
        assertEq(uint8(ledger.stateOf(rescueId)), uint8(RescueSettlementLedger.State.SettlementPending));
        emit log_named_uint("fork block", block.number);
        emit log_named_uint("debt before (USDC 6dp)", debtBefore);
        emit log_named_uint("debt after  (USDC 6dp)", debtAfter);
        emit log_named_uint("HF before", hfBefore);
        emit log_named_uint("HF after", hfAfter);
    }

    function test_fork_flashRescueUsesRealAaveFlashLoan() public {
        if (!enabled) return vm.skip(true);
        (bytes32 id,) = _policy(BastionTypes.PATH_FLASH);
        address aToken = POOL.getReserveAToken(WETH);
        (bool feasible, bytes32 reason) = flashExec.isFeasible(id);
        assertFalse(feasible, "no aToken allowance => unavailable");
        assertEq(reason, bytes32("COLLATERAL_NOT_AUTHORIZED"));
        vm.prank(borrower);
        IERC20(aToken).approve(address(adapter), type(uint256).max);
        (feasible, reason) = flashExec.isFeasible(id);
        assertTrue(feasible, string(abi.encodePacked(reason)));

        uint256 debtBefore = adapter.getDebt(borrower, USDC);
        uint256 collBefore = adapter.getCollateral(borrower, WETH);
        (,,,,, uint256 hfBefore) = POOL.getUserAccountData(borrower);
        vm.prank(borrower);
        bytes32 rescueId = router.requestManualRescue(id);
        (,,,,, uint256 hfAfter) = POOL.getUserAccountData(borrower);
        assertLt(adapter.getDebt(borrower, USDC), debtBefore, "real Aave debt reduced via flash loan");
        assertLt(adapter.getCollateral(borrower, WETH), collBefore);
        assertGt(hfAfter, hfBefore);
        assertEq(IERC20(USDC).balanceOf(address(flashExec)), 0);
        assertEq(uint8(ledger.stateOf(rescueId)), uint8(RescueSettlementLedger.State.DestinationExecuted));
        emit log_named_uint("HF before", hfBefore);
        emit log_named_uint("HF after", hfAfter);
    }
}
