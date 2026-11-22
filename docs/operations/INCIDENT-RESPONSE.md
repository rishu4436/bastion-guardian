# Incident response

## Detection

- **guardian-health** evaluates every active policy's readiness from chain reads (policy status, emergency pause,
  Reactive core state and heartbeat, callback-proxy debt, solver commitments, reserve budget, flash-path feasibility)
  and raises `protection_unavailable` / `protection_unknown` incidents; a failed read is treated as UNKNOWN, never OK.
- **settlement-reconciler** raises incidents for overdue or failed reimbursements (measured on the reserve chain clock).
- **chain-indexer** records reorgs and checkpoint stalls.
- Incidents appear in the web **Operations** console (admin/auditor roles), on `/v1/incidents`, and in owners'
  notification channels.

## Containment levers (least to most disruptive)

| Lever                                  | Who                   | Effect                                                                   | Where                            |
| -------------------------------------- | --------------------- | ------------------------------------------------------------------------ | -------------------------------- |
| Pause one policy                       | policy owner          | stops automatic rescues for that policy                                  | Emergency Action Center          |
| Cap collateral pulls at zero           | protected account     | adapter refuses any operator collateral pull                             | Emergency Action Center          |
| Revoke token approval                  | protected account     | removes adapter allowance                                                | Emergency Action Center          |
| Pause reserve budget / request release | budget owner          | stops reimbursements from that budget; release after the delay           | Emergency Action Center, Reserve |
| Revoke policy                          | policy owner          | permanent                                                                | Emergency Action Center          |
| Protocol pause (scope or global)       | any guardian or owner | blocks **new** rescue/settlement actions; never blocks owner withdrawals | `BastionEmergencyControl.pause`  |

Resuming a protocol pause requires the owner **and** `resumeQuorum` distinct guardian approvals for the current pause
epoch. Pausing never grants custody.

## Runbook

1. Acknowledge the incident in Operations (recorded in the audit trail).
2. Decide the narrowest lever that contains it; prefer per-policy actions over a protocol pause.
3. For a protocol-level issue, a guardian pauses the affected scope, then posts the reason.
4. Fix, verify on the local simulation (`local-e2e.sh`) and testnet, collect guardian approvals, owner resumes.
5. Write up the incident with tx hashes; update `THREAT-MODEL.md` if a new threat was found.
