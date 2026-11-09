# Definition of done

Deadline: Tue 10 Nov 2026, 17:00 UTC. Feature freeze 08:00 UTC. Blog, video and README final 12:00 UTC. Form complete 15:00 UTC.

A box is ticked only with evidence: a link, a command output or a screenshot.

## Live product

- [ ] Web app deployed on Vercel at the production URL, landing counters show real Mainnet numbers
- [ ] Ferry Gate deployed on Vercel, `GET /v1/cards/:cardId/recall` returns 402 without payment and 200 after a real Mainnet USDC payment
- [ ] Extension release ZIP attached to a GitHub release, loads unpacked in a clean Chrome profile and pairs against the production web app
- [ ] At least 10 Walrus Memory writes on Mainnet (target 300+ real ones), count printed by the count script
- [ ] At least one real TripScout paid recall on Mainnet, visible on the Earnings page

## Repo

- [ ] Public repo https://github.com/Adwaitbytes/ferry with MIT LICENSE
- [ ] README proves Mainnet use: Mainnet proof table filled with real ids and explorer links
- [ ] README "How Ferry learned over time" numbers filled from real data
- [ ] README red-team table filled from the CI run
- [ ] No `{{FILL` left anywhere: `grep -rn "{{FILL" README.md docs` prints nothing
- [ ] `node scripts/copycheck.mjs` prints `copycheck: clean`

## Content

- [ ] dev.to blog published (tags walrus, sui, tatum, hackathon), 1,200 to 1,800 words, screenshots in place
- [ ] Demo video under 3:00, follows docs/VIDEO.md, uploaded and linked
- [ ] X thread approved by the owner and posted, tags @tatum_io @WalrusFoundation @WalrusProtocol @SuiNetwork
- [ ] LinkedIn version approved and posted
- [ ] docs/SUBMISSION.md complete, every field filled and every proof link opens
- [ ] Discord questions approved by the owner and posted

## Quality gates (PRD section 9)

- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes (security plugins, no dangerouslySetInnerHTML)
- [ ] `pnpm test` passes
- [ ] Coverage at 85 percent or more for core, importers, pay and distill
- [ ] Importer fixture tests with real anonymized exports: ChatGPT DAG edge cases (multiple roots, orphans, null parts, zero timestamps), Claude and Gemini
- [ ] Adapter contract tests with saved DOM snapshots per site
- [ ] Live adapter smoke test on chatgpt.com, claude.ai and gemini.google.com run manually before freeze
- [ ] Playwright e2e: onboarding and pairing
- [ ] Playwright e2e: Rescue
- [ ] Playwright e2e: Carry cross-site flow
- [ ] Playwright e2e: conflict resolution
- [ ] Playwright e2e: Blackout Drill
- [ ] Playwright e2e: Gate paid recall
- [ ] Playwright e2e: export and delete
- [ ] Recorded manual run of real Mainnet pairing
- [ ] Red-team suite green (81 cases)
- [ ] GitHub Actions CI green
- [ ] gitleaks secret scan clean
- [ ] Bundle key-pattern check passes
- [ ] Fresh clone to running app from the README in under 10 minutes, `.env.example` documents every variable
- [ ] Mainnet memory count script prints the README totals with account and explorer links

## Submission

- [ ] Tatum dashboard Account ID entered
- [ ] MEMWAL_AGENT_ID entered (delegate public key, 64 hex, no 0x) and matches the on-chain delegate key
- [ ] Form submitted before 17:00 UTC, confirmation saved
