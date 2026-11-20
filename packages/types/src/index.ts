import { z } from "zod";

/** EVM address (checksum not enforced at schema level; normalise with viem `getAddress` where needed). */
export const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "invalid EVM address");
export type Address = `0x${string}`;

export const Bytes32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "invalid bytes32");
export type Hex = `0x${string}`;

/** Token amounts travel as decimal strings of integer base units — never floats. */
export const BaseUnitsSchema = z.string().regex(/^\d+$/, "amount must be a non-negative integer string");

/** 1e18 fixed-point (Aave convention) health factor / WAD values encoded as decimal strings. */
export const WadSchema = BaseUnitsSchema;

export const SupportedChainIdSchema = z.union([z.literal(84532), z.literal(1301), z.literal(5318007)]);
export type SupportedChainId = z.infer<typeof SupportedChainIdSchema>;

export const PATH_FLASH = 1 as const;
export const PATH_SOLVER = 2 as const;

/** Mirrors BastionTypes.PolicyStatus. */
export enum PolicyStatus {
  None = 0,
  Active = 1,
  Paused = 2,
  Revoked = 3,
}

/** Mirrors RescueSettlementLedger.State (order is ABI-significant). */
export enum RescueState {
  None = 0,
  Requested = 1,
  Authorized = 2,
  SolverCommitted = 3,
  DestinationExecuted = 4,
  ExecutionFailed = 5,
  SettlementPending = 6,
  ReimbursementComplete = 7,
  ReimbursementDisputed = 8,
  RecoveryRequired = 9,
  Expired = 10,
  Cancelled = 11,
}

/** Guardian Mode readiness. Readiness is NOT a guarantee of rescue success. */
export const ReadinessStatusSchema = z.enum(["ARMED", "LIMITED", "UNAVAILABLE", "UNKNOWN"]);
export type ReadinessStatus = z.infer<typeof ReadinessStatusSchema>;

/** On-chain policy struct (BastionTypes.Policy), amounts as bigint. */
export interface Policy {
  owner: Address;
  account: Address;
  sourceChainId: bigint;
  destChainId: bigint;
  adapter: Address;
  market: Address;
  debtAsset: Address;
  collateralAsset: Address;
  triggerHealthFactor: bigint;
  targetHealthFactor: bigint;
  maxTotalRepay: bigint;
  maxRepayPerAction: bigint;
  maxTotalFees: bigint;
  maxSlippageBps: number;
  maxFeeBps: number;
  allowedPaths: number;
  allowPartial: boolean;
  expiry: bigint;
  cooldown: number;
  nonce: bigint;
  solversHash: Hex;
  recipientsHash: Hex;
}

/** Wire-format policy draft (JSON-safe). */
export const PolicyDraftSchema = z.object({
  owner: AddressSchema,
  account: AddressSchema,
  sourceChainId: z.number().int().positive(),
  destChainId: z.number().int().positive(),
  adapter: AddressSchema,
  market: AddressSchema,
  debtAsset: AddressSchema,
  collateralAsset: AddressSchema,
  triggerHealthFactor: WadSchema,
  targetHealthFactor: WadSchema,
  maxTotalRepay: BaseUnitsSchema,
  maxRepayPerAction: BaseUnitsSchema,
  maxTotalFees: BaseUnitsSchema,
  maxSlippageBps: z.number().int().min(0).max(1000),
  maxFeeBps: z.number().int().min(0).max(1000),
  allowedPaths: z.number().int().min(1).max(3),
  allowPartial: z.boolean(),
  expiry: z.number().int().positive(),
  cooldown: z.number().int().min(0),
  nonce: BaseUnitsSchema,
  solvers: z.array(AddressSchema).max(16),
  recipients: z.array(AddressSchema).max(8),
});
export type PolicyDraft = z.infer<typeof PolicyDraftSchema>;

/** Aave-style lending position snapshot (BastionTypes.Position). */
export interface Position {
  totalCollateralBase: bigint;
  totalDebtBase: bigint;
  currentLiquidationThreshold: bigint; // bps
  healthFactor: bigint; // WAD
  debtAmount: bigint;
  collateralAmount: bigint;
  debtPrice: bigint;
  collateralPrice: bigint;
  debtDecimals: number;
  collateralDecimals: number;
  collateralLiquidationThreshold: bigint; // bps
}

/** Provenance labels: every displayed number must say where it came from. */
export const ProvenanceSchema = z.enum([
  "ONCHAIN_FACT", // read from chain state / receipt
  "DERIVED_ESTIMATE", // computed off-chain from on-chain inputs
  "SIMULATED", // hypothetical scenario output
  "FIXTURE", // labeled test fixture, not a real protocol
]);
export type Provenance = z.infer<typeof ProvenanceSchema>;

/** Notification classes (Section 14). */
export const NotificationEventSchema = z.enum([
  "RISK_WARNING",
  "CRITICAL_RISK_WARNING",
  "RESCUE_INITIATED",
  "RESCUE_SUCCESSFUL",
  "RESCUE_FAILED",
  "SOLVER_PAYOUT_PENDING",
  "SOLVER_PAYOUT_COMPLETED",
  "PROTECTION_CAPACITY_LOW",
  "GUARDIAN_READINESS_DEGRADED",
  "PROTECTION_UNAVAILABLE",
  "POLICY_EXPIRING",
  "POLICY_REVOKED",
  "WEEKLY_DIGEST",
]);
export type NotificationEvent = z.infer<typeof NotificationEventSchema>;

/** Delivery lifecycle — provider acceptance is never treated as delivery or read. */
export const DeliveryStateSchema = z.enum([
  "EVENT_OBSERVED",
  "EVENT_CONFIRMED",
  "QUEUED",
  "PROVIDER_ACCEPTED",
  "PROVIDER_DELIVERED",
  "USER_OPENED",
  "FAILED",
  "SUPPRESSED",
]);
export type DeliveryState = z.infer<typeof DeliveryStateSchema>;
