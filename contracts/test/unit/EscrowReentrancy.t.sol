// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { BastionTestBase } from "../BastionTestBase.sol";
import { CrossChainReserveEscrow } from "../../src/settlement/CrossChainReserveEscrow.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface ITokenHook {
    function onTokenReceived(uint256 amount) external;
}

/// @dev ERC20 with ERC777-style receive hooks — models the token class that makes post-call state writes dangerous.
contract HookToken is ERC20 {
    constructor() ERC20("Hook USD", "hUSD") { }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 a) external {
        _mint(to, a);
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (to.code.length > 0 && from != address(0)) {
            try ITokenHook(to).onTokenReceived(value) { } catch { }
        }
    }
}

contract ReenteringRecipient is ITokenHook {
    CrossChainReserveEscrow public escrow;
    bytes32 public rescueId;
    uint256 public reentryAttempts;
    bool public reentrySucceeded;

    constructor(CrossChainReserveEscrow e) {
        escrow = e;
    }

    function setRescue(bytes32 id) external {
        rescueId = id;
    }

    function onTokenReceived(uint256) external {
        if (reentryAttempts > 0) return;
        reentryAttempts++;
        try escrow.retrySettlement(rescueId) {
            reentrySucceeded = true;
        } catch { }
    }
}

contract EscrowReentrancyTest is BastionTestBase {
    function test_hookTokenRecipientCannotReenterSettlement() public {
        HookToken hook = new HookToken();
        vm.prank(gov);
        vault.setSupportedToken(address(hook), true);
        ReenteringRecipient rcpt = new ReenteringRecipient(escrow);
        bytes32 pid = keccak256("hook-policy");
        bytes32 rescueId = keccak256("hook-rescue");
        rcpt.setRescue(rescueId);

        // 1) Claim arrives before any budget exists -> RecoveryRequired.
        bytes memory payload = abi.encodeWithSignature(
            "settleRescue(address,bytes32,bytes32,address,uint256,address,address,uint256,uint256,uint64,bytes32)",
            address(0),
            rescueId,
            pid,
            borrower,
            BASE_SEPOLIA,
            address(solverExec),
            address(rcpt),
            1000e6,
            10e6,
            uint64(block.timestamp),
            bytes32("evt")
        );
        (bool ok,) = uniProxy.deliver(address(escrow), payload, address(core), 1_000_000);
        assertTrue(ok);
        assertEq(
            uint8(escrow.getClaim(rescueId).state), uint8(CrossChainReserveEscrow.SettlementState.RecoveryRequired)
        );

        // 2) Budget funded with 2x the claim so a double payout would be observable.
        hook.mint(borrower, 2020e6);
        vm.startPrank(borrower);
        hook.approve(address(vault), type(uint256).max);
        vault.deposit(address(hook), 2020e6);
        vault.allocate(pid, address(hook), 2000e6, 20e6, 100);
        vm.stopPrank();

        // 3) Permissionless retry pays the hook recipient, which tries to re-enter.
        escrow.retrySettlement(rescueId);
        assertEq(rcpt.reentryAttempts(), 1, "hook fired");
        assertFalse(rcpt.reentrySucceeded(), "re-entry must fail");
        assertEq(hook.balanceOf(address(rcpt)), 1010e6, "paid exactly once");
        assertEq(uint8(escrow.getClaim(rescueId).state), uint8(CrossChainReserveEscrow.SettlementState.Reimbursed));
        assertEq(escrow.pendingRecovery(), 0);
        assertEq(escrow.getClaim(rescueId).attempts, 2, "no phantom attempt recorded by re-entry");
    }
}
