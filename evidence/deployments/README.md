# deployments

Real, verifiable testnet artifacts only. Summary and explanation: `docs/integrations/TESTNET-DEPLOYMENTS.md`.

- `lasna/`: core deploy broadcast record, post-deploy reads, configuration receipts (`transactions.json`) and reads.
- `base-sepolia/`: destination-stack broadcast record, deployment JSON and wiring reads.
- `unichain-sepolia/`: reserve-stack receipts (`transactions.json`) and reads.
- `live-rescue-loop/`: live flash-rescue setup broadcast record, the 4 loop receipts, the callback receipt and pre/post reads.
- `live-solver-loop/`: solver-path setup broadcast records (3 steps), the 9 loop receipts and pre/post reads.

Source verification status: `evidence/verification/explorer-verification.txt`.

`transactions.json` files were rebuilt from `cast receipt` because the forge broadcast records for those steps were
lost from the build box filesystem. The on-chain receipts are the authoritative record.
