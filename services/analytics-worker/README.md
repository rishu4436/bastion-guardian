# analytics-worker

Recomputes daily per-chain metrics (`analytics_daily`) from verified indexed rows: risk observations, rescue
executions, solver fills, settlement events, readiness snapshots, notification deliveries and incidents.

- Read-only with respect to chains (only block timestamp reads); idempotent upsert per `(day, chain, metric)`.
- `tick()` recomputes yesterday and today so late events and reorg rollbacks are reflected.
- `*_raw` amounts are summed token base units; meaningful per chain only while it has a single debt asset
  (true for the local simulation). Per-asset breakdown is a tracked follow-up.

Test: `pnpm --filter @bastion-guardian/analytics-worker test` (needs Postgres at `TEST_DATABASE_URL` and Foundry).
