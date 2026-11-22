import { TESTNET_DEPLOYER, TESTNET_DEPLOYMENTS } from "@bastion-guardian/chain-registry";
import { closeDatabase, createDatabase, recordTestnetDeployments } from "@bastion-guardian/db";

/** Records the real testnet deployments in the API database (`pnpm --filter @bastion-guardian/api db:seed-testnet`). */
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const db = createDatabase(url, { max: 1 });
const n = await recordTestnetDeployments(db, TESTNET_DEPLOYMENTS, TESTNET_DEPLOYER);
await closeDatabase(db);
console.log(`recorded ${n} testnet deployments`);
