// TripScout: a travel agent that buys one fact from a Ferry Share Card for 0.01 USDC on Sui.
import { ferry } from '@ferry/sdk';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

const key = process.env['TRIPSCOUT_PRIVATE_KEY'];
const cardId = process.env['TRIPSCOUT_CARD_ID'];
if (!key?.startsWith('suiprivkey') || !cardId) throw new Error('Set TRIPSCOUT_PRIVATE_KEY (suiprivkey...) and TRIPSCOUT_CARD_ID. Run `pnpm keygen` first.');
const payer = Ed25519Keypair.fromSecretKey(key);

const { results, payment } = await ferry.card(cardId).recall('food preferences', { payer });
for (const fact of results) console.log(`- ${fact.text} (heard in ${fact.sources.join(', ')} on ${fact.heardAt})`);
console.log(`Paid ${Number(payment.amountMicros) / 1e6} USDC, receipt ${payment.receiptId}`);
console.log(`https://suiscan.xyz/mainnet/tx/${payment.digest}`);
