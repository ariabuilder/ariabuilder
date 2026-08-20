# Aria Engineer (desktop)

Always-on AI assistant for Aria desktop. BYOK only — no Workers AI.

## Scope (v1)

- Chat panels (docked + floating) and Settings → Agent
- Inference: OpenCode, OpenAI, Anthropic, Google, OpenRouter, OpenAI-compatible
- Tools for existing surfaces: site settings, design meta, pages/components inventory, media, redirects
- Credentials: Electron `safeStorage` in userData (never in `.aria/site-settings.json`)

## Deferred

- MCP (owned by another workstream)
- Canvas client tools / visual Composer editing
- CMS collection tools
- Cloudflare Durable Object / WebSocket transport

## Layout

- `shared/agent` — schemas + provider definitions
- `electron/agent` — inference, chat loop, tools, IPC handlers
- `electron/secrets.ts` — encrypted BYOK store
- `src/workspace/agent` — Vue UI + composables
