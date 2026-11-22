[**@bastion-guardian/sdk**](../../README.md)

***

[@bastion-guardian/sdk](../../README.md) / [react](../README.md) / ProtectionStatus

# Interface: ProtectionStatus

## Properties

### detail

> **detail**: [`PolicyDetail`](../../index/interfaces/PolicyDetail.md) \| `null`

***

### healthFactorWad

> **healthFactorWad**: `string` \| `null`

Latest observed health factor (WAD string), if a position is indexed.

***

### policy

> **policy**: [`ProtectionPolicy`](../../index/interfaces/ProtectionPolicy.md) \| `null`

***

### provenance

> **provenance**: `string` \| `null`

***

### readiness

> **readiness**: [`ReadinessSnapshot`](../../index/interfaces/ReadinessSnapshot.md) \| `null`

***

### status

> **status**: `"ARMED"` \| `"LIMITED"` \| `"UNAVAILABLE"` \| `"UNKNOWN"` \| `"UNPROTECTED"` \| `"PAUSED"` \| `"REVOKED"`

Combined label for UIs. "UNPROTECTED" when no active policy exists.

***

### targetHealthFactorWad

> **targetHealthFactorWad**: `string` \| `null`

***

### triggerHealthFactorWad

> **triggerHealthFactorWad**: `string` \| `null`
