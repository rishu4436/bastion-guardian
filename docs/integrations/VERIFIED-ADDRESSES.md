# Verified external addresses

Every address BASTION depends on, with its official source and how it was checked. **Verification date: 2026-11-20 (IST).**
This file lists only external dependencies. BASTION's own deployments (currently only `BastionReactiveCore` on Lasna)
are in `docs/integrations/TESTNET-DEPLOYMENTS.md`.

Legend — _Doc_: copied from the official source listed. _On-chain_: additionally confirmed by a live read (`cast call`)
whose raw output is in `evidence/integrations/aave-base-sepolia-reads.txt`.

## Networks

| Network                                 | Chain ID | RPC (public)                   | Check                                                   |
| --------------------------------------- | -------- | ------------------------------ | ------------------------------------------------------- |
| Base Sepolia (destination / lending)    | 84532    | `https://sepolia.base.org`     | `cast chain-id` → 84532; block 61193994 read 2026-11-20 |
| Unichain Sepolia (reserve / settlement) | 1301     | `https://sepolia.unichain.org` | `cast chain-id` → 1301                                  |
| Reactive Lasna (reactive)               | 5318007  | `https://lasna-rpc.rnk.dev/`   | `cast chain-id` → 5318007                               |

Base Sepolia produces ~200 ms blocks; every BASTION timer uses `block.timestamp`, never block counts.

## Reactive Network

Source: https://dev.reactive.network/origins-and-destinations, https://dev.reactive.network/reactive-contracts,
https://dev.reactive.network/callback-contracts. Library: `reactive-lib-omni` v0.1.0 @ `3ade0dcf` (git submodule).

| Item                                     | Address                                                              | Check                                                       |
| ---------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------- |
| Callback Proxy — Base Sepolia            | `0x476F44b11F5C942c58f4c8E3d0300E5710743585`                         | Doc                                                         |
| Callback Proxy — Unichain Sepolia        | `0x775c9B990ADe401060B78D0e98684eEf8d2466C1`                         | Doc                                                         |
| Callback Proxy / System contract — Lasna | `0x8888888888888888888888888888888888888888`                         | Doc; matches `AbstractReactive.SYSTEM` in reactive-lib-omni |
| `REACTIVE_IGNORE` topic                  | `0xa65f96fc951c35ead38878e0f0b7a3c744a6f5ccc1476b313353ce31712313ad` | reactive-lib-omni source                                    |

API facts confirmed from the installed library (not from memory): `react(IReactive.LogRecord calldata)`,
`SYSTEM.subscribe/unsubscribe` with 6 arguments, `requestCallbackV_1_0(CallbackConfiguration_V_1_0{chainId, recipient, gasLimit, payload})`,
callback payload's first argument is an `address(0)` placeholder overwritten with the RVM id, `AbstractCallback(proxy, sender)`
exposes `onlyServiceProvider` / `onlyCallbackSender`. The legacy `reactive-lib` and `reactive-test-lib` target the old
`0x…fffFfF` system address and were **not** used.

## Aave V3 — Base Sepolia (official deployment)

Source: `aave-dao/aave-address-book` @ `6e0327854db38052b8f5d8962185b96b95c10d3d`, `src/AaveV3BaseSepolia.sol`
(https://github.com/aave-dao/aave-address-book/blob/6e0327854db38052b8f5d8962185b96b95c10d3d/src/AaveV3BaseSepolia.sol).

| Contract              | Address                                      | Check                                                         |
| --------------------- | -------------------------------------------- | ------------------------------------------------------------- |
| PoolAddressesProvider | `0xE4C23309117Aa30342BFaae6c95c6478e0A4Ad00` | Doc                                                           |
| Pool                  | `0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27` | On-chain: `POOL_REVISION()`=10, `FLASHLOAN_PREMIUM_TOTAL()`=5 |
| Oracle                | `0x943b0dE18d4abf4eF02A85912F8fc07684C141dF` | On-chain (base unit 1e8; used by fork tests)                  |
| PoolConfigurator      | `0x0Bf6bdFF4da24C272BC524d521Ab0db20601D384` | Doc                                                           |
| ACLManager            | `0x9f09F541Adf314341d8d45E5B18961147b9050E9` | Doc                                                           |
| PoolDataProvider      | `0xBc9f5b7E248451CdD7cA54e717a2BFe1F32b566b` | Doc                                                           |
| UiPoolDataProvider    | `0x3cB7B00B6C09B71998124196691e8bF2694De863` | Doc                                                           |
| WETH Gateway          | `0x0568130e794429D2eEBC4dafE18f25Ff1a1ed8b6` | Doc                                                           |
| FlashLoanLogic        | `0xE66AdcF153d0bD67a74e5d23e23F90b4011024EC` | Doc                                                           |

### Reserves (all confirmed on-chain via `Pool.getReserveAToken` / `getReserveVariableDebtToken` / `decimals()`)

| Asset            | Underlying                                   | Dec | aToken                                       | Variable debt token                          |
| ---------------- | -------------------------------------------- | --- | -------------------------------------------- | -------------------------------------------- |
| USDC (Aave test) | `0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f` | 6   | `0x10F1A9D11CDf50041f3f8cB7191CBE2f31750ACC` | `0xFB3e85601b7fEb3691bbb8779Ef0E1069E347204` |
| USDT             | `0x0a215D8ba66387DCA84B284D18c3B4ec3de6E54a` | 6   | `0xcE3CAae5Ed17A7AafCEEbc897DE843fA6CC0c018` | `0xE3C742c88EE6A610157C16b60bBDD62351daeE39` |
| WBTC             | `0x54114591963CF60EF3aA63bEfD6eC263D98145a4` | 8   | `0x47Db195BAf46898302C06c31bCF46c01C64ACcF9` | `0x638291B5Ccb9fEd339FdD351Eb086e607fCA9561` |
| WETH             | `0x4200000000000000000000000000000000000006` | 18  | `0x73a5bB60b0B0fc35710DDc0ea9c407031E31Bdbb` | `0x562abf6562d6A2b165aDa02b5946bc3E7b4dD653` |
| cbETH            | `0xD171b9694f7A2597Ed006D41f7509aaD4B485c4B` | 18  | `0x9Fd6d1DBAd7c052e0c43f46df36eEc6a68814B63` | `0xa1a483652b157FF006292CDb0e9EB7FFad2a5142` |
| LINK             | `0x810D46F9a9027E28F9B01F75E2bdde839dA61115` | 18  | `0x0aD46dE765522399d7b25B438b230A894d72272B` | `0xBA42C6752F347e3c22DD0A4e5578dCB0137C1325` |

WETH reserve configuration read on-chain: LTV 83.50%, liquidation threshold 85.00%, liquidation bonus 103%, active,
borrowing enabled, flash-loan enabled. E-mode category 1 = WETH/cbETH. Pool liquidity observed ≈ 643 WETH and ≈ 61M aUSDC.

The three fork tests in `contracts/test/fork/AaveV3BaseSepoliaFork.t.sol` execute solver and flash rescues **against
these real contracts on a local fork** (block 61193053). Output: `evidence/benchmark-results/fork-aave-base-sepolia-tests.txt`.
A fork test is not a testnet deployment.

## Uniswap — Base Sepolia

Sources: https://docs.uniswap.org/contracts/v3/reference/deployments/base-deployments, https://docs.uniswap.org/contracts/v4/deployments

| Contract                      | Address                                      |
| ----------------------------- | -------------------------------------------- |
| v3 Factory                    | `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` |
| v3 SwapRouter02               | `0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4` |
| v3 QuoterV2                   | `0xC5290058841028F1614F3A6F0F5816cAd0df5E27` |
| v3 NonfungiblePositionManager | `0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2` |
| UniversalRouter               | `0x492E6456D9528771018DeB9E87ef7750EF184104` |
| Permit2                       | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| v4 PoolManager                | `0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408` |
| v4 PositionManager            | `0x4b2c77d209d3405f41a037ec6c77f7f5b8e2ca80` |
| v4 Quoter                     | `0x5e6B8B8AFA7e5CEF6C09dd2A67aBA9FB12C75623` |
| v4 StateView                  | `0x571291b572ed32ce6751a2cb2486ebee8defb9b4` |
| v4 PoolSwapTest               | `0x8b5bcc363dde2614281ad875bad385e0a785d3b9` |

v3 WETH / Aave-USDC pools found on-chain (factory `getPool`): 0.30% `0x92266210FacF124f190fbad79AA230dfB85926Ce`
(≈ 673.8 USDC of liquidity) and 0.05% `0x9d9203f8a29c600D567b240692DB569B77D1F4A9` (≈ 0.0096 USDC). **This liquidity is too
thin for a meaningful flash-deleverage swap**, so local demos use `FixtureSwapVenue` (clearly labeled fixture). A Uniswap
venue adapter is a Phase 3+ item.

## Uniswap — Unichain Sepolia (v4)

Source: https://docs.uniswap.org/contracts/v4/deployments

| Contract         | Address                                      |
| ---------------- | -------------------------------------------- |
| PoolManager      | `0x00b036b58a818b1bc34d502d3fe730db729e62ac` |
| Universal Router | `0xf70536b3bcc1bd1a972dc186a2cf84cc6da6be5d` |
| PositionManager  | `0xf969aee60879c54baaed9f3ed26147db216fd664` |
| Quoter           | `0x572B9cDBcd8c2b8F3Fe849B9d250F35284455d7f` |
| StateView        | `0xc199f1072a74d4e905aba1a84d9a45e2546b6222` |

## Fixtures (never presented as real protocols)

`FixtureLendingMarket`, `FixtureOracle`, `FixtureSwapVenue`, `FixtureToken` live in `contracts/src/fixtures/` and are
labeled **"NOT AAVE" / test fixture** in source, UI (`provenance: FIXTURE`) and docs. They exist so the full loop can be
demonstrated deterministically; the Aave adapter is exercised against the real Aave V3 Base Sepolia pool on a fork.
