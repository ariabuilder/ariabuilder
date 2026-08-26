import { describe, expect, it } from "vitest";
import { parseAstro } from "./parseAstro";
import { serializeAstro } from "./serializeAstro";
import { nodeAtMarkerPath } from "./paths";
import {
  bindProjectDataMapAtPath,
  bindProjectDataPropAtPath,
  bindProjectDataTextAtPath,
  unbindProjectDataMapAtPath,
  unbindProjectDataPropAtPath,
  unbindProjectDataTextAtPath,
} from "./projectDataBindings";
import type { ProjectDataCatalogField } from "./projectData";
import type { EditableNode } from "./types";

function mapPath(nodes: EditableNode[], parent = ""): string | null {
  for (let index = 0; index < nodes.length; index += 1) {
    const path = parent ? `${parent}.${index}` : String(index);
    const node = nodes[index]!;
    if (node.kind === "map") return path;
    if ("children" in node && Array.isArray(node.children)) {
      const nested = mapPath(node.children, path);
      if (nested) return nested;
    }
  }
  return null;
}

const field = (expression: string, importBinding?: ProjectDataCatalogField["importBinding"]): ProjectDataCatalogField => ({
  id: expression,
  group: importBinding ? "project" : "current-item",
  label: "Title",
  pathLabel: "Current item · Title",
  expression,
  shape: "string",
  derivation: "literal",
  valuePath: importBinding ? ["title"] : ["title"],
  value: "Bound",
  compatible: true,
  bindable: true,
  writable: true,
  importBinding,
});

describe("project data bindings", () => {
  it("binds, rebinds, and restores the original static text", async () => {
    const parsed = await parseAstro("<h3>Original</h3>", { filename: "src/pages/index.astro" });
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) return;
    expect(bindProjectDataTextAtPath(parsed.model, "0.0", field("project.title")).ok).toBe(true);
    expect(bindProjectDataTextAtPath(parsed.model, "0.0", field("project.description")).ok).toBe(true);
    const rebound = serializeAstro(parsed.model);
    expect(rebound).toContain("project.description");
    expect(rebound.match(/@aria-project-fallback/g)).toHaveLength(1);
    expect(unbindProjectDataTextAtPath(parsed.model, "0.0").ok).toBe(true);
    expect(serializeAstro(parsed.model)).toContain("<h3>Original</h3>");
  });

  it("adds a collision-safe managed import and removes it on clear", async () => {
    const parsed = await parseAstro("---\nconst records = [];\n---\n<h3>Original</h3>", { filename: "src/pages/index.astro" });
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) return;
    const imported = field("records.title", {
      sourceFile: "src/data/records.ts",
      exportName: "records",
      specifier: "../data/records",
      suggestedLocalName: "records",
    });
    expect(bindProjectDataTextAtPath(parsed.model, "0.0", imported).ok).toBe(true);
    expect(parsed.model.extraFrontmatter).toContain("records2");
    expect(parsed.model.extraFrontmatter).toContain("@aria-project-import");
    expect(unbindProjectDataTextAtPath(parsed.model, "0.0").ok).toBe(true);
    expect(parsed.model.extraFrontmatter).not.toContain("@aria-project-import");
  });

  it("rebinds a loop while preserving one original dataset fallback", async () => {
    const parsed = await parseAstro("---\nconst first = []; const second = []; const third = [];\n---\n{\n// Keep first as the authored fallback.\nfirst.map((item) => (\n  <p>{item.title}</p>\n))}", { filename: "src/pages/index.astro" });
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) return;
    const path = mapPath(parsed.model.nodes);
    expect(path, JSON.stringify(parsed.model.nodes)).not.toBeNull();
    if (!path) return;
    expect(bindProjectDataMapAtPath(parsed.model, path, field("second")).ok).toBe(true);
    expect(bindProjectDataMapAtPath(parsed.model, path, field("third")).ok).toBe(true);
    const loop = nodeAtMarkerPath(parsed.model.nodes, path);
    expect(loop?.kind).toBe("map");
    if (loop?.kind !== "map") return;
    expect(loop.head).toContain("third ??");
    expect(loop.head.match(/@aria-project-fallback/g)).toHaveLength(1);
    expect(unbindProjectDataMapAtPath(parsed.model, path).ok).toBe(true);
    expect(loop.head).toContain("first.map");
    expect(serializeAstro(parsed.model)).toContain("Keep first as the authored fallback.");
  });

  it("restores a shorthand property after clearing its managed binding", async () => {
    const parsed = await parseAstro("<Card {title} />", { filename: "src/pages/index.astro" });
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) return;
    expect(bindProjectDataPropAtPath(parsed.model, "0", "title", field("project.title")).ok).toBe(true);
    expect(serializeAstro(parsed.model)).toContain("@aria-project-fallback-type:shorthand");
    expect(unbindProjectDataPropAtPath(parsed.model, "0", "title").ok).toBe(true);
    expect(nodeAtMarkerPath(parsed.model.nodes, "0")).toMatchObject({
      props: { title: { type: "shorthand", value: "title" } },
    });
    expect(serializeAstro(parsed.model)).toContain("<Card {title} />");
  });
});
