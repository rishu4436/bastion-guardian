import { sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { chains, protocols, tokens } from "./schema.js";

/**
 * Reference data that is true regardless of deployment state: the three target networks, the official Aave V3
 * Base Sepolia market (status `configured`, NOT `live`, until BASTION's adapter is deployed and verified there), and
 * the Aave test tokens verified on-chain (docs/integrations/VERIFIED-ADDRESSES.md).
 */
export async function seedReferenceData(db: Database): Promise<void> {
  await db
    .insert(chains)
    .values([
      {
        chainId: 84532,
        name: "Base Sepolia",
        role: "destination",
        isTestnet: true,
        explorerUrl: "https://sepolia.basescan.org",
        finalityDepth: 10,
      },
      {
        chainId: 1301,
        name: "Unichain Sepolia",
        role: "reserve",
        isTestnet: true,
        explorerUrl: "https://sepolia.uniscan.xyz",
        finalityDepth: 10,
      },
      {
        chainId: 5318007,
        name: "Reactive Lasna",
        role: "reactive",
        isTestnet: true,
        explorerUrl: "https://lasna.reactscan.net",
        finalityDepth: 1,
      },
    ])
    .onConflictDoNothing();
  await db
    .insert(protocols)
    .values({
      id: "aave-v3-base-sepolia",
      name: "Aave V3 (Base Sepolia)",
      chainId: 84532,
      kind: "official",
      poolAddress: "0x8bab6d1b75f19e9ed9fce8b9bd338844ff79ae27",
      status: "configured",
      sourceUrl:
        "https://github.com/aave-dao/aave-address-book/blob/6e0327854db38052b8f5d8962185b96b95c10d3d/src/AaveV3BaseSepolia.sol",
    })
    .onConflictDoNothing();
  await db
    .insert(tokens)
    .values([
      { chainId: 84532, address: "0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f", symbol: "USDC", decimals: 6 },
      { chainId: 84532, address: "0x0a215d8ba66387dca84b284d18c3b4ec3de6e54a", symbol: "USDT", decimals: 6 },
      { chainId: 84532, address: "0x54114591963cf60ef3aa63befd6ec263d98145a4", symbol: "WBTC", decimals: 8 },
    ])
    .onConflictDoNothing();
  await db.execute(sql`select 1`);
}
