import { describe, expect, it } from "vitest";
import { readinessPresentation } from "../src/index.js";
describe("ui tokens", () => {
  it("never implies readiness is a guarantee", () => {
    expect(readinessPresentation.ARMED.description).toMatch(/not a guarantee/);
  });
});
