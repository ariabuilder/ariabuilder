/**
 * Optional HTML `?raw` chunk resolution (Stacki-inspired).
 *
 * Pages may use `<Fragment set:html={chunk} />` where `chunk` is imported via
 * `import chunk from './chunks/foo.html?raw'`. When resolved, chunk markup is
 * attached as editable children; serialize still emits the Fragment self-closing
 * (write-back of chunk files is a later phase concern).
 */

import fs from "node:fs";
import path from "node:path";
import { parseAstro } from "./parseAstro";
import type { AstroDocumentModel, EditableNode } from "./types";

function walkNodes(
  list: EditableNode[],
  visit: (node: EditableNode) => void,
): void {
  for (const node of list) {
    visit(node);
    if (node.kind === "map" || node.kind === "fragment") {
      walkNodes(node.children, visit);
    } else if (node.kind === "conditional") {
      walkNodes(node.consequent, visit);
      if (node.alternate) walkNodes(node.alternate, visit);
    } else if (
      (node.kind === "element" ||
        node.kind === "component" ||
        node.kind === "slot") &&
      Array.isArray(node.children)
    ) {
      walkNodes(node.children, visit);
    }
  }
}

/**
 * Attach parsed HTML chunk children onto Fragment/`set:html` nodes when the
 * referenced `?raw` import can be read from disk. Non-fatal on failure.
 */
export async function resolveRawChunks(
  model: AstroDocumentModel,
  pagePath: string,
): Promise<void> {
  const rawImports = new Map<string, string>();
  for (const imp of model.imports) {
    if (/\.html\?raw$/i.test(imp.path) && imp.path.startsWith(".")) {
      rawImports.set(
        imp.name,
        path.resolve(path.dirname(pagePath), imp.path.replace(/\?raw$/i, "")),
      );
    }
  }
  if (!rawImports.size) return;

  const aggregates = new Map<string, string[]>();
  const aggRe = /(?:const|let)\s+(\w+)\s*=\s*\[([^\]]*)\]\s*\.join\(/g;
  let am: RegExpExecArray | null;
  while ((am = aggRe.exec(model.extraFrontmatter || "")) !== null) {
    const idents = am[2]!
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (idents.length && idents.every((i) => /^\w+$/.test(i))) {
      aggregates.set(am[1]!, idents);
    }
  }

  const parseChunkFile = async (
    filePath: string,
  ): Promise<EditableNode[] | null> => {
    try {
      const source = fs.readFileSync(filePath, "utf8");
      // Wrap bare HTML as a fragment document for the Astro parser.
      const wrapped = `---\n---\n${source}`;
      const result = await parseAstro(wrapped);
      if (!result.editable) return null;
      return result.model.nodes;
    } catch {
      return null;
    }
  };

  const targets: EditableNode[] = [];
  walkNodes(model.nodes, (node) => {
    if (
      (node.kind === "component" || node.kind === "fragment") &&
      node.props?.["set:html"]?.type === "expr" &&
      (node.children == null ||
        (Array.isArray(node.children) && node.children.length === 0))
    ) {
      targets.push(node);
    }
  });

  for (const node of targets) {
    if (node.kind !== "component" && node.kind !== "fragment") continue;
    const ref = node.props["set:html"]!.type === "expr"
      ? node.props["set:html"].value.trim()
      : "";
    if (rawImports.has(ref)) {
      const file = rawImports.get(ref)!;
      const children = await parseChunkFile(file);
      if (children) {
        node.chunkFile = file;
        if (node.kind === "fragment") {
          node.children = children;
        } else {
          node.children = children;
        }
      }
      continue;
    }
    if (aggregates.has(ref) && node.kind === "component") {
      // Aggregate: keep as chunkAggregate flag; children left empty for Phase 0.
      node.chunkAggregate = true;
    }
  }
}
