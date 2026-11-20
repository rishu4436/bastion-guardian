// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { Test, Vm } from "forge-std/Test.sol";
import { IPayable } from "@reactive/src/interfaces/IPayable.sol";
import { IReactive } from "@reactive/src/interfaces/IReactive.sol";
import { ISystemContract } from "@reactive/src/interfaces/ISystemContract.sol";
import { IAaveV3Pool, IAaveV3Oracle } from "../src/interfaces/IAaveV3.sol";
import { BastionTypes } from "../src/libraries/BastionTypes.sol";
import { BastionEmergencyControl } from "../src/governance/BastionEmergencyControl.sol";
import { BastionPolicyRegistry } from "../src/policies/BastionPolicyRegistry.sol";
import { FixtureToken } from "../src/fixtures/FixtureToken.sol";
import { FixtureOracle } from "../src/fixtures/FixtureOracle.sol";
import { FixtureLendingMarket } from "../src/fixtures/FixtureLendingMarket.sol";
import { FixtureSwapVenue } from "../src/fixtures/FixtureSwapVenue.sol";
import { AaveV3LendingAdapter } from "../src/adapters/AaveV3LendingAdapter.sol";
import { RescueSettlementLedger } from "../src/settlement/RescueSettlementLedger.sol";
import { RescueReceiptRegistry } from "../src/settlement/RescueReceiptRegistry.sol";
import { CrossChainReserveEscrow } from "../src/settlement/CrossChainReserveEscrow.sol";
import { SolverRegistry } from "../src/solvers/SolverRegistry.sol";
import { SolverLiquidityVault } from "../src/solvers/SolverLiquidityVault.sol";
import { SolverQuoteManager } from "../src/solvers/SolverQuoteManager.sol";
import { SolverRescueExecutor } from "../src/rescue/SolverRescueExecutor.sol";
import { FlashRescueExecutor } from "../src/rescue/FlashRescueExecutor.sol";
import { BastionCallbackRouter } from "../src/callbacks/BastionCallbackRouter.sol";
import { BastionProtectionVault } from "../src/vaults/BastionProtectionVault.sol";
import { BastionRiskObserver } from "../src/oracles/BastionRiskObserver.sol";
import { BastionReactiveCore } from "../src/reactive/BastionReactiveCore.sol";
import { IBastionExecutor } from "../src/interfaces/IBastionExecutor.sol";
import { MockReactiveSystem } from "./mocks/MockReactiveSystem.sol";
import { MockCallbackProxy } from "./mocks/MockCallbackProxy.sol";

/// @notice Deploys the complete BASTION stack against the labeled fixture market in one local EVM.
///         Chains are simulated: destination contracts run with chainid 84532 (Base Sepolia), reserve-chain
///         contracts are logically on 1301 (Unichain Sepolia) and the Reactive core on 5318007 (Lasna).
///         This is LOCAL SIMULATION, not testnet verification.
abstract contract BastionTestBase is Test {
    uint256 internal constant BASE_SEPOLIA = 84_532;
    uint256 internal constant UNICHAIN_SEPOLIA = 1301;
    uint256 internal constant LASNA = 5_318_007;
    address internal constant SYSTEM_ADDR = 0x8888888888888888888888888888888888888888;

    address internal gov = makeAddr("governance");
    address internal guardian = makeAddr("guardian");
    uint256 internal borrowerPk = 0xB0B;
    address internal borrower;
    address internal solver = makeAddr("solver");
    address internal solverPayout = makeAddr("solverPayout");
    address internal solver2 = makeAddr("solver2");
    address internal lp = makeAddr("lp");
    address internal attacker = makeAddr("attacker");

    FixtureToken internal usdc;
    FixtureToken internal weth;
    FixtureToken internal reserveUsdc; // reserve-chain stablecoin (separate token, same unit)
    FixtureOracle internal oracle;
    FixtureLendingMarket internal market;
    FixtureSwapVenue internal venue;
    AaveV3LendingAdapter internal adapter;

    BastionEmergencyControl internal emergency;
    BastionPolicyRegistry internal policies;
    RescueSettlementLedger internal ledger;
    RescueReceiptRegistry internal receipts;
    SolverRegistry internal solverRegistry;
    SolverLiquidityVault internal liquidity;
    SolverQuoteManager internal quotes;
    SolverRescueExecutor internal solverExec;
    FlashRescueExecutor internal flashExec;
    BastionCallbackRouter internal router;
    BastionRiskObserver internal observer;

    BastionProtectionVault internal vault;
    CrossChainReserveEscrow internal escrow;

    MockReactiveSystem internal sys;
    MockCallbackProxy internal baseProxy;
    MockCallbackProxy internal uniProxy;
    BastionReactiveCore internal core;

    uint256 internal txCounter = 1;

    function setUp() public virtual {
        vm.chainId(BASE_SEPOLIA);
        vm.warp(1_790_000_000);
        borrower = vm.addr(borrowerPk);

        // Reactive system mock at the canonical Omni address.
        MockReactiveSystem impl = new MockReactiveSystem();
        vm.etch(SYSTEM_ADDR, address(impl).code);
        sys = MockReactiveSystem(payable(SYSTEM_ADDR));
        baseProxy = new MockCallbackProxy();
        uniProxy = new MockCallbackProxy();

        vm.startPrank(gov);
        usdc = new FixtureToken("Fixture USD Coin", "fUSDC", 6, gov);
        weth = new FixtureToken("Fixture Wrapped Ether", "fWETH", 18, gov);
        reserveUsdc = new FixtureToken("Fixture Reserve USD Coin", "frUSDC", 6, gov);
        oracle = new FixtureOracle(gov);
        oracle.setAssetPrice(address(usdc), 1e8);
        oracle.setAssetPrice(address(weth), 2000e8);
        market = new FixtureLendingMarket(oracle, gov);
        market.listReserve(address(weth), 8000, 8500, 10_500);
        market.listReserve(address(usdc), 7500, 8000, 10_500);
        venue = new FixtureSwapVenue(oracle, gov);
        venue.setExecutionCostBps(30);
        adapter = new AaveV3LendingAdapter(
            IAaveV3Pool(address(market)), IAaveV3Oracle(address(oracle)), keccak256("BASTION_FIXTURE_MARKET"), gov
        );

        emergency = new BastionEmergencyControl(gov, 1);
        emergency.setGuardian(guardian, true);
        policies = new BastionPolicyRegistry(gov, emergency);
        policies.setAdapter(address(adapter), true);
        ledger = new RescueSettlementLedger(gov);
        receipts = new RescueReceiptRegistry(gov);
        solverRegistry = new SolverRegistry(usdc, 100e6, 1 days, gov);
        liquidity = new SolverLiquidityVault(solverRegistry, emergency, gov);
        solverRegistry.setLiquidityVault(address(liquidity));
        quotes = new SolverQuoteManager(liquidity, solverRegistry, policies);
        solverExec = new SolverRescueExecutor(policies, ledger, receipts, solverRegistry, liquidity, quotes, gov);
        flashExec = new FlashRescueExecutor(policies, ledger, receipts, gov);
        flashExec.setVenue(address(venue), true, true);
        observer = new BastionRiskObserver(policies, 10);

        core = new BastionReactiveCore(gov);
        router = new BastionCallbackRouter(
            IPayable(payable(address(baseProxy))), address(core), policies, ledger, receipts, emergency, gov
        );
        router.setExecutors(IBastionExecutor(address(flashExec)), IBastionExecutor(address(solverExec)));
        solverExec.setRouter(address(router));
        flashExec.setRouter(address(router));
        policies.setExecutor(address(solverExec), true);
        policies.setExecutor(address(flashExec), true);
        liquidity.setExecutor(address(solverExec), true);
        solverRegistry.setRecorder(address(solverExec), true);
        adapter.setCollateralOperator(address(flashExec), true);
        ledger.setWriter(address(router), true);
        ledger.setWriter(address(solverExec), true);
        ledger.setWriter(address(flashExec), true);
        receipts.setWriter(address(solverExec), true);
        receipts.setWriter(address(flashExec), true);
        receipts.setWriter(address(router), true);

        // Reserve chain.
        vault = new BastionProtectionVault(emergency, 1 hours, gov);
        vault.setSupportedToken(address(reserveUsdc), true);
        escrow = new CrossChainReserveEscrow(IPayable(payable(address(uniProxy))), address(core), vault, gov);
        vault.setSettler(address(escrow), true);
        escrow.setTrustedExecutor(BASE_SEPOLIA, address(solverExec), true);

        // Reactive core wiring.
        core.addSource(BASE_SEPOLIA, address(observer), uint256(BastionRiskObserver.RiskObserved.selector), 1, 4, 96);
        core.addSource(
            BASE_SEPOLIA, address(solverExec), uint256(SolverRescueExecutor.SolverRescueExecuted.selector), 2, 4, 192
        );
        core.addSource(
            UNICHAIN_SEPOLIA,
            address(escrow),
            uint256(CrossChainReserveEscrow.ReimbursementCompleted.selector),
            3,
            4,
            64
        );
        core.setSourceActive(0, true);
        core.setSourceActive(1, true);
        core.setSourceActive(2, true);
        core.setDestination(1, BASE_SEPOLIA, address(router), 2_000_000);
        core.setDestination(2, UNICHAIN_SEPOLIA, address(escrow), 1_000_000);
        core.setDestination(3, BASE_SEPOLIA, address(router), 500_000);

        // Balances.
        usdc.mint(lp, 1_000_000e6);
        weth.mint(borrower, 10e18);
        usdc.mint(solver, 100_000e6);
        usdc.mint(solver2, 100_000e6);
        reserveUsdc.mint(borrower, 50_000e6);
        usdc.mint(address(venue), 1_000_000e6);
        vm.stopPrank();

        vm.startPrank(lp);
        usdc.approve(address(market), type(uint256).max);
        market.supply(address(usdc), 500_000e6, lp, 0);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ scenario helpers

    /// @dev 10 fWETH collateral at $2000, borrow 13,000 fUSDC => HF = 20000*0.85/13000 ≈ 1.3077.
    function _openBorrowerPosition(uint256 borrowUsdc) internal {
        vm.startPrank(borrower);
        weth.approve(address(market), type(uint256).max);
        market.supply(address(weth), 10e18, borrower, 0);
        market.borrow(address(usdc), borrowUsdc, 2, 0, borrower);
        vm.stopPrank();
    }

    function _defaultPolicy()
        internal
        view
        returns (BastionTypes.Policy memory p, address[] memory s, address[] memory r)
    {
        s = new address[](2);
        s[0] = solver;
        s[1] = solver2;
        r = new address[](0);
        p = BastionTypes.Policy({
            owner: borrower,
            account: borrower,
            sourceChainId: UNICHAIN_SEPOLIA,
            destChainId: BASE_SEPOLIA,
            adapter: address(adapter),
            market: address(market),
            debtAsset: address(usdc),
            collateralAsset: address(weth),
            triggerHealthFactor: 1.25e18,
            targetHealthFactor: 1.5e18,
            maxTotalRepay: 10_000e6,
            maxRepayPerAction: 6000e6,
            maxTotalFees: 200e6,
            maxSlippageBps: 200,
            maxFeeBps: 100,
            allowedPaths: BastionTypes.PATH_FLASH | BastionTypes.PATH_SOLVER,
            allowPartial: false,
            expiry: uint64(block.timestamp + 30 days),
            cooldown: 0,
            nonce: policies.nonces(borrower),
            solversHash: keccak256(abi.encodePacked(s)),
            recipientsHash: keccak256(abi.encodePacked(r))
        });
    }

    function _register(BastionTypes.Policy memory p, address[] memory s, address[] memory r)
        internal
        returns (bytes32 id, uint64 version)
    {
        vm.prank(p.owner);
        (id, version) = policies.registerPolicy(p, s, r, "");
    }

    function _registerDefault() internal returns (bytes32 id, uint64 version) {
        (BastionTypes.Policy memory p, address[] memory s, address[] memory r) = _defaultPolicy();
        p.allowedPaths = BastionTypes.PATH_SOLVER;
        return _register(p, s, r);
    }

    function _onboardSolver(address who, address payout, uint256 inventory) internal {
        vm.startPrank(who);
        usdc.approve(address(solverRegistry), type(uint256).max);
        usdc.approve(address(liquidity), type(uint256).max);
        solverRegistry.register(payout, 100e6, "ipfs://solver");
        liquidity.deposit(address(usdc), inventory);
        vm.stopPrank();
    }

    function _commit(address who, bytes32 policyId, uint256 amount, uint16 feeBps) internal returns (bytes32 id) {
        vm.prank(who);
        id = liquidity.commit(policyId, address(usdc), amount, feeBps, uint64(block.timestamp + 1 days));
    }

    function _fundReserve(bytes32 policyId, uint256 repay, uint256 fee) internal {
        vm.startPrank(borrower);
        reserveUsdc.approve(address(vault), type(uint256).max);
        vault.deposit(address(reserveUsdc), repay + fee);
        vault.allocate(policyId, address(reserveUsdc), repay, fee, 100);
        vm.stopPrank();
    }

    function _crash(uint256 newWethPrice) internal {
        vm.prank(gov);
        oracle.setAssetPrice(address(weth), newWethPrice);
    }

    function _hf() internal view returns (uint256) {
        return adapter.getHealthFactor(borrower);
    }

    // ------------------------------------------------------------------ Reactive simulation helpers

    function _toLogRecord(Vm.Log memory l, uint256 chainId) internal returns (IReactive.LogRecord memory r) {
        r.chainId = chainId;
        r.contractAddress = l.emitter;
        r.opCode = l.topics.length;
        if (l.topics.length > 0) r.topic0 = uint256(l.topics[0]);
        if (l.topics.length > 1) r.topic1 = uint256(l.topics[1]);
        if (l.topics.length > 2) r.topic2 = uint256(l.topics[2]);
        if (l.topics.length > 3) r.topic3 = uint256(l.topics[3]);
        r.data = l.data;
        r.blockNumber = block.number;
        r.blockHash = uint256(blockhash(block.number - 1));
        r.txHash = uint256(keccak256(abi.encode("tx", txCounter++)));
        r.logIndex = 0;
    }

    function _findLog(Vm.Log[] memory logs, address emitter, bytes32 topic0)
        internal
        pure
        returns (Vm.Log memory l, bool found)
    {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == emitter && logs[i].topics.length > 0 && logs[i].topics[0] == topic0) {
                return (logs[i], true);
            }
        }
    }

    /// @dev Delivers a LogRecord to the core as the system contract and returns the callback it requested (if any).
    function _react(IReactive.LogRecord memory rec)
        internal
        returns (bool requested, ISystemContract.CallbackConfiguration_V_1_0 memory cfg)
    {
        uint256 before = sys.callbackCount();
        vm.prank(SYSTEM_ADDR);
        core.react(rec);
        if (sys.callbackCount() > before) {
            (cfg,) = sys.callbackAt(sys.callbackCount() - 1);
            requested = true;
        }
    }

    function _deliver(MockCallbackProxy proxy, ISystemContract.CallbackConfiguration_V_1_0 memory cfg)
        internal
        returns (bool ok)
    {
        (ok,) = proxy.deliver(cfg.recipient, cfg.payload, address(core), cfg.gasLimit);
    }
}
