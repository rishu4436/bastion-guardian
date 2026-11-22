[**@bastion-guardian/sdk**](../../README.md)

***

[@bastion-guardian/sdk](../../README.md) / [react](../README.md) / ProtectWithBastionProps

# Interface: ProtectWithBastionProps

## Properties

### account?

> `optional` **account?**: `` `0x${string}` ``

Borrower account whose lending position should be protected.

***

### appUrl

> **appUrl**: `string`

BASTION web app origin; the button links to its policy wizard.

***

### chainId?

> `optional` **chainId?**: `number`

Destination chain of the lending position (e.g. 84532 Base Sepolia, 31337 local simulation).

***

### onProtect?

> `optional` **onProtect?**: (`url`) => `void`

Called instead of navigating, e.g. to open the wizard in a modal.

#### Parameters

##### url

`string`

#### Returns

`void`

***

### refreshMs?

> `optional` **refreshMs?**: `number`

Refresh interval for the status badge (ms). Default 30 s.

***

### style?

> `optional` **style?**: `CSSProperties`

***

### theme?

> `optional` **theme?**: `"dark"` \| `"light"`
