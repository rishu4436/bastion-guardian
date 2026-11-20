/**
 * LOCAL ANVIL SIMULATION — BASTION end-to-end scenario (not testnet evidence).
 *
 * Scenario A (FlashNet) and Scenario B (Solver Rescue + cross-"chain" settlement) plus Scenario D (safety) run against
 * the stack deployed by contracts/script/LocalSimulationDeploy.s.sol. The relay plays Reactive Lasna; both
 * "destination" and "reserve" contracts live on the same local chain 31337.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  type Address,
  type Hex,
  createPublicClient,
  createTestClient,
  createWalletClient,
  decodeEventLog,
  http,
  publicActions,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import {
  aaveV3LendingAdapterAbi,
  bastionRiskObserverAbi,
  crossChainReserveEscrowAbi,
  fixtureOracleAbi,
  fixtureTokenAbi,
  loadLocalDeployment,
  rescueSettlementLedgerAbi,
  solverRescueExecutorAbi,
  bastionCallbackRouterAbi,
} from "@bastion-guardian/contracts";
import { formatWad } from "@bastion-guardian/risk-engine";
import { LocalReactiveRelay, type ReactOutcome } from "./relay.js";

// Anvil's PUBLIC dev keys (index 0 = governance/fixture-oracle owner, index 4 = keeper + relayer).
const GOV = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const KEEPER = privateKeyToAccount("0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a");

const rpc = process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8645";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(rpc)) throw new Error(`refusing non-local RPC ${rpc}`);
const addressesPath = process.env.LOCAL_ADDRESSES ?? "contracts/out-evidence/local/addresses.json";
const evidencePath = process.env.LOCAL_EVIDENCE ?? addressesPath.replace("addresses.json", "e2e-run.json");
const A = loadLocalDeployment(addressesPath);

const pub = createPublicClient({ chain: foundry, transport: http(rpc) });
const test = createTestClient({ chain: foundry, mode: "anvil", transport: http(rpc) }).extend(publicActions);
const wallet = createWalletClient({ chain: foundry, transport: http(rpc) });
const relay = new LocalReactiveRelay({ public: pub, test, wallet, relayer: KEEPER.address }, A.reactiveCore, {
  [A.callbackRouter]: A.destCallbackProxy,
  [A.reserveEscrow]: A.reserveCallbackProxy,
});

const failures: string[] = [];
function check(cond: boolean, msg: string) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) failures.push(msg);
}

const debt = (acct: Address) =>
  pub.readContract({
    address: A.fixtureAdapter,
    abi: aaveV3LendingAdapterAbi,
    functionName: "getDebt",
    args: [acct, A.fUSDC],
  });
const hf = (acct: Address) =>
  pub.readContract({
    address: A.fixtureAdapter,
    abi: aaveV3LendingAdapterAbi,
    functionName: "getHealthFactor",
    args: [acct],
  });

async function send(
  account: typeof GOV,
  address: Address,
  abi: readonly unknown[],
  functionName: string,
  args: unknown[],
) {
  const hash = await wallet.writeContract({
    account,
    chain: foundry,
    address,
    abi: abi as never,
    functionName: functionName as never,
    args: args as never,
  });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${functionName} reverted (${hash})`);
  return r;
}

async function relayRange(from: bigint, to: bigint, label: string) {
  const logs = await relay.collect(from, to);
  const results: {
    reacted: ReactOutcome;
    delivery?: Awaited<ReturnType<typeof relay.deliver>>;
    at: number;
  }[] = [];
  for (const l of logs) {
    const reacted = await relay.react(l, BigInt(A.chainId));
    const delivery = reacted.callback ? await relay.deliver(reacted.callback) : undefined;
    results.push({ reacted, delivery, at: Date.now() });
    console.log(
      `  [${label}] origin ${l.transactionHash} → react ${reacted.reactTx} ${reacted.callback ? `→ callback ${delivery?.deliverTx} success=${delivery?.success}` : `ignored (${reacted.ignoredReason})`}`,
    );
  }
  return results;
}

async function main() {
  console.log("=== BASTION LOCAL ANVIL SIMULATION (chain 31337) — not testnet evidence ===");
  const startBlock = await pub.getBlockNumber();
  const debtA0 = await debt(A.borrowerA);
  const debtB0 = await debt(A.borrowerB);
  const payout0 = await pub.readContract({
    address: A.frUSDC,
    abi: fixtureTokenAbi,
    functionName: "balanceOf",
    args: [A.solverPayout],
  });

  // 1) Controlled market event on the labeled fixture oracle: fWETH 2000 → 1800.
  const tCrash = Date.now();
  const crash = await send(GOV, A.fixtureOracle, fixtureOracleAbi, "setAssetPrice", [
    A.fWETH,
    1800n * 10n ** 8n,
  ]);
  const hfA0 = await hf(A.borrowerA);
  const hfB0 = await hf(A.borrowerB);
  check(
    hfA0 < 1_250_000_000_000_000_000n && hfB0 < 1_250_000_000_000_000_000n,
    `both positions below trigger 1.25 (A=${formatWad(hfA0)}, B=${formatWad(hfB0)})`,
  );

  // 2) Permissionless observation: RiskObserved is emitted only because the lender's authoritative HF < trigger.
  const obsA = await send(KEEPER, A.riskObserver, bastionRiskObserverAbi, "observe", [A.policyA]);
  const obsB = await send(KEEPER, A.riskObserver, bastionRiskObserverAbi, "observe", [A.policyB]);

  // 3) Cycle 1: RiskObserved → react → authenticated router callback → rescue.
  const c1 = await relayRange(startBlock + 1n, await pub.getBlockNumber(), "risk");
  check(c1.filter((r) => r.delivery?.success).length === 2, "two risk callbacks delivered and executed");
  const debtA1 = await debt(A.borrowerA);
  const debtB1 = await debt(A.borrowerB);
  const hfA1 = await hf(A.borrowerA);
  const hfB1 = await hf(A.borrowerB);
  check(debtA1 < debtA0, `A (solver path) debt reduced ${debtA0} → ${debtA1} (fUSDC base units)`);
  check(debtB1 < debtB0, `B (flash path) debt reduced ${debtB0} → ${debtB1}`);
  check(hfA1 >= 1_500_000_000_000_000_000n, `A health factor reached target: ${formatWad(hfA1)}`);
  check(hfB1 >= 1_500_000_000_000_000_000n, `B health factor reached target: ${formatWad(hfB1)}`);
  const tRescued = Date.now();

  // 4) Cycle 2: SolverRescueExecuted → react → escrow.settleRescue on the reserve side.
  const afterC1 = await pub.getBlockNumber();
  const c2 = await relayRange(
    c1.length
      ? (await pub.getTransactionReceipt({ hash: c1[0]!.delivery!.deliverTx })).blockNumber
      : startBlock,
    afterC1,
    "settle",
  );
  const settleRun = c2.find(
    (r) => r.reacted.callback?.recipient.toLowerCase() === A.reserveEscrow.toLowerCase(),
  );
  check(Boolean(settleRun?.delivery?.success), "settlement callback delivered to reserve escrow");
  let rescueIdA: Hex | undefined;
  for (const r of c1) {
    const rec = await pub.getTransactionReceipt({ hash: r.delivery!.deliverTx });
    for (const l of rec.logs) {
      if (l.address.toLowerCase() !== A.solverRescueExecutor.toLowerCase()) continue;
      const ev = decodeEventLog({ abi: solverRescueExecutorAbi, data: l.data, topics: l.topics });
      if (ev.eventName === "SolverRescueExecuted") {
        rescueIdA = ev.args.rescueId;
        check(
          ev.args.policyOwner.toLowerCase() === A.borrowerA.toLowerCase(),
          "SolverRescueExecuted names the policy owner (R-07)",
        );
      }
    }
  }
  check(Boolean(rescueIdA), "solver rescue id captured");
  const payout1 = await pub.readContract({
    address: A.frUSDC,
    abi: fixtureTokenAbi,
    functionName: "balanceOf",
    args: [A.solverPayout],
  });
  const claim = await pub.readContract({
    address: A.reserveEscrow,
    abi: crossChainReserveEscrowAbi,
    functionName: "getClaim",
    args: [rescueIdA!],
  });
  check(claim.state === 1, "escrow claim state = Reimbursed");
  check(
    payout1 - payout0 === claim.principal + claim.fee,
    `solver reimbursed principal+fee = ${claim.principal + claim.fee}`,
  );
  check(claim.principal === debtA0 - debtA1, "reimbursed principal equals actual on-chain debt reduction");

  // 5) Cycle 3: ReimbursementCompleted → react → router.onSettlementAck → ledger final state.
  const c3 = await relayRange(afterC1 + 1n, await pub.getBlockNumber(), "ack");
  check(
    c3.some((r) => r.delivery?.success),
    "settlement acknowledgement delivered to router",
  );
  const stateA = await pub.readContract({
    address: A.ledger,
    abi: rescueSettlementLedgerAbi,
    functionName: "stateOf",
    args: [rescueIdA!],
  });
  check(stateA === 7, `ledger state for A = ReimbursementComplete (7), got ${stateA}`);
  const tSettled = Date.now();

  // 6) Scenario D — safety.
  const riskA = c1.find((r) => r.delivery?.success && r.reacted.callback)!;
  const replay = await relay.deliver(riskA.reacted.callback!);
  const replayRcpt = await pub.getTransactionReceipt({ hash: replay.deliverTx });
  const dup = replayRcpt.logs.some((l) => {
    if (l.address.toLowerCase() !== A.callbackRouter.toLowerCase()) return false;
    try {
      return (
        decodeEventLog({ abi: bastionCallbackRouterAbi, data: l.data, topics: l.topics }).eventName ===
        "DuplicateIgnored"
      );
    } catch {
      return false;
    }
  });
  check(
    dup && (await debt(A.borrowerA)) === debtA1,
    "replayed authenticated callback ignored (DuplicateIgnored), debt unchanged",
  );
  const originAgain = await relay.collect(riskA.reacted.record.blockNumber, riskA.reacted.record.blockNumber);
  const reReact = await relay.react(originAgain[0]!, BigInt(A.chainId));
  check(
    !reReact.callback && reReact.ignoredReason === "DUPLICATE",
    `duplicate origin log ignored by core (${reReact.ignoredReason})`,
  );
  const forged = await relay.deliver(riskA.reacted.callback!, KEEPER.address);
  check(
    !forged.success,
    "callback carrying a foreign RVM id rejected (CallbackNotAuthorized), no funds moved",
  );
  check((await debt(A.borrowerA)) === debtA1, "debt unchanged after forged callback");

  const evidence = {
    label:
      "LOCAL ANVIL SIMULATION — chain 31337 — NOT testnet evidence; timings are local wall-clock on one machine",
    generatedAt: new Date().toISOString(),
    chainId: A.chainId,
    crashTx: crash.transactionHash,
    observeTxs: [obsA.transactionHash, obsB.transactionHash],
    cycles: Object.fromEntries(
      Object.entries({ risk: c1, settlement: c2, acknowledgement: c3 }).map(([k, v]) => [
        k,
        v.map((r) => ({
          originTx: r.reacted.originTx,
          reactTx: r.reacted.reactTx,
          ignoredReason: r.reacted.ignoredReason ?? null,
          callbackRecipient: r.reacted.callback?.recipient ?? null,
          deliverTx: r.delivery?.deliverTx ?? null,
          success: r.delivery?.success ?? null,
        })),
      ]),
    ),
    borrowerA: {
      debtBefore: debtA0.toString(),
      debtAfter: debtA1.toString(),
      hfBefore: hfA0.toString(),
      hfAfter: hfA1.toString(),
      rescueId: rescueIdA,
    },
    borrowerB: {
      debtBefore: debtB0.toString(),
      debtAfter: debtB1.toString(),
      hfBefore: hfB0.toString(),
      hfAfter: hfB1.toString(),
    },
    reimbursement: { principal: claim.principal.toString(), fee: claim.fee.toString() },
    localWallClockMs: { crashToRescued: tRescued - tCrash, crashToSettled: tSettled - tCrash },
    safety: {
      replayDeliverTx: replay.deliverTx,
      duplicateOriginReactTx: reReact.reactTx,
      forgedDeliverTx: forged.deliverTx,
    },
    failures,
  };
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(
    evidencePath,
    JSON.stringify(evidence, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2),
  );
  console.log(`evidence: ${evidencePath}`);
  if (failures.length) {
    console.error(`${failures.length} check(s) failed`);
    process.exit(1);
  }
  console.log("ALL LOCAL SIMULATION CHECKS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
