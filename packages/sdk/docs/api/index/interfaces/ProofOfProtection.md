[**@bastion-guardian/sdk**](../../README.md)

***

[@bastion-guardian/sdk](../../README.md) / [index](../README.md) / ProofOfProtection

# Interface: ProofOfProtection

## Properties

### disclaimer

> **disclaimer**: `string`

***

### environment

> **environment**: `"LOCAL_SIMULATION"` \| `"TESTNET"`

***

### facts

> **facts**: `object`

#### chainId

> **chainId**: `number`

#### chainName

> **chainName**: `string`

#### debtToken

> **debtToken**: \{ `address`: `` `0x${string}` ``; `decimals`: `number`; `symbol`: `string`; \} \| `null`

#### executions

> **executions**: `Record`\<`string`, `unknown`\>[]

#### intent

> **intent**: `Record`\<`string`, `unknown`\> \| `null`

#### policy

> **policy**: `Record`\<`string`, `unknown`\> \| `null`

#### settlementClaim

> **settlementClaim**: `Record`\<`string`, `unknown`\> \| `null`

#### settlementEvents

> **settlementEvents**: `Record`\<`string`, `unknown`\>[]

#### solverFills

> **solverFills**: `Record`\<`string`, `unknown`\>[]

***

### generatedAt

> **generatedAt**: `string`

***

### outcome

> **outcome**: `object`

#### fee

> **fee**: `string` \| `null`

#### healthFactorAfterWad

> **healthFactorAfterWad**: `string` \| `null`

#### healthFactorBeforeWad

> **healthFactorBeforeWad**: `string` \| `null`

#### path

> **path**: `string` \| `null`

#### repaid

> **repaid**: `string` \| `null`

#### rescued

> **rescued**: `boolean`

#### settlement

> **settlement**: [`SettlementStateName`](../type-aliases/SettlementStateName.md) \| `null`

***

### rescueId

> **rescueId**: `` `0x${string}` ``

***

### schema

> **schema**: `"bastion.proof-of-protection/v1"`

***

### verification

> **verification**: `object`

#### algorithm

> **algorithm**: `string`

#### contentHash

> **contentHash**: `string`

#### howTo

> **howTo**: `string`[]
