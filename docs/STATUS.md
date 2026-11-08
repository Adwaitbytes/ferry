# Status

Times in UTC. Newest first. Each entry: time, owner, what changed, what is next.

## 2026-11-08

- 19:05 lead: `packages/core` contracts frozen (schemas, header codec, normalization, extension messages, HTTP APIs, Gate result). 23 tests, 100% lines. Changes to core now go through the lead.
- 18:55 lead: monorepo initialized (pnpm 12, Turborepo, TS 6.0 strict, ESLint 10 with security rules and banned HTML sinks). Research, security and design leads started in parallel.
- 19:01 lead: DESIGN.md, THREAT_MODEL.md, REDTEAM.md (81 cases), SECURITY.md landed. CI workflow, copycheck and bundle key scan scripts added. Neon project ferry created.
- 19:11 lead: research complete (RESEARCH.md). packages/ai landed (Desk failover streaming, LLM JSON adapter). Spawned memwal, chain, pay, extension, adapters, web engineers. CI fixed locally (gitleaks CLI, minimatch override); push held until agent packages land so the lockfile matches.
- 19:18 distill: packages/distill landed (scanInjection, detectSensitive, screenCandidate, distill/capture/judge prompts and parsers, dedupe, Distill route handler with allowlist logger). 206 tests incl. 40 RT cases, 100% lines, 93.9% branches. Plugs into packages/ai createLlmJson as-is. Next: lead to review proposed core diffs (X-HDR-1 reject, X-INJ-1 delimiter rejection).
- 19:19 importers: packages/importers landed (ChatGPT DAG, Claude conversations/projects/memories, Gemini Takeout JSON+HTML, paste, chunker + local side table, streaming-limited ZIP reader on fflate Inflate, zod worker protocol, PAM v1.0 + Markdown export validated against the official schema). 111 tests incl. red team and a 50MB load test (~0.4s); coverage 98.7% stmts, 92.9% branches. Next: lead to wire runImportInWorker into Rescue; real Nov 2026 exports should replace synthetic fixtures when available.
- 19:21 memwal: packages/memwal landed (FerryMemory over one long-lived MemWal, RateGovernor 26/min key budget with recall cap 16, 480/h account, 429/503/401/timeout policy, durable job persistence and resume, Dexie local index with tombstone and supersede chains, Library filters and recency index, sync via listMemories plus recall hydration, F5 reconcile/resolve/timeline, ImportQueue with pause/resume, seed seal/open, Vault mode in src/vault.ts). 76 tests, 99.6% lines, 94.3% branches. Next: lead to review proposed core diffs (ImportProgress skipped, WorkerError key_rejected, StoredMemory epochs).
