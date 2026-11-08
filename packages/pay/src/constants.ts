/** Circle USDC on Sui Mainnet, 6 decimals (RESEARCH 3). Same value as `USDC.type` in @suimpp/mpp. */
export const MAINNET_USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
export const USDC_DECIMALS = 6;

/** Default price per recall: 0.01 USDC. */
export const DEFAULT_PRICE_MICROS = 10_000n;
/** Hard ceiling on a card price so a typo cannot charge an agent 1000 USDC. */
export const MAX_PRICE_MICROS = 100_000_000n;

/** Challenge lifetime (THREAT_MODEL 11: default 10 minutes). */
export const CHALLENGE_TTL_MS = 10 * 60_000;
/** Clock skew tolerated before `issuedAt` when checking the checkpoint timestamp. */
export const CLOCK_SKEW_MS = 30_000;
/**
 * A proof may arrive a little after the challenge expired when the payer's transaction was
 * checkpointed inside the window but the Gate answered PAYMENT_PENDING first. The transaction
 * timestamp itself must still fall inside the window.
 */
export const PRESENTATION_GRACE_MS = 2 * 60_000;

/** Namespace the Gate recalls from. Hard-coded (X-GATE-1): never configurable per request. */
export const PUBLIC_NAMESPACE = 'ferry-public';

/** Card id grammar: 128 bits, base64url, no padding. Checked before any database access. */
export const CARD_ID_RE = /^[A-Za-z0-9_-]{22}$/;
export const SUI_ADDRESS_RE = /^0x[0-9a-f]{64}$/;
export const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
