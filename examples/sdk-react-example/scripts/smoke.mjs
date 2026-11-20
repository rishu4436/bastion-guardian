// Proves the packed SDK resolves on its own: no @bastion-guardian/* workspace dependency leaks into the tarball.
import { readFileSync } from "node:fs";
import { BastionClient, policyIdOf, parseSse, CHAINS } from "@bastion-guardian/sdk";
import { ProtectWithBastion, useProtectionStatus, protectUrl } from "@bastion-guardian/sdk/react";

const pkg = JSON.parse(
  readFileSync(new URL("../node_modules/@bastion-guardian/sdk/package.json", import.meta.url)),
);
const deps = Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies });
const leaked = deps.filter((d) => d.startsWith("@bastion-guardian/"));
if (leaked.length) throw new Error(`workspace packages leaked into the published SDK: ${leaked}`);
for (const [name, v] of Object.entries({
  BastionClient,
  policyIdOf,
  parseSse,
  ProtectWithBastion,
  useProtectionStatus,
  protectUrl,
}))
  if (typeof v !== "function") throw new Error(`${name} missing from the published SDK`);
if (!CHAINS[84532]) throw new Error("chain registry not bundled");
console.log(`smoke ok: @bastion-guardian/sdk@${pkg.version} deps=[${deps.join(", ")}]`);
