# FERRY Research

Research lead, 2026-11-09 (UTC). Every claim has a source. "VERIFIED" = checked against npm registry, package source, GitHub source, or a live endpoint today. "UNVERIFIED" = could not confirm; what was tried is listed.

Scratch clones used for source reading: `MystenLabs/walrus-memory` @ main (shallow clone 2026-11-09), npm tarball `@mysten-incubation/memwal@0.1.13`.

## Summary

| # | Item | Verified value | Source | Status |
|---|---|---|---|---|
| 1 | MemWal SDK | `@mysten-incubation/memwal@0.1.13` | npm | VERIFIED |
| 1 | Relayer | `https://relayer.memory.walrus.xyz` (relayer 0.1.0, api 1.0.0, writes ok) | live `/health` | VERIFIED |
| 1 | Package / Registry IDs | `0xe7c1…d7f5` / `0x8bf8…199f` exist on mainnet, registry v4, migration finalized | relayer `/config` + Sui GraphQL | VERIFIED |
| 1 | Rate limits | **30 pts/min per delegate key, 60/min + 500/h per account**; remember=5, **bulk(≤20)=10**, recall=1 | `rate_limit.rs` | VERIFIED source |
| 1 | Vault vector dims | **1536** (`text-embedding-3-small`), exact | `embedder.rs` | VERIFIED source |
| 1 | Request signing | Ed25519 over `ts.METHOD.path.sha256(body).nonce.accountId` + `x-seal-session` (needs raw key) | SDK source, API docs | VERIFIED source |
| 1 | CORS | Still **no `Access-Control-Allow-Origin`** (fix merged, not deployed) | live curl, issue #1119 | VERIFIED live |
| 1 | MEMWAL_AGENT_ID | delegate public key, 64 hex, no 0x | official docs | VERIFIED |
| 1 | MCP plugin namespace | `default` unless `MEMWAL_NAMESPACE` set | MCP reference | VERIFIED |
| 1 | Sponsored gas | relayer `/sponsor` covers create_account / add / remove delegate (Enoki-backed) | `sponsor.rs`, docs | VERIFIED source, not e2e |
| 2 | Tatum gRPC | `sui-mainnet-grpc.gateway.tatum.io:443`, metadata `x-api-key`, **native gRPC only (no gRPC-Web)** | Tatum docs + live test | VERIFIED live |
| 2 | Tatum free plan | 100k credits, **3 RPS**, 2 keys | Tatum plans page | VERIFIED docs |
| 2 | Sui JSON-RPC | Deprecated; public fullnode returns -32601 | live curl | VERIFIED live |
| 2 | Tatum prices | `GET /v4/data/rate/symbol?symbol=SUI&basePair=USD`, 20 credits | Tatum API ref | VERIFIED docs |
| 2 | Tatum Storage | `POST /v4/data/storage/upload` multipart `file`, ≤50 MiB, mainnet keys, Tatum-owned blob | Tatum API ref | VERIFIED docs; free-plan balance UNVERIFIED |
| 2 | Tatum Sui webhooks | **Not supported** (Sui absent from alert chains) → use gRPC `SubscribeCheckpoints`/polling | Tatum API ref | VERIFIED docs |
| 3 | USDC | `0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC`, 6 dp | Circle + chain | VERIFIED |
| 4 | MPP | `@suimpp/mpp@0.9.0` + **`mppx@0.4.12` (pinned)**, mainnet, no facilitator | npm, README, chain | VERIFIED |
| 4 | x402 | `@suimpp/mpp/x402` exact / `sui:mainnet`, self-settled; public facilitators testnet-only | README, Sui forum | PARTLY VERIFIED |
| 5 | Enoki zkLogin | Feasible, **NO-GO** for P0/P1; sponsored gas via relayer **GO** | docs, source | DECISION |
| 6 | Seal / Walrus | seal 1.5.4, walrus 1.2.39; relay `upload-relay.mainnet.walrus.space`; aggregator `aggregator.walrus-mainnet.walrus.space` | npm, live curl | VERIFIED |
| 7 | Exports | ChatGPT DAG (no memories), Claude incl. `memories.json`, Gemini Takeout JSON (2 variants); PAM v1.0 | PAM provider pages (Feb 2026) | VERIFIED docs, Nov 2026 UNVERIFIED |
| 8 | Extension framework | **WXT 0.21.5** (Plasmo last release May 2025) | npm, GitHub | VERIFIED |
| 9 | WebCrypto Ed25519 | Chrome 137+; but MemWal SDK needs raw seed → AES-GCM-wrapped seed | MDN BCD, SDK source | VERIFIED |
| 10 | dApp Kit | `@mysten/dapp-kit-react@2.1.45` (old `@mysten/dapp-kit` is JSON-RPC only, frozen) | npm, README | VERIFIED |
| 11 | Versions | next 16.4.5, react 19.3.1, tailwind 4.3.5, motion 14.10.1, … (section 11) | npm | VERIFIED |


---

## 1. Walrus Memory (MemWal)

### 1.1 Package and live constants

| Item | Verified value | Source | Status |
|---|---|---|---|
| npm package | `@mysten-incubation/memwal` | `npm view` | VERIFIED |
| Latest version | `0.1.13` (published 2026-11-05) | `npm view @mysten-incubation/memwal version time` | VERIFIED |
| Repo | https://github.com/MystenLabs/walrus-memory (`packages/sdk`) | npm `repository` field | VERIFIED |
| Deps | `@noble/ed25519 ^2.3.0`, `@noble/hashes ^2`; peers `@mysten/sui >=2.5.0`, `@mysten/seal >=1.1.0`, `@mysten/walrus >=1.0.3`, `ai >=4`, `zod ^3.23 \|\| ^4` | npm `dependencies/peerDependencies` | VERIFIED |
| Subpath exports | `.` (MemWal, MemWalMock), `./manual` (MemWalManual), `./account` (createAccount/addDelegateKey/removeDelegateKey), `./ai` (Vercel AI SDK middleware) | package.json `exports` | VERIFIED |
| Node | README requires Node 22.23.4+ / 24.22.1+ / 26.12.1+ (Oct 2026 security release) | package README | VERIFIED |
| Relayer URL | `https://relayer.memory.walrus.xyz`: `/health` 200, `relayerVersion 0.1.0`, `apiVersion 1.0.0`, `mode: production`, `write_ready: true` | `curl https://relayer.memory.walrus.xyz/health` | VERIFIED live |
| MEMWAL_PACKAGE_ID | `0xe7c16fbea0560e7057e2bf7422feaa4fb313749fc69c9e9092fac7a33b81d7f5` (package version 1, single module `account`) | relayer `GET /config` + Sui GraphQL `object(address)` | VERIFIED live |
| MEMWAL_REGISTRY_ID | `0x8bf82c9e09e36b8d1c38298f68b7cb68e7b8762887e7592add9986d5e9cf199f`, type `<pkg>::account::AccountRegistry`, `version: 4`, `migration_finalized: true`, 11,449 accounts | relayer `GET /config` + Sui GraphQL | VERIFIED live |
| Relayer's own Sui endpoints | `suiGrpcUrl: https://mysten-rpc.mainnet.sui.io`, `suiTransport: grpc` | `GET /config` | VERIFIED live |
| Embedding model / dims | `openai/text-embedding-3-small`, **1536** dims, exact length enforced (`vector must have exactly 1536 dimensions`) | `services/server/src/services/embedder.rs` (`EMBEDDING_DIMS = 1536`), `types.rs` validate_embedding_vector | VERIFIED source |
| `rememberBulk` cap | 20 items (`MAX_BULK_ITEMS = 20`), body limit 2 MiB, single remember text max 1 MiB | `services/server/src/types.rs`, `routes/remember.rs`, `main.rs` | VERIFIED source |
| recall `limit` cap | 100 | SDK `RecallOptions.limit` doc | VERIFIED source |
| Max delegate keys / label | 20 keys per account, label max 64 bytes | `services/contract/sources/account.move` (`MAX_DELEGATE_KEYS`, `MAX_LABEL_LENGTH`) | VERIFIED source |
| MEMWAL_AGENT_ID | **The delegate public key**, 64 hex chars, **no `0x`** (not the Sui address, not the account id). `await memwal.getPublicKeyHex()` | https://github.com/MystenLabs/walrus-memory/blob/main/docs/getting-started/find-your-agent-id.md | VERIFIED docs |

### 1.2 Rate limits (the real numbers: PRD's "~24/min" is wrong)

Source: `services/server/src/rate_limit.rs` (`RateLimitConfig::default`, endpoint weight table) and https://github.com/MystenLabs/walrus-memory/blob/main/docs/relayer/overview.md#rate-limiting--abuse-prevention. Relayer `/config` shows `rateLimitDisabled: false`.

| Layer | Limit |
|---|---|
| Per delegate key | **30 points / minute** |
| Per account (owner) burst | **60 points / minute** |
| Per account sustained | **500 points / hour** |
| Storage quota | 1 GB of Walrus blobs per account (402 "Storage quota exceeded") |
| Read API `/v1/owners/{owner}/{namespaces,memories}` | separate bucket, 200 weighted req/min per delegate key |
| Public `/api/accounts/:owner/{exists,delegate-keys}` | 20 req/min and 120 req/hour per IP |

Endpoint weights: `/api/remember` 5, **`/api/remember/bulk` 10 per request (any 1 to 20 items)**, `/api/analyze` 5, `/api/remember/manual` 3, `/api/restore` 3, `/api/ask` 2, `/api/embed` 2, everything else (recall, recall/manual, remember status polls, bulk status) 1.

Consequences for Ferry:
- **Always write through `rememberBulk` with 20 items.** One delegate key: max 3 bulk calls/min = 60 memories/min; account sustained 500 pts/h = 50 bulk calls/h = ~1000 memories/h minus recalls/polls. 300 seed memories = 15 bulk calls = 150 pts. Single `remember` is 5 pts per memory: never use it for imports.
- **Recall shares the write budget** (1 pt each, same per-key bucket). The composer chip (600 ms debounce, 2 recalls per trigger: relevance + recent) can eat 30 pts/min alone. Cache recall results locally and budget: e.g. token bucket of 20 pts/min for recall, 10 for writes, per key.
- Status polling costs 1 pt per poll. Use `waitForRememberJobs` (bulk status, 1 request for 20 ids) with `pollIntervalMs >= 3000`, never per-job polling.
- Owner-level overrides exist (`owner_rate_limits` policy in `rate_limit.rs`), so the Walrus team can raise limits for our account: worth asking in the hackathon channel. UNVERIFIED whether they will.
- 429 bodies carry `Retry-After` header (exposed via CORS `access-control-expose-headers: x-auth-error,retry-after`, observed live).
- Issue #1157 (401 after burst): closed 2026-10-23. Maintainer: root cause was relayer treating Sui fullnode throttling as "key not registered"; fixed (#811). Now returns **503 + `Retry-After: 5` + `x-auth-error: AUTH_UPSTREAM_UNAVAILABLE`**; keys verified within 10 min keep working. A minutes-long 401 on SDK >= 0.1.9 is "not expected" (https://github.com/MystenLabs/walrus-memory/issues/1157). Still: treat `AUTH_UPSTREAM_UNAVAILABLE`/503 as "cooling down", and only treat a 401 `AUTH_REJECTED` that persists after a fresh on-chain key check as "key revoked". Reuse one `MemWal` instance (new instance per call = new SEAL session each time, which the reporter suspected as a trigger).

### 1.3 TypeScript API surface (from `dist/*.d.ts` of 0.1.13)

Note the PRD's parameter names are slightly off: recall takes `query` + `limit`/`topK`, not positional namespace first.

```ts
import { MemWal, MemWalMock } from "@mysten-incubation/memwal";

const memwal = MemWal.create({
  key,                 // Ed25519 delegate PRIVATE key: hex (±0x), "suiprivkey1..." or Uint8Array (32-byte seed)
  accountId,           // MemWalAccount object id (required)
  serverUrl: "https://relayer.memory.walrus.xyz", // default; SDK reads no env vars
  namespace: "ferry-core",                        // default "default"
  requestTimeoutMs: 30_000, recallTimeoutMs: 15_000, preflightTimeoutMs: 5_000,
});

// writes (all async jobs)
await memwal.remember(text, ns?, { idempotencyKey?, dedupe? })      // -> { job_id, status }
await memwal.rememberAndWait(text, ns?, { timeoutMs, pollIntervalMs })// -> { id, job_id, blob_id, owner, namespace }
await memwal.getRememberStatus(jobId) // status: pending|running|uploaded|done|failed|not_found
await memwal.rememberBulk(items: { text: string; namespace?: string }[], { idempotencyKey? }) // -> { job_ids, total, status }
await memwal.rememberBulkAndWait(items, { pollIntervalMs = 1500, timeoutMs = 120_000, idempotencyKey? })
// -> { results: { id, blob_id, status: "done"|"failed"|"timeout", namespace, error? }[], total, succeeded, failed }
await memwal.waitForRememberJobs(jobIds, namespaces?, opts)   // resume after SW restart (persist job_ids!)

// reads
await memwal.recall({ query, limit /*≤100, default 10*/, namespace, maxDistance, sort: "relevance" | "recent",
                      maxTokens?, truncationStrategy?, scoringWeights?, timeoutMs? })
// -> { results: { blob_id, text, distance, created_at? }[], total, meta?, dropped_count? }
await memwal.listMemories({ cursor?, limit? /*server default 100, clamp 500*/, namespace? /* client-side filter */ })
// -> { memories: { memory_id, namespace_id, blob_id, created_at, updated_at, size, agent_id, package_id, status,
//                  end_epoch, expires_at, importance }[], next_cursor, has_more, snapshot_version, deleted[], must_resync }
await memwal.listNamespaces({ cursor?, limit? })
await memwal.restore(namespace, limit?) // -> { restored, skipped, failed, total, namespace, owner, truncated }
await memwal.getPublicKeyHex()          // = MEMWAL_AGENT_ID
await memwal.health(); memwal.destroy();
```

Useful details:
- `RememberOptions.dedupe: true` = content-hash dedupe per `(owner, namespace, text)`; `idempotencyKey` scoped per `(owner, namespace)`, 409 if reused with different text. Use `idempotencyKey = sha256(batch)` so resumed imports never double-write.
- `listMemories` gives `end_epoch` and `expires_at` per blob: use for the "forget" honesty copy and receipts.
- `listMemories.deleted[]` tombstones + `must_resync` = restart walk without cursor.
- `MemWalMock` (in-memory, deterministic) exists for tests: use it in `packages/memwal` unit tests.
- `POST /api/forget {namespace}` exists on the relayer: deletes **all index rows of a namespace** (blobs persist, `restore` re-indexes them). There is no per-memory delete in the SDK. So the PRD's tombstone model stands; namespace forget is only useful for "leave Ferry" (https://github.com/MystenLabs/walrus-memory/blob/main/docs/relayer/api-reference.md#post-apiforget).
- Errors: exported classes `MemWalRateLimitedError` (429, carries job ids + retry-after), `MemWalRememberJobFailedError`, `MemWalRememberJobNotFoundError`, `MemWalRememberJobTimeoutError`, `MemWalCompatibilityError`; helpers `isTimeoutError`, `delegateKeyToPublicKey`, `delegateKeyToSuiAddress`; `generateDelegateKey()` in `/account` (returns hex). Other failures throw `Error` with `status`, `serverCode` (e.g. `AUTH_REJECTED`, `AUTH_UPSTREAM_UNAVAILABLE`), and `TimeoutError` with `phase`. Clock drift: `x-auth-error: ERR_TIMESTAMP_OUT_OF_BOUNDS` (5-minute window). Source: `dist/utils.js`, `dist/errors.d.ts`.

### 1.4 Request signing format (needed for the extension)

Source: `dist/memwal.js` `signedRequest()` and https://github.com/MystenLabs/walrus-memory/blob/main/docs/relayer/api-reference.md#authentication

```
message   = `${unixSeconds}.${METHOD}.${pathAndQuery}.${sha256hex(bodyString)}.${uuidv4Nonce}.${accountId}`
signature = Ed25519.sign(utf8(message), delegateSeed)        // pure Ed25519, NOT Sui personal-message intent
headers   = x-public-key (hex 32B), x-signature (hex 64B), x-timestamp, x-nonce, x-account-id,
            x-seal-session (base64 SEAL SessionKey; relayer-mode routes only)
```

**Gotcha (important for F1/5.2):** on every relayer-mode route the SDK also builds a SEAL `SessionKey` with `Ed25519Keypair.fromSecretKey(rawSeed)` from `@mysten/sui` and signs its personal message with it (`x-seal-session`, 5-min TTL). The SDK therefore needs **raw private key bytes**; it cannot drive a non-extractable WebCrypto `CryptoKey`. The legacy `x-delegate-key` (raw key on the wire) is deprecated; relayer advertises removal in apiVersion 2.0.0 (`/health` `deprecations`). See section 9 for the key-storage decision.

### 1.5 MemWalManual (Vault mode)

Import `@mysten-incubation/memwal/manual`. Config (from `MemWalManualConfig`):

```ts
MemWalManual.create({
  key,                          // delegate key, signs relayer requests only (no x-seal-session sent)
  walletSigner,                 // { address, signAndExecuteTransaction, signPersonalMessage } from dapp-kit  (or suiPrivateKey)
  suiClient,                    // optional; else SDK creates a gRPC client to public fullnode
  embeddingApiKey, embeddingApiBase = "https://api.openai.com/v1", embeddingModel = "text-embedding-3-small",
  packageId: "0xe7c1…d7f5", accountId, registryId: "0x8bf8…199f",
  suiNetwork: "mainnet", sealThreshold = 2, walrusEpochs = 50,
  walrusAggregatorUrl /* default https://aggregator.walrus-mainnet.walrus.space */, walrusPublisherUrl,
  namespace,
});
```
- Vector must be exactly **1536** floats (relayer rejects others). Any OpenAI-compatible endpoint returning 1536-dim `text-embedding-3-small` works (OpenRouter: `openai/text-embedding-3-small`).
- Built-in mainnet SEAL key servers (2-of-2, open mode): Overclock `0x145540d931f182fef76467dd8074c9839aea126852d90d18e1556fcbbd1208b6`, Studio Mirai `0xe0eb52eba9261b96e895bbb4deca10dcd64fbc626a1133017adcd5131353fd10` (`dist/manual.js` `DEFAULT_SEAL_SERVER_CONFIGS`).
- SEAL identity = `bcs(owner) ‖ bcs(u64 access_counter_version)`; policy `account::seal_approve` allows owner or any delegate (`account.move` `seal_key_id`). Counter bumps on delegate removal: only protects **future** writes.
- Relayer still sees vectors, owner, namespace, query vectors and access pattern (docs: https://github.com/MystenLabs/walrus-memory/blob/main/docs/relayer/overview.md#trust-boundary).

### 1.6 Move package (`memwal::account`): exact signatures

Source: https://github.com/MystenLabs/walrus-memory/blob/main/services/contract/sources/account.move and SDK `dist/account.js`.

```move
entry fun create_account(registry: &mut AccountRegistry, clock: &Clock, ctx: &mut TxContext)
entry fun add_delegate_key(account: &mut MemWalAccount, registry: &AccountRegistry,
                           public_key: vector<u8> /*32B*/, label: String /*≤64B*/, clock: &Clock, ctx: &TxContext)
entry fun remove_delegate_key(account: &mut MemWalAccount, registry: &AccountRegistry,
                              public_key: vector<u8>, ctx: &TxContext)   // NOTE: no Clock
entry fun deactivate_account / reactivate_account (owner)

public struct MemWalAccount has key, store {      // shared object
  id: UID, owner: address, delegate_keys: vector<DelegateKey>, created_at: u64 /*ms*/,
  active: bool, admin_quarantined: bool, legacy_account_id: Option<ID>, access_counter_version: u64 }
public struct DelegateKey has store, copy, drop {
  public_key: vector<u8>, sui_address: address /* blake2b256(0x00‖pk) */, label: String, created_at: u64 }
public struct AccountRegistry has key { id, accounts: Table<address, ID>, migration_finalized, ..., version: u64 }
events: AccountCreated{account_id, owner}, DelegateKeyAdded{account_id, public_key, sui_address, label}, ...
```

TS builder (prefer the SDK helpers in `@mysten-incubation/memwal/account`, or build by hand):

```ts
tx.moveCall({ target: `${PKG}::account::add_delegate_key`, arguments: [
  tx.object(accountId), tx.object(REGISTRY_ID),
  tx.pure.vector("u8", Array.from(pubKey32)), tx.pure.string(label), tx.object("0x6") ] });
```

Finding the account for an owner: `AccountRegistry.accounts` is a `Table<address, ID>` (dynamic field lookup keyed by owner address), or the public relayer route `GET /api/accounts/:owner/delegate-keys` → `{ account_id, keys: [{ public_key, sui_address, label, created_at }] }` (20/min per IP). For Tatum-proof purposes read via gRPC: dynamic field of table `0xcfe04623a8c72ede45fc02babcb9711625df8549e53d3107d507efa696d5efde` with key type `address`, then `GetObject(account_id)`.

**Sponsored gas exists:** relayer `POST /sponsor` + `POST /sponsor/execute` sponsor exactly one allowlisted call: `create_account`, `add_delegate_key`, `remove_delegate_key` (or a batch of removals ≤ 20). Auth = Sui personal-message signature over sender, tx-kind hash, timestamp, nonce (`services/server/src/routes/sponsor.rs`; SDK `dist/sponsor-auth.js`). This removes the "user needs SUI for gas" problem for onboarding. SDK exports `createSponsorAuthorization(sender, transactionKindBytes, signPersonalMessage)` and `sponsorAuthorizationMessage(...)` from the root entry. Request body shape for `/sponsor`: read `services/server/src/routes/sponsor.rs` before wiring. UNVERIFIED end-to-end on mainnet (needs a wallet).

### 1.7 CORS (#1119)

Live check today: `OPTIONS /api/recall` with `Origin: https://example.com` returns `access-control-allow-headers` and `allow-methods` but **no `access-control-allow-origin`**. Issue #1119 is closed with fix PR #1270 "included in memwal-server 0.2.0", but production still runs `relayerVersion 0.1.0`. So: **browser pages (web app) cannot call the relayer directly today.** The extension service worker with `host_permissions: ["https://relayer.memory.walrus.xyz/*"]` is exempt from CORS. The web app must either message the extension or go through a server proxy. Sources: https://github.com/MystenLabs/walrus-memory/issues/1119, live curl.

### 1.8 Official MCP plugin namespace

The MCP server forwards calls without `namespace` and the relayer applies `"default"`, unless `--namespace` / `MEMWAL_NAMESPACE` is set (https://github.com/MystenLabs/walrus-memory/blob/main/docs/mcp/reference.md#default-namespace). **Recommendation:** don't mirror into `default`; tell users to set `MEMWAL_NAMESPACE=ferry-core` in their Claude Code MCP config. Zero duplicate writes, zero extra rate-limit spend.

### 1.9 Issue #1141 (OAuth MCP sessions survive key removal)

Closed 2026-10-27 (https://github.com/MystenLabs/walrus-memory/issues/1141). Irrelevant to Ferry since we use signed delegate-key requests, where a removed key stops verifying within the re-verification window (≤ ~30 s cache per #1157 comment, keys verified in last 10 min may be served while Sui is unreachable).

---

## 2. Tatum (Sui gRPC, prices, storage, notifications)

### 2.1 Sui gRPC gateway: VERIFIED live

- Mainnet: `https://sui-mainnet-grpc.gateway.tatum.io` (testnet `sui-testnet-grpc…`, devnet `sui-devnet-grpc…`). JSON-RPC: `https://sui-mainnet.gateway.tatum.io`. Source: https://docs.tatum.io/reference/rpc-sui
- Auth: gRPC metadata **`x-api-key: <key>`**; code 16 UNAUTHENTICATED on bad key. Source: https://docs.tatum.io/docs/sui-migration-guide-from-json-rpc-to-grpc.md
- Method list (live `GET https://sui-mainnet-grpc.gateway.tatum.io/_methods`): LedgerService `GetObject, BatchGetObjects, GetTransaction, BatchGetTransactions, ListTransactions, GetCheckpoint, ListCheckpoints, GetEpoch, GetServiceInfo`; StateService `GetBalance, ListBalances, GetCoinInfo, ListDynamicFields, ListOwnedObjects`; MovePackageService `GetPackage, GetDatatype, GetFunction, ListPackageVersions`; NameService; SignatureVerificationService `VerifySignature`; **SubscriptionService `SubscribeCheckpoints`**; TransactionExecutionService `ExecuteTransaction, SimulateTransaction`; CheckpointSummaryService.
- **GOTCHA: Tatum speaks native gRPC (HTTP/2, `content-type: application/grpc`), NOT gRPC-Web.** The default `SuiGrpcClient({ baseUrl })` uses `@protobuf-ts/grpcweb-transport` and fails against Tatum with `unexpected response content type: application/grpc` (reproduced today). The same default client works against `https://fullnode.mainnet.sui.io:443`. Consequences:
  - **Browser and extension cannot call Tatum gRPC directly** (no HTTP/2 trailers in fetch). All Tatum calls go through the Ferry server proxy (already the plan for key secrecy). 
  - Server (Node 22, Vercel Node runtime, not Edge) uses the native transport below. Verified working today: `getObject(registry)` 457 ms, `GetServiceInfo` → `chain mainnet, epoch 1305`.

```ts
// packages/chain: Node only. deps: @mysten/sui@2.39.1, @protobuf-ts/grpc-transport@2.11.1, @grpc/grpc-js
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { GrpcTransport } from "@protobuf-ts/grpc-transport";
import { ChannelCredentials } from "@grpc/grpc-js";

const transport = new GrpcTransport({
  host: "sui-mainnet-grpc.gateway.tatum.io:443",
  channelCredentials: ChannelCredentials.createSsl(),
  meta: { "x-api-key": process.env.TATUM_API_KEY! },
});
export const sui = new SuiGrpcClient({ network: "mainnet", transport });
await sui.core.getObject({ objectId });               // high-level core API
await sui.ledgerService.getServiceInfo({});           // raw service clients: ledgerService, stateService, subscriptionService, ...
```
  `SuiGrpcClientOptions = { network, mvr? } & ({ transport: RpcTransport } | GrpcWebOptions /* baseUrl, meta, ... */)` (`@mysten/sui/dist/grpc/client.d.mts`). Pin `@protobuf-ts/grpc-transport` to the same minor as the `@protobuf-ts/runtime-rpc` that `@mysten/sui` resolves (2.11.1 today).
- Anonymous (no key) works but hit `429` on the 3rd call within a second (`x-ttm-plan: anonymous` header). Use a key everywhere.

### 2.2 Plans and limits: VERIFIED docs

Free plan: **100,000 credits, 3 requests/second, 2 API keys**. Starter+: 200 RPS. Source: https://docs.tatum.io/docs/plans-limits.md (updated 2026-01-08). Per-method gRPC credit cost: UNVERIFIED (tried docs.tatum.io/docs/rpc-nodes, gateway-limits; dashboard shows real usage). **3 RPS is the binding constraint**: the chain proxy needs a server-side token bucket at 3 rps + short-TTL cache (GetObject results 10 to 30 s), and payment verification should be batched (`BatchGetTransactions`).

### 2.3 Sui JSON-RPC deprecation: VERIFIED live

`sui_getObject` on `https://fullnode.mainnet.sui.io` returns `-32601 "JSON-RPC on public fullnodes has been deprecated. Please migrate to gRPC or GraphQL"`. Tatum still exposes JSON-RPC at `sui-mainnet.gateway.tatum.io` but Tatum's own guide says migrate. Use gRPC only. Sources: live curl; https://docs.sui.io/develop/accessing-data/json-rpc-migration ; https://docs.tatum.io/docs/sui-migration-guide-from-json-rpc-to-grpc.md

### 2.4 Price data: VERIFIED docs

`GET https://api.tatum.io/v4/data/rate/symbol?symbol=SUI&basePair=USD` with header `x-api-key`. **20 credits/call** when basePair is fiat or USDT/USDC; free plan only allows fiat/USDT/USDC base pairs. Default base pair is EUR (always pass `basePair`). USDC is in the supported list. Source: https://docs.tatum.io/reference/getexchangerate.md . Unauthenticated call returns `401 subscription.invalid` (live). Cache 60 s server-side; USDC→USD is ~1, so earnings fiat = one cached call per minute.

### 2.5 Storage API (Upload a file to Walrus): VERIFIED docs, free-plan UNVERIFIED

- `POST https://api.tatum.io/v4/data/storage/upload`, `multipart/form-data` field `file`, header `x-api-key`. Returns `{ jobId, status: "PENDING", filename, mimeType, sizeBytes, blobId }` (blobId pre-computed). Poll `GET /v4/data/storage/upload/{jobId}` (0 credits). List `GET /v4/data/storage/uploads`. Stop renewal / delete: `DELETE /v4/data/storage/upload/{jobId}`.
- Max **50 MiB**, **mainnet API keys only**, ~4 epochs default, auto-renewed by Tatum, billed to your "Walrus storage balance" (on-chain SUI/WAL cost × plan rate), no API credits per call. Source: https://docs.tatum.io/reference/storageupload.md
- Arbitrary bytes: yes (binary multipart), so Seal ciphertext is fine.
- UNVERIFIED: whether a free-plan key has a non-zero Walrus storage balance (no key available to test). Also: the blob is owned/renewed by Tatum's account, not the user's address, so "owned by your Sui wallet" does not hold for F9 backups via Tatum. Decision: try Tatum first (strong Tatum-usage story) and label it "stored via Tatum"; fall back to `@mysten/walrus` + upload relay if the upload returns a balance error.

### 2.6 Notifications / webhooks for Sui: VERIFIED: NOT supported

The v3 and v4 "Create an alert" chain enums list 22 mainnets (ethereum, solana, tron, base, bitcoin, ...) and **no Sui** (https://docs.tatum.io/reference/createsubscriptionv4.md , https://docs.tatum.io/reference/createsubscription.md). Fallback that still uses Tatum: server-side `subscriptionService.subscribeCheckpoints` stream through the Tatum gRPC gateway (listed in `_methods`), filter checkpoint transactions for USDC transfers to known recipient addresses; plus `ListTransactions`/`GetTransaction` polling as a backstop. Vercel functions can't hold streams: run the subscriber in a small long-lived worker or poll every 5 s from a cron-style loop. For the 10-second Earnings acceptance criterion, the Gate already knows the digest at verification time, so write the earnings row then; streaming is only for display polish.

---

## 3. Mainnet USDC on Sui: VERIFIED

`0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC`, **6 decimals** (0.01 USDC = `10000n`). Testnet: `0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC`. Sources: https://developers.circle.com/stablecoins/usdc-contract-addresses ; on-chain `getCoinMetadata` (symbol USDC, decimals 6, metadata id `0x75cfbbf8c962d542e99a1d15731e6069f60a00db895407785b15d14f606f2b4a`).

---

## 4. Agent payments (MPP / x402 on Sui)

### 4.1 Packages: VERIFIED npm

| Package | Version | Notes |
|---|---|---|
| `@suimpp/mpp` | **0.9.0** (2026-07-17) | Third-party (repo `github.com/mission69b/suimpp`, site https://suimpp.dev), MIT. Exports `.`, `./client`, `./server`, **`./x402`**. Deps: `@mysten/sui ^2.17.0`, **`mppx ^0.4.9`**, `zod ^4.3.6` |
| `mppx` | latest **0.17.5** (2026-11-08); **0.4.x line latest 0.4.12** | wevm (https://github.com/wevm/mppx). MPP spec: https://mpp.dev |

**Version gotcha:** `@suimpp/mpp@0.9.0` pins `mppx ^0.4.9`. Installing `mppx` unpinned gets 0.17.5 and two copies; `Mppx.create` from 0.17 with a 0.4 method object is untested. **Pin `mppx@0.4.12`** in `packages/pay` so the app and `@suimpp/mpp` share one copy. Verify with `pnpm why mppx` (must show a single version).

### 4.2 Mainnet support: VERIFIED

- Settles on Sui mainnet with Circle USDC (`USDC` preset = `0xdba3…::usdc::USDC`, 6 dp). Client pays with `0x2::coin::send_funds` (address balances). Confirmed `0x2::coin::send_funds`, `0x2::coin::redeem_funds`, `0x2::balance::send_funds` exist on mainnet today via `MovePackageService.GetFunction` against `fullnode.mainnet.sui.io`.
- **No facilitator**: the server verifies the tx itself via gRPC (status success, recipient, amount ≥ price as BigInt, sender == signer of a grief-protection personal-message signature (required since 0.7.0), digest not reused via `store`). Source: package README (`@suimpp/mpp@0.9.0`).
- Wire format: `402` + `WWW-Authenticate: Payment id=…, realm=…, method="sui", intent="charge", request=<b64url JSON>`; retry with `Authorization: Payment <b64url {challenge, payload:{digest, signature}}>`; success returns `Payment-Receipt` header.

### 4.3 Code

```ts
// Gate server (Next.js route handler / Hono)
import { USDC, sui } from "@suimpp/mpp/server";
import { Mppx } from "mppx";
const mppx = Mppx.create({ methods: [ sui({
  currency: USDC,
  recipient: card.ownerAddress,       // user's address; Ferry never custodies
  store: neonDigestStore,             // implement DigestStore over Neon (replay table, UNIQUE(digest))
  network: "mainnet",
  onPayment: (report) => recordEarning(report),
}) ] });
export const GET = mppx.charge({ amount: card.priceUsdc /* "0.01" */ })(handler);
```
```ts
// @ferry/sdk / TripScout client
import { USDC, sui } from "@suimpp/mpp/client";
import { Mppx } from "mppx/client";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
const client = new SuiGrpcClient({ network: "mainnet", baseUrl: "https://fullnode.mainnet.sui.io:443" });
const mppx = Mppx.create({ methods: [sui({ client, signer: Ed25519Keypair.fromSecretKey(key), currency: USDC })] });
const res = await mppx.fetch(`https://gate.ferry…/v1/cards/${id}/recall?q=food`);
```

**Tatum gotcha:** the server method builds its own `new SuiGrpcClient({ baseUrl: options.rpcUrl ?? <public fullnode> })` (`dist/server.js` line ~142), i.e. **gRPC-Web**, which cannot talk to Tatum (section 2.1). So leave `rpcUrl` unset (public fullnode) for the library's check, and in `onPayment` (or before responding) **re-verify the digest through Tatum** (`ledgerService.getTransaction` with balance changes: USDC type, recipient +amount, status success). That keeps "payment verification via Tatum" true and gives defense in depth. Patching the library to accept a client instance is the alternative (small fork).

### 4.4 x402 on Sui: status

- `@suimpp/mpp/x402` ships an x402 dialect: scheme **`exact`**, network **`sui:mainnet`**, headers `X-PAYMENT` / `X-PAYMENT-RESPONSE`, `x402Version 1`. Client **signs but does not submit** (`withdrawal → redeem_funds → send_funds`, `ValidDuring` nonce bound to challenge); server verifies and **settles itself at serve time**. API: `createX402Requirements`, `parseX402Header`, `settleX402Payment` (server), `buildX402SignedPayment({ requirements, signer })` (client). Source: README + `dist/x402.d.ts` of 0.9.0.
- Public third-party Sui x402 facilitators: testnet-only as far as I could find (Sui forum "first live x402 facilitator on Sui" says mainnet after hardening: https://forums.sui.io/t/the-first-live-x402-facilitator-on-sui-agents-pay-usdc-per-api-call-verified-humans-read-free/49391). `@x402/sui` does not exist on npm (404). UNVERIFIED: whether any mainnet Sui facilitator is live today.

### 4.5 Recommendation

**Primary: MPP via `@suimpp/mpp@0.9.0` digest dialect + `mppx@0.4.12`, with Tatum re-verification and a Neon digest store.** Fallback: the same package's x402 `exact`/`sui:mainnet` dialect (self-settled, no facilitator), behind the same Gate route by content negotiation (`X-PAYMENT` present → x402 path). Both satisfy "x402 or MPP, settled on Sui". Do a $0.01 mainnet smoke test in the first hour of payments work; the payer key needs a little SUI for gas plus USDC.

---

## 5. Enoki zkLogin + sponsored gas: decision

- **Sponsored gas for account ops: GO, and you don't need Enoki yourself.** The Walrus Memory relayer exposes `POST /sponsor` and `POST /sponsor/execute`, allowlisted to exactly one `create_account` / `add_delegate_key` / `remove_delegate_key` call (or ≤20 batched removals) on the MemWal package. Their docs say it is sponsored through Enoki ("Walrus Memory sponsors the transaction through Enoki, so you pay no gas": https://github.com/MystenLabs/walrus-memory/blob/main/docs/mcp/claude-connector.md). SDK helper: `createSponsorAuthorization(sender, txKindBytes, signPersonalMessage)`. Flow: build tx kind only (`tx.build({ onlyTransactionKind: true })`), wallet `signPersonalMessage` for auth, POST `/sponsor` → get sponsored tx bytes, wallet `signTransaction`, POST `/sponsor/execute`. Note `/sponsor` is on the relayer, so from the web app it hits the CORS problem (1.7): route through the extension worker or a server proxy. UNVERIFIED end-to-end; fallback = user pays gas (~0.003 SUI) with a normal `signAndExecuteTransaction`.
- **zkLogin (Google via Enoki): NO-GO for P0/P1.** Technically feasible (zkLogin addresses can own a MemWalAccount; `seal_approve` checks `ctx.sender()`, and the official `noter` example app uses zkLogin: https://github.com/MystenLabs/walrus-memory/blob/main/docs/examples/noter.md). But it needs an Enoki API key + Google OAuth client + redirect config, and adds a second wallet path to test in a 36-hour window. `@mysten/enoki` is at **1.3.4**. Revisit as P2.

---

## 6. Seal and Walrus

| Item | Value | Source | Status |
|---|---|---|---|
| `@mysten/seal` | **1.5.4** (2026-11-06) | npm | VERIFIED |
| `@mysten/walrus` | **1.2.39** (2026-11-06) | npm | VERIFIED |
| `@mysten/sui` | **2.39.1** (2026-11-06) | npm | VERIFIED |
| Mainnet Seal key servers (as used by MemWal manual mode, open mode, threshold 2) | Overclock `0x145540d931f182fef76467dd8074c9839aea126852d90d18e1556fcbbd1208b6`, Studio Mirai `0xe0eb52eba9261b96e895bbb4deca10dcd64fbc626a1133017adcd5131353fd10` | `@mysten-incubation/memwal/dist/manual.js` | VERIFIED source |
| Walrus mainnet upload relay | `https://upload-relay.mainnet.walrus.space`: `/v1/tip-config` 200: linear tip, base 0, 40 MIST per encoded KiB, tip address `0x765a6ff2c13b47e2603416d0b5a156df498a5c51bc8085be3838e43e06086256` | live curl | VERIFIED live |
| Walrus mainnet aggregator | `https://aggregator.walrus-mainnet.walrus.space` (`/v1/api` 200; read: `GET /v1/blobs/{blobId}`) | live curl; MemWal default `walrusAggregatorUrl` | VERIFIED live |

Seal encrypt (identity bound to owner): **reuse the MemWal policy instead of deploying our own Move package.** `memwal::account::seal_approve(id, registry, account)` grants decrypt to the owner or any delegate, with `id = bcs(owner) ‖ bcs(u64 access_counter_version)` (any prefix allowed before it). So F9 backups:

```ts
import { SealClient } from "@mysten/seal";
import { bcs } from "@mysten/sui/bcs";
const seal = new SealClient({ suiClient, serverConfigs: [
  { objectId: "0x1455…08b6", weight: 1 }, { objectId: "0xe0eb…fd10", weight: 1 } ], verifyKeyServers: false });
const id = toHex(new Uint8Array([...bcs.Address.serialize(owner).toBytes(), ...bcs.u64().serialize(counter).toBytes()]));
const { encryptedObject } = await seal.encrypt({ threshold: 2, packageId: MEMWAL_PACKAGE_ID, id, data: zipBytes });
// decrypt: SessionKey.create({ address, packageId: MEMWAL_PACKAGE_ID, ttlMin: 10, suiClient }) + tx calling
//   `${MEMWAL_PACKAGE_ID}::account::seal_approve`(fromHex(id), registry, account)
```
Read `counter` fresh from chain (`access_counter_version`) before every encrypt (the Move docs insist). `EncryptOptions = { threshold, packageId, id, data, aad?, kemType?, demType? }` (`@mysten/seal/dist/types.d.mts`).

Walrus client (Node or browser; browser reads/writes need the user's wallet as signer):

```ts
import { walrus } from "@mysten/walrus";
const client = new SuiGrpcClient({ network: "mainnet", baseUrl: "https://fullnode.mainnet.sui.io:443" })
  .$extend(walrus({ uploadRelay: { host: "https://upload-relay.mainnet.walrus.space", sendTip: { max: 1_000_000 } } }));
await client.walrus.writeBlob({ blob, epochs: 10, deletable: true, signer });   // or writeBlobFlow for resumable
```
Note the Walrus client also uses the gRPC-Web `SuiGrpcClient`, so it uses the public fullnode, not Tatum.

**Verify a blob matches its id (F4 "Verify" button):** fetch bytes from the aggregator, then recompute: `const { blobId } = await client.walrus.computeBlobMetadata({ bytes })` and compare to the expected id (blob id = hash of the RS-encoded metadata root, so you must re-encode; this pulls the walrus WASM, ~1 to 2 MB, lazy-load it). Alternatively `client.walrus.readBlob({ blobId })` reads from storage nodes and verifies slivers internally. Then read the on-chain `Blob` object (certified epoch, end epoch, owner) via Tatum `GetObject` for the receipt. For MemWal memories the blob is SEAL ciphertext; verifying the id proves integrity of the ciphertext, not of the plaintext text shown, so word the UI as "ciphertext on Walrus matches blob id". Source: `@mysten/walrus/dist/client.d.mts` (`computeBlobMetadata`, `readBlob`, `getVerifiedBlobStatus`).

---

## 7. Export formats

Primary source: Portable AI Memory provider pages (observed Feb 2026, "formats may change without notice"). No newer official vendor spec exists; **UNVERIFIED for Nov 2026**: build parsers defensively (zod `.passthrough()`, unknown-field tolerant) and keep fixture tests from a real team export made today.

**ChatGPT** (https://portable-ai-memory.pages.dev/providers/openai/): ZIP has `conversations.json`, `chat.html`, `user.json`, `message_feedback.json`, `shared_conversations.json`, `tool_messages.json`, `*.dat` (DALL-E PNGs). `conversations.json` = array of `{ id, title, create_time, update_time, mapping, current_node? }`; `mapping[id] = { id, parent, children[], message|null }`; `message = { author.role: user|assistant|system|tool, content.content_type: "text"|"multimodal_text"|…, content.parts[] (string|object|null), create_time (may be 0/null), metadata.model_slug }`. Quirks: multiple roots and orphans, null messages, null parts, timestamps 0. **Saved memories not in export** (as of Feb 2026), so the DOM-read path in F2 stays. `current_node` is not in the PAM doc; use it if present to pick the active branch, else walk all branches.

**Claude** (https://portable-ai-memory.pages.dev/providers/anthropic/): ZIP has `conversations.json`, **`memories.json`**, `projects.json`, `users.json`. Conversation: `uuid, name, summary?, created_at, updated_at, account.uuid, chat_messages[]` (not `messages`). Message: `uuid, sender: "human"|"assistant", text, content[] (blocks: text{text,citations}, thinking, tool_use, tool_result, token_budget), created_at, updated_at, attachments, files`. Linear, no branching. **`memories.json` is a single-element array with `conversations_memory` (string) and `project_memories` (object keyed by project uuid)**, so Claude memory is in the export: no DOM read needed for Claude. `projects.json`: `uuid, name, description, prompt_template, docs, creator`.

**Gemini** (https://portable-ai-memory.pages.dev/providers/google/): Takeout → "My Activity" → "Gemini Apps", **format must be switched from HTML to JSON**: `Takeout/My Activity/Gemini Apps/MyActivity.json`, array of `{ header: "Gemini", title: "Used Gemini Apps", titleUrl: "https://gemini.google.com/app/c/<conversationId>", time (ISO), products: ["Gemini Apps"], details?: [{name:"Request"|"Response", value}], userInteractions?: [{ userInteraction: { endpoint, request (JSON string), response (JSON string) } }] }`. Two variants can coexist per file; one entry = one exchange; group by conversation id from `titleUrl`; responses may be truncated or missing; empty export if Gemini Apps Activity was paused. Also support the HTML variant minimally (users will pick the default), or detect it and show "re-export as JSON" guidance.

**PAM v1.0** (https://portable-ai-memory.pages.dev/schema/memory-store/, JSON Schema Draft 2020-12 at `/schemas/portable-ai-memory.schema.json`):
- Top level (required): `schema: "portable-ai-memory"`, `schema_version: "1.0"`, `owner: { id }`, `memories[]`.
- Memory (required): `id`, `type`, `content`, `content_hash: "sha256:<64 hex>"`, `temporal.created_at`, `provenance.platform` (`^[a-z0-9_-]{2,32}$`), `custom_type` (required when type=custom else null).
- `type` enum: `fact, preference, skill, context, relationship, goal, instruction, identity, environment, project, custom`.
- `provenance`: `platform_user_id, conversation_ref, message_ref, extraction_method (llm_inference|explicit_user_input|api_export|browser_extraction|manual), extracted_at, extractor`.
- `temporal`: `updated_at, valid_from, valid_until, superseded_by`. `status`: `active|superseded|deprecated|retracted|archived`.
- Ferry → PAM type map: identity→identity, preference→preference, dislike→custom("dislike"), person→relationship, project→project, goal→goal, routine→custom("routine"), decision→custom("decision"), skill→skill, constraint→instruction, lesson→custom("lesson"). Ferry `hidden` → `retracted`, `superseded` → `superseded` + `temporal.superseded_by`.

---

## 8. WXT vs Plasmo: recommend **WXT**

| | WXT | Plasmo |
|---|---|---|
| Latest npm | **0.21.5** (2026-10-26); steady releases (0.21.2 to 0.21.5 Jul to Oct 2026) | **0.90.5**, last publish **2025-05-17** (18 months stale) |
| Repo | wxt-dev/wxt, pushed 2026-11-06, ~10.7k stars | PlasmoHQ/plasmo, pushed 2026-11-08 but no release since May 2025, 370 open issues |
| React | `@wxt-dev/module-react` **1.2.2** | built-in |
| Side panel | `entrypoints/sidepanel/` (MV3 `side_panel`) | supported |
Sources: `npm view wxt time`, `npm view plasmo version time`, `gh api repos/wxt-dev/wxt`, `gh api repos/PlasmoHQ/plasmo`. Vite-based, framework-agnostic, typed `browser.*`, shadow-root UI helper (`createShadowRootUi`) that fits the closed-shadow-DOM requirement. Plasmo uses Parcel and has had no release for 18 months; avoid.

---

## 9. WebCrypto Ed25519 in MV3, and compatibility with MemWal

- Chrome supports `Ed25519` in `generateKey`, `sign`, `importKey` since **Chrome 137** (MDN browser-compat-data `api.SubtleCrypto.generateKey.ed25519 = 137`; chromestatus feature 4913922408710144, milestone 137). `crypto.subtle` is available in MV3 service workers (secure context). Non-extractable private key works, `exportKey('raw', publicKey)` gives 32 bytes (verified in Node 26: private export throws `InvalidAccessError`). `CryptoKey` objects are structured-cloneable into IndexedDB, so they survive SW restarts.
- WebCrypto Ed25519 signatures are plain RFC 8032, byte-identical to `@noble/ed25519`, so the **request signature** (section 1.4) can be produced by a non-extractable key.
- **But the MemWal SDK cannot use it:** it takes raw key bytes, signs with `ed.signAsync(msg, this.privateKey)`, and builds the SEAL SessionKey with `Ed25519Keypair.fromSecretKey(this.privateKey)` (`dist/memwal.js`). Using a non-extractable key means re-implementing `signedRequest` + the `x-seal-session` build (a custom `Signer` subclass from `@mysten/sui/cryptography` whose `sign()` calls `crypto.subtle.sign`, then `SessionKey.create({ signer })` + `export()`), i.e. forking ~300 lines of the SDK.
- Sui-format public key / address from a raw 32-byte key: `new Ed25519PublicKey(raw32).toSuiAddress()` (= `blake2b256(0x00 ‖ pk)`, same as on-chain `derive_sui_address`); `toSuiPublicKey()` gives the flagged base64 form. MemWal `add_delegate_key` wants the **raw 32 bytes** (not flagged); `MEMWAL_AGENT_ID` is `hex(raw32)`.

**Decision:** generate the Ed25519 seed with `crypto.getRandomValues(32)` (or `generateDelegateKey()` from `@mysten-incubation/memwal/account`), immediately wrap it with a **non-extractable AES-GCM-256 WebCrypto key** stored as a `CryptoKey` in IndexedDB, store only the ciphertext. Unwrap into memory in the service worker on demand, pass `Uint8Array` to `MemWal.create`, `destroy()` + zero the buffer after idle. No passphrase prompt (kills the 90-second onboarding goal). Tradeoff, said plainly: this protects against disk/profile exfiltration of extension storage, not against code running inside the service worker. A fully non-extractable signer is a P2 hardening item (fork `signedRequest`). Tell the security lead.

---

## 10. dApp Kit (Next.js App Router)

- **Use `@mysten/dapp-kit-react` 2.1.45** (+ `@mysten/dapp-kit-core` 1.6.43, `@mysten/sui` 2.39.1). The old `@mysten/dapp-kit` 1.1.17 README says it "only supports the deprecated Sui JSON-RPC API and will not receive further updates" (migration: https://sdk.mystenlabs.com/sui/migrations/sui-2.0/dapp-kit). Since public JSON-RPC is gone, the old package is not an option.
- Slush: built in via `createDAppKit({ slushWalletConfig })` (dapp-kit-core types: `slushWalletConfig?: SlushWalletConfig | null`, plus `autoConnect`, `storage`, `walletInitializers`). `@mysten/slush-wallet` 1.3.8 also exists standalone.
- Setup (https://sdk.mystenlabs.com/dapp-kit/getting-started/react; App Router: put this in a `'use client'` provider component, import it in `app/layout.tsx`; wallet detection is client-only):

```tsx
'use client';
import { createDAppKit, DAppKitProvider } from "@mysten/dapp-kit-react";
import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { SuiGrpcClient } from "@mysten/sui/grpc";
export const dAppKit = createDAppKit({
  networks: ["mainnet"],
  createClient: (network) => new SuiGrpcClient({ network, baseUrl: "https://fullnode.mainnet.sui.io:443" }),
  slushWalletConfig: { appName: "Ferry" },
});
declare module "@mysten/dapp-kit-react" { interface Register { dAppKit: typeof dAppKit } }
// <DAppKitProvider dAppKit={dAppKit}><ConnectButton/></DAppKitProvider>
const dk = useDAppKit();
const r = await dk.signAndExecuteTransaction({ transaction: tx });   // r.Transaction?.digest | r.FailedTransaction
await dk.signPersonalMessage({ message });                            // for sponsor auth / SEAL SessionKey
```
- The browser client must be the public fullnode (gRPC-Web); Tatum is server-side only (section 2.1). `slushWalletConfig` field names beyond `appName`: check `SlushWalletConfig` type in dapp-kit-core when wiring (UNVERIFIED exact fields).

---

## 11. Latest stable versions (npm, 2026-11-09)

| Package | Version | | Package | Version |
|---|---|---|---|---|
| next | 16.4.5 | | zod | 4.6.7 |
| react / react-dom | 19.3.1 | | vitest | 5.1.0 |
| tailwindcss | 4.3.5 | | @playwright/test | 1.65.0 |
| motion | 14.10.1 | | turbo | 2.11.10 |
| dexie | 4.4.7 | | @neondatabase/serverless | 1.2.0 |
| fflate | 0.8.3 | | drizzle-orm | 0.45.4 |
| hono | 4.13.17 | | wxt | 0.21.5 |
| @mysten/sui | 2.39.1 | | @mysten/seal | 1.5.4 |
| @mysten/walrus | 1.2.39 | | @mysten/dapp-kit-react | 2.1.45 |
| @mysten/enoki | 1.3.4 | | @mysten-incubation/memwal | 0.1.13 |
| @suimpp/mpp | 0.9.0 | | mppx | 0.4.12 (pin; latest 0.17.5) |
| @noble/ed25519 | 3.2.0 (memwal uses ^2.3.0) | | @noble/curves | 2.4.0 |
| @protobuf-ts/grpc-transport | 2.11.1 | | @grpc/grpc-js | 1.14.7 |
Source: `npm view <pkg> version` run 2026-11-09. Note `zod` 4 is fine for memwal peer (`^3.23 || ^4`).

---

## Decisions recommended

1. **Writes only via `rememberBulk` (20 items, 10 pts).** Client-side token bucket per delegate key: 30 pts/min split ~20 recall / ~10 write; account-level 500 pts/h tracked too. Persist `job_ids` + idempotency keys in Dexie so imports resume after SW restart. Poll with `waitForRememberJobs` at ≥3 s. Ask Walrus team for an owner rate-limit override for the demo account.
2. **One `MemWal` instance per service-worker lifetime** (SEAL session reuse; #1157 hint). Map 503 `AUTH_UPSTREAM_UNAVAILABLE` and 429 → "cooling down" with `Retry-After`; only treat persistent 401 `AUTH_REJECTED` as revoked after an on-chain key check.
3. **All relayer traffic from the extension service worker** (`host_permissions`), because CORS is still broken. The web app talks to the extension via `externally_connectable` messaging for memory ops; server never sees memory text.
4. **Tatum is server-only via native gRPC** (`@protobuf-ts/grpc-transport` + `@grpc/grpc-js`, Node runtime, not Edge), behind a Ferry proxy with a 3 RPS token bucket and caching. Browser/extension use the public fullnode via gRPC-Web only for wallet flows; every "proof" read in the UI goes through the Tatum proxy and is labelled.
5. **Payments: MPP (`@suimpp/mpp@0.9.0`, `mppx@0.4.12` pinned) with Tatum re-verification + Neon digest store; x402 `exact`/`sui:mainnet` dialect from the same package as fallback.**
6. **Onboarding: wallet via `@mysten/dapp-kit-react` (Slush). Account creation + pairing through the relayer's sponsored-gas endpoint, fallback to user-paid gas.** zkLogin is P2.
7. **Delegate key: raw seed wrapped by a non-extractable AES-GCM WebCrypto key.** Non-extractable Ed25519 signer is P2.
8. **WXT** for the extension.
9. **Vault mode embeddings: 1536-dim `text-embedding-3-small` only.** Reject anything else before calling the relayer.
10. **F9 backups: Seal with the MemWal `seal_approve` policy (packageId = MEMWAL_PACKAGE_ID, id = bcs(owner)‖bcs(counter))**, no custom Move deploy. Upload via Tatum Storage first, fallback `@mysten/walrus` + mainnet upload relay.
11. **Claude memory comes from `memories.json` in the export**; keep the DOM read only for ChatGPT saved memories.
12. **MCP interop:** document `MEMWAL_NAMESPACE=ferry-core` instead of mirroring into `default`.
13. **Earnings without Tatum webhooks:** record earnings at Gate verification time; optional `SubscribeCheckpoints` worker for live display.

## Blockers / fallbacks

| Risk | Impact | Fallback |
|---|---|---|
| Rate limits (30 pts/min/key, 500 pts/h/account) | 300-memory seed takes ≥5 min of paced writes; chip recalls compete with writes | Bulk-only writes, recall cache, budgeted bucket; seed early (tonight); ask Walrus for override |
| Relayer CORS still broken | Web app can't call relayer | Extension SW does all relayer calls; server proxy only as last resort (would put plaintext through Ferry server: avoid, or label it) |
| Tatum gRPC is not gRPC-Web | No Tatum from browser/extension; `@suimpp/mpp` and `@mysten/walrus` can't use Tatum | Server-side native gRPC proxy; re-verify payments via Tatum in `onPayment` |
| Tatum free plan 3 RPS / 100k credits | Proxy can throttle during demo | Cache aggressively, batch with `BatchGetObjects`/`BatchGetTransactions`, credit meter in UI; upgrade plan if needed |
| No Tatum Sui notifications | "Payment arrives in 10 s" can't use webhooks | Write earnings at verify time; poll `GetTransaction`/`ListTransactions` every 5 s or `SubscribeCheckpoints` |
| Tatum Storage free-plan balance unknown; blob owned by Tatum | F9 might fail or not be "owned by your wallet" | `@mysten/walrus` + `upload-relay.mainnet.walrus.space` with the user's wallet as signer |
| `@suimpp/mpp` is third-party, pinned to old `mppx` 0.4.x | Version skew, unknown bugs | Pin mppx 0.4.12; x402 dialect in same package; last resort: own 402 + Tatum verification (~150 lines) |
| Sponsored gas via relayer `/sponsor` not tested e2e; also hit by CORS | Pairing may fail | User pays gas directly (one wallet popup either way) |
| MemWal SDK needs raw key | Can't claim "non-extractable key" | AES-GCM-wrapped seed; honest copy; P2 custom signer |
| Export formats only documented as of Feb 2026 | Parser breakage on Nov 2026 exports | Tolerant zod schemas; fixtures from fresh team exports on day 1 |
| Gemini Takeout defaults to HTML | Users upload HTML | Detect and show "choose JSON" guidance; minimal HTML parser if time |
