// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { console2 } from "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IPayable } from "@reactive/src/interfaces/IPayable.sol";
import { BastionDeployBase } from "./BastionDeployBase.sol";
import { BastionTypes } from "../src/libraries/BastionTypes.sol";
import { BastionReactiveCore } from "../src/reactive/BastionReactiveCore.sol";
import { MockCallbackProxy } from "../test/mocks/MockCallbackProxy.sol";
import { FixtureToken } from "../src/fixtures/FixtureToken.sol";

/// @title LocalSimulationDeploy
/// @notice LOCAL SIMULATION ONLY (anvil, chain 31337). Deploys the complete BASTION stack — Reactive core, destination
///         stack, reserve stack and the labeled fixture market — into ONE local EVM, wires it exactly like the live
///         order (ARCHITECTURE.md §6), and prepares two borrowers:
///           · borrower A: solver-only policy, funded reserve budget, committed solver liquidity (Scenario B)
///           · borrower B: flash-only policy with a bounded aToken approval + pull cap (Scenario A)
///         The Reactive system contract (0x8888…8888) must already hold MockReactiveSystem code (set via
///         `anvil_setCode` by script/local-e2e.sh); a TypeScript relay (tools/local-e2e) then plays the Reactive
///         Network's role. Nothing here touches a public network; the keys below are anvil's public dev keys.
contract LocalSimulationDeploy is BastionDeployBase {
    // Anvil's well-known, PUBLIC development keys (mnemonic "test test ... junk"). Never fund these anywhere real.
    uint256 internal constant GOV_PK = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 internal constant BORROWER_A_PK = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint256 internal constant SOLVER_PK = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;
    uint256 internal constant LP_PK = 0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6;
    uint256 internal constant BORROWER_B_PK = 0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e;
    address internal constant SYSTEM_ADDR = 0x8888888888888888888888888888888888888888;

    struct Actors {
        address gov;
        address borrowerA;
        address borrowerB;
        address solver;
        address solverPayout;
        address lp;
    }

    function run() external {
        _requireAllowedChain(31_337);
        require(SYSTEM_ADDR.code.length > 0, "set MockReactiveSystem code at 0x8888 first (script/local-e2e.sh)");
        Actors memory a = Actors({
            gov: vm.addr(GOV_PK),
            borrowerA: vm.addr(BORROWER_A_PK),
            borrowerB: vm.addr(BORROWER_B_PK),
            solver: vm.addr(SOLVER_PK),
            solverPayout: address(uint160(uint256(keccak256("bastion.local.solverPayout")))),
            lp: vm.addr(LP_PK)
        });

        // ---- deployment (governance key) ------------------------------------------------------------
        vm.startBroadcast(GOV_PK);
        MockCallbackProxy destProxy = new MockCallbackProxy();
        MockCallbackProxy reserveProxy = new MockCallbackProxy();
        BastionReactiveCore core = _deployReactiveCore(a.gov);
        FixtureMarket memory f = _deployFixtureMarket(a.gov);
        FixtureToken reserveUsdc = new FixtureToken("BASTION Fixture Reserve USD Coin", "frUSDC", 6, a.gov);
        DestinationStack memory d = _deployDestination(
            a.gov, IPayable(payable(address(destProxy))), address(core), IERC20(address(f.usdc)), 100e6, 1 days, 10
        );
        _enableAdapter(d, f.adapter);
        d.flashExec.setVenue(address(f.venue), true, true);
        ReserveStack memory r = _deployReserve(a.gov, IPayable(payable(address(reserveProxy))), address(core), 1 hours);
        r.vault.setSupportedToken(address(reserveUsdc), true);
        r.escrow.setTrustedExecutor(block.chainid, address(d.solverExec), true);
        _configureCore(
            core,
            block.chainid,
            address(d.observer),
            address(d.solverExec),
            address(d.router),
            block.chainid,
            address(r.escrow),
            true
        );
        // Balances for the scenario.
        f.usdc.mint(a.lp, 1_000_000e6);
        f.usdc.mint(a.solver, 100_000e6);
        f.usdc.mint(address(f.venue), 1_000_000e6);
        f.weth.mint(a.borrowerA, 10e18);
        f.weth.mint(a.borrowerB, 10e18);
        reserveUsdc.mint(a.borrowerA, 50_000e6);
        vm.stopBroadcast();

        // ---- liquidity provider --------------------------------------------------------------------
        vm.startBroadcast(LP_PK);
        f.usdc.approve(address(f.market), type(uint256).max);
        f.market.supply(address(f.usdc), 500_000e6, a.lp, 0);
        vm.stopBroadcast();

        // ---- borrower A: solver-funded protection (Scenario B) ---------------------------------------
        bytes32 policyA;
        uint64 versionA;
        {
            vm.startBroadcast(BORROWER_A_PK);
            f.weth.approve(address(f.market), type(uint256).max);
            f.market.supply(address(f.weth), 10e18, a.borrowerA, 0);
            f.market.borrow(address(f.usdc), 13_000e6, 2, 0, a.borrowerA); // HF = 20000*0.85/13000 ≈ 1.3077
            address[] memory solvers = new address[](1);
            solvers[0] = a.solver;
            BastionTypes.Policy memory p = _policy(a.borrowerA, d, f, solvers, BastionTypes.PATH_SOLVER);
            (policyA, versionA) = d.policies.registerPolicy(p, solvers, new address[](0), "");
            reserveUsdc.approve(address(r.vault), type(uint256).max);
            r.vault.deposit(address(reserveUsdc), 10_200e6);
            r.vault.allocate(policyA, address(reserveUsdc), 10_000e6, 200e6, 100);
            vm.stopBroadcast();
        }

        // ---- solver: register, deposit inventory, commit liquidity to policy A ------------------------
        vm.startBroadcast(SOLVER_PK);
        f.usdc.approve(address(d.solverRegistry), type(uint256).max);
        f.usdc.approve(address(d.liquidity), type(uint256).max);
        d.solverRegistry.register(a.solverPayout, 100e6, "local://bastion-solver");
        d.liquidity.deposit(address(f.usdc), 50_000e6);
        bytes32 commitmentId =
            d.liquidity.commit(policyA, address(f.usdc), 8000e6, 50, uint64(block.timestamp + 1 days));
        vm.stopBroadcast();

        // ---- borrower B: flash deleverage protection (Scenario A) -------------------------------------
        bytes32 policyB;
        uint64 versionB;
        {
            vm.startBroadcast(BORROWER_B_PK);
            f.weth.approve(address(f.market), type(uint256).max);
            f.market.supply(address(f.weth), 10e18, a.borrowerB, 0);
            f.market.borrow(address(f.usdc), 13_000e6, 2, 0, a.borrowerB);
            BastionTypes.Policy memory p = _policy(a.borrowerB, d, f, new address[](0), BastionTypes.PATH_FLASH);
            p.maxRepayPerAction = 8000e6;
            (policyB, versionB) = d.policies.registerPolicy(p, new address[](0), new address[](0), "");
            // Bounded protocol-native authorization + account pull cap (R-02): at most 5 fWETH can ever be pulled.
            IERC20(f.market.getReserveAToken(address(f.weth))).approve(address(f.adapter), 5e18);
            f.adapter.setCollateralPullCap(address(f.weth), 5e18, true);
            vm.stopBroadcast();
        }

        // ---- governance: mirror both policies in the (non-authoritative) Reactive filter ----------------
        vm.startBroadcast(GOV_PK);
        core.setPolicyMirror(policyA, true, versionA, 0);
        core.setPolicyMirror(policyB, true, versionB, 0);
        vm.stopBroadcast();

        // ---- addresses for the relay / services ---------------------------------------------------------
        string memory k = "local";
        vm.serializeString(k, "label", "LOCAL ANVIL SIMULATION - not a testnet deployment");
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeAddress(k, "systemContract", SYSTEM_ADDR);
        vm.serializeAddress(k, "destCallbackProxy", address(destProxy));
        vm.serializeAddress(k, "reserveCallbackProxy", address(reserveProxy));
        vm.serializeAddress(k, "reactiveCore", address(core));
        vm.serializeAddress(k, "emergency", address(d.emergency));
        vm.serializeAddress(k, "policyRegistry", address(d.policies));
        vm.serializeAddress(k, "ledger", address(d.ledger));
        vm.serializeAddress(k, "receipts", address(d.receipts));
        vm.serializeAddress(k, "solverRegistry", address(d.solverRegistry));
        vm.serializeAddress(k, "solverLiquidityVault", address(d.liquidity));
        vm.serializeAddress(k, "solverQuoteManager", address(d.quotes));
        vm.serializeAddress(k, "solverRescueExecutor", address(d.solverExec));
        vm.serializeAddress(k, "flashRescueExecutor", address(d.flashExec));
        vm.serializeAddress(k, "riskObserver", address(d.observer));
        vm.serializeAddress(k, "callbackRouter", address(d.router));
        vm.serializeAddress(k, "protectionVault", address(r.vault));
        vm.serializeAddress(k, "reserveEscrow", address(r.escrow));
        vm.serializeAddress(k, "fixtureMarket", address(f.market));
        vm.serializeAddress(k, "fixtureOracle", address(f.oracle));
        vm.serializeAddress(k, "fixtureVenue", address(f.venue));
        vm.serializeAddress(k, "fixtureAdapter", address(f.adapter));
        vm.serializeAddress(k, "fUSDC", address(f.usdc));
        vm.serializeAddress(k, "fWETH", address(f.weth));
        vm.serializeAddress(k, "frUSDC", address(reserveUsdc));
        vm.serializeAddress(k, "gov", a.gov);
        vm.serializeAddress(k, "borrowerA", a.borrowerA);
        vm.serializeAddress(k, "borrowerB", a.borrowerB);
        vm.serializeAddress(k, "solver", a.solver);
        vm.serializeAddress(k, "solverPayout", a.solverPayout);
        vm.serializeBytes32(k, "commitmentId", commitmentId);
        vm.serializeBytes32(k, "policyA", policyA);
        vm.serializeUint(k, "policyAVersion", versionA);
        vm.serializeBytes32(k, "policyB", policyB);
        string memory json = vm.serializeUint(k, "policyBVersion", versionB);
        vm.writeJson(json, "out-evidence/local/addresses.json");
        _logDestination(d);
        console2.log("ReactiveCore (local)", address(core));
        console2.log("policyA", vm.toString(policyA));
        console2.log("policyB", vm.toString(policyB));
    }

    function _policy(
        address owner_,
        DestinationStack memory d,
        FixtureMarket memory f,
        address[] memory solvers,
        uint8 paths
    ) internal view returns (BastionTypes.Policy memory p) {
        p = BastionTypes.Policy({
            owner: owner_,
            account: owner_,
            sourceChainId: block.chainid,
            destChainId: block.chainid,
            adapter: address(f.adapter),
            market: address(f.market),
            debtAsset: address(f.usdc),
            collateralAsset: address(f.weth),
            triggerHealthFactor: 1.25e18,
            targetHealthFactor: 1.5e18,
            maxTotalRepay: 10_000e6,
            maxRepayPerAction: 6000e6,
            maxTotalFees: 200e6,
            maxSlippageBps: 200,
            maxFeeBps: 100,
            allowedPaths: paths,
            allowPartial: false,
            expiry: uint64(block.timestamp + 30 days),
            cooldown: 0,
            nonce: d.policies.nonces(owner_),
            solversHash: keccak256(abi.encodePacked(solvers)),
            recipientsHash: keccak256(abi.encodePacked(new address[](0)))
        });
    }
}
