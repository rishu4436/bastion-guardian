"use client";

import { useState, type ReactNode } from "react";
import type { Abi } from "viem";
import { encodeFunctionData } from "viem";
import { useConnection, useSendTransaction } from "wagmi";
import { Badge, Button, Hash } from "./ui";

export type ActionKind = "onchain" | "offchain" | "governance" | "readonly";

export const ACTION_LABEL: Record<
  ActionKind,
  { text: string; tone: "accent" | "limited" | "unknown" | "armed"; help: string }
> = {
  onchain: {
    text: "On-chain · you sign",
    tone: "accent",
    help: "A transaction from your own wallet. BASTION cannot send it for you.",
  },
  offchain: {
    text: "Off-chain · BASTION setting",
    tone: "armed",
    help: "Changes a BASTION account setting. No transaction and no effect on funds.",
  },
  governance: {
    text: "Governance · guardian role only",
    tone: "limited",
    help: "Only addresses holding the emergency guardian role can execute this.",
  },
  readonly: { text: "Read-only check", tone: "unknown", help: "Reads state. Changes nothing." },
};

export function ActionKindBadge({ kind }: { kind: ActionKind }) {
  const l = ACTION_LABEL[kind];
  return (
    <Badge tone={l.tone} title={l.help}>
      {l.text}
    </Badge>
  );
}

/**
 * A wallet transaction with a raw-call preview. Encodes exactly what is sent (to + calldata) and hands it to the
 * connected wallet; the user approves or rejects it there.
 */
export function TxAction({
  title,
  description,
  to,
  abi,
  functionName,
  args,
  chainId,
  kind = "onchain",
  danger,
  disabledReason,
  children,
}: {
  title: string;
  description: ReactNode;
  to: `0x${string}` | undefined;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  chainId: number;
  kind?: ActionKind;
  danger?: boolean;
  disabledReason?: string;
  children?: ReactNode;
}) {
  const { isConnected, chainId: walletChain } = useConnection();
  const { mutateAsync: send, isPending } = useSendTransaction();
  const [tx, setTx] = useState<`0x${string}`>();
  const [err, setErr] = useState<string>();
  let data: `0x${string}` | undefined;
  let encodeErr: string | undefined;
  try {
    data = encodeFunctionData({ abi, functionName, args } as never);
  } catch (e) {
    encodeErr = (e as Error).message.split("\n")[0];
  }
  const reason =
    disabledReason ??
    (!to
      ? "Contract not deployed on this chain"
      : encodeErr
        ? encodeErr
        : !isConnected
          ? "Connect your wallet"
          : undefined);
  return (
    <div className="rounded-lg border border-border p-4" data-testid={`action-${functionName}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{title}</h3>
        <ActionKindBadge kind={kind} />
      </div>
      <p className="mt-1 text-sm text-muted">{description}</p>
      {children}
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted">Raw call</summary>
        <div className="mt-2 space-y-1">
          <div>
            to <span className="font-mono">{to ?? "—"}</span> · chain {chainId} · {functionName}(
            {args.map((a) => (typeof a === "bigint" ? a.toString() : JSON.stringify(a))).join(", ")})
          </div>
          <pre className="max-h-32 overflow-auto break-all whitespace-pre-wrap rounded bg-bg p-2">
            {data ?? encodeErr}
          </pre>
        </div>
      </details>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          variant={danger ? "danger" : "ghost"}
          disabled={!!reason || isPending || kind === "readonly"}
          onClick={async () => {
            setErr(undefined);
            try {
              if (walletChain !== chainId) throw new Error(`Switch your wallet to chain ${chainId} first`);
              setTx(await send({ to: to!, data: data!, chainId: chainId as 31337 | 84532 | 1301 }));
            } catch (e) {
              setErr((e as Error).message.split("\n")[0]);
            }
          }}
        >
          {isPending ? "Waiting for wallet…" : "Review in wallet"}
        </Button>
        {reason && <span className="text-xs text-muted">{reason}</span>}
        {tx && (
          <span className="text-xs">
            Submitted <Hash value={tx} />
          </span>
        )}
        {err && (
          <span role="alert" className="text-xs text-unavailable">
            {err}
          </span>
        )}
      </div>
    </div>
  );
}
