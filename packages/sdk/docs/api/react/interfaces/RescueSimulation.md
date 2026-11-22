[**@bastion-guardian/sdk**](../../README.md)

***

[@bastion-guardian/sdk](../../README.md) / [react](../README.md) / RescueSimulation

# Interface: RescueSimulation

## Properties

### error

> **error**: `Error` \| `undefined`

***

### presets

> **presets**: [`Resource`](Resource.md)\<[`SimulationPreset`](../../index/interfaces/SimulationPreset.md)[]\>

***

### result

> **result**: [`ScenarioResponse`](../../index/interfaces/ScenarioResponse.md) \| `undefined`

***

### run

> **run**: (`req`) => `Promise`\<[`ScenarioResponse`](../../index/interfaces/ScenarioResponse.md)\>

#### Parameters

##### req

[`ScenarioRequest`](../../index/interfaces/ScenarioRequest.md)

#### Returns

`Promise`\<[`ScenarioResponse`](../../index/interfaces/ScenarioResponse.md)\>

***

### running

> **running**: `boolean`
