import { describe, expect, it } from "vitest";
import { parseAstro } from "./parseAstro";
import { serializeAstro } from "./serializeAstro";
import {
  assignComposerPageLayout,
  assignComposerPageNodesToSlot,
  blankLayoutAstroSource,
  blankPageWithLayoutAstroSource,
  buildComposerLayoutContract,
  buildComposerPageSlotGroups,
  composerPageUsesLayoutFile,
  deleteComposerLayoutSlot,
  insertComposerLayoutSlot,
  normalizeComposerPageSlotGroup,
  removeComposerPageLayout,
  renameComposerLayoutSlot,
  renameComposerPageSlotAssignments,
  seedLayoutCreationProps,
  titleFromPageFileName,
  todayDateInputValue,
  unwrapComposerPageSlotAssignments,
} from "./layoutAuthoring";

async function model(source: string) {
  const result = await parseAstro(source);
  expect(result.editable).toBe(true);
  if (!result.editable) throw new Error(result.reason);
  return result.model;
}

describe("real-Astro layout authoring", () => {
  it("creates one immutable default Page content outlet", async () => {
    const parsed = await model(blankLayoutAstroSource());
    const contract = buildComposerLayoutContract(parsed);
    expect(contract.diagnostics).toEqual([]);
    expect(contract.slots).toHaveLength(1);
    expect(contract.defaultSlot).toMatchObject({
      name: null,
      label: "Page content",
      mutable: false,
    });
    expect(deleteComposerLayoutSlot(parsed, contract.defaultSlot!.path).ok).toBe(false);
  });

  it("inserts, validates, renames, and deletes named outlets", async () => {
    const parsed = await model(blankLayoutAstroSource());
    const bodyPath = "1.1";
    expect(
      insertComposerLayoutSlot(parsed, "sidebar", {
        parentPath: bodyPath,
        index: 0,
      }).ok,
    ).toBe(true);
    let contract = buildComposerLayoutContract(parsed);
    expect(contract.slots.map((slot) => slot.name)).toEqual(["sidebar", null]);
    expect(insertComposerLayoutSlot(parsed, "sidebar", { parentPath: bodyPath, index: 0 }).ok).toBe(false);
    expect(insertComposerLayoutSlot(parsed, "Bad Name", { parentPath: bodyPath, index: 0 }).ok).toBe(false);
    expect(renameComposerLayoutSlot(parsed, contract.namedSlots[0]!.path, "aside").ok).toBe(true);
    contract = buildComposerLayoutContract(parsed);
    expect(contract.namedSlots[0]!.name).toBe("aside");
    expect(deleteComposerLayoutSlot(parsed, contract.namedSlots[0]!.path).ok).toBe(true);
    expect(buildComposerLayoutContract(parsed).slots).toHaveLength(1);
  });

  it("orders page groups by layout outlets and exposes fallback/unresolved state", async () => {
    const layout = await model(`---\n---\n<header><slot name="header" /></header><main><slot /></main><aside><slot name="sidebar"><p>Default sidebar</p></slot></aside>`);
    const page = await model(`---\nimport Layout from '../layouts/Base.astro';\n---\n<Layout><Fragment slot="header"><p>Custom header</p></Fragment><main>Page</main><div slot="old">Keep me</div></Layout>`);
    const groups = buildComposerPageSlotGroups(page, buildComposerLayoutContract(layout));
    expect(groups?.groups.map((group) => group.label)).toEqual([
      "Header",
      "Page content",
      "Sidebar",
      "Unresolved slots",
    ]);
    expect(groups?.groups[2]).toMatchObject({ usingFallback: true, readOnly: true });
    expect(groups?.groups[3]!.assignmentPaths).toHaveLength(1);
  });

  it("normalizes direct named children to Fragment without rendered wrapper DOM", async () => {
    const page = await model(`---\nimport Layout from '../layouts/Base.astro';\n---\n<Layout><Header slot="header" /><p slot="header">Hello</p><main>Page</main></Layout>`);
    expect(normalizeComposerPageSlotGroup(page, "header").ok).toBe(true);
    const source = serializeAstro(page);
    expect(source).toContain('<Fragment slot="header">');
    expect(source).toContain("<Header />");
    expect(source).not.toContain('<Header slot="header"');
  });

  it("moves page nodes between named and default regions", async () => {
    const page = await model(`---\nimport Layout from '../layouts/Base.astro';\n---\n<Layout><main>Page</main><Fragment slot="sidebar"><p>Side</p></Fragment></Layout>`);
    expect(assignComposerPageNodesToSlot(page, ["0.0"], "sidebar").ok).toBe(true);
    let source = serializeAstro(page);
    expect(source.indexOf("<main>Page</main>")).toBeGreaterThan(source.indexOf('<Fragment slot="sidebar">'));
    expect(assignComposerPageNodesToSlot(page, ["0.0.1"], null).ok).toBe(true);
    source = serializeAstro(page);
    expect(source).toContain("<main>Page</main>");
  });

  it("preserves the requested order when moving into a slot group", async () => {
    const page = await model(`---\nimport Layout from '../layouts/Base.astro';\n---\n<Layout><main>Page</main><p>Second</p><Fragment slot="sidebar"><p>One</p><p>Three</p></Fragment></Layout>`);
    expect(assignComposerPageNodesToSlot(page, ["0.1"], "sidebar", 1).ok).toBe(true);
    const source = serializeAstro(page);
    expect(source.indexOf("<p>One</p>")).toBeLessThan(source.indexOf("<p>Second</p>"));
    expect(source.indexOf("<p>Second</p>")).toBeLessThan(source.indexOf("<p>Three</p>"));
  });

  it("renames and unwraps consuming page assignments", async () => {
    const page = await model(`---\nimport Layout from '../layouts/Base.astro';\n---\n<Layout><Fragment slot="sidebar"><p>Side</p></Fragment><Card slot="sidebar" /></Layout>`);
    expect(renameComposerPageSlotAssignments(page, "sidebar", "aside")).toBe(2);
    expect(serializeAstro(page)).toContain('slot="aside"');
    expect(unwrapComposerPageSlotAssignments(page, "aside")).toBe(2);
    const source = serializeAstro(page);
    expect(source).not.toContain("slot=");
    expect(source).toContain("<p>Side</p>");
    expect(source).toContain("<Card />");
  });

  it("assigns a layout by moving body content and removes it to a clean fragment", async () => {
    const page = await model(`---\nimport '../styles/global.css';\n---\n<!doctype html><html><head><title>Test</title></head><body><main>Hello</main></body></html>`);
    expect(assignComposerPageLayout(page, {
      name: "BaseLayout",
      importPath: "../layouts/BaseLayout.astro",
    }).ok).toBe(true);
    let source = serializeAstro(page);
    expect(source).toContain("import BaseLayout from '../layouts/BaseLayout.astro';");
    expect(source).toContain("<BaseLayout>");
    expect(source).toContain("<main>Hello</main>");
    expect(source).not.toContain("<html>");
    expect(removeComposerPageLayout(page).ok).toBe(true);
    source = serializeAstro(page);
    expect(source).toContain("<main>Hello</main>");
    expect(source).not.toContain("BaseLayout");
  });

  it("creates a page scaffold inside its selected layout", async () => {
    const source = blankPageWithLayoutAstroSource({
      layoutName: "BaseLayout",
      layoutImport: "../layouts/BaseLayout.astro",
      props: { theme: { type: "string", value: "dark" } },
    });
    expect(source).toContain("<BaseLayout theme=\"dark\">");
    expect(source).toContain('data-aria-type="Section"');
    expect((await parseAstro(source)).editable).toBe(true);
  });

  it("seeds serializable required layout props from the page name", () => {
    const seeded = seedLayoutCreationProps({
      pageName: "blog/my-post",
      now: new Date(2026, 7, 17),
      fields: [
        { name: "title", type: "string", optional: false },
        { name: "pubDate", type: "date", optional: false },
        { name: "heroImage", type: "other", optional: true },
        { name: "config", type: "other", optional: false },
      ],
    });
    expect(titleFromPageFileName("blog/my-post")).toBe("My Post");
    expect(seeded.props.title).toEqual({ type: "string", value: "My Post" });
    expect(seeded.props.pubDate).toEqual({
      type: "expr",
      value: `new Date("2026-08-17T00:00:00")`,
    });
    expect(seeded.props.heroImage).toBeUndefined();
    expect(seeded.missingRequired).toEqual(["config"]);
    expect(todayDateInputValue(new Date(2026, 7, 17))).toBe("2026-08-17");
  });

  it("resolves relative and source-alias layout consumers", async () => {
    const relative = await model(`---\nimport Base from '../../layouts/Base.astro';\n---\n<Base><main /></Base>`);
    expect(
      composerPageUsesLayoutFile(
        relative,
        "src/pages/blog/post.astro",
        "src/layouts/Base.astro",
      ),
    ).toBe(true);
    const alias = await model(`---\nimport Base from '@/layouts/Base.astro';\n---\n<Base><main /></Base>`);
    expect(
      composerPageUsesLayoutFile(alias, "src/pages/index.astro", "src/layouts/Base.astro"),
    ).toBe(true);
  });
});
