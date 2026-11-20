/** Pure delivery-policy rules: severity threshold, opt-outs, quiet hours with critical escalation. */
export type Severity = "info" | "warning" | "critical";
const RANK: Record<Severity, number> = { info: 0, warning: 1, critical: 2 };

export interface Preferences {
  minSeverity: Severity;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  timezone: string;
  escalateCritical: boolean;
  privateLockScreen: boolean;
  eventOptOuts: string[];
}

export const DEFAULT_PREFERENCES: Preferences = {
  minSeverity: "warning",
  quietHoursStart: null,
  quietHoursEnd: null,
  timezone: "UTC",
  escalateCritical: true,
  privateLockScreen: true,
  eventOptOuts: [],
};

export function localHour(now: Date, timeZone: string): number {
  const h = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone }).format(now);
  return Number(h);
}

export function inQuietHours(p: Preferences, now: Date): boolean {
  if (p.quietHoursStart == null || p.quietHoursEnd == null || p.quietHoursStart === p.quietHoursEnd)
    return false;
  const h = localHour(now, p.timezone);
  return p.quietHoursStart < p.quietHoursEnd
    ? h >= p.quietHoursStart && h < p.quietHoursEnd
    : h >= p.quietHoursStart || h < p.quietHoursEnd; // window wraps midnight
}

export function decide(
  p: Preferences,
  eventType: string,
  severity: Severity,
  now: Date,
  isTest = false,
): { deliver: true } | { deliver: false; reason: string } {
  if (isTest) return { deliver: true };
  if (p.eventOptOuts.includes(eventType) && severity !== "critical")
    return { deliver: false, reason: "OPTED_OUT" };
  if (RANK[severity] < RANK[p.minSeverity]) return { deliver: false, reason: "BELOW_MIN_SEVERITY" };
  if (inQuietHours(p, now) && !(severity === "critical" && p.escalateCritical))
    return { deliver: false, reason: "QUIET_HOURS" };
  return { deliver: true };
}
