declare module "web-push" {
  export interface PushSubscription {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }
  export interface RequestDetails {
    method: string;
    headers: Record<string, string | number>;
    body: Buffer | null;
    endpoint: string;
  }
  export function generateRequestDetails(
    subscription: PushSubscription,
    payload: string | Buffer | null,
    options?: {
      vapidDetails?: { subject: string; publicKey: string; privateKey: string };
      TTL?: number;
      urgency?: "very-low" | "low" | "normal" | "high";
      contentEncoding?: string;
    },
  ): RequestDetails;
  export function generateVAPIDKeys(): { publicKey: string; privateKey: string };
}
