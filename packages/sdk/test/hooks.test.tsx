// @vitest-environment jsdom
/** React hooks and the embeddable component, rendered in jsdom against the real API started by global-setup.ts. */
import { afterAll, describe, expect, inject, it } from "vitest";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { BastionClient, type Hex } from "../src/index.js";
import {
  BastionProvider,
  ProtectWithBastion,
  useBastionPositions,
  useGuardianReadiness,
  useProtectionStatus,
  useRescueHistory,
  useRescuePolicies,
  useRescueSimulation,
} from "../src/react/index.js";

const stack = inject("sdkStack");

describe.skipIf(!stack)("@bastion-guardian/sdk/react (LOCAL SIMULATION)", () => {
  const baseUrl = stack?.baseUrl ?? "http://127.0.0.1:9";
  const client = new BastionClient({ baseUrl });
  const a = { borrowerA: stack?.borrowerA as `0x${string}`, policyA: stack?.policyA as `0x${string}` };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <BastionProvider client={client}>{children}</BastionProvider>
  );
  afterAll(() => cleanup());

  it("React hooks expose loading → success with typed data", async () => {
    const positions = renderHook(() => useBastionPositions({ account: a.borrowerA }), { wrapper });
    expect(positions.result.current.status).toBe("loading");
    await waitFor(() => expect(positions.result.current.status).toBe("success"));
    expect(positions.result.current.data![0]!.account).toBe(a.borrowerA.toLowerCase());

    const policies = renderHook(() => useRescuePolicies({ owner: a.borrowerA }), { wrapper });
    await waitFor(() => expect(policies.result.current.data?.length).toBeGreaterThan(0));

    const status = renderHook(() => useProtectionStatus({ account: a.borrowerA, chainId: 31337 }), {
      wrapper,
    });
    await waitFor(() => expect(status.result.current.status).toBe("success"));
    expect(status.result.current.data!.policy!.policyId).toBe(a.policyA);
    expect(["ARMED", "LIMITED", "UNAVAILABLE", "UNKNOWN"]).toContain(status.result.current.data!.status);
    expect(status.result.current.data!.triggerHealthFactorWad).toMatch(/^\d+$/);

    const nobody = renderHook(
      () => useProtectionStatus({ account: "0x000000000000000000000000000000000000dEaD" }),
      { wrapper },
    );
    await waitFor(() => expect(nobody.result.current.data?.status).toBe("UNPROTECTED"));

    const idle = renderHook(() => useBastionPositions({ account: undefined }), { wrapper });
    expect(idle.result.current.status).toBe("idle");

    const history = renderHook(() => useRescueHistory({ chainId: 31337 }), { wrapper });
    await waitFor(() => expect(history.result.current.data?.length).toBeGreaterThan(0));

    const readiness = renderHook(() => useGuardianReadiness({ chainId: 31337, policyId: a.policyA as Hex }), {
      wrapper,
    });
    await waitFor(() => expect(readiness.result.current.data?.length).toBeGreaterThan(0));

    const sim = renderHook(() => useRescueSimulation(), { wrapper });
    await waitFor(() => expect(sim.result.current.presets.status).toBe("success"));
    const preset = sim.result.current.presets.data![0]!;
    await act(async () => {
      await sim.result.current.run({ base: preset.base, spec: { kind: "price_shock", shockBps: 2000 } });
    });
    expect(sim.result.current.result?.provenance).toBe("SIMULATED");
  }, 30_000);

  it("hooks report error when the API is unreachable, and stale (keeping data) when a refresh fails", async () => {
    const dead = new BastionClient({ baseUrl: "http://127.0.0.1:9" });
    const w = ({ children }: { children: ReactNode }) => (
      <BastionProvider client={dead}>{children}</BastionProvider>
    );
    const r = renderHook(() => useRescueHistory({}), { wrapper: w });
    await waitFor(() => expect(r.result.current.status).toBe("error"));
    expect(r.result.current.error!.message).toMatch(/unreachable/);

    let fail = false;
    const flaky = new BastionClient({
      baseUrl,
      fetch: (async (u: string, i: RequestInit) => {
        if (fail) throw new TypeError("network down");
        return fetch(u, i);
      }) as unknown as typeof fetch,
    });
    const w2 = ({ children }: { children: ReactNode }) => (
      <BastionProvider client={flaky}>{children}</BastionProvider>
    );
    const s = renderHook(() => useRescueHistory({ chainId: 31337 }), { wrapper: w2 });
    await waitFor(() => expect(s.result.current.status).toBe("success"));
    fail = true;
    await act(() => s.result.current.refetch());
    expect(s.result.current.status).toBe("stale");
    expect(s.result.current.data!.length).toBeGreaterThan(0);
  });

  it("<ProtectWithBastion> shows live status for protected accounts and the wizard link otherwise", async () => {
    render(
      <BastionProvider client={client}>
        <div data-testid="protected">
          <ProtectWithBastion account={a.borrowerA} chainId={31337} appUrl="https://app.example" />
        </div>
        <div data-testid="new">
          <ProtectWithBastion
            account="0x000000000000000000000000000000000000dEaD"
            chainId={31337}
            appUrl="https://app.example"
          />
        </div>
        <div data-testid="none">
          <ProtectWithBastion appUrl="https://app.example" />
        </div>
      </BastionProvider>,
    );
    const prot = () => screen.getByTestId("protected").querySelector("a")!;
    await waitFor(() => expect(prot().dataset.bastionStatus).toMatch(/ARMED|LIMITED|UNAVAILABLE|UNKNOWN/));
    expect(prot().getAttribute("href")).toBe(`https://app.example/policies/31337/${a.policyA}`);
    expect(prot().textContent).toContain("LOCAL SIM");
    const fresh = () => screen.getByTestId("new").querySelector("a")!;
    await waitFor(() => expect(fresh().dataset.bastionStatus).toBe("UNPROTECTED"));
    expect(fresh().textContent).toContain("Protect with BASTION");
    expect(fresh().getAttribute("href")).toContain(
      "/policies/new?account=0x000000000000000000000000000000000000dEaD",
    );
    const none = screen.getByTestId("none").querySelector("a")!;
    expect(none.getAttribute("aria-disabled")).toBe("true");
    expect(none.textContent).toContain("Connect a wallet");
  });
});
