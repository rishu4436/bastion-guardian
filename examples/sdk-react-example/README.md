# SDK React example (independent app)

A stand-alone Vite + React "lending app" that embeds BASTION Guardian through the **published surface** of
`@bastion-guardian/sdk`. It is deliberately **not** a pnpm workspace member: it installs the SDK from the tarball that
`pnpm pack` produces, so it can only use what an external integrator would get from npm.

```bash
pnpm --filter @bastion-guardian/sdk build      # from the repo root
cd examples/sdk-react-example
npm install
npm run sdk:local                              # pack packages/sdk and install the tarball here
npm run smoke                                  # asserts no @bastion-guardian/* workspace dep leaked into the package
npm run typecheck && npm run build
VITE_BASTION_API_URL=http://127.0.0.1:4000 VITE_BASTION_APP_URL=http://localhost:3000 npm run dev
```

What it shows: `<ProtectWithBastion>` (live status or a deep link to the policy wizard), `useBastionPositions`,
`useProtectionStatus`, `useRescueHistory` with loading / empty / error / stale states, and Proof of Protection PDF links.
Against the local stack every value is LOCAL SIMULATION data and the embed shows a `LOCAL SIM` badge.
