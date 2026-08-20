import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMPONENT_AUTHORING_ENTRY_REL,
  COMPONENT_AUTHORING_ROUTE,
  COMPONENT_PREVIEW_ROUTE,
  COMPONENT_THUMB_ENTRY_REL,
  COMPONENT_THUMB_VERSION,
  buildComponentPreviewHarnessSource,
  ensureComponentPreviewEntrypoints,
  ensureComponentPreviewHarness,
  migrateLegacyComponentPreviewHarness,
  prepareComponentAuthoringPreview,
} from "./componentPreviewHarness";

function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "aria-component-preview-"));
  mkdirSync(path.join(root, "src/components"), { recursive: true });
  writeFileSync(
    path.join(root, "src/components/Hero.astro"),
    `---\ninterface Props {\n  title: string;\n  active?: boolean;\n}\nconst { title, active = true } = Astro.props;\n---\n<section><h1>{title}</h1><slot /></section>\n`,
  );
  writeFileSync(
    path.join(root, "src/components/Card.astro"),
    `---\n---\n<article>Card</article>\n`,
  );
  return root;
}

describe("ephemeral component preview routes", () => {
  it("keeps thumbnail and authoring entrypoints independent", () => {
    const root = fixture();
    const entries = ensureComponentPreviewEntrypoints(root);
    expect(readFileSync(entries.authoring, "utf8")).not.toContain(
      "data-aria-component-authoring",
    );
    expect(entries.thumbnail.replace(/\\/g, "/")).toMatch(
      new RegExp(`${COMPONENT_THUMB_ENTRY_REL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    );
    expect(entries.authoring.replace(/\\/g, "/")).toMatch(
      new RegExp(`${COMPONENT_AUTHORING_ENTRY_REL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    );
    expect(entries.thumbnail).not.toBe(entries.authoring);

    const session = prepareComponentAuthoringPreview(root, "src/components/Hero.astro");
    expect(session.route).toBe(COMPONENT_AUTHORING_ROUTE);
    expect(COMPONENT_PREVIEW_ROUTE).not.toBe(COMPONENT_AUTHORING_ROUTE);
    expect(session.data.props).toMatchObject({ title: "Title", active: true });
    const source = readFileSync(entries.authoring, "utf8");
    expect(source).toContain("<Component {...ariaPreviewProps}")
    expect(source).toContain('data-aria-component-authoring="src/components/Hero.astro"');
    expect(source).not.toContain("aria-component-preview-root");
    expect(source).toContain("../../src/components/Hero.astro");
  });

  it("builds a query-param catalog instead of a single static import", () => {
    const source = buildComponentPreviewHarnessSource([
      "src/components/Hero.astro",
      "src/components/Card.astro",
      "src/layouts/Main.astro",
      "../secret.astro",
    ]);
    expect(source).toContain(`v${COMPONENT_THUMB_VERSION}`);
    expect(source).toContain(`data-aria-component-thumb-version="${COMPONENT_THUMB_VERSION}"`);
    expect(source).toContain("Astro.url.searchParams.get(\"id\")");
    expect(source).toContain('() => import("../../src/components/Hero.astro")');
    expect(source).toContain('() => import("../../src/components/Card.astro")');
    expect(source).not.toContain("import Component from");
    expect(source).not.toContain("src/layouts/Main.astro");
    expect(source).not.toContain("../secret.astro");
    const cardAt = source.indexOf("src/components/Card.astro");
    const heroAt = source.indexOf("src/components/Hero.astro");
    expect(cardAt).toBeGreaterThan(0);
    expect(cardAt).toBeLessThan(heroAt);
  });

  it("does not rewrite an unchanged catalog harness", () => {
    const root = fixture();
    const first = ensureComponentPreviewHarness(root, [
      "src/components/Hero.astro",
      "src/components/Card.astro",
    ]);
    expect(first.written).toBe(true);
    const source = readFileSync(first.absolutePath, "utf8");
    expect(source).toContain('() => import("../../src/components/Hero.astro")');
    const second = ensureComponentPreviewHarness(root, [
      "src/components/Card.astro",
      "src/components/Hero.astro",
    ]);
    expect(second.written).toBe(false);
  });

  it("removes only an exact legacy Aria harness", () => {
    const root = fixture();
    const legacy = path.join(root, "src/pages/aria-preview/component.astro");
    mkdirSync(path.dirname(legacy), { recursive: true });
    writeFileSync(legacy, "/** Aria-managed component preview harness (v3). */\n");
    expect(migrateLegacyComponentPreviewHarness(root)).toBe(true);
    expect(existsSync(legacy)).toBe(false);

    mkdirSync(path.dirname(legacy), { recursive: true });
    writeFileSync(legacy, "<h1>User preview</h1>\n");
    expect(migrateLegacyComponentPreviewHarness(root)).toBe(false);
    expect(readFileSync(legacy, "utf8")).toContain("User preview");
  });
});
