# Local simulation evidence (anvil, chain 31337)

**These files are NOT testnet evidence.** They come from `contracts/script/local-e2e.sh`, which deploys the full
BASTION stack into a single local anvil chain (31337), installs the Omni-compatible `MockReactiveSystem` at
`0x8888…8888`, and uses `tools/local-e2e` as a stand-in for Reactive Lasna (it impersonates the system contract to call
`BastionReactiveCore.react` and delivers callbacks through the local `MockCallbackProxy`). Transaction hashes exist only
on that ephemeral local chain. Wall-clock timings are one machine talking to itself and say nothing about network latency.

| File                           | Contents                                                                   |
| ------------------------------ | -------------------------------------------------------------------------- |
| `addresses-2026-11-20.json`    | local addresses written by `LocalSimulationDeploy.s.sol`                   |
| `e2e-run-2026-11-20.json`      | per-cycle origin → react → callback tx hashes, debt/HF deltas, safety runs |

Reproduce: `contracts/script/local-e2e.sh` (needs Foundry, Node 24, pnpm; starts its own anvil on 127.0.0.1:8645).
