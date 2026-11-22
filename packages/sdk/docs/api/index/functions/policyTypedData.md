[**@bastion-guardian/sdk**](../../README.md)

***

[@bastion-guardian/sdk](../../README.md) / [index](../README.md) / policyTypedData

# Function: policyTypedData()

> **policyTypedData**(`p`, `chainId`, `registry`): `object`

Typed-data payload a wallet signs (eth_signTypedData_v4). Signing happens in the user's wallet only.

## Parameters

### p

[`Policy`](../interfaces/Policy.md)

### chainId

`number` \| `bigint`

### registry

`` `0x${string}` ``

## Returns

`object`

### domain

> **domain**: `TypedDataDomain`

### message

> **message**: [`Policy`](../interfaces/Policy.md) = `p`

### primaryType

> **primaryType**: `"Policy"`

### types

> **types**: `object` = `POLICY_TYPES`

#### types.Policy

> `readonly` **Policy**: readonly \[\{ `name`: `"owner"`; `type`: `"address"`; \}, \{ `name`: `"account"`; `type`: `"address"`; \}, \{ `name`: `"sourceChainId"`; `type`: `"uint256"`; \}, \{ `name`: `"destChainId"`; `type`: `"uint256"`; \}, \{ `name`: `"adapter"`; `type`: `"address"`; \}, \{ `name`: `"market"`; `type`: `"address"`; \}, \{ `name`: `"debtAsset"`; `type`: `"address"`; \}, \{ `name`: `"collateralAsset"`; `type`: `"address"`; \}, \{ `name`: `"triggerHealthFactor"`; `type`: `"uint256"`; \}, \{ `name`: `"targetHealthFactor"`; `type`: `"uint256"`; \}, \{ `name`: `"maxTotalRepay"`; `type`: `"uint256"`; \}, \{ `name`: `"maxRepayPerAction"`; `type`: `"uint256"`; \}, \{ `name`: `"maxTotalFees"`; `type`: `"uint256"`; \}, \{ `name`: `"maxSlippageBps"`; `type`: `"uint16"`; \}, \{ `name`: `"maxFeeBps"`; `type`: `"uint16"`; \}, \{ `name`: `"allowedPaths"`; `type`: `"uint8"`; \}, \{ `name`: `"allowPartial"`; `type`: `"bool"`; \}, \{ `name`: `"expiry"`; `type`: `"uint64"`; \}, \{ `name`: `"cooldown"`; `type`: `"uint32"`; \}, \{ `name`: `"nonce"`; `type`: `"uint256"`; \}, \{ `name`: `"solversHash"`; `type`: `"bytes32"`; \}, \{ `name`: `"recipientsHash"`; `type`: `"bytes32"`; \}\]
