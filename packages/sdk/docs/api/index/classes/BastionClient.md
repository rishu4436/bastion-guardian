[**@bastion-guardian/sdk**](../../README.md)

***

[@bastion-guardian/sdk](../../README.md) / [index](../README.md) / BastionClient

# Class: BastionClient

Typed client for the BASTION Guardian API. Read methods are public; `me*` methods need a SIWE session.
The client never holds private keys: signing (SIWE, EIP-712 policies, transactions) happens in the user's wallet.

## Constructors

### Constructor

> **new BastionClient**(`opts`): `BastionClient`

#### Parameters

##### opts

[`BastionClientOptions`](../interfaces/BastionClientOptions.md)

#### Returns

`BastionClient`

## Properties

### baseUrl

> `readonly` **baseUrl**: `string`

## Accessors

### sessionCookie

#### Get Signature

> **get** **sessionCookie**(): `string` \| `undefined`

Session cookie captured from verify() in non-browser runtimes.

##### Returns

`string` \| `undefined`

## Methods

### analyticsDaily()

> **analyticsDaily**(`q`): `Promise`\<[`AnalyticsDaily`](../interfaces/AnalyticsDaily.md)\>

#### Parameters

##### q

###### chainId

`number`

###### from?

`string`

###### to?

`string`

#### Returns

`Promise`\<[`AnalyticsDaily`](../interfaces/AnalyticsDaily.md)\>

***

### chains()

> **chains**(): `Promise`\<\{ `chains`: [`ChainInfo`](../interfaces/ChainInfo.md)[]; \}\>

#### Returns

`Promise`\<\{ `chains`: [`ChainInfo`](../interfaces/ChainInfo.md)[]; \}\>

***

### channels()

> **channels**(): `Promise`\<\{ `items`: `Record`\<`string`, `unknown`\>[]; `providers`: `Record`\<`string`, `boolean`\>; \}\>

#### Returns

`Promise`\<\{ `items`: `Record`\<`string`, `unknown`\>[]; `providers`: `Record`\<`string`, `boolean`\>; \}\>

***

### deliveries()

> **deliveries**(): `Promise`\<[`Paged`](../interfaces/Paged.md)\<`Record`\<`string`, `unknown`\>\>\>

#### Returns

`Promise`\<[`Paged`](../interfaces/Paged.md)\<`Record`\<`string`, `unknown`\>\>\>

***

### deployments()

> **deployments**(`chainId`): `Promise`\<[`Deployments`](../interfaces/Deployments.md)\>

Recorded BASTION contract addresses on a chain. `mode` is "local_simulation" or "testnet"; null if none.

#### Parameters

##### chainId

`number`

#### Returns

`Promise`\<[`Deployments`](../interfaces/Deployments.md)\>

***

### health()

> **health**(): `Promise`\<\{\[`k`: `string`\]: `unknown`; `status`: `string`; \}\>

#### Returns

`Promise`\<\{\[`k`: `string`\]: `unknown`; `status`: `string`; \}\>

***

### linkChannel()

> **linkChannel**(`kind`, `destination`): `Promise`\<\{\[`k`: `string`\]: `unknown`; `id`: `string`; \}\>

#### Parameters

##### kind

`"telegram"` \| `"email"` \| `"sms"`

##### destination

`string`

#### Returns

`Promise`\<\{\[`k`: `string`\]: `unknown`; `id`: `string`; \}\>

***

### logout()

> **logout**(): `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

***

### me()

> **me**(): `Promise`\<\{ `address`: `` `0x${string}` ``; `chainId`: `number`; `roles`: `string`[]; `user`: \{ `createdAt`: `string`; `displayName`: `string` \| `null`; `id`: `string`; \}; `wallets`: `` `0x${string}` ``[]; \}\>

#### Returns

`Promise`\<\{ `address`: `` `0x${string}` ``; `chainId`: `number`; `roles`: `string`[]; `user`: \{ `createdAt`: `string`; `displayName`: `string` \| `null`; `id`: `string`; \}; `wallets`: `` `0x${string}` ``[]; \}\>

***

### myIncidents()

> **myIncidents**(): `Promise`\<[`Paged`](../interfaces/Paged.md)\<`Record`\<`string`, `unknown`\>\>\>

#### Returns

`Promise`\<[`Paged`](../interfaces/Paged.md)\<`Record`\<`string`, `unknown`\>\>\>

***

### myPolicies()

> **myPolicies**(): `Promise`\<[`Paged`](../interfaces/Paged.md)\<[`ProtectionPolicy`](../interfaces/ProtectionPolicy.md)\>\>

#### Returns

`Promise`\<[`Paged`](../interfaces/Paged.md)\<[`ProtectionPolicy`](../interfaces/ProtectionPolicy.md)\>\>

***

### nonce()

> **nonce**(): `Promise`\<\{ `nonce`: `string`; \}\>

#### Returns

`Promise`\<\{ `nonce`: `string`; \}\>

***

### notificationPreferences()

> **notificationPreferences**(): `Promise`\<`Record`\<`string`, `unknown`\>\>

#### Returns

`Promise`\<`Record`\<`string`, `unknown`\>\>

***

### policies()

> **policies**(`q?`): `Promise`\<[`Paged`](../interfaces/Paged.md)\<[`ProtectionPolicy`](../interfaces/ProtectionPolicy.md)\>\>

#### Parameters

##### q?

###### account?

`` `0x${string}` ``

###### chainId?

`number`

###### limit?

`number`

###### owner?

`` `0x${string}` ``

###### status?

`"Active"` \| `"Paused"` \| `"Revoked"`

#### Returns

`Promise`\<[`Paged`](../interfaces/Paged.md)\<[`ProtectionPolicy`](../interfaces/ProtectionPolicy.md)\>\>

***

### policy()

> **policy**(`chainId`, `policyId`): `Promise`\<[`PolicyDetail`](../interfaces/PolicyDetail.md)\>

#### Parameters

##### chainId

`number`

##### policyId

`` `0x${string}` ``

#### Returns

`Promise`\<[`PolicyDetail`](../interfaces/PolicyDetail.md)\>

***

### policyNonce()

> **policyNonce**(`chainId`, `owner`): `Promise`\<[`PolicyNonce`](../interfaces/PolicyNonce.md)\>

Next EIP-712 policy nonce for `owner`, read from BastionPolicyRegistry at the latest block.

#### Parameters

##### chainId

`number`

##### owner

`` `0x${string}` ``

#### Returns

`Promise`\<[`PolicyNonce`](../interfaces/PolicyNonce.md)\>

***

### position()

> **position**(`positionId`): `Promise`\<[`LendingPosition`](../interfaces/LendingPosition.md) & `object`\>

#### Parameters

##### positionId

`string`

#### Returns

`Promise`\<[`LendingPosition`](../interfaces/LendingPosition.md) & `object`\>

***

### positionObservations()

> **positionObservations**(`positionId`, `limit?`): `Promise`\<[`Paged`](../interfaces/Paged.md)\<[`PositionObservation`](../interfaces/PositionObservation.md)\>\>

#### Parameters

##### positionId

`string`

##### limit?

`number`

#### Returns

`Promise`\<[`Paged`](../interfaces/Paged.md)\<[`PositionObservation`](../interfaces/PositionObservation.md)\>\>

***

### positions()

> **positions**(`q?`): `Promise`\<[`Paged`](../interfaces/Paged.md)\<[`LendingPosition`](../interfaces/LendingPosition.md)\>\>

#### Parameters

##### q?

###### account?

`` `0x${string}` ``

###### chainId?

`number`

###### limit?

`number`

#### Returns

`Promise`\<[`Paged`](../interfaces/Paged.md)\<[`LendingPosition`](../interfaces/LendingPosition.md)\>\>

***

### proof()

> **proof**(`rescueId`): `Promise`\<[`ProofOfProtection`](../interfaces/ProofOfProtection.md)\>

#### Parameters

##### rescueId

`` `0x${string}` ``

#### Returns

`Promise`\<[`ProofOfProtection`](../interfaces/ProofOfProtection.md)\>

***

### proofPdfUrl()

> **proofPdfUrl**(`rescueId`): `string`

URL of the PDF rendering (open or download it directly).

#### Parameters

##### rescueId

`` `0x${string}` ``

#### Returns

`string`

***

### protocols()

> **protocols**(): `Promise`\<[`Paged`](../interfaces/Paged.md)\<[`Protocol`](../interfaces/Protocol.md)\>\>

#### Returns

`Promise`\<[`Paged`](../interfaces/Paged.md)\<[`Protocol`](../interfaces/Protocol.md)\>\>

***

### readinessHistory()

> **readinessHistory**(`chainId`, `policyId`, `limit?`): `Promise`\<[`Paged`](../interfaces/Paged.md)\<[`ReadinessSnapshot`](../interfaces/ReadinessSnapshot.md)\>\>

#### Parameters

##### chainId

`number`

##### policyId

`` `0x${string}` ``

##### limit?

`number`

#### Returns

`Promise`\<[`Paged`](../interfaces/Paged.md)\<[`ReadinessSnapshot`](../interfaces/ReadinessSnapshot.md)\>\>

***

### refreshCsrf()

> **refreshCsrf**(): `Promise`\<`string`\>

#### Returns

`Promise`\<`string`\>

***

### registerDevice()

> **registerDevice**(`sub`): `Promise`\<\{ `id`: `string`; \}\>

Register a Web Push subscription (PushSubscription.toJSON()).

#### Parameters

##### sub

###### endpoint

`string`

###### keys

\{ `auth`: `string`; `p256dh`: `string`; \}

###### keys.auth

`string`

###### keys.p256dh

`string`

#### Returns

`Promise`\<\{ `id`: `string`; \}\>

***

### removeDevice()

> **removeDevice**(`id`): `Promise`\<\{ `ok`: `boolean`; \}\>

#### Parameters

##### id

`string`

#### Returns

`Promise`\<\{ `ok`: `boolean`; \}\>

***

### rescue()

> **rescue**(`rescueId`): `Promise`\<[`RescueReceipt`](../interfaces/RescueReceipt.md)\>

#### Parameters

##### rescueId

`` `0x${string}` ``

#### Returns

`Promise`\<[`RescueReceipt`](../interfaces/RescueReceipt.md)\>

***

### rescues()

> **rescues**(`q?`): `Promise`\<[`Paged`](../interfaces/Paged.md)\<[`RescueSummary`](../interfaces/RescueSummary.md)\>\>

#### Parameters

##### q?

###### chainId?

`number`

###### limit?

`number`

###### policyId?

`` `0x${string}` ``

###### state?

`string`

#### Returns

`Promise`\<[`Paged`](../interfaces/Paged.md)\<[`RescueSummary`](../interfaces/RescueSummary.md)\>\>

***

### riskObservations()

> **riskObservations**(`q?`): `Promise`\<[`Paged`](../interfaces/Paged.md)\<[`RiskObservation`](../interfaces/RiskObservation.md)\>\>

#### Parameters

##### q?

###### chainId?

`number`

###### limit?

`number`

###### policyId?

`` `0x${string}` ``

#### Returns

`Promise`\<[`Paged`](../interfaces/Paged.md)\<[`RiskObservation`](../interfaces/RiskObservation.md)\>\>

***

### sendTestNotification()

> **sendTestNotification**(`kind`): `Promise`\<\{ `deliveryId`: `string`; \}\>

#### Parameters

##### kind

`string`

#### Returns

`Promise`\<\{ `deliveryId`: `string`; \}\>

***

### session()

> **session**(): `Promise`\<[`Session`](../interfaces/Session.md)\>

#### Returns

`Promise`\<[`Session`](../interfaces/Session.md)\>

***

### setNotificationPreferences()

> **setNotificationPreferences**(`p`): `Promise`\<`Record`\<`string`, `unknown`\>\>

#### Parameters

##### p

`Record`\<`string`, `unknown`\>

#### Returns

`Promise`\<`Record`\<`string`, `unknown`\>\>

***

### settlements()

> **settlements**(`q?`): `Promise`\<[`Paged`](../interfaces/Paged.md)\<[`SettlementClaim`](../interfaces/SettlementClaim.md)\>\>

#### Parameters

##### q?

###### limit?

`number`

###### state?

[`SettlementStateName`](../type-aliases/SettlementStateName.md)

#### Returns

`Promise`\<[`Paged`](../interfaces/Paged.md)\<[`SettlementClaim`](../interfaces/SettlementClaim.md)\>\>

***

### simulateScenario()

> **simulateScenario**(`body`): `Promise`\<[`ScenarioResponse`](../interfaces/ScenarioResponse.md)\>

#### Parameters

##### body

[`ScenarioRequest`](../interfaces/ScenarioRequest.md)

#### Returns

`Promise`\<[`ScenarioResponse`](../interfaces/ScenarioResponse.md)\>

***

### simulationPresets()

> **simulationPresets**(): `Promise`\<\{ `presets`: [`SimulationPreset`](../interfaces/SimulationPreset.md)[]; \}\>

#### Returns

`Promise`\<\{ `presets`: [`SimulationPreset`](../interfaces/SimulationPreset.md)[]; \}\>

***

### solver()

> **solver**(`chainId`, `address`): `Promise`\<[`SolverDetail`](../interfaces/SolverDetail.md)\>

#### Parameters

##### chainId

`number`

##### address

`` `0x${string}` ``

#### Returns

`Promise`\<[`SolverDetail`](../interfaces/SolverDetail.md)\>

***

### solverDemand()

> **solverDemand**(`chainId`): `Promise`\<\{ `chainId`: `number`; `items`: `Record`\<`string`, `unknown`\>[]; `note`: `string`; \}\>

#### Parameters

##### chainId

`number`

#### Returns

`Promise`\<\{ `chainId`: `number`; `items`: `Record`\<`string`, `unknown`\>[]; `note`: `string`; \}\>

***

### solvers()

> **solvers**(`q?`): `Promise`\<[`Paged`](../interfaces/Paged.md)\<[`SolverSummary`](../interfaces/SolverSummary.md)\>\>

#### Parameters

##### q?

###### chainId?

`number`

#### Returns

`Promise`\<[`Paged`](../interfaces/Paged.md)\<[`SolverSummary`](../interfaces/SolverSummary.md)\>\>

***

### stream()

> **stream**(`onEvent`, `o?`): `Promise`\<`string` \| `undefined`\>

Server-Sent Events over fetch (works in browsers, Node and React Native with streaming fetch). Resumes from
`lastEventId`. Resolves when the stream ends or `signal` aborts.

#### Parameters

##### onEvent

(`e`) => `void`

##### o?

###### chainId?

`number`

###### lastEventId?

`string`

###### policyId?

`` `0x${string}` ``

###### signal?

`AbortSignal`

#### Returns

`Promise`\<`string` \| `undefined`\>

***

### systemStatus()

> **systemStatus**(): `Promise`\<[`SystemStatus`](../interfaces/SystemStatus.md)\>

#### Returns

`Promise`\<[`SystemStatus`](../interfaces/SystemStatus.md)\>

***

### tokens()

> **tokens**(`q?`): `Promise`\<[`Paged`](../interfaces/Paged.md)\<[`Token`](../interfaces/Token.md)\>\>

#### Parameters

##### q?

###### chainId?

`number`

#### Returns

`Promise`\<[`Paged`](../interfaces/Paged.md)\<[`Token`](../interfaces/Token.md)\>\>

***

### unlinkChannel()

> **unlinkChannel**(`id`): `Promise`\<\{ `ok`: `boolean`; \}\>

#### Parameters

##### id

`string`

#### Returns

`Promise`\<\{ `ok`: `boolean`; \}\>

***

### verify()

> **verify**(`message`, `signature`): `Promise`\<[`Session`](../interfaces/Session.md)\>

Exchange a signed EIP-4361 message for a session. The wallet signs; this SDK never sees a private key.

#### Parameters

##### message

`string`

##### signature

`` `0x${string}` ``

#### Returns

`Promise`\<[`Session`](../interfaces/Session.md)\>

***

### verifyChannel()

> **verifyChannel**(`id`, `code`): `Promise`\<\{ `id`: `string`; `status`: `"active"`; \}\>

#### Parameters

##### id

`string`

##### code

`string`

#### Returns

`Promise`\<\{ `id`: `string`; `status`: `"active"`; \}\>

***

### webPushKey()

> **webPushKey**(): `Promise`\<\{ `publicKey`: `string` \| `null`; \}\>

#### Returns

`Promise`\<\{ `publicKey`: `string` \| `null`; \}\>
