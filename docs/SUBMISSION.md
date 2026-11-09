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
| Tatum dashboard Account ID | {{FILL: Tatum dashboard Account ID}} |
| MEMWAL_AGENT_ID | aa0e1b0af8be8765d65d86876ca7034259fced902035d29c2420cdca5354e2ff |
| Public repo | https://github.com/Adwaitbytes/ferry |
| License | MIT |
| Live web app | https://ferry-memory.vercel.app |
| Ferry Gate | https://ferry-gate.vercel.app |
| Blog post | {{FILL: dev.to URL}} |
| Demo video | {{FILL: video URL}} |
| Extension ZIP | https://github.com/Adwaitbytes/ferry/releases/tag/v0.1.0-beta.1 |
| Team | Adwait, Adwait Keshari |
| X post | {{FILL: X thread URL}} |
| LinkedIn post | {{FILL: LinkedIn post URL}} |

Note on MEMWAL_AGENT_ID: per the Walrus Memory docs it is the delegate public key in hex without `0x`, not the Sui address and not the account id. Get it from the extension's Devices panel or `memwal.getPublicKeyHex()`, and check it appears in the account's delegate keys on chain.

## Description

Every AI assistant keeps a private profile of you, and none of it is yours. Switch from ChatGPT to Claude and you start over.

Ferry moves that memory into a store you own on Walrus Mainnet and brings it back into whichever AI you open next. A Chrome extension captures facts you tell any AI (with your approval) and offers the relevant ones when you start typing in another, inserted only when you click. Rescue imports your ChatGPT, Claude and Gemini exports, parsed on your own device, with the exact quote behind every fact. When facts conflict, Ferry asks which is true and supersedes the old one on Walrus with its history intact. The Blackout Drill cuts off a model mid chat and continues on another with 0 facts lost.

Ferry Gate lets agents pay for memory you choose to share: HTTP 402, 0.01 USDC on Sui over MPP, verified through Tatum and paid straight to your address. Gate reads only a separate Public profile account, so it can never see private memory.

Every chain read goes through Tatum's Sui gRPC gateway: delegate keys, blob epochs, payment verification and price data. Every fact carries a header on Walrus with its sources, date, confidence, supersede link and status. We state the limits plainly: Standard mode is not end to end encrypted (Vault mode with Seal is), and forget means hidden until the storage epoch ends, because Walrus has no delete.

## How each requirement is met

| Requirement | How Ferry meets it | Proof |
|---|---|---|
| Walrus Memory writing on Mainnet, at least 10 memories | 312 memories in the team's MemWalAccount, written by the extension through `rememberBulk` | Account: https://suiscan.xyz/mainnet/object/0x2707ca76b9a7ed62b1405089b745738e64f6d83e61763668d9c26c7572c691d2. Count script output: {{FILL: link}}. Sample blob: {{FILL: blob link}}. Code: [packages/memwal/src/memory.ts](https://github.com/Adwaitbytes/ferry/blob/main/packages/memwal/src/memory.ts) |
| Tatum RPC or Data APIs for onchain data | Sui gRPC gateway for account, delegate, blob and payment reads; Data API for prices | [packages/chain/src/tatum.ts](https://github.com/Adwaitbytes/ferry/blob/main/packages/chain/src/tatum.ts), [packages/chain/src/payment.ts](https://github.com/Adwaitbytes/ferry/blob/main/packages/chain/src/payment.ts), [packages/chain/src/price.ts](https://github.com/Adwaitbytes/ferry/blob/main/packages/chain/src/price.ts). Credits used: {{FILL: Tatum credits used}}. Proofs page: {{FILL: Proofs page URL}} |
| Published blog post (what it does, Tatum and Walrus use, how it learned over time) | dev.to post | {{FILL: dev.to URL}} |
| Working demo | Live web app, Gate, extension ZIP, video under 3:00 | https://ferry-memory.vercel.app, https://ferry-gate.vercel.app, https://github.com/Adwaitbytes/ferry/releases/tag/v0.1.0-beta.1, {{FILL: video URL}} |
| Public repo | MIT, README with Mainnet proof table | https://github.com/Adwaitbytes/ferry |
| Best Walrus Memory: memories that visibly change the product | Conflicts supersede facts on Walrus; cross-app insertion uses facts told to other AIs; receipts merge across vendors | Conflicts resolved: {{FILL: count}}. Cross-app insertions: {{FILL: count}}. Supersede example blob: {{FILL: blob link}} |
| Best Use of Agent Payments: x402 or MPP, settled on Sui | MPP 402 flow with Sui USDC to the user's address, verified through Tatum, replay protected in Neon | [packages/pay/src/gateway.ts](https://github.com/Adwaitbytes/ferry/blob/main/packages/pay/src/gateway.ts). Payment tx: {{FILL: payment tx explorer link}}. Paid recalls: {{FILL: count}} |
| Bonus: post on X or LinkedIn tagging @tatum_io and @WalrusFoundation | Thread and LinkedIn post | {{FILL: X thread URL}}, {{FILL: LinkedIn post URL}} |

## Discord questions for Adwait

Drafted for the Tatum and Walrus hackathon channels. Post only after Adwait approves.

**1. Multiple awards**

> Hi team, quick rules question for Total Recall. We're submitting Ferry to Track 2 (Smart Agents for Real Life). It also uses Walrus Memory as its core store and takes agent payments over MPP on Sui. Can one project be considered for Track 2 and also for Best Walrus Memory and Best Use of Agent Payments, or do we need to pick one? Thanks.

**2. AI Builder entry**

> Another one: if we build a small separate app on ai.tatum.io, can it enter the AI Builder category as its own submission alongside our main project, or does each team get one entry? Happy to keep it fully separate if that's required.
