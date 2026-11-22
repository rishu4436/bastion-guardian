import {
  createTestDatabase,
  probePostgres,
  recordDeployments,
  seedLocalSimulation,
  type TestDatabase,
} from "@bastion-guardian/db";
import { startLocalStack, type LocalStack } from "@bastion/local-e2e";
import { ChainIndexer, localContracts } from "@bastion-guardian/chain-indexer";

export interface TestEnv {
  stack: LocalStack;
  db: TestDatabase["db"];
  dbUrl: string;
  indexer: ChainIndexer;
  /** Crash fWETH to `price`, observe both policies, relay rescues and the settlement round-trip, then index. */
  crashAndRescue(price?: bigint): Promise<void>;
  close(): Promise<void>;
}

export { probePostgres };

export async function createTestEnv(adminUrl: string): Promise<TestEnv> {
  const [stack, t] = await Promise.all([startLocalStack(), createTestDatabase(adminUrl)]);
  await seedLocalSimulation(t.db, {
    fixtureMarket: stack.addresses.fixtureMarket,
    tokens: [
      { address: stack.addresses.fUSDC, symbol: "fUSDC", decimals: 6 },
      { address: stack.addresses.fWETH, symbol: "fWETH", decimals: 18 },
      { address: stack.addresses.frUSDC, symbol: "frUSDC", decimals: 6 },
    ],
  });
  await recordDeployments(t.db, 31337, stack.addresses, "local_simulation");
  const indexer = new ChainIndexer(t.db, stack.public, {
    chainId: 31337,
    contracts: localContracts(stack.addresses),
    startBlock: 0n,
    batchSize: 100n,
    reserveChainId: 31337,
  });
  await indexer.catchUp();
  return {
    stack,
    db: t.db,
    dbUrl: t.url,
    indexer,
    async crashAndRescue(price = 1800n * 10n ** 8n) {
      const from = (await stack.public.getBlockNumber()) + 1n;
      await stack.setWethPrice(price);
      await stack.observe(stack.addresses.policyA);
      await stack.observe(stack.addresses.policyB);
      // Each relay pass delivers callbacks whose own logs land in later blocks: risk → settle → acknowledge.
      let lo = from;
      for (let pass = 0; pass < 3; pass++) {
        const hi = await stack.public.getBlockNumber();
        if (lo > hi) break;
        await stack.relayRange(lo, hi);
        lo = hi + 1n;
      }
      await indexer.catchUp();
    },
    async close() {
      await stack.stop();
      await t.drop();
    },
  };
}
