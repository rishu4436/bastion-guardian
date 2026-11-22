import { describe, expect, it } from "vitest";
import { PUSH_REASON, isIos, urlBase64ToUint8Array } from "./pwa";

describe("PWA helpers", () => {
  it("decodes a VAPID public key (base64url) to bytes", () => {
    const k = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";
    const b = urlBase64ToUint8Array(k);
    expect(b.length).toBe(65);
    expect(b[0]).toBe(0x04); // uncompressed P-256 point
  });
  it("detects iOS user agents", () => {
    expect(isIos("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(true);
    expect(isIos("Mozilla/5.0 (X11; Linux x86_64)")).toBe(false);
  });
  it("explains every unsupported reason", () => {
    for (const r of ["no-sw", "no-push", "ios-not-installed", "insecure", "denied", "not-configured"])
      expect(PUSH_REASON[r]).toBeTruthy();
  });
});
