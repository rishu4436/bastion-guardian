import { and, eq, gt, desc, sql } from "drizzle-orm";
import type { Hex, PublicClient } from "viem";
import {
  chainCheckpoints,
  chainLogs,
  incidentRecords,
  indexedBlocks,
  rescueExecutions,
  riskObservations,
  settlementEvents,
  solverFills,
  type Database,
} from "@bastion-guardian/db";
import { createLogger, type Logger } from "@bastion-guardian/observability";
import {
  decode,
  jsonArgs,
  type DecodedLog,
  type IndexedContract,
  type IndexedContractName,
} from "./contracts.js";
import {
  emptyTouched,
  insertEventRows,
  recompute,
  touch,
  type ProjectionContext,
  type Tx,
} from "./projections.js";

export interface IndexerConfig {
  chainId: number;
  contracts: IndexedContract[];
  /** First block to index when no checkpoint exists (deployment block). */
  startBlock: bigint;
  /** Max blocks per getLogs batch. */
  batchSize?: bigint;
  /** Max depth searched for a common ancestor; deeper reorgs halt with an incident. */
  maxReorgDepth?: number;
  reserveChainId: number;
  stream?: string;
}

export interface TickResult {
  from: bigint;
  to: bigint;
  logs: number;
  reorg: { ancestor: bigint; removedLogs: number } | null;
}

export class ReorgTooDeepError extends Error {}

export class ChainIndexer {
  private readonly byAddress: Map<string, IndexedContractName>;
  private readonly stream: string;
  private readonly log: Logger;

  constructor(
    private readonly db: Database,
    private readonly client: PublicClient,
    private readonly cfg: IndexerConfig,
    logger?: Logger,
  ) {
    this.byAddress = new Map(cfg.contracts.map((c) => [c.address.toLowerCase(), c.name]));
    this.stream = cfg.stream ?? "bastion";
    this.log = logger ?? createLogger("chain-indexer");
  }

  async checkpoint() {
    const [cp] = await this.db
      .select()
      .from(chainCheckpoints)
      .where(and(eq(chainCheckpoints.chainId, this.cfg.chainId), eq(chainCheckpoints.stream, this.stream)));
    return cp ?? null;
  }

  /** One forward step: detect/roll back reorgs, then ingest the next batch up to the current head. */
  async tick(): Promise<TickResult> {
    const head = await this.client.getBlockNumber();
    let cp = await this.checkpoint();
    let reorg: TickResult["reorg"] = null;
    if (cp) {
      const blk = await this.client.getBlock({ blockNumber: cp.lastBlock }).catch(() => null);
      if (!blk || blk.hash.toLowerCase() !== cp.lastBlockHash) {
        reorg = await this.rollback(cp.lastBlock);
        cp = await this.checkpoint();
      }
    }
    const from = cp ? cp.lastBlock + 1n : this.cfg.startBlock;
    const to = min(head, from + (this.cfg.batchSize ?? 2_000n) - 1n);
    if (from > to) return { from, to, logs: 0, reorg };
    const n = await this.ingest(from, to, true);
    return { from, to, logs: n, reorg };
  }

  /** Runs `tick` until the checkpoint reaches the head observed at call time. */
  async catchUp(): Promise<TickResult[]> {
    const target = await this.client.getBlockNumber();
    const out: TickResult[] = [];
    for (;;) {
      const r = await this.tick();
      out.push(r);
      if (r.to >= target || r.from > r.to) return out;
    }
  }

  /**
   * Idempotent re-ingestion of an already indexed (or older) range. Never moves the checkpoint and never duplicates
   * rows: logs are unique on (chain, block hash, log index) and derived state is recomputed from canonical logs.
   */
  async backfill(from: bigint, to: bigint): Promise<number> {
    let total = 0;
    const step = this.cfg.batchSize ?? 2_000n;
    for (let a = from; a <= to; a += step) total += await this.ingest(a, min(to, a + step - 1n), false);
    return total;
  }

  private async ingest(from: bigint, to: bigint, advance: boolean): Promise<number> {
    const raw = await this.client.getLogs({
      address: this.cfg.contracts.map((c) => c.address),
      fromBlock: from,
      toBlock: to,
    });
    const decoded = raw.map((l) => decode(l, this.byAddress)).filter((x): x is DecodedLog => x !== null);
    decoded.sort((a, b) =>
      a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1,
    );
    const numbers = [...new Set([...decoded.map((d) => d.blockNumber), to])];
    const headers = new Map<bigint, { hash: Hex; parentHash: Hex; timestamp: bigint }>();
    for (const n of numbers) {
      const b = await this.client.getBlock({ blockNumber: n });
      headers.set(n, {
        hash: b.hash.toLowerCase() as Hex,
        parentHash: b.parentHash.toLowerCase() as Hex,
        timestamp: b.timestamp,
      });
    }
    // A log whose block hash differs from the header we just read means the chain moved under us: retry later.
    for (const d of decoded)
      if (headers.get(d.blockNumber)!.hash !== d.blockHash)
        throw new Error(`block ${d.blockNumber} changed during ingestion`);

    const blockTime = new Map([...headers].map(([n, h]) => [n, new Date(Number(h.timestamp) * 1000)]));
    const ctx: ProjectionContext = {
      chainId: this.cfg.chainId,
      client: this.client,
      contracts: this.cfg.contracts,
      reserveChainId: this.cfg.reserveChainId,
      blockTime,
    };
    await this.db.transaction(async (tx) => {
      for (const [n, h] of headers)
        await tx
          .insert(indexedBlocks)
          .values({
            chainId: this.cfg.chainId,
            number: n,
            hash: h.hash,
            parentHash: h.parentHash,
            timestamp: blockTime.get(n)!,
          })
          .onConflictDoUpdate({
            target: [indexedBlocks.chainId, indexedBlocks.number],
            set: { hash: h.hash, parentHash: h.parentHash, timestamp: blockTime.get(n)! },
          });
      const touched = emptyTouched();
      for (const d of decoded) {
        await tx
          .insert(chainLogs)
          .values({
            chainId: this.cfg.chainId,
            blockNumber: d.blockNumber,
            blockHash: d.blockHash,
            txHash: d.txHash,
            logIndex: d.logIndex,
            address: d.address,
            eventName: d.eventName,
            args: jsonArgs(d.args),
          })
          .onConflictDoUpdate({
            target: [chainLogs.chainId, chainLogs.blockHash, chainLogs.logIndex],
            set: { removed: false },
          });
        touch(touched, d.eventName, jsonArgs(d.args));
      }
      // Derived rescue intents must exist before executions reference them; settlement events before claims.
      await recompute(tx, ctx, { ...emptyTouched(), rescueIds: touched.rescueIds });
      await insertEventRows(tx, ctx, decoded);
      await recompute(tx, ctx, touched);
      if (advance) {
        const h = headers.get(to)!;
        await tx
          .insert(chainCheckpoints)
          .values({ chainId: this.cfg.chainId, stream: this.stream, lastBlock: to, lastBlockHash: h.hash })
          .onConflictDoUpdate({
            target: [chainCheckpoints.chainId, chainCheckpoints.stream],
            set: { lastBlock: to, lastBlockHash: h.hash, updatedAt: new Date() },
          });
      }
    });
    if (decoded.length) this.log.info({ from, to, logs: decoded.length }, "ingested");
    return decoded.length;
  }

  /**
   * Finds the newest stored block whose hash is still canonical and rolls everything after it back: logs are marked
   * removed (kept for audit), event rows deleted, derived state recomputed, checkpoint rewound, incident recorded.
   */
  private async rollback(fromBlock: bigint): Promise<NonNullable<TickResult["reorg"]>> {
    const depth = this.cfg.maxReorgDepth ?? 128;
    const stored = await this.db
      .select()
      .from(indexedBlocks)
      .where(and(eq(indexedBlocks.chainId, this.cfg.chainId), sql`${indexedBlocks.number} <= ${fromBlock}`))
      .orderBy(desc(indexedBlocks.number))
      .limit(depth);
    let ancestor: { number: bigint; hash: string } | null = null;
    for (const b of stored) {
      const live = await this.client.getBlock({ blockNumber: b.number }).catch(() => null);
      if (live && live.hash.toLowerCase() === b.hash) {
        ancestor = { number: b.number, hash: b.hash };
        break;
      }
    }
    if (!ancestor) {
      if (stored.length < depth) {
        // Every stored block was reorged; fall back to just before the configured start block.
        const n = this.cfg.startBlock - 1n;
        const blk = await this.client.getBlock({ blockNumber: n < 0n ? 0n : n });
        ancestor = { number: blk.number, hash: blk.hash.toLowerCase() };
      } else {
        await this.recordIncident(
          "reorg_too_deep",
          `reorg deeper than ${depth} stored blocks below ${fromBlock}`,
          "critical",
          { fromBlock: fromBlock.toString() },
        );
        throw new ReorgTooDeepError(`no common ancestor within ${depth} stored blocks`);
      }
    }
    const a = ancestor;
    const ctx: ProjectionContext = {
      chainId: this.cfg.chainId,
      client: this.client,
      contracts: this.cfg.contracts,
      reserveChainId: this.cfg.reserveChainId,
      blockTime: new Map(),
    };
    let removedCount = 0;
    await this.db.transaction(async (tx: Tx) => {
      const chain = this.cfg.chainId;
      const removed = await tx
        .update(chainLogs)
        .set({ removed: true })
        .where(
          and(
            eq(chainLogs.chainId, chain),
            gt(chainLogs.blockNumber, a.number),
            eq(chainLogs.removed, false),
          ),
        )
        .returning();
      removedCount = removed.length;
      await tx
        .delete(rescueExecutions)
        .where(and(eq(rescueExecutions.chainId, chain), gt(rescueExecutions.blockNumber, a.number)));
      await tx
        .delete(riskObservations)
        .where(and(eq(riskObservations.chainId, chain), gt(riskObservations.blockNumber, a.number)));
      await tx
        .delete(solverFills)
        .where(and(eq(solverFills.chainId, chain), gt(solverFills.blockNumber, a.number)));
      await tx
        .delete(settlementEvents)
        .where(and(eq(settlementEvents.chainId, chain), gt(settlementEvents.blockNumber, a.number)));
      await tx
        .delete(indexedBlocks)
        .where(and(eq(indexedBlocks.chainId, chain), gt(indexedBlocks.number, a.number)));
      const touched = emptyTouched();
      for (const l of removed) touch(touched, l.eventName, l.args as Record<string, unknown>);
      await recompute(tx, ctx, touched);
      await tx
        .insert(chainCheckpoints)
        .values({ chainId: chain, stream: this.stream, lastBlock: a.number, lastBlockHash: a.hash })
        .onConflictDoUpdate({
          target: [chainCheckpoints.chainId, chainCheckpoints.stream],
          set: { lastBlock: a.number, lastBlockHash: a.hash, updatedAt: new Date() },
        });
    });
    await this.recordIncident(
      "chain_reorg",
      `reorg on chain ${this.cfg.chainId}: rolled back to block ${a.number}, ${removedCount} logs marked removed`,
      "warning",
      { ancestor: a.number.toString(), removedLogs: removedCount },
    );
    this.log.warn({ ancestor: a.number, removedLogs: removedCount }, "reorg rolled back");
    return { ancestor: a.number, removedLogs: removedCount };
  }

  private async recordIncident(
    kind: string,
    title: string,
    severity: "warning" | "critical",
    evidence: Record<string, unknown>,
  ) {
    await this.db
      .insert(incidentRecords)
      .values({
        dedupKey: `${kind}:${this.cfg.chainId}:${String(evidence.ancestor ?? evidence.fromBlock ?? "")}`,
        chainId: this.cfg.chainId,
        scope: "indexer",
        kind,
        severity,
        title,
        evidence,
        recommendedAction:
          kind === "reorg_too_deep"
            ? "Halt dependent automation, verify RPC health, then re-index from a trusted checkpoint."
            : "None required: affected rows were rolled back and re-derived from the canonical chain.",
      })
      .onConflictDoUpdate({
        target: incidentRecords.dedupKey,
        targetWhere: sql`${incidentRecords.status} <> 'resolved'`,
        set: { occurrences: sql`${incidentRecords.occurrences} + 1`, lastSeenAt: new Date() },
      });
  }
}

/** Confirmation status of a block given the chain head and finality depth. */
export function confirmation(
  blockNumber: bigint,
  head: bigint,
  finalityDepth: number,
): "observed" | "confirmed" {
  return head - blockNumber >= BigInt(finalityDepth) ? "confirmed" : "observed";
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);
