import {
  encodePacked,
  hashTypedData,
  keccak256,
  encodeAbiParameters,
  getAddress,
  type TypedDataDomain,
} from "viem";
import {
  PolicyDraftSchema,
  type Address,
  type Hex,
  type Policy,
  type PolicyDraft,
} from "@bastion-guardian/types";

/** Must equal BastionPolicyRegistry's EIP712("BASTION Policy Registry", "1"). */
export const POLICY_DOMAIN_NAME = "BASTION Policy Registry";
export const POLICY_DOMAIN_VERSION = "1";

export const POLICY_TYPES = {
  Policy: [
    { name: "owner", type: "address" },
    { name: "account", type: "address" },
    { name: "sourceChainId", type: "uint256" },
    { name: "destChainId", type: "uint256" },
    { name: "adapter", type: "address" },
    { name: "market", type: "address" },
    { name: "debtAsset", type: "address" },
    { name: "collateralAsset", type: "address" },
    { name: "triggerHealthFactor", type: "uint256" },
    { name: "targetHealthFactor", type: "uint256" },
    { name: "maxTotalRepay", type: "uint256" },
    { name: "maxRepayPerAction", type: "uint256" },
    { name: "maxTotalFees", type: "uint256" },
    { name: "maxSlippageBps", type: "uint16" },
    { name: "maxFeeBps", type: "uint16" },
    { name: "allowedPaths", type: "uint8" },
    { name: "allowPartial", type: "bool" },
    { name: "expiry", type: "uint64" },
    { name: "cooldown", type: "uint32" },
    { name: "nonce", type: "uint256" },
    { name: "solversHash", type: "bytes32" },
    { name: "recipientsHash", type: "bytes32" },
  ],
} as const;

export function addressListHash(list: readonly string[]): Hex {
  return keccak256(encodePacked(["address[]"], [list.map((a) => getAddress(a))]));
}

/** Validate a JSON draft and convert it into the on-chain Policy struct. */
export function buildPolicy(draft: PolicyDraft): Policy {
  const d = PolicyDraftSchema.parse(draft);
  const trigger = BigInt(d.triggerHealthFactor);
  const target = BigInt(d.targetHealthFactor);
  if (trigger < 10n ** 18n) throw new Error("trigger health factor must be >= 1.0");
  if (target <= trigger) throw new Error("target health factor must exceed trigger");
  if (BigInt(d.maxRepayPerAction) > BigInt(d.maxTotalRepay))
    throw new Error("per-action cap exceeds total cap");
  return {
    owner: getAddress(d.owner),
    account: getAddress(d.account),
    sourceChainId: BigInt(d.sourceChainId),
    destChainId: BigInt(d.destChainId),
    adapter: getAddress(d.adapter),
    market: getAddress(d.market),
    debtAsset: getAddress(d.debtAsset),
    collateralAsset: getAddress(d.collateralAsset),
    triggerHealthFactor: trigger,
    targetHealthFactor: target,
    maxTotalRepay: BigInt(d.maxTotalRepay),
    maxRepayPerAction: BigInt(d.maxRepayPerAction),
    maxTotalFees: BigInt(d.maxTotalFees),
    maxSlippageBps: d.maxSlippageBps,
    maxFeeBps: d.maxFeeBps,
    allowedPaths: d.allowedPaths,
    allowPartial: d.allowPartial,
    expiry: BigInt(d.expiry),
    cooldown: d.cooldown,
    nonce: BigInt(d.nonce),
    solversHash: addressListHash(d.solvers),
    recipientsHash: addressListHash(d.recipients),
  };
}

export function policyDomain(chainId: number | bigint, registry: Address): TypedDataDomain {
  return {
    name: POLICY_DOMAIN_NAME,
    version: POLICY_DOMAIN_VERSION,
    chainId: Number(chainId),
    verifyingContract: registry,
  };
}

/** EIP-712 digest equal to BastionPolicyRegistry.policyDigest(p). */
export function policyDigest(p: Policy, chainId: number | bigint, registry: Address): Hex {
  return hashTypedData({
    domain: policyDomain(chainId, registry),
    types: POLICY_TYPES,
    primaryType: "Policy",
    message: p,
  });
}

/** Equal to BastionPolicyRegistry.policyIdOf(p). */
export function policyIdOf(p: Policy): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
      ],
      [p.owner, p.account, p.adapter, p.market, p.debtAsset, p.collateralAsset, p.destChainId],
    ),
  );
}

/** Typed-data payload a wallet signs (eth_signTypedData_v4). Signing happens in the user's wallet only. */
export function policyTypedData(p: Policy, chainId: number | bigint, registry: Address) {
  return {
    domain: policyDomain(chainId, registry),
    types: POLICY_TYPES,
    primaryType: "Policy" as const,
    message: p,
  };
}
