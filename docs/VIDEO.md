# Ferry demo video

Target length 2:55, hard cap 3:00. Footage recorded with Playwright at 1920x1080 for clean, repeatable takes. Adwait records the voiceover separately and it is laid over the footage. Beats and timings follow PRD section 11 exactly.

## Rules for this recording

- Everything on screen is real Mainnet data from the team's own account, except the Cut off, which shows the DEMO label as designed.
- No fake numbers. If a count on screen is not real, reshoot.
- The 0:12 counter shows whatever Adwait's real export produces. The voiceover reads that number: {{FILL: real import count from Adwait's export}}.
- No faces, no personal inbox, no wallet balances other than the demo wallet. Close every other tab.
- Browser zoom 100 percent, dark theme for the Ferry app, chat sites in their default theme.
- Voiceover has no dashes and no filler. Read it slowly; each block fits its window at about 150 words a minute.

## Script

### 0:00 to 0:12. Problem

**On screen:** Landing page hero at https://ferry-memory.vercel.app. Headline "Your AI memory, finally yours." Live Mainnet counters visible.

**Voiceover:**
> Every AI you use remembers you. None of that memory is yours. Ferry gives you one memory you own, on Walrus, and carries it into every AI you use.

### 0:12 to 0:45. Rescue

**On screen:**
1. Click "Rescue" in the nav. URL `/rescue`.
2. Drag Adwait's real ChatGPT export ZIP onto the drop zone.
3. Parsing progress with text ("Distilling facts: N of M chunks").
4. Review cards appear grouped by type. Open one receipt to show the quote.
5. Click "Approve all" on two groups, then "Move to Walrus".
6. Facts board the ferry; the counter climbs to the real total.
7. Hero metric: "ChatGPT knew N things about you. You owned 0. Now you own N."
8. Click the Mainnet proof link; the account object shows in the explorer tab for one second.

**Must be real:** the export, the count, the account object id.

**Voiceover:**
> Start with what they already know. This is my real ChatGPT export. Ferry opens it on my laptop, nothing uploaded, and pulls out the facts I actually said, each with the quote it came from. I approve them, and they move to Walrus Mainnet. ChatGPT knew {{FILL: real import count}} things about me. Now I own all of them.

### 0:45 to 1:20. Carry

**On screen:**
1. chatgpt.com, new chat. Type "I'm vegetarian and allergic to cashews" and send.
2. Ferry toast appears: "Save to Ferry". Click Save.
3. Switch to claude.ai, new chat. Type "plan Friday dinner".
4. Pause. The chip slides up: "Ferry has 2 things Claude should know".
5. Click the chip, show the preview with both facts and ChatGPT source badges. Click Insert.
6. The delimited context block appears at the top of the prompt. Send.
7. Claude replies with a plan that avoids meat and cashews. Scroll to show it.
8. Hover a fact in the side panel to show the receipt: quote, ChatGPT, date, blob id.

**Must be real:** both chat sites live, Claude's actual answer, the blob id in the receipt.

**Voiceover:**
> Now the part I use every day. I tell ChatGPT I'm vegetarian and allergic to cashews, and save it. Then I open Claude and ask for a dinner plan. Ferry already knows. I check what it will add, click insert, and Claude plans around both. Every fact shows where it heard it.

### 1:20 to 1:40. Stays current

**On screen:**
1. Web app Library, Conflicts tab. URL `/library?status=conflict`.
2. Conflict card: "ChatGPT, Mar: vegetarian" next to "Claude, Oct: started eating fish".
3. Click "Keep newer".
4. Open the timeline for that fact: both versions, both sources, the supersede link to the old blob.

**Must be real:** both facts exist on Mainnet, the superseding memory's blob id.

**Voiceover:**
> People change. When a new fact contradicts an old one, Ferry asks me which is true. The new one supersedes the old on Walrus, and the history stays.

### 1:40 to 2:05. Blackout Drill

**On screen:**
1. Web app Desk. URL `/desk`. Model picker set to Claude.
2. Ask "What should I cook tonight?" Reply cites memories with receipts ("used 3 memories").
3. Click "Cut off". DEMO badge visible. The power cut transition plays.
4. Message: this simulates a provider cutting you off.
5. Desk continues on another model. Ask a follow up. The reply still respects the allergy.
6. Counter: "0 facts lost".

**Must be real:** the recall and both model replies. The cut off is simulated and labelled.

**Voiceover:**
> And if an AI cuts you off? Here I simulate exactly that. The thread moves to another model, it pulls the same memory from Walrus, and nothing is lost. Zero facts.

### 2:05 to 2:35. Share and Earn

**On screen:**
1. Web app Share and Earn. URL `/share`. A "Food" Share Card priced at 0.01 USDC.
2. Split screen: a terminal on the left, Earnings on the right.
3. Terminal runs the TripScout example: `{{FILL: exact TripScout command}}`.
4. Terminal prints the 402 challenge, the payment digest, then the food preferences.
5. Earnings page ticks up by 0.01 USDC with the agent address and a Tatum verified badge.
6. Click the transaction link; the explorer shows the USDC transfer to Adwait's address.

**Must be real:** the Mainnet USDC payment and its digest: {{FILL: TripScout payment tx digest}}.

**Voiceover:**
> My memory can also earn. I share my food preferences as a card. An agent called TripScout asks, gets a payment request, and pays one cent in USDC on Sui. Ferry checks the payment through Tatum, then answers. The money goes straight to my wallet.

### 2:35 to 2:45. Proofs

**On screen:**
1. Web app Proofs. URL `/proofs`.
2. Mainnet memory count, account object id, recent blobs, Tatum credit meter.

**Must be real:** all of it.

**Voiceover:**
> Everything here is on Mainnet. 312 memories, verified through Tatum.

### 2:45 to 2:55. Close

**On screen:** Landing hero, then the end card: Ferry wordmark, repo URL, live URL, "Built on Walrus and Tatum".

**Voiceover:**
> Switch AIs. Keep yourself.

## Shot list summary

| # | Start | URL or app | Action | Real on screen |
|---|---|---|---|---|
| 1 | 0:00 | `https://ferry-memory.vercel.app/` | Hero, counters | Live Mainnet counters |
| 2 | 0:12 | `/rescue` | Drop ZIP, review, approve, move | Real export, count, account |
| 3 | 0:45 | chatgpt.com | Send fact, save toast | Live site |
| 4 | 0:55 | claude.ai | Chip, preview, insert, send | Live reply, receipt blob id |
| 5 | 1:20 | `/library?status=conflict` | Resolve, timeline | Supersede blob id |
| 6 | 1:40 | `/desk` | Ask, cut off, continue | Real replies, DEMO label |
| 7 | 2:05 | `/share` and terminal | TripScout pays | Mainnet USDC tx |
| 8 | 2:35 | `/proofs` | Counts and meter | Mainnet count, Tatum credits |
| 9 | 2:45 | `/` | End card | Repo and live URLs |

{{FILL: confirm each route path above matches the deployed app}}

## Playwright recording plan

The web app and Gate shots are recorded with Playwright. The chat site shots (3 and 4) need the real extension and logged in sessions, so they use a persistent Chrome profile.

**Setup**

- `@playwright/test` 1.65.0, Chromium channel `chrome`, viewport `{ width: 1920, height: 1080 }`, `deviceScaleFactor: 1`, `recordVideo: { dir: 'recordings/', size: { width: 1920, height: 1080 } }`.
- `chromium.launchPersistentContext(profileDir, { headless: false, args: ['--disable-extensions-except=<ext path>', '--load-extension=<ext path>'] })` with the release build of the extension, already paired to the demo account and unlocked.
- Profile already logged into chatgpt.com and claude.ai by Adwait. The script never types credentials.
- `slowMo: 60` and explicit `waitForTimeout` pauses of 600 to 1200ms after each visible change, so the viewer can read it.
- Cursor overlay script injected on each page so clicks are visible.
- One spec per beat, so a bad take reshoots only that beat: `recordings/specs/01-hero.spec.ts` through `09-close.spec.ts`.

**Per beat**

| Spec | Steps |
|---|---|
| 01-hero | `goto('/')`, wait for counters to be non zero, hold 8s |
| 02-rescue | `goto('/rescue')`, `setInputFiles` on the drop zone input with the real export path, wait for review cards, click one receipt, click Approve all twice, click Move to Walrus, wait for the hero metric text, click the proof link, hold 1s on the explorer tab |
| 03-carry-chatgpt | `goto('https://chatgpt.com/')`, type the fact into the composer with `pressSequentially` at 40ms per key, Enter, wait for the Ferry toast inside the shadow root, click Save |
| 04-carry-claude | `goto('https://claude.ai/new')`, type "plan Friday dinner", wait for the chip, click it, click Insert, Enter, wait for the reply to finish streaming, scroll, open the side panel with Alt+F, hover the fact |
| 05-conflict | `goto('/library?status=conflict')`, click Keep newer, open the timeline |
| 06-desk | `goto('/desk')`, send the question, wait for the reply, click Cut off, wait for the transition, send the follow up, wait for "0 facts lost" |
| 07-share | `goto('/share')` in the right half; the terminal half is a separate screen recording of `{{FILL: exact TripScout command}}`, composited in edit |
| 08-proofs | `goto('/proofs')`, wait for the credit meter, hold 8s |
| 09-close | `goto('/')`, hold, end card added in edit |

**After recording**

- Trim each clip to its window, join in order, lay the voiceover, add captions burned in from the voiceover text.
- Export 1920x1080, H.264, under 3:00. Check the final length before upload.
- Upload to {{FILL: video host}} and paste the link into SUBMISSION.md, README.md, BLOG.md and SOCIAL.md.
