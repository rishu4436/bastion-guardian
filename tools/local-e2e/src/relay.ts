/**
 * LOCAL SIMULATION of the Reactive Network's delivery path on a single anvil chain.
 *
 *   origin log (anvil) ──► relay reads the core's on-chain subscription table (getSource)
 *                      ──► impersonates the system contract 0x8888…8888 and calls BastionReactiveCore.react(LogRecord)
 *                      ──► MockReactiveSystem records requestCallbackV_1_0 and emits CallbackRequest
 *                      ──► relay delivers the payload through the local MockCallbackProxy, which injects the
 *                          ReactiveCore address as the first argument exactly like the documented Callback Proxy.
 *
 * This proves contract wiring, decoding, authentication and idempotency locally. It does NOT prove anything about
 * Reactive Lasna latency, gas pricing, or delivery guarantees; those require Phase 3 live evidence.
 */
import {
  type Address,
  type Hex,
  type Log,
  type PublicClient,
  type TestClient,
  type WalletClient,
  decodeAbiParameters,
  decodeEventLog,
  parseEther,
} from "viem";
import {
  bastionReactiveCoreAbi,
  mockCallbackProxyAbi,
  mockReactiveSystemAbi,
} from "@bastion-guardian/contracts";

export const SYSTEM_CONTRACT = "0x8888888888888888888888888888888888888888" as const;

export interface LogRecord {
  chainId: bigint;
  contractAddress: Address;
  topic0: bigint;
  topic1: bigint;
  topic2: bigint;
  topic3: bigint;
  data: Hex;
  blockNumber: bigint;
  opCode: bigint;
  blockHash: bigint;
  txHash: bigint;
  logIndex: bigint;
}

export interface Source {
  index: number;
  chainId: bigint;
  emitter: Address;
  topic0: Hex;
  kind: number;
  active: boolean;
}

export interface ReactOutcome {
  record: LogRecord;
  originTx: Hex;
  reactTx: Hex;
  accepted: boolean;
  ignoredReason?: string;
  callback?: { chainId: bigint; recipient: Address; gasLimit: bigint; payload: Hex };
}

export interface DeliveryOutcome {
  deliverTx: Hex;
  success: boolean;
  returnData: Hex;
}

export interface RelayClients {
  public: PublicClient;
  test: TestClient;
  wallet: WalletClient;
  relayer: Address;
}

const toU256 = (h: Hex | undefined): bigint => (h ? BigInt(h) : 0n);
const bytes32ToString = (h: Hex): string => {
  const buf = Buffer.from(h.slice(2), "hex");
  const end = buf.indexOf(0);
  return buf.subarray(0, end === -1 ? buf.length : end).toString("utf8");
};

export function toLogRecord(log: Log, chainId: bigint): LogRecord {
  if (
    log.blockNumber === null ||
    log.transactionHash === null ||
    log.logIndex === null ||
    log.blockHash === null
  ) {
    throw new Error("pending logs cannot be relayed");
  }
  const t = log.topics;
  return {
    chainId,
    contractAddress: log.address,
    topic0: toU256(t[0]),
    topic1: toU256(t[1]),
    topic2: toU256(t[2]),
    topic3: toU256(t[3]),
    data: log.data,
    blockNumber: log.blockNumber,
    opCode: BigInt(t.length),
    blockHash: BigInt(log.blockHash),
    txHash: BigInt(log.transactionHash),
    logIndex: BigInt(log.logIndex),
  };
}

export class LocalReactiveRelay {
  private readonly proxyFor: Map<string, Address>;

  constructor(
    private readonly c: RelayClients,
    private readonly core: Address,
    /** recipient address (lowercase) → local callback proxy for that "chain". */
    proxies: Record<string, Address>,
  ) {
    this.proxyFor = new Map(Object.entries(proxies).map(([k, v]) => [k.toLowerCase(), v]));
  }

  async sources(): Promise<Source[]> {
    const n = (await this.c.public.readContract({
      address: this.core,
      abi: bastionReactiveCoreAbi,
      functionName: "sourceCount",
    })) as bigint;
    const out: Source[] = [];
    for (let i = 0n; i < n; i++) {
      const s = (await this.c.public.readContract({
        address: this.core,
        abi: bastionReactiveCoreAbi,
        functionName: "getSource",
        args: [i],
      })) as { chainId: bigint; emitter: Address; topic0: bigint; kind: number; active: boolean };
      out.push({
        index: Number(i),
        chainId: s.chainId,
        emitter: s.emitter,
        topic0: `0x${s.topic0.toString(16).padStart(64, "0")}`,
        kind: s.kind,
        active: s.active,
      });
    }
    return out;
  }

  /** Collect logs that match the core's ACTIVE subscriptions in [fromBlock, toBlock], in canonical order. */
  async collect(fromBlock: bigint, toBlock: bigint): Promise<Log[]> {
    const subs = (await this.sources()).filter((s) => s.active);
    const logs: Log[] = [];
    for (const s of subs) {
      const found = await this.c.public.getLogs({ address: s.emitter, fromBlock, toBlock });
      logs.push(...found.filter((l) => l.topics[0]?.toLowerCase() === s.topic0.toLowerCase()));
    }
    return logs.sort((a, b) =>
      a.blockNumber === b.blockNumber
        ? (a.logIndex ?? 0) - (b.logIndex ?? 0)
        : Number(a.blockNumber! - b.blockNumber!),
    );
  }

  /** Deliver one origin log to BastionReactiveCore.react as the (impersonated) system contract. */
  async react(log: Log, chainId: bigint): Promise<ReactOutcome> {
    const record = toLogRecord(log, chainId);
    await this.c.test.impersonateAccount({ address: SYSTEM_CONTRACT });
    await this.c.test.setBalance({ address: SYSTEM_CONTRACT, value: parseEther("10") });
    let reactTx: Hex;
    try {
      reactTx = await this.c.wallet.writeContract({
        account: SYSTEM_CONTRACT,
        chain: null,
        address: this.core,
        abi: bastionReactiveCoreAbi,
        functionName: "react",
        args: [record] as never,
      });
    } finally {
      await this.c.test.stopImpersonatingAccount({ address: SYSTEM_CONTRACT });
    }
    const receipt = await this.c.public.waitForTransactionReceipt({ hash: reactTx });
    if (receipt.status !== "success") throw new Error(`react reverted: ${reactTx}`);
    const outcome: ReactOutcome = { record, originTx: log.transactionHash!, reactTx, accepted: false };
    for (const l of receipt.logs) {
      if (l.address.toLowerCase() === this.core.toLowerCase()) {
        try {
          const ev = decodeEventLog({ abi: bastionReactiveCoreAbi, data: l.data, topics: l.topics });
          if (ev.eventName === "EventIgnored") outcome.ignoredReason = bytes32ToString(ev.args.reason);
          if (ev.eventName === "EventAccepted") outcome.accepted = true;
        } catch {
          /* not a core event */
        }
      }
      if (l.address.toLowerCase() === SYSTEM_CONTRACT.toLowerCase()) {
        const ev = decodeEventLog({ abi: mockReactiveSystemAbi, data: l.data, topics: l.topics });
        if (ev.eventName === "CallbackRequest") {
          const [cfg] = decodeAbiParameters(
            [
              {
                type: "tuple",
                components: [
                  { name: "chainId", type: "uint256" },
                  { name: "recipient", type: "address" },
                  { name: "gasLimit", type: "uint64" },
                  { name: "payload", type: "bytes" },
                ],
              },
            ],
            ev.args.configuration,
          );
          outcome.callback = cfg;
          outcome.accepted = true;
        }
      }
    }
    return outcome;
  }

  /** Deliver a requested callback through the local callback proxy (injects the core as RVM id). */
  async deliver(cb: NonNullable<ReactOutcome["callback"]>, rvmOverride?: Address): Promise<DeliveryOutcome> {
    const proxy = this.proxyFor.get(cb.recipient.toLowerCase());
    if (!proxy) throw new Error(`no local proxy configured for recipient ${cb.recipient}`);
    const deliverTx = await this.c.wallet.writeContract({
      account: this.c.relayer,
      chain: null,
      address: proxy,
      abi: mockCallbackProxyAbi,
      functionName: "deliver",
      args: [cb.recipient, cb.payload, rvmOverride ?? this.core, cb.gasLimit],
      // Explicit gas: eth_estimateGas would find the minimum at which the OUTER tx succeeds, which can starve the
      // router's inner try/catch rescue attempt. The real Callback Proxy forwards the requested gasLimit.
      gas: cb.gasLimit + 300_000n,
    });
    const receipt = await this.c.public.waitForTransactionReceipt({ hash: deliverTx });
    if (receipt.status !== "success") throw new Error(`proxy.deliver reverted: ${deliverTx}`);
    for (const l of receipt.logs) {
      if (l.address.toLowerCase() !== proxy.toLowerCase()) continue;
      const ev = decodeEventLog({ abi: mockCallbackProxyAbi, data: l.data, topics: l.topics });
      if (ev.eventName === "CallbackDelivered") {
        return { deliverTx, success: ev.args.success, returnData: ev.args.returnData };
      }
    }
    throw new Error("CallbackDelivered not emitted");
  }
}
