import { describe, expect, it } from "vitest";
import {
  buildComposerLayerTree,
  resolveComposerLayerDropPosition,
  scopeComposerLayerTreeToInstance,
  wrapComposerLayerTreeInActiveDocument,
} from "./layers";
import { parseAstro } from "./parseAstro";
import { buildComposerLayoutContract } from "./layoutAuthoring";

async function modelFor(source: string) {
  const result = await parseAstro(source);
  expect(result.editable).toBe(true);
  if (!result.editable) throw new Error("expected editable source");
  return result.model;
}

describe("Composer Layers projection", () => {
  it("prefers a persisted custom layer label without changing its source label", async () => {
    const tree = buildComposerLayerTree(
      await modelFor('<section data-aria-layer-label="Campaign hero"><h1>Welcome</h1></section>'),
    );
    expect(tree.content[0]).toMatchObject({
      label: "Campaign hero",
      sourceLabel: "<section>",
      semanticType: "section",
    });
    expect(tree.content[0]?.searchText).toContain("campaign hero");
  });

  it("uses ephemeral project-data analysis for a meaningful loop label", async () => {
    const doc = await modelFor(`---\nconst bio = ["One", "Two"];\n---\n{bio.map((para) => (<p>{para}</p>))}`);
    const loop = doc.nodes[0];
    expect(loop?.kind).toBe("map");
    if (loop?.kind === "map") {
      loop.dataBinding = { ownership: "project", label: "Profile Bio", itemCount: 2 };
    }
    expect(buildComposerLayerTree(doc).content[0]).toMatchObject({
      label: "Profile Bio · 2 items",
      hasDataBinding: true,
      hasCmsBinding: false,
    });
  });

  it("keeps a block heading visible beneath a link wrapper", async () => {
    const tree = buildComposerLayerTree(await modelFor('<a href="/"><h2>Linked heading</h2></a>'));
    expect(tree.content[0]).toMatchObject({ semanticType: "link", label: "Linked heading" });
    expect(tree.content[0]?.children[0]).toMatchObject({
      path: "0.0",
      semanticType: "heading",
      label: "Linked heading",
    });
  });

  it("labels a native Popover group and its target as Popover content", async () => {
    const tree = buildComposerLayerTree(await modelFor(`---\n---\n<div><button popovertarget="menu">Open popover</button><div id="menu" popover><h2>Menu</h2></div></div>`));
    expect(tree.content[0]).toMatchObject({ semanticType: "popover", label: "Popover" });
    expect(tree.content[0]?.children[0]).toMatchObject({ semanticType: "button", label: "Open popover" });
    expect(tree.content[0]?.children[1]).toMatchObject({ semanticType: "popover", label: "Popover content" });
  });
  it("keeps comment text available for Layers preview and search", async () => {
    const tree = buildComposerLayerTree(
      await modelFor(`---\n---\n<!-- Keep this section aligned\nwith the campaign grid. -->\n<section></section>`),
    );
    expect(tree.content[0]).toMatchObject({
      kind: "comment",
      label: "Comment",
      commentPreview: "Keep this section aligned\nwith the campaign grid.",
    });
    expect(tree.content[0]?.searchText).toContain("keep this section aligned");
  });

  it("projects Aria Motion and CMS indicators from Astro source", async () => {
    const model = await modelFor(`---
/* @aria-cms-query:posts */
const ariaCmsPosts = await getCollection("posts");
---
<main>
  <section class="aria-motion aria-motion-fade aria-motion-reveal"></section>
  <p>{entry?.data?.title ?? /* @aria-cms-fallback */ "Title"}</p>
  {ariaCmsPosts.map((entry) => (<article>{entry.data.title}</article>))}
</main>`);
    const main = buildComposerLayerTree(model).content[0]!;
    expect(main.children[0]).toMatchObject({ hasMotion: true });
    expect(main.children[1]).toMatchObject({ hasCmsBinding: true });
    expect(main.children[2]).toMatchObject({ hasCmsBinding: true });
    expect(main.children[2]).toMatchObject({
      label: "Posts collection loop",
      cmsOwnership: "managed",
    });
    expect(main.children[2]?.children[0]?.children[0]).toMatchObject({
      label: "Title",
      cmsOwnership: "managed",
    });
  });

  it("separates body content from a simplified Head projection", async () => {
    const model = await modelFor(`---\n---\n<!doctype html>
<html lang="en">
  <head><meta name="description" content="Test" /><title>Example</title></head>
  <body><main><h1>Hello world</h1></main></body>
</html>`);
    const tree = buildComposerLayerTree(model);
    expect(tree.contentParentPath).not.toBeNull();
    expect(tree.content).toHaveLength(1);
    expect(tree.content[0]?.label).toBe("Main");
    expect(tree.content[0]?.children[0]?.label).toBe("Hello world");

    const documentPaths = new Set<string>();
    const walk = (rows: typeof tree.document) => {
      for (const row of rows) {
        expect(documentPaths.has(row.path)).toBe(false);
        documentPaths.add(row.path);
        walk(row.children);
      }
    };
    walk(tree.document);
    expect([...documentPaths].some((path) => path === tree.content[0]?.path)).toBe(false);
    expect(tree.document).toHaveLength(1);
    expect(tree.document[0]).toMatchObject({
      label: "Head",
      semanticType: "head",
      isDocumentShell: true,
    });
    expect(tree.document[0]?.children.map((row) => row.label)).toEqual([
      "Search description",
      "Page title",
    ]);
    expect([...documentPaths].some((path) => path === "0")).toBe(false);
    expect([...documentPaths].some((path) => path.includes("@document-advanced"))).toBe(false);
  });

  it("exposes renderable source outside page Content in a locked Document group", async () => {
    const model = await modelFor(`---\n---\n<section><h1>Orphan hero</h1></section>
<!doctype html><html><head><title>Example</title></head><body>
  <header>Header</header><main>Main</main><footer>Footer</footer>
</body></html>`);
    const tree = buildComposerLayerTree(model, { pageDocument: true });
    expect(tree.content.map((row) => row.label)).toEqual(["Header", "Main", "Footer"]);
    const outside = tree.document.find((row) => row.label === "Outside page content");
    expect(outside).toMatchObject({
      path: "@outside-page-content",
      region: "document",
      synthetic: true,
      presentationOnly: true,
      sourceLocked: true,
      draggable: false,
      deletable: false,
      canAcceptChildren: false,
    });
    expect(outside?.children[0]).toMatchObject({
      path: "0",
      label: "Section",
      region: "document",
      sourceLocked: true,
      draggable: false,
      deletable: false,
      canAcceptChildren: false,
    });
    expect(outside?.children[0]).not.toHaveProperty("presentationOnly");
    expect(outside?.children[0]).not.toHaveProperty("contextOnly");
    expect(outside?.children[0]?.children[0]).toMatchObject({
      path: "0.0",
      label: "Orphan hero",
      sourceLocked: true,
    });
  });

  it("uses top-level nodes as Content for fragment Astro pages", async () => {
    const tree = buildComposerLayerTree(
      await modelFor(`---\n---\n<section data-aria-type="Section"><p>Intro copy</p></section>`),
    );
    expect(tree.document).toEqual([]);
    expect(tree.contentParentPath).toBeNull();
    expect(tree.content[0]).toMatchObject({
      label: "Section",
      semanticType: "section",
      path: "0",
    });
    expect(tree.content[0]?.children[0]).toMatchObject({
      label: "Intro copy",
      semanticType: "text",
    });
    expect(tree.content[0]?.children[0]?.children).toEqual([]);
  });

  it("projects mixed and dynamic text as one structure-first layer", async () => {
    const tree = buildComposerLayerTree(
      await modelFor(`---\n---\n<h1>Real Projects. <strong>Real Results.</strong> {name}</h1>`),
    );
    expect(tree.content[0]).toMatchObject({
      semanticType: "heading",
      label: "Real Projects. Real Results. …",
      children: [],
    });
    expect(tree.content[0]?.searchText).toContain("real results");
  });

  it("exposes a nested image under a folded paragraph", async () => {
    const tree = buildComposerLayerTree(
      await modelFor(
        '<p>With years of experience <img src="/src/assets/images/photo.webp" alt="" /> unique features.</p>',
      ),
    );
    expect(tree.content[0]).toMatchObject({
      semanticType: "text",
      children: [
        {
          path: "0.1",
          semanticType: "image",
          tag: "img",
        },
      ],
    });
    expect(tree.content[0]?.children).toHaveLength(1);
  });

  it("projects an explicit Rich Text block as one layer", async () => {
    const tree = buildComposerLayerTree(
      await modelFor(`---\n---\n<div data-aria-type="RichText"><h2>Title</h2><p>Body</p></div>`),
    );
    expect(tree.content[0]).toMatchObject({
      label: "Rich Text",
      semanticType: "richtext",
      children: [],
    });
    expect(tree.content[0]?.searchText).toContain("title body");
  });

  it("shows ordered page-owned slot groups with separate Layout and Head rows", async () => {
    const layout = await modelFor(`---\n---\n<!doctype html><html><head><title>{title}</title><meta name="viewport" content="width=device-width" /></head><body><slot name="header" /><slot /><slot name="sidebar"><p>Default</p></slot></body></html>`);
    const page = await modelFor(`---\nimport Layout from '../layouts/Base.astro';\n---\n<Layout><Fragment slot="header"><Header /></Fragment><main>Page</main></Layout>`);
    const tree = buildComposerLayerTree(page, {
      pageDocument: true,
      layoutContract: buildComposerLayoutContract(layout),
      layoutModel: layout,
      layoutFile: "src/layouts/Base.astro",
    });
    expect(tree.content.map((row) => row.label)).toEqual([
      "Header",
      "Page content",
      "Sidebar · Using layout default",
    ]);
    expect(tree.content[0]?.children[0]?.label).toBe("Header");
    expect(tree.content[1]?.children[0]?.label).toBe("Main");
    expect(tree.content[2]?.children[0]).toMatchObject({
      label: "Default",
      contextOnly: true,
      draggable: false,
    });
    expect(tree.document[0]).toMatchObject({
      label: "Layout",
      path: "0",
      draggable: false,
      pageLayout: true,
      children: [],
    });
    expect(tree.document[1]).toMatchObject({
      label: "Head",
      contextOnly: true,
    });
    const inherited = tree.document.slice(1).flatMap(function visit(row): typeof tree.document {
      return [row, ...row.children.flatMap(visit)];
    });
    expect(inherited.length).toBeGreaterThan(2);
    expect(inherited.every((row) => row.contextOnly && !row.draggable && !row.deletable))
      .toBe(true);
    expect(new Set(inherited.map((row) => row.treeKey)).size).toBe(inherited.length);
    expect(inherited.find((row) => row.label === "Advanced head")).toMatchObject({
      presentationOnly: true,
      contextOnly: true,
    });
    expect(inherited.some((row) => row.label === "Viewport")).toBe(true);
  });

  it("keeps a persistent Layout None row on direct pages", async () => {
    const page = await modelFor(`---\n---\n<html><head></head><body><main>Page</main></body></html>`);
    const tree = buildComposerLayerTree(page, { pageDocument: true });
    expect(tree.document[0]).toMatchObject({
      label: "No layout",
      synthetic: true,
      pageLayout: true,
    });
    expect(tree.content[0]?.label).toBe("Main");
  });
});

describe("Composer Layers drop geometry", () => {
  it("resolves before, inside, and after zones", () => {
    const base = { top: 100, height: 28, allowInside: true };
    expect(resolveComposerLayerDropPosition({ ...base, clientY: 102 })).toBe("before");
    expect(resolveComposerLayerDropPosition({ ...base, clientY: 114 })).toBe("inside");
    expect(resolveComposerLayerDropPosition({ ...base, clientY: 127 })).toBe("after");
  });

  it("splits non-container rows into before and after only", () => {
    const base = { top: 10, height: 28, allowInside: false };
    expect(resolveComposerLayerDropPosition({ ...base, clientY: 20 })).toBe("before");
    expect(resolveComposerLayerDropPosition({ ...base, clientY: 30 })).toBe("after");
  });
});

describe("active component layers", () => {
  it("wraps active source rows in a named component root without changing the source projection", async () => {
    const source = buildComposerLayerTree(
      await modelFor(`---\n---\n<section><div><h2>Simler But Different</h2></div></section>`),
    );
    const active = wrapComposerLayerTreeInActiveDocument(source, {
      file: "src/components/Intro.astro",
      name: "Intro",
      kind: "component",
    });

    expect(active.content).toHaveLength(1);
    expect(active.content[0]).toMatchObject({
      label: "Intro",
      semanticType: "component",
      sourceLabel: "component · src/components/Intro.astro",
      contextOnly: true,
      synthetic: true,
      activeDocumentRoot: true,
      draggable: false,
      deletable: false,
      insertTarget: {
        parentPath: source.contentParentPath,
        index: source.content.length,
      },
    });
    expect(active.content[0]?.children).toBe(source.content);
    expect(active.content[0]?.children[0]?.label).toBe("Section");
    expect(active.document).toBe(source.document);
    expect(active.contentParentPath).toBe(source.contentParentPath);
  });

  it("shows only the active component source while retaining its canvas occurrence", async () => {
    const footer = buildComposerLayerTree(
      await modelFor(`---\n---\n<footer><p>Copyright</p><nav><a>Social</a></nav></footer>`),
    );
    const segment = {
      ownerFile: "src/pages/index.astro",
      hostPath: "0.2",
      occurrence: 2,
    };
    const active = scopeComposerLayerTreeToInstance(footer, {
      hostPath: segment.hostPath,
      occurrence: segment.occurrence,
      chain: [segment],
    });
    const rows = active.content.flatMap(function visit(row): typeof active.content {
      return [row, ...row.children.flatMap(visit)];
    });

    expect(rows.map((row) => row.label)).toEqual([
      "Footer",
      "Copyright",
      "Navigation",
      "Social",
    ]);
    expect(rows.some((row) => ["Header", "Main", "Page copy"].includes(row.label))).toBe(false);
    expect(rows.every((row) => row.instance?.occurrence === 2)).toBe(true);
    expect(rows.every((row) => row.instance?.chain[0] === segment)).toBe(true);
    expect(active.content[0]).toMatchObject({
      path: "0",
      treeKey: "0",
      draggable: true,
    });
    expect(active.content[0]?.contextOnly).toBeUndefined();
  });

  it("switches a nested drill to the child source without retaining parent rows", async () => {
    const child = buildComposerLayerTree(
      await modelFor(`---\n---\n<article><h2>Child source</h2></article>`),
    );
    const parentSegment = {
      ownerFile: "src/pages/index.astro",
      hostPath: "0.0",
      occurrence: 1,
    };
    const childSegment = {
      ownerFile: "src/components/Parent.astro",
      hostPath: "0.1",
      occurrence: 3,
    };
    const active = scopeComposerLayerTreeToInstance(child, {
      hostPath: childSegment.hostPath,
      occurrence: childSegment.occurrence,
      chain: [parentSegment, childSegment],
    });
    const rows = active.content.flatMap(function visit(row): typeof active.content {
      return [row, ...row.children.flatMap(visit)];
    });

    expect(rows.map((row) => row.label)).toEqual(["Article", "Child source"]);
    expect(rows.some((row) => row.label === "Parent")).toBe(false);
    expect(rows.every((row) => row.instance?.chain.length === 2)).toBe(true);
    expect(rows.every((row) => row.instance?.occurrence === 3)).toBe(true);
  });

  it("keeps one source tree while changing the selected rendered instance", async () => {
    const source = buildComposerLayerTree(
      await modelFor(`---\n---\n<section><p>Shared source</p></section>`),
    );
    const first = scopeComposerLayerTreeToInstance(source, {
      hostPath: "0.0",
      occurrence: 0,
      chain: [{ ownerFile: "src/pages/index.astro", hostPath: "0.0", occurrence: 0 }],
    });
    const second = scopeComposerLayerTreeToInstance(source, {
      hostPath: "0.1",
      occurrence: 1,
      chain: [{ ownerFile: "src/pages/index.astro", hostPath: "0.1", occurrence: 1 }],
    });

    expect(second.content.map((row) => row.treeKey)).toEqual(
      first.content.map((row) => row.treeKey),
    );
    expect(first.content[0]?.instance?.occurrence).toBe(0);
    expect(second.content[0]?.instance?.occurrence).toBe(1);
  });

  it("labels Aria BEM primitives from data-aria-type", async () => {
    const tree = buildComposerLayerTree(
      await modelFor(
        `---\n---\n<article data-aria-type="Card" class="aria-card"><h3>Title</h3></article>`,
      ),
    );
    expect(tree.content[0]).toMatchObject({
      label: "Card",
      semanticType: "card",
    });
  });

  it("keeps Avatar image and initials independently selectable", async () => {
    const tree = buildComposerLayerTree(
      await modelFor(
        `---\n---\n<span data-aria-type="Avatar" class="aria-avatar"><img class="aria-avatar__image" src="/face.jpg" alt="" /><span class="aria-avatar__fallback">AA</span></span>`,
      ),
    );
    expect(tree.content[0]).toMatchObject({
      label: "Avatar",
      semanticType: "avatar",
    });
    expect(tree.content[0]?.children.map((row) => row.semanticType)).toEqual(["image", "text"]);
    expect(tree.content[0]?.children[0]).toMatchObject({ path: "0.0", semanticType: "image" });
  });
});
