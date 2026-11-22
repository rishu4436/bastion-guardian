# BASTION testnet deployments

Only deployments with a real transaction hash, a successful receipt and a follow-up on-chain read are listed here.
Every hash below was read back with `cast receipt` (status 1). Raw evidence lives in `evidence/deployments/`.
All times are IST (UTC+5:30).

Deployer (throwaway testnet key, encrypted Foundry keystore on the build box, never committed):
`0xED64A84B841E8fFeFFd5670cf627984332b3835F`.

| Network                | Status                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| Reactive Lasna 5318007 | **Deployed, configured, subscribed, funded**: `BastionReactiveCore`, 3 active sources, 3 destinations        |
| Base Sepolia 84532     | **Deployed and wired**: destination stack + labeled FIXTURE market; official Aave V3 adapter deployed        |
| Unichain Sepolia 1301  | **Deployed and wired**: reserve stack (vault, escrow) + labeled FIXTURE reserve token `frUSDC`               |
| Live loop (flash path) | **Verified live, 2026-11-22 13:08 IST**: Base event → Lasna `react()` → Base callback → flash rescue, HF 1.5 |
| Live loop (solver)     | **Not exercised live** (needs a separate solver account and a funded reserve budget; covered locally only)   |
| Any mainnet            | **Never**: mainnet is disabled; deploy scripts refuse non-allowlisted chains                                 |

> **FIXTURE** contracts (`fUSDC`, `fWETH`, `frUSDC`, `FixtureOracle`, `FixtureLendingMarket`, `FixtureSwapVenue`) are
> owner-mintable test fixtures, not real assets. The live loop runs against the fixture market so the price crash can
> be controlled; the production adapter for the official Aave V3 Base Sepolia pool is deployed alongside it.

## Live end-to-end rescue (flash path), 2026-11-22

Policy `0xb764e54187df3c2ec7107241f19d173750998b9bac99fcc9a2261aa2d580216b` (v1, flash-only, trigger 1.25, target 1.5,
max 8,000 fUSDC per action) on a 10 fWETH / 13,000 fUSDC fixture position owned by the deployer.

| #   | Chain | What happened                                                                                     | Tx                                                                   | Block    | Time     |
| --- | ----- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------- | -------- |
| 1   | Base  | `FixtureOracle.setAssetPrice(fWETH, 1800e8)`: HF 1.3077 → 1.1769                                  | `0xbbd781263bdf1c14e91f99fe6991452944ab6cc6cd703132bf7cd24089da8fa2` | 62056099 | 13:08:08 |
| 2   | Base  | `BastionRiskObserver.observe(policy)` emits `RiskObserved`                                        | `0x7553faf26298771b75a8ba4c2734180e41f0bdedbf05b590989cb37c47f9369e` | 62056110 | 13:08:10 |
| 3   | Lasna | Reactive Network delivers the log; core emits `EventAccepted` + `CallbackRequested(kind 1, Base)` | `0xa523811610c00aec3dba3b8e7adeb331ded99f4f569382f656c24ab8c857c369` | 8957674  | 13:08:10 |
| 4   | Base  | Callback proxy → `router.onRiskSignal` → `FlashRescueExecutor` (`RescueAttempted` path 1, ok)     | `0x24cef533fbb81eb3b4b0edb2906e8de7b3c557f87ad598ed8be37baf256d8f17` | 62056116 | 13:08:12 |

Result (on-chain reads after tx 4, `evidence/deployments/live-rescue-loop/loop-reads.txt`):

- Debt 13,000.00 → 6,358.67 fUSDC; collateral value 20,000 → 11,222.46 (fixture base units); HF 1.1769 → **1.5002**.
- Callback tx 4 was sent by the Reactive relayer `0xf7e866d726658f6c3f14b8ee537fe268a4d91ddb` through the official Base
  callback proxy `0x476F44b11F5C942c58f4c8E3d0300E5710743585`, carried the core address as the injected `rvm`, used
  1,280,930 gas and emitted 30 logs (ledger, receipt registry, market, adapter, executor).
- `RescueSettlementLedger.stateOf(rescueId 0x76a6…b7e5)` = 4 (`DestinationExecuted`); policy usage recorded.
- Event id `0xcb0f0dfee50a37f86a84981cc85e58c63ce6f7994997dea97fc3dfcf11783302` is identical in the Lasna
  `CallbackRequested` log and the Base `CallbackReceived` log.
- Observation → execution: 2 seconds of Base block time (well inside `maxSignalAge` = 120 s).
- Callback cost: the router paid 10,353,829,200,000 wei (Base, debt now 0); the core paid 0.0219301 REACT (Lasna).
- Before broadcasting, the identical crash + callback was dry-run on an anvil fork of Base Sepolia with the same
  outcome (HF 1.5002).

Setup transactions (11, all status 1) are in `evidence/deployments/live-rescue-loop/LiveRescueSetupBaseSepolia-run-latest.json`:
fixture mints, 500,000 fUSDC supplied for a keyless fixture-LP address `0xf45dF2897CdD4Df2Bfc09F233b0E24F7F08dA896`
(so it is not the borrower's collateral), the borrower position, `registerPolicy`
(`0xfdff59544fee835a97709df4cc9069d563ab4749710e8da854b19f503e1bf56b`), the 5 fWETH aToken approval and pull cap.
Lasna policy mirror: `0x9ed3a93a49ec1cecac18aaa3f9f9e4d2ca0fa8d00093a18fffddc957499a3ab0`.

## Reactive Lasna (chain 5318007)

| Contract              | Address                                      | Deploy tx                                                            | Block   | Time                    |
| --------------------- | -------------------------------------------- | -------------------------------------------------------------------- | ------- | ----------------------- |
| `BastionReactiveCore` | `0x811111D0a5DaBBD16180Ba42d11992863EF17e33` | `0x25752e84a0e1f135b16e30a67a791e1eca91deedeee9da0a309a7d164d3128b7` | 8944427 | 2026-11-22 09:14:28 IST |

Deploy: 2,141,448 gas, 0.2141448 REACT. Configuration (`ConfigureReactiveCore.s.sol`, `ACTIVATE_SUBSCRIPTIONS=true`,
`CORE_FUNDING_WEI=1e18`), 2026-11-22 13:02 IST, blocks 8957327–8957352, 11 txs, all status 1:

| Step                                                           | Tx                                                                   |
| -------------------------------------------------------------- | -------------------------------------------------------------------- |
| Fund core 1 REACT                                              | `0xd69c722f5ae28638820a9a10fc14b6a7ec505374c4fdcecb43ace0eb05b6bffc` |
| `addSource` kind 1: Base `RiskObserved` @ observer             | `0x3a74c04ee95c4617689d6d391ac0d3640a99f07760053419ad9015fde2032d9c` |
| `addSource` kind 2: Base `SolverRescueExecuted` @ executor     | `0xf8cf6b8881b919cccff55a650a206d841e0b55ff538cb1f674b5b6f3c662698a` |
| `addSource` kind 3: Unichain `ReimbursementCompleted` @ escrow | `0x9326e497c42afcdb4611f082d745d4504f3c741501b23682869b6b8b8381e0cd` |
| `setDestination` 1 → Base router, 2,000,000 gas                | `0x2d099c70d6df3b558eb45b50db0587c90b9b0b3a4313337c2acd4d42972b7618` |
| `setDestination` 2 → Unichain escrow, 1,000,000 gas            | `0xd078cd6acba452a73cf7ec6228285990fe05d0d92db5b11d4f5caa0ce4b2eeed` |
| `setDestination` 3 → Base router, 500,000 gas                  | `0x091ac0f459ca02866ff3a2483742725e4358988f3e71a5803b3733b4cb269e37` |
| `setSourceActive(0)` (subscribe)                               | `0x3d196ed3ada4e5398b7a48e3b36c6592cbf3b0b012e687a119df2b943279fa25` |
| `setSourceActive(1)` (subscribe)                               | `0xe34f4eb148f7f6e1074a407d7ca41a680c328ae289a691c6345cb9159e64e061` |
| `setSourceActive(2)` (subscribe)                               | `0x2b047fc48c1d7d4ba8d96dc71f4d6985d2673a1c9d2af706b995a5b7da632e57` |

Cost: 857,180 gas at 100 gwei = 0.085718 REACT plus the 1 REACT funding (Lasna receipts report
`effectiveGasPrice` 0, so the cost is taken from the deployer balance delta, which matches gas × 100 gwei exactly).
Each `setSourceActive` emitted a subscribe log from the Reactive system contract `0x8888…8888`. Reads
(`evidence/deployments/lasna/reactive-core-config-reads.txt`): 3 sources, all active; the 3 destinations as above;
`outstandingDebt` 0; not paused.

## Base Sepolia (chain 84532)

`DeployBaseSepolia.s.sol` with `REACTIVE_CORE_ADDRESS` = Lasna core, `DEPLOY_FIXTURE_MARKET=true`,
`CALLBACK_FUNDING_WEI=1e15`. Simulated first (34,446,856 gas est.). 43 transactions, all status 1, blocks
62051212–62051576 (2026-11-22, ~12:51 IST). Fees: 0.000131400961337333 ETH (L2 131,400,961,280,187 wei + L1 data
57,146 wei) plus 0.001 ETH funding the router. Full record: `evidence/deployments/base-sepolia/DeployBaseSepolia-run-latest.json`.

| Contract                                       | Address                                      | Deploy tx                                                            | Gas       |
| ---------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------- | --------- |
| `AaveV3LendingAdapter` (official Aave V3 pool) | `0x811111D0a5DaBBD16180Ba42d11992863EF17e33` | `0xe5927822d096636d5b96f0c885787892c7d4f41f981415068b917e26dfc5d4b4` | 1,953,801 |
| FIXTURE `fUSDC`                                | `0xa196d20cc969Df5A4c7df5034A84e240dA7Cb943` | `0x16a8be74134b12f879d970642e70e3c01f3b7d4dffbd87e9758c86664ff8bc9e` | 611,302   |
| FIXTURE `fWETH`                                | `0x0d37C05cfcbdcfDEF31350b7373b97c9234ccaaC` | `0x48b4e5056a4a4a50a1ce58ea265b5240438bd5b8dfccf29fc4249cdc934f463d` | 611,362   |
| `FixtureOracle`                                | `0xB3F36cb93f8C2102a65cF34Ec0783b4181715f7F` | `0xa5a391a6e2aeadb49a15ef90e4a0121a12fc66b91bc92832132dc21c4fa2da64` | 302,834   |
| `FixtureLendingMarket`                         | `0xB7f24A2f3B1705F8cd3D1cf561795D7a28eC91d5` | `0xafc6598e6e58ba4d5a2e3d17abcb2e09265892e78f17b069c7cbf0b17cd4bca1` | 2,827,678 |
| `FixtureSwapVenue`                             | `0x16d979309271bca365BD8C7f3ABa5754d8B6bE3a` | `0x9cb9dc9f0b37df875bef1a485c809050e67f8c39eb22903e706f4b41b17710fd` | 572,704   |
| `AaveV3LendingAdapter` (fixture market)        | `0x7816dBddf238711e60a08Fa11B05F9A7E6ef6E06` | `0xbc8a0dca19f2ffc948f194b2c18caa10e638ddae2139be13b0e9703e336aec85` | 1,953,801 |
| `BastionEmergencyControl`                      | `0xA1031F6aB2dd3AB0782FAf324F200dDf3F6E8366` | `0x8a45796967c97295da1e837f9b1bcea7a1e0ef1640e99a24ab3430ff60c93cc8` | 595,217   |
| `BastionPolicyRegistry`                        | `0x04bb6E0C86e4Ab79B7761d0B4961b2Ff612A8899` | `0x8ab47ebb4a086fa6927825966f1e3bdcff7813a877ded1bf49d8ce664e9b00b9` | 2,449,149 |
| `RescueSettlementLedger`                       | `0x36AD6CB90BbAe8053c435Fea829883199131ce9b` | `0x1cf0d3ee7d40cc26e4e7281ea837fb4fbce2a30f8902402edba84956a529c90f` | 1,167,095 |
| `RescueReceiptRegistry`                        | `0xc3DD025C323b04e67EEbf7385e403e83f407A377` | `0xb3f8f58030c4966f4db06b8f9e601af24a28a43dff417fea4649ce4136c6368e` | 647,098   |
| `SolverRegistry`                               | `0xdF5009d0fba4C252C6Bb4c18d2A089A453d0b36A` | `0x6782d70b870f95802bb302b33e5af169b79d44c3c2f7ea3234bdbc9c9fccdd64` | 1,295,862 |
| `SolverLiquidityVault`                         | `0x4c8812Fa826C3c8DD64bD20A99fb226c8193d0e2` | `0xbac1a20927a2cffad7ce5a789c0f00911064341e14edb14d2eefaa2031b5303f` | 1,409,822 |
| `SolverQuoteManager`                           | `0x0F38194E9403f5210bFCf668c1816183eFdCF774` | `0x8743a4bd04303e229c6593cc868b8c4b890dbddcb9e12b1bc70f96b0ab52787e` | 693,816   |
| `SolverRescueExecutor`                         | `0x667C527856bF7BE3Af2034270240aAf5F232Ec1D` | `0x0d3e6ce13649e5818c27e97523006ddec5c337f328be6c37f884abcf21505d7b` | 1,927,715 |
| `FlashRescueExecutor`                          | `0x32ea881c8957A762547cf80F564B6A61F5704F7f` | `0x20b47e62c56fead22b808b90f838055d7addeb056a7d4db4d108f97b33c09277` | 2,389,292 |
| `BastionRiskObserver`                          | `0xAFC143C2e37b18Ee0C015d24C952a919EA47e05D` | `0xd89c9f1b3093a7580db4b5e1ccef6e5eb79b571bc4e56f41d11fd1a28c7250b6` | 393,187   |
| `BastionCallbackRouter`                        | `0x981284cFc15fDe09C4401874091871c8E24C0e8e` | `0x27b691a9a4bc370245ed614fbd8c1a378d4ffb48cee587278f1cc7f220f4b051` | 1,717,736 |

Router funding 0.001 ETH: `0x25793b31b032ce180f69eaf9f06b049e83860d715b5d02f7dce9778e9a6d1581`. The wiring calls
(executors, router, ledger writer, adapters, collateral operator, swap venue) are in the broadcast record, all status 1.
Note: the official-pool adapter shares the Lasna core's address because both were the deployer's nonce-0 CREATE.
Reads (`evidence/deployments/base-sepolia/destination-reads.txt`): code at every address; router `rvm` sender = Lasna
core, service provider = official Base callback proxy, `DEST_CHAIN_ID` 84532; executors, adapters, ledger writer and
venue all wired as expected.

## Unichain Sepolia (chain 1301)

`DeployUnichainSepolia.s.sol` with `DEPLOY_FIXTURE_RESERVE_TOKEN=true`, `DEST_SOLVER_EXECUTOR` = Base
`SolverRescueExecutor`, `CALLBACK_FUNDING_WEI=2e15`. Simulated first (4,665,997 gas est.). 8 transactions, all status
1, blocks 68480136–68480159, 2026-11-22 12:59:24–12:59:47 IST. Fees 0.000001787304088267 ETH (incl. 13,666 wei L1
data) plus 0.002 ETH funding the escrow's callback debt. Receipts: `evidence/deployments/unichain-sepolia/transactions.json`.

| Contract / call                              | Address                                      | Tx                                                                   | Gas       |
| -------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------- | --------- |
| `BastionEmergencyControl`                    | `0x811111D0a5DaBBD16180Ba42d11992863EF17e33` | `0xc1ed3b6eb8ec0b18af8089d6c4482fafd78d590e46ee8a2713cb9ebc8fcf0436` | 595,217   |
| `BastionProtectionVault`                     | `0xa196d20cc969Df5A4c7df5034A84e240dA7Cb943` | `0xae75b65b28e68063eeb9d7b01b553138e4e85f3c379d9f59978367e646d3a9ce` | 1,239,816 |
| `CrossChainReserveEscrow`                    | `0x0d37C05cfcbdcfDEF31350b7373b97c9234ccaaC` | `0x1a72737aab18093c2924364ffdefbdb21887f5272cf6a72ba90f9b500e699214` | 940,696   |
| `vault.setSettler(escrow, true)`             |                                              | `0xcd06a713e4094c1650405a2c59830deaf16d4e8e44ab23d599c1ca8afb54597b` | 47,811    |
| FIXTURE `frUSDC`                             | `0x8818ADCcA7EFb0C9Aaba043025EB8a886E6Bd7eF` | `0x5e667573fad43636ca10ea32f25ffb103e88514c09d890ffd70084240d05945f` | 633,642   |
| `vault.setSupportedToken(frUSDC, true)`      |                                              | `0x3171e34ce51c5ae8a50b5fef22542ba04ea622b1514fb19ca4171e5ae59da120` | 48,056    |
| `escrow.setTrustedExecutor(84532, executor)` |                                              | `0x923cf86bfc2c09690aa28ee82d4a936c8896d989973259e2888931a8fdb4f76d` | 48,296    |
| Fund escrow 0.002 ETH                        |                                              | `0xeda34dc378ba670d0e9c6393d09cc432580ee196b822b9e4ac56874a209411ea` | 21,067    |

Reads (`evidence/deployments/unichain-sepolia/reserve-reads.txt`): code present; `escrow.VAULT` = vault;
`trustedExecutor(84532, SolverRescueExecutor)` = true; `vault.isSettler(escrow)` = true; frUSDC supported; release
delay 3,600 s; escrow balance 0.002 ETH.

## Not yet verified live

- **Solver path and the second cycle** (`SolverRescueExecuted` → Unichain `settleRescue` → `ReimbursementCompleted` →
  Base `onSettlementAck`). The sources and destinations are configured and subscribed, but no solver rescue has run on
  testnet: it needs a separate solver account (registration bond, committed fUSDC liquidity) and a funded frUSDC reserve
  budget on Unichain. The full two-cycle loop is covered by the local simulation only.
- The official Aave V3 adapter is deployed and wired but has not executed a live rescue (no Base Sepolia Aave position).
- Block-explorer source verification has not been submitted.
