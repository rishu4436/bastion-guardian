// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { ISystemContract } from "@reactive/src/interfaces/ISystemContract.sol";

/// @notice Local stand-in for the Reactive system contract at 0x8888…8888 (etched in tests).
/// @dev The official reactive-test-lib targets the legacy 0x…fffFfF service address, so BASTION ships its own
///      Omni-compatible mock exposing exactly the ISystemContract surface from reactive-lib-omni v0.1.0.
contract MockReactiveSystem {
    struct Sub {
        address subscriber;
        uint256 chainId;
        address contract_;
        uint256 topic0;
        uint256 topic1;
        uint256 topic2;
        uint256 topic3;
        bool active;
    }

    Sub[] public subs;
    ISystemContract.CallbackConfiguration_V_1_0[] internal _callbacks;
    address[] internal _callbackSenders;
    mapping(address => uint256) public debt;

    event CallbackRequest(
        uint256 indexed chainId,
        address indexed sender,
        address indexed recipient,
        ISystemContract.CallbackVersion version,
        bytes configuration
    );

    receive() external payable {
        debt[msg.sender] = msg.value >= debt[msg.sender] ? 0 : debt[msg.sender] - msg.value;
    }

    function setDebt(address c, uint256 d) external {
        debt[c] = d;
    }

    function subscribe(uint256 c, address a, uint256 t0, uint256 t1, uint256 t2, uint256 t3) external {
        subs.push(Sub(msg.sender, c, a, t0, t1, t2, t3, true));
    }

    function unsubscribe(uint256 c, address a, uint256 t0, uint256 t1, uint256 t2, uint256 t3) external {
        for (uint256 i; i < subs.length; ++i) {
            Sub storage s = subs[i];
            if (
                s.active && s.subscriber == msg.sender && s.chainId == c && s.contract_ == a && s.topic0 == t0
                    && s.topic1 == t1 && s.topic2 == t2 && s.topic3 == t3
            ) s.active = false;
        }
    }

    function activeSubscriptions(address subscriber) external view returns (uint256 n) {
        for (uint256 i; i < subs.length; ++i) {
            if (subs[i].active && subs[i].subscriber == subscriber) n++;
        }
    }

    function requestCallbackV_1_0(ISystemContract.CallbackConfiguration_V_1_0 memory config_) external {
        require(debt[msg.sender] == 0, "InDebt");
        _callbacks.push(config_);
        _callbackSenders.push(msg.sender);
        emit CallbackRequest(
            config_.chainId, msg.sender, config_.recipient, ISystemContract.CallbackVersion.V_1_0, abi.encode(config_)
        );
    }

    function callbackCount() external view returns (uint256) {
        return _callbacks.length;
    }

    function callbackAt(uint256 i)
        external
        view
        returns (ISystemContract.CallbackConfiguration_V_1_0 memory, address sender)
    {
        return (_callbacks[i], _callbackSenders[i]);
    }
}
