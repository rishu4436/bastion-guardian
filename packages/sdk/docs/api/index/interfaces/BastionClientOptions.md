[**@bastion-guardian/sdk**](../../README.md)

***

[@bastion-guardian/sdk](../../README.md) / [index](../README.md) / BastionClientOptions

# Interface: BastionClientOptions

## Properties

### baseUrl

> **baseUrl**: `string`

API origin, e.g. "https://api.example.com" (no trailing /v1).

***

### cookie?

> `optional` **cookie?**: `string`

Explicit Cookie header for non-browser runtimes (Node, React Native).

***

### credentials?

> `optional` **credentials?**: `RequestCredentials`

"include" (browsers on an allowed origin) sends the httpOnly session cookie. Native apps that cannot hold cookies
pass `cookie` instead (see `sessionCookie`).

***

### fetch?

> `optional` **fetch?**: (`input`, `init?`) => `Promise`\<`Response`\>

Custom fetch (tests, React Native, SSR). Defaults to globalThis.fetch.

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Window/fetch)

#### Parameters

##### input

`RequestInfo` \| `URL`

##### init?

`RequestInit`

#### Returns

`Promise`\<`Response`\>

***

### headers?

> `optional` **headers?**: `Record`\<`string`, `string`\>

Extra headers on every request.
