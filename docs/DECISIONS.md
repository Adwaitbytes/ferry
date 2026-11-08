# Decisions

Format: date, decision, why, tradeoff. Fallbacks taken are marked FALLBACK.

- 2026-11-08: TypeScript pinned to 6.0.3, not 7.0. typescript-eslint 8.72 supports TS below 6.1 only, and typed lint rules are a quality gate. Tradeoff: we skip the faster native compiler.
- 2026-11-08: Workspace packages export TypeScript source (no per-package build) except `@ferry/sdk`, which is published. Bundlers (Next.js, WXT, Vercel) compile them. Tradeoff: consumers must use a bundler, which every Ferry surface does.
- 2026-11-08: Memory header uses the PRD format with `s=` as a comma list, so one memory can carry merged receipts ("heard in ChatGPT and Claude"). Fact text is NFKC normalized and stripped of the header brackets before encoding, so no fact can forge a header.
- 2026-11-08: Extension messages are split into ContentRequest, PanelRequest and WebAppRequest. The worker picks the schema from `sender`, never from the payload, so a content script can never call wipe, hide or settings.
