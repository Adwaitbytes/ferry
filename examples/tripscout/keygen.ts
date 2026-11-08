// Creates the TripScout payer key in .env.local (gitignored) and prints only the address to fund.
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

const envPath = fileURLToPath(new URL('.env.local', import.meta.url));
if (existsSync(envPath)) {
  console.error('examples/tripscout/.env.local already exists. Delete it first if you really want a new key.');
  process.exit(1);
}
const keypair = Ed25519Keypair.generate();
const lines = [
  `TRIPSCOUT_PRIVATE_KEY=${keypair.getSecretKey()}`,
  'TRIPSCOUT_CARD_ID=',
  'FERRY_GATE_URL=http://localhost:3001',
];
writeFileSync(envPath, `${lines.join('\n')}\n`, { mode: 0o600 });
console.log(`Fund this address with a little SUI for gas and at least 0.01 USDC on Sui Mainnet:\n${keypair.toSuiAddress()}`);
