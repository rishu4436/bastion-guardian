/**
 * BASTION Guardian relational model (Section 19).
 *
 * Conventions
 * - Token amounts, WAD values and base-currency values are `numeric(78,0)`: exact unsigned 256-bit integers carried as
 *   decimal strings in TypeScript. Never JS numbers/floats. Token decimals live in `tokens.decimals`.
 * - Addresses are stored lowercase (`0x` + 40 hex) and enforced by CHECK constraints; bytes32 ids likewise.
 * - Every chain-derived row carries `chain_id` plus a canonical reference (block number + block hash, tx hash,
 *   log index) so reorgs can be detected and rows invalidated rather than silently trusted.
 * - Off-chain rows (quotes, notifications, readiness) are never authoritative for spend permissions.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------------------------------------------
// column helpers

/** Exact uint256 as decimal string. */
const u256 = (name: string) => numeric(name, { precision: 78, scale: 0 });
const address = (name: string) => varchar(name, { length: 42 });
const bytes32 = (name: string) => varchar(name, { length: 66 });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const chainId = (name = "chain_id") => bigint(name, { mode: "number" });

const addrCheck = (col: string) => sql.raw(`${col} ~ '^0x[0-9a-f]{40}$'`);
const b32Check = (col: string) => sql.raw(`${col} ~ '^0x[0-9a-f]{64}$'`);
const nonNeg = (col: string) => sql.raw(`${col} >= 0`);

// ---------------------------------------------------------------------------------------------------------------
// enums

export const roleEnum = pgEnum("role", ["borrower", "solver", "auditor", "integrator", "admin"]);
export const readinessEnum = pgEnum("readiness_status", ["ARMED", "LIMITED", "UNAVAILABLE", "UNKNOWN"]);
/** Mirrors RescueSettlementLedger.State (order is ABI-significant; see packages/types RescueState). */
export const rescueStateEnum = pgEnum("rescue_state", [
  "None",
  "Requested",
  "Authorized",
  "SolverCommitted",
  "DestinationExecuted",
  "ExecutionFailed",
  "SettlementPending",
  "ReimbursementComplete",
  "ReimbursementDisputed",
  "RecoveryRequired",
  "Expired",
  "Cancelled",
]);
export const policyStatusEnum = pgEnum("policy_status", [
  "Active",
  "Paused",
  "Revoked",
  "Expired",
  "Superseded",
]);
export const finalityEnum = pgEnum("finality", ["unfinalized", "safe", "finalized", "reorged"]);
export const protocolKindEnum = pgEnum("protocol_kind", ["official", "fixture"]);
export const settlementStateEnum = pgEnum("settlement_state", [
  "Pending",
  "Reimbursed",
  "RecoveryRequired",
  "Disputed",
]);
export const notificationChannelEnum = pgEnum("notification_channel", [
  "webpush",
  "telegram",
  "email",
  "sms",
  "wallet",
  "expo",
]);
export const deliveryStateEnum = pgEnum("delivery_state", [
  "queued",
  "suppressed",
  "provider_accepted",
  "provider_delivered",
  "opened",
  "failed",
  "dead_letter",
]);
export const severityEnum = pgEnum("severity", ["info", "warning", "critical"]);
export const incidentStatusEnum = pgEnum("incident_status", ["open", "acknowledged", "resolved"]);
export const deploymentModeEnum = pgEnum("deployment_mode", ["local_simulation", "testnet"]);

// ---------------------------------------------------------------------------------------------------------------
// identity & auth

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  displayName: text("display_name"),
  createdAt: createdAt(),
  disabledAt: ts("disabled_at"),
});

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    grantedAt: createdAt(),
    grantedBy: uuid("granted_by").references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

export const walletIdentities = pgTable(
  "wallet_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    address: address("address").notNull(),
    firstVerifiedChainId: chainId("first_verified_chain_id").notNull(),
    verifiedAt: ts("verified_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("wallet_identities_address_uq").on(t.address),
    check("wallet_addr_ck", addrCheck("address")),
  ],
);

/** SIWE nonces: single-use, short-lived, bound to domain + chain at verification. */
export const authNonces = pgTable(
  "auth_nonces",
  {
    nonce: varchar("nonce", { length: 64 }).primaryKey(),
    issuedAt: ts("issued_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
    consumedAt: ts("consumed_at"),
    consumedBy: address("consumed_by"),
  },
  (t) => [index("auth_nonces_expires_idx").on(t.expiresAt)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    walletAddress: address("wallet_address").notNull(),
    chainId: chainId().notNull(),
    /** sha256 of the opaque session token; the token itself is never stored. */
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    csrfTokenHash: varchar("csrf_token_hash", { length: 64 }).notNull(),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
    lastReauthAt: ts("last_reauth_at").notNull().defaultNow(),
    rotatedFrom: uuid("rotated_from"),
    revokedAt: ts("revoked_at"),
    userAgent: text("user_agent"),
  },
  (t) => [uniqueIndex("sessions_token_hash_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

export const apiCredentials = pgTable(
  "api_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyPrefix: varchar("key_prefix", { length: 16 }).notNull(),
    keyHash: varchar("key_hash", { length: 64 }).notNull(),
    scopes: text("scopes").array().notNull(),
    createdAt: createdAt(),
    lastUsedAt: ts("last_used_at"),
    revokedAt: ts("revoked_at"),
  },
  (t) => [uniqueIndex("api_credentials_prefix_uq").on(t.keyPrefix)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    actorAddress: address("actor_address"),
    action: text("action").notNull(),
    target: text("target"),
    details: jsonb("details").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_events_actor_idx").on(t.actorUserId, t.createdAt)],
);

// ---------------------------------------------------------------------------------------------------------------
// chains, protocols, tokens, deployments

export const chains = pgTable("chains", {
  chainId: chainId().primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  isTestnet: boolean("is_testnet").notNull(),
  explorerUrl: text("explorer_url"),
  /** Confirmations after which a block is treated as final by the indexer for this chain. */
  finalityDepth: integer("finality_depth").notNull(),
  createdAt: createdAt(),
});

export const protocols = pgTable(
  "protocols",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    chainId: chainId()
      .notNull()
      .references(() => chains.chainId),
    kind: protocolKindEnum("kind").notNull(),
    poolAddress: address("pool_address").notNull(),
    adapterAddress: address("adapter_address"),
    /** Only `live` protocols may be shown as integrated. `planned` rows must never be displayed as live. */
    status: text("status").notNull(),
    sourceUrl: text("source_url"),
    createdAt: createdAt(),
  },
  (t) => [check("protocol_status_ck", sql`${t.status} in ('live','configured','planned','disabled')`)],
);

export const tokens = pgTable(
  "tokens",
  {
    chainId: chainId()
      .notNull()
      .references(() => chains.chainId),
    address: address("address").notNull(),
    symbol: text("symbol").notNull(),
    decimals: smallint("decimals").notNull(),
    isFixture: boolean("is_fixture").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.address] }),
    check("token_decimals_ck", sql`${t.decimals} between 0 and 36`),
    check("token_addr_ck", addrCheck("address")),
  ],
);

export const deploymentRegistry = pgTable(
  "deployment_registry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chainId: chainId().notNull(),
    contractName: text("contract_name").notNull(),
    address: address("address").notNull(),
    mode: deploymentModeEnum("mode").notNull(),
    txHash: bytes32("tx_hash"),
    blockNumber: bigint("block_number", { mode: "bigint" }),
    deployer: address("deployer"),
    sourceVerified: boolean("source_verified").notNull().default(false),
    recordedAt: createdAt(),
  },
  (t) => [
    uniqueIndex("deployment_registry_uq").on(t.chainId, t.contractName, t.address),
    check("deployment_addr_ck", addrCheck("address")),
  ],
);

export const verifiedTransactions = pgTable(
  "verified_transactions",
  {
    chainId: chainId().notNull(),
    txHash: bytes32("tx_hash").notNull(),
    kind: text("kind").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockHash: bytes32("block_hash").notNull(),
    status: text("status").notNull(),
    fromAddress: address("from_address"),
    toAddress: address("to_address"),
    blockTimestamp: ts("block_timestamp"),
    observedAt: ts("observed_at").notNull().defaultNow(),
    finality: finalityEnum("finality").notNull().default("unfinalized"),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.txHash] }), check("vtx_hash_ck", b32Check("tx_hash"))],
);

// ---------------------------------------------------------------------------------------------------------------
// indexer infrastructure

export const chainCheckpoints = pgTable(
  "chain_checkpoints",
  {
    chainId: chainId().notNull(),
    stream: text("stream").notNull(),
    lastBlock: bigint("last_block", { mode: "bigint" }).notNull(),
    lastBlockHash: bytes32("last_block_hash").notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.stream] })],
);

/** Canonical block headers seen by the indexer (for reorg detection by parent-hash continuity). */
export const indexedBlocks = pgTable(
  "indexed_blocks",
  {
    chainId: chainId().notNull(),
    number: bigint("number", { mode: "bigint" }).notNull(),
    hash: bytes32("hash").notNull(),
    parentHash: bytes32("parent_hash").notNull(),
    timestamp: ts("timestamp").notNull(),
    indexedAt: ts("indexed_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.number] })],
);

/** Raw decoded logs. Unique per (chain, block hash, log index) so re-ingesting the same block is a no-op, while a
 *  reorged block's logs are marked `removed` instead of being overwritten. */
export const chainLogs = pgTable(
  "chain_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    chainId: chainId().notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockHash: bytes32("block_hash").notNull(),
    txHash: bytes32("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    address: address("address").notNull(),
    eventName: text("event_name").notNull(),
    args: jsonb("args").notNull(),
    removed: boolean("removed").notNull().default(false),
    ingestedAt: ts("ingested_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("chain_logs_uq").on(t.chainId, t.blockHash, t.logIndex),
    index("chain_logs_event_idx").on(t.chainId, t.eventName, t.blockNumber),
    index("chain_logs_tx_idx").on(t.chainId, t.txHash),
  ],
);

// ---------------------------------------------------------------------------------------------------------------
// positions & risk

export const lendingPositions = pgTable(
  "lending_positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chainId: chainId().notNull(),
    protocolId: text("protocol_id")
      .notNull()
      .references(() => protocols.id),
    account: address("account").notNull(),
    collateralAsset: address("collateral_asset").notNull(),
    debtAsset: address("debt_asset").notNull(),
    collateralAmount: u256("collateral_amount").notNull(),
    debtAmount: u256("debt_amount").notNull(),
    healthFactorWad: u256("health_factor_wad").notNull(),
    liquidationThresholdBps: integer("liquidation_threshold_bps").notNull(),
    observedBlock: bigint("observed_block", { mode: "bigint" }).notNull(),
    observedAt: ts("observed_at").notNull(),
    /** true when history before `observed_block` is incomplete (e.g. indexer started later). */
    historyIncomplete: boolean("history_incomplete").notNull().default(true),
  },
  (t) => [
    uniqueIndex("lending_positions_uq").on(
      t.chainId,
      t.protocolId,
      t.account,
      t.collateralAsset,
      t.debtAsset,
    ),
    index("lending_positions_account_idx").on(t.account),
    check(
      "lp_amounts_ck",
      sql`${t.collateralAmount} >= 0 and ${t.debtAmount} >= 0 and ${t.healthFactorWad} >= 0`,
    ),
  ],
);

export const positionObservations = pgTable(
  "position_observations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    positionId: uuid("position_id")
      .notNull()
      .references(() => lendingPositions.id, { onDelete: "cascade" }),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockHash: bytes32("block_hash").notNull(),
    observedAt: ts("observed_at").notNull(),
    collateralAmount: u256("collateral_amount").notNull(),
    debtAmount: u256("debt_amount").notNull(),
    collateralBase: u256("collateral_base").notNull(),
    debtBase: u256("debt_base").notNull(),
    healthFactorWad: u256("health_factor_wad").notNull(),
    liquidationThresholdBps: integer("liquidation_threshold_bps").notNull(),
    /** 'chain' = read from the lender; 'simulated' rows must never be shown as observed facts. */
    source: text("source").notNull(),
  },
  (t) => [
    uniqueIndex("position_obs_uq").on(t.positionId, t.blockHash),
    index("position_obs_time_idx").on(t.positionId, t.observedAt),
    check("pos_obs_source_ck", sql`${t.source} in ('chain','simulated')`),
  ],
);

export const riskObservations = pgTable(
  "risk_observations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    chainId: chainId().notNull(),
    policyId: bytes32("policy_id").notNull(),
    policyVersion: integer("policy_version").notNull(),
    account: address("account").notNull(),
    healthFactorWad: u256("health_factor_wad").notNull(),
    triggerHealthFactorWad: u256("trigger_health_factor_wad").notNull(),
    observedAt: ts("observed_at").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockHash: bytes32("block_hash").notNull(),
    txHash: bytes32("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
  },
  (t) => [
    uniqueIndex("risk_obs_uq").on(t.chainId, t.blockHash, t.logIndex),
    index("risk_obs_policy_idx").on(t.policyId, t.observedAt),
  ],
);

// ---------------------------------------------------------------------------------------------------------------
// policies

export const protectionPolicies = pgTable(
  "protection_policies",
  {
    chainId: chainId().notNull(),
    policyId: bytes32("policy_id").notNull(),
    owner: address("owner").notNull(),
    account: address("account").notNull(),
    adapter: address("adapter").notNull(),
    market: address("market").notNull(),
    debtAsset: address("debt_asset").notNull(),
    collateralAsset: address("collateral_asset").notNull(),
    status: policyStatusEnum("status").notNull(),
    currentVersion: integer("current_version").notNull(),
    registeredAt: ts("registered_at").notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.policyId] }),
    index("policies_owner_idx").on(t.owner),
    check("policy_id_ck", b32Check("policy_id")),
  ],
);

export const policyVersions = pgTable(
  "policy_versions",
  {
    chainId: chainId().notNull(),
    policyId: bytes32("policy_id").notNull(),
    version: integer("version").notNull(),
    sourceChainId: chainId("source_chain_id").notNull(),
    destChainId: chainId("dest_chain_id").notNull(),
    triggerHealthFactorWad: u256("trigger_health_factor_wad").notNull(),
    targetHealthFactorWad: u256("target_health_factor_wad").notNull(),
    maxTotalRepay: u256("max_total_repay").notNull(),
    maxRepayPerAction: u256("max_repay_per_action").notNull(),
    maxTotalFees: u256("max_total_fees").notNull(),
    maxSlippageBps: integer("max_slippage_bps").notNull(),
    maxFeeBps: integer("max_fee_bps").notNull(),
    allowedPaths: smallint("allowed_paths").notNull(),
    allowPartial: boolean("allow_partial").notNull(),
    expiry: ts("expiry").notNull(),
    cooldownSeconds: integer("cooldown_seconds").notNull(),
    nonce: u256("nonce").notNull(),
    solversHash: bytes32("solvers_hash").notNull(),
    recipientsHash: bytes32("recipients_hash").notNull(),
    solvers: jsonb("solvers").$type<string[]>().notNull().default([]),
    registeredTxHash: bytes32("registered_tx_hash").notNull(),
    registeredBlock: bigint("registered_block", { mode: "bigint" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.policyId, t.version] }),
    check("pv_target_ck", sql`${t.targetHealthFactorWad} > ${t.triggerHealthFactorWad}`),
    check("pv_caps_ck", sql`${t.maxRepayPerAction} <= ${t.maxTotalRepay}`),
  ],
);

export const policyAuthorizations = pgTable(
  "policy_authorizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chainId: chainId().notNull(),
    policyId: bytes32("policy_id"),
    owner: address("owner").notNull(),
    kind: text("kind").notNull(),
    subject: address("subject").notNull(),
    asset: address("asset"),
    amount: u256("amount"),
    txHash: bytes32("tx_hash"),
    blockNumber: bigint("block_number", { mode: "bigint" }),
    observedAt: ts("observed_at").notNull().defaultNow(),
    revokedAt: ts("revoked_at"),
  },
  (t) => [
    index("policy_auth_owner_idx").on(t.owner),
    check(
      "policy_auth_kind_ck",
      sql`${t.kind} in ('direct','eip712','eip1271','atoken_approval','pull_cap','reserve_budget','account_delegate')`,
    ),
  ],
);

export const readinessSnapshots = pgTable(
  "readiness_snapshots",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    chainId: chainId().notNull(),
    policyId: bytes32("policy_id").notNull(),
    status: readinessEnum("status").notNull(),
    checks: jsonb("checks").notNull(),
    evaluatedAt: ts("evaluated_at").notNull().defaultNow(),
    /** Oldest input timestamp the evaluation relied on (UNKNOWN if too old). */
    dataAsOf: ts("data_as_of"),
  },
  (t) => [index("readiness_policy_idx").on(t.chainId, t.policyId, t.evaluatedAt)],
);

// ---------------------------------------------------------------------------------------------------------------
// rescues

export const rescueIntents = pgTable(
  "rescue_intents",
  {
    rescueId: bytes32("rescue_id").primaryKey(),
    chainId: chainId().notNull(),
    policyId: bytes32("policy_id").notNull(),
    policyVersion: integer("policy_version").notNull(),
    originEventId: bytes32("origin_event_id").notNull(),
    originChainId: chainId("origin_chain_id"),
    originTxHash: bytes32("origin_tx_hash"),
    reactiveTxHash: bytes32("reactive_tx_hash"),
    state: rescueStateEnum("state").notNull(),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("rescue_intents_policy_idx").on(t.chainId, t.policyId),
    check("rescue_id_ck", b32Check("rescue_id")),
  ],
);

export const rescueExecutions = pgTable(
  "rescue_executions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    rescueId: bytes32("rescue_id")
      .notNull()
      .references(() => rescueIntents.rescueId),
    chainId: chainId().notNull(),
    path: smallint("path").notNull(),
    success: boolean("success").notNull(),
    reason: text("reason"),
    debtBefore: u256("debt_before"),
    debtAfter: u256("debt_after"),
    healthFactorBeforeWad: u256("health_factor_before_wad"),
    healthFactorAfterWad: u256("health_factor_after_wad"),
    repaid: u256("repaid"),
    fee: u256("fee"),
    solver: address("solver"),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockHash: bytes32("block_hash").notNull(),
    txHash: bytes32("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    blockTimestamp: ts("block_timestamp"),
  },
  (t) => [
    uniqueIndex("rescue_exec_uq").on(t.chainId, t.blockHash, t.logIndex),
    index("rescue_exec_rescue_idx").on(t.rescueId),
    check(
      "rescue_exec_debt_ck",
      sql`${t.debtAfter} is null or ${t.debtBefore} is null or ${t.debtAfter} <= ${t.debtBefore} or not ${t.success}`,
    ),
  ],
);

// ---------------------------------------------------------------------------------------------------------------
// solvers

export const solverRegistrations = pgTable(
  "solver_registrations",
  {
    chainId: chainId().notNull(),
    solver: address("solver").notNull(),
    payout: address("payout").notNull(),
    bond: u256("bond").notNull(),
    metadataUri: text("metadata_uri"),
    status: text("status").notNull(),
    totalFilled: u256("total_filled").notNull().default("0"),
    fills: integer("fills").notNull().default(0),
    failures: integer("failures").notNull().default(0),
    registeredBlock: bigint("registered_block", { mode: "bigint" }).notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.solver] }),
    check("solver_status_ck", sql`${t.status} in ('active','suspended','exiting','exited')`),
  ],
);

export const solverLiquidityCommitments = pgTable(
  "solver_liquidity_commitments",
  {
    chainId: chainId().notNull(),
    commitmentId: bytes32("commitment_id").notNull(),
    solver: address("solver").notNull(),
    policyId: bytes32("policy_id").notNull(),
    token: address("token").notNull(),
    amount: u256("amount").notNull(),
    remaining: u256("remaining").notNull(),
    feeBps: integer("fee_bps").notNull(),
    expiry: ts("expiry").notNull(),
    state: text("state").notNull(),
    createdBlock: bigint("created_block", { mode: "bigint" }).notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.commitmentId] }),
    index("commitments_policy_idx").on(t.chainId, t.policyId),
    check("commit_remaining_ck", sql`${t.remaining} <= ${t.amount}`),
    check("commit_state_ck", sql`${t.state} in ('active','drawn','released','expired')`),
  ],
);

/** Off-chain quotes. A quote is NEVER counted as liquidity unless `backingCommitmentId` points at an on-chain commitment. */
export const solverQuotes = pgTable(
  "solver_quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chainId: chainId().notNull(),
    solver: address("solver").notNull(),
    policyId: bytes32("policy_id").notNull(),
    token: address("token").notNull(),
    amount: u256("amount").notNull(),
    feeBps: integer("fee_bps").notNull(),
    validUntil: ts("valid_until").notNull(),
    signature: text("signature").notNull(),
    status: text("status").notNull(),
    backingCommitmentId: bytes32("backing_commitment_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("quotes_policy_idx").on(t.chainId, t.policyId, t.validUntil),
    check("quote_status_ck", sql`${t.status} in ('offered','committed','expired','withdrawn','rejected')`),
    check("quote_fee_ck", sql`${t.feeBps} between 0 and 1000`),
  ],
);

export const solverFills = pgTable(
  "solver_fills",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    chainId: chainId().notNull(),
    rescueId: bytes32("rescue_id").notNull(),
    solver: address("solver").notNull(),
    payout: address("payout").notNull(),
    policyOwner: address("policy_owner").notNull(),
    principal: u256("principal").notNull(),
    fee: u256("fee").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockHash: bytes32("block_hash").notNull(),
    txHash: bytes32("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
  },
  (t) => [
    uniqueIndex("solver_fills_uq").on(t.chainId, t.blockHash, t.logIndex),
    index("solver_fills_solver_idx").on(t.solver),
  ],
);

// ---------------------------------------------------------------------------------------------------------------
// reserves & settlement

/** Reserve-chain budgets (BastionProtectionVault), keyed by (owner, policyId) since R-07. */
export const sourceEscrows = pgTable(
  "source_escrows",
  {
    chainId: chainId().notNull(),
    vault: address("vault").notNull(),
    owner: address("owner").notNull(),
    policyId: bytes32("policy_id").notNull(),
    token: address("token").notNull(),
    repayReserve: u256("repay_reserve").notNull(),
    feeReserve: u256("fee_reserve").notNull(),
    maxFeeBps: integer("max_fee_bps").notNull(),
    totalReimbursed: u256("total_reimbursed").notNull().default("0"),
    pausedAt: ts("paused_at"),
    releaseRequestedAt: ts("release_requested_at"),
    updatedBlock: bigint("updated_block", { mode: "bigint" }).notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.vault, t.owner, t.policyId] })],
);

export const settlementClaims = pgTable(
  "settlement_claims",
  {
    rescueId: bytes32("rescue_id").primaryKey(),
    reserveChainId: chainId("reserve_chain_id").notNull(),
    destChainId: chainId("dest_chain_id").notNull(),
    policyId: bytes32("policy_id").notNull(),
    policyOwner: address("policy_owner").notNull(),
    recipient: address("recipient").notNull(),
    principal: u256("principal").notNull(),
    fee: u256("fee").notNull(),
    state: settlementStateEnum("state").notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    destExecutedAt: ts("dest_executed_at"),
    /** Set by the reconciler when a destination repayment exists but no reserve-side claim was seen in time. */
    overdueSince: ts("overdue_since"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("settlement_claims_state_idx").on(t.state)],
);

export const settlementEvents = pgTable(
  "settlement_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    rescueId: bytes32("rescue_id").notNull(),
    chainId: chainId().notNull(),
    kind: text("kind").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockHash: bytes32("block_hash").notNull(),
    txHash: bytes32("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    data: jsonb("data").notNull().default({}),
  },
  (t) => [
    uniqueIndex("settlement_events_uq").on(t.chainId, t.blockHash, t.logIndex),
    index("settlement_events_rescue_idx").on(t.rescueId),
    check(
      "settlement_kind_ck",
      sql`${t.kind} in ('solver_executed','reimbursed','failed','duplicate_ignored','untrusted_rejected','disputed','acknowledged')`,
    ),
  ],
);

// ---------------------------------------------------------------------------------------------------------------
// notifications

export const notificationPreferences = pgTable("notification_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  minSeverity: severityEnum("min_severity").notNull().default("warning"),
  quietHoursStart: smallint("quiet_hours_start"),
  quietHoursEnd: smallint("quiet_hours_end"),
  timezone: text("timezone").notNull().default("UTC"),
  escalateCritical: boolean("escalate_critical").notNull().default(true),
  /** Default true: lock-screen text omits amounts and positions. */
  privateLockScreen: boolean("private_lock_screen").notNull().default(true),
  weeklyDigest: boolean("weekly_digest").notNull().default(false),
  eventOptOuts: text("event_opt_outs")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const notificationChannels = pgTable(
  "notification_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: notificationChannelEnum("kind").notNull(),
    /** Channel destination (Telegram chat id, e-mail, E.164 phone, wallet address). Never exposed to other users. */
    destination: text("destination").notNull(),
    priority: smallint("priority").notNull().default(1),
    verifiedAt: ts("verified_at"),
    verificationCodeHash: varchar("verification_code_hash", { length: 64 }),
    verificationExpiresAt: ts("verification_expires_at"),
    verificationAttempts: smallint("verification_attempts").notNull().default(0),
    status: text("status").notNull().default("pending"),
    createdAt: createdAt(),
    unlinkedAt: ts("unlinked_at"),
  },
  (t) => [
    uniqueIndex("notification_channels_uq").on(t.userId, t.kind, t.destination),
    check("channel_status_ck", sql`${t.status} in ('pending','active','disabled','unlinked')`),
  ],
);

export const deviceSubscriptions = pgTable(
  "device_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh"),
    auth: text("auth"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    revokedAt: ts("revoked_at"),
  },
  (t) => [
    uniqueIndex("device_subscriptions_endpoint_uq").on(t.endpoint),
    check("device_kind_ck", sql`${t.kind} in ('webpush','expo')`),
  ],
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dedupKey: text("dedup_key").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channelKind: notificationChannelEnum("channel_kind").notNull(),
    channelId: uuid("channel_id"),
    eventType: text("event_type").notNull(),
    severity: severityEnum("severity").notNull(),
    /** Verified on-chain references (chainId, txHash, logIndex) or incident ids backing the notification. */
    sourceRefs: jsonb("source_refs").notNull(),
    /** 'confirmed' only when the underlying chain event reached the chain's finality depth. */
    eventConfirmation: text("event_confirmation").notNull(),
    isTest: boolean("is_test").notNull().default(false),
    state: deliveryStateEnum("state").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    providerMessageId: text("provider_message_id"),
    createdAt: createdAt(),
    queuedAt: ts("queued_at").notNull().defaultNow(),
    acceptedAt: ts("accepted_at"),
    deliveredAt: ts("delivered_at"),
    openedAt: ts("opened_at"),
    nextAttemptAt: ts("next_attempt_at"),
  },
  (t) => [
    uniqueIndex("notification_deliveries_uq").on(t.dedupKey, t.channelKind),
    index("notification_deliveries_user_idx").on(t.userId, t.createdAt),
    check(
      "delivery_confirmation_ck",
      sql`${t.eventConfirmation} in ('observed','confirmed','not_applicable')`,
    ),
  ],
);

// ---------------------------------------------------------------------------------------------------------------
// operations

export const incidentRecords = pgTable(
  "incident_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dedupKey: text("dedup_key").notNull(),
    chainId: chainId(),
    policyId: bytes32("policy_id"),
    scope: text("scope").notNull(),
    kind: text("kind").notNull(),
    severity: severityEnum("severity").notNull(),
    status: incidentStatusEnum("status").notNull().default("open"),
    title: text("title").notNull(),
    evidence: jsonb("evidence").notNull(),
    recommendedAction: text("recommended_action").notNull(),
    openedAt: ts("opened_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    occurrences: integer("occurrences").notNull().default(1),
    resolvedAt: ts("resolved_at"),
  },
  (t) => [
    // Repeated-incident suppression: at most one open incident per dedup key.
    uniqueIndex("incident_open_uq")
      .on(t.dedupKey)
      .where(sql`${t.status} <> 'resolved'`),
    index("incident_policy_idx").on(t.policyId, t.openedAt),
  ],
);

export const simulationSessions = pgTable("simulation_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  modelVersion: text("model_version").notNull(),
  inputs: jsonb("inputs").notNull(),
  outputs: jsonb("outputs").notNull(),
  /** Simulations are forecasts. This flag is always true and exists so exports can never omit the label. */
  isForecast: boolean("is_forecast").notNull().default(true),
  createdAt: createdAt(),
});

export const analyticsDaily = pgTable(
  "analytics_daily",
  {
    day: varchar("day", { length: 10 }).notNull(),
    chainId: chainId().notNull(),
    metric: text("metric").notNull(),
    value: u256("value").notNull(),
    computedAt: ts("computed_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.day, t.chainId, t.metric] }),
    check("analytics_value_ck", nonNeg("value")),
  ],
);
