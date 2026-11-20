import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/index.js";

describe("env", () => {
  it("defaults safely with live execution and mainnet off", () => {
    const env = loadEnv({});
    expect(env.ENABLE_LIVE_EXECUTION).toBe(false);
    expect(env.ENABLE_MAINNET).toBe(false);
    expect(env.API_PORT).toBe(4000);
  });
  it("refuses to enable mainnet", () => {
    expect(() => loadEnv({ ENABLE_MAINNET: "true" })).toThrow(/ENABLE_MAINNET/);
  });
  it("requires a session secret in production", () => {
    expect(() => loadEnv({ NODE_ENV: "production" })).toThrow(/SESSION_SECRET/);
  });
});
