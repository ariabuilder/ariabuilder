# Phase 1 bridge vehicle (design note)

Composer needs a design-mode client inside the live Astro preview iframe that strips `data-aria-s/e` markers, stamps `data-aria-p`, and `postMessage`s rects/hover/click to the host. Two options:

## A — Electron subframe preload (Stacki-shaped)

Inject a privileged-but-narrow preload into the preview `<webview>` / `BrowserView`. Host receives messages on a locked channel. **Pros:** no site script in the project graph; easy origin isolation. **Cons:** Electron-specific; must never expose `window.aria` (app IPC) into the site world; BrowserView/webview setup cost.

## B — Vite-injected design client

Ephemeral Vite plugin (`node_modules/.aria/`) injects a tiny ES module when `#aria-design` (or query) is active. **Pros:** works with any Chromium iframe; co-located with marker `load` hook; easier HMR. **Cons:** script appears in the preview document graph (mitigate: only under Aria’s ephemeral config, never committed); need strict `postMessage` origin checks.

## Recommendation for Phase 1

Prefer **B (Vite-injected client)** as default: it matches the ephemeral marker config already planned and keeps preview plumbing in one place. Keep **A** as fallback if iframe sandboxing or CSP blocks injection. Security invariant for both: **no privileged app API in the site world**; parent validates message shape + origin.

## Phase 1 implementation (landed)

- Ephemeral config: `node_modules/.aria/astro.config.mjs` + copied `kernel.mjs`
- Markers via Vite `load` `enforce: 'pre'` calling `parseAstro` / `serializeAstroMarked`
- Design client: Astro `injectScript('page', …)` + Vite virtual module `virtual:aria-design-client` (not `transformIndexHtml` — Astro pages skip that path)
- Protocol prefix: `aria:rects` | `aria:hover` | `aria:click` | `aria:open` | `aria:shortcut` | `aria:track` | `aria:scroll-to`
- Host Stage listens with localhost origin checks; site never receives `window.aria`
- Phase 4: design client forwards Delete/Backspace, ⌘/Ctrl+Z/Y, ⌘/Ctrl+D as `aria:shortcut` when the iframe has focus

## Protocol v11 seamless preview

Astro remains the sole persisted document. The iframe DOM is a disposable,
revisioned projection of the before/after Astro models; there is no BuilderNode
tree, sidecar document, or browser-owned source of truth. A second iframe may
exist briefly as a warm transport during a safety reload; it never owns source.

### Immediate browser-safe projection

- `aria:patch-nodes` carries a discriminated `properties` or `static-tree`
  transaction. Property patches cover static tag, attribute, class, style, and
  leaf-text changes. One keyed static-tree boundary covers wrap/unwrap, insert,
  duplicate, paste, delete, reorder, reparent, list/navigation changes, and
  their undo/redo operations.
- Static boundaries contain the smallest before/after forest. Native HTML,
  sanitized SVG, text, and string/bare attributes are concrete. Unchanged
  expressions, components, and other dynamic siblings are opaque anchors; a
  transaction may not modify or move them.
- The iframe preflights every rendered occurrence before committing any
  boundary. It validates DOM shape, occurrence counts, tag/attribute safety,
  containment, and hydration ownership. Matching nodes are moved or updated in
  place; only actual insertions are created and only actual deletions removed.
  Ephemeral model IDs are associated with live nodes in memory and are never
  serialized into Astro or stamped into the authored site.
- `aria:patch-result` acknowledges each monotonic revision as `applied`,
  `rejected`, or `stale` with typed failure reasons. An applied latest revision
  starts the 120 ms coalesced draft write. Rejection, exception, or a missing
  acknowledgement after 500 ms closes the optimistic lane and immediately
  publishes/reconciles the latest draft. Patches resume only after the matching
  Astro reconciliation succeeds.
- Geometry is measured once on the next animation frame. Motion is reinitialized
  only when the affected boundary contains or is owned by Motion markup.
- `aria:sync-font-stylesheet` mirrors the enabled Google Fonts stylesheet into
  the disposable canvas document. The URL is restricted to the official Google
  Fonts CSS endpoint and is excluded from authored head reconciliation.

### Dynamic Astro reconciliation

- Dynamic tags, components, slots, expressions, maps, conditionals, raw
  fragments, dynamic/spread/template properties, scripts, frontmatter, head
  resources, custom elements, and hydration-owned DOM fail closed to
  `aria:reconcile`.
- The Vite client waits for transaction-scoped `aria:source-ready`, fetches the
  current route, and uses bundled `morphdom` on the affected marker runs.
  Matching priority is marker identity,
  authored HTML `id`, then compatible tag/position. Compatible DOM nodes are
  retained, including unchanged images/media/iframes, focused and dirty form
  controls, selection ranges, scroll state, overlay targets, and unchanged
  Astro islands. Scripts are never executed or morphed.
- `aria:reconcile-result` is revision ordered and distinguishes `patched`,
  `morphed`, and `reload-required`. Stale fetches are aborted; stale responses
  are ignored by the coordinator; successful recovery reopens the optimistic
  lane. Vite-injected transient style nodes do not count as authored executable
  assets.

### Controlled reload boundary

- Import ownership changes wait for their draft revision and request a
  controlled reload directly. Reconciliation also requests one when authored
  executable/head assets change, hydration ownership changes, marker agreement
  is irrecoverable, or two morph attempts fail for the latest revision.
- Stage keeps the visible iframe interactive while a second, hidden iframe
  warms. A frame token on `aria:ready` proves which bridge is ready; Stage then
  restores viewport/tracking, transfers frame focus when needed, and promotes
  the replacement with a restrained opacity transition (instant under reduced
  motion). After 10 seconds the old canvas remains visible and a non-blocking
  retry message appears.
- Controlled reloads are a runtime safety path, never the normal Inspector,
  Blocks, Layers, clipboard, list, navigation, or history path.

Composer-authored Astro writes continue to be matched by app-local transaction
ID, content hash, reserved revision, file role, completion state, and expiry.
Matching Astro writes suppress normal page reloads, matching stylesheet writes
retain CSS HMR, and one source-ready event is emitted per completed transaction;
unmatched external writes retain normal Astro HMR.
Persistence conflicts remain authoritative but do not silently revert the
visible dirty canvas.
