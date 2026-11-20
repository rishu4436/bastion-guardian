import { describe, expect, it } from "vitest";
import type { Log } from "viem";
import { toLogRecord } from "../src/relay.js";

describe("toLogRecord", () => {
  const base = {
    address: "0x00000000000000000000000000000000000000aa",
    blockHash: "0x" + "11".repeat(32),
    blockNumber: 7n,
    data: "0x1234",
    logIndex: 3,
    transactionHash: "0x" + "22".repeat(32),
    transactionIndex: 0,
    removed: false,
  } as const;

  it("maps topics/opCode/identifiers exactly like the Reactive LogRecord", () => {
    const log = { ...base, topics: ["0x" + "01".repeat(32), "0x" + "02".repeat(32)] } as unknown as Log;
    const r = toLogRecord(log, 31337n);
    expect(r.opCode).toBe(2n);
    expect(r.topic0).toBe(BigInt("0x" + "01".repeat(32)));
    expect(r.topic2).toBe(0n);
    expect(r.logIndex).toBe(3n);
    expect(r.txHash).toBe(BigInt(base.transactionHash));
    expect(r.chainId).toBe(31337n);
  });

  it("refuses pending logs", () => {
    const log = { ...base, blockNumber: null, topics: [] } as unknown as Log;
    expect(() => toLogRecord(log, 1n)).toThrow();
  });
});
