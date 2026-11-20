"use client";

import { useEffect, useState } from "react";
import { apiUrl } from "./api";

export interface StreamEvent {
  event: string;
  data: Record<string, unknown>;
  receivedAt: number;
}

const EVENTS = [
  "hello",
  "risk.observed",
  "rescue.executed",
  "settlement.event",
  "readiness.updated",
  "incident.updated",
];

/** Subscribes to GET /v1/stream (SSE). The browser's EventSource resumes with Last-Event-ID on reconnect. */
export function useStream(filter: { chainId?: number; policyId?: string } = {}, max = 50) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [state, setState] = useState<"connecting" | "open" | "error">("connecting");
  useEffect(() => {
    const q = new URLSearchParams();
    if (filter.chainId) q.set("chainId", String(filter.chainId));
    if (filter.policyId) q.set("policyId", filter.policyId);
    const es = new EventSource(`${apiUrl()}/v1/stream?${q}`, { withCredentials: true });
    es.onopen = () => setState("open");
    es.onerror = () => setState("error");
    const on = (event: string) => (m: MessageEvent<string>) =>
      setEvents((xs) =>
        [{ event, data: JSON.parse(m.data) as Record<string, unknown>, receivedAt: Date.now() }, ...xs].slice(
          0,
          max,
        ),
      );
    const hs = EVENTS.map((e) => [e, on(e)] as const);
    for (const [e, h] of hs) es.addEventListener(e, h as EventListener);
    return () => es.close();
  }, [filter.chainId, filter.policyId, max]);
  return { events, state };
}
