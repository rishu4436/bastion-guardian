"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useConnect, useConnection, useConnectors, useDisconnect } from "wagmi";
import { useSession } from "@/lib/session";
import { CHAIN_NAMES, short } from "@/lib/format";

const LINKS = [
  ["/dashboard", "Dashboard"],
  ["/activity", "Activity"],
  ["/solvers", "Solvers"],
  ["/simulator", "Simulator"],
  ["/analytics", "Analytics"],
  ["/status", "Status"],
] as const;

function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => setTheme((document.documentElement.dataset.theme as "dark" | "light") ?? "dark"), []);
  const flip = () => {
    const t = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = t;
    localStorage.setItem("bastion-theme", t);
    setTheme(t);
  };
  return (
    <button
      type="button"
      onClick={flip}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted hover:text-text"
    >
      {theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}

export function WalletButton() {
  const { address, chainId, isConnected } = useConnection();
  const connectors = useConnectors();
  const { mutateAsync: connect, isPending } = useConnect();
  const { mutate: disconnect } = useDisconnect();
  const { session, signIn, signOut, error } = useSession();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="h-9 w-32" />;

  if (!isConnected) {
    const c = connectors[0];
    return (
      <button
        type="button"
        disabled={!c || isPending}
        onClick={() => c && void connect({ connector: c })}
        className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-contrast disabled:opacity-50"
      >
        {c ? (isPending ? "Connecting…" : "Connect wallet") : "No wallet detected"}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-xs text-muted md:inline">
        {CHAIN_NAMES[chainId ?? 0] ?? `chain ${chainId}`}
      </span>
      {session ? (
        <button
          type="button"
          onClick={() => void signOut()}
          className="rounded-lg border border-border px-3 py-1.5 font-mono text-xs"
          title="Signed in. Click to sign out."
        >
          {short(address, 4)} · signed in
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void signIn()}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast"
        >
          Sign in with Ethereum
        </button>
      )}
      <button
        type="button"
        onClick={() => disconnect()}
        className="text-xs text-muted hover:text-text"
        aria-label="Disconnect wallet"
      >
        ✕
      </button>
      {error && (
        <span role="alert" className="max-w-56 truncate text-xs text-unavailable" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}

export function Nav() {
  const path = usePathname();
  const { session } = useSession();
  const extra: [string, string][] = [];
  if (session) extra.push(["/settings/notifications", "Notifications"]);
  if (session?.roles.some((r) => r === "admin" || r === "auditor")) extra.push(["/operations", "Operations"]);
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
        <Link href="/" className="font-semibold tracking-tight">
          BASTION<span className="text-muted"> Guardian</span>
        </Link>
        <nav className="hidden flex-1 gap-1 lg:flex" aria-label="Primary">
          {[...LINKS, ...extra].map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className={`rounded-md px-2.5 py-1.5 text-sm ${path?.startsWith(href) ? "bg-raised text-text" : "text-muted hover:text-text"}`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <ThemeToggle />
          <WalletButton />
        </div>
      </div>
    </header>
  );
}

export function EnvironmentBanner() {
  return (
    <div
      className="border-b border-limited/30 bg-limited/10 px-6 py-1.5 text-center text-xs text-limited"
      role="note"
    >
      Testnet software, not audited. Chain 31337 data is a LOCAL SIMULATION (anvil + fixture market). No
      BASTION contracts are deployed to any public network yet.
    </div>
  );
}
