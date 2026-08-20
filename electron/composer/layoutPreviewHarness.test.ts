import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LAYOUT_PREVIEW_ROUTE,
  LAYOUT_THUMB_ENTRY_REL,
  buildLayoutPreviewHarnessSource,
  ensureLayoutPreviewHarness,
  isSafeLayoutId,
} from "../layoutPreviewHarness";

describe("ephemeral layout preview route", () => {
  it("renders safe props and labeled default and named slot specimens", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "aria-layout-harness-"));
    mkdirSync(path.join(root, "src/layouts"), { recursive: true });
    writeFileSync(
      path.join(root, "src/layouts/Base.astro"),
      `---\ninterface Props {\n  title: string;\n}\nconst { title } = Astro.props;\n---\n<html><body><header><slot name="header" /></header><main><slot /></main></body></html>`,
    );

    const result = await ensureLayoutPreviewHarness(root, "src/layouts/Base.astro");
    expect(result.absolutePath.replace(/\\/g, "/")).toMatch(
      new RegExp(`${LAYOUT_THUMB_ENTRY_REL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    );
    const source = readFileSync(result.absolutePath, "utf8");
    expect(source).toContain('const ariaPreviewProps = {"title":"Title"}');
    expect(source).toContain('<Fragment slot="header">');
    expect(source).toContain('data-aria-layout-slot="default"');
    expect(source).toContain("document.documentElement.dataset.ariaLayoutPreview");
    expect(LAYOUT_PREVIEW_ROUTE).toBe("/aria-preview/layout");
  });

  it("escapes labels and rejects non-layout paths", () => {
    const source = buildLayoutPreviewHarnessSource({
      layoutId: "src/layouts/Base.astro",
      props: {},
      slots: [{ name: null, label: "Page <content> & more" }],
    });
    expect(source).toContain("Page &lt;content&gt; &amp; more");
    expect(isSafeLayoutId("src/components/Base.astro")).toBe(false);
    expect(isSafeLayoutId("src/layouts/../Base.astro")).toBe(false);
  });
});
