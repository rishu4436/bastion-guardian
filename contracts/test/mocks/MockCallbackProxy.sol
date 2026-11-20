// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

/// @notice Local stand-in for a destination-chain Reactive Callback Proxy. Mirrors documented behaviour:
///         overwrites the first 160 bits of the payload's first argument with the requesting reactive contract
///         address, refuses targets without code, and never bubbles the target's revert (emits CallbackFailure).
contract MockCallbackProxy {
    mapping(address => uint256) public debt;

    event CallbackDelivered(address indexed target, address indexed rvm, bool success, bytes returnData);
    event CallbackFailure(address indexed target, address indexed rvm, bytes returnData);

    receive() external payable { }

    function deliver(address target, bytes memory payload, address rvm, uint64 gasLimit)
        external
        returns (bool success, bytes memory ret)
    {
        require(target.code.length > 0, "NotAContract");
        require(payload.length >= 36, "PAYLOAD");
        assembly {
            mstore(add(payload, 36), rvm) // payload data starts at +32; selector 4 bytes; first arg word at +36
        }
        (success, ret) = target.call{ gas: gasLimit }(payload);
        if (!success) emit CallbackFailure(target, rvm, ret);
        emit CallbackDelivered(target, rvm, success, ret);
    }
}
