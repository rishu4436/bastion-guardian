import type { Address } from "viem";
import type { LocalDeployment } from "@bastion-guardian/contracts";
import type { IndexedContract } from "./contracts.js";

/** Contracts to index for the local simulation stack (destination + reserve on the same chain 31337). */
export function localContracts(a: LocalDeployment): IndexedContract[] {
  const pick = (name: IndexedContract["name"], address: Address): IndexedContract => ({ name, address });
  return [
    pick("policyRegistry", a.policyRegistry),
    pick("riskObserver", a.riskObserver),
    pick("callbackRouter", a.callbackRouter),
    pick("ledger", a.ledger),
    pick("receipts", a.receipts),
    pick("solverRescueExecutor", a.solverRescueExecutor),
    pick("flashRescueExecutor", a.flashRescueExecutor),
    pick("solverRegistry", a.solverRegistry),
    pick("solverLiquidityVault", a.solverLiquidityVault),
    pick("reserveEscrow", a.reserveEscrow),
    pick("protectionVault", a.protectionVault),
  ];
}
