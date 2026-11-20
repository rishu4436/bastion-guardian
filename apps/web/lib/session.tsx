"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useConnection, useSignMessage } from "wagmi";
import { createSiweMessage } from "viem/siwe";
import { api, ApiError, setCsrf } from "./api";

export interface Session {
  address: string;
  chainId: number;
  roles: string[];
}

interface Ctx {
  session: Session | null;
  loading: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { address, chainId } = useConnection();
  const { mutateAsync: signMessage } = useSignMessage();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Session>("/v1/auth/session")
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, []);

  // A session belongs to one wallet: switching accounts in the wallet ends the UI session view.
  useEffect(() => {
    if (session && address && session.address !== address.toLowerCase()) setSession(null);
  }, [address, session]);

  const signIn = useCallback(async () => {
    setError(null);
    if (!address || !chainId) {
      setError("Connect a wallet first");
      return;
    }
    try {
      const n = await api<{ nonce: string; domain: string }>("/v1/auth/nonce");
      const message = createSiweMessage({
        address,
        chainId,
        domain: n.domain,
        nonce: n.nonce,
        uri: window.location.origin,
        version: "1",
        statement:
          "Sign in to BASTION Guardian. This signature does not authorize any transaction or transfer.",
        issuedAt: new Date(),
        expirationTime: new Date(Date.now() + 10 * 60_000),
      });
      const signature = await signMessage({ message });
      const s = await api<Session & { csrfToken: string }>("/v1/auth/verify", {
        method: "POST",
        json: { message, signature },
      });
      setCsrf(s.csrfToken);
      setSession({ address: s.address, chainId: s.chainId, roles: s.roles });
    } catch (e) {
      setError(
        e instanceof ApiError
          ? `${e.code}: ${e.message}`
          : e instanceof Error
            ? e.message.split("\n")[0]!
            : String(e),
      );
    }
  }, [address, chainId, signMessage]);

  const signOut = useCallback(async () => {
    try {
      await api("/v1/auth/logout", { method: "POST" });
    } finally {
      setCsrf(null);
      setSession(null);
    }
  }, []);

  return (
    <SessionContext.Provider value={{ session, loading, error, signIn, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): Ctx {
  const c = useContext(SessionContext);
  if (!c) throw new Error("useSession outside SessionProvider");
  return c;
}
