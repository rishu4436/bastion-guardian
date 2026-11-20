import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { baseSepolia, foundry, unichainSepolia } from "viem/chains";

/** Testnets + the local simulation chain only. Mainnet is intentionally absent (disabled by default). */
export const wagmiConfig = createConfig({
  chains: [foundry, baseSepolia, unichainSepolia],
  connectors: [injected()],
  transports: {
    [foundry.id]: http("http://127.0.0.1:8645"),
    [baseSepolia.id]: http(),
    [unichainSepolia.id]: http(),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
