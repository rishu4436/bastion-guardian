import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { pino } from "pino";
import { REDACT_PATHS } from "../src/index.js";

describe("logger", () => {
  it("redacts secrets", () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(c, _e, cb) {
        lines.push(String(c));
        cb();
      },
    });
    const log = pino({ redact: { paths: REDACT_PATHS, censor: "[REDACTED]" } }, sink);
    log.info({ privateKey: "0xdeadbeef", nested: { apiKey: "k" } }, "x");
    expect(lines.join("")).not.toContain("0xdeadbeef");
    expect(lines.join("")).toContain("[REDACTED]");
  });
});
