import { and, desc, eq } from "drizzle-orm";
import type { Account, Address, Hex, PublicClient, WalletClient } from "viem";
import { aaveV3LendingAdapterAbi, bastionRiskObserverAbi } from "@bastion-guardian/contracts";
import {
  lendingPositions,
  policyVersions,
  positionObservations,
  protectionPolicies,
  type Database,
} from "@bastion-guardian/db";
import { assertWriteAllowed, createLogger, type Logger } from "@bastion-guardian/service-kit";

export interface RiskObserverConfig {
  chainId: number;
  rpcUrl: string;
  protocolId: string;
  riskObserver: Address;
  /** Keeper that pays gas for permissionless observe(); omit to run read-only. */
  keeper?: Account;
}

export interface PolicyObservation {
  policyId: Hex;
  account: Address;
  healthFactorWad: bigint;
  triggerHealthFactorWad: bigint;
  belowTrigger: boolean;
  observeTx: Hex | null;
  skippedReason: string | null;
}

/**
 * The observer never decides a rescue itself: it records what the lender reports and, when HF < trigger, calls the
 * permissionless on-chain observer, which re-checks everything against the lender before emitting RiskObserved.
 */
export class RiskObserverService {
  private readonly log: Logger;
  constructor(
    private readonly db: Database,
    private readonly client: PublicClient,
    private readonly wallet: WalletClient | null,
    private readonly cfg: RiskObserverConfig,
    logger?: Logger,
  ) {
    this.log = logger ?? createLogger("risk-observer");
    if (cfg.keeper) assertWriteAllowed(cfg.chainId, cfg.rpcUrl);
  }

  async tick(): Promise<PolicyObservation[]> {
    const rows = await this.db
      .select({ p: protectionPolicies, v: policyVersions })
      .from(protectionPolicies)
      .innerJoin(
        policyVersions,
        and(
          eq(policyVersions.chainId, protectionPolicies.chainId),
          eq(policyVersions.policyId, protectionPolicies.policyId),
          eq(policyVersions.version, protectionPolicies.currentVersion),
        ),
      )
      .where(and(eq(protectionPolicies.chainId, this.cfg.chainId), eq(protectionPolicies.status, "Active")));
    const block = await this.client.getBlock();
    const out: PolicyObservation[] = [];
    for (const { p, v } of rows) {
      if (v.expiry.getTime() <= Number(block.timestamp) * 1000) continue;
      const pos = await this.client.readContract({
        address: p.adapter as Address,
        abi: aaveV3LendingAdapterAbi,
        functionName: "getPosition",
        args: [p.account as Address, p.collateralAsset as Address, p.debtAsset as Address],
        blockNumber: block.number,
      });
      await this.record(p, pos, block.number, block.hash, new Date(Number(block.timestamp) * 1000));
      const trigger = BigInt(v.triggerHealthFactorWad);
      const below = pos.healthFactor < trigger;
      const obs: PolicyObservation = {
        policyId: p.policyId as Hex,
        account: p.account as Address,
        healthFactorWad: pos.healthFactor,
        triggerHealthFactorWad: trigger,
        belowTrigger: below,
        observeTx: null,
        skippedReason: below ? null : "ABOVE_TRIGGER",
      };
      if (below) await this.submit(obs);
      out.push(obs);
    }
    return out;
  }

  private async submit(o: PolicyObservation) {
    if (!this.cfg.keeper || !this.wallet) {
      o.skippedReason = "READ_ONLY";
      return;
    }
    // Dry-run first: the contract returns emitted=false inside the per-policy interval or if HF recovered.
    const sim = await this.client.simulateContract({
      account: this.cfg.keeper,
      address: this.cfg.riskObserver,
      abi: bastionRiskObserverAbi,
      functionName: "observe",
      args: [o.policyId],
    });
    if (!sim.result[0]) {
      o.skippedReason = "NOT_EMITTED_BY_CONTRACT";
      return;
    }
    const hash = await this.wallet.writeContract({
      ...sim.request,
      account: this.cfg.keeper,
      chain: this.wallet.chain,
    });
    const r = await this.client.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`observe reverted: ${hash}`);
    o.observeTx = hash;
    this.log.info(
      { policyId: o.policyId, hf: o.healthFactorWad.toString(), tx: hash },
      "RiskObserved submitted",
    );
  }

  private async record(
    p: typeof protectionPolicies.$inferSelect,
    pos: {
      totalCollateralBase: bigint;
      totalDebtBase: bigint;
      currentLiquidationThreshold: bigint;
      healthFactor: bigint;
      debtAmount: bigint;
      collateralAmount: bigint;
    },
    blockNumber: bigint,
    blockHash: Hex,
    at: Date,
  ) {
    const key = {
      chainId: this.cfg.chainId,
      protocolId: this.cfg.protocolId,
      account: p.account,
      collateralAsset: p.collateralAsset,
      debtAsset: p.debtAsset,
    };
    const vals = {
      collateralAmount: pos.collateralAmount.toString(),
      debtAmount: pos.debtAmount.toString(),
      healthFactorWad: pos.healthFactor.toString(),
      liquidationThresholdBps: Number(pos.currentLiquidationThreshold),
      observedBlock: blockNumber,
      observedAt: at,
    };
    const [row] = await this.db
      .insert(lendingPositions)
      .values({ ...key, ...vals })
      .onConflictDoUpdate({
        target: [
          lendingPositions.chainId,
          lendingPositions.protocolId,
          lendingPositions.account,
          lendingPositions.collateralAsset,
          lendingPositions.debtAsset,
        ],
        set: vals,
      })
      .returning({ id: lendingPositions.id });
    await this.db
      .insert(positionObservations)
      .values({
        positionId: row!.id,
        blockNumber,
        blockHash: blockHash.toLowerCase(),
        observedAt: at,
        collateralAmount: vals.collateralAmount,
        debtAmount: vals.debtAmount,
        collateralBase: pos.totalCollateralBase.toString(),
        debtBase: pos.totalDebtBase.toString(),
        healthFactorWad: vals.healthFactorWad,
        liquidationThresholdBps: vals.liquidationThresholdBps,
        source: "chain",
      })
      .onConflictDoNothing();
  }

  /** Latest observations for a position (newest first). */
  async history(positionId: string, limit = 100) {
    return this.db
      .select()
      .from(positionObservations)
      .where(eq(positionObservations.positionId, positionId))
      .orderBy(desc(positionObservations.observedAt))
      .limit(limit);
  }
}
