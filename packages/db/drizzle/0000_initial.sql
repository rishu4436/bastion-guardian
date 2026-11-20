CREATE TYPE "public"."delivery_state" AS ENUM('queued', 'suppressed', 'provider_accepted', 'provider_delivered', 'opened', 'failed', 'dead_letter');--> statement-breakpoint
CREATE TYPE "public"."deployment_mode" AS ENUM('local_simulation', 'testnet');--> statement-breakpoint
CREATE TYPE "public"."finality" AS ENUM('unfinalized', 'safe', 'finalized', 'reorged');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('open', 'acknowledged', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('webpush', 'telegram', 'email', 'sms', 'wallet', 'expo');--> statement-breakpoint
CREATE TYPE "public"."policy_status" AS ENUM('Active', 'Paused', 'Revoked', 'Expired', 'Superseded');--> statement-breakpoint
CREATE TYPE "public"."protocol_kind" AS ENUM('official', 'fixture');--> statement-breakpoint
CREATE TYPE "public"."readiness_status" AS ENUM('ARMED', 'LIMITED', 'UNAVAILABLE', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."rescue_state" AS ENUM('None', 'Requested', 'Authorized', 'SolverCommitted', 'DestinationExecuted', 'ExecutionFailed', 'SettlementPending', 'ReimbursementComplete', 'ReimbursementDisputed', 'RecoveryRequired', 'Expired', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('borrower', 'solver', 'auditor', 'integrator', 'admin');--> statement-breakpoint
CREATE TYPE "public"."settlement_state" AS ENUM('Pending', 'Reimbursed', 'RecoveryRequired', 'Disputed');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TABLE "analytics_daily" (
	"day" varchar(10) NOT NULL,
	"chain_id" bigint NOT NULL,
	"metric" text NOT NULL,
	"value" numeric(78, 0) NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_daily_day_chain_id_metric_pk" PRIMARY KEY("day","chain_id","metric"),
	CONSTRAINT "analytics_value_ck" CHECK (value >= 0)
);
--> statement-breakpoint
CREATE TABLE "api_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key_prefix" varchar(16) NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"scopes" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_user_id" uuid,
	"actor_address" varchar(42),
	"action" text NOT NULL,
	"target" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_nonces" (
	"nonce" varchar(64) PRIMARY KEY NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"consumed_by" varchar(42)
);
--> statement-breakpoint
CREATE TABLE "chain_checkpoints" (
	"chain_id" bigint NOT NULL,
	"stream" text NOT NULL,
	"last_block" bigint NOT NULL,
	"last_block_hash" varchar(66) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_checkpoints_chain_id_stream_pk" PRIMARY KEY("chain_id","stream")
);
--> statement-breakpoint
CREATE TABLE "chain_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"chain_id" bigint NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" varchar(66) NOT NULL,
	"tx_hash" varchar(66) NOT NULL,
	"log_index" integer NOT NULL,
	"address" varchar(42) NOT NULL,
	"event_name" text NOT NULL,
	"args" jsonb NOT NULL,
	"removed" boolean DEFAULT false NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chains" (
	"chain_id" bigint PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"is_testnet" boolean NOT NULL,
	"explorer_url" text,
	"finality_depth" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployment_registry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" bigint NOT NULL,
	"contract_name" text NOT NULL,
	"address" varchar(42) NOT NULL,
	"mode" "deployment_mode" NOT NULL,
	"tx_hash" varchar(66),
	"block_number" bigint,
	"deployer" varchar(42),
	"source_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deployment_addr_ck" CHECK (address ~ '^0x[0-9a-f]{40}$')
);
--> statement-breakpoint
CREATE TABLE "device_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text,
	"auth" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "device_kind_ck" CHECK ("device_subscriptions"."kind" in ('webpush','expo'))
);
--> statement-breakpoint
CREATE TABLE "incident_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dedup_key" text NOT NULL,
	"chain_id" bigint,
	"policy_id" varchar(66),
	"scope" text NOT NULL,
	"kind" text NOT NULL,
	"severity" "severity" NOT NULL,
	"status" "incident_status" DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"recommended_action" text NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "indexed_blocks" (
	"chain_id" bigint NOT NULL,
	"number" bigint NOT NULL,
	"hash" varchar(66) NOT NULL,
	"parent_hash" varchar(66) NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "indexed_blocks_chain_id_number_pk" PRIMARY KEY("chain_id","number")
);
--> statement-breakpoint
CREATE TABLE "lending_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" bigint NOT NULL,
	"protocol_id" text NOT NULL,
	"account" varchar(42) NOT NULL,
	"collateral_asset" varchar(42) NOT NULL,
	"debt_asset" varchar(42) NOT NULL,
	"collateral_amount" numeric(78, 0) NOT NULL,
	"debt_amount" numeric(78, 0) NOT NULL,
	"health_factor_wad" numeric(78, 0) NOT NULL,
	"liquidation_threshold_bps" integer NOT NULL,
	"observed_block" bigint NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"history_incomplete" boolean DEFAULT true NOT NULL,
	CONSTRAINT "lp_amounts_ck" CHECK ("lending_positions"."collateral_amount" >= 0 and "lending_positions"."debt_amount" >= 0 and "lending_positions"."health_factor_wad" >= 0)
);
--> statement-breakpoint
CREATE TABLE "notification_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "notification_channel" NOT NULL,
	"destination" text NOT NULL,
	"priority" smallint DEFAULT 1 NOT NULL,
	"verified_at" timestamp with time zone,
	"verification_code_hash" varchar(64),
	"verification_expires_at" timestamp with time zone,
	"verification_attempts" smallint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unlinked_at" timestamp with time zone,
	CONSTRAINT "channel_status_ck" CHECK ("notification_channels"."status" in ('pending','active','disabled','unlinked'))
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dedup_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"channel_kind" "notification_channel" NOT NULL,
	"channel_id" uuid,
	"event_type" text NOT NULL,
	"severity" "severity" NOT NULL,
	"source_refs" jsonb NOT NULL,
	"event_confirmation" text NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"state" "delivery_state" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"provider_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	CONSTRAINT "delivery_confirmation_ck" CHECK ("notification_deliveries"."event_confirmation" in ('observed','confirmed','not_applicable'))
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"min_severity" "severity" DEFAULT 'warning' NOT NULL,
	"quiet_hours_start" smallint,
	"quiet_hours_end" smallint,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"escalate_critical" boolean DEFAULT true NOT NULL,
	"private_lock_screen" boolean DEFAULT true NOT NULL,
	"weekly_digest" boolean DEFAULT false NOT NULL,
	"event_opt_outs" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" bigint NOT NULL,
	"policy_id" varchar(66),
	"owner" varchar(42) NOT NULL,
	"kind" text NOT NULL,
	"subject" varchar(42) NOT NULL,
	"asset" varchar(42),
	"amount" numeric(78, 0),
	"tx_hash" varchar(66),
	"block_number" bigint,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "policy_auth_kind_ck" CHECK ("policy_authorizations"."kind" in ('direct','eip712','eip1271','atoken_approval','pull_cap','reserve_budget','account_delegate'))
);
--> statement-breakpoint
CREATE TABLE "policy_versions" (
	"chain_id" bigint NOT NULL,
	"policy_id" varchar(66) NOT NULL,
	"version" integer NOT NULL,
	"source_chain_id" bigint NOT NULL,
	"dest_chain_id" bigint NOT NULL,
	"trigger_health_factor_wad" numeric(78, 0) NOT NULL,
	"target_health_factor_wad" numeric(78, 0) NOT NULL,
	"max_total_repay" numeric(78, 0) NOT NULL,
	"max_repay_per_action" numeric(78, 0) NOT NULL,
	"max_total_fees" numeric(78, 0) NOT NULL,
	"max_slippage_bps" integer NOT NULL,
	"max_fee_bps" integer NOT NULL,
	"allowed_paths" smallint NOT NULL,
	"allow_partial" boolean NOT NULL,
	"expiry" timestamp with time zone NOT NULL,
	"cooldown_seconds" integer NOT NULL,
	"nonce" numeric(78, 0) NOT NULL,
	"solvers_hash" varchar(66) NOT NULL,
	"recipients_hash" varchar(66) NOT NULL,
	"solvers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"registered_tx_hash" varchar(66) NOT NULL,
	"registered_block" bigint NOT NULL,
	CONSTRAINT "policy_versions_chain_id_policy_id_version_pk" PRIMARY KEY("chain_id","policy_id","version"),
	CONSTRAINT "pv_target_ck" CHECK ("policy_versions"."target_health_factor_wad" > "policy_versions"."trigger_health_factor_wad"),
	CONSTRAINT "pv_caps_ck" CHECK ("policy_versions"."max_repay_per_action" <= "policy_versions"."max_total_repay")
);
--> statement-breakpoint
CREATE TABLE "position_observations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"position_id" uuid NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" varchar(66) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"collateral_amount" numeric(78, 0) NOT NULL,
	"debt_amount" numeric(78, 0) NOT NULL,
	"collateral_base" numeric(78, 0) NOT NULL,
	"debt_base" numeric(78, 0) NOT NULL,
	"health_factor_wad" numeric(78, 0) NOT NULL,
	"liquidation_threshold_bps" integer NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "pos_obs_source_ck" CHECK ("position_observations"."source" in ('chain','simulated'))
);
--> statement-breakpoint
CREATE TABLE "protection_policies" (
	"chain_id" bigint NOT NULL,
	"policy_id" varchar(66) NOT NULL,
	"owner" varchar(42) NOT NULL,
	"account" varchar(42) NOT NULL,
	"adapter" varchar(42) NOT NULL,
	"market" varchar(42) NOT NULL,
	"debt_asset" varchar(42) NOT NULL,
	"collateral_asset" varchar(42) NOT NULL,
	"status" "policy_status" NOT NULL,
	"current_version" integer NOT NULL,
	"registered_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "protection_policies_chain_id_policy_id_pk" PRIMARY KEY("chain_id","policy_id"),
	CONSTRAINT "policy_id_ck" CHECK (policy_id ~ '^0x[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "protocols" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"chain_id" bigint NOT NULL,
	"kind" "protocol_kind" NOT NULL,
	"pool_address" varchar(42) NOT NULL,
	"adapter_address" varchar(42),
	"status" text NOT NULL,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "protocol_status_ck" CHECK ("protocols"."status" in ('live','configured','planned','disabled'))
);
--> statement-breakpoint
CREATE TABLE "readiness_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"chain_id" bigint NOT NULL,
	"policy_id" varchar(66) NOT NULL,
	"status" "readiness_status" NOT NULL,
	"checks" jsonb NOT NULL,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"data_as_of" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rescue_executions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"rescue_id" varchar(66) NOT NULL,
	"chain_id" bigint NOT NULL,
	"path" smallint NOT NULL,
	"success" boolean NOT NULL,
	"reason" text,
	"debt_before" numeric(78, 0),
	"debt_after" numeric(78, 0),
	"health_factor_before_wad" numeric(78, 0),
	"health_factor_after_wad" numeric(78, 0),
	"repaid" numeric(78, 0),
	"fee" numeric(78, 0),
	"solver" varchar(42),
	"block_number" bigint NOT NULL,
	"block_hash" varchar(66) NOT NULL,
	"tx_hash" varchar(66) NOT NULL,
	"log_index" integer NOT NULL,
	"block_timestamp" timestamp with time zone,
	CONSTRAINT "rescue_exec_debt_ck" CHECK ("rescue_executions"."debt_after" is null or "rescue_executions"."debt_before" is null or "rescue_executions"."debt_after" <= "rescue_executions"."debt_before" or not "rescue_executions"."success")
);
--> statement-breakpoint
CREATE TABLE "rescue_intents" (
	"rescue_id" varchar(66) PRIMARY KEY NOT NULL,
	"chain_id" bigint NOT NULL,
	"policy_id" varchar(66) NOT NULL,
	"policy_version" integer NOT NULL,
	"origin_event_id" varchar(66) NOT NULL,
	"origin_chain_id" bigint,
	"origin_tx_hash" varchar(66),
	"reactive_tx_hash" varchar(66),
	"state" "rescue_state" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rescue_id_ck" CHECK (rescue_id ~ '^0x[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "risk_observations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"chain_id" bigint NOT NULL,
	"policy_id" varchar(66) NOT NULL,
	"policy_version" integer NOT NULL,
	"account" varchar(42) NOT NULL,
	"health_factor_wad" numeric(78, 0) NOT NULL,
	"trigger_health_factor_wad" numeric(78, 0) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" varchar(66) NOT NULL,
	"tx_hash" varchar(66) NOT NULL,
	"log_index" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_address" varchar(42) NOT NULL,
	"chain_id" bigint NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"csrf_token_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_reauth_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_from" uuid,
	"revoked_at" timestamp with time zone,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "settlement_claims" (
	"rescue_id" varchar(66) PRIMARY KEY NOT NULL,
	"reserve_chain_id" bigint NOT NULL,
	"dest_chain_id" bigint NOT NULL,
	"policy_id" varchar(66) NOT NULL,
	"policy_owner" varchar(42) NOT NULL,
	"recipient" varchar(42) NOT NULL,
	"principal" numeric(78, 0) NOT NULL,
	"fee" numeric(78, 0) NOT NULL,
	"state" "settlement_state" NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"dest_executed_at" timestamp with time zone,
	"overdue_since" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"rescue_id" varchar(66) NOT NULL,
	"chain_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" varchar(66) NOT NULL,
	"tx_hash" varchar(66) NOT NULL,
	"log_index" integer NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "settlement_kind_ck" CHECK ("settlement_events"."kind" in ('solver_executed','reimbursed','failed','duplicate_ignored','untrusted_rejected','disputed','acknowledged'))
);
--> statement-breakpoint
CREATE TABLE "simulation_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"model_version" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"outputs" jsonb NOT NULL,
	"is_forecast" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "solver_fills" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"chain_id" bigint NOT NULL,
	"rescue_id" varchar(66) NOT NULL,
	"solver" varchar(42) NOT NULL,
	"payout" varchar(42) NOT NULL,
	"policy_owner" varchar(42) NOT NULL,
	"principal" numeric(78, 0) NOT NULL,
	"fee" numeric(78, 0) NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" varchar(66) NOT NULL,
	"tx_hash" varchar(66) NOT NULL,
	"log_index" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "solver_liquidity_commitments" (
	"chain_id" bigint NOT NULL,
	"commitment_id" varchar(66) NOT NULL,
	"solver" varchar(42) NOT NULL,
	"policy_id" varchar(66) NOT NULL,
	"token" varchar(42) NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"remaining" numeric(78, 0) NOT NULL,
	"fee_bps" integer NOT NULL,
	"expiry" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	"created_block" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "solver_liquidity_commitments_chain_id_commitment_id_pk" PRIMARY KEY("chain_id","commitment_id"),
	CONSTRAINT "commit_remaining_ck" CHECK ("solver_liquidity_commitments"."remaining" <= "solver_liquidity_commitments"."amount"),
	CONSTRAINT "commit_state_ck" CHECK ("solver_liquidity_commitments"."state" in ('active','drawn','released','expired'))
);
--> statement-breakpoint
CREATE TABLE "solver_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" bigint NOT NULL,
	"solver" varchar(42) NOT NULL,
	"policy_id" varchar(66) NOT NULL,
	"token" varchar(42) NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"fee_bps" integer NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"signature" text NOT NULL,
	"status" text NOT NULL,
	"backing_commitment_id" varchar(66),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_status_ck" CHECK ("solver_quotes"."status" in ('offered','committed','expired','withdrawn','rejected')),
	CONSTRAINT "quote_fee_ck" CHECK ("solver_quotes"."fee_bps" between 0 and 1000)
);
--> statement-breakpoint
CREATE TABLE "solver_registrations" (
	"chain_id" bigint NOT NULL,
	"solver" varchar(42) NOT NULL,
	"payout" varchar(42) NOT NULL,
	"bond" numeric(78, 0) NOT NULL,
	"metadata_uri" text,
	"status" text NOT NULL,
	"total_filled" numeric(78, 0) DEFAULT '0' NOT NULL,
	"fills" integer DEFAULT 0 NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"registered_block" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "solver_registrations_chain_id_solver_pk" PRIMARY KEY("chain_id","solver"),
	CONSTRAINT "solver_status_ck" CHECK ("solver_registrations"."status" in ('active','suspended','exiting','exited'))
);
--> statement-breakpoint
CREATE TABLE "source_escrows" (
	"chain_id" bigint NOT NULL,
	"vault" varchar(42) NOT NULL,
	"owner" varchar(42) NOT NULL,
	"policy_id" varchar(66) NOT NULL,
	"token" varchar(42) NOT NULL,
	"repay_reserve" numeric(78, 0) NOT NULL,
	"fee_reserve" numeric(78, 0) NOT NULL,
	"max_fee_bps" integer NOT NULL,
	"total_reimbursed" numeric(78, 0) DEFAULT '0' NOT NULL,
	"paused_at" timestamp with time zone,
	"release_requested_at" timestamp with time zone,
	"updated_block" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_escrows_chain_id_vault_owner_policy_id_pk" PRIMARY KEY("chain_id","vault","owner","policy_id")
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"chain_id" bigint NOT NULL,
	"address" varchar(42) NOT NULL,
	"symbol" text NOT NULL,
	"decimals" smallint NOT NULL,
	"is_fixture" boolean DEFAULT false NOT NULL,
	CONSTRAINT "tokens_chain_id_address_pk" PRIMARY KEY("chain_id","address"),
	CONSTRAINT "token_decimals_ck" CHECK ("tokens"."decimals" between 0 and 36),
	CONSTRAINT "token_addr_ck" CHECK (address ~ '^0x[0-9a-f]{40}$')
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role" "role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" uuid,
	CONSTRAINT "user_roles_user_id_role_pk" PRIMARY KEY("user_id","role")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "verified_transactions" (
	"chain_id" bigint NOT NULL,
	"tx_hash" varchar(66) NOT NULL,
	"kind" text NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" varchar(66) NOT NULL,
	"status" text NOT NULL,
	"from_address" varchar(42),
	"to_address" varchar(42),
	"block_timestamp" timestamp with time zone,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finality" "finality" DEFAULT 'unfinalized' NOT NULL,
	CONSTRAINT "verified_transactions_chain_id_tx_hash_pk" PRIMARY KEY("chain_id","tx_hash"),
	CONSTRAINT "vtx_hash_ck" CHECK (tx_hash ~ '^0x[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "wallet_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"address" varchar(42) NOT NULL,
	"first_verified_chain_id" bigint NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_addr_ck" CHECK (address ~ '^0x[0-9a-f]{40}$')
);
--> statement-breakpoint
ALTER TABLE "api_credentials" ADD CONSTRAINT "api_credentials_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_subscriptions" ADD CONSTRAINT "device_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lending_positions" ADD CONSTRAINT "lending_positions_protocol_id_protocols_id_fk" FOREIGN KEY ("protocol_id") REFERENCES "public"."protocols"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_observations" ADD CONSTRAINT "position_observations_position_id_lending_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."lending_positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_chain_id_chains_chain_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("chain_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rescue_executions" ADD CONSTRAINT "rescue_executions_rescue_id_rescue_intents_rescue_id_fk" FOREIGN KEY ("rescue_id") REFERENCES "public"."rescue_intents"("rescue_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_sessions" ADD CONSTRAINT "simulation_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_chain_id_chains_chain_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("chain_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_identities" ADD CONSTRAINT "wallet_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_credentials_prefix_uq" ON "api_credentials" USING btree ("key_prefix");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "auth_nonces_expires_idx" ON "auth_nonces" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "chain_logs_uq" ON "chain_logs" USING btree ("chain_id","block_hash","log_index");--> statement-breakpoint
CREATE INDEX "chain_logs_event_idx" ON "chain_logs" USING btree ("chain_id","event_name","block_number");--> statement-breakpoint
CREATE INDEX "chain_logs_tx_idx" ON "chain_logs" USING btree ("chain_id","tx_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "deployment_registry_uq" ON "deployment_registry" USING btree ("chain_id","contract_name","address");--> statement-breakpoint
CREATE UNIQUE INDEX "device_subscriptions_endpoint_uq" ON "device_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE UNIQUE INDEX "incident_open_uq" ON "incident_records" USING btree ("dedup_key") WHERE "incident_records"."status" <> 'resolved';--> statement-breakpoint
CREATE INDEX "incident_policy_idx" ON "incident_records" USING btree ("policy_id","opened_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lending_positions_uq" ON "lending_positions" USING btree ("chain_id","protocol_id","account","collateral_asset","debt_asset");--> statement-breakpoint
CREATE INDEX "lending_positions_account_idx" ON "lending_positions" USING btree ("account");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_channels_uq" ON "notification_channels" USING btree ("user_id","kind","destination");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_uq" ON "notification_deliveries" USING btree ("dedup_key","channel_kind");--> statement-breakpoint
CREATE INDEX "notification_deliveries_user_idx" ON "notification_deliveries" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "policy_auth_owner_idx" ON "policy_authorizations" USING btree ("owner");--> statement-breakpoint
CREATE UNIQUE INDEX "position_obs_uq" ON "position_observations" USING btree ("position_id","block_hash");--> statement-breakpoint
CREATE INDEX "position_obs_time_idx" ON "position_observations" USING btree ("position_id","observed_at");--> statement-breakpoint
CREATE INDEX "policies_owner_idx" ON "protection_policies" USING btree ("owner");--> statement-breakpoint
CREATE INDEX "readiness_policy_idx" ON "readiness_snapshots" USING btree ("chain_id","policy_id","evaluated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rescue_exec_uq" ON "rescue_executions" USING btree ("chain_id","block_hash","log_index");--> statement-breakpoint
CREATE INDEX "rescue_exec_rescue_idx" ON "rescue_executions" USING btree ("rescue_id");--> statement-breakpoint
CREATE INDEX "rescue_intents_policy_idx" ON "rescue_intents" USING btree ("chain_id","policy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "risk_obs_uq" ON "risk_observations" USING btree ("chain_id","block_hash","log_index");--> statement-breakpoint
CREATE INDEX "risk_obs_policy_idx" ON "risk_observations" USING btree ("policy_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "settlement_claims_state_idx" ON "settlement_claims" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_events_uq" ON "settlement_events" USING btree ("chain_id","block_hash","log_index");--> statement-breakpoint
CREATE INDEX "settlement_events_rescue_idx" ON "settlement_events" USING btree ("rescue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "solver_fills_uq" ON "solver_fills" USING btree ("chain_id","block_hash","log_index");--> statement-breakpoint
CREATE INDEX "solver_fills_solver_idx" ON "solver_fills" USING btree ("solver");--> statement-breakpoint
CREATE INDEX "commitments_policy_idx" ON "solver_liquidity_commitments" USING btree ("chain_id","policy_id");--> statement-breakpoint
CREATE INDEX "quotes_policy_idx" ON "solver_quotes" USING btree ("chain_id","policy_id","valid_until");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_identities_address_uq" ON "wallet_identities" USING btree ("address");