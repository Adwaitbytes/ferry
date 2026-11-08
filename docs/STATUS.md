# Status

Times in UTC. Newest first. Each entry: time, owner, what changed, what is next.

## 2026-11-08

- 19:05 lead: `packages/core` contracts frozen (schemas, header codec, normalization, extension messages, HTTP APIs, Gate result). 23 tests, 100% lines. Changes to core now go through the lead.
- 18:55 lead: monorepo initialized (pnpm 12, Turborepo, TS 6.0 strict, ESLint 10 with security rules and banned HTML sinks). Research, security and design leads started in parallel.
- 19:01 lead: DESIGN.md, THREAT_MODEL.md, REDTEAM.md (81 cases), SECURITY.md landed. CI workflow, copycheck and bundle key scan scripts added. Neon project ferry created.
- 19:11 lead: research complete (RESEARCH.md). packages/ai landed (Desk failover streaming, LLM JSON adapter). Spawned memwal, chain, pay, extension, adapters, web engineers. CI fixed locally (gitleaks CLI, minimatch override); push held until agent packages land so the lockfile matches.
- 19:18 distill: packages/distill landed (scanInjection, detectSensitive, screenCandidate, distill/capture/judge prompts and parsers, dedupe, Distill route handler with allowlist logger). 206 tests incl. 40 RT cases, 100% lines, 93.9% branches. Plugs into packages/ai createLlmJson as-is. Next: lead to review proposed core diffs (X-HDR-1 reject, X-INJ-1 delimiter rejection).
