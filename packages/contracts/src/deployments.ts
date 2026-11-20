import { readFileSync } from "node:fs";
import { z } from "zod";

const Addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/) as unknown as z.ZodType<`0x${string}`>;
const B32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/) as unknown as z.ZodType<`0x${string}`>;

/**
 * Addresses written by contracts/script/LocalSimulationDeploy.s.sol. LOCAL ANVIL SIMULATION only: every address in
 * this object exists on a developer's local chain 31337 and nowhere else.
 */
export const LocalDeploymentSchema = z.object({
  label: z.string(),
  chainId: z.number().int(),
  systemContract: Addr,
  destCallbackProxy: Addr,
  reserveCallbackProxy: Addr,
  reactiveCore: Addr,
  emergency: Addr,
  policyRegistry: Addr,
  ledger: Addr,
  receipts: Addr,
  solverRegistry: Addr,
  solverLiquidityVault: Addr,
  solverQuoteManager: Addr,
  solverRescueExecutor: Addr,
  flashRescueExecutor: Addr,
  riskObserver: Addr,
  callbackRouter: Addr,
  protectionVault: Addr,
  reserveEscrow: Addr,
  fixtureMarket: Addr,
  fixtureOracle: Addr,
  fixtureVenue: Addr,
  fixtureAdapter: Addr,
  fUSDC: Addr,
  fWETH: Addr,
  frUSDC: Addr,
  gov: Addr,
  borrowerA: Addr,
  borrowerB: Addr,
  solver: Addr,
  solverPayout: Addr,
  commitmentId: B32,
  policyA: B32,
  policyAVersion: z.number().int(),
  policyB: B32,
  policyBVersion: z.number().int(),
});
export type LocalDeployment = z.infer<typeof LocalDeploymentSchema>;

export function parseLocalDeployment(json: unknown): LocalDeployment {
  const parsed = LocalDeploymentSchema.parse(json);
  if (parsed.chainId !== 31337) throw new Error(`local deployment must be chain 31337, got ${parsed.chainId}`);
  return parsed;
}

export function loadLocalDeployment(path: string): LocalDeployment {
  return parseLocalDeployment(JSON.parse(readFileSync(path, "utf8")));
}
