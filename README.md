# BASTION Guardian

Autonomous, non-custodial, cross-chain liquidation protection for DeFi borrowers, built on **Reactive Network**.

When a protected position's health factor drops below a user-signed trigger, a Reactive contract on Lasna detects
the authoritative on-chain risk event and calls back into Base Sepolia, where BASTION either **flash-deleverages** the
position or repays debt with **pre-committed solver liquidity**. The solver is then reimbursed from the user's reserve
on Unichain Sepolia by a second Reactive cycle. Every step is bounded by an EIP-712 policy the user signed.

> **Status (2026-11-20): Phase 0–2 — locally tested, not deployed.** No contract is deployed to any network, no
> transaction has been broadcast, and no independent audit has been performed. See [PROJECT-STATUS.md](PROJECT-STATUS.md).

## Quick start

```bash
git clone --recurse-submodules https://github.com/rishu4436/bastion-guardian && cd bastion-guardian
pnpm install
pnpm build && pnpm test            # TypeScript packages and apps
cd contracts && forge test         # Solidity: unit, fuzz, invariant (fork tests skip without RPC)

# optional: run the 3 fork tests against the official Aave V3 Base Sepolia deployment (read-only, local fork)
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org BASE_SEPOLIA_FORK_BLOCK=61193053 forge test --match-path "test/fork/*"

# optional: local Postgres + Redis
pnpm infra:up
```

Requirements: Node ≥ 24, pnpm 10, Foundry 1.9.0, Docker (optional).

## Documentation
- [ARCHITECTURE.md](ARCHITECTURE.md): components, trust boundaries, rescue paths, deployment order
- [THREAT-MODEL.md](THREAT-MODEL.md): threats, controls, the test for each, open risks
- [FEATURE-COMPLETENESS.md](FEATURE-COMPLETENESS.md): feature → component → acceptance test → status
- [docs/integrations/VERIFIED-ADDRESSES.md](docs/integrations/VERIFIED-ADDRESSES.md): every external address, with source
- [docs/CROSS-CHAIN-SETTLEMENT.md](docs/CROSS-CHAIN-SETTLEMENT.md): reimbursement flow and trust model
- [evidence/security/SLITHER-TRIAGE.md](evidence/security/SLITHER-TRIAGE.md): static analysis results

## Repository layout
`contracts/` Foundry · `apps/` api, web (mobile and docs reserved) · `packages/` types, chain-registry, config,
risk-engine, simulator, sdk, observability, ui · `services/` (reserved, Phase 4+) · `infrastructure/` docker ·
`evidence/` real artifacts only · `docs/`.

## Fixtures
`contracts/src/fixtures/*` is a **test fixture lending market, oracle and swap venue. It is not Aave or Uniswap**. It
exists for deterministic demos. The Aave adapter is exercised against the real Aave V3 Base Sepolia contracts in fork tests.

## License
MIT
