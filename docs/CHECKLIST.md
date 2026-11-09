# Definition of done

Deadline: Tue 10 Nov 2026, 17:00 UTC. Feature freeze 08:00 UTC. Blog, video and README final 12:00 UTC. Form complete 15:00 UTC.

A box is ticked only with evidence: a link, a command output or a screenshot.

## Live product

- [x] Web app deployed: https://ferry-memory.vercel.app
- [x] Ferry Gate deployed: https://ferry-gate.vercel.app (Mainnet, 402 verified) and https://ferry-gate-testnet.vercel.app (402 then 200 after a real payment; fallback logged in DECISIONS.md)
- [x] Extension ZIP on https://github.com/Adwaitbytes/ferry/releases/tag/v0.1.0-beta.1; loaded and paired in the owner's Chrome
- [x] 312 real memories on Walrus Mainnet, 0 failed; blobs spot-checked on the public aggregator
- [x] Real TripScout paid recall on Sui Testnet (fallback, no funds for Mainnet): https://suiscan.xyz/testnet/tx/BfqBDhWvz3gcy9Dys1mUPxjm4Tvisu6uLSnT2KQ1j4Gv

## Repo

- [x] Public repo https://github.com/Adwaitbytes/ferry with MIT LICENSE
- [x] README Mainnet proof table filled with real ids and explorer links
- [ ] README "How Ferry learned over time" numbers filled from real data
- [x] README red-team table: 81 of 81 ids, 108 cases, green in CI
- [ ] No `{{FILL` left anywhere: `grep -rn "{{FILL" README.md docs` prints nothing
- [x] `node scripts/copycheck.mjs` prints `copycheck: clean`

## Content

- [ ] dev.to blog published (tags walrus, sui, tatum, hackathon), 1,200 to 1,800 words, screenshots in place
- [ ] Demo video under 3:00, follows docs/VIDEO.md, uploaded and linked
- [ ] X thread approved by the owner and posted, tags @tatum_io @WalrusFoundation @WalrusProtocol @SuiNetwork
- [ ] LinkedIn version approved and posted
- [ ] docs/SUBMISSION.md complete, every field filled and every proof link opens
- [ ] Discord questions approved by the owner and posted

## Quality gates (PRD section 9)

- [x] `pnpm typecheck` passes (CI f5f9308)
- [x] `pnpm lint` passes (CI f5f9308)
- [x] `pnpm test` passes (CI f5f9308)
- [x] Coverage at 85 percent or more for core, importers, pay and distill
- [ ] Importer fixture tests with real anonymized exports: ChatGPT DAG edge cases (multiple roots, orphans, null parts, zero timestamps), Claude and Gemini
- [x] Adapter contract tests with saved DOM snapshots per site, plus live checks on Gemini and Claude
- [ ] Live adapter smoke test on chatgpt.com, claude.ai and gemini.google.com run manually before freeze
- [x] Playwright e2e: onboarding and pairing (40 of 40 specs green in CI)
- [x] Playwright e2e: Rescue (40 of 40 specs green in CI)
- [x] Playwright e2e: Carry cross-site flow (40 of 40 specs green in CI)
- [x] Playwright e2e: conflict resolution (40 of 40 specs green in CI)
- [x] Playwright e2e: Blackout Drill (40 of 40 specs green in CI)
- [x] Playwright e2e: Gate paid recall (40 of 40 specs green in CI)
- [x] Playwright e2e: export and delete (40 of 40 specs green in CI)
- [x] Real Mainnet pairing done in the owner's Chrome (account 0x2707...c691d2, delegate aa0e1b0a...5354e2ff)
- [x] Red-team suite green: 81 of 81 ids, 108 cases
- [x] GitHub Actions CI green (f5f9308: verify, e2e, secrets, osv, sbom)
- [x] gitleaks secret scan clean over full history
- [x] Bundle key-pattern check passes
- [x] Fresh clone: install 63 s, build 14 s (QA run); `.env.example` documents every variable
- [ ] Mainnet memory count script prints the README totals with account and explorer links

## Submission

- [x] Tatum dashboard Account ID in SUBMISSION.md: 6af19666059c9eaaf7a6e2bd
- [x] MEMWAL_AGENT_ID in SUBMISSION.md: aa0e1b0af8be8765d65d86876ca7034259fced902035d29c2420cdca5354e2ff, matches the on-chain delegate key
- [ ] Form submitted before 17:00 UTC, confirmation saved
