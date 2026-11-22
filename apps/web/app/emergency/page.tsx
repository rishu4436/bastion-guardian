"use client";

import Link from "next/link";
import { useState } from "react";
import { erc20Abi, keccak256, toHex } from "viem";
import { useConnection } from "wagmi";
import {
  aaveV3LendingAdapterAbi,
  bastionEmergencyControlAbi,
  bastionPolicyRegistryAbi,
  bastionProtectionVaultAbi,
} from "@bastion-guardian/contracts/abis";
import { useApi } from "@/lib/hooks";
import { useDeployments } from "@/lib/deployments";
import { Q } from "@/components/query";
import { ACTION_LABEL, ActionKindBadge, TxAction, type ActionKind } from "@/components/tx";
import { Card, Empty, Hash, PageHeader, Provenance, ReadinessBadge, inputCls } from "@/components/ui";
import { CHAIN_NAMES, isLocal } from "@/lib/format";

interface Policy {
  chainId: number;
  policyId: `0x${string}`;
  account: string;
  adapter: `0x${string}`;
  collateralAsset: `0x${string}`;
  debtAsset: string;
  status: string;
  readiness: { status: string } | null;
}
interface Budget {
  chainId: number;
  vault: `0x${string}`;
  repayReserve: string;
  feeReserve: string;
  pausedAt: string | null;
  releaseRequestedAt: string | null;
}

const SCOPES = ["ALL", "RESCUE", "SETTLEMENT", "SOLVER"] as const;
const scopeId = (s: string) => keccak256(toHex(`BASTION.SCOPE.${s}`));

export default function Emergency() {
  const { address } = useConnection();
  const [chainId, setChainId] = useState(31337);
  const policies = useApi<{ items: Policy[] }>(
    address ? `/v1/policies?owner=${address}&chainId=${chainId}` : null,
    {
      refetchInterval: 10_000,
    },
  );
  const [sel, setSel] = useState<string>("");
  const policy = policies.data?.items.find((p) => p.policyId === sel) ?? policies.data?.items[0];
  const detail = useApi<{ budgets: Budget[] }>(
    policy ? `/v1/policies/${policy.chainId}/${policy.policyId}` : null,
  );
  const dep = useDeployments(chainId);
  const c = dep.data?.contracts ?? {};
  return (
    <>
      <PageHeader
        title="Emergency Action Center"
        subtitle="Everything you can do right now to stop, limit or unwind protection, with what each action is and who can perform it."
        right={isLocal(chainId) ? <Provenance kind="local" /> : null}
      />
      <Card title="Action types" className="mb-6">
        <ul className="grid gap-3 text-sm md:grid-cols-4">
          {(Object.keys(ACTION_LABEL) as ActionKind[]).map((k) => (
            <li key={k}>
              <ActionKindBadge kind={k} />
              <p className="mt-1 text-xs text-muted">{ACTION_LABEL[k].help}</p>
            </li>
          ))}
        </ul>
      </Card>
      <div className="mb-6 flex flex-wrap gap-3">
        <select
          aria-label="Chain"
          className={`${inputCls} max-w-xs`}
          value={chainId}
          onChange={(e) => setChainId(Number(e.target.value))}
        >
          {[31337, 84532, 1301].map((x) => (
            <option key={x} value={x}>
              {CHAIN_NAMES[x]}
            </option>
          ))}
        </select>
        {policies.data && policies.data.items.length > 1 && (
          <select
            aria-label="Policy"
            className={`${inputCls} max-w-md`}
            value={policy?.policyId}
            onChange={(e) => setSel(e.target.value)}
          >
            {policies.data.items.map((p) => (
              <option key={p.policyId} value={p.policyId}>
                {p.policyId.slice(0, 12)}… · {p.status}
              </option>
            ))}
          </select>
        )}
      </div>
      {!address ? (
        <Empty>
          Connect the wallet that owns your policies. Owner actions are signed by that wallet only.
        </Empty>
      ) : (
        <Q
          q={policies}
          isEmpty={(d) => !d.items.length}
          empty={
            <>
              No policies owned by this wallet on {CHAIN_NAMES[chainId]}.{" "}
              <Link className="text-accent" href="/policies/new">
                Create one
              </Link>
              .
            </>
          }
        >
          {() =>
            policy && (
              <div className="grid gap-6 lg:grid-cols-2">
                <Card
                  title="Policy"
                  right={<ReadinessBadge status={policy.readiness?.status} />}
                  className="lg:col-span-2"
                >
                  <div className="flex flex-wrap gap-4 text-sm">
                    <span>
                      ID <Hash value={policy.policyId} n={10} />
                    </span>
                    <span>
                      Status <strong data-testid="policy-status">{policy.status}</strong>
                    </span>
                    <Link
                      className="text-accent"
                      href={`/guardian?chainId=${policy.chainId}&policyId=${policy.policyId}`}
                    >
                      Guardian Mode timeline →
                    </Link>
                  </div>
                </Card>
                <TxAction
                  title="Pause automatic rescues"
                  description="Stops new rescues for this policy immediately. Funds and positions are untouched; resume any time."
                  to={c.policyRegistry}
                  abi={bastionPolicyRegistryAbi}
                  functionName="pausePolicy"
                  args={[policy.policyId]}
                  chainId={chainId}
                  disabledReason={policy.status !== "Active" ? `Policy is ${policy.status}` : undefined}
                />
                <TxAction
                  title="Resume automatic rescues"
                  description="Re-arms a paused policy (fails on-chain if it expired or its adapter was disabled)."
                  to={c.policyRegistry}
                  abi={bastionPolicyRegistryAbi}
                  functionName="resumePolicy"
                  args={[policy.policyId]}
                  chainId={chainId}
                  disabledReason={policy.status !== "Paused" ? `Policy is ${policy.status}` : undefined}
                />
                <TxAction
                  title="Revoke policy permanently"
                  description="Ends protection for this policy. A new policy needs a new signature."
                  to={c.policyRegistry}
                  abi={bastionPolicyRegistryAbi}
                  functionName="revokePolicy"
                  args={[policy.policyId]}
                  chainId={chainId}
                  danger
                  disabledReason={policy.status === "Revoked" ? "Already revoked" : undefined}
                />
                <TxAction
                  title="Cap collateral pulls at zero"
                  description="Sets your adapter pull cap for the collateral asset to 0, so the flash path cannot withdraw any collateral even with an aToken approval."
                  to={policy.adapter}
                  abi={aaveV3LendingAdapterAbi}
                  functionName="setCollateralPullCap"
                  args={[policy.collateralAsset, 0n, true]}
                  chainId={chainId}
                />
                <TxAction
                  title="Revoke collateral token approval"
                  description="Sets the allowance the adapter has over your collateral (aToken) to 0. Paste the aToken address shown by your lending app."
                  to={policy.collateralAsset}
                  abi={erc20Abi}
                  functionName="approve"
                  args={[policy.adapter, 0n]}
                  chainId={chainId}
                >
                  <p className="mt-1 text-xs text-limited">
                    On Aave the approval lives on the aToken, not the underlying asset shown here. Check the
                    address in the raw call before signing.
                  </p>
                </TxAction>
                {(detail.data?.budgets ?? []).map((b) => (
                  <div key={b.vault} className="contents">
                    <TxAction
                      title="Pause reserve budget"
                      description="Stops solver reimbursements from your reserve for this policy (also stops solver rescues that depend on it)."
                      to={b.vault}
                      abi={bastionProtectionVaultAbi}
                      functionName="pauseBudget"
                      args={[policy.policyId]}
                      chainId={b.chainId}
                      disabledReason={b.pausedAt ? "Budget already paused" : undefined}
                    />
                    <TxAction
                      title="Request reserve release"
                      description="Starts the release delay after which you can withdraw unspent reserve. Solvers see the request immediately."
                      to={b.vault}
                      abi={bastionProtectionVaultAbi}
                      functionName="requestRelease"
                      args={[policy.policyId]}
                      chainId={b.chainId}
                      disabledReason={b.releaseRequestedAt ? "Release already requested" : undefined}
                    />
                  </div>
                ))}
                <div className="rounded-lg border border-border p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">Silence non-critical alerts</h3>
                    <ActionKindBadge kind="offchain" />
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    Quiet hours and severity thresholds live in{" "}
                    <Link className="text-accent" href="/settings/notifications">
                      notification settings
                    </Link>
                    . Critical alerts can still escalate.
                  </p>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">Check rescue readiness</h3>
                    <ActionKindBadge kind="readonly" />
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    Current Guardian status: <ReadinessBadge status={policy.readiness?.status} />. Readiness
                    is not a guarantee of rescue.
                  </p>
                </div>
              </div>
            )
          }
        </Q>
      )}
      <Card title="Protocol-wide emergency pause" className="mt-6">
        <p className="mb-4 text-sm text-muted">
          BastionEmergencyControl pauses new rescue, settlement or solver actions across BASTION. Only
          guardians can pause; resuming needs a guardian quorum. Pausing never moves funds.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          {SCOPES.map((s) => (
            <TxAction
              key={s}
              kind="governance"
              title={`Pause scope ${s}`}
              description={`Scope id keccak256("BASTION.SCOPE.${s}").`}
              to={c.emergency}
              abi={bastionEmergencyControlAbi}
              functionName="pause"
              args={[scopeId(s), keccak256(toHex("user-initiated"))]}
              chainId={chainId}
            />
          ))}
        </div>
      </Card>
    </>
  );
}
