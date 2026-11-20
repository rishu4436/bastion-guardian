import type { RenderedMessage } from "./providers/types.js";
import type { NotificationEvent } from "./events.js";

const short = (h: string | null) => (h ? `${h.slice(0, 10)}…${h.slice(-4)}` : "");

/** Deterministic copy. Lock-screen text never includes amounts, health factors or identifiers when private mode is on. */
export function render(
  e: NotificationEvent,
  opts: { privateLockScreen: boolean; appUrl: string; isTest?: boolean },
): RenderedMessage {
  const pending = e.confirmation === "observed" ? " (observed, awaiting finality)" : "";
  const f = e.facts;
  const url = `${opts.appUrl}${e.policyId ? `/policies/${e.policyId}` : "/alerts"}`;
  let title: string;
  let body: string;
  switch (e.eventType) {
    case "risk.trigger_crossed":
      title = "Health factor below your trigger";
      body = `Policy ${short(e.policyId)}: health factor ${f.healthFactor} is below trigger ${f.trigger}${pending}. BASTION is attempting protection.`;
      break;
    case "rescue.executed":
      title = "Rescue executed";
      body = `${f.path} rescue repaid ${f.repaid ?? "?"} (base units, fee ${f.fee ?? "?"}); health factor ${f.hfBefore ?? "?"} → ${f.hfAfter ?? "?"}${pending}.`;
      break;
    case "rescue.failed":
      title = "Rescue attempt failed";
      body = `A ${f.path} rescue attempt failed (${f.reason ?? "unknown"})${pending}. Consider repaying or adding collateral now.`;
      break;
    case "settlement.recovery_required":
      title = "Reserve settlement needs attention";
      body = `Reimbursement of ${f.principal}+${f.fee} could not be paid from your reserve budget (${f.lastError ?? "unknown"}).`;
      break;
    default:
      title = String(f.title ?? "BASTION alert").slice(0, 80);
      body = `${String(f.title ?? "")}\nRecommended: ${String(f.action ?? "")}`;
  }
  if (opts.isTest) {
    title = `[TEST] ${title}`;
    body = `This is a test notification. ${body}`;
  }
  const lockScreen = opts.privateLockScreen
    ? e.severity === "critical"
      ? "BASTION: urgent protection alert. Open the app for details."
      : "BASTION: protection update. Open the app for details."
    : `${title}: ${body}`.slice(0, 180);
  return {
    title,
    body,
    lockScreen: opts.isTest ? `[TEST] ${lockScreen}` : lockScreen,
    url,
    severity: e.severity,
  };
}
