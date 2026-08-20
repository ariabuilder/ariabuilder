# Security Policy

Aria Builder is pre-launch and pre-v1. It is open source (Apache-2.0), but the
security surface is already real — a privileged Electron main process, IPC,
project trust, local filesystem access, agent tools, credential storage, and
packaging all matter.

If you find something that looks wrong, tell us privately first. That gives us
time to verify, fix, and disclose without putting people at risk.

For general questions, setup help, or non-sensitive discussion, join the
[Aria Discord](https://discord.gg/QvuG5XZPe). Keep suspected vulnerabilities
out of public channels.

## Supported Versions

Before `1.0.0`, we focus security work on `main` and the latest published
pre-v1 release.

| Version | Supported |
| ------- | --------- |
| `main` | Yes |
| Latest pre-v1 release | Best effort |
| Older pre-v1 releases | No |
| Forks or modified builds | No, unless it also reproduces on `main` |

Pre-v1 can change — breaking updates, trust-model shifts, packaging changes —
without long-term backports. If you are running Aria before v1, stay current
and read the release notes before you upgrade.

## Reporting a Vulnerability

Do not open a public GitHub issue with exploit details.

How to report:

1. Use GitHub private vulnerability reporting or Security Advisories for this
   repo, if available.
2. Or email `security@ariabuilder.io`.

If you cannot reach us privately, open a public issue that only asks for a
security contact — no payloads, tokens, logs, or reproduction steps.

Helpful reports usually include:

- What you found and where it lives
- The commit, tag, or version you tested
- Operating system, and whether you ran a packaged build or `npm run dev`
- Whether a project was trusted and opened
- Steps to reproduce, or a minimal proof of concept
- What an attacker could gain

Leave real secrets, production data dumps, private user data, and live tokens
out of the report.

## What to Expect

We are pre-launch, so response times are best effort — not a formal SLA.

What we aim for:

- Acknowledge within 5 business days
- Triage severity and confirm we can reproduce it
- Keep you updated when we fix it, ship it, or decline it
- Credit you in the advisory or release notes unless you want to stay anonymous

We may decline reports that only hit unsupported versions, depend on unsafe
local setup, assume an already-compromised machine without crossing a privilege
boundary, or are general hardening tips without a concrete bug.

## Coordinated Disclosure

Give us a fair window to fix and publish before you go public. We will not ask
you to sit on a vulnerability forever.

When something is confirmed, we will share enough for people to judge risk and
upgrade safely — without handing attackers a ready-made recipe.

## Safe Harbor

Good-faith research is welcome. Stay in safe harbor by:

- Testing only systems you own or have permission to test
- Not touching data that is not yours
- Stopping and reporting if you hit sensitive data
- Skipping DoS, spam, social engineering, phishing, and physical attacks
- Not installing backdoors, keeping access open, or blowing past rate limits
  beyond what you need to show the issue

Follow this policy and we will not treat the report as hostile.

## No Bug Bounty

There is no paid bug bounty today. Reports are genuinely appreciated, but do
not expect a reward unless we agree to one in writing.

## Where Reports Help Most

We especially care about issues in:

- IPC, preload, and renderer isolation (`assertTrustedIpc`, context isolation,
  sandbox, node integration off)
- Project trust — store integrity, challenge/consume, owner checks, or
  inferring trust from recents
- Path and symlink escape past `pathSafety.ts` (resolve-within-root, final
  symlink rejection). Residual TOCTOU against a concurrent local writer is
  documented; a bypass that does not need that race is in scope
- Session and terminal ownership — I/O or lifecycle leaking across
  `webContents`
- Agent tools, confirmations, and BYOK secrets in Electron `safeStorage`
- Process launch that reaches a shell, or argument injection into Astro /
  Git / npm children
- WordPress remote download — SSRF, redirect following, or size-limit bypass
- Preview iframe header rewrite outside loopback, or untrusted main-frame
  navigation
- External URL allowlist bypasses
- Packaging, code signing, or notarization that would ship a tampered artifact

## Running Aria before v1

Until `1.0.0`, treat production use as early access. Only open projects you
trust, keep BYOK keys in Aria rather than in the project tree, and upgrade
when security fixes land. Unsigned CI builds will trip Gatekeeper and
SmartScreen; that is expected until the signed-release path is enabled.
