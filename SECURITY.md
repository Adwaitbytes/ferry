# Security Policy

## Reporting a vulnerability

Open a private GitHub security advisory on this repository (Security tab, "Report a vulnerability"). Do not open a public issue, pull request or discussion for a suspected vulnerability.

Please include:

- the affected component (extension, web app, Gate API, SDK, or a server route)
- the version or commit hash
- steps to reproduce, with a minimal payload
- the impact you observed, and whether any real user data or funds were involved

We acknowledge reports within 72 hours and aim to ship a fix or mitigation for confirmed high-severity issues within 14 days. We will credit you in the advisory unless you ask us not to.

## Supported versions

| Version | Supported |
|---|---|
| Latest release on the `main` branch | Yes |
| Older releases and unpacked builds from earlier commits | No |

Fixes are released only for the latest version. Update the extension from the latest GitHub release ZIP.

## Scope

In scope:

- The Ferry Chrome extension (`apps/extension`), including its service worker, content scripts, site adapters and side panel
- The Ferry web app (`apps/web`)
- Ferry Gate (`apps/gate`), including HTTP 402 payment verification and the replay table
- Ferry server routes: Distill, Desk chat proxy and the chain proxy
- `@ferry/sdk` and the packages in `packages/`
- The CI pipeline and release build of this repository

Out of scope:

- The Walrus Memory relayer, Walrus aggregators, Sui, Seal, Tatum and LLM providers. Report issues in those services to their maintainers.
- Known platform limits that Ferry documents: delegate keys are account-wide, the hosted relayer sees plaintext in Standard mode, and data written to Walrus remains until its storage epoch ends.
- Attacks that require malware or full control of the user's device or browser profile.
- Denial of service through traffic volume, social engineering, and physical attacks.

## Safe harbor

Test only against your own accounts, wallets and Share Cards. Do not access other users' data, do not make payments from wallets you do not control, and stop and report as soon as you confirm an issue. We will not pursue action against good-faith research that follows these rules.

Our threat model is in `docs/THREAT_MODEL.md` and the red-team suite is in `docs/REDTEAM.md`.
