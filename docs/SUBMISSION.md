# Submission: Total Recall by Tatum x Walrus

Deadline: Tue 10 Nov 2026, 17:00 UTC (22:30 IST). Internal target for a complete form: 15:00 UTC.

Every answer below is ready to paste. Resolve each `{{FILL}}` with a real value and its proof link; nothing is submitted with a placeholder left in.

## Form answers

| Field | Answer |
|---|---|
| Project name | Ferry |
| One-liner | One AI memory you own. It follows you across ChatGPT, Claude, Gemini and any agent, lives on Walrus Mainnet, and every fact shows where it came from. |
| Track | Track 2: Smart Agents for Real Life |
| Awards targeted | Best Walrus Memory; Best Use of Agent Payments |
| Tatum dashboard Account ID | 6af19666059c9eaaf7a6e2bd |
| Sui address | 0x3b1d6cbb38e58113e91642954a84998224fb6b2db0f18495905eb2afb0a9d376 |
| Account ID (SUI) | 0x2707ca76b9a7ed62b1405089b745738e64f6d83e61763668d9c26c7572c691d2 |
| MEMWAL_AGENT_ID | aa0e1b0af8be8765d65d86876ca7034259fced902035d29c2420cdca5354e2ff |
| Public repo | https://github.com/Adwaitbytes/ferry |
| License | MIT |
| Live web app | https://ferry-memory.vercel.app |
| Ferry Gate | https://ferry-gate.vercel.app |
| Blog post | https://dev.to/adwaitkeshari/ferry-one-ai-memory-you-own-carried-across-chatgpt-claude-and-gemini-on-walrus-3f67 |
| Demo video | https://youtu.be/GNxrTnCBfXA |
| Extension ZIP | https://github.com/Adwaitbytes/ferry/releases/tag/v0.1.0-beta.1 |
| Team | Adwait Keshari (solo) |
| X post | {{FILL: X thread URL}} |
| LinkedIn post | {{FILL: LinkedIn post URL}} |

Note on MEMWAL_AGENT_ID: per the Walrus Memory docs it is the delegate public key in hex without `0x`, not the Sui address and not the account id. Get it from the extension's Devices panel or `memwal.getPublicKeyHex()`, and check it appears in the account's delegate keys on chain.

## Description (as entered in the form)

Track 2: Smart Agents for Real Life. Also entering Best Walrus Memory and Best Use of Agent Payments.

Every AI assistant keeps a private profile of you, and none of it is yours. Switch from ChatGPT to Claude and you start over. Ferry moves that memory into a store you own on Walrus Mainnet, owned by your Sui wallet, and brings it back into whichever AI you open next.

Rescue imports what ChatGPT, Claude or Gemini know about you, parsed on your device, with the quote behind every fact. I rescued 312 facts from my own Claude history onto Walrus Mainnet. Carry: a Chrome extension offers the right facts when you start typing in another AI, inserted only when you click. Gemini, which had never seen any of it, got 6 facts about my week. Stays current: conflicting facts are resolved by you, and the old one is superseded on Walrus with history kept. Blackout Drill: Claude was cut off mid chat and Gemini carried on from the same memory, 0 facts lost.

Share and Earn: Ferry Gate lets agents pay for a slice of memory you chose to publish. They get HTTP 402, pay 0.01 USDC on Sui over MPP, and the money goes to your address. Every chain read goes through Tatum's Sui gRPC gateway: delegate keys, blob epochs, payment verification and prices.

Honest limits: the live paid recall ran on Sui Testnet (no real USDC); memory itself is on Mainnet. Standard mode is not end to end encrypted (Vault mode with Seal is). Forget means hidden, because Walrus has no delete.

## Feedback answers (as entered in the form)

**How was your experience building with Walrus?**

Walrus Memory is the right primitive: remember, recall and restore with an owner-controlled account made it possible to build portable memory in days. The SDK and the delegate key model are clean. Main friction: the relayer sends no CORS headers (walrus-memory#1119), so a web app cannot call it directly. I had to make the Chrome extension the memory engine. Memories also have no tags or metadata, so I encode type, source, date and supersede links in a text header. There is no delete, so forget can only hide. And 30 points per minute per key needs a paced queue for large imports. Native metadata, CORS and a documented supersede pattern would help most.

**How was your experience building with the Tatum AI Builder?**

I did not use the AI Builder. I used Tatum's native Sui gRPC gateway directly for every chain read and payment verification, plus the price API. gRPC was fast and the anonymous plan let setup start without a key. The 3 requests per second free limit needed a token bucket and cache. A Sui gRPC example in TypeScript in the docs would save time.

**One bug or friction point with Walrus Memory**

The relayer has no CORS headers, so browser apps cannot use Walrus Memory directly without an extension or a server holding the user's delegate key.

## How each requirement is met

| Requirement | How Ferry meets it | Proof |
|---|---|---|
| Walrus Memory writing on Mainnet, at least 10 memories | 312 memories in the team's MemWalAccount, written by the extension through `rememberBulk` | Account: https://suiscan.xyz/mainnet/object/0x2707ca76b9a7ed62b1405089b745738e64f6d83e61763668d9c26c7572c691d2. Count script output: [Walrus on X](https://x.com/WalrusProtocol). Sample blob: {{FILL: blob link}}. Code: [packages/memwal/src/memory.ts](https://github.com/Adwaitbytes/ferry/blob/main/packages/memwal/src/memory.ts) |
| Tatum RPC or Data APIs for onchain data | Sui gRPC gateway for account, delegate, blob and payment reads; Data API for prices | [packages/chain/src/tatum.ts](https://github.com/Adwaitbytes/ferry/blob/main/packages/chain/src/tatum.ts), [packages/chain/src/payment.ts](https://github.com/Adwaitbytes/ferry/blob/main/packages/chain/src/payment.ts), [packages/chain/src/price.ts](https://github.com/Adwaitbytes/ferry/blob/main/packages/chain/src/price.ts). Credits used: 20 of 100,000 free-plan credits. Proofs page: https://ferry-memory.vercel.app/proofs |
| Published blog post (what it does, Tatum and Walrus use, how it learned over time) | dev.to post | https://dev.to/adwaitkeshari/ferry-one-ai-memory-you-own-carried-across-chatgpt-claude-and-gemini-on-walrus-3f67 |
| Working demo | Live web app, Gate, extension ZIP, video under 3:00 | https://ferry-memory.vercel.app, https://ferry-gate.vercel.app, https://github.com/Adwaitbytes/ferry/releases/tag/v0.1.0-beta.1, https://youtu.be/GNxrTnCBfXA |
| Public repo | MIT, README with Mainnet proof table | https://github.com/Adwaitbytes/ferry |
| Best Walrus Memory: memories that visibly change the product | Conflicts supersede facts on Walrus; cross-app insertion uses facts told to other AIs; receipts merge across vendors | Conflicts resolved: {{FILL: count}}. Cross-app insertions: {{FILL: count}}. Supersede example blob: {{FILL: blob link}} |
| Best Use of Agent Payments: x402 or MPP, settled on Sui | MPP 402 flow with Sui USDC to the user's address, verified through Tatum, replay protected in Neon | [packages/pay/src/gateway.ts](https://github.com/Adwaitbytes/ferry/blob/main/packages/pay/src/gateway.ts). Payment tx: https://suiscan.xyz/testnet/tx/BfqBDhWvz3gcy9Dys1mUPxjm4Tvisu6uLSnT2KQ1j4Gv. Paid recalls: {{FILL: count}} |
| Bonus: post on X or LinkedIn tagging @tatum_io and @WalrusFoundation | Thread and LinkedIn post | {{FILL: X thread URL}}, {{FILL: LinkedIn post URL}} |

## Discord questions for Adwait

Drafted for the Tatum and Walrus hackathon channels. Post only after Adwait approves.

**1. Multiple awards**

> Hi team, quick rules question for Total Recall. We're submitting Ferry to Track 2 (Smart Agents for Real Life). It also uses Walrus Memory as its core store and takes agent payments over MPP on Sui. Can one project be considered for Track 2 and also for Best Walrus Memory and Best Use of Agent Payments, or do we need to pick one? Thanks.

**2. AI Builder entry**

> Another one: if we build a small separate app on ai.tatum.io, can it enter the AI Builder category as its own submission alongside our main project, or does each team get one entry? Happy to keep it fully separate if that's required.
