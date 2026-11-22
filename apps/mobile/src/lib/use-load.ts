import { useCallback, useEffect, useRef, useState } from "react";

export interface Load<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  /** Wall-clock ms of the last successful load; shown so stale data is never presented as current. */
  updatedAt: number | null;
  refresh: () => void;
}

/** Fetch-with-refresh. Keeps the last good data visible (and labeled) when a refresh fails. */
export function useLoad<T>(fn: (() => Promise<T>) | null, deps: unknown[], intervalMs = 0): Load<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const run = useCallback(() => {
    const f = fnRef.current;
    if (!f) return;
    setLoading(true);
    f()
      .then((d) => {
        setData(d);
        setError(null);
        setUpdatedAt(Date.now());
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    setData(undefined);
    setUpdatedAt(null);
    run();
    if (!intervalMs) return;
    const t = setInterval(run, intervalMs);
    return () => clearInterval(t);
  }, deps);
  return { data, error, loading, updatedAt, refresh: run };
}
