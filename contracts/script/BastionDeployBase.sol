// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { Script, console2 } from "forge-std/Script.sol";
import { VmSafe } from "forge-std/Vm.sol";
import { IPayable } from "@reactive/src/interfaces/IPayable.sol";
import { IAaveV3Pool, IAaveV3Oracle } from "../src/interfaces/IAaveV3.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { BastionEmergencyControl } from "../src/governance/BastionEmergencyControl.sol";
import { BastionPolicyRegistry } from "../src/policies/BastionPolicyRegistry.sol";
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
import { AaveV3LendingAdapter } from "../src/adapters/AaveV3LendingAdapter.sol";
import { IBastionExecutor } from "../src/interfaces/IBastionExecutor.sol";
import { FixtureToken } from "../src/fixtures/FixtureToken.sol";
import { FixtureOracle } from "../src/fixtures/FixtureOracle.sol";
import { FixtureLendingMarket } from "../src/fixtures/FixtureLendingMarket.sol";
import { FixtureSwapVenue } from "../src/fixtures/FixtureSwapVenue.sol";

/// @title BastionDeployBase
/// @notice Shared, order-preserving deployment logic for Section 4B / ARCHITECTURE.md §6. Used by the per-chain live
///         scripts (which refuse to broadcast without explicit authorization) and by the local anvil simulation.
/// @dev Every function deploys with `owner = deployer` so wiring can happen in the same broadcast; ownership hand-off
///      to governance is a separate Ownable2Step step (`BASTION_GOVERNANCE`) that the new owner must accept.
abstract contract BastionDeployBase is Script {
    // Official addresses (docs/integrations/VERIFIED-ADDRESSES.md).
    uint256 internal constant BASE_SEPOLIA = 84_532;
    uint256 internal constant UNICHAIN_SEPOLIA = 1301;
    uint256 internal constant LASNA = 5_318_007;
    address internal constant BASE_SEPOLIA_CALLBACK_PROXY = 0x476F44b11F5C942c58f4c8E3d0300E5710743585;
    address internal constant UNICHAIN_SEPOLIA_CALLBACK_PROXY = 0x775c9B990ADe401060B78D0e98684eEf8d2466C1;
    address internal constant AAVE_BASE_SEPOLIA_POOL = 0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27;
    address internal constant AAVE_BASE_SEPOLIA_ORACLE = 0x943b0dE18d4abf4eF02A85912F8fc07684C141dF;
    address internal constant AAVE_BASE_SEPOLIA_USDC = 0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f;

    struct DestinationStack {
        BastionEmergencyControl emergency;
        BastionPolicyRegistry policies;
        RescueSettlementLedger ledger;
        RescueReceiptRegistry receipts;
        SolverRegistry solverRegistry;
        SolverLiquidityVault liquidity;
        SolverQuoteManager quotes;
        SolverRescueExecutor solverExec;
        FlashRescueExecutor flashExec;
        BastionRiskObserver observer;
        BastionCallbackRouter router;
    }

    struct ReserveStack {
        BastionEmergencyControl emergency;
        BastionProtectionVault vault;
        CrossChainReserveEscrow escrow;
    }

    struct FixtureMarket {
        FixtureToken usdc;
        FixtureToken weth;
        FixtureOracle oracle;
        FixtureLendingMarket market;
        FixtureSwapVenue venue;
        AaveV3LendingAdapter adapter;
    }

    /// @dev Refuses anything that is not an explicitly supported testnet or a local dev chain. Mainnets are never allowed.
    function _requireAllowedChain(uint256 expected) internal view {
        require(block.chainid == expected, "BASTION: wrong chain for this script");
        require(
            block.chainid == BASE_SEPOLIA || block.chainid == UNICHAIN_SEPOLIA || block.chainid == LASNA
                || block.chainid == 31_337,
            "BASTION: chain not allowlisted (mainnet deployment is disabled)"
        );
    }

    /// @dev Live (non-local) BROADCASTS require the owner to set BASTION_DEPLOY_AUTHORIZED=true explicitly.
    ///      Dry-run simulations (no --broadcast) are always allowed so the scripts can be verified without funds.
    function _requireAuthorizedIfLive() internal view {
        if (block.chainid == 31_337) return;
        if (!_broadcasting()) return;
        require(
            vm.envOr("BASTION_DEPLOY_AUTHORIZED", false),
            "BASTION: set BASTION_DEPLOY_AUTHORIZED=true only after explicit owner authorization"
        );
    }

    function _broadcasting() internal view returns (bool) {
        return vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume);
    }

    /// @dev Addresses from a dry run are simulation artefacts and must never look like deployment evidence, so they
    ///      go to out-evidence/dry-run/ and carry mode=DRY_RUN_SIMULATION_NOT_DEPLOYED.
    function _outPath(string memory name) internal returns (string memory) {
        string memory dir = _broadcasting() ? "out-evidence/deployments/" : "out-evidence/dry-run/";
        vm.createDir(dir, true);
        return string.concat(dir, vm.toString(block.chainid), "-", name, ".json");
    }

    function _mode() internal view returns (string memory) {
        return _broadcasting() ? "BROADCAST" : "DRY_RUN_SIMULATION_NOT_DEPLOYED";
    }

    // ------------------------------------------------------------------ Lasna

    function _deployReactiveCore(address owner_) internal returns (BastionReactiveCore core) {
        core = new BastionReactiveCore(owner_);
    }

    // ------------------------------------------------------------------ destination (Base Sepolia)

    function _deployDestination(
        address owner_,
        IPayable callbackProxy,
        address reactiveCore,
        IERC20 bondToken,
        uint256 minBond,
        uint64 solverExitDelay,
        uint64 observerMinInterval
    ) internal returns (DestinationStack memory d) {
        d.emergency = new BastionEmergencyControl(owner_, 1);
        d.policies = new BastionPolicyRegistry(owner_, d.emergency);
        d.ledger = new RescueSettlementLedger(owner_);
        d.receipts = new RescueReceiptRegistry(owner_);
        d.solverRegistry = new SolverRegistry(bondToken, minBond, solverExitDelay, owner_);
        d.liquidity = new SolverLiquidityVault(d.solverRegistry, d.emergency, owner_);
        d.solverRegistry.setLiquidityVault(address(d.liquidity));
        d.quotes = new SolverQuoteManager(d.liquidity, d.solverRegistry, d.policies);
        d.solverExec =
            new SolverRescueExecutor(d.policies, d.ledger, d.receipts, d.solverRegistry, d.liquidity, d.quotes, owner_);
        d.flashExec = new FlashRescueExecutor(d.policies, d.ledger, d.receipts, owner_);
        d.observer = new BastionRiskObserver(d.policies, observerMinInterval);
        d.router = new BastionCallbackRouter(
            callbackProxy, reactiveCore, d.policies, d.ledger, d.receipts, d.emergency, owner_
        );
        // Wiring (all owner-only, same broadcast).
        d.router.setExecutors(IBastionExecutor(address(d.flashExec)), IBastionExecutor(address(d.solverExec)));
        d.solverExec.setRouter(address(d.router));
        d.flashExec.setRouter(address(d.router));
        d.policies.setExecutor(address(d.solverExec), true);
        d.policies.setExecutor(address(d.flashExec), true);
        d.liquidity.setExecutor(address(d.solverExec), true);
        d.solverRegistry.setRecorder(address(d.solverExec), true);
        d.ledger.setWriter(address(d.router), true);
        d.ledger.setWriter(address(d.solverExec), true);
        d.ledger.setWriter(address(d.flashExec), true);
        d.receipts.setWriter(address(d.solverExec), true);
        d.receipts.setWriter(address(d.flashExec), true);
        d.receipts.setWriter(address(d.router), true);
    }

    /// @dev Registers an adapter with the policy registry and makes the flash executor its only collateral operator.
    function _enableAdapter(DestinationStack memory d, AaveV3LendingAdapter adapter) internal {
        d.policies.setAdapter(address(adapter), true);
        adapter.setCollateralOperator(address(d.flashExec), true);
    }

    function _deployAaveAdapter(address owner_, address pool, address oracle) internal returns (AaveV3LendingAdapter) {
        return
            new AaveV3LendingAdapter(
                IAaveV3Pool(pool), IAaveV3Oracle(oracle), keccak256("AAVE_V3_BASE_SEPOLIA"), owner_
            );
    }

    /// @notice Deploys the clearly-labeled BASTION fixture lending market (NOT an official third-party protocol).
    function _deployFixtureMarket(address owner_) internal returns (FixtureMarket memory f) {
        f.usdc = new FixtureToken("BASTION Fixture USD Coin", "fUSDC", 6, owner_);
        f.weth = new FixtureToken("BASTION Fixture Wrapped Ether", "fWETH", 18, owner_);
        f.oracle = new FixtureOracle(owner_);
        f.oracle.setAssetPrice(address(f.usdc), 1e8);
        f.oracle.setAssetPrice(address(f.weth), 2000e8);
        f.market = new FixtureLendingMarket(f.oracle, owner_);
        f.market.listReserve(address(f.weth), 8000, 8500, 10_500);
        f.market.listReserve(address(f.usdc), 7500, 8000, 10_500);
        f.venue = new FixtureSwapVenue(f.oracle, owner_);
        f.venue.setExecutionCostBps(30);
        f.adapter = new AaveV3LendingAdapter(
            IAaveV3Pool(address(f.market)),
            IAaveV3Oracle(address(f.oracle)),
            keccak256("BASTION_FIXTURE_MARKET"),
            owner_
        );
    }

    // ------------------------------------------------------------------ reserve (Unichain Sepolia)

    function _deployReserve(address owner_, IPayable callbackProxy, address reactiveCore, uint64 releaseDelay)
        internal
        returns (ReserveStack memory r)
    {
        r.emergency = new BastionEmergencyControl(owner_, 1);
        r.vault = new BastionProtectionVault(r.emergency, releaseDelay, owner_);
        r.escrow = new CrossChainReserveEscrow(callbackProxy, reactiveCore, r.vault, owner_);
        r.vault.setSettler(address(r.escrow), true);
    }

    // ------------------------------------------------------------------ Reactive wiring (Lasna, step 4)

    /// @dev Data lengths are the exact ABI sizes of the non-indexed event fields (checked by the core on every log).
    uint16 internal constant RISK_OBSERVED_DATA_LEN = 96; // uint256 hf, uint256 trigger, uint64 observedAt
    uint16 internal constant SOLVER_RESCUE_EXECUTED_DATA_LEN = 192; // payout, policyOwner, principal, fee, executedAt, originEventId
    uint16 internal constant REIMBURSEMENT_COMPLETED_DATA_LEN = 64; // principal, fee

    function _configureCore(
        BastionReactiveCore core,
        uint256 destChainId,
        address observer,
        address solverExec,
        address router,
        uint256 reserveChainId,
        address escrow,
        bool activate
    ) internal {
        uint256 first = core.sourceCount();
        core.addSource(
            destChainId, observer, uint256(BastionRiskObserver.RiskObserved.selector), 1, 4, RISK_OBSERVED_DATA_LEN
        );
        core.addSource(
            destChainId,
            solverExec,
            uint256(SolverRescueExecutor.SolverRescueExecuted.selector),
            2,
            4,
            SOLVER_RESCUE_EXECUTED_DATA_LEN
        );
        core.addSource(
            reserveChainId,
            escrow,
            uint256(CrossChainReserveEscrow.ReimbursementCompleted.selector),
            3,
            4,
            REIMBURSEMENT_COMPLETED_DATA_LEN
        );
        core.setDestination(1, destChainId, router, 2_000_000);
        core.setDestination(2, reserveChainId, escrow, 1_000_000);
        core.setDestination(3, destChainId, router, 500_000);
        if (activate) {
            core.setSourceActive(first, true);
            core.setSourceActive(first + 1, true);
            core.setSourceActive(first + 2, true);
        }
    }

    function _logDestination(DestinationStack memory d) internal pure {
        console2.log("BastionEmergencyControl ", address(d.emergency));
        console2.log("BastionPolicyRegistry   ", address(d.policies));
        console2.log("RescueSettlementLedger  ", address(d.ledger));
        console2.log("RescueReceiptRegistry   ", address(d.receipts));
        console2.log("SolverRegistry          ", address(d.solverRegistry));
        console2.log("SolverLiquidityVault    ", address(d.liquidity));
        console2.log("SolverQuoteManager      ", address(d.quotes));
        console2.log("SolverRescueExecutor    ", address(d.solverExec));
        console2.log("FlashRescueExecutor     ", address(d.flashExec));
        console2.log("BastionRiskObserver     ", address(d.observer));
        console2.log("BastionCallbackRouter   ", address(d.router));
    }

    function _writeDestinationJson(string memory path, DestinationStack memory d, address adapter) internal {
        string memory k = "dest";
        vm.serializeString(k, "mode", _mode());
        vm.serializeUint(k, "chainId", block.chainid);
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
        vm.serializeAddress(k, "adapter", adapter);
        string memory json = vm.serializeAddress(k, "callbackRouter", address(d.router));
        vm.writeJson(json, path);
    }
}
