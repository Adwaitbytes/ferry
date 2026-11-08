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
export const TATUM_API_BASE = 'https://api.tatum.io';
