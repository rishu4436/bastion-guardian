"use client";

import { useEffect, useState } from "react";
import { api } from "./api";

export type PushSupport =
  { ok: true } | { ok: false; reason: "no-sw" | "no-push" | "ios-not-installed" | "insecure" | "denied" };

export function isIos(ua = typeof navigator === "undefined" ? "" : navigator.userAgent): boolean {
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && typeof document !== "undefined" && "ontouchend" in document)
  );
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Web Push needs a secure context, a service worker and PushManager; on iOS (16.4+) only inside an installed PWA. */
export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return { ok: false, reason: "no-sw" };
  if (!window.isSecureContext) return { ok: false, reason: "insecure" };
  if (!("serviceWorker" in navigator)) return { ok: false, reason: "no-sw" };
  if (isIos() && !isStandalone()) return { ok: false, reason: "ios-not-installed" };
  if (!("PushManager" in window)) return { ok: false, reason: "no-push" };
  if (typeof Notification !== "undefined" && Notification.permission === "denied")
    return { ok: false, reason: "denied" };
  return { ok: true };
}

export function urlBase64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function useServiceWorker() {
  const [reg, setReg] = useState<ServiceWorkerRegistration | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then(setReg)
      .catch((e: Error) => setError(e.message));
  }, []);
  return { reg, error };
}

/**
 * Subscribes this browser to Web Push with the API's VAPID key and registers the subscription for the signed-in
 * user. Returns a reason instead of throwing when push is unavailable (no VAPID key = provider not configured).
 */
export async function subscribePush(): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const s = pushSupport();
  if (!s.ok) return { ok: false, reason: s.reason };
  const { publicKey } = await api<{ publicKey: string | null }>("/v1/notifications/webpush-key");
  if (!publicKey) return { ok: false, reason: "not-configured" };
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, reason: "denied" };
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const r = await api<{ id: string }>("/v1/me/devices", {
    method: "POST",
    json: { endpoint: j.endpoint, keys: j.keys },
  });
  return { ok: true, id: r.id };
}

export const PUSH_REASON: Record<string, string> = {
  "no-sw": "This browser does not support service workers.",
  "no-push": "This browser does not support Web Push.",
  "ios-not-installed":
    "On iPhone and iPad, add BASTION to your Home Screen first (Safari → Share → Add to Home Screen), then open it from there to enable alerts (iOS 16.4+).",
  insecure: "Push requires HTTPS (or localhost).",
  denied: "Notifications are blocked for this site in your browser settings.",
  "not-configured":
    "Web Push is not configured on this BASTION API (no VAPID key). Telegram, email or SMS may still be available.",
};
