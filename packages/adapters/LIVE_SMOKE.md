# Adapter live smoke test

Run before freeze on the real sites, signed in, with the unpacked extension loaded. About 5 minutes. Record pass or fail per row in `docs/STATUS.md`.

Contract tests use saved DOM snapshots under `fixtures/`. This checklist catches the vendor DOM drifting away from them. If any row fails, open DevTools, find the new marker, add it as a fallback strategy in `src/sites/<site>.ts`, update the fixture, and rerun `pnpm --filter @ferry/adapters test`.

## Setup (30 seconds)

1. Open the extension service worker console (`chrome://extensions`, Ferry, "service worker").
2. Keep it visible: adapter health messages and adapter errors appear there.

## Per site: chatgpt.com, claude.ai, gemini.google.com (90 seconds each)

| # | Step | Pass when |
|---|---|---|
| 1 | Open a new chat. | Health reports `ok: composer via <primary strategy>; no user turns on page`. Any `adapter degraded` detail is a fail. |
| 2 | Type `plan Friday dinner` and pause. | The chip sits 8px above the composer box, left aligned with the text, and matches the page theme. |
| 3 | Click the chip, Insert. | The context block appears before `plan Friday dinner`, nothing is lost, the send button is enabled, and the caret still works. |
| 4 | Undo once (Cmd+Z or Ctrl+Z). | The editor treats the insert as one normal edit (the block disappears, the draft remains). |
| 5 | Send `I am allergic to cashews`. | Exactly one save toast appears, with that text and nothing else. |
| 6 | Wait for the full assistant reply. | No toast for the assistant reply. |
| 7 | Send a second message. | Exactly one more toast. |
| 8 | Reload the page. | No toast for the history that renders on load. |
| 9 | Open a different past conversation from the sidebar. | No toast. |
| 10 | Switch the site theme (light and dark). | The chip follows the theme. |
| 11 | Check the conversation URL captured with the toast. | It is `https://` on the exact vendor host, with the id from the address bar. |

## Site notes

- ChatGPT: also try once inside a Project (`/g/.../c/...`); the captured URL is the plain `/c/<id>` form.
- Claude: test a multi-paragraph message (Shift+Enter); the toast keeps the line breaks.
- Gemini: test on a second Google account (`/u/1/app/...`); the captured URL drops the `/u/1` prefix.

## Hostile text (30 seconds, any one site)

Send `<img src=x onerror=alert(1)> test` followed by a zero-width space. Pass when no alert fires, the toast shows the literal text, and the zero-width character is gone.
