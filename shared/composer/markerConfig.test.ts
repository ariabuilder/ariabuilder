import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ARIA_BRIDGE_ID,
  ARIA_MSG,
  ARIA_PROTOCOL_VERSION,
  isAriaIframeToHostMessage,
  isAriaProtocolMessage,
} from "./protocol";
import { ARIA_MARKER_DIR } from "./constants";
import { DESIGN_CLIENT_SOURCE } from "../../electron/composer/designClientSource";
import {
  resolveComposerKernelPath,
  writeMarkerConfig,
} from "../../electron/composer/writeMarkerConfig";

describe("composer marker config", () => {
  it("design client strips markers even when not in design mode", () => {
    // Interactive browse shares the marked Vite server; early-return without
    // strip would leave <template data-aria-s/e> and break :nth-child / flex.
    expect(DESIGN_CLIENT_SOURCE).toContain("MSG.open");
    expect(DESIGN_CLIENT_SOURCE).toContain('"dblclick"');
    expect(DESIGN_CLIENT_SOURCE).toContain("activeScope");
    expect(DESIGN_CLIENT_SOURCE).toContain("const stripMarkers = () =>");
    expect(DESIGN_CLIENT_SOURCE).toMatch(
      /if\s*\(\s*!isDesignMode\(\)\s*\)\s*\{[\s\S]*stripMarkers/,
    );
    expect(DESIGN_CLIENT_SOURCE).toContain("location.hash.includes(DESIGN_HASH)");
  });

  it("design client is valid JavaScript and emits preview CSS selectors", () => {
    expect(() => new Function(DESIGN_CLIENT_SOURCE)).not.toThrow();
    expect(DESIGN_CLIENT_SOURCE).toContain(
      'rule.selector + "{" + rule.cssText + "}"',
    );
    expect(DESIGN_CLIENT_SOURCE).toContain('.join("\\n")');
    expect(DESIGN_CLIENT_SOURCE).toContain("aria:display-options");
    expect(DESIGN_CLIENT_SOURCE).toContain("aria:design-interaction");
    expect(DESIGN_CLIENT_SOURCE).toContain("aria:computed-style-request");
    expect(DESIGN_CLIENT_SOURCE).toContain("sourceNodeForPath");
    expect(DESIGN_CLIENT_SOURCE).toContain("setDesignInteractive");
    expect(DESIGN_CLIENT_SOURCE).toContain("data-aria-composer-display");
    expect(DESIGN_CLIENT_SOURCE).toContain('"normal", "outlines", "wireframe"');
    expect(DESIGN_CLIENT_SOURCE).toContain("const rectsFromAncestors = (p) =>");
    expect(DESIGN_CLIENT_SOURCE).toMatch(
      /rectsFromRegion\(p\)\s*\|\|\s*rectsFromDescendants\(p\)\s*\|\|\s*rectsFromAncestors\(p\)/,
    );
    expect(DESIGN_CLIENT_SOURCE).toContain("const scrollElementForPath = (p, occ) =>");
    expect(DESIGN_CLIENT_SOURCE).toContain("element.scrollIntoView({");
    expect(DESIGN_CLIENT_SOURCE).toContain('policy === "center" ? "center" : "nearest"');
    expect(DESIGN_CLIENT_SOURCE).toContain("MSG.restoreViewport");
    expect(DESIGN_CLIENT_SOURCE).toContain("queueViewport");
    expect(DESIGN_CLIENT_SOURCE).toContain("pathname: window.location.pathname");
    expect(DESIGN_CLIENT_SOURCE).toContain("MSG.bridgePing");
    expect(DESIGN_CLIENT_SOURCE).toContain("announceReady(d.frameToken)");
  });

  it("protocol uses aria: prefix (not avb)", () => {
    expect(ARIA_MSG.rects).toBe("aria:rects");
    expect(ARIA_MSG.ready).toBe("aria:ready");
    expect(ARIA_MSG.bridgePing).toBe("aria:bridge-ping");
    expect(ARIA_MSG.hover).toBe("aria:hover");
    expect(ARIA_MSG.click).toBe("aria:click");
    expect(ARIA_MSG.open).toBe("aria:open");
    expect(ARIA_MSG.track).toBe("aria:track");
    expect(ARIA_MSG.scrollTo).toBe("aria:scroll-to");
    expect(ARIA_MSG.viewport).toBe("aria:viewport");
    expect(ARIA_MSG.restoreViewport).toBe("aria:restore-viewport");
    expect(ARIA_MSG.displayOptions).toBe("aria:display-options");
    expect(ARIA_MSG.designInteraction).toBe("aria:design-interaction");
    expect(ARIA_MSG.popoverPreview).toBe("aria:popover-preview");
    expect(ARIA_MSG.setVh).toBe("aria:set-vh");
    expect(ARIA_MSG.pageHeight).toBe("aria:page-height");
    expect(ARIA_MSG.computedStyleRequest).toBe("aria:computed-style-request");
    expect(ARIA_MSG.computedStyleResponse).toBe("aria:computed-style-response");
    expect(ARIA_MSG.patchNodes).toBe("aria:patch-nodes");
    expect(ARIA_MSG.patchResult).toBe("aria:patch-result");
    expect(ARIA_MSG.reconcile).toBe("aria:reconcile");
    expect(ARIA_MSG.reconcileResult).toBe("aria:reconcile-result");
    expect(ARIA_MSG.syncMotionAssets).toBe("aria:sync-motion-assets");
    expect(ARIA_MSG.syncFontStylesheet).toBe("aria:sync-font-stylesheet");
    expect(isAriaIframeToHostMessage({ type: "avb:rects" })).toBe(false);
    expect(isAriaProtocolMessage({ type: ARIA_MSG.bridgePing, frameToken: "frame-a" })).toBe(true);
    expect(isAriaProtocolMessage({ type: ARIA_MSG.bridgePing })).toBe(false);
    expect(isAriaProtocolMessage({ type: ARIA_MSG.popoverPreview, targetId: "menu", open: true })).toBe(true);
    expect(isAriaProtocolMessage({ type: ARIA_MSG.setVh, px: 900 })).toBe(true);
    expect(isAriaProtocolMessage({ type: ARIA_MSG.setVh })).toBe(false);
    expect(isAriaIframeToHostMessage({ type: ARIA_MSG.pageHeight, height: 1800 })).toBe(true);
    expect(isAriaIframeToHostMessage({ type: ARIA_MSG.setVh, px: 900 })).toBe(false);
    expect(
      isAriaIframeToHostMessage({
        type: ARIA_MSG.ready,
        version: ARIA_PROTOCOL_VERSION,
        bridgeId: ARIA_BRIDGE_ID,
        pathname: "/",
        frameToken: "frame-a",
      }),
    ).toBe(true);
    expect(
      isAriaIframeToHostMessage({ type: ARIA_MSG.ready, version: 0, pathname: "/", frameToken: "frame-a" }),
    ).toBe(false);
    expect(isAriaIframeToHostMessage({
      type: ARIA_MSG.syncMotionAssets,
      enabled: true,
    })).toBe(false);
    expect(isAriaProtocolMessage({
      type: ARIA_MSG.syncFontStylesheet,
      urls: ["https://cdn.jsdelivr.net/fontsource/css/inter@latest/index.css"],
    })).toBe(true);
    expect(isAriaIframeToHostMessage({
      type: ARIA_MSG.syncFontStylesheet,
      url: "https://fonts.googleapis.com/css2?family=Inter",
    })).toBe(false);
    expect(isAriaIframeToHostMessage({
      type: ARIA_MSG.patchResult,
      revision: 3,
      status: "rejected",
      reason: "dom-shape-mismatch",
      paths: ["0"],
    })).toBe(true);
    expect(isAriaIframeToHostMessage({
      type: ARIA_MSG.patchResult,
      revision: 3,
      status: "rejected",
      reason: "anything-goes",
      paths: ["0"],
    })).toBe(false);
    expect(
      isAriaIframeToHostMessage({
        type: ARIA_MSG.ready,
        version: ARIA_PROTOCOL_VERSION,
        bridgeId: ARIA_BRIDGE_ID,
      }),
    ).toBe(false);
    expect(
      isAriaIframeToHostMessage({
        type: "aria:open",
        path: "0.1",
        occurrence: 0,
      }),
    ).toBe(true);
    expect(
      isAriaIframeToHostMessage({
        type: "aria:hover",
        path: "0.1",
        occurrence: 0,
      }),
    ).toBe(true);
  });

  it("writeMarkerConfig emits ephemeral override under node_modules/.aria", async () => {
    const kernelPath = resolveComposerKernelPath();
    if (!fs.existsSync(kernelPath)) {
      // Requires `npm run build:electron` so composer-kernel.mjs exists.
      expect.fail(
        `composer-kernel.mjs missing at ${kernelPath} — run build:electron`,
      );
    }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aria-marker-"));
    try {
      fs.mkdirSync(path.join(tmp, "node_modules"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, "astro.config.mjs"),
        "export default { integrations: [] };\n",
      );
      fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, "src", "middleware.ts"),
        "export function onRequest(context, next) { return context.redirect('/auth'); }\n",
      );

      const result = writeMarkerConfig(tmp);
      expect(result).not.toBeNull();
      if (!result) return;

      expect(result.configArg.replace(/\\/g, "/")).toBe(
        `node_modules/${ARIA_MARKER_DIR}/astro.config.mjs`,
      );
      expect(result.bridgeId).toBe(ARIA_BRIDGE_ID);
      expect(fs.existsSync(result.configPath)).toBe(true);
      expect(fs.existsSync(path.join(result.dir, "kernel.mjs"))).toBe(true);
      expect(fs.existsSync(path.join(result.dir, "design-client.js"))).toBe(
        true,
      );

      // Kernel must resolve @astrojs/compiler without the project hoisting it.
      const vendoredWasm = path.join(
        result.dir,
        "node_modules",
        "@astrojs",
        "compiler",
        "dist",
        "astro.wasm",
      );
      expect(fs.existsSync(vendoredWasm)).toBe(true);

      const cfg = fs.readFileSync(result.configPath, "utf8");
      expect(() =>
        execFileSync(process.execPath, ["--check", result.configPath], {
          stdio: "pipe",
        }),
      ).not.toThrow();
      expect(cfg).toContain("aria-node-markers");
      expect(cfg).toContain('enforce: "pre"');
      expect(cfg).toContain("compressHTML: false");
      expect(cfg).toContain("devToolbar: { enabled: false }");
      expect(cfg).toContain("virtual:aria-design-client");
      expect(cfg).toContain("/__aria/bridge-health");
      expect(cfg).toContain(ARIA_BRIDGE_ID);
      expect(cfg).toContain("ORIGINAL_MIDDLEWARE_QUERY");
      expect(cfg).toContain("middlewareRedirected");
      expect(cfg).toContain("isDesignRequest && middlewareRedirected && isRedirect");
      expect(cfg).toContain("injectScript");
      expect(cfg).toContain("injectRoute");
      expect(cfg).toContain("/__aria/component-thumbnail");
      expect(cfg).toContain("/__aria/component-authoring");
      expect(cfg).toContain("/aria-preview/layout");
      expect(
        fs.existsSync(path.join(result.dir, "component-thumbnail.astro")),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(result.dir, "component-authoring.astro")),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(result.dir, "layout-thumbnail.astro")),
      ).toBe(true);
      expect(cfg).toContain("serializeAstroMarked");
      expect(cfg).toContain("DRAFT_FILE");
      expect(cfg).toContain("server.watcher.add(DRAFT_FILE)");
      expect(cfg).toContain("for (const file of HARNESS_FILES) server.watcher.add(file)");
      expect(cfg).toContain("invalidateHarnessIfStale");
      expect(cfg).toContain("if (HARNESS_FILES.includes(file))");
      expect(cfg).toContain('allowAria = "!**/node_modules/.aria/**"');
      expect(cfg).toContain("statSync");
      expect(cfg).toContain("aria:source-ready");
      expect(cfg).toContain("async handleHotUpdate(context)");
      expect(cfg).toContain("async hotUpdate(options)");
      expect(cfg).toContain('options.type === "delete"');
      expect(cfg).toContain("expected.deleted === true ? [] : undefined");
      expect(cfg).toContain("return [];");
      expect(cfg).not.toContain('type: "full-reload"');
      expect(cfg).toContain("return draft ? source : null");
      expect(cfg).toContain("unwrapped");
      expect(cfg).not.toContain("avb");

      // Smoke: kernel loads + marked serialize works from the vendored tree
      // (simulates pnpm / no top-level @astrojs/compiler in the project).
      const kernel = await import(
        pathToFileURL(path.join(result.dir, "kernel.mjs")).href
      );
      const parsed = await kernel.parseAstro("---\n---\n<div>Hi</div>\n");
      expect(parsed.editable).toBe(true);
      if (!parsed.editable) return;
      const marked = kernel.serializeAstroMarked(parsed.model);
      expect(marked).toContain('data-aria-s="0"');
      expect(marked).toContain('data-aria-e="0"');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
