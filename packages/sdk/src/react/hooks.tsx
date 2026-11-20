import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ReadinessStatus } from "@bastion-guardian/types";
import { BastionClient, type BastionClientOptions } from "../client.js";
import type {
  Address,
  Hex,
  LendingPosition,
  PolicyDetail,
  ProtectionPolicy,
  ReadinessSnapshot,
  RescueSummary,
  ScenarioRequest,
  ScenarioResponse,
  SimulationPreset,
} from "../api-types.js";

const Ctx = createContext<BastionClient | null>(null);

export interface BastionProviderProps {
  /** An existing client, or options to build one. */
  client?: BastionClient;
  options?: BastionClientOptions;
  children?: ReactNode;
}

/** Provides a BastionClient to the hooks below. */
export function BastionProvider({ client, options, children }: BastionProviderProps) {
  const c = useMemo(() => {
    if (client) return client;
    if (!options) throw new Error("BastionProvider needs `client` or `options`");
    return new BastionClient(options);
  }, [client, options?.baseUrl]);
  return <Ctx.Provider value={c}>{children}</Ctx.Provider>;
}

export function useBastionClient(): BastionClient {
  const c = useContext(Ctx);
  if (!c) throw new Error("useBastionClient must be used inside <BastionProvider>");
  return c;
}

/**
 * Every hook returns the same shape. `status` distinguishes loading (no data yet), success, error (no data) and
 * `stale` (a refresh failed but earlier data is still shown, which UIs should label as partial).
 */
export interface Resource<T> {
  data: T | undefined;
  error: Error | undefined;
  status: "idle" | "loading" | "success" | "error" | "stale";
  isLoading: boolean;
  refetch: () => Promise<void>;
  updatedAt: number | undefined;
}

export interface ResourceOptions {
  /** Poll interval in ms (0 = no polling). */
  refreshMs?: number;
  /** Skip fetching (e.g. until an address is known). */
  enabled?: boolean;
}

export function useResource<T>(
  key: string,
  load: (c: BastionClient) => Promise<T>,
  { refreshMs = 0, enabled = true }: ResourceOptions = {},
): Resource<T> {
  const client = useBastionClient();
  const [state, setState] = useState<Omit<Resource<T>, "refetch" | "isLoading">>({
    data: undefined,
    error: undefined,
    status: enabled ? "loading" : "idle",
    updatedAt: undefined,
  });
  const loadRef = useRef(load);
  loadRef.current = load;
  const seq = useRef(0);
  const run = useCallback(async () => {
    const my = ++seq.current;
    setState((s) => ({ ...s, status: s.data === undefined ? "loading" : s.status }));
    try {
      const data = await loadRef.current(client);
      if (my === seq.current) setState({ data, error: undefined, status: "success", updatedAt: Date.now() });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      if (my === seq.current)
        setState((s) => ({ ...s, error, status: s.data === undefined ? "error" : "stale" }));
    }
  }, [client]);
  useEffect(() => {
    if (!enabled) {
      setState({ data: undefined, error: undefined, status: "idle", updatedAt: undefined });
      return;
    }
    setState({ data: undefined, error: undefined, status: "loading", updatedAt: undefined });
    void run();
    if (!refreshMs) return;
    const t = setInterval(() => void run(), refreshMs);
    return () => {
      clearInterval(t);
      seq.current++;
    };
  }, [key, enabled, refreshMs, run]);
  return { ...state, isLoading: state.status === "loading", refetch: run };
}

/** Lending positions observed for an account (indexed from the lender, not self-reported). */
export function useBastionPositions(
  q: { account?: Address; chainId?: number; limit?: number },
  o?: ResourceOptions,
): Resource<LendingPosition[]> {
  return useResource(
    `positions:${q.chainId ?? "*"}:${q.account ?? "*"}:${q.limit ?? ""}`,
    async (c) => (await c.positions(q)).items,
    { ...o, enabled: (o?.enabled ?? true) && !!q.account },
  );
}

/** Policies owned by (or protecting) an address. */
export function useRescuePolicies(
  q: { owner?: Address; account?: Address; chainId?: number },
  o?: ResourceOptions,
): Resource<ProtectionPolicy[]> {
  return useResource(
    `policies:${q.chainId ?? "*"}:${q.owner ?? "*"}:${q.account ?? "*"}`,
    async (c) => (await c.policies(q)).items,
    { ...o, enabled: (o?.enabled ?? true) && !!(q.owner || q.account) },
  );
}

export interface ProtectionStatus {
  /** Combined label for UIs. "UNPROTECTED" when no active policy exists. */
  status: ReadinessStatus | "UNPROTECTED" | "PAUSED" | "REVOKED";
  policy: ProtectionPolicy | null;
  detail: PolicyDetail | null;
  readiness: ReadinessSnapshot | null;
  /** Latest observed health factor (WAD string), if a position is indexed. */
  healthFactorWad: string | null;
  triggerHealthFactorWad: string | null;
  targetHealthFactorWad: string | null;
  provenance: string | null;
}

/**
 * Protection status for one account: the newest policy protecting it, its readiness and the latest health factor.
 * Readiness is not a guarantee of rescue.
 */
export function useProtectionStatus(
  q: { account?: Address; chainId?: number },
  o?: ResourceOptions,
): Resource<ProtectionStatus> {
  return useResource(
    `protection:${q.chainId ?? "*"}:${q.account ?? "*"}`,
    async (c) => {
      const { items } = await c.policies({ account: q.account, chainId: q.chainId, limit: 20 });
      const policy = items.find((p) => p.status === "Active") ?? items[0] ?? null;
      if (!policy)
        return {
          status: "UNPROTECTED",
          policy: null,
          detail: null,
          readiness: null,
          healthFactorWad: null,
          triggerHealthFactorWad: null,
          targetHealthFactorWad: null,
          provenance: null,
        } satisfies ProtectionStatus;
      const detail = await c.policy(policy.chainId, policy.policyId);
      const v = detail.versions[0];
      const pos = detail.positions.find((p) => p.debtAsset === policy.debtAsset) ?? detail.positions[0];
      const status: ProtectionStatus["status"] =
        policy.status === "Paused"
          ? "PAUSED"
          : policy.status === "Active"
            ? (detail.readiness?.status ?? "UNKNOWN")
            : policy.status === "Revoked"
              ? "REVOKED"
              : "UNPROTECTED";
      return {
        status,
        policy,
        detail,
        readiness: detail.readiness,
        healthFactorWad: pos?.healthFactorWad ?? null,
        triggerHealthFactorWad: v?.triggerHealthFactorWad ?? null,
        targetHealthFactorWad: v?.targetHealthFactorWad ?? null,
        provenance: detail.provenance,
      } satisfies ProtectionStatus;
    },
    { ...o, enabled: (o?.enabled ?? true) && !!q.account },
  );
}

/** Rescue intents with their on-chain executions, newest first. */
export function useRescueHistory(
  q: { chainId?: number; policyId?: Hex; limit?: number },
  o?: ResourceOptions,
): Resource<RescueSummary[]> {
  return useResource(
    `rescues:${q.chainId ?? "*"}:${q.policyId ?? "*"}:${q.limit ?? ""}`,
    async (c) => (await c.rescues(q)).items,
    o,
  );
}

/** Guardian Mode readiness timeline for a policy (newest first). */
export function useGuardianReadiness(
  q: { chainId?: number; policyId?: Hex; limit?: number },
  o?: ResourceOptions,
): Resource<ReadinessSnapshot[]> {
  return useResource(
    `readiness:${q.chainId ?? "*"}:${q.policyId ?? "*"}:${q.limit ?? ""}`,
    async (c) => (await c.readinessHistory(q.chainId!, q.policyId!, q.limit)).items,
    { ...o, enabled: (o?.enabled ?? true) && !!q.chainId && !!q.policyId },
  );
}

export interface RescueSimulation {
  presets: Resource<SimulationPreset[]>;
  run: (req: ScenarioRequest) => Promise<ScenarioResponse>;
  result: ScenarioResponse | undefined;
  error: Error | undefined;
  running: boolean;
}

/** Runs Section 10 scenarios on the BASTION model. Output is labeled SIMULATED and is not a prediction. */
export function useRescueSimulation(): RescueSimulation {
  const client = useBastionClient();
  const presets = useResource("sim-presets", async (c) => (await c.simulationPresets()).presets);
  const [result, setResult] = useState<ScenarioResponse>();
  const [error, setError] = useState<Error>();
  const [running, setRunning] = useState(false);
  const run = useCallback(
    async (req: ScenarioRequest) => {
      setRunning(true);
      setError(undefined);
      try {
        const r = await client.simulateScenario(req);
        setResult(r);
        return r;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        throw err;
      } finally {
        setRunning(false);
      }
    },
    [client],
  );
  return { presets, run, result, error, running };
}
