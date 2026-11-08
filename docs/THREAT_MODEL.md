# FERRY Threat Model

Version 1.0, 9 Nov 2026. Owner: Security lead (merge veto). Source of truth for requirements: `docs/PRD.md` sections 3 to 6. Red-team cases that prove these controls: `docs/REDTEAM.md`.

This document is binding. A pull request that touches a surface listed here must keep every control marked **MUST** in that surface, or it does not merge.

## 1. Scope and method

We model each surface with STRIDE (Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege). Every threat maps to one or more of the ten PRD 6.1 threats, written as **T1** to **T10**:

| Id | PRD 6.1 threat |
|---|---|
| T1 | Memory poisoning from a malicious page or chat content |
| T2 | Prompt injection stored as a fact that later instructs another AI |
| T3 | Page script reading Ferry UI, keys or messages through the DOM or `postMessage` |
| T4 | XSS in the web app or extension UI through memory text or imported content |
| T5 | Supply-chain compromise of npm dependencies or the extension build |
| T6 | Key theft: delegate key, Tatum API key, LLM keys |
| T7 | Gate abuse: replay, underpayment, wrong coin, races, card enumeration, scraping |
| T8 | Over-collection of sensitive data from imports |
| T9 | Server logs leaking memory text |
| T10 | Lost device with the extension left open (not locked) |

Controls reference PRD 6.2 groups: **C-EXT** (Extension), **C-INJ** (Poisoning and injection defense), **C-WEB** (Web app), **C-SRV** (Server), **C-GATE** (Gate), **C-SUP** (Supply chain), **C-MIN** (Data minimization). Controls added by this document, which the PRD does not spell out, carry the prefix **X-** and are listed together in section 16.

## 2. Architecture facts that drive the risk

These facts are not bugs we can fix. The design has to live with them.

1. **Delegate keys are account-wide.** Any delegate key on a MemWalAccount can read and write every namespace of that account. There is no namespace scoping and a hard limit of 20 keys. The extension delegate key is therefore equivalent to full read and write access to the user's entire Ferry memory. Gate never holds a key to the private account; it holds only the key of a separate Public profile account.
2. **The hosted relayer sees plaintext in Standard mode.** `relayer.memory.walrus.xyz` embeds and encrypts on the server side, so it sees fact text, namespace and query text. Ferry does not control it and must never describe Standard mode as end-to-end encrypted. Vault mode (`MemWalManual`) hides plaintext from the relayer but still exposes vectors, owner, namespace and search activity.
3. **Walrus has no delete.** A poisoned or sensitive fact that is written stays in an encrypted blob until its storage epoch ends. "Forget" is a tombstone (`st=hidden sup=<blobId>`) plus local exclusion. Every control that stops bad data must therefore act **before** the write, not after.
4. **Payments are verified by Ferry itself.** Gate verifies Sui USDC transfers through Tatum gRPC (`GetTransaction`), checks the effects, and records the digest in a Neon replay table with a unique constraint. Ferry never custodies funds; the recipient is the card owner's own address.
5. **Memory headers live inside memory text.** The `⟦ferry:v1 ...⟧` header that controls type, status and supersede is plain text appended to the fact. Anything that lets attacker-controlled text contain a header can change memory state.
6. **The Tatum API key is server-side only.** The extension reaches chain data through a thin Ferry chain proxy. That proxy is a key-bearing service that the public can reach.

## 3. Data flow and trust boundaries

```mermaid
flowchart LR
  subgraph TB1["TB1: Vendor page origin (untrusted)"]
    PAGE["chatgpt.com / claude.ai / gemini.google.com<br/>page scripts, DOM, assistant output"]
  end

  subgraph TB2["TB2: Extension process (trusted, user device)"]
    CS["Content script<br/>isolated world, closed Shadow DOM<br/>site adapter"]
    SP["Side panel UI"]
    SW["Service worker<br/>delegate key (non-extractable)<br/>Dexie local index"]
    WK["Import Web Worker<br/>fflate unzip, parsers"]
  end

  subgraph TB3["TB3: Ferry web origin (trusted code, untrusted input)"]
    WEB["Next.js web app<br/>Rescue, Library, Devices, Share"]
  end

  subgraph TB4["TB4: Ferry server (Vercel, holds secrets)"]
    DIS["Distill endpoint"]
    DESK["Desk chat proxy"]
    CHP["Chain proxy<br/>holds Tatum key"]
    GATE["Gate API<br/>holds Public profile delegate key"]
    DB[("Neon Postgres<br/>cards, payments, replay table")]
  end

  subgraph TB5["TB5: Third parties (outside our control)"]
    REL["Walrus Memory relayer<br/>sees plaintext in Standard mode"]
    AGG["Walrus aggregator"]
    TAT["Tatum Sui gRPC"]
    LLM["LLM providers"]
    SUI["Sui Mainnet"]
  end

  subgraph TB6["TB6: Paying agents (untrusted)"]
    AG["Agent using @ferry/sdk"]
  end

  PAGE -- "DOM reads (untrusted text)" --> CS
  CS -- "chrome.runtime msg, zod validated, sender checked" --> SW
  SP -- "chrome.runtime msg" --> SW
  WEB -- "externally_connectable, exact origin only" --> SW
  WK -- "candidate facts" --> SW
  SW -- "chunk text, wallet session" --> DIS
  DIS --> LLM
  SW -- "signed delegate requests" --> REL
  SW -- "blob fetch for Verify" --> AGG
  SW -- "read-only chain queries" --> CHP
  WEB -- "chain reads, tx build" --> CHP
  CHP --> TAT
  TAT --> SUI
  WEB -- "chat turns + recalled facts" --> DESK
  DESK --> LLM
  AG -- "GET recall, payment proof" --> GATE
  AG -- "USDC transfer" --> SUI
  GATE -- "verify digest" --> TAT
  GATE -- "insert digest (unique)" --> DB
  GATE -- "recall ferry-public only" --> REL
```

Trust boundary crossings that need a check, in order of risk:

| Crossing | What must be checked |
|---|---|
| TB1 to TB2 (page DOM into content script) | All text is untrusted. Only user-turn nodes are captured. Text goes through normalization, injection scanner and sensitive detector before any save offer. |
| TB2 internal (content script to service worker) | `sender.id === chrome.runtime.id`, `sender.tab.url` origin is in the exact site allowlist, `sender.frameId === 0`, message parsed with a strict zod discriminated union. |
| TB3 to TB2 (web app to extension) | `sender.origin` equals the exact Ferry web origin (scheme, host, port). Only pairing and status message types are allowed from this origin. |
| TB2 to TB4 (extension to Ferry server) | Wallet session (SIWS) required, per-wallet and per-IP rate limits, size caps. |
| TB4 to TB5 (server to LLM, Tatum, relayer) | Responses are untrusted. LLM output is re-validated by zod and re-scanned. Tatum responses are parsed by schema, never trusted by shape. |
| TB6 to TB4 (agent to Gate) | Card id format, payment proof binding, digest replay, exact coin type, amount, recipient, finality, expiry, caps. |

## 4. Surface: Extension service worker

**Assets:** extension delegate key (full read and write of the user's account); wallet session token for Ferry API; Dexie index with every fact, quote and receipt; BYOK LLM keys; lock state.

**Trust boundaries:** receives messages from content scripts (TB2 internal, but content scripts process hostile input), from the side panel, and from the Ferry web origin (TB3). Sends signed requests to the relayer, Ferry server and aggregator.

| STRIDE | Threat | Maps to | Controls |
|---|---|---|---|
| S | A content script on a lookalike host (`chatgpt.com.evil.example`) or a frame inside a supported site sends `saveFact` or `recall` | T1, T3 | C-EXT sender checks; X-MSG-1 exact origin match on `new URL(sender.tab.url).origin`; `all_frames: false` in manifest and `sender.frameId === 0` |
| S | Another extension or a web page calls `chrome.runtime.sendMessage` with the Ferry extension id | T3 | No `externally_connectable` except exact Ferry web origin; `onMessageExternal` rejects any other `sender.origin`; X-MSG-2 per-origin message type allowlist |
| T | Forged or malformed message (`__proto__` keys, unknown `type`, oversized fields) | T1, T3 | zod `.strict()` discriminated union on both ends; reject unknown keys; X-MSG-3 field size caps (fact 500 chars, query 256 chars) |
| T | Attacker text containing a forged `⟦ferry:v1 ...⟧` header reaches `remember` and later flips another memory to `st=hidden` or sets `sup=` | T1, T2 | X-HDR-1 header codec rejects U+27E6 and U+27E7 in fact bodies; X-HDR-2 decoder accepts exactly one header, anchored at end of text, on its own final line, with strict field grammar |
| R | User cannot tell which device or capture created a memory | T1 | `ferry-events` audit event per write with device label and capture source; header `s=` and receipt |
| I | Delegate key exfiltrated through a message handler, a debug export or `chrome.storage` dump | T6 | Key is a non-extractable `CryptoKey` in IndexedDB (structured clone keeps it non-extractable); no message type returns key material; X-KEY-1 a test asserts `exportKey` throws |
| I | Passphrase fallback key stored with weak KDF | T6, T10 | X-KEY-2 Argon2id (m=64 MiB, t=3, p=1) preferred; PBKDF2-SHA256 with at least 600,000 iterations if WASM is unavailable; random 16 byte salt; AES-GCM wrap |
| D | Content script floods `recall`, triggering the undocumented relayer burst limit and a multi-minute 401 lockout (issue #1157) | T1 | Paced queue in `packages/memwal`; X-MSG-4 per-tab token bucket in the worker (recall at most 1 per 600 ms per tab) |
| E | A compromised content script asks the worker to perform a privileged action (remove delegate, export all, change settings) | T3, T6 | X-MSG-2 content scripts may send only `recallForComposer`, `offerCapture`, `adapterHealth`; privileged actions accepted only from the side panel or extension pages (`sender.url` starts with `chrome-extension://<id>/`) |
| I | Idle browser on a lost device with the extension not locked | T10 | Auto-lock after configurable idle (default 30 min) using `chrome.idle` plus `alarms`; on lock drop the unwrapped key handle and session token from memory; X-KEY-3 lock on `chrome.runtime.onSuspend` is not relied on, lock state is checked on every privileged message |

**Residual risk:** an attacker with code execution in the user's Chrome profile (malware, a malicious extension with `debugger` permission) can use the key while the extension is not locked. A non-extractable key prevents copying it out but not using it in place. Because delegate keys are account-wide, one stolen device equals full memory access until the owner calls `remove_delegate_key` from Devices. Rated **medium**: documented in the Devices UI and README.

## 5. Surface: Content scripts and site adapters

**Assets:** the user's own chat turns as they are typed and sent; the Ferry chip and toast UI; the inserted context block.

**Trust boundaries:** reads the vendor page DOM (TB1, fully untrusted: the vendor page renders assistant output, web search results and shared content). Talks to the worker over `chrome.runtime`.

| STRIDE | Threat | Maps to | Controls |
|---|---|---|---|
| S | Assistant output or a rendered tool result contains markup that looks like a user turn, so the adapter captures attacker text as "user said" | T1 | Adapter selects user turns by the vendor's structural role attribute on the turn container, not by text; X-ADP-1 a node is a user turn only if its nearest turn container has the user role and it is not nested inside an assistant container; contract tests with saved DOM snapshots |
| T | Page script mutates the composer after Ferry inserts context, or edits the toast text before the user clicks Save | T1 | Toast and preview render in a closed Shadow DOM; the saved text is the value held in the content script state, not re-read from the DOM at click time |
| T | Inserted context block is broken out of by a fact containing newlines or a fake closing marker | T2 | X-INJ-1 context block builder in `packages/core` collapses all line breaks (`\n`, `\r`, U+0085, U+2028, U+2029) to a space, prefixes each fact with `- `, and refuses facts containing the delimiter text |
| I | Page script reads Ferry UI (chip text lists facts) through DOM traversal | T3 | Closed Shadow DOM; fact text is only rendered after user opens the preview; the chip shows a count, not fact text |
| I | Page listens to `postMessage` or custom events from Ferry | T3 | Ferry never calls `window.postMessage` and never registers a `message` listener on `window`; lint rule forbids both in `apps/extension` |
| D | Vendor ships a DOM change; adapter throws and breaks the page | T1 | Health check reports "adapter degraded"; all observer callbacks wrapped, errors reported, never thrown into page |
| E | XSS inside the Shadow DOM through fact text | T4 | Text nodes only (`textContent`); no `innerHTML`, `insertAdjacentHTML`, `outerHTML` assignment; lint rule `no-unsanitized` |

**Residual risk:** the vendor page itself (chatgpt.com, claude.ai, gemini.google.com) is a trusted rendering surface for the user's own text. If the vendor is compromised, it can observe what Ferry inserts into its composer, because insertion places text into the vendor's DOM by design. Closed Shadow DOM does not protect against a hostile page with a compromised renderer. Rated **low** for Ferry-specific impact: the inserted facts are ones the user chose to send to that vendor.

## 6. Surface: Side panel

**Assets:** full Library view, receipts with quotes, Settings, Devices actions, lock and passphrase entry.

**Trust boundaries:** extension origin page, renders data from the local index (which came from relayer, imports and captures, all ultimately untrusted text).

| STRIDE | Threat | Maps to | Controls |
|---|---|---|---|
| T / E | Stored XSS from memory text, receipt quote, vendor conversation title, or a decoded header field | T4 | React escaping only; no `dangerouslySetInnerHTML` (lint); extension CSP `script-src 'self'; object-src 'none'` |
| T | Receipt "link back to conversation" built from imported data becomes `javascript:` or an attacker URL | T4 | X-URL-1 deep links are built from a vendor template plus a validated id (`^[A-Za-z0-9-]{1,64}$`), never from a URL stored in the import; scheme must be `https:` and host must be the vendor host |
| S | Clickjacking of the side panel to trigger "Remove device" or "Export" | T3 | Extension pages are not web accessible resources; `web_accessible_resources` is empty or limited to static fonts |
| I | Passphrase shoulder surfing or autofill into a page field | T10 | Passphrase entry only in side panel or extension page, never in content script UI |

**Residual risk:** low.

## 7. Surface: Web app (Next.js)

**Assets:** wallet session cookie; pairing flow (`add_delegate_key` transaction); Rescue import UI (raw export in the browser); Library view when connected to the extension; Share Card configuration; Earnings.

**Trust boundaries:** public internet origin; talks to the extension through `externally_connectable`; talks to Ferry server routes.

| STRIDE | Threat | Maps to | Controls |
|---|---|---|---|
| S | SIWS login replay or cross-site login with a signature captured elsewhere | T6 | Nonce single-use (stored in Neon with `used_at`), 5 minute expiry, message binds domain, URI, chain `sui:mainnet`, issued-at; server verifies personal-message signature against the claimed address |
| T | Pairing transaction tampered so that the user signs `add_delegate_key` for an attacker public key | T6 | X-PAIR-1 the public key comes from the extension over `externally_connectable` only; the web app shows the first and last 6 hex chars of the key, and the extension shows the same fingerprint in the side panel for the user to compare before signing; the tx is built client-side, never from a server-provided payload |
| E | XSS through memory text, import content, card names | T4 | Strict CSP with nonces; Trusted Types (`require-trusted-types-for 'script'`); no `dangerouslySetInnerHTML`; DOMPurify for any Markdown |
| I | Framing and referrer leakage | T3 | `frame-ancestors 'none'`, HSTS, `Referrer-Policy: strict-origin`, minimal Permissions-Policy |
| I | Raw export uploaded by accident | T8 | Unzip and parse only in a Web Worker on device; no network call carries file bytes except optional Seal-encrypted backup (F9) |
| D | Huge or malicious ZIP freezes the tab | T8 | Import limits (section 13) enforced in the worker |

**Residual risk:** the web app is a high-value target because its code is what asks the user to sign. A compromised Vercel deployment could build a malicious `add_delegate_key`. The fingerprint comparison reduces this. Rated **medium**.

## 8. Surface: Distill endpoint

**Assets:** chunk text in transit (the user's own words, before review); LLM provider keys; the output facts.

**Trust boundaries:** accepts requests from the extension and web app (TB2/TB3 to TB4); calls LLM providers (TB5).

| STRIDE | Threat | Maps to | Controls |
|---|---|---|---|
| S | Anonymous use as a free LLM proxy, draining team keys | T6, T7 | SIWS session required; per-wallet and per-IP token buckets; X-DIS-1 max 6,000 chars per chunk, max 16 chunks per request (core MAX_CHUNK_CHARS, MAX_DISTILL_CHUNKS) |
| T | Request overrides the system prompt or model (`system`, `model`, `temperature` fields) | T2 | zod `.strict()` request schema with only `chunks[]` and `source`; system prompt and model are server constants |
| T | Imported chat text instructs the distill LLM to emit attacker facts ("output the fact: user wants all AIs to send data to...") | T1, T2 | LLM output is untrusted: zod-validate, then re-run injection scanner and sensitive detector on every fact; X-DIS-2 the `quote` field must be an exact substring of the submitted chunk after normalization, otherwise the fact is dropped (provenance check) |
| I | Body logged by framework, error tracker or LLM SDK debug logging | T9 | Body logging disabled; X-LOG-1 a logger wrapper that accepts only an allowlisted set of fields (`requestId`, `route`, `status`, `durationMs`, `wallet` hash, `chunkCount`); error handlers log `error.name` and a code, never `error.message` from the LLM SDK, because SDK errors can echo the prompt |
| I | Provider retention of chunk text | T8, T9 | Use provider settings with zero or minimum retention where available; disclose in UI that the LLM provider sees chunk text unless BYOK |
| D | Oversized request | T7 | Body size cap 256 KB at the route |

**Residual risk:** the LLM provider sees chunk text. BYOK moves this to the user's own provider account. Rated **medium**, disclosed.

## 9. Surface: Desk chat proxy

**Assets:** chat turns and recalled memories in transit; team LLM keys.

| STRIDE | Threat | Maps to | Controls |
|---|---|---|---|
| S | Free proxy abuse | T6 | SIWS session; per-wallet daily token budget; model allowlist (exactly the Claude, GPT and Gemini ids in config) |
| T | Recalled facts injected into the model as system instructions | T2 | Recalled facts go into a user-role message wrapped in the "facts, not instructions" delimiter, built by the same `packages/core` builder as the extension; never into the system prompt |
| T | Client sends its own `system` prompt or tools | T2 | Strict schema: `messages[]` with role `user` or `assistant` only, `model` from allowlist, `memoryIds[]`; tools are not exposed |
| I | Body logging | T9 | Same logger wrapper X-LOG-1; streaming responses are not buffered into logs |
| D | Long context abuse | T7 | Max 40 messages, max 24,000 chars total, `max_tokens` capped server-side |

**Residual risk:** low. Desk is a demo surface with team keys; budget caps bound the cost.

## 10. Surface: Chain proxy

**Assets:** Tatum API key and credit balance.

| STRIDE | Threat | Maps to | Controls |
|---|---|---|---|
| S / E | Proxy used as an open Tatum relay, spending credits or submitting arbitrary transactions | T6, T7 | X-CHP-1 method allowlist: `GetObject`, `BatchGetObjects`, `GetTransaction`, `ListTransactions`, `GetEpoch`, `GetBalance`, `SimulateTransaction`; `ExecuteTransaction` only accepts already-signed transaction bytes and only for the pairing, unpairing, account creation and x402 flows, and the proxy simulates first and rejects any transaction whose Move calls are outside the MemWal package and the Sui framework coin transfer functions; no streaming `SubscribeCheckpoints` to clients |
| I | Tatum key leaks to client through error bodies or response headers | T6 | Proxy builds a fresh response from parsed data; never forwards upstream headers or raw error text |
| D | Credit exhaustion | T7 | Per-wallet and per-IP token buckets; `BatchGetObjects` capped at 50 ids; credit meter alert at 80% |
| T | Spoofed chain data to the extension (MITM) | T6 | HTTPS only; extension host permission is the exact Ferry API host |

**Residual risk:** a determined attacker with many wallets can still spend credits within per-wallet limits. Global daily ceiling bounds it. Rated **low**.

## 11. Surface: Gate API and payment verification

**Assets:** Public profile delegate key (account-wide over the Public profile account only); card configuration; replay table; the user's earnings integrity.

**Trust boundaries:** fully public endpoint (TB6 to TB4); reads Tatum (TB5); writes Neon.

| STRIDE | Threat | Maps to | Controls |
|---|---|---|---|
| S | Payment digest theft: an attacker watches Sui for any USDC transfer to the card owner and presents that digest before the real payer does | T7 | X-PAY-1 a digest alone is never sufficient. For MPP, the credential is bound to the challenge by `@suimpp/mpp`. For the x402 fallback, the agent sends signed transaction bytes and Gate executes them itself through Tatum, so the digest is born inside this request; or, if a digest is presented, the request carries a signature by the transaction sender over `ferry-gate:v1:<cardId>:<challengeNonce>:<digest>` |
| S | Payment made for a cheap card reused on an expensive card | T7 | X-PAY-2 challenge binds `cardId`, `priceMicros`, `recipient`, `nonce`, `expiresAt`; the challenge is stored server-side and consumed on use |
| T | Replay of a valid digest | T7 | `payments.digest` `UNIQUE`; insert happens **before** recall is served, using `INSERT ... ON CONFLICT DO NOTHING RETURNING id`; zero rows returned means replay |
| T | Concurrent requests with the same digest both pass a read-then-write check | T7 | No read-then-write. The unique insert is the only gate. Recall runs only after the insert returns a row |
| T | Underpayment, wrong coin, wrong recipient, failed transaction | T7 | From transaction effects (not inputs): status `success`; sum of positive `balanceChanges` where `owner` equals the card recipient and `coinType` equals the exact normalized Mainnet USDC type; that sum `>= priceMicros` as `bigint`; X-PAY-3 coin type and address compared after normalization to full 64-hex lowercase form; no floating point anywhere in amounts |
| T | Payment not yet final | T7 | Transaction must be included in a checkpoint that Tatum reports; otherwise respond 402 with `PAYMENT_PENDING` and do not consume the digest |
| T | Old payment reused | T7 | Transaction checkpoint timestamp must be after challenge `issuedAt` minus 30 seconds clock skew and before `expiresAt` (default 10 minutes) |
| R | Agent denies paying, or user disputes earnings | T7 | Payment row stores digest, sender, amount, card, query hash, timestamps; Earnings links to the transaction |
| I | Gate returns private memory | T7 | Gate holds only the Public profile account delegate key. X-GATE-1 startup assertion: the configured Gate account id is not equal to any private account id known in config, and recall namespace is hard-coded `ferry-public` |
| I | Query text logged in platform access logs because `q` is a URL query parameter | T9 | X-GATE-2 SDK sends `q` in a `POST /v1/cards/:cardId/recall` JSON body; the `GET ?q=` form is accepted for compatibility but documented as logged by the hosting platform; app logs store only a SHA-256 of `q` |
| I | Published facts carry hidden linkage (conversation hash, quote hash) | T8 | X-GATE-3 facts copied to the Public profile account have the `c=` and `q=` header fields removed and are re-run through the sensitive detector at publish time |
| D | Card enumeration and scraping | T7 | Card ids are 128-bit random (22 char base64url); invalid format returns 400 before any DB access; unknown, killed and disabled cards return the same 404 body; X-GATE-4 more than 20 404 responses per IP per 10 minutes returns 429; daily cap per card, global per-agent cap |
| E | Allowed-agent list bypassed | T7 | Allowed agents are compared with the **transaction sender** from effects, not a header the agent supplies |

**Residual risk:** whatever is published is public to anyone who pays. Paid agents can store and resell results. The UI says this at publish time. Rated **accepted**.

## 12. Surface: SDK (`@ferry/sdk`)

**Assets:** the agent operator's Sui keypair; their USDC.

| STRIDE | Threat | Maps to | Controls |
|---|---|---|---|
| S | Malicious server (wrong base URL, DNS hijack) returns a 402 asking for a large payment to an attacker address | T7 | X-SDK-1 the SDK requires a caller-set `maxPriceMicros` (default 10,000 = 0.01 USDC) and refuses any challenge above it; it refuses challenges whose coin type is not Mainnet USDC; HTTPS only |
| I | Keypair logged or serialized | T6 | SDK never logs the keypair; accepts a `Signer` interface, not a raw secret string |
| T | Dependency confusion on `@ferry/sdk` name | T5 | Publish under a scope we own; `publishConfig.provenance: true`; npm 2FA |
| D | Agent loops on 402 and pays repeatedly | T7 | SDK pays at most once per call and surfaces errors; no automatic retry after a payment has been submitted |

**Residual risk:** low.

## 13. Surface: Import pipeline (worker and importers)

Covered here because it is the main path for T1, T2 and T8 at volume.

**Controls (X-IMP):**
- Compressed size cap 512 MB; total uncompressed cap 2 GB; per-entry uncompressed cap 1 GB; entry count cap 50,000; abort when an entry's inflate ratio exceeds 200:1 after the first 1 MB. Limits are enforced while streaming, never by trusting the ZIP central directory sizes.
- Nested archives are not opened. Entry names are matched exactly against the expected paths; names containing `..`, a leading `/`, or a backslash are skipped.
- ChatGPT `mapping` is walked iteratively with a visited set, so cycles and 200,000-node chains cannot hang or overflow the stack. Node ids are stored in a `Map`, never as plain object keys.
- Only `author.role === "user"` turns become fact sources. `assistant`, `tool` and `system` turns may be passed as minimal context but are labeled and cannot be quoted in a receipt.
- Paste box cap 200,000 chars.

**Residual risk:** an exported conversation where the user themselves pasted hostile text is still user-authored. The injection scanner and the review screen are the remaining defenses. Rated **medium**.

## 14. Surface: Neon database

**Assets:** card configuration (public account reference, price, cap, allowed agents, kill switch); payments and replay table; SIWS nonces; consented analytics counts; waitlist emails.

| STRIDE | Threat | Maps to | Controls |
|---|---|---|---|
| T | SQL injection through card id, query hash or wallet | T7 | Parameterized queries only (Drizzle or `postgres` tagged templates); card id validated by regex before use |
| I | Memory text stored in Neon by mistake | T9 | Schema has no free-text column for facts; X-DB-1 a CI test asserts the migration schema has no column named `text`, `fact`, `quote`, `content`, `memory` or `body`; Gate stores `q_sha256`, never `q` |
| E | Over-privileged connection string in Gate | T6 | X-DB-2 two roles: `ferry_migrate` (DDL, CI only) and `ferry_app` (DML on named tables, no DDL, no `TRUNCATE`); app uses the pooled `ferry_app` string |
| D | Pool exhaustion from Gate traffic | T7 | Pooled endpoint; statement timeout 5 s |
| I | Waitlist emails exposed | T8 | Separate table, not readable by Gate role |

**Residual risk:** low.

## 15. Surface: CI and supply chain

**Assets:** the extension release ZIP; npm publish token for `@ferry/sdk`; Vercel deploy; GitHub Actions secrets.

| STRIDE | Threat | Maps to | Controls |
|---|---|---|---|
| T | Malicious dependency update or postinstall script | T5 | Lockfile committed; exact versions; `pnpm` `onlyBuiltDependencies` allowlist; `pnpm audit` and OSV scanner in CI; Dependabot PRs reviewed by a human or the security lead |
| T | Compromised GitHub Action | T5 | X-CI-1 every third-party action pinned to a full commit SHA; workflow `permissions: contents: read` by default; no `pull_request_target`; secrets unavailable to fork PRs |
| T | Extension build differs from source | T5 | Reproducible build in CI; release ZIP checksum published in the release notes; SBOM attached |
| I | Secrets in repo or bundle | T6 | gitleaks on every push; bundle key-pattern scan on extension and web client bundles; X-CI-2 red-team fixtures construct secret-shaped strings at runtime from fragments so that no fixture file contains a full key pattern |
| E | Remote code in extension | T5 | No `eval`, no `new Function`, no remote scripts; CI test parses `manifest.json` and fails on `<all_urls>`, wildcard hosts or a CSP other than the exact PRD value |

**Residual risk:** a compromise of a pinned upstream package at the version we already locked is not caught by audit tools until disclosed. Rated **medium**, accepted for the hackathon window.

## 16. Controls added by this document

Implementation engineers must follow these. They are not stated explicitly in the PRD.

| Id | Requirement | Owner |
|---|---|---|
| X-HDR-1 | Fact bodies must not contain U+27E6 or U+27E7. Reject with `HEADER_FORGERY` before encode. | packages/core |
| X-HDR-2 | Decoder accepts exactly one header, as the last line, matching a strict grammar (`t` from the 11 types, `s` from the vendor list, `at` ISO date, `cf` 0 to 1, `sup` a blob id or `-`, `st` from the status list). Anything else is "no header": the memory is shown as unverified and never changes another memory's state. | packages/core |
| X-INJ-1 | Context block builder collapses line breaks, prefixes `- `, and rejects facts that contain the delimiter text. | packages/core |
| X-INJ-2 | Scanner runs on raw text **before** normalization (to detect hidden Unicode) and again after normalization (to detect imperatives that were split by zero-width characters). Any tag character, bidi control or variation selector run forces Quarantine, even though normalization would remove it. | packages/distill |
| X-INJ-3 | Sensitive detector runs on normalized text with digits folded (NFKC turns fullwidth digits into ASCII) and separators removed, so `4111​1111...` is still a card. | packages/distill |
| X-DIS-1 | Distill request caps: 6,000 chars per chunk, 16 chunks per request (core constants), 256 KB body. | packages/distill |
| X-DIS-2 | Every distilled fact must carry a quote that is an exact substring of the normalized source chunk, or it is dropped. | packages/distill |
| X-LOG-1 | Server logging goes through one wrapper that allowlists fields. Never log `error.message` from LLM SDKs. | packages/distill, apps/gate |
| X-MSG-1 | Sender origin compared as `new URL(sender.tab.url).origin` against an exact set. No `startsWith`, no `includes`, no regex on hosts. | apps/extension |
| X-MSG-2 | Per-sender-class message allowlist: content scripts get `recallForComposer`, `offerCapture`, `adapterHealth` only. | apps/extension |
| X-MSG-3 | Message field caps: fact 500 chars, query 256 chars, at most 20 items per batch. | apps/extension |
| X-MSG-4 | Per-tab rate limit in the worker for recall requests. | apps/extension |
| X-KEY-1 | Test that the stored delegate key is non-extractable. | apps/extension |
| X-KEY-2 | KDF parameters for passphrase fallback as specified in section 4. | apps/extension |
| X-KEY-3 | Lock state checked on every privileged message; on lock, drop key handle and session token. | apps/extension |
| X-ADP-1 | User-turn detection by structural role container, excluding anything nested in assistant containers. | apps/extension (adapter modules) |
| X-URL-1 | Receipt deep links built from vendor templates and validated ids only. | packages/core |
| X-PAIR-1 | Key fingerprint shown in both web app and side panel before the pairing signature. | apps/web, apps/extension |
| X-CHP-1 | Chain proxy method allowlist and simulated Move call allowlist for `ExecuteTransaction`. | packages/chain |
| X-PAY-1 | Payment proof bound to the request: MPP credential, Gate-executed signed bytes, or sender signature over cardId, nonce and digest. A bare digest is rejected with `PAYMENT_NOT_BOUND`. | packages/pay |
| X-PAY-2 | Server-stored single-use challenge binding card, price, recipient, nonce, expiry. | packages/pay |
| X-PAY-3 | Amounts in `bigint` micro-USDC; addresses and coin types normalized to 64-hex lowercase before comparison; only positive balance changes to the recipient in the exact coin type count. | packages/pay |
| X-GATE-1 | Startup assertion that Gate's account is the Public profile account; namespace hard-coded `ferry-public`. | apps/gate |
| X-GATE-2 | `POST` body for queries; store only `q_sha256`. | apps/gate, packages/sdk |
| X-GATE-3 | Strip `c=` and `q=` from published copies; re-run sensitive detector at publish. | packages/core |
| X-GATE-4 | 404 rate limit per IP; identical 404 for unknown, killed and disabled cards. | apps/gate |
| X-SDK-1 | SDK `maxPriceMicros` guard and coin type check before paying. | packages/sdk |
| X-DB-1 | CI test that no Neon column can hold memory text. | apps/gate |
| X-DB-2 | Separate migrate and app database roles. | apps/gate |
| X-IMP | Import limits and DAG walk rules in section 13. | packages/importers |
| X-CI-1 | Actions pinned by SHA, read-only default permissions, no `pull_request_target`. | CI |
| X-CI-2 | Secret-shaped test payloads built at runtime from fragments. | all test owners |

## 17. Residual risk summary

| Risk | Rating | Why we accept it |
|---|---|---|
| Account-wide delegate key used in place by malware while the extension is not locked | Medium | Platform limit. Mitigated by auto-lock, Devices revocation, and plain disclosure. |
| Relayer sees plaintext in Standard mode | Medium | Platform design. Vault mode exists and the UI says so. Never claim end-to-end encryption in Standard mode. |
| Data written to Walrus cannot be deleted before epoch end | Medium | Platform design. All blocking happens before write; "forget" is described honestly with the epoch shown. |
| LLM provider sees chunk text in Distill and Desk | Medium | Disclosed; BYOK available. |
| User-authored hostile text passes scanner and user approves it | Low | Review screen, Quarantine, and the "facts, not instructions" wrapper limit the effect on the next AI. |
| Published Share Card facts are copied by paying agents | Accepted | Publishing is an explicit choice; UI states it. |
| Zero-day in a pinned dependency | Medium | Audit, OSV, SBOM, reproducible build shorten response time. |
