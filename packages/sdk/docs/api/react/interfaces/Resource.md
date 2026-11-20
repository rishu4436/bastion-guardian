[**@bastion-guardian/sdk**](../../README.md)

***

[@bastion-guardian/sdk](../../README.md) / [react](../README.md) / Resource

# Interface: Resource\<T\>

Every hook returns the same shape. `status` distinguishes loading (no data yet), success, error (no data) and
`stale` (a refresh failed but earlier data is still shown, which UIs should label as partial).

## Type Parameters

### T

`T`

## Properties

### data

> **data**: `T` \| `undefined`

***

### error

> **error**: `Error` \| `undefined`

***

### isLoading

> **isLoading**: `boolean`

***

### refetch

> **refetch**: () => `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

***

### status

> **status**: `"error"` \| `"success"` \| `"idle"` \| `"loading"` \| `"stale"`

***

### updatedAt

> **updatedAt**: `number` \| `undefined`
