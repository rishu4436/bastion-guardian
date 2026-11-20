// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { IReactive } from "@reactive/src/interfaces/IReactive.sol";
import { AbstractPayer } from "@reactive/src/base/AbstractPayer.sol";
import { BastionTestBase } from "../BastionTestBase.sol";
import { BastionReactiveCore } from "../../src/reactive/BastionReactiveCore.sol";
import { BastionRiskObserver } from "../../src/oracles/BastionRiskObserver.sol";

contract ReactiveCoreTest is BastionTestBase {
    bytes32 internal constant PID = keccak256("pid");

    function setUp() public override {
        super.setUp();
        vm.prank(gov);
        core.setPolicyMirror(PID, true, 1, 60);
    }

    function _riskLog(uint256 hf, uint256 trigger) internal returns (IReactive.LogRecord memory r) {
        r.chainId = BASE_SEPOLIA;
        r.contractAddress = address(observer);
        r.topic0 = uint256(BastionRiskObserver.RiskObserved.selector);
        r.topic1 = uint256(PID);
        r.topic2 = uint256(uint160(borrower));
        r.topic3 = 1;
        r.opCode = 4;
        r.data = abi.encode(hf, trigger, uint64(block.timestamp));
        r.txHash = uint256(keccak256(abi.encode(txCounter++)));
    }

    function test_subscriptionsUseSixCriteriaAndUnsubscribeExactly() public {
        assertEq(sys.activeSubscriptions(address(core)), 3);
        vm.prank(gov);
        core.setSourceActive(0, false);
        assertEq(sys.activeSubscriptions(address(core)), 2);
        vm.prank(gov);
        core.setSourceActive(0, true);
        assertEq(sys.activeSubscriptions(address(core)), 3);
    }

    function test_onlySystemCanReact() public {
        IReactive.LogRecord memory r = _riskLog(1.1e18, 1.25e18);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(AbstractPayer.NotAuthorized.selector, attacker, SYSTEM_ADDR));
        core.react(r);
    }

    function test_validSignalRequestsCallback() public {
        (bool requested,) = _react(_riskLog(1.1e18, 1.25e18));
        assertTrue(requested);
        assertEq(core.callbacksRequested(), 1);
    }

    function test_filtersNeverRevert() public {
        IReactive.LogRecord memory r = _riskLog(1.1e18, 1.25e18);
        r.contractAddress = attacker; // unknown emitter
        (bool requested,) = _react(r);
        assertFalse(requested);
        r = _riskLog(1.1e18, 1.25e18);
        r.opCode = 3;
        (requested,) = _react(r);
        assertFalse(requested);
        r = _riskLog(1.1e18, 1.25e18);
        r.data = abi.encode(uint256(1)); // malformed length
        (requested,) = _react(r);
        assertFalse(requested);
        r = _riskLog(1.3e18, 1.25e18); // not below trigger
        (requested,) = _react(r);
        assertFalse(requested);
        r = _riskLog(1.1e18, 1.25e18);
        r.topic3 = 2; // stale version
        (requested,) = _react(r);
        assertFalse(requested);
        assertEq(core.eventsIgnored(), 5);
    }

    function test_sameTxDifferentLogIndexIsDistinctEvent() public {
        IReactive.LogRecord memory a = _riskLog(1.1e18, 1.25e18);
        IReactive.LogRecord memory b = _riskLog(1.1e18, 1.25e18);
        b.txHash = a.txHash;
        b.logIndex = 1;
        assertTrue(core.eventIdOf(a) != core.eventIdOf(b));
    }

    function test_cooldownAndRateLimit() public {
        (bool r1,) = _react(_riskLog(1.1e18, 1.25e18));
        (bool r2,) = _react(_riskLog(1.1e18, 1.25e18));
        assertTrue(r1);
        assertFalse(r2, "cooldown");
        vm.startPrank(gov);
        core.setPolicyMirror(PID, true, 1, 0);
        core.setRateLimit(60, 2);
        vm.stopPrank();
        (bool r3,) = _react(_riskLog(1.1e18, 1.25e18));
        (bool r4,) = _react(_riskLog(1.1e18, 1.25e18));
        assertTrue(r3);
        assertFalse(r4, "rate limited");
        vm.warp(block.timestamp + 61);
        (bool r5,) = _react(_riskLog(1.1e18, 1.25e18));
        assertTrue(r5);
    }

    function test_pausedCoreIgnores() public {
        vm.prank(gov);
        core.setPaused(true);
        (bool requested,) = _react(_riskLog(1.1e18, 1.25e18));
        assertFalse(requested);
    }

    function test_adminOnlyConfiguration() public {
        vm.startPrank(attacker);
        vm.expectRevert(abi.encodeWithSelector(BastionReactiveCore.NotOwner.selector, attacker));
        core.setDestination(1, BASE_SEPOLIA, attacker, 1_000_000);
        vm.expectRevert(abi.encodeWithSelector(BastionReactiveCore.NotOwner.selector, attacker));
        core.addSource(1, attacker, 1, 1, 4, 96);
        vm.stopPrank();
    }

    function test_inDebtCoreCannotRequest() public {
        sys.setDebt(address(core), 1 ether);
        vm.prank(SYSTEM_ADDR);
        vm.expectRevert(bytes("InDebt"));
        core.react(_riskLog(1.1e18, 1.25e18));
        assertEq(core.outstandingDebt(), 1 ether);
    }

    function test_payloadReservesFirstArgumentForRvm() public {
        (, ISystemContract_CallbackConfig memory cfg) = _reactCfg(_riskLog(1.1e18, 1.25e18));
        bytes memory p = cfg.payload;
        address first;
        assembly { first := mload(add(p, 36)) }
        assertEq(first, address(0), "placeholder must be address(0)");
    }

    struct ISystemContract_CallbackConfig {
        uint256 chainId;
        address recipient;
        uint64 gasLimit;
        bytes payload;
    }

    function _reactCfg(IReactive.LogRecord memory r)
        internal
        returns (bool req, ISystemContract_CallbackConfig memory c)
    {
        (bool q, ISystemContract.CallbackConfiguration_V_1_0 memory x) = _react(r);
        req = q;
        c = ISystemContract_CallbackConfig(x.chainId, x.recipient, x.gasLimit, x.payload);
    }
}

import { ISystemContract } from "@reactive/src/interfaces/ISystemContract.sol";
type _Unused is uint256;
