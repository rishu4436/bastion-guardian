"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import { PUSH_REASON, pushSupport, subscribePush, type PushSupport } from "@/lib/pwa";
import { useApi } from "@/lib/hooks";
import { Badge, Button } from "./ui";

/** Browser push enrolment. Gated on: secure context, SW + PushManager, installed PWA on iOS, a VAPID key, a session. */
export function PushEnrol() {
  const { session } = useSession();
  const key = useApi<{ publicKey: string | null }>("/v1/notifications/webpush-key");
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [state, setState] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setSupport(pushSupport()), []);
  const configured = key.data ? !!key.data.publicKey : undefined;
  return (
    <div className="space-y-2 text-sm" data-testid="push-enrol">
      <div className="flex flex-wrap items-center gap-2">
        <span>Browser push:</span>
        {support === null ? (
          <Badge>checking</Badge>
        ) : !support.ok ? (
          <Badge tone="limited">{support.reason}</Badge>
        ) : configured === false ? (
          <Badge tone="limited" title={PUSH_REASON["not-configured"]}>
            provider not configured
          </Badge>
        ) : (
          <Badge tone="armed">available</Badge>
        )}
      </div>
      {support && !support.ok && <p className="text-xs text-muted">{PUSH_REASON[support.reason]}</p>}
      {configured === false && <p className="text-xs text-muted">{PUSH_REASON["not-configured"]}</p>}
      {key.error && (
        <p className="text-xs text-unavailable">Could not reach the API to check push configuration.</p>
      )}
      <Button
        disabled={!session || !support?.ok || !configured || busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await subscribePush();
            setState(
              r.ok ? "This browser will receive BASTION alerts." : (PUSH_REASON[r.reason] ?? r.reason),
            );
          } catch (e) {
            setState((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Enable alerts on this device
      </Button>
      {!session && <p className="text-xs text-muted">Sign in with Ethereum to register a device.</p>}
      {state && <p role="status">{state}</p>}
    </div>
  );
}
