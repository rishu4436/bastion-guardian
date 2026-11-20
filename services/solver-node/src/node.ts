import type { Address, Hex, LocalAccount, PublicClient, WalletClient } from "viem";
import { solverLiquidityVaultAbi } from "@bastion-guardian/contracts";
import { assertWriteAllowed, createLogger, type Logger } from "@bastion-guardian/service-kit";
import {
  QUOTE_TYPES,
  quoteDomain,
  type DemandItem,
  type SolverQuote,
} from "@bastion-guardian/solver-coordinator";

export interface SolverRiskLimits {
  /** Tokens this solver is willing to front. */
  tokens: Address[];
  maxPerPolicy: bigint;
  maxTotalCommitted: bigint;
  /** Fee the solver asks for; skipped when above the policy's maxFeeBps. */
  feeBps: number;
  commitmentTtlSec: number;
  /** Ignore demand smaller than this (gas is not worth it). */
  minCommit: bigint;
}

export interface SolverNodeConfig {
  chainId: number;
  rpcUrl: string;
  solverLiquidityVault: Address;
  account: LocalAccount;
  limits: SolverRiskLimits;
}

export interface DemandSource {
  demand(): Promise<DemandItem[]>;
}
export interface QuoteSink {
  submitQuote(q: SolverQuote, signature: Hex): Promise<string>;
}

export interface Action {
  policyId: string;
  kind: "commit" | "release" | "skip";
  amount: bigint;
  tx: Hex | null;
  reason: string | null;
}

/**
 * A solver only ever risks inventory it deposited itself, only through on-chain commitments the executor can draw,
 * and is reimbursed from the borrower's reserve budget on settlement. This node never signs for anyone else.
 */
export class SolverNode {
  private readonly log: Logger;
  private nonce = BigInt(Date.now());
  constructor(
    private readonly client: PublicClient,
    private readonly wallet: WalletClient,
    private readonly demand: DemandSource,
    private readonly quotes: QuoteSink | null,
    private readonly cfg: SolverNodeConfig,
    logger?: Logger,
  ) {
    assertWriteAllowed(cfg.chainId, cfg.rpcUrl);
    this.log = logger ?? createLogger("solver-node");
  }

  private read<T>(functionName: string, args: unknown[]): Promise<T> {
    return this.client.readContract({
      address: this.cfg.solverLiquidityVault,
      abi: solverLiquidityVaultAbi,
      functionName: functionName as never,
      args: args as never,
    }) as Promise<T>;
  }

  private async send(functionName: "commit" | "release", args: readonly unknown[]): Promise<Hex> {
    const { request } = await this.client.simulateContract({
      account: this.cfg.account,
      address: this.cfg.solverLiquidityVault,
      abi: solverLiquidityVaultAbi,
      functionName,
      args: args as never,
    });
    const hash = await this.wallet.writeContract({
      ...request,
      account: this.cfg.account,
      chain: this.wallet.chain,
    });
    const r = await this.client.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${functionName} reverted ${hash}`);
    return hash;
  }

  /** Our active, unexpired commitment amount per policy (read from chain, the source of truth). */
  private async exposure(policyId: Hex, now: bigint) {
    const ids = await this.read<readonly Hex[]>("commitmentsOf", [policyId]);
    let mine = 0n;
    const expired: Hex[] = [];
    for (const id of ids) {
      const c = await this.read<{ solver: Address; amount: bigint; expiry: bigint; active: boolean }>(
        "getCommitment",
        [id],
      );
      if (c.solver.toLowerCase() !== this.cfg.account.address.toLowerCase() || !c.active) continue;
      if (c.expiry <= now) expired.push(id);
      else mine += c.amount;
    }
    return { mine, expired };
  }

  async tick(): Promise<Action[]> {
    const L = this.cfg.limits;
    const now = (await this.client.getBlock()).timestamp;
    const me = this.cfg.account.address;
    const actions: Action[] = [];
    let total = await this.read<bigint>("totalCommittedOf", [me]);
    for (const d of await this.demand.demand()) {
      const pid = d.policyId as Hex;
      const { mine, expired } = await this.exposure(pid, now);
      for (const id of expired) {
        // Expired commitments return to free inventory.
        actions.push({
          policyId: pid,
          kind: "release",
          amount: 0n,
          tx: await this.send("release", [id]),
          reason: "EXPIRED",
        });
      }
      const token = d.debtAsset as Address;
      const skip = (reason: string) =>
        actions.push({ policyId: pid, kind: "skip", amount: 0n, tx: null, reason });
      if (d.shortfall === 0n) {
        skip("NO_SHORTFALL");
        continue;
      }
      if (!L.tokens.some((t) => t.toLowerCase() === token.toLowerCase())) {
        skip("TOKEN_NOT_SUPPORTED");
        continue;
      }
      if (L.feeBps > d.maxFeeBps) {
        skip("FEE_ABOVE_POLICY_MAX");
        continue;
      }
      const free = await this.read<bigint>("available", [me, token]);
      const amount = [d.shortfall, L.maxPerPolicy - mine, L.maxTotalCommitted - total, free].reduce((a, b) =>
        b < a ? b : a,
      );
      if (amount < L.minCommit || amount <= 0n) {
        skip(free === 0n ? "NO_INVENTORY" : "LIMIT_REACHED");
        continue;
      }
      const expiry = now + BigInt(L.commitmentTtlSec);
      const tx = await this.send("commit", [pid, token, amount, L.feeBps, expiry]);
      total += amount;
      actions.push({ policyId: pid, kind: "commit", amount, tx, reason: null });
      this.log.info(
        { policyId: pid, amount: amount.toString(), feeBps: L.feeBps, tx },
        "committed liquidity",
      );
      if (this.quotes) {
        const q: SolverQuote = {
          solver: me,
          policyId: pid,
          token,
          amount,
          feeBps: L.feeBps,
          validUntil: expiry < now + 3600n ? expiry : now + 3600n,
          nonce: this.nonce++,
        };
        const sig = await this.cfg.account.signTypedData({
          domain: quoteDomain(this.cfg.chainId, this.cfg.solverLiquidityVault),
          types: QUOTE_TYPES,
          primaryType: "SolverQuote",
          message: q,
        });
        await this.quotes
          .submitQuote(q, sig)
          .catch((e) => this.log.warn({ err: String(e) }, "quote rejected"));
      }
    }
    return actions;
  }
}
