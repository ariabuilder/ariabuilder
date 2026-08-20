# Roadmap

Aria Builder is pre-launch and pre-v1. This roadmap is a direction of travel, not a
promise of delivery order or dates.

This file will be converted into a public roadmap utilizing GitHub projects in the near future.

## Available today

- Desktop Studio and visual Composer on any Astro project.
- A design system for tokens, semantic classes, fonts, and motion — shared by
  preview and publish.
- Built-in CMS for collections, entries, and media in the project.
- A bring-your-own-key AI agent with the same project access as Studio.
- Workspace Git and a project-scoped terminal.
- WordPress and Markdown import, plus a site export archive.
- Explicit project trust, a sandboxed renderer, and path/symlink checks.

## Now

- Stabilize packaging across macOS, Windows, and Linux.
- Keep project trust, path safety, session ownership, and terminal ownership
  tight.
- Close agent capability gaps against the previous site ledger where they
  still belong on desktop.
- Prepare the project for outside contributors.
- Ship unsigned CI artifacts until the signed-release path is enabled.

## Before 1.0

- Make install and contributor docs easy to follow.
- Write clearer upgrade notes for people already running pre-v1 builds.
- Grow test coverage across Composer, CMS, agent, and packaging paths.
- Sign and notarize macOS builds; Authenticode-sign Windows installers.
- Make Gatekeeper and SmartScreen distribution usable without workarounds.

## 1.0 Goals

- Open an Astro project in Aria with confidence — no security landmines, no
  design or layout surprises in the canvas or the files on disk.
- A Composer you can trust for real manual site building. AI helps, but the
  canvas and fundamentals have to stand on their own — polished enough to feel
  world-class.
- Edit a real Astro site visually, then own the folder. Everything yours.
  Free. Open source. No subscription walls or tiered limits on the core builder.

## Later

- Broader import/export targets.
- Designed site templates and component libraries.
- Deeper agent tooling for design, content, SEO, and maintenance.
- MCP, once there is an explicit product decision and a security model for it.
- Signed webhooks, durable retries, n8n/Make/Zapier recipes, and Notion
  publishing automation.
- Site-local OAuth device authorization and the direct Figma draft importer.
- An EmDash-style plugin platform with manifests, fine-grained capabilities,
  isolated storage, durable hooks, declarative Studio UI, signed artifacts, and
  a sandbox that can actually be enforced. All plugin implementation remains
  deferred until that policy exists; there is no native fallback.

## Non-Goals Before 1.0

- Long-term support branches.
- Compatibility guarantees for every pre-v1 release.
- An extension marketplace.
- A hosted control plane.
- Paid Pro / Enterprise tiers.
- A central Aria connection broker.
- Extension execution without documented security and runtime requirements.
