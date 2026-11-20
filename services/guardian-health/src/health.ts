import { and, desc, eq, sql } from "drizzle-orm";
import { keccak256, toHex, type Address, type Hex, type PublicClient } from "viem";
import {
  aaveV3LendingAdapterAbi,
  bastionEmergencyControlAbi,
  bastionPolicyRegistryAbi,
  bastionProtectionVaultAbi,
  bastionReactiveCoreAbi,
  fixtureSwapVenueAbi,
  flashRescueExecutorAbi,
  mockCallbackProxyAbi,
  solverLiquidityVaultAbi,
  solverRegistryAbi,
} from "@bastion-guardian/contracts";
import {
  incidentRecords,
  lendingPositions,
  positionObservations,
  protectionPolicies,
  readinessSnapshots,
  type Database,
} from "@bastion-guardian/db";
import {
  BPS,
  WAD,
  baseToTokenUp,
  bufferedTarget,
  evaluateReadiness,
  mulDiv,
  repayBaseForTarget,
  simulateFlashRescue,
  type ReadinessReport,
} from "@bastion-guardian/risk-engine";
import { createLogger, type Logger } from "@bastion-guardian/service-kit";

export interface GuardianHealthConfig {
  chainId: number;
  policyRegistry: Address;
  flashRescueExecutor: Address;
  solverLiquidityVault: Address;
  solverRegistry: Address;
  emergency: Address;
  /** Reactive side. */
  reactiveCore: Address;
  /** Callback proxies and the contracts whose callback debt they track. */
  callbackDebtors: { proxy: Address; debtor: Address }[];
  /** Reserve side (may be another chain's client). */
  protectionVault: Address;
  heartbeatMaxAgeSec?: number;
}

export interface Clients {
  destination: PublicClient;
  reactive: PublicClient;
  reserve: PublicClient;
}

const SCOPE_ALL = keccak256(toHex("BASTION.SCOPE.ALL"));
const SCOPE_RESCUE = keccak256(toHex("BASTION.SCOPE.RESCUE"));
const PATH_FLASH = 1;
const PATH_SOLVER = 2;

export interface PolicyReadiness extends ReadinessReport {
  policyId: Hex;
  requiredRepayAtTrigger: bigint | null;
  inputs: Record<string, string | number | boolean | null>;
}

/**
 * Readiness is computed at the policy's trigger boundary: "if HF fell to the trigger right now, could BASTION rescue
 * to target?" Every input is read from the chain (or the observer's DB rows for the heartbeat); a read that fails is
 * UNKNOWN, never assumed healthy. Readiness is not a guarantee of rescue success.
 */
export class GuardianHealthService {
  private readonly log: Logger;
  constructor(
    private readonly db: Database,
    private readonly c: Clients,
    private readonly cfg: GuardianHealthConfig,
    logger?: Logger,
  ) {
    this.log = logger ?? createLogger("guardian-health");
  }

  async tick(): Promise<PolicyReadiness[]> {
    const pols = await this.db
      .select()
      .from(protectionPolicies)
      .where(eq(protectionPolicies.chainId, this.cfg.chainId));
    const out: PolicyReadiness[] = [];
    for (const p of pols) {
      const r = await this.evaluate(p.policyId as Hex);
      await this.persist(r);
      out.push(r);
    }
    return out;
  }

  private async tryRead<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (e) {
      this.log.warn(
        { err: e instanceof Error ? e.message : String(e) },
        "read failed (input treated as UNKNOWN)",
      );
      return null;
    }
  }

  async evaluate(policyId: Hex): Promise<PolicyReadiness> {
    const d = this.c.destination;
    const block = await d.getBlock();
    const now = Number(block.timestamp);
    const got = await this.tryRead(() =>
      d.readContract({
        address: this.cfg.policyRegistry,
        abi: bastionPolicyRegistryAbi,
        functionName: "getPolicy",
        args: [policyId],
      }),
    );
    const p = got?.[0];
    const st = got?.[1];

    const emergencyPaused = await this.tryRead(async () => {
      const [all, rescue] = await Promise.all(
        [SCOPE_ALL, SCOPE_RESCUE].map((s) =>
          d.readContract({
            address: this.cfg.emergency,
            abi: bastionEmergencyControlAbi,
            functionName: "isPaused",
            args: [s],
          }),
        ),
      );
      return all! || rescue!;
    });

    const r = this.c.reactive;
    const reactive = await this.tryRead(async () => {
      const paused = await r.readContract({
        address: this.cfg.reactiveCore,
        abi: bastionReactiveCoreAbi,
        functionName: "paused",
      });
      const n = await r.readContract({
        address: this.cfg.reactiveCore,
        abi: bastionReactiveCoreAbi,
        functionName: "sourceCount",
      });
      let allActive = n > 0n;
      for (let i = 0n; i < n; i++) {
        const s = await r.readContract({
          address: this.cfg.reactiveCore,
          abi: bastionReactiveCoreAbi,
          functionName: "getSource",
          args: [i],
        });
        allActive &&= s.active;
      }
      const coreDebt = await r.readContract({
        address: this.cfg.reactiveCore,
        abi: bastionReactiveCoreAbi,
        functionName: "outstandingDebt",
      });
      return { coreActive: !paused, subscriptionsActive: allActive, coreDebt };
    });
    const callbackDebt = await this.tryRead(async () => {
      let total = reactive?.coreDebt ?? 0n;
      for (const x of this.cfg.callbackDebtors)
        total += await d.readContract({
          address: x.proxy,
          abi: mockCallbackProxyAbi,
          functionName: "debt",
          args: [x.debtor],
        });
      return total;
    });

    // Heartbeat = the newest authoritative observation of this account written by the risk-observer.
    const hb = p
      ? await this.db
          .select({ at: positionObservations.observedAt })
          .from(positionObservations)
          .innerJoin(lendingPositions, eq(lendingPositions.id, positionObservations.positionId))
          .where(
            and(
              eq(lendingPositions.chainId, this.cfg.chainId),
              eq(lendingPositions.account, p.account.toLowerCase()),
              eq(positionObservations.source, "chain"),
            ),
          )
          .orderBy(desc(positionObservations.observedAt))
          .limit(1)
      : [];

    let requiredRepay: bigint | null = null;
    let solverCoverage: bigint | null = null;
    let vaultBudget: bigint | null = null;
    let remainingBudget: bigint | null = null;
    let flashFeasible: boolean | null = null;
    let oracle: "OK" | "UNAVAILABLE" | null = null;
    const inputs: PolicyReadiness["inputs"] = {};

    if (p) {
      const pos = await this.tryRead(() =>
        d.readContract({
          address: p.adapter,
          abi: aaveV3LendingAdapterAbi,
          functionName: "getPosition",
          args: [p.account, p.collateralAsset, p.debtAsset],
        }),
      );
      if (pos) {
        oracle = pos.debtPrice > 0n && pos.collateralPrice > 0n ? "OK" : "UNAVAILABLE";
        const lt = pos.currentLiquidationThreshold;
        if (pos.totalDebtBase > 0n && lt > 0n) {
          const cTrig = mulDiv(p.triggerHealthFactor * pos.totalDebtBase, BPS, lt * WAD);
          const xBase = repayBaseForTarget(
            cTrig,
            pos.totalDebtBase,
            lt,
            bufferedTarget(p.targetHealthFactor),
          );
          requiredRepay = xBase === 0n ? 0n : baseToTokenUp(xBase, pos.debtPrice, Number(pos.debtDecimals));
          if (requiredRepay > pos.debtAmount) requiredRepay = pos.debtAmount;
        } else requiredRepay = 0n;
        inputs.healthFactorWad = pos.healthFactor.toString();
        remainingBudget = await this.tryRead(() =>
          d.readContract({
            address: this.cfg.policyRegistry,
            abi: bastionPolicyRegistryAbi,
            functionName: "remainingRepay",
            args: [policyId],
          }),
        );
        const remainingFees = await this.tryRead(() =>
          d.readContract({
            address: this.cfg.policyRegistry,
            abi: bastionPolicyRegistryAbi,
            functionName: "remainingFees",
            args: [policyId],
          }),
        );

        // Solver path: committed, unexpired, allowlisted, eligible liquidity only (quotes never count).
        if ((p.allowedPaths & PATH_SOLVER) !== 0) {
          solverCoverage = await this.tryRead(async () => {
            const ids = await d.readContract({
              address: this.cfg.solverLiquidityVault,
              abi: solverLiquidityVaultAbi,
              functionName: "commitmentsOf",
              args: [policyId],
            });
            let sum = 0n;
            for (const id of ids) {
              const c = await d.readContract({
                address: this.cfg.solverLiquidityVault,
                abi: solverLiquidityVaultAbi,
                functionName: "getCommitment",
                args: [id],
              });
              if (!c.active || Number(c.expiry) <= now || c.feeBps > p.maxFeeBps) continue;
              const [allowed, eligible] = await Promise.all([
                d.readContract({
                  address: this.cfg.policyRegistry,
                  abi: bastionPolicyRegistryAbi,
                  functionName: "isSolverAllowed",
                  args: [policyId, c.solver],
                }),
                d.readContract({
                  address: this.cfg.solverRegistry,
                  abi: solverRegistryAbi,
                  functionName: "isEligible",
                  args: [c.solver],
                }),
              ]);
              if (allowed && eligible) sum += c.amount;
            }
            return sum;
          });
          vaultBudget = await this.tryRead(async () => {
            const b = await this.c.reserve.readContract({
              address: this.cfg.protectionVault,
              abi: bastionProtectionVaultAbi,
              functionName: "getBudget",
              args: [p.owner, policyId],
            });
            return b.pausedAt > 0n ? 0n : b.repayReserve;
          });
        } else solverCoverage = 0n;

        // FlashNet path: run the exact executor model at the trigger-boundary price.
        if (
          (p.allowedPaths & PATH_FLASH) !== 0 &&
          remainingBudget !== null &&
          remainingFees !== null &&
          pos.collateralAmount > 0n
        ) {
          flashFeasible = await this.tryRead(async () => {
            const venue = await d.readContract({
              address: this.cfg.flashRescueExecutor,
              abi: flashRescueExecutorAbi,
              functionName: "defaultVenue",
            });
            const venueCost = await this.tryRead(() =>
              d.readContract({ address: venue, abi: fixtureSwapVenueAbi, functionName: "executionCostBps" }),
            );
            const [premium, auth] = await Promise.all([
              d.readContract({
                address: p.adapter,
                abi: aaveV3LendingAdapterAbi,
                functionName: "flashPremiumBps",
              }),
              d.readContract({
                address: p.adapter,
                abi: aaveV3LendingAdapterAbi,
                functionName: "collateralAuthorization",
                args: [p.account, p.collateralAsset],
              }),
            ]);
            const cTrig = mulDiv(p.triggerHealthFactor * pos.totalDebtBase, BPS, lt * WAD);
            const priceTrig = mulDiv(cTrig, 10n ** BigInt(pos.collateralDecimals), pos.collateralAmount);
            const collLt = pos.collateralLiquidationThreshold;
            const sim = simulateFlashRescue(
              {
                reserves: [
                  {
                    asset: p.collateralAsset,
                    symbol: "COLL",
                    decimals: Number(pos.collateralDecimals),
                    price: priceTrig,
                    ltBps: collLt,
                    ltvBps: collLt,
                  },
                  {
                    asset: p.debtAsset,
                    symbol: "DEBT",
                    decimals: Number(pos.debtDecimals),
                    price: pos.debtPrice,
                    ltBps: 0n,
                    ltvBps: 0n,
                  },
                ],
                collateral: { [p.collateralAsset]: pos.collateralAmount },
                debt: { [p.debtAsset]: pos.debtAmount },
              },
              {
                collateralAsset: p.collateralAsset,
                debtAsset: p.debtAsset,
                triggerHf: p.triggerHealthFactor,
                targetHf: p.targetHealthFactor,
                remainingRepay: remainingBudget!,
                remainingFees: remainingFees!,
                maxSlippageBps: BigInt(p.maxSlippageBps),
                maxFeeBps: BigInt(p.maxFeeBps),
                allowPartial: p.allowPartial,
                allowFlash: true,
                allowSolver: false,
              },
              {
                flashLoanAvailable: true,
                flashPremiumBps: premium,
                flashLiquidity: 2n ** 255n,
                venueAvailable: venue !== "0x0000000000000000000000000000000000000000",
                // Unknown venue cost → assume the policy's whole slippage allowance is consumed (conservative).
                venueExecutionCostBps: venueCost ?? BigInt(p.maxSlippageBps),
                collateralAuthorization: auth,
              },
            );
            inputs.flashReason = sim.reason;
            return sim.feasible;
          });
        } else if ((p.allowedPaths & PATH_FLASH) === 0) flashFeasible = false;
      }
    }

    const report = evaluateReadiness({
      now,
      policy:
        p && st ? { active: st.status === 1, paused: st.status === 2, expiresAt: Number(p.expiry) } : null,
      reactive: {
        coreActive: reactive?.coreActive ?? null,
        subscriptionsActive: reactive?.subscriptionsActive ?? null,
        callbackDebt,
        lastHeartbeatAt: hb[0] ? Math.floor(hb[0].at.getTime() / 1000) : null,
      },
      protection: {
        requiredRepay,
        remainingPolicyBudget: remainingBudget,
        vaultBudget,
        solverCoverage,
        flashFeasible,
      },
      oracle: { status: oracle },
      emergencyPaused,
      heartbeatMaxAgeSec: this.cfg.heartbeatMaxAgeSec,
    });
    Object.assign(inputs, {
      requiredRepayAtTrigger: requiredRepay?.toString() ?? null,
      solverCoverage: solverCoverage?.toString() ?? null,
      vaultBudget: vaultBudget?.toString() ?? null,
      remainingPolicyBudget: remainingBudget?.toString() ?? null,
      flashFeasible,
      callbackDebt: callbackDebt?.toString() ?? null,
      evaluatedAtBlock: block.number.toString(),
    });
    return { ...report, policyId, requiredRepayAtTrigger: requiredRepay, inputs };
  }

  private async persist(r: PolicyReadiness) {
    const pid = r.policyId.toLowerCase();
    await this.db.insert(readinessSnapshots).values({
      chainId: this.cfg.chainId,
      policyId: pid,
      status: r.status,
      checks: { checks: r.checks, reasons: r.reasons, inputs: r.inputs },
      dataAsOf: new Date(),
    });
    const dedupKey = `readiness:${this.cfg.chainId}:${pid}`;
    if (r.status === "UNAVAILABLE" || r.status === "UNKNOWN") {
      await this.db
        .insert(incidentRecords)
        .values({
          dedupKey,
          chainId: this.cfg.chainId,
          policyId: pid,
          scope: "policy",
          kind: r.status === "UNAVAILABLE" ? "protection_unavailable" : "protection_unknown",
          severity: r.status === "UNAVAILABLE" ? "critical" : "warning",
          title: `Guardian Mode ${r.status}: ${r.reasons.join("; ") || "see checks"}`,
          evidence: { checks: r.checks, inputs: r.inputs },
          recommendedAction: recommend(r),
        })
        .onConflictDoUpdate({
          target: incidentRecords.dedupKey,
          targetWhere: sql`${incidentRecords.status} <> 'resolved'`,
          set: {
            occurrences: sql`${incidentRecords.occurrences} + 1`,
            lastSeenAt: new Date(),
            evidence: { checks: r.checks, inputs: r.inputs },
          },
        });
    } else {
      await this.db
        .update(incidentRecords)
        .set({ status: "resolved", resolvedAt: new Date() })
        .where(and(eq(incidentRecords.dedupKey, dedupKey), sql`${incidentRecords.status} <> 'resolved'`));
    }
  }
}

function recommend(r: PolicyReadiness): string {
  const c = r.checks;
  if (c.policy === "fail") return "Resume or re-register the protection policy.";
  if (c.emergency === "fail")
    return "Protocol is paused by guardians; protection resumes after quorum approval.";
  if (c.callbackDebt === "fail")
    return "Top up the callback contract (coverDebt) so Reactive callbacks can be delivered.";
  if (c.reactive === "fail")
    return "Reactive core paused or subscriptions inactive: operator action required.";
  if (c.capacity === "fail")
    return "Add solver commitments, fund the reserve budget, or authorize collateral for FlashNet.";
  if (c.heartbeat !== "pass") return "Check that the risk-observer service is running.";
  return "Investigate the failing checks.";
}
