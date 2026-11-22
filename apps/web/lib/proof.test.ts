import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, contentHash } from "./proof";

describe("Proof of Protection verification", () => {
  it("canonicalizes key order recursively", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: "x" }], c: null } })).toBe(
      '{"a":{"c":null,"d":[2,{"y":"x","z":1}]},"b":1}',
    );
  });
  it("hashes like the API (node:crypto sha256 over the same canonical string)", async () => {
    const facts = { chainId: 31337, executions: [{ txHash: "0xab", repaid: "2800010200" }], policy: null };
    expect(await contentHash(facts)).toBe(createHash("sha256").update(canonicalJson(facts)).digest("hex"));
  });
});
