"use client";

import Link from "next/link";
import { useState } from "react";
import { erc20Abi, parseUnits } from "viem";
import { useConnection } from "wagmi";
import { bastionProtectionVaultAbi } from "@bastion-guardian/contracts/abis";
import { useApi, useTokens } from "@/lib/hooks";
import { useDeployments } from "@/lib/deployments";
import { Q } from "@/components/query";
import { TxAction } from "@/components/tx";
import {
  Amount,
  Badge,
  Card,
  Empty,
  Field,
  Hash,
  PageHeader,
  Provenance,
  Table,
  inputCls,
} from "@/components/ui";
import { ago, bps } from "@/lib/format";

interface Policy {
  chainId: number;
  policyId: `0x${string}`;
  status: string;
}
interface Budget {
  chainId: number;
  vault: string;
  policyId: string;
  token: string;
  repayReserve: string;
  feeReserve: string;
  maxFeeBps: number;
  totalReimbursed: string;
  pausedAt: string | null;
  releaseRequestedAt: string | null;
  updatedAt: string;
}

function BudgetRows({ p }: { p: Policy }) {
  const d = useApi<{ budgets: Budget[] }>(`/v1/policies/${p.chainId}/${p.policyId}`);
  if (d.isLoading) return <p className="text-xs text-muted">Loading budget…</p>;
  if (d.error)
    return <p className="text-xs text-unavailable">Budget unavailable: {(d.error as Error).message}</p>;
  if (!d.data!.budgets.length)
    return (
      <p className="text-xs text-muted">
        No reserve budget allocated for {p.policyId.slice(0, 10)}… (solver path cannot be reimbursed).
      </p>
    );
  return (
    <Table
      head={["Policy", "Repay reserve", "Fee reserve", "Max fee", "Reimbursed", "State", "Updated"]}
      empty="None"
      rows={d.data!.budgets.map((b) => [
        <Link key="p" className="font-mono text-xs text-accent" href={`/policies/${p.chainId}/${p.policyId}`}>
          {p.policyId.slice(0, 10)}…
        </Link>,
        <Amount key="r" chainId={b.chainId} token={b.token} raw={b.repayReserve} />,
        <Amount key="f" chainId={b.chainId} token={b.token} raw={b.feeReserve} />,
        bps(b.maxFeeBps),
        <Amount key="t" chainId={b.chainId} token={b.token} raw={b.totalReimbursed} />,
        b.pausedAt ? (
          <Badge key="s" tone="limited">
            paused
          </Badge>
        ) : b.releaseRequestedAt ? (
          <Badge key="s" tone="limited">
            release requested
          </Badge>
        ) : (
          <Badge key="s" tone="armed">
            active
          </Badge>
        ),
        ago(b.updatedAt),
      ])}
    />
  );
}

export default function Reserve() {
  const { address } = useConnection();
  const chainId = 31337;
  const policies = useApi<{ items: Policy[] }>(
    address ? `/v1/policies?owner=${address}&chainId=${chainId}` : null,
  );
  const dep = useDeployments(chainId);
  const vault = dep.data?.contracts.protectionVault;
  const tokens = useApi<{ items: { address: `0x${string}`; symbol: string; decimals: number }[] }>(
    `/v1/tokens?chainId=${chainId}`,
  );
  const { find } = useTokens();
  const [token, setToken] = useState<`0x${string}` | "">("");
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState("");
  const [maxFee, setMaxFee] = useState("100");
  const [policyId, setPolicyId] = useState<`0x${string}` | "">("");
  const t = token ? find(chainId, token) : undefined;
  const parse = (v: string) => {
    try {
      return t && /^\d+(\.\d+)?$/.test(v) ? parseUnits(v, t.decimals) : null;
    } catch {
      return null;
    }
  };
  const amt = parse(amount);
  const feeAmt = parse(fee || "0");
  return (
    <>
      <PageHeader
        title="Reserve budgets"
        subtitle="Funds you set aside on the reserve chain to reimburse solvers who repay your debt. Only you can allocate, pause or release them."
        right={<Provenance kind="local" />}
      />
      {!address ? (
        <Empty>Connect the wallet that owns your policies to see and manage its reserve budgets.</Empty>
      ) : (
        <div className="space-y-6">
          <Card title="Your budgets">
            <Q q={policies} isEmpty={(d) => !d.items.length} empty="No policies owned by this wallet.">
              {(d) => (
                <div className="space-y-4">
                  {d.items.map((p) => (
                    <BudgetRows key={p.policyId} p={p} />
                  ))}
                </div>
              )}
            </Q>
          </Card>
          <Card title="Fund a budget">
            <div className="grid gap-3 md:grid-cols-4">
              <Field label="Policy">
                <select
                  aria-label="Policy to fund"
                  className={inputCls}
                  value={policyId}
                  onChange={(e) => setPolicyId(e.target.value as `0x${string}`)}
                >
                  <option value="">Select…</option>
                  {policies.data?.items.map((p) => (
                    <option key={p.policyId} value={p.policyId}>
                      {p.policyId.slice(0, 12)}…
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Token">
                <select
                  aria-label="Reserve token"
                  className={inputCls}
                  value={token}
                  onChange={(e) => setToken(e.target.value as `0x${string}`)}
                >
                  <option value="">Select…</option>
                  {tokens.data?.items.map((x) => (
                    <option key={x.address} value={x.address}>
                      {x.symbol}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={`Repay amount ${t ? `(${t.symbol})` : ""}`}>
                <input
                  aria-label="Repay amount"
                  className={inputCls}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>
              <Field label="Fee amount / max fee bps">
                <div className="flex gap-2">
                  <input
                    aria-label="Fee amount"
                    className={inputCls}
                    value={fee}
                    onChange={(e) => setFee(e.target.value)}
                  />
                  <input
                    aria-label="Max fee bps"
                    className={inputCls}
                    value={maxFee}
                    onChange={(e) => setMaxFee(e.target.value)}
                  />
                </div>
              </Field>
            </div>
            <p className="mt-3 text-xs text-muted">
              Three wallet transactions, in order. Vault: <Hash value={vault} />
            </p>
            <div className="mt-3 grid gap-4 md:grid-cols-3">
              <TxAction
                title="1 · Approve token"
                description="Lets the vault pull exactly repay + fee from your wallet."
                to={token || undefined}
                abi={erc20Abi}
                functionName="approve"
                args={[vault ?? "0x0000000000000000000000000000000000000000", (amt ?? 0n) + (feeAmt ?? 0n)]}
                chainId={chainId}
                disabledReason={amt === null ? "Enter an amount" : undefined}
              />
              <TxAction
                title="2 · Deposit"
                description="Moves the funds into your vault balance (still yours)."
                to={vault}
                abi={bastionProtectionVaultAbi}
                functionName="deposit"
                args={[token || "0x0000000000000000000000000000000000000000", (amt ?? 0n) + (feeAmt ?? 0n)]}
                chainId={chainId}
                disabledReason={amt === null || !token ? "Select token and amount" : undefined}
              />
              <TxAction
                title="3 · Allocate to policy"
                description="Earmarks repay and fee reserves for this policy's solver reimbursements."
                to={vault}
                abi={bastionProtectionVaultAbi}
                functionName="allocate"
                args={[
                  policyId || `0x${"0".repeat(64)}`,
                  token || "0x0000000000000000000000000000000000000000",
                  amt ?? 0n,
                  feeAmt ?? 0n,
                  Number(maxFee) || 0,
                ]}
                chainId={chainId}
                disabledReason={!policyId || amt === null ? "Select policy, token and amount" : undefined}
              />
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
