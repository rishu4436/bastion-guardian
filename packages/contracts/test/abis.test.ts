import { describe, expect, it } from "vitest";
import { toEventSelector, toFunctionSelector } from "viem";
import {
  bastionReactiveCoreAbi,
  bastionRiskObserverAbi,
  crossChainReserveEscrowAbi,
  solverRescueExecutorAbi,
} from "../src/abis.js";
import { parseLocalDeployment } from "../src/deployments.js";

type AbiItem = { type: string; name?: string; inputs?: readonly { indexed?: boolean; name: string; type: string }[] };
const find = (abi: readonly AbiItem[], type: string, name: string) => {
  const item = abi.find((x) => x.type === type && x.name === name);
  if (!item) throw new Error(`missing ${type} ${name}`);
  return item;
};

describe("generated ABIs", () => {
  it("SolverRescueExecuted carries policyOwner (R-07): 6 non-indexed words = 192 data bytes", () => {
    const e = find(solverRescueExecutorAbi, "event", "SolverRescueExecuted");
    const nonIndexed = (e.inputs ?? []).filter((i) => !i.indexed).map((i) => i.name);
    expect(nonIndexed).toEqual(["payout", "policyOwner", "principal", "fee", "executedAt", "originEventId"]);
  });

  it("RiskObserved has 3 non-indexed words (96 data bytes) matching the core's data-length check", () => {
    const e = find(bastionRiskObserverAbi, "event", "RiskObserved");
    expect((e.inputs ?? []).filter((i) => !i.indexed)).toHaveLength(3);
  });

  it("escrow settleRescue selector equals the payload signature built by BastionReactiveCore", () => {
    const fn = find(crossChainReserveEscrowAbi, "function", "settleRescue");
    expect(toFunctionSelector(fn as never)).toBe(
      toFunctionSelector(
        "settleRescue(address,bytes32,bytes32,address,uint256,address,address,uint256,uint256,uint64,bytes32)",
      ),
    );
  });

  it("core exposes react(LogRecord) and CallbackRequested", () => {
    find(bastionReactiveCoreAbi, "function", "react");
    expect(toEventSelector(find(bastionReactiveCoreAbi, "event", "CallbackRequested") as never)).toMatch(
      /^0x[0-9a-f]{64}$/,
    );
  });

  it("local deployment loader rejects non-local chains", () => {
    expect(() => parseLocalDeployment({ chainId: 84532 })).toThrow();
  });
});
