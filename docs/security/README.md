# Security

- Threat model and risk register: `THREAT-MODEL.md` (repo root).
- Static analysis: `evidence/security/SLITHER-TRIAGE.md` (Slither findings with triage).
- Incident handling: `docs/operations/INCIDENT-RESPONSE.md`.

Standing rules: no custody of user collateral; every rescue is bounded by an EIP-712-signed on-chain policy; mainnet
disabled; deploy scripts refuse unlisted chains and public broadcasts without explicit authorization; keys live only in
encrypted keystores or the user's wallet and are never committed; the API never signs or sends transactions.

**Not production-security-reviewed.** No independent audit has been performed.
