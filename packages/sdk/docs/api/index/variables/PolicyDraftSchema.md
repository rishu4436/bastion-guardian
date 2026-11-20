[**@bastion-guardian/sdk**](../../README.md)

***

[@bastion-guardian/sdk](../../README.md) / [index](../README.md) / PolicyDraftSchema

# Variable: PolicyDraftSchema

> `const` **PolicyDraftSchema**: `ZodObject`\<\{ `account`: `ZodString`; `adapter`: `ZodString`; `allowedPaths`: `ZodNumber`; `allowPartial`: `ZodBoolean`; `collateralAsset`: `ZodString`; `cooldown`: `ZodNumber`; `debtAsset`: `ZodString`; `destChainId`: `ZodNumber`; `expiry`: `ZodNumber`; `market`: `ZodString`; `maxFeeBps`: `ZodNumber`; `maxRepayPerAction`: `ZodString`; `maxSlippageBps`: `ZodNumber`; `maxTotalFees`: `ZodString`; `maxTotalRepay`: `ZodString`; `nonce`: `ZodString`; `owner`: `ZodString`; `recipients`: `ZodArray`\<`ZodString`\>; `solvers`: `ZodArray`\<`ZodString`\>; `sourceChainId`: `ZodNumber`; `targetHealthFactor`: `ZodString`; `triggerHealthFactor`: `ZodString`; \}, `$strip`\>

Wire-format policy draft (JSON-safe).
