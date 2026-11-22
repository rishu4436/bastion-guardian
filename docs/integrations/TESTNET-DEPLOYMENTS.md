# BASTION testnet deployments

Only deployments with a real transaction hash, a successful receipt and a follow-up on-chain read are listed here.
Raw evidence: `evidence/deployments/lasna/` (Foundry broadcast record + `cast` reads).

| Network                | Status                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| Reactive Lasna 5318007 | **Step 1 deployed**: `BastionReactiveCore`, unconfigured (0 sources, no subscriptions), unfunded |
| Base Sepolia 84532     | **Not deployed**: the deployer has 0 Base Sepolia ETH (blocked on owner funding)                 |
| Unichain Sepolia 1301  | **Not deployed**: the deployer has 0 Unichain Sepolia ETH (blocked on owner funding)             |
| Any mainnet            | **Never**: mainnet is disabled; deploy scripts refuse non-allowlisted chains                     |

## Reactive Lasna (chain 5318007)

Deployer (throwaway testnet key, encrypted Foundry keystore on the build box, never committed):
`0xED64A84B841E8fFeFFd5670cf627984332b3835F`.

| Contract              | Address                                      | Deploy tx                                                            | Block   | Time                                   |
| --------------------- | -------------------------------------------- | -------------------------------------------------------------------- | ------- | -------------------------------------- |
| `BastionReactiveCore` | `0x811111D0a5DaBBD16180Ba42d11992863EF17e33` | `0x25752e84a0e1f135b16e30a67a791e1eca91deedeee9da0a309a7d164d3128b7` | 8944427 | 2026-11-22 09:14:28 IST (03:44:28 UTC) |

- Script: `forge script script/DeployReactiveCore.s.sol --rpc-url lasna --account bastion-testnet-deployer --broadcast`
  with `BASTION_DEPLOY_AUTHORIZED=true`, `REACTIVE_CORE_INITIAL_FUNDING_WEI` unset (0). Compiled with solc 0.8.29,
  `via_ir`, `evm_version = cancun`.
- Receipt: status 1 (success), gas used 2,141,448. Deployer balance went from 10.5 to 10.2858552 REACT
  (cost 0.2141448 REACT).
- Post-deploy reads (`evidence/deployments/lasna/reactive-core-reads.txt`): runtime code present (9,434 bytes),
  `owner()` = deployer, `sourceCount()` = 0, `outstandingDebt()` = 0, balance 0.
- Explorer: https://lasna.reactscan.net/tx/0x25752e84a0e1f135b16e30a67a791e1eca91deedeee9da0a309a7d164d3128b7

**What this proves:** the cancun-target, via-IR `BastionReactiveCore` bytecode deploys on Lasna and its constructor and
view functions execute. **What it does not prove yet:** origin subscriptions, `react()` delivery, Omni single-instance
state behaviour, or any callback. Those need steps 2–5 (Base and Unichain stacks, then `ConfigureReactiveCore`).

## Next steps (see `docs/operations/DEPLOYMENT-RUNBOOK.md`)

1. Owner funds the deployer on Base Sepolia and Unichain Sepolia.
2. `REACTIVE_CORE_ADDRESS=0x811111D0a5DaBBD16180Ba42d11992863EF17e33` → `DeployBaseSepolia` → `DeployUnichainSepolia`.
3. `ConfigureReactiveCore` (first without, then with `ACTIVATE_SUBSCRIPTIONS=true`), fund the core and callback debt.
4. Live end-to-end rescue; record every hash here.
