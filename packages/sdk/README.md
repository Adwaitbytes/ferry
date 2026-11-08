# @ferry/sdk

Let an agent read a Ferry Share Card and pay for it per recall in USDC on Sui. The Gate answers
`402 Payment Required` with an MPP challenge; the SDK pays it from your Sui key, retries with the
credential and returns typed, validated results with a payment receipt.

```sh
npm install @ferry/sdk @mysten/sui
```

```ts
import { createFerry } from '@ferry/sdk';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

const ferry = createFerry({ baseUrl: 'https://your-gate.example' });
const payer = Ed25519Keypair.fromSecretKey(process.env.AGENT_PRIVATE_KEY!); // suiprivkey1...

const { results, payment } = await ferry.card('q3V7mT0xR9bK2wY5pL8nAg').recall('food preferences', { payer });
console.log(results.map((r) => r.text));
console.log(`https://suiscan.xyz/mainnet/tx/${payment.digest}`);
```

`ferry` (a ready-made client) reads `FERRY_GATE_URL` from the environment and falls back to
`http://localhost:3001` (the Gate under `vercel dev --listen 3001`).

## What it does on each call

1. `POST /v1/cards/:id/recall` with `{ "q": ... }` in the body, so the query never sits in a URL log.
2. On `402`, it checks the challenge before any money moves: method `sui`, coin Mainnet USDC
   (`0xdba3...::usdc::USDC`), a valid recipient, and a price at or below `maxPriceMicros`.
3. It pays once with `0x2::balance::send_funds` and signs a proof that binds the transaction to
   the challenge (`@suimpp/mpp`, `mppx`).
4. It sends the credential. If the Gate says the payment is still pending, it re-sends the same
   credential a few times. It never submits a second payment for one call.
5. It validates the response with the Ferry contract schema and checks that the receipt names
   your address as payer.

## Options

| Option | Where | Default | Notes |
|---|---|---|---|
| `baseUrl` | `createFerry` | required | HTTPS only, except `localhost` |
| `suiClient` | `createFerry` | public Mainnet fullnode (gRPC) | Any `@mysten/sui` core client |
| `execute` | `createFerry` | sign and execute with `suiClient` | Route payment through a gas station |
| `fetch` | `createFerry` | `globalThis.fetch` | |
| `payer` | `recall` | required | Any `@mysten/sui` `Signer`; never logged or serialized |
| `maxPriceMicros` | `recall` | `10000n` (0.01 USDC) | Challenges above this are refused |

The payer needs USDC on Sui Mainnet and a little SUI for gas.

## Errors

Every failure is a `FerryError` with a stable `code` (for example `PRICE_ABOVE_MAX`,
`WRONG_COIN`, `NOT_FOUND`, `PAYMENT_REPLAYED`, `DAILY_CAP`, `INVALID_RESPONSE`) and, when the
Gate answered, its HTTP `status`.

## License

MIT
