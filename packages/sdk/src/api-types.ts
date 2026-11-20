/**
 * Wire types for the BASTION Guardian HTTP API (/v1). Token amounts, health factors (1e18 WAD) and block numbers are
 * decimal strings of integers, never floats. Timestamps are ISO-8601 strings in UTC.
 */
import type { ReadinessStatus } from "@bastion-guardian/types";

export type Address = `0x${string}`;
export type Hex = `0x${string}`;
export type Uint = string;
export type IsoTime = string;

export type PolicyStatusName = "Active" | "Paused" | "Revoked" | "Expired" | "Superseded";
export type RescueStateName =
  | "None"
  | "Requested"
  | "Authorized"
  | "SolverCommitted"
  | "DestinationExecuted"
  | "ExecutionFailed"
  | "SettlementPending"
  | "ReimbursementComplete"
  | "ReimbursementDisputed"
  | "RecoveryRequired"
  | "Expired"
  | "Cancelled";
export type SettlementStateName = "Pending" | "Reimbursed" | "RecoveryRequired" | "Disputed";
export type Role = "borrower" | "solver" | "auditor" | "integrator" | "admin";

export interface ReadinessCheck {
  id: string;
  label?: string;
  ok?: boolean;
  status?: string;
  detail?: string;
  [k: string]: unknown;
}

export interface ReadinessSnapshot {
  id: number;
  chainId: number;
  policyId: Hex;
  status: ReadinessStatus;
  checks: ReadinessCheck[] | Record<string, unknown>;
  evaluatedAt: IsoTime;
  dataAsOf: IsoTime | null;
}

export interface ProtectionPolicy {
  chainId: number;
  policyId: Hex;
  owner: Address;
  account: Address;
  adapter: Address;
  market: Address;
  debtAsset: Address;
  collateralAsset: Address;
  status: PolicyStatusName;
  currentVersion: number;
  registeredAt: IsoTime;
  updatedAt: IsoTime;
  readiness?: ReadinessSnapshot | null;
}

export interface PolicyVersion {
  chainId: number;
  policyId: Hex;
  version: number;
  sourceChainId: number;
  destChainId: number;
  triggerHealthFactorWad: Uint;
  targetHealthFactorWad: Uint;
  maxTotalRepay: Uint;
  maxRepayPerAction: Uint;
  maxTotalFees: Uint;
  maxSlippageBps: number;
  maxFeeBps: number;
  allowedPaths: number;
  allowPartial: boolean;
  expiry: IsoTime;
  cooldownSeconds: number;
  nonce: Uint;
  solversHash: Hex;
  recipientsHash: Hex;
  solvers: Address[];
  registeredTxHash: Hex;
  registeredBlock: Uint;
}

export interface PolicyAuthorization {
  id: string;
  chainId: number;
  policyId: Hex | null;
  owner: Address;
  kind:
    "direct" | "eip712" | "eip1271" | "atoken_approval" | "pull_cap" | "reserve_budget" | "account_delegate";
  subject: Address;
  asset: Address | null;
  amount: Uint | null;
  txHash: Hex | null;
  blockNumber: Uint | null;
  observedAt: IsoTime;
  revokedAt: IsoTime | null;
}

export interface ReserveBudget {
  chainId: number;
  vault: Address;
  owner: Address;
  policyId: Hex;
  token: Address;
  repayReserve: Uint;
  feeReserve: Uint;
  maxFeeBps: number;
  totalReimbursed: Uint;
  pausedAt: IsoTime | null;
  releaseRequestedAt: IsoTime | null;
  updatedBlock: Uint;
  updatedAt: IsoTime;
}

export interface LendingPosition {
  id: string;
  chainId: number;
  protocolId: string;
  account: Address;
  collateralAsset: Address;
  debtAsset: Address;
  collateralAmount: Uint;
  debtAmount: Uint;
  healthFactorWad: Uint;
  liquidationThresholdBps: number;
  observedBlock: Uint;
  observedAt: IsoTime;
  historyIncomplete: boolean;
}

export interface PositionObservation {
  id: number;
  positionId: string;
  blockNumber: Uint;
  blockHash: Hex;
  observedAt: IsoTime;
  collateralAmount: Uint;
  debtAmount: Uint;
  collateralBase: Uint;
  debtBase: Uint;
  healthFactorWad: Uint;
  liquidationThresholdBps: number;
  source: "chain" | "simulated";
}

export interface RiskObservation {
  id: number;
  chainId: number;
  policyId: Hex;
  policyVersion: number;
  account: Address;
  healthFactorWad: Uint;
  triggerHealthFactorWad: Uint;
  observedAt: IsoTime;
  blockNumber: Uint;
  blockHash: Hex;
  txHash: Hex;
  logIndex: number;
}

export interface RescueExecution {
  id: number;
  rescueId: Hex;
  chainId: number;
  /** 1 = flash, 2 = solver */
  path: number;
  success: boolean;
  reason: string | null;
  debtBefore: Uint | null;
  debtAfter: Uint | null;
  healthFactorBeforeWad: Uint | null;
  healthFactorAfterWad: Uint | null;
  repaid: Uint | null;
  fee: Uint | null;
  solver: Address | null;
  blockNumber: Uint;
  blockHash: Hex;
  txHash: Hex;
  logIndex: number;
  blockTimestamp: IsoTime | null;
}

export interface RescueIntent {
  rescueId: Hex;
  chainId: number;
  policyId: Hex;
  policyVersion: number;
  originEventId: Hex;
  originChainId: number | null;
  originTxHash: Hex | null;
  reactiveTxHash: Hex | null;
  state: RescueStateName;
  createdAt: IsoTime;
  updatedAt: IsoTime;
}

export interface RescueSummary extends RescueIntent {
  executions: RescueExecution[];
}

export interface SolverFill {
  id: number;
  chainId: number;
  rescueId: Hex;
  solver: Address;
  payout: Address;
  policyOwner: Address;
  principal: Uint;
  fee: Uint;
  blockNumber: Uint;
  blockHash: Hex;
  txHash: Hex;
  logIndex: number;
}

export interface SettlementClaim {
  rescueId: Hex;
  reserveChainId: number;
  destChainId: number;
  policyId: Hex;
  policyOwner: Address;
  recipient: Address;
  principal: Uint;
  fee: Uint;
  state: SettlementStateName;
  attempts: number;
  lastError: string | null;
  destExecutedAt: IsoTime | null;
  overdueSince: IsoTime | null;
  updatedAt: IsoTime;
}

export interface SettlementEvent {
  id: number;
  rescueId: Hex;
  chainId: number;
  kind:
    | "solver_executed"
    | "reimbursed"
    | "failed"
    | "duplicate_ignored"
    | "untrusted_rejected"
    | "disputed"
    | "acknowledged";
  blockNumber: Uint;
  blockHash: Hex;
  txHash: Hex;
  logIndex: number;
  data: Record<string, unknown>;
}

export interface RescueReceipt {
  intent: RescueIntent | null;
  executions: RescueExecution[];
  solverFills: SolverFill[];
  settlementClaim: SettlementClaim | null;
  settlementEvents: SettlementEvent[];
  provenance: string;
}

export interface PolicyDetail {
  policy: ProtectionPolicy;
  versions: PolicyVersion[];
  authorizations: PolicyAuthorization[];
  budgets: ReserveBudget[];
  rescues: RescueIntent[];
  positions: LendingPosition[];
  readiness: ReadinessSnapshot | null;
  provenance: string;
}

export interface SolverRegistration {
  chainId: number;
  solver: Address;
  payout: Address;
  bond: Uint;
  metadataUri: string | null;
  status: "active" | "suspended" | "exiting" | "exited";
  totalFilled: Uint;
  fills: number;
  failures: number;
  registeredBlock: Uint;
  updatedAt: IsoTime;
}

export interface SolverSummary extends SolverRegistration {
  activeCommitments: number;
  committedRemaining: Uint;
}

export interface SolverCommitment {
  chainId: number;
  commitmentId: Hex;
  solver: Address;
  policyId: Hex;
  token: Address;
  amount: Uint;
  remaining: Uint;
  feeBps: number;
  expiry: IsoTime;
  state: "active" | "drawn" | "released" | "expired";
  createdBlock: Uint;
  updatedAt: IsoTime;
}

export interface SolverDetail {
  solver: SolverRegistration;
  commitments: SolverCommitment[];
  fills: SolverFill[];
}

export interface Token {
  chainId: number;
  address: Address;
  symbol: string;
  decimals: number;
  isFixture?: boolean;
  [k: string]: unknown;
}

export interface Protocol {
  id: string;
  chainId: number;
  name: string;
  kind: "official" | "fixture";
  [k: string]: unknown;
}

export interface ChainInfo {
  chainId: number;
  name: string;
  [k: string]: unknown;
}

export interface SystemStatus {
  liveExecutionEnabled: boolean;
  mainnetEnabled: false;
  database: boolean;
  checkpoints: Record<string, unknown>[];
  deployments: Record<string, unknown>[];
}

export interface Session {
  authenticated: true;
  address: Address;
  chainId: number;
  roles: Role[];
  expiresAt?: IsoTime;
  csrfToken?: string;
}

export interface AnalyticsDaily {
  chainId: number;
  days: Record<string, Record<string, string>>;
  note: string;
}

export interface ProofOfProtection {
  schema: "bastion.proof-of-protection/v1";
  rescueId: Hex;
  environment: "LOCAL_SIMULATION" | "TESTNET";
  facts: {
    chainId: number;
    chainName: string;
    policy: Record<string, unknown> | null;
    intent: Record<string, unknown> | null;
    executions: Record<string, unknown>[];
    solverFills: Record<string, unknown>[];
    settlementClaim: Record<string, unknown> | null;
    settlementEvents: Record<string, unknown>[];
    debtToken: { address: Address; symbol: string; decimals: number } | null;
  };
  outcome: {
    rescued: boolean;
    path: string | null;
    healthFactorBeforeWad: Uint | null;
    healthFactorAfterWad: Uint | null;
    repaid: Uint | null;
    fee: Uint | null;
    settlement: SettlementStateName | null;
  };
  verification: { contentHash: string; algorithm: string; howTo: string[] };
  disclaimer: string;
  generatedAt: IsoTime;
}

/** Body of POST /v1/simulations/scenario. Amounts may be strings or safe integers. */
export interface ScenarioRequest {
  base: Record<string, unknown>;
  spec: { kind: string; [k: string]: unknown };
}

export interface ScenarioResponse {
  provenance: "SIMULATED";
  disclaimer: string;
  result: Record<string, unknown>;
  comparison: Record<string, unknown>;
}

export interface SimulationPreset {
  id: string;
  label: string;
  base: Record<string, unknown>;
}

export interface Paged<T> {
  items: T[];
  provenance?: string;
}

export interface StreamEvent {
  id: string;
  event: string;
  data: Record<string, unknown>;
}
