// TripScout: an agent that buys facts from a Ferry Share Card for 0.01 USDC on Sui.
// FERRY_SUI_NETWORK=testnet pays with Testnet USDC against a testnet Gate; mainnet is the default.
import { explorerTxUrl, ferry } from '@ferry/sdk';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

const key = process.env['TRIPSCOUT_PRIVATE_KEY'];
const cardId = process.env['TRIPSCOUT_CARD_ID'];
if (!key?.startsWith('suiprivkey') || !cardId) throw new Error('Set TRIPSCOUT_PRIVATE_KEY (suiprivkey...) and TRIPSCOUT_CARD_ID. Run `pnpm keygen` first.');
const payer = Ed25519Keypair.fromSecretKey(key);

const { results, payment } = await ferry.card(cardId).recall(process.env['TRIPSCOUT_QUERY'] ?? 'how this person likes to work', { payer });
for (const fact of results) console.log(`- ${fact.text} (heard in ${fact.sources.join(', ')} on ${fact.heardAt})`);
console.log(`Paid ${Number(payment.amountMicros) / 1e6} USDC, receipt ${payment.receiptId}`);
console.log(explorerTxUrl(ferry.network, payment.digest));
