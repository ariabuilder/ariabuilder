import { serializeNode } from "./serializeAstro";
import type { AstroDocumentModel, AstroImport, EditableNode } from "./types";

export type ComposerSourcePatchResult =
  | { ok: true; source: string }
  | { ok: false; reason: string };

type Replacement = { from: number; to: number; insert: string };

function directValue(node: EditableNode): unknown {
  const value = { ...node } as Record<string, unknown>;
  delete value.id;
  delete value.sourceRange;
  delete value.children;
  delete value.consequent;
  delete value.alternate;
  return value;
}

function childGroups(node: EditableNode): EditableNode[][] {
  if (node.kind === "conditional") {
    return node.mode === "ternary"
      ? [node.consequent, node.alternate ?? []]
      : [node.consequent];
  }
  if (
    node.kind === "element" ||
    node.kind === "component" ||
    node.kind === "fragment" ||
    node.kind === "slot" ||
    node.kind === "map"
  ) {
    return [Array.isArray(node.children) ? node.children : []];
  }
  return [];
}

function sameNodeSequence(before: EditableNode[], after: EditableNode[]): boolean {
  return (
    before.length === after.length &&
    before.every((node, index) => node.id === after[index]?.id)
  );
}

function indentAt(source: string, offset: number): string {
  const lineStart = source.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const prefix = source.slice(lineStart, offset);
  return /^\s*$/.test(prefix) ? prefix : "";
}

function serializeReplacement(node: EditableNode, source: string): string {
  if (node.kind === "text") return node.value;
  const indent = indentAt(source, node.sourceRange?.from ?? 0);
  const lines: string[] = [];
  serializeNode(node, indent, lines);
  const serialized = lines.join("\n");
  // Compiler ranges start at the node token, after existing line indentation.
  return indent && serialized.startsWith(indent)
    ? serialized.slice(indent.length)
    : serialized;
}

function replaceNode(
  before: EditableNode,
  after: EditableNode,
  source: string,
): Replacement | null {
  const range = before.sourceRange;
  if (!range) return null;
  return {
    from: range.from,
    to: range.to,
    insert: serializeReplacement(after, source),
  };
}

function collectNodeReplacements(
  before: EditableNode,
  after: EditableNode,
  source: string,
  replacements: Replacement[],
): boolean {
  if (before.id !== after.id || before.kind !== after.kind) {
    const replacement = replaceNode(before, after, source);
    if (!replacement) return false;
    replacements.push(replacement);
    return true;
  }
  if (JSON.stringify(directValue(before)) !== JSON.stringify(directValue(after))) {
    const replacement = replaceNode(before, after, source);
    if (!replacement) return false;
    replacements.push(replacement);
    return true;
  }

  const beforeGroups = childGroups(before);
  const afterGroups = childGroups(after);
  if (beforeGroups.length !== afterGroups.length) {
    const replacement = replaceNode(before, after, source);
    if (!replacement) return false;
    replacements.push(replacement);
    return true;
  }
  for (let group = 0; group < beforeGroups.length; group += 1) {
    const beforeChildren = beforeGroups[group]!;
    const afterChildren = afterGroups[group]!;
    if (!sameNodeSequence(beforeChildren, afterChildren)) {
      const replacement = replaceNode(before, after, source);
      if (!replacement) return false;
      replacements.push(replacement);
      return true;
    }
    for (let index = 0; index < beforeChildren.length; index += 1) {
      if (
        !collectNodeReplacements(
          beforeChildren[index]!,
          afterChildren[index]!,
          source,
          replacements,
        )
      ) return false;
    }
  }
  return true;
}

function serializeRootNodes(nodes: EditableNode[]): string {
  const lines: string[] = [];
  for (const node of nodes) serializeNode(node, "", lines);
  return lines.join("\n");
}

function rootReplacement(
  source: string,
  before: EditableNode[],
  after: EditableNode[],
): Replacement | null {
  const first = before[0]?.sourceRange;
  const last = before[before.length - 1]?.sourceRange;
  if (first && last) {
    return {
      from: first.from,
      to: last.to,
      insert: serializeRootNodes(after),
    };
  }
  if (before.length > 0) return null;
  const frontmatterEnd = source.startsWith("---")
    ? source.indexOf("\n---", 3)
    : -1;
  const closingLineEnd = frontmatterEnd >= 0
    ? source.indexOf("\n", frontmatterEnd + 1)
    : -1;
  const from = frontmatterEnd >= 0
    ? (closingLineEnd >= 0 ? closingLineEnd + 1 : source.length)
    : source.length;
  return {
    from: Math.max(0, from),
    to: Math.max(0, from),
    insert: `${serializeRootNodes(after)}${after.length ? "\n" : ""}`,
  };
}

function collectImportReplacements(
  source: string,
  before: AstroImport[],
  after: AstroImport[],
): Replacement[] | null {
  const beforeKeys = new Set(before.map((item) => `${item.name}\0${item.path}`));
  const afterKeys = new Set(after.map((item) => `${item.name}\0${item.path}`));
  const removed = new Set([...beforeKeys].filter((key) => !afterKeys.has(key)));
  const added = after.filter((item) => !beforeKeys.has(`${item.name}\0${item.path}`));
  if (!removed.size && !added.length) return [];

  const replacements: Replacement[] = [];
  const frontmatterLimit = source.startsWith("---")
    ? source.indexOf("\n---", 3)
    : -1;
  const importPattern = /^([\t ]*import\s+(\w+)\s+from\s+(['"])([^'"\r\n]+)\3;?[\t ]*(?:\r?\n|$))/gm;
  let match: RegExpExecArray | null;
  while ((match = importPattern.exec(source)) !== null) {
    if (frontmatterLimit >= 0 && match.index > frontmatterLimit) break;
    const key = `${match[2]}\0${match[4]}`;
    if (removed.delete(key)) {
      replacements.push({ from: match.index, to: match.index + match[1]!.length, insert: "" });
    }
  }
  if (removed.size) return null;

  if (added.length) {
    const lines = added.map((item) => `import ${item.name} from '${item.path}';`).join("\n");
    if (source.startsWith("---")) {
      const closing = source.indexOf("\n---", 3);
      if (closing < 0) return null;
      replacements.push({ from: closing + 1, to: closing + 1, insert: `${lines}\n` });
    } else {
      replacements.push({ from: 0, to: 0, insert: `---\n${lines}\n---\n` });
    }
  }
  return replacements;
}

/**
 * Patch a projected model mutation into the exact Code draft. Unrelated source
 * remains byte-for-byte intact. Unsupported/rangeless projections fail closed.
 */
export function patchComposerModelSource(
  source: string,
  before: AstroDocumentModel,
  after: AstroDocumentModel,
): ComposerSourcePatchResult {
  if (before.extraFrontmatter !== after.extraFrontmatter) {
    return { ok: false, reason: "Frontmatter changes are not safely patchable yet." };
  }

  const importReplacements = collectImportReplacements(
    source,
    before.imports,
    after.imports,
  );
  if (!importReplacements) {
    return { ok: false, reason: "The changed import could not be located safely." };
  }
  const replacements: Replacement[] = [...importReplacements];
  if (!sameNodeSequence(before.nodes, after.nodes)) {
    const replacement = rootReplacement(source, before.nodes, after.nodes);
    if (!replacement) {
      return { ok: false, reason: "The changed document region has no source range." };
    }
    replacements.push(replacement);
  } else {
    for (let index = 0; index < before.nodes.length; index += 1) {
      if (!collectNodeReplacements(before.nodes[index]!, after.nodes[index]!, source, replacements)) {
        return { ok: false, reason: "The changed node has no safe source range." };
      }
    }
  }

  const ordered = replacements.sort((a, b) => b.from - a.from);
  let next = source;
  let previousFrom = source.length + 1;
  for (const replacement of ordered) {
    if (replacement.to > previousFrom) {
      return { ok: false, reason: "Generated source patches overlap." };
    }
    next = `${next.slice(0, replacement.from)}${replacement.insert}${next.slice(replacement.to)}`;
    previousFrom = replacement.from;
  }
  return { ok: true, source: next };
}
