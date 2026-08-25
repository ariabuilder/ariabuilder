import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseAstro } from "../../shared/composer/parseAstro";
import { serializeAstro } from "../../shared/composer/serializeAstro";
import { bindProjectDataTextAtPath } from "../../shared/composer/projectDataBindings";
import type { EditableNode } from "../../shared/composer/types";
import { editProjectDataCatalogValue, listProjectData } from "./projectDataCatalog";

function findPath(nodes: EditableNode[], predicate: (node: EditableNode) => boolean, parent = ""): string | null {
  for (let index = 0; index < nodes.length; index += 1) {
    const current = parent ? `${parent}.${index}` : String(index);
    const node = nodes[index]!;
    if (predicate(node)) return current;
    const lists = node.kind === "conditional" ? [node.consequent, ...(node.alternate ? [node.alternate] : [])]
      : "children" in node && Array.isArray(node.children) ? [node.children] : [];
    for (const children of lists) {
      const result = findPath(children, predicate, current);
      if (result) return result;
    }
  }
  return null;
}

describe("project data catalog", () => {
  let root = "";
  let page = "";

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-project-catalog-"));
    fs.mkdirSync(path.join(root, "src/pages"), { recursive: true });
    fs.mkdirSync(path.join(root, "src/data"), { recursive: true });
    fs.mkdirSync(path.join(root, "src/assets"), { recursive: true });
    fs.writeFileSync(path.join(root, "src/assets/bridge.webp"), "asset");
    fs.writeFileSync(path.join(root, "src/data/features.json"), JSON.stringify([
      { title: "Visible", description: "From JSON", enabled: true },
      { title: "Hidden", description: "Filtered", enabled: false },
    ], null, 2));
    fs.writeFileSync(path.join(root, "src/data/exported.ts"), "export const contact = { email: 'hello@example.com' } as const;\n");
    page = `---
import bridge from "../assets/bridge.webp";
import featuresData from "../data/features.json";
const SEO = { title: "Geo", description: "Drilling" };
const featuredProjects = [
  { title: "First", description: "One", image: bridge, link: "/first" },
  { title: "Second", description: "Two", image: bridge, link: "/second" },
  { title: "Third", description: "Three", image: bridge, link: "/third" },
];
const visibleFeatures = featuresData.filter((feature) => feature.enabled === true);
---
{featuredProjects.map((project) => (
  <article><h3>{project.title}</h3><p>{project.description}</p></article>
))}`;
    fs.writeFileSync(path.join(root, "src/pages/index.astro"), page);
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("catalogs the selected loop occurrence without losing siblings to an asset import", async () => {
    const result = await listProjectData(root, {
      relativeFile: "src/pages/index.astro",
      source: page,
      selectionPath: "0.0.0",
      occurrence: 2,
      target: { kind: "text" },
    });
    const current = result.groups.find((group) => group.id === "current-item")!.fields;
    expect(current.map((field) => field.pathLabel)).toEqual([
      "Current item · Description",
      "Current item · Image",
      "Current item · Link",
      "Current item · Title",
    ]);
    expect(current.find((field) => field.label === "Title")).toMatchObject({
      expression: "project.title",
      value: "Third",
      selectedItem: 2,
      writable: true,
    });
    expect(result.selectedFieldId).toBe(current.find((field) => field.label === "Title")?.id);
    expect(result.groups.find((group) => group.id === "page")?.fields.some((field) => field.pathLabel === "SEO · Title")).toBe(true);
    expect(result.groups.find((group) => group.id === "project")?.fields.some((field) => field.sourceFile === "src/data/exported.ts")).toBe(true);
    expect(result.groups[0]!.roots).toEqual(expect.arrayContaining([expect.objectContaining({ expression: "project" })]));
    expect(result.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: "src/pages/index.astro", kind: "astro", editable: true }),
      expect.objectContaining({ file: "src/data/exported.ts", kind: "module" }),
      expect.objectContaining({ file: "src/assets/bridge.webp", kind: "asset", editable: false }),
    ]));

    const parsed = await parseAstro(page, { filename: "src/pages/index.astro" });
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) return;
    const description = current.find((field) => field.label === "Description")!;
    expect(bindProjectDataTextAtPath(parsed.model, result.targetPath, description).ok).toBe(true);
    const managed = await listProjectData(root, {
      relativeFile: "src/pages/index.astro",
      source: serializeAstro(parsed.model),
      selectionPath: "0.0.0",
      occurrence: 2,
      target: { kind: "text" },
    });
    expect(managed).toMatchObject({ managed: true, expression: "project.description" });
    expect(managed.selectedFieldId).toBe(managed.groups[0]!.fields.find((field) => field.label === "Description")?.id);
  });

  it("edits only the proven selected leaf and rejects a stale source hash", async () => {
    const result = await listProjectData(root, {
      relativeFile: "src/pages/index.astro",
      source: page,
      selectionPath: "0.0.0",
      occurrence: 2,
      target: { kind: "text" },
    });
    const title = result.groups[0]!.fields.find((field) => field.label === "Title")!;
    editProjectDataCatalogValue(root, {
      sourceFile: title.sourceFile!,
      expectedSourceHash: title.sourceHash!,
      sourceRange: title.sourceRange!,
      value: "Changed third",
    });
    const next = fs.readFileSync(path.join(root, "src/pages/index.astro"), "utf8");
    expect(next).toContain('title: "First"');
    expect(next).toContain('title: "Second"');
    expect(next).toContain('title: "Changed third"');
    expect(() => editProjectDataCatalogValue(root, {
      sourceFile: title.sourceFile!,
      expectedSourceHash: title.sourceHash!,
      sourceRange: title.sourceRange!,
      value: "Stale",
    })).toThrow(/PROJECT_DATA_CONFLICT/);
  });

  it("uses exact disk source for edit hashes while inspecting the current Composer selection", async () => {
    const selectionSource = page.replace("<article><h3>", "<article>\n    <h3>");
    const result = await listProjectData(root, {
      relativeFile: "src/pages/index.astro",
      source: page,
      selectionSource,
      selectionPath: "0.0.0",
      occurrence: 2,
      target: { kind: "text" },
    });
    const title = result.groups[0]!.fields.find((field) => field.label === "Title")!;
    editProjectDataCatalogValue(root, {
      sourceFile: title.sourceFile!,
      expectedSourceHash: title.sourceHash!,
      sourceRange: title.sourceRange!,
      value: "Exact source edit",
    });
    expect(fs.readFileSync(path.join(root, "src/pages/index.astro"), "utf8")).toContain('title: "Exact source edit"');
  });

  it("rejects non-finite numeric edits before touching source", async () => {
    const numberedPage = page.replace('{ title: "First",', '{ title: "First", rank: 1,');
    fs.writeFileSync(path.join(root, "src/pages/index.astro"), numberedPage);
    const result = await listProjectData(root, {
      relativeFile: "src/pages/index.astro",
      source: numberedPage,
      selectionPath: "0.0.0",
      occurrence: 0,
      target: { kind: "text" },
    });
    const rank = result.groups[0]!.fields.find((field) => field.label === "Rank")!;
    expect(() => editProjectDataCatalogValue(root, {
      sourceFile: rank.sourceFile!,
      expectedSourceHash: rank.sourceHash!,
      sourceRange: rank.sourceRange!,
      value: Number.NaN,
    })).toThrow(/PROJECT_DATA_INVALID_VALUE/);
    expect(() => editProjectDataCatalogValue(root, {
      sourceFile: rank.sourceFile!,
      expectedSourceHash: rank.sourceHash!,
      sourceRange: rank.sourceRange!,
      value: null,
    })).toThrow(/PROJECT_DATA_INVALID_VALUE/);
    expect(fs.readFileSync(path.join(root, "src/pages/index.astro"), "utf8")).toBe(numberedPage);
  });

  it("offers array roots and item counts when rebinding an existing loop", async () => {
    const parsed = await parseAstro(page, { filename: "src/pages/index.astro" });
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) return;
    const loopPath = findPath(parsed.model.nodes, (node) => node.kind === "map")!;
    const result = await listProjectData(root, {
      relativeFile: "src/pages/index.astro",
      source: page,
      selectionPath: loopPath,
      occurrence: 0,
      target: { kind: "collection" },
    });
    expect(result.groups[0]!.fields).toHaveLength(0);
    expect(result.groups[1]!.fields.find((field) => field.expression === "featuredProjects")).toMatchObject({ itemCount: 3, shape: "array" });
    expect(result.groups[2]!.fields.find((field) => field.sourceFile === "src/data/features.json")).toMatchObject({ itemCount: 2, shape: "array" });
    expect(result.sources).toEqual(expect.arrayContaining([expect.objectContaining({ file: "src/data/features.json", kind: "json" })]));
  });

  it("preserves exact provenance through a static filter", async () => {
    const filteredPage = page.replace("featuredProjects.map", "visibleFeatures.map").replaceAll("project.description", "project.description");
    const result = await listProjectData(root, {
      relativeFile: "src/pages/index.astro",
      source: filteredPage,
      selectionPath: "0.0.0",
      occurrence: 0,
      target: { kind: "text" },
    });
    expect(result.groups[0]!.fields.find((field) => field.label === "Title")).toMatchObject({
      value: "Visible",
      sourceFile: "src/data/features.json",
      writable: true,
    });
  });

  it("keeps known fields bindable but read-only through unproven transforms", async () => {
    const transformedPage = page
      .replace("const visibleFeatures", "const sortedProjects = featuredProjects.sort((a, b) => a.title.localeCompare(b.title));\nconst visibleFeatures")
      .replace("featuredProjects.map", "sortedProjects.map");
    const result = await listProjectData(root, {
      relativeFile: "src/pages/index.astro",
      source: transformedPage,
      selectionPath: "0.0.0",
      occurrence: 0,
      target: { kind: "text" },
    });
    const title = result.groups[0]!.fields.find((field) => field.label === "Title")!;
    expect(title).toMatchObject({ bindable: true, writable: false, derivation: "derived" });
    expect(title.reason).toMatch(/not executed/);
  });

  it("keeps unresolved leaves visible without hiding literal siblings", async () => {
    const partialPage = page.replace('{ title: "First",', '{ runtime: getRuntimeValue(), title: "First",');
    const result = await listProjectData(root, {
      relativeFile: "src/pages/index.astro",
      source: partialPage,
      selectionPath: "0.0.0",
      occurrence: 0,
      target: { kind: "text" },
    });
    expect(result.groups[0]!.fields.find((field) => field.label === "Title")).toMatchObject({ value: "First", bindable: true });
    expect(result.groups[0]!.fields.find((field) => field.label === "Runtime")).toMatchObject({
      derivation: "unresolved",
      compatible: false,
      bindable: false,
      sourceFile: "src/pages/index.astro",
    });
  });

  it("uses destructured callback names for current-item bindings", async () => {
    const destructuredPage = page.replace(
      "featuredProjects.map((project) => (",
      "featuredProjects.map(({ title, description: summary }) => (",
    ).replace("project.title", "title").replaceAll("project.description", "summary");
    const result = await listProjectData(root, {
      relativeFile: "src/pages/index.astro",
      source: destructuredPage,
      selectionPath: "0.0.0",
      occurrence: 1,
      target: { kind: "text" },
    });
    expect(result.groups[0]!.fields.find((field) => field.label === "Title")).toMatchObject({ expression: "title", value: "Second" });
    expect(result.groups[0]!.fields.find((field) => field.label === "Description")).toMatchObject({ expression: "summary", value: "Two" });
  });

  it("resolves nested loop receivers through outer lexical callback scopes", async () => {
    const nestedPage = `---
const sections = [
  { projects: [{ title: "A" }, { title: "B" }] },
  { projects: [{ title: "C" }] },
];
---
{sections.map((section) => (
  <section>{section.projects.map((project) => (
    <h3>{project.title}</h3>
  ))}</section>
))}`;
    fs.writeFileSync(path.join(root, "src/pages/nested.astro"), nestedPage);
    const parsed = await parseAstro(nestedPage, { filename: "src/pages/nested.astro" });
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) return;
    const selectionPath = findPath(parsed.model.nodes, (node) => node.kind === "element" && node.name === "h3")!;
    const result = await listProjectData(root, {
      relativeFile: "src/pages/nested.astro",
      source: nestedPage,
      selectionPath,
      occurrence: 2,
      target: { kind: "text" },
    });
    expect(result.groups[0]!.fields.find((field) => field.label === "Title")).toMatchObject({
      expression: "project.title",
      value: "C",
      selectedItem: 0,
      itemCount: 1,
    });
  });

  it("matches optional and bracketed hand-written access to the catalog field", async () => {
    const optionalPage = page.replace("{project.title}", '{project?.["title"]}');
    const result = await listProjectData(root, {
      relativeFile: "src/pages/index.astro",
      source: optionalPage,
      selectionPath: "0.0.0",
      occurrence: 1,
      target: { kind: "text" },
    });
    const title = result.groups[0]!.fields.find((field) => field.label === "Title")!;
    expect(result.expression).toBe('project?.["title"]');
    expect(result.selectedFieldId).toBe(title.id);
  });

  it("traces inline component properties back to filtered JSON", async () => {
    const component = `---
const { data } = Astro.props;
---
{
// Map the filtered caller data.
data.map((feature) => (
  <article><h3>{feature.title}</h3><p>{feature.description}</p></article>
))}`;
    fs.mkdirSync(path.join(root, "src/components"), { recursive: true });
    fs.writeFileSync(path.join(root, "src/components/Features.astro"), component);
    const owner = `---
import Features from "../components/Features.astro";
import featuresData from "../data/features.json";
const featuresAnalytics = featuresData.filter((feature) => feature.enabled === true);
---
<Features data={featuresAnalytics} />`;
    fs.writeFileSync(path.join(root, "src/pages/owner.astro"), owner);
    const ownerParsed = await parseAstro(owner, { filename: "src/pages/owner.astro" });
    const componentParsed = await parseAstro(component, { filename: "src/components/Features.astro" });
    expect(ownerParsed.editable && componentParsed.editable).toBe(true);
    if (!ownerParsed.editable || !componentParsed.editable) return;
    const hostPath = findPath(ownerParsed.model.nodes, (node) => node.kind === "component" && node.name === "Features")!;
    const selectionPath = findPath(componentParsed.model.nodes, (node) => node.kind === "element" && node.name === "h3")!;
    const result = await listProjectData(root, {
      relativeFile: "src/components/Features.astro",
      source: component,
      selectionPath,
      occurrence: 0,
      target: { kind: "text" },
      instanceChain: [{ ownerFile: "src/pages/owner.astro", hostPath, occurrence: 0 }],
    });
    expect(result.groups[0]!.fields.find((field) => field.label === "Title")).toMatchObject({
      value: "Visible",
      sourceFile: "src/data/features.json",
      writable: true,
    });
  });

  it("shows declared standalone component prop shapes without editable values", async () => {
    const component = `---
interface Props { data: Array<{ title: string; description: string; image: ImageMetadata; link: string }> }
const { data } = Astro.props;
---
{data.map((project) => (
  <article><h3>{project.title}</h3></article>
))}`;
    fs.mkdirSync(path.join(root, "src/components"), { recursive: true });
    fs.writeFileSync(path.join(root, "src/components/Standalone.astro"), component);
    const parsed = await parseAstro(component, { filename: "src/components/Standalone.astro" });
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) return;
    const selectionPath = findPath(parsed.model.nodes, (node) => node.kind === "element" && node.name === "h3")!;
    const result = await listProjectData(root, {
      relativeFile: "src/components/Standalone.astro",
      source: component,
      selectionPath,
      occurrence: 0,
      target: { kind: "text" },
    });
    expect(result.groups[0]!.fields.map((field) => field.pathLabel)).toEqual([
      "Current item · Description",
      "Current item · Image",
      "Current item · Link",
      "Current item · Title",
    ]);
    expect(result.groups[0]!.fields.every((field) => !field.writable)).toBe(true);
  });
});
