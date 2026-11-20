import type { Page } from "@playwright/test";
import { privateKeyToAccount } from "viem/accounts";

/**
 * TEST-ONLY EIP-1193 wallet. Uses public anvil development keys (well known, never funded on any public network) and
 * signs in the Node test process; the page only sees an injected provider, like a browser extension.
 */
export const DEV_KEYS = {
  gov: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  borrowerA: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
} as const;

export async function injectWallet(page: Page, key: `0x${string}`) {
  const account = privateKeyToAccount(key);
  await page.exposeFunction("__bastionSign", (message: string) => account.signMessage({ message }));
  await page.addInitScript((address: string) => {
    const hexToText = (h: string) =>
      new TextDecoder().decode(new Uint8Array((h.slice(2).match(/.{2}/g) ?? []).map((b) => parseInt(b, 16))));
    const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
    (window as unknown as { ethereum: unknown }).ethereum = {
      isMetaMask: false,
      async request({ method, params }: { method: string; params?: unknown[] }) {
        switch (method) {
          case "eth_requestAccounts":
          case "eth_accounts":
            return [address];
          case "eth_chainId":
            return "0x7a69";
          case "net_version":
            return "31337";
          case "wallet_switchEthereumChain":
          case "wallet_requestPermissions":
            return null;
          case "wallet_getPermissions":
            return [{ parentCapability: "eth_accounts" }];
          case "personal_sign":
            return (window as unknown as { __bastionSign: (m: string) => Promise<string> }).__bastionSign(
              hexToText(String(params![0])),
            );
          default:
            throw Object.assign(new Error(`unsupported in test wallet: ${method}`), { code: 4200 });
        }
      },
      on: (e: string, f: (...a: unknown[]) => void) => void (listeners[e] ??= []).push(f),
      removeListener: (e: string, f: (...a: unknown[]) => void) =>
        void (listeners[e] = (listeners[e] ?? []).filter((x) => x !== f)),
    };
  }, account.address);
  return account;
}
