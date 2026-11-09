/**
 * Sui Mainnet constants. Every value was read live from Mainnet on 2026-11-09 (docs/RESEARCH.md
 * 1.1, 1.6 and 3, plus the fixtures in packages/chain/fixtures). Pure data, safe in the browser.
 */

export const SUI_NETWORK = 'mainnet';

export const MEMWAL_PACKAGE_ID = '0xe7c16fbea0560e7057e2bf7422feaa4fb313749fc69c9e9092fac7a33b81d7f5';
export const MEMWAL_REGISTRY_ID = '0x8bf82c9e09e36b8d1c38298f68b7cb68e7b8762887e7592add9986d5e9cf199f';
/** `AccountRegistry.accounts`, a `Table<address, ID>` keyed by owner address. */
export const MEMWAL_ACCOUNTS_TABLE_ID = '0xcfe04623a8c72ede45fc02babcb9711625df8549e53d3107d507efa696d5efde';
export const MEMWAL_ACCOUNT_TYPE = `${MEMWAL_PACKAGE_ID}::account::MemWalAccount`;
export const MEMWAL_MAX_DELEGATE_KEYS = 20;
export const MEMWAL_MAX_LABEL_BYTES = 64;

export const SUI_CLOCK_ID = '0x6';

export const USDC_COIN_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
export const USDC_DECIMALS = 6;

/**
 * Walrus Mainnet shared objects, as configured in `@mysten/walrus` (MAINNET_WALRUS_PACKAGE_CONFIG).
 * The current Walrus epoch lives in the `StakingInnerV1` dynamic field of the staking object.
 */
export const WALRUS_SYSTEM_OBJECT_ID = '0x2134d52768ea07e8c43570ef975eb3e4c27a39fa6396bef985b5abc58d03ddd2';
export const WALRUS_STAKING_OBJECT_ID = '0x10b9d30c28448939ce6c4d6c6e0ffce4a7f8a4ada8248bdad09ef8b70e4a3904';
/** Original (type-defining) Walrus package; Blob objects carry this address in their type. */
export const WALRUS_TYPE_PACKAGE_ID = '0xfdc88f7d7cf30afab2f82e8380d11ee8f70efb90e863d1de8616fae1bb09ea77';
export const WALRUS_BLOB_TYPE = `${WALRUS_TYPE_PACKAGE_ID}::blob::Blob`;

export const TATUM_SUI_GRPC_HOST = 'sui-mainnet-grpc.gateway.tatum.io:443';

/**
 * Payment networks the chain service can verify on. Walrus memory reads only make sense on
 * mainnet; testnet exists so a paid recall can be shown without real USDC.
 */
export const PAYMENT_NETWORKS = ['mainnet', 'testnet'] as const;
export type PaymentNetwork = (typeof PAYMENT_NETWORKS)[number];

/** Circle USDC on Sui Testnet (developers.circle.com/stablecoins/usdc-contract-addresses). */
export const TESTNET_USDC_COIN_TYPE = '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';
export const USDC_COIN_TYPES: Readonly<Record<PaymentNetwork, string>> = { mainnet: USDC_COIN_TYPE, testnet: TESTNET_USDC_COIN_TYPE };

/** Tatum's Sui gRPC gateways (docs.tatum.io/changelog/sui-grpc-available-tatum). */
export const TATUM_SUI_GRPC_HOSTS: Readonly<Record<PaymentNetwork, string>> = {
  mainnet: TATUM_SUI_GRPC_HOST,
  testnet: 'sui-testnet-grpc.gateway.tatum.io:443',
};
export const TATUM_API_BASE = 'https://api.tatum.io';
