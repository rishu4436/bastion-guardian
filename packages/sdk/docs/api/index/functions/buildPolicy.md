[**@bastion-guardian/sdk**](../../README.md)

***

[@bastion-guardian/sdk](../../README.md) / [index](../README.md) / buildPolicy

# Function: buildPolicy()

> **buildPolicy**(`draft`): [`Policy`](../interfaces/Policy.md)

Validate a JSON draft and convert it into the on-chain Policy struct.

## Parameters

### draft

#### account

`string` = `AddressSchema`

#### adapter

`string` = `AddressSchema`

#### allowedPaths

`number` = `...`

#### allowPartial

`boolean` = `...`

#### collateralAsset

`string` = `AddressSchema`

#### cooldown

`number` = `...`

#### debtAsset

`string` = `AddressSchema`

#### destChainId

`number` = `...`

#### expiry

`number` = `...`

#### market

`string` = `AddressSchema`

#### maxFeeBps

`number` = `...`

#### maxRepayPerAction

`string` = `BaseUnitsSchema`

#### maxSlippageBps

`number` = `...`

#### maxTotalFees

`string` = `BaseUnitsSchema`

#### maxTotalRepay

`string` = `BaseUnitsSchema`

#### nonce

`string` = `BaseUnitsSchema`

#### owner

`string` = `AddressSchema`

#### recipients

`string`[] = `...`

#### solvers

`string`[] = `...`

#### sourceChainId

`number` = `...`

#### targetHealthFactor

`string` = `WadSchema`

#### triggerHealthFactor

`string` = `WadSchema`

## Returns

[`Policy`](../interfaces/Policy.md)
