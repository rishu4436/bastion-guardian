"use client";

import { useEffect, useState } from "react";
import { PushEnrol } from "@/components/push";
import { Badge, Button, Card, PageHeader } from "@/components/ui";
import { isIos, isStandalone } from "@/lib/pwa";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function Install() {
  const [ios, setIos] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [outcome, setOutcome] = useState<string>();
  useEffect(() => {
    setIos(isIos());
    setStandalone(isStandalone());
    const h = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);
  return (
    <>
      <PageHeader
        title="Install BASTION"
        subtitle="Install the web app for a home-screen icon, full-screen view and device alerts. The native companion app is in apps/mobile."
        right={standalone ? <Badge tone="armed">Running installed</Badge> : <Badge>In browser</Badge>}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="iPhone & iPad (Safari)">
          <ol className="list-decimal space-y-2 pl-5 text-sm" data-testid="ios-steps">
            <li>
              Open this site in Safari (other iOS browsers cannot install web apps on older iOS versions).
            </li>
            <li>
              Tap the <strong>Share</strong> button (square with an arrow).
            </li>
            <li>
              Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
            </li>
            <li>Open BASTION from the new Home Screen icon.</li>
            <li>
              Go to <strong>Settings → Enable alerts on this device</strong>. iOS only allows web push for
              installed apps, on iOS/iPadOS 16.4 or later.
            </li>
          </ol>
          {ios && !standalone && (
            <p className="mt-3 text-xs text-limited">
              You are on iOS in the browser: follow the steps above.
            </p>
          )}
        </Card>
        <Card title="Android, Chrome, Edge (desktop)">
          <p className="text-sm text-muted">
            Use the browser&apos;s install prompt, or the button below when the browser offers it.
          </p>
          <div className="mt-3">
            <Button
              disabled={!prompt}
              onClick={async () => {
                await prompt!.prompt();
                setOutcome((await prompt!.userChoice).outcome);
                setPrompt(null);
              }}
            >
              Install app
            </Button>
            {!prompt && !standalone && (
              <p className="mt-2 text-xs text-muted">
                The browser has not offered installation yet (or it is already installed).
              </p>
            )}
            {outcome && <p className="mt-2 text-xs">Install {outcome}.</p>}
          </div>
        </Card>
        <Card title="Alerts on this device" className="lg:col-span-2">
          <PushEnrol />
          <p className="mt-3 text-xs text-muted">
            Lock-screen alerts hide amounts and addresses by default (private lock screen). Critical alerts
            stay on screen until dismissed. Offline, the app shows nothing rather than cached health factors.
          </p>
        </Card>
      </div>
    </>
  );
}
