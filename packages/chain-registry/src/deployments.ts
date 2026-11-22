import type { Address, SupportedChainId } from "@bastion-guardian/types";

/**
 * BASTION testnet deployments, copied from on-chain receipts recorded under `evidence/deployments/` (see
 * docs/integrations/TESTNET-DEPLOYMENTS.md). Every entry has a real creation transaction with status 1 and a
 * follow-up on-chain read. `fixture: true` marks the labeled BASTION test fixtures (owner-mintable tokens, fixture
 * oracle/market/venue and the adapter bound to the fixture market): they are NOT real assets or official protocols.
 * Mainnet is intentionally absent.
 */
export interface TestnetDeployment {
  chainId: SupportedChainId;
  /** Stable key used by the API's deployment registry (`/v1/deployments`). */
  key: string;
  /** Solidity contract name. */
  contract: string;
  address: Address;
  txHash: `0x${string}`;
  block: number;
  fixture: boolean;
  /** Source verification that actually succeeded (keyless verifiers only). */
  verifiedOn: readonly ("sourcify" | "blockscout")[];
}

export const TESTNET_DEPLOYER: Address = "0xED64A84B841E8fFeFFd5670cf627984332b3835F";

const SV = ["sourcify", "blockscout"] as const;
const S = ["sourcify"] as const;

export const TESTNET_DEPLOYMENTS: readonly TestnetDeployment[] = [
  // Reactive Lasna (5318007)
  {
    chainId: 5318007,
    key: "reactiveCore",
    contract: "BastionReactiveCore",
    address: "0x811111D0a5DaBBD16180Ba42d11992863EF17e33",
    txHash: "0x25752e84a0e1f135b16e30a67a791e1eca91deedeee9da0a309a7d164d3128b7",
    block: 8944427,
    fixture: false,
    verifiedOn: S,
  },
  // Base Sepolia (84532): destination stack
  {
    chainId: 84532,
    key: "aaveV3Adapter",
    contract: "AaveV3LendingAdapter",
    address: "0x811111D0a5DaBBD16180Ba42d11992863EF17e33",
    txHash: "0xe5927822d096636d5b96f0c885787892c7d4f41f981415068b917e26dfc5d4b4",
    block: 62051212,
    fixture: false,
    verifiedOn: SV,
  },
  {
    chainId: 84532,
    key: "fUSDC",
    contract: "FixtureToken",
    address: "0xa196d20cc969Df5A4c7df5034A84e240dA7Cb943",
    txHash: "0x16a8be74134b12f879d970642e70e3c01f3b7d4dffbd87e9758c86664ff8bc9e",
    block: 62051222,
    fixture: true,
    verifiedOn: SV,
  },
  {
    chainId: 84532,
    key: "fWETH",
    contract: "FixtureToken",
    address: "0x0d37C05cfcbdcfDEF31350b7373b97c9234ccaaC",
    txHash: "0x48b4e5056a4a4a50a1ce58ea265b5240438bd5b8dfccf29fc4249cdc934f463d",
    block: 62051231,
    fixture: true,
    verifiedOn: SV,
  },
  {
    chainId: 84532,
    key: "fixtureOracle",
    contract: "FixtureOracle",
    address: "0xB3F36cb93f8C2102a65cF34Ec0783b4181715f7F",
    txHash: "0xa5a391a6e2aeadb49a15ef90e4a0121a12fc66b91bc92832132dc21c4fa2da64",
    block: 62051241,
    fixture: true,
    verifiedOn: SV,
  },
  {
    chainId: 84532,
    key: "fixtureMarket",
    contract: "FixtureLendingMarket",
    address: "0xB7f24A2f3B1705F8cd3D1cf561795D7a28eC91d5",
    txHash: "0xafc6598e6e58ba4d5a2e3d17abcb2e09265892e78f17b069c7cbf0b17cd4bca1",
    block: 62051268,
    fixture: true,
    verifiedOn: SV,
  },
  {
    chainId: 84532,
    key: "fixtureVenue",
    contract: "FixtureSwapVenue",
    address: "0x16d979309271bca365BD8C7f3ABa5754d8B6bE3a",
    txHash: "0x9cb9dc9f0b37df875bef1a485c809050e67f8c39eb22903e706f4b41b17710fd",
    block: 62051295,
    fixture: true,
    verifiedOn: SV,
  },
  {
    chainId: 84532,
    key: "fixtureAdapter",
    contract: "AaveV3LendingAdapter",
    address: "0x7816dBddf238711e60a08Fa11B05F9A7E6ef6E06",
    txHash: "0xbc8a0dca19f2ffc948f194b2c18caa10e638ddae2139be13b0e9703e336aec85",
    block: 62051313,
    fixture: true,
    verifiedOn: SV,
  },
  {
    chainId: 84532,
    key: "emergency",
    contract: "BastionEmergencyControl",
    address: "0xA1031F6aB2dd3AB0782FAf324F200dDf3F6E8366",
    txHash: "0x8a45796967c97295da1e837f9b1bcea7a1e0ef1640e99a24ab3430ff60c93cc8",
    block: 62051322,
    fixture: false,
    verifiedOn: SV,
  },
  {
    chainId: 84532,
    key: "policyRegistry",
    contract: "BastionPolicyRegistry",
    address: "0x04bb6E0C86e4Ab79B7761d0B4961b2Ff612A8899",
    txHash: "0x8ab47ebb4a086fa6927825966f1e3bdcff7813a877ded1bf49d8ce664e9b00b9",
    block: 62051331,
    fixture: false,
    verifiedOn: SV,
  },
  {
    chainId: 84532,
    key: "ledger",
    contract: "RescueSettlementLedger",
    address: "0x36AD6CB90BbAe8053c435Fea829883199131ce9b",
    txHash: "0x1cf0d3ee7d40cc26e4e7281ea837fb4fbce2a30f8902402edba84956a529c90f",
    block: 62051340,
    fixture: false,
    verifiedOn: SV,
  },
  {
    chainId: 84532,
    key: "receipts",
    contract: "RescueReceiptRegistry",
    address: "0xc3DD025C323b04e67EEbf7385e403e83f407A377",
    txHash: "0xb3f8f58030c4966f4db06b8f9e601af24a28a43dff417fea4649ce4136c6368e",
    block: 62051349,
    fixture: false,
    verifiedOn: SV,
  },
  {
    chainId: 84532,
    key: "solverRegistry",
    contract: "SolverRegistry",
    address: "0xdF5009d0fba4C252C6Bb4c18d2A089A453d0b36A",
    txHash: "0x6782d70b870f95802bb302b33e5af169b79d44c3c2f7ea3234bdbc9c9fccdd64",
    block: 62051358,
    fixture: false,
    verifiedOn: SV,
  },
  {
    chainId: 84532,
    key: "solverLiquidityVault",
    contract: "SolverLiquidityVault",
    address: "0x4c8812Fa826C3c8DD64bD20A99fb226c8193d0e2",
    txHash: "0xbac1a20927a2cffad7ce5a789c0f00911064341e14edb14d2eefaa2031b5303f",
    block: 62051367,
    fixture: false,
    verifiedOn: SV,
  },
  {
    chainId: 84532,
    key: "solverQuoteManager",
    contract: "SolverQuoteManager",
    address: "0x0F38194E9403f5210bFCf668c1816183eFdCF774",
    txHash: "0x8743a4bd04303e229c6593cc868b8c4b890dbddcb9e12b1bc70f96b0ab52787e",
    block: 62051385,
    fixture: false,
    verifiedOn: SV,
  },
  {
    chainId: 84532,
    key: "solverRescueExecutor",
    contract: "SolverRescueExecutor",
    address: "0x667C527856bF7BE3Af2034270240aAf5F232Ec1D",
    txHash: "0x0d3e6ce13649e5818c27e97523006ddec5c337f328be6c37f884abcf21505d7b",
    block: 62051395,
    fixture: false,
    verifiedOn: SV,
  },
  {
    chainId: 84532,
    key: "flashRescueExecutor",
    contract: "FlashRescueExecutor",
    address: "0x32ea881c8957A762547cf80F564B6A61F5704F7f",
    txHash: "0x20b47e62c56fead22b808b90f838055d7addeb056a7d4db4d108f97b33c09277",
    block: 62051404,
    fixture: false,
    verifiedOn: SV,
  },
  {
    chainId: 84532,
    key: "riskObserver",
    contract: "BastionRiskObserver",
    address: "0xAFC143C2e37b18Ee0C015d24C952a919EA47e05D",
    txHash: "0xd89c9f1b3093a7580db4b5e1ccef6e5eb79b571bc4e56f41d11fd1a28c7250b6",
    block: 62051413,
    fixture: false,
    verifiedOn: SV,
  },
  {
    chainId: 84532,
    key: "callbackRouter",
    contract: "BastionCallbackRouter",
    address: "0x981284cFc15fDe09C4401874091871c8E24C0e8e",
    txHash: "0x27b691a9a4bc370245ed614fbd8c1a378d4ffb48cee587278f1cc7f220f4b051",
    block: 62051422,
    fixture: false,
    verifiedOn: SV,
  },
  // Unichain Sepolia (1301): reserve stack
  {
    chainId: 1301,
    key: "emergency",
    contract: "BastionEmergencyControl",
    address: "0x811111D0a5DaBBD16180Ba42d11992863EF17e33",
    txHash: "0xc1ed3b6eb8ec0b18af8089d6c4482fafd78d590e46ee8a2713cb9ebc8fcf0436",
    block: 68480136,
    fixture: false,
    verifiedOn: SV,
  },
  {
    chainId: 1301,
    key: "protectionVault",
    contract: "BastionProtectionVault",
    address: "0xa196d20cc969Df5A4c7df5034A84e240dA7Cb943",
    txHash: "0xae75b65b28e68063eeb9d7b01b553138e4e85f3c379d9f59978367e646d3a9ce",
    block: 68480140,
    fixture: false,
    verifiedOn: SV,
  },
  {
    chainId: 1301,
    key: "reserveEscrow",
    contract: "CrossChainReserveEscrow",
    address: "0x0d37C05cfcbdcfDEF31350b7373b97c9234ccaaC",
    txHash: "0x1a72737aab18093c2924364ffdefbdb21887f5272cf6a72ba90f9b500e699214",
    block: 68480143,
    fixture: false,
    verifiedOn: SV,
  },
  {
    chainId: 1301,
    key: "frUSDC",
    contract: "FixtureToken",
    address: "0x8818ADCcA7EFb0C9Aaba043025EB8a886E6Bd7eF",
    txHash: "0x5e667573fad43636ca10ea32f25ffb103e88514c09d890ffd70084240d05945f",
    block: 68480149,
    fixture: true,
    verifiedOn: SV,
  },
];
