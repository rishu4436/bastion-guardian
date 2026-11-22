"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { encodeFunctionData, getAddress, isAddress, parseUnits, recoverTypedDataAddress } from "viem";
import { useConnection, useSendTransaction, useSignTypedData } from "wagmi";
import { bastionPolicyRegistryAbi } from "@bastion-guardian/contracts/abis";
import {
  buildPolicy,
  policyIdOf,
  policyTypedData,
  type Policy,
  type PolicyDraft,
} from "@bastion-guardian/sdk";
import { useApi, useTokens, type Token } from "@/lib/hooks";
import { useDeployments } from "@/lib/deployments";
import {
  Badge,
  Button,
  Card,
  ErrorBox,
  Field,
  Hash,
  PageHeader,
  Provenance,
  inputCls,
} from "@/components/ui";
import { CHAIN_NAMES, hf, isLocal, units } from "@/lib/format";

interface Form {
  destChainId: number;
  protocolId: string;
  account: string;
  debtAsset: string;
  collateralAsset: string;
  trigger: string;
  target: string;
  flash: boolean;
  solver: boolean;
  maxRepayPerAction: string;
  maxTotalRepay: string;
  maxTotalFees: string;
  maxFeeBps: string;
  maxSlippageBps: string;
  allowPartial: boolean;
  solvers: string;
  sourceChainId: number;
  recipients: string;
  expiryDays: string;
  cooldownMin: string;
}

interface Protocol {
  id: string;
  chainId: number;
  name: string;
  kind: "official" | "fixture";
  poolAddress: string;
}
interface Position {
  chainId: number;
  account: string;
  collateralAsset: string;
  debtAsset: string;
  collateralAmount: string;
  debtAmount: string;
  healthFactorWad: string;
  observedAt: string;
}

const list = (s: string) =>
  s
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean);

function exact(v: string, decimals: number): bigint | null {
  try {
    if (!/^\d+(\.\d+)?$/.test(v.trim())) return null;
    return parseUnits(v.trim(), decimals);
  } catch {
    return null;
  }
}

export function PolicyWizard() {
  const sp = useSearchParams();
  const { address, isConnected } = useConnection();
  const initialChain = Number(sp.get("chainId") ?? 31337);
  const [step, setStep] = useState(0);
  const [f, setF] = useState<Form>({
    destChainId: initialChain,
    protocolId: "",
    account: sp.get("account") ?? "",
    debtAsset: "",
    collateralAsset: "",
    trigger: "1.25",
    target: "1.5",
    flash: true,
    solver: true,
    maxRepayPerAction: "",
    maxTotalRepay: "",
    maxTotalFees: "",
    maxFeeBps: "100",
    maxSlippageBps: "200",
    allowPartial: false,
    solvers: "",
    sourceChainId: initialChain,
    recipients: "",
    expiryDays: "30",
    cooldownMin: "10",
  });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));
  const owner = address ? getAddress(address) : undefined;
  const account = f.account || owner || "";

  const deployments = useDeployments(f.destChainId);
  const protocols = useApi<{ items: Protocol[] }>("/v1/protocols");
  const tokensQ = useApi<{ items: Token[] }>(`/v1/tokens?chainId=${f.destChainId}`);
  const { find } = useTokens();
  const positions = useApi<{ items: Position[] }>(
    isAddress(account) ? `/v1/positions?chainId=${f.destChainId}&account=${account}` : null,
  );
  const nonceQ = useApi<{ nonce: string; registry: string; blockNumber: string }>(
    owner && deployments.data?.contracts.policyRegistry
      ? `/v1/policy-registry/nonce?chainId=${f.destChainId}&owner=${owner}`
      : null,
  );
  const chainProtocols = (protocols.data?.items ?? []).filter((p) => p.chainId === f.destChainId);
  const protocol = chainProtocols.find((p) => p.id === f.protocolId);
  const registry = deployments.data?.contracts.policyRegistry;
  const adapter =
    deployments.data?.contracts[protocol?.kind === "fixture" ? "fixtureAdapter" : "aaveV3LendingAdapter"];
  const debtToken = find(f.destChainId, f.debtAsset);
  const debtDecimals = debtToken?.decimals;

  // Build the exact draft; every amount is converted with the token's decimals (no floats).
  const built = useMemo((): { draft?: PolicyDraft; policy?: Policy; error?: string } => {
    try {
      if (!owner) return { error: "Connect a wallet (step 1)." };
      if (!registry || !adapter || !protocol)
        return { error: "Select a network with a recorded deployment and a market." };
      if (debtDecimals === undefined) return { error: "Select a debt asset with known decimals." };
      if (!nonceQ.data) return { error: "Policy nonce not loaded yet." };
      const amt = (v: string, label: string) => {
        const x = exact(v, debtDecimals);
        if (x === null) throw new Error(`${label}: enter a decimal amount`);
        return x.toString();
      };
      const wad = (v: string, label: string) => {
        const x = exact(v, 18);
        if (x === null) throw new Error(`${label}: enter a decimal health factor`);
        return x.toString();
      };
      const solvers = list(f.solvers);
      const recipients = list(f.recipients);
      for (const a of [...solvers, ...recipients])
        if (!isAddress(a)) throw new Error(`Invalid address: ${a}`);
      const draft: PolicyDraft = {
        owner,
        account: getAddress(account),
        sourceChainId: f.sourceChainId,
        destChainId: f.destChainId,
        adapter,
        market: getAddress(protocol.poolAddress),
        debtAsset: getAddress(f.debtAsset),
        collateralAsset: getAddress(f.collateralAsset),
        triggerHealthFactor: wad(f.trigger, "Trigger HF"),
        targetHealthFactor: wad(f.target, "Target HF"),
        maxTotalRepay: amt(f.maxTotalRepay, "Max total repay"),
        maxRepayPerAction: amt(f.maxRepayPerAction, "Max repay per action"),
        maxTotalFees: amt(f.maxTotalFees, "Max total fees"),
        maxSlippageBps: Number(f.maxSlippageBps),
        maxFeeBps: Number(f.maxFeeBps),
        allowedPaths: (f.flash ? 1 : 0) | (f.solver ? 2 : 0),
        allowPartial: f.allowPartial,
        expiry: Math.floor(Date.now() / 1000) + Math.round(Number(f.expiryDays) * 86400),
        cooldown: Math.round(Number(f.cooldownMin) * 60),
        nonce: nonceQ.data.nonce,
        solvers: solvers.map((a) => getAddress(a)),
        recipients: recipients.map((a) => getAddress(a)),
      };
      return { draft, policy: buildPolicy(draft) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [owner, registry, adapter, protocol, debtDecimals, nonceQ.data, f, account]);

  const steps: { title: string; ok: boolean; body: ReactNode }[] = [
    {
      title: "Connect wallet",
      ok: isConnected && !!owner,
      body: owner ? (
        <p className="text-sm">
          Policy owner: <Hash value={owner} n={10} />. Only this wallet can pause, resume, revoke or replace
          the policy.
        </p>
      ) : (
        <p className="text-sm text-muted">
          Use “Connect wallet” in the top bar. BASTION never asks for a private key.
        </p>
      ),
    },
    {
      title: "Destination network",
      ok: !!registry,
      body: (
        <>
          <Field label="Chain where the lending position lives">
            <select
              aria-label="Destination chain"
              className={inputCls}
              value={f.destChainId}
              onChange={(e) => {
                set("destChainId", Number(e.target.value));
                set("sourceChainId", Number(e.target.value));
              }}
            >
              {[31337, 84532, 1301].map((c) => (
                <option key={c} value={c}>
                  {CHAIN_NAMES[c]}
                </option>
              ))}
            </select>
          </Field>
          <div className="mt-3 text-sm">
            {deployments.isLoading ? (
              "Checking deployments…"
            ) : deployments.error ? (
              <ErrorBox error={deployments.error} />
            ) : registry ? (
              <span>
                BastionPolicyRegistry <Hash value={registry} />{" "}
                {deployments.data?.mode === "local_simulation" ? (
                  <Provenance kind="local" />
                ) : (
                  <Provenance kind="onchain" />
                )}
              </span>
            ) : (
              <span className="text-unavailable">
                No BASTION deployment is recorded on this chain yet, so a policy cannot be registered here.
              </span>
            )}
          </div>
        </>
      ),
    },
    {
      title: "Protocol & market",
      ok: !!protocol && !!adapter,
      body: (
        <Field label="Lending market">
          <select
            aria-label="Lending market"
            className={inputCls}
            value={f.protocolId}
            onChange={(e) => set("protocolId", e.target.value)}
          >
            <option value="">Select…</option>
            {chainProtocols.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.kind === "fixture" ? "(FIXTURE)" : ""}
              </option>
            ))}
          </select>
          {protocol && !adapter && (
            <p className="mt-2 text-xs text-unavailable">No lending adapter recorded for this market.</p>
          )}
        </Field>
      ),
    },
    {
      title: "Account to protect",
      ok: isAddress(account),
      body: (
        <Field
          label="Borrower account"
          hint="Defaults to your wallet. Protecting another account requires that account to delegate to you on-chain."
        >
          <input
            aria-label="Borrower account"
            className={inputCls}
            placeholder={owner ?? "0x…"}
            value={f.account}
            onChange={(e) => set("account", e.target.value.trim())}
          />
        </Field>
      ),
    },
    {
      title: "Review position",
      ok: true,
      body: positions.isLoading ? (
        <p className="text-sm text-muted">Loading indexed positions…</p>
      ) : positions.error ? (
        <ErrorBox error={positions.error} />
      ) : positions.data?.items.length ? (
        <div className="space-y-2 text-sm">
          {positions.data.items.map((p, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                set("debtAsset", p.debtAsset);
                set("collateralAsset", p.collateralAsset);
              }}
              className="block w-full rounded-lg border border-border p-3 text-left hover:border-accent"
            >
              HF <strong>{hf(p.healthFactorWad)}</strong> · debt{" "}
              {units(p.debtAmount, find(p.chainId, p.debtAsset)?.decimals ?? 0)}{" "}
              {find(p.chainId, p.debtAsset)?.symbol} · collateral{" "}
              {units(p.collateralAmount, find(p.chainId, p.collateralAsset)?.decimals ?? 0)}{" "}
              {find(p.chainId, p.collateralAsset)?.symbol}{" "}
              <span className="text-muted">(use these assets)</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">
          No indexed position for this account yet. You can still create a policy; readiness stays UNKNOWN
          until the risk observer records one.
        </p>
      ),
    },
    ...(["debtAsset", "collateralAsset"] as const).map((k) => ({
      title: k === "debtAsset" ? "Debt asset" : "Collateral asset",
      ok: isAddress(f[k]) && (k !== "collateralAsset" || f.collateralAsset !== f.debtAsset),
      body: (
        <Field
          label={k === "debtAsset" ? "Asset that rescues repay" : "Collateral the flash path may unwind"}
        >
          <select
            aria-label={k === "debtAsset" ? "Debt asset" : "Collateral asset"}
            className={inputCls}
            value={f[k]}
            onChange={(e) => set(k, e.target.value)}
          >
            <option value="">Select…</option>
            {(tokensQ.data?.items ?? []).map((t) => (
              <option key={t.address} value={t.address}>
                {t.symbol} {t.isFixture ? "(FIXTURE)" : ""} · {t.decimals} decimals
              </option>
            ))}
          </select>
        </Field>
      ),
    })),
    {
      title: "Trigger health factor",
      ok: (exact(f.trigger, 18) ?? 0n) >= 10n ** 18n,
      body: (
        <Field label="Rescue starts when HF falls below" hint="Must be ≥ 1.0. Aave liquidates at HF < 1.0.">
          <input
            aria-label="Trigger HF"
            className={inputCls}
            value={f.trigger}
            onChange={(e) => set("trigger", e.target.value)}
          />
        </Field>
      ),
    },
    {
      title: "Target health factor",
      ok: (exact(f.target, 18) ?? 0n) > (exact(f.trigger, 18) ?? 0n),
      body: (
        <Field label="Rescue restores HF to" hint="Must exceed the trigger.">
          <input
            aria-label="Target HF"
            className={inputCls}
            value={f.target}
            onChange={(e) => set("target", e.target.value)}
          />
        </Field>
      ),
    },
    {
      title: "Rescue paths",
      ok: f.flash || f.solver,
      body: (
        <div className="space-y-2 text-sm">
          <label className="flex gap-2">
            <input type="checkbox" checked={f.flash} onChange={(e) => set("flash", e.target.checked)} />{" "}
            FlashNet: flash loan repays debt, withdraws authorized collateral, swaps it back. No capital
            needed.
          </label>
          <label className="flex gap-2">
            <input type="checkbox" checked={f.solver} onChange={(e) => set("solver", e.target.checked)} />{" "}
            Solver: a bonded solver repays from committed liquidity and is reimbursed from your reserve
            budget.
          </label>
        </div>
      ),
    },
    {
      title: "Repayment limits",
      ok:
        debtDecimals !== undefined &&
        (exact(f.maxRepayPerAction, debtDecimals) ?? -1n) > 0n &&
        (exact(f.maxTotalRepay, debtDecimals) ?? -1n) >= (exact(f.maxRepayPerAction, debtDecimals) ?? 0n),
      body: (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={`Max repay per rescue (${debtToken?.symbol ?? "debt units"})`}>
            <input
              aria-label="Max repay per action"
              className={inputCls}
              value={f.maxRepayPerAction}
              onChange={(e) => set("maxRepayPerAction", e.target.value)}
            />
          </Field>
          <Field label={`Max total repay (${debtToken?.symbol ?? "debt units"})`}>
            <input
              aria-label="Max total repay"
              className={inputCls}
              value={f.maxTotalRepay}
              onChange={(e) => set("maxTotalRepay", e.target.value)}
            />
          </Field>
        </div>
      ),
    },
    {
      title: "Fees & slippage",
      ok:
        debtDecimals !== undefined &&
        exact(f.maxTotalFees, debtDecimals) !== null &&
        Number(f.maxFeeBps) >= 0 &&
        Number(f.maxFeeBps) <= 1000 &&
        Number(f.maxSlippageBps) >= 0 &&
        Number(f.maxSlippageBps) <= 1000,
      body: (
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={`Max total fees (${debtToken?.symbol ?? "debt units"})`}>
            <input
              aria-label="Max total fees"
              className={inputCls}
              value={f.maxTotalFees}
              onChange={(e) => set("maxTotalFees", e.target.value)}
            />
          </Field>
          <Field label="Max fee rate (bps, ≤ 1000)">
            <input
              aria-label="Max fee bps"
              className={inputCls}
              value={f.maxFeeBps}
              onChange={(e) => set("maxFeeBps", e.target.value)}
            />
          </Field>
          <Field label="Max slippage (bps, ≤ 1000)">
            <input
              aria-label="Max slippage bps"
              className={inputCls}
              value={f.maxSlippageBps}
              onChange={(e) => set("maxSlippageBps", e.target.value)}
            />
          </Field>
        </div>
      ),
    },
    {
      title: "Partial rescues",
      ok: true,
      body: (
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            checked={f.allowPartial}
            onChange={(e) => set("allowPartial", e.target.checked)}
          />
          Allow a rescue that improves HF but cannot reach the target within your caps.
        </label>
      ),
    },
    {
      title: "Solver allowlist",
      ok: list(f.solvers).every((a) => isAddress(a)) && list(f.solvers).length <= 16,
      body: (
        <Field
          label="Allowed solver addresses (optional, up to 16)"
          hint="Empty: any registered, bonded solver may fill."
        >
          <textarea
            aria-label="Allowed solvers"
            className={inputCls}
            rows={3}
            value={f.solvers}
            onChange={(e) => set("solvers", e.target.value)}
          />
        </Field>
      ),
    },
    {
      title: "Reserve & reimbursement",
      ok: list(f.recipients).every((a) => isAddress(a)) && list(f.recipients).length <= 8,
      body: (
        <div className="space-y-3">
          <Field label="Reserve chain (where your reserve budget reimburses solvers)">
            <select
              aria-label="Reserve chain"
              className={inputCls}
              value={f.sourceChainId}
              onChange={(e) => set("sourceChainId", Number(e.target.value))}
            >
              {[31337, 84532, 1301].map((c) => (
                <option key={c} value={c}>
                  {CHAIN_NAMES[c]}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Allowed reimbursement recipients (optional, up to 8)"
            hint="Empty: solver payout addresses from the registry."
          >
            <textarea
              aria-label="Recipients"
              className={inputCls}
              rows={2}
              value={f.recipients}
              onChange={(e) => set("recipients", e.target.value)}
            />
          </Field>
          <p className="text-xs text-muted">
            Fund the reserve budget separately on the{" "}
            <Link className="text-accent" href="/reserve">
              Reserve
            </Link>{" "}
            page.
          </p>
        </div>
      ),
    },
    {
      title: "Expiry & cooldown",
      ok: Number(f.expiryDays) > 0 && Number(f.cooldownMin) >= 0,
      body: (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Expires after (days)">
            <input
              aria-label="Expiry days"
              className={inputCls}
              value={f.expiryDays}
              onChange={(e) => set("expiryDays", e.target.value)}
            />
          </Field>
          <Field label="Cooldown between rescues (minutes)">
            <input
              aria-label="Cooldown minutes"
              className={inputCls}
              value={f.cooldownMin}
              onChange={(e) => set("cooldownMin", e.target.value)}
            />
          </Field>
        </div>
      ),
    },
    {
      title: "Review, sign & register",
      ok: !!built.policy,
      body: (
        <Review built={built} registry={registry} chainId={f.destChainId} owner={owner} debt={debtToken} />
      ),
    },
  ];
  const cur = steps[step]!;
  return (
    <>
      <PageHeader
        title="New protection policy"
        subtitle="17 steps. Every limit you set here is enforced on-chain by BastionPolicyRegistry; nothing executes outside them."
        right={isLocal(f.destChainId) ? <Provenance kind="local" /> : <Badge tone="accent">Testnet</Badge>}
      />
      <div className="grid gap-6 lg:grid-cols-4">
        <ol className="space-y-1 text-sm" aria-label="Wizard steps">
          {steps.map((s, i) => (
            <li key={s.title}>
              <button
                type="button"
                onClick={() => setStep(i)}
                aria-current={i === step ? "step" : undefined}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${i === step ? "bg-raised text-text" : "text-muted hover:text-text"}`}
              >
                <span className={`tabular w-6 text-xs ${s.ok ? "text-armed" : ""}`}>
                  {s.ok ? "✓" : i + 1}
                </span>
                {s.title}
              </button>
            </li>
          ))}
        </ol>
        <div className="lg:col-span-3">
          <Card title={`Step ${step + 1} of ${steps.length} · ${cur.title}`}>
            {cur.body}
            <div className="mt-6 flex justify-between">
              <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>
                Back
              </Button>
              {step < steps.length - 1 && (
                <Button disabled={!cur.ok} onClick={() => setStep(step + 1)}>
                  Next
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function Review({
  built,
  registry,
  chainId,
  owner,
  debt,
}: {
  built: { draft?: PolicyDraft; policy?: Policy; error?: string };
  registry?: `0x${string}`;
  chainId: number;
  owner?: `0x${string}`;
  debt?: Token;
}) {
  const { mutateAsync: signTypedData, isPending: signing } = useSignTypedData();
  const { mutateAsync: sendTransaction, isPending: sending } = useSendTransaction();
  const [signature, setSignature] = useState<`0x${string}`>();
  const [verified, setVerified] = useState<boolean>();
  const [tx, setTx] = useState<`0x${string}`>();
  const [err, setErr] = useState<string>();
  if (!built.policy || !built.draft || !registry || !owner)
    return <p className="text-sm text-unavailable">{built.error ?? "Incomplete."}</p>;
  const p = built.policy;
  const typed = policyTypedData(p, chainId, registry);
  const policyId = policyIdOf(p);
  const args = [
    p,
    built.draft.solvers as `0x${string}`[],
    built.draft.recipients as `0x${string}`[],
    signature ?? "0x",
  ] as const;
  const calldata = encodeFunctionData({
    abi: bastionPolicyRegistryAbi,
    functionName: "registerPolicy",
    args,
  });
  const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);
  return (
    <div className="space-y-5 text-sm">
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          Policy ID <Hash value={policyId} n={10} />
        </div>
        <div>
          Trigger → target HF: <strong>{hf(p.triggerHealthFactor.toString())}</strong> →{" "}
          <strong>{hf(p.targetHealthFactor.toString())}</strong>
        </div>
        <div>
          Caps: {units(p.maxRepayPerAction.toString(), debt?.decimals ?? 0)} / action ·{" "}
          {units(p.maxTotalRepay.toString(), debt?.decimals ?? 0)} total {debt?.symbol}
        </div>
      </div>
      <details open>
        <summary className="cursor-pointer font-medium">EIP-712 typed data you will sign</summary>
        <pre data-testid="typed-data" className="mt-2 max-h-72 overflow-auto rounded-lg bg-bg p-3 text-xs">
          {json(typed)}
        </pre>
      </details>
      <details open>
        <summary className="cursor-pointer font-medium">Raw contract call preview</summary>
        <div className="mt-2 space-y-1 text-xs">
          <div>
            to <span className="font-mono">{registry}</span> (BastionPolicyRegistry, chain {chainId})
          </div>
          <div>
            function registerPolicy(Policy p, address[] solvers, address[] recipients, bytes signature)
          </div>
          <pre
            data-testid="calldata"
            className="max-h-40 overflow-auto break-all whitespace-pre-wrap rounded-lg bg-bg p-3"
          >
            {calldata}
          </pre>
          <div className="text-muted">
            When you send it from the owner wallet the signature is not required; it is used when a relayer
            submits on your behalf.
          </div>
        </div>
      </details>
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={signing}
          onClick={async () => {
            setErr(undefined);
            try {
              const sig = await signTypedData(typed);
              setSignature(sig);
              const who = await recoverTypedDataAddress({ ...typed, signature: sig });
              setVerified(who.toLowerCase() === owner.toLowerCase());
            } catch (e) {
              setErr((e as Error).message);
            }
          }}
        >
          {signing ? "Waiting for wallet…" : "Sign policy (EIP-712)"}
        </Button>
        <Button
          variant="ghost"
          disabled={sending}
          onClick={async () => {
            setErr(undefined);
            try {
              setTx(
                // Sends exactly the calldata shown in the preview above.
                await sendTransaction({
                  to: registry,
                  data: calldata,
                  chainId: chainId as 31337 | 84532 | 1301,
                }),
              );
            } catch (e) {
              setErr((e as Error).message.split("\n")[0]);
            }
          }}
        >
          {sending ? "Waiting for wallet…" : "Send registration transaction"}
        </Button>
      </div>
      {signature && (
        <p data-testid="signature-status" className={verified ? "text-armed" : "text-unavailable"}>
          {verified
            ? "Signature verified: recovers to the policy owner."
            : "Signature does not recover to the owner."}{" "}
          <Hash value={signature} n={10} />
        </p>
      )}
      {tx && (
        <p>
          Transaction submitted by your wallet: <Hash value={tx} n={10} />. The policy appears once the
          indexer sees the PolicyRegistered event.
        </p>
      )}
      {err && (
        <p role="alert" className="text-unavailable">
          {err}
        </p>
      )}
    </div>
  );
}
