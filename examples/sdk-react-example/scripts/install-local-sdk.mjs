// Packs packages/sdk exactly as it would be published and installs the tarball here, so this app only sees the
// public package surface (dist + package.json), never workspace sources. Run `pnpm --filter @bastion-guardian/sdk build` first.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const here = resolve(import.meta.dirname, "..");
const sdk = resolve(here, "../../packages/sdk");
const dest = join(here, ".sdk");
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest);
execFileSync("pnpm", ["pack", "--pack-destination", dest], { cwd: sdk, stdio: "inherit" });
const tgz = readdirSync(dest).find((f) => f.endsWith(".tgz"));
if (!tgz) throw new Error("pnpm pack produced no tarball");
execFileSync("npm", ["install", "--no-save", "--no-audit", "--no-fund", join(dest, tgz)], {
  cwd: here,
  stdio: "inherit",
});
console.log(`installed ${tgz}`);
