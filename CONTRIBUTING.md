# Contributing to Aria

Thanks for helping build Aria. We are pre-launch and pre-v1 — useful
contributions are welcome, but the core stays intentionally tight.

Docs live at [ariabuilder.io/docs](https://ariabuilder.io/docs/).
Setup and architecture for this repo are in this file.

## Before you start

- Search issues and PRs before opening a new one.
- For big features, architecture changes, IPC, project trust, agent tools, or
  packaging/signing — open an issue first.
- Security problems go private. See [SECURITY.md](SECURITY.md). For general
  chat, join the [Aria Discord](https://discord.gg/QvuG5XZPe).

## Local setup

You need Node.js `>= 22.12.0` and npm. Native modules such as `node-pty` need
a compiler toolchain (Xcode Command Line Tools on macOS, `build-essential` on
Debian/Ubuntu, Visual Studio Build Tools on Windows).

```bash
npm install
npm run dev
```

This starts Vite and opens the Electron shell against the local dev server.

When you open a project, Aria starts a localhost Astro dev server for that
folder, reports its lifecycle in the workspace, and stops it when the
session or app closes.

## Common commands

```bash
npm run test:fast
npm test
npm run build
```

Use `npm run test:fast` while you work (typecheck, unit tests, and project /
runtime / git smokes). Run `npm test` before you open a PR — that also
packages for the host OS and runs `smoke:packaged`.

Quit any running Aria before `smoke:packaged`. Electron’s single-instance lock
is process-wide.

CI runs unit tests, project / runtime / git smokes, `smoke:real-astro`, a
platform package, and `smoke:installed` on Ubuntu, macOS (arm64 and x64), and
Windows.

Other smokes, when you need them:

- `npm run smoke:project` — filesystem, scanner, recents, and symlink safety
- `npm run smoke:runtime` — Astro process startup, readiness, and shutdown
- `npm run smoke:git` — Git workspace smoke
- `npm run smoke:real-astro` — runtime smoke against `ARIA_SMOKE_ASTRO_PROJECT`.
  Not part of `npm test`.
- `npm run smoke:installed` — installed artifact smoke against the Astro
  fixture. Needs a package in `release/`.
- `npm run verify:release-signing` — verify signed mac/win artifacts. Dormant
  except in the signed-release workflow.

`smoke:packaged` boots the packaged binary with an isolated `--user-data-dir`
and checks `window.aria` IPC for `getVersion` and `sessions.list`. It does not
open a project, scan files, or start Astro.

## Packaging

`npm run build` packages for the current host OS. Artifacts land under
`release/`.

| Command | Output |
| --- | --- |
| `npm run build` | Host platform package under `release/` |
| `npm run dist:mac` | macOS dmg + zip, arm64 and x64. Run on a Mac or in CI. |
| `npm run dist:mac:arm64` | macOS dmg + zip, arm64 only |
| `npm run dist:mac:x64` | macOS dmg + zip, x64 only |
| `npm run dist:linux` | Linux AppImage. Run on Linux or in CI. |
| `npm run dist:win` | Windows NSIS installer. Run on Windows or in CI. |

On Ubuntu 24.04+, running an AppImage typically needs libfuse2:

```bash
sudo apt install libfuse2t64
```

## Project boundaries

- Product UI lives in `src/`. It is unprivileged Vue. Talk to the OS only
  through `window.aria`.
- Privileged work lives in `electron/`: filesystem, processes, IPC handlers,
  Astro ownership, Git, terminal, and agent tools.
- Shared types and pure logic live in `shared/`. Do not put privileged Node
  APIs there.
- Build, dev, and smoke scripts live in `scripts/` and `tests/fixtures/`.
- The [agent parity ledger](docs/architecture/agent-parity-status.md) tracks
  maintained desktop capability coverage and its review date.
- Validate IPC and agent input at the boundary (Zod).
- Project writes go through path safety, an open session, and project trust
  (`electron/projectTrust.ts`). Trust is stored in `project-trust.json`, fails
  closed on a missing or corrupt store, and is never inferred from recents.
- Spawn child processes through `electron/processLaunch.ts` (`shell: false`).
  Do not add shell-invoking launches.
- One design system owns tokens, classes, breakpoints, fonts, and generated
  CSS — do not invent a second source of truth.
- Custom code, SVG, imports/exports, media, remote download, agent tools, and
  credential storage are security-sensitive — treat them that way.
- Do not add a central Aria control plane or connection broker.
- Webhooks, third-party OAuth, design-tool integrations, MCP, and plugins need
  product + security review before anyone builds them.

## Dependencies

Aria is an Electron desktop app. Astro is the **user project** runtime, not
this app’s web framework.

Before you add a package, say in the PR why the current stack is not enough.
Prefer what we already use — Electron, Vue, Vite, Tailwind, Zod, Vitest, and
whatever is already in `package.json`.

New dependencies should:

- Work in the Electron main process, the sandboxed renderer, or both — say
  which, and why
- Use a **permissive license** (MIT, Apache-2.0, ISC, or BSD). Flag anything
  else so we can review it
- Not duplicate a library we already have for the same job
- Stay small and maintainable

Be extra careful with packages that touch crypto, sessions, HTML sanitization,
file parsing, AI, or network I/O. Justify them and call out the risk. Native
modules (`node-pty` and anything that needs a rebuild) need a real reason.

If you vendor assets, fonts, or icons from a new source, update
[`acknowledgements.md`](acknowledgements.md) and include license text there
when required.

Dev-only tools go in `devDependencies`. Do not ship runtime packages you only
need at build time.

## Branches and commits

- Branch from `main` and keep it current before opening a PR
- Short names that describe the work: `fix/preview-frame-headers`,
  `feat/wordpress-import`, `chore/deps-cleanup`
- One concern per branch and per PR — split stacked work if you need to
- Imperative commit messages: `Fix terminal I/O leaking across windows`,
  `Add project-trust challenge TTL`
- Reference the issue in the commit or PR when there is one

## Pull requests

Small enough to review. Complete enough to trust. One concern per PR. If you
cannot explain the change in a few sentences, it is probably too big.

### AI-assisted work

AI is fine for drafting. The PR is still yours.

Do not dump a model’s entire output into one pull request.
**Oversized or unfocused PRs will not be reviewed.** If it touches dozens of
files, rewrites unrelated code, or mixes features with refactors and drive-by
fixes, expect it to be closed.

Before you open:

- Can someone review this in one sitting?
- Does every file serve the same user-facing goal?
- Would you trust this diff from a teammate?

If not, split it and open the pieces in order.

Include:

- What changed for the user
- Screenshots or a short recording for UI work
- Tests for behavior changes, IPC, trust, path safety, or regressions
- Security notes when you touch IPC, project trust, agent tools, secrets,
  imports, remote download, process launch, or packaging

Skip:

- Monolithic AI diffs that change everything at once
- Drive-by formatting on unrelated files
- Big rewrites mixed into product changes
- Quiet changes to packaging, signing, or smoke scripts

## UI

Aria is a dense tool, not a landing page. Prefer predictable controls, compact
layout, and clear empty / loading / error / permission-denied states.

- Reuse the UI primitives and patterns already in the tree
- Keep buttons, menus, dialogs, sheets, and tables consistent with nearby code
- Keep copy short and useful
- Check compact and wide window sizes when the change is visible

## Comment style

Prefer no comment when names and structure already explain the code.

1. Comment **why**, not what — intent, constraints, tradeoffs, security or
   packaging gotchas.
2. One short sentence (two max). Plain English. No marketing adjectives
   (`comprehensive`, `robust`, `seamless`).
3. No structural theater — no `=====` banners, no Features / Architecture /
   Usage lists, no `@module` / `@version`.
4. JSDoc only when it adds info — constraints, units, examples, `@deprecated`,
   `@default`. Delete JSDoc that restates the identifier.
5. Keep tooling escapes as-is — `@ts-ignore`, `eslint-disable`, Vue typing notes.
6. Same voice in Vue `<!-- -->` comments.

Good:

```ts
// Option/Alt + letter on macOS often emits a special character, so letter
// keys use event.code
```

```ts
// Missing and corrupt trust stores both fail closed. Never infer trust from
// recents.
```

Bad:

```ts
/**
 * History Composable - Command Pattern Undo/Redo System
 *
 * Features:
 * - Command Pattern for reversible operations
 * ...
 * @module src/workspace/composables/useHistory
 */
```

```ts
// =============================================================================
// TYPE DEFINITIONS
// =============================================================================
```

## Pre-v1

Before `1.0.0`, things can break. We try to keep changes understandable and
documented, but we do not promise long-term support or backports for older
pre-v1 releases.

## Maintainer releases

Desktop releases use GitHub Releases as the update feed. The release workflow
stays disabled until the repository variable
`ARIA_RELEASE_SIGNING_ENABLED=true` is set and these protected secrets exist:

- `MAC_CSC_LINK` and `MAC_CSC_KEY_PASSWORD`
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`
- `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`

To publish, update the version in `package.json` and `package-lock.json`, merge
that change, then create and push the matching tag (for example, `v0.2.0`).
The tag must exactly match the package version. CI creates a draft, builds and
verifies every platform, combines the two macOS architectures into one update
feed, and publishes only after every required job succeeds.

Do not replace an existing version. If a release is bad, increment the version
and ship a corrective release. Installed copies cannot read releases while
this repository is private; the first signed public build is therefore a
manual bootstrap download, and later releases update through the app.

## Trademarks

Contributions are under Apache-2.0. That does not grant trademark rights to
the **Aria** or **Aria Builder** name or logos. See
[TRADEMARKS.md](TRADEMARKS.md) for attribution, fork naming, and logo use.
Forks and modified builds must not imply official status or endorsement
by Statice Origins Inc.

## License

By contributing, you agree your contribution is licensed under the
[Apache License, Version 2.0](LICENSE).
