import { describe, expect, it } from "vitest";
import {
  WAD,
  ago,
  band,
  buildAlerts,
  hf,
  isAddress,
  normalizeUrl,
  readinessTone,
  units,
  webLinks,
} from "./model";

describe("input validation", () => {
  it("accepts only 20-byte hex addresses", () => {
    expect(isAddress("0x" + "ab".repeat(20))).toBe(true);
    expect(isAddress("0x" + "ab".repeat(19))).toBe(false);
    expect(isAddress("vitalik.eth")).toBe(false);
  });
  it("normalizes http(s) URLs and rejects others", () => {
    expect(normalizeUrl("https://api.example.com/")).toBe("https://api.example.com");
    expect(normalizeUrl("http://10.0.2.2:4000")).toBe("http://10.0.2.2:4000");
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("not a url")).toBeNull();
  });
});

describe("exact formatting", () => {
  it("formats base units without floating point", () => {
    expect(units("2800010200", 6)).toBe("2,800.0102");
    expect(units("1000000", 6)).toBe("1");
    expect(units("abc", 6)).toBe("—");
  });
  it("renders HF and the no-debt sentinel", () => {
    expect(hf(((WAD * 105n) / 100n).toString())).toBe("1.05");
    expect(hf((2n ** 256n - 1n).toString())).toBe("∞");
    expect(hf(null)).toBe("—");
  });
  it("bands match the web radar thresholds", () => {
    expect(band(WAD - 1n)).toBe("Liquidatable");
    expect(band((WAD * 109n) / 100n)).toBe("Critical");
    expect(band((WAD * 129n) / 100n)).toBe("At risk");
    expect(band((WAD * 130n) / 100n)).toBe("Healthy");
  });
  it("maps readiness to tones and treats unknown honestly", () => {
    expect(readinessTone("ARMED")).toBe("good");
    expect(readinessTone("LIMITED")).toBe("warn");
    expect(readinessTone("UNAVAILABLE")).toBe("bad");
    expect(readinessTone(undefined)).toBe("muted");
  });
  it("relative times", () => {
    const now = Date.parse("2026-11-22T00:10:00Z");
    expect(ago("2026-11-22T00:09:30Z", now)).toBe("30s ago");
    expect(ago("2026-11-21T23:10:00Z", now)).toBe("1h ago");
    expect(ago("garbage", now)).toBe("—");
  });
});

describe("alert inbox", () => {
  it("derives alerts from positions, non-armed active policies and rescues, most severe first", () => {
    const alerts = buildAlerts({
      positions: [
        {
          id: "a",
          chainId: 31337,
          account: "0x" + "1".repeat(40),
          healthFactorWad: ((WAD * 120n) / 100n).toString(),
          observedAt: "2026-11-22T00:00:00Z",
        },
        {
          id: "b",
          chainId: 31337,
          account: "0x" + "2".repeat(40),
          healthFactorWad: ((WAD * 99n) / 100n).toString(),
          observedAt: "2026-11-22T00:00:01Z",
        },
        {
          id: "c",
          chainId: 31337,
          account: "0x" + "3".repeat(40),
          healthFactorWad: (WAD * 2n).toString(),
          observedAt: "2026-11-22T00:00:02Z",
        },
      ],
      policies: [
        {
          chainId: 31337,
          policyId: "0x" + "aa".repeat(32),
          account: "0x",
          status: "Active",
          readiness: { status: "ARMED", evaluatedAt: "x" },
        },
        {
          chainId: 31337,
          policyId: "0x" + "bb".repeat(32),
          account: "0x",
          status: "Active",
          readiness: { status: "LIMITED", evaluatedAt: "2026-11-22T00:00:03Z" },
        },
        {
          chainId: 31337,
          policyId: "0x" + "cc".repeat(32),
          account: "0x",
          status: "Revoked",
          readiness: null,
        },
      ],
      rescues: [
        {
          rescueId: "0x" + "dd".repeat(32),
          chainId: 31337,
          policyId: "0x" + "aa".repeat(32),
          state: "ReimbursementComplete",
          updatedAt: "2026-11-22T00:00:04Z",
          executions: [{ success: true, path: 1 }],
        },
      ],
    });
    expect(alerts.map((a) => a.key)).toEqual([
      "pos:b",
      "pol:31337:0x" + "bb".repeat(32),
      "pos:a",
      "res:0x" + "dd".repeat(32),
    ]);
    expect(alerts[0]!.severity).toBe("critical");
    expect(alerts.at(-1)!.title).toBe("Rescue executed · ReimbursementComplete");
    const failed = buildAlerts({
      positions: [],
      policies: [],
      rescues: [
        {
          rescueId: "0x01",
          chainId: 1,
          policyId: "0x02",
          state: "ExecutionFailed",
          updatedAt: "",
          executions: [],
        },
      ],
    });
    expect(failed[0]).toMatchObject({ severity: "critical", title: "Rescue ExecutionFailed" });
  });
});

describe("deep links", () => {
  it("only ever point at the configured web app", () => {
    expect(webLinks.proof("https://app.bastion.dev", "0x12")).toBe("https://app.bastion.dev/proof/0x12");
    expect(webLinks.newPolicy("http://localhost:3000", "0xabc")).toBe(
      "http://localhost:3000/policies/new?account=0xabc",
    );
  });
});
