# Local development and verification

Everything below runs on a laptop with **no public network**: a private anvil chain (31337) preloaded with the full
contract set and a labeled fixture market (LOCAL SIMULATION), plus Postgres and Redis.

## Setup

```bash
corepack enable && pnpm install
git submodule update --init --recursive
foundryup -i 1.9.0 && (cd contracts && forge build)
pnpm infra:up            # Postgres 17 + Redis 7 (infrastructure/docker/docker-compose.yml)
cp .env.example .env     # local defaults only; never put real secrets in git
```

## Run the stack

```bash
pnpm dev                 # API :4000, web :3000, services
cd apps/mobile && pnpm start   # Expo companion (see apps/mobile/README.md)
```

## Verify (what CI runs)

```bash
export REQUIRE_INTEGRATION_INFRA=true \
  TEST_DATABASE_URL=postgresql://bastion:bastion_local_only@127.0.0.1:5432/bastion \
  TEST_REDIS_URL=redis://127.0.0.1:6379
(cd contracts && forge fmt --check && forge test)
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm --filter @bastion-guardian/api openapi:check && pnpm --filter @bastion-guardian/sdk docs:check
(cd apps/web && pnpm exec playwright install chromium && pnpm test:e2e)
bash contracts/script/local-e2e.sh
```

`REQUIRE_INTEGRATION_INFRA=true` makes integration suites fail instead of skipping when Postgres/Redis are missing.

The local stack caches the deployed anvil state in `contracts/out-evidence/local/stack-cache.json`. The cache is rebuilt
when the deploy artifact changes or when it is older than 6 hours (an old cache would run the chain clock behind wall
time), and the chain clock is aligned to wall time on load.
