# Deployment runbook (testnets only)

Mainnet is disabled. Every script calls `_requireAllowedChain` (84532, 1301, 5318007, 31337 only) and refuses to
broadcast to a public network unless `BASTION_DEPLOY_AUTHORIZED=true` is set by someone the owner has authorized.

## Prerequisites

- Foundry 1.9.0 (`foundryup -i 1.9.0`), `git submodule update --init --recursive`, `cd contracts && forge build`.
- An **encrypted keystore** account (`cast wallet import <name> --interactive`). Never pass `--private-key`; never
  commit keystores or password files (`.gitignore` blocks `keystore/`, `*.key`, `.env*`).
- RPC env: `BASE_SEPOLIA_RPC_URL=https://sepolia.base.org`, `UNICHAIN_SEPOLIA_RPC_URL=https://sepolia.unichain.org`,
  `REACTIVE_LASNA_RPC_URL=https://lasna-rpc.rnk.dev/`.
- Funds: Base Sepolia ETH, Unichain Sepolia ETH, Lasna REACT. Lasna REACT comes from sending Sepolia ETH to the Reactive
  faucet contract (Ethereum Sepolia `0x9b9BB25f1A81078C544C829c5EB7822d747Cf434`, Base Sepolia
  `0x2afaFD298b23b62760711756088F75B7409f5967`; 1 ETH → 100 lREACT).

Always run each script once **without** `--broadcast` (simulation) and read the estimated cost before broadcasting.

## Order (Section 4B)

| Step | Chain            | Script                               | Required env                                                                                                                                                                  | Status                             |
| ---- | ---------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1    | Lasna            | `script/DeployReactiveCore.s.sol`    | optional `REACTIVE_CORE_INITIAL_FUNDING_WEI`                                                                                                                                  | **Done** (see TESTNET-DEPLOYMENTS) |
| 2    | Base Sepolia     | `script/DeployBaseSepolia.s.sol`     | `REACTIVE_CORE_ADDRESS`; optional `DEPLOY_FIXTURE_MARKET`, `SOLVER_MIN_BOND`, `SOLVER_EXIT_DELAY`, `OBSERVER_MIN_INTERVAL`, `CALLBACK_FUNDING_WEI`, `BASTION_GUARDIAN`        | Blocked: deployer unfunded         |
| 3    | Unichain Sepolia | `script/DeployUnichainSepolia.s.sol` | `REACTIVE_CORE_ADDRESS`, `DEST_SOLVER_EXECUTOR`, `RESERVE_TOKENS`; optional `RESERVE_RELEASE_DELAY`, `CALLBACK_FUNDING_WEI`                                                   | Blocked: deployer unfunded         |
| 4    | Lasna            | `script/ConfigureReactiveCore.s.sol` | `REACTIVE_CORE_ADDRESS`, `DEST_RISK_OBSERVER`, `DEST_SOLVER_EXECUTOR`, `DEST_CALLBACK_ROUTER`, `RESERVE_ESCROW`; `ACTIVATE_SUBSCRIPTIONS=true` only after a dry configuration | Pending steps 2–3                  |
| 5    | Base + Unichain  | `coverDebt()` on callback contracts  | funded callback contracts                                                                                                                                                     | Pending                            |

Example (step 2):

```bash
cd contracts
export BASTION_DEPLOY_AUTHORIZED=true REACTIVE_CORE_ADDRESS=0x811111D0a5DaBBD16180Ba42d11992863EF17e33
forge script script/DeployBaseSepolia.s.sol --rpc-url base_sepolia --account bastion-testnet-deployer      # simulate
forge script script/DeployBaseSepolia.s.sol --rpc-url base_sepolia --account bastion-testnet-deployer --broadcast
```

## After each broadcast

1. Copy `contracts/broadcast/<script>/<chainId>/run-latest.json` to `evidence/deployments/<network>/` (the `cache/`
   "sensitive values" file is never copied).
2. Re-read state with `cast` (code size, owner, wiring getters) and save the raw output next to it.
3. Add the address, tx hash, block and time (IST) to `docs/integrations/TESTNET-DEPLOYMENTS.md`.
4. Point services at the deployment (`*_RPC_URL`, addresses) and record them in `deployment_registry` with mode
   `testnet` so `/v1/deployments` and the web app show them.
