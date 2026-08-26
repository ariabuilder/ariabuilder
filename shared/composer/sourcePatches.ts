import { serializeAttrs, serializeNode } from "./serializeAstro";
import { encodeAstroText } from "./astroText";
import type {
  AstroDocumentModel,
  AstroImport,
  ComposerSourceRange,
  EditableNode,
} from "./types";

export type ComposerSourcePatchResult =
  | { ok: true; source: string }
  | { ok: false; reason: string };

type Replacement = {
  from: number;
  to: number;
  insert: string;
  nodeId?: string;
  nodeExtent?: "replacement";
};

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
  if (node.kind === "text") return encodeAstroText(node.value);
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
  parentRange?: ComposerSourceRange,
): Replacement | null {
  const range = before.sourceRange;
  if (!range) return null;
  if (
    range.from < 0 || range.to < range.from || range.to > source.length ||
    (parentRange && (range.from < parentRange.from || range.to > parentRange.to))
  ) return null;
  if (
    before.kind === "expr" &&
    source.slice(range.from, range.to) !== before.value
  ) return null;
  return {
    from: range.from,
    to: range.to,
    insert: serializeReplacement(after, source),
    nodeId: after.id,
  };
}

function directValueWithoutProps(node: EditableNode): unknown {
  const value = directValue(node) as Record<string, unknown>;
  delete value.props;
  return value;
}

function openingTagEnd(source: string, from: number, limit: number): number | null {
  if (source[from] !== "<") return null;
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  let braces = 0;
  for (let index = from + 1; index < limit; index += 1) {
    const character = source[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") {
      braces += 1;
      continue;
    }
    if (character === "}" && braces > 0) {
      braces -= 1;
      continue;
    }
    if (character === ">" && braces === 0) return index + 1;
  }
  return null;
}

function isSelfClosingNode(node: EditableNode): boolean {
  if (node.kind === "slot") return node.children === null;
  if (node.kind === "fragment") return Boolean(node.chunkFile || node.chunkAggregate);
  if (node.kind === "component") {
    return node.children === null || Boolean(node.chunkFile || node.chunkAggregate);
  }
  if (node.kind === "element") return node.children === null;
  return false;
}

function openingTag(node: EditableNode): string | null {
  if (
    node.kind !== "element" &&
    node.kind !== "component" &&
    node.kind !== "fragment" &&
    node.kind !== "slot" &&
    node.kind !== "raw"
  ) return null;
  if (node.kind === "fragment" && !node.name) return "<>";
  const name = node.kind === "slot" ? "slot" : node.name;
  const selfClosing = isSelfClosingNode(node);
  return `<${name}${serializeAttrs(node.props)}${selfClosing ? " />" : ">"}`;
}

function replaceOpeningTag(
  before: EditableNode,
  after: EditableNode,
  source: string,
): Replacement | null {
  const range = before.sourceRange;
  const insert = openingTag(after);
  if (!range || insert == null) return null;
  // Astro compiler ranges for self-closing components can end inside the first
  // attribute, so scan the compiler-valid source through the real tag end.
  const to = openingTagEnd(source, range.from, source.length);
  if (to == null) return null;
  return {
    from: range.from,
    to,
    insert,
    nodeId: after.id,
    ...(isSelfClosingNode(after) ? { nodeExtent: "replacement" as const } : {}),
  };
}

function walkNodes(
  nodes: EditableNode[],
  visit: (node: EditableNode) => void,
): void {
  for (const node of nodes) {
    visit(node);
    for (const children of childGroups(node)) walkNodes(children, visit);
  }
}

function rebasedRange(
  node: EditableNode,
  replacements: Replacement[],
): ComposerSourceRange | undefined {
  const range = node.sourceRange;
  if (!range) return undefined;

  let shift = 0;
  let containedDelta = 0;
  for (const replacement of replacements) {
    const delta = replacement.insert.length - (replacement.to - replacement.from);
    if (
      replacement.nodeId === node.id
      && range.from === replacement.from
      && (
        range.to === replacement.to
        || replacement.nodeExtent === "replacement"
      )
    ) {
      return {
        from: replacement.from + shift,
        to: replacement.from + shift + replacement.insert.length,
      };
    }
    if (replacement.to <= range.from) {
      shift += delta;
      continue;
    }
    if (replacement.from >= range.to) continue;
    if (range.from <= replacement.from && range.to >= replacement.to) {
      containedDelta += delta;
      continue;
    }
    // A parent replacement reserializes its descendants. Their previous
    // offsets no longer describe the staged source, so make the next visual
    // edit fail closed instead of applying a stale range.
    return undefined;
  }

  return {
    from: range.from + shift,
    to: range.to + shift + containedDelta,
  };
}

function rebaseModelSourceRanges(
  model: AstroDocumentModel,
  replacements: Replacement[],
): void {
  const ascending = [...replacements].sort((a, b) => a.from - b.from);
  walkNodes(model.nodes, (node) => {
    if (!node.sourceRange) {
      const own = ascending.find((replacement) => replacement.nodeId === node.id);
      if (own) {
        const shift = ascending
          .filter((replacement) => replacement !== own && replacement.to <= own.from)
          .reduce(
            (total, replacement) => total + replacement.insert.length - (replacement.to - replacement.from),
            0,
          );
        node.sourceRange = {
          from: own.from + shift,
          to: own.from + shift + own.insert.length,
        };
        return;
      }
    }
    const range = rebasedRange(node, ascending);
    if (range) node.sourceRange = range;
    else delete node.sourceRange;
  });
}

function collectNodeReplacements(
  before: EditableNode,
  after: EditableNode,
  source: string,
  replacements: Replacement[],
  parentRange?: ComposerSourceRange,
): boolean {
  if (before.id !== after.id || before.kind !== after.kind) {
    const replacement = replaceNode(before, after, source, parentRange);
    if (!replacement) return false;
    replacements.push(replacement);
    return true;
  }
  if (JSON.stringify(directValue(before)) !== JSON.stringify(directValue(after))) {
    const propsOnly =
      "props" in before &&
      "props" in after &&
      JSON.stringify(directValueWithoutProps(before))
        === JSON.stringify(directValueWithoutProps(after));
    const replacement = propsOnly
      ? replaceOpeningTag(before, after, source)
      : replaceNode(before, after, source, parentRange);
    if (!replacement) return false;
    replacements.push(replacement);
    if (!propsOnly) return true;
  }

  const beforeGroups = childGroups(before);
  const afterGroups = childGroups(after);
  if (beforeGroups.length !== afterGroups.length) {
    const replacement = replaceNode(before, after, source, parentRange);
    if (!replacement) return false;
    replacements.push(replacement);
    return true;
  }
  for (let group = 0; group < beforeGroups.length; group += 1) {
    const beforeChildren = beforeGroups[group]!;
    const afterChildren = afterGroups[group]!;
    if (!sameNodeSequence(beforeChildren, afterChildren)) {
      const replacement = replaceNode(before, after, source, parentRange);
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
          before.sourceRange ?? parentRange,
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

function frontmatterBodyRange(source: string): { from: number; to: number } | null {
  if (!source.startsWith("---")) return null;
  const openingEnd = source.indexOf("\n");
  if (openingEnd < 0) return null;
  const closingStart = source.indexOf("\n---", openingEnd);
  if (closingStart < 0) return null;
  return { from: openingEnd + 1, to: closingStart };
}

/** Map default-import-stripped frontmatter back to exact source offsets. */
function collectFrontmatterReplacement(
  source: string,
  before: string,
  after: string,
): Replacement[] | null {
  if (before === after) return [];
  const bodyRange = frontmatterBodyRange(source);
  if (!bodyRange) return null;

  const body = source.slice(bodyRange.from, bodyRange.to);
  const importRanges: Array<{ from: number; to: number }> = [];
  const importPattern = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/g;
  let importMatch: RegExpExecArray | null;
  while ((importMatch = importPattern.exec(body)) !== null) {
    importRanges.push({
      from: importMatch.index,
      to: importMatch.index + importMatch[0].length,
    });
  }

  let projected = "";
  const sourceOffsets: number[] = [];
  let cursor = 0;
  for (const range of importRanges) {
    for (let index = cursor; index < range.from; index += 1) {
      projected += body[index]!;
      sourceOffsets.push(bodyRange.from + index);
    }
    cursor = range.to;
  }
  for (let index = cursor; index < body.length; index += 1) {
    projected += body[index]!;
    sourceOffsets.push(bodyRange.from + index);
  }

  const trimStart = projected.length - projected.trimStart().length;
  const trimmed = projected.trim();
  if (trimmed !== before) return null;
  const mappedOffsets = sourceOffsets.slice(trimStart, trimStart + trimmed.length);

  const contiguous = (start: number, end: number): boolean => {
    for (let index = start + 1; index < end; index += 1) {
      if (mappedOffsets[index] !== mappedOffsets[index - 1]! + 1) return false;
    }
    return true;
  };
  const insertAt = (index: number, value: string): Replacement | null => {
    if (!value) return null;
    const offset = index < mappedOffsets.length
      ? mappedOffsets[index]!
      : mappedOffsets.length
        ? mappedOffsets[mappedOffsets.length - 1]! + 1
        : bodyRange.from;
    return { from: offset, to: offset, insert: value };
  };
  const removeRanges = (start: number, end: number): Replacement[] => {
    if (start >= end) return [];
    const replacements: Replacement[] = [];
    let runStart = start;
    for (let index = start + 1; index <= end; index += 1) {
      if (
        index < end &&
        mappedOffsets[index] === mappedOffsets[index - 1]! + 1
      ) continue;
      let deleteStart = runStart;
      let deleteEnd = index;
      const splitBefore = runStart > start &&
        mappedOffsets[runStart] !== mappedOffsets[runStart - 1]! + 1;
      const splitAfter = index < end &&
        mappedOffsets[index] !== mappedOffsets[index - 1]! + 1;
      if (splitBefore && source[mappedOffsets[deleteStart]!] === "\n") {
        deleteStart += 1;
      }
      if (splitAfter && source[mappedOffsets[deleteEnd - 1]!] === "\n") {
        deleteEnd -= 1;
      }
      if (deleteStart < deleteEnd) {
        replacements.push({
          from: mappedOffsets[deleteStart]!,
          to: mappedOffsets[deleteEnd - 1]! + 1,
          insert: "",
        });
      }
      runStart = index;
    }
    return replacements;
  };

  const embeddedBefore = before ? after.indexOf(before) : -1;
  if (embeddedBefore >= 0) {
    return [
      insertAt(0, after.slice(0, embeddedBefore)),
      insertAt(before.length, after.slice(embeddedBefore + before.length)),
    ].filter((item): item is Replacement => item !== null);
  }
  const embeddedAfter = after ? before.indexOf(after) : -1;
  if (embeddedAfter >= 0) {
    return [
      ...removeRanges(0, embeddedAfter),
      ...removeRanges(embeddedAfter + after.length, before.length),
    ];
  }

  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  ) prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix += 1;

  const beforeEnd = before.length - suffix;
  const insert = after.slice(prefix, after.length - suffix);
  const from = prefix < mappedOffsets.length
    ? mappedOffsets[prefix]!
    : mappedOffsets.length
      ? mappedOffsets[mappedOffsets.length - 1]! + 1
      : bodyRange.from;
  const to = beforeEnd > prefix
    ? mappedOffsets[beforeEnd - 1]! + 1
    : from;

  if (!contiguous(prefix, beforeEnd)) return null;
  return [{ from, to, insert }];
}

/**
 * Patch a projected model mutation into the exact Code draft. Unrelated source
 * remains byte-for-byte intact. On success, `after` source ranges are rebased
 * to the returned source so consecutive visual edits cannot reuse stale
 * offsets. Unsupported/rangeless projections fail closed.
 */
export function patchComposerModelSource(
  source: string,
  before: AstroDocumentModel,
  after: AstroDocumentModel,
): ComposerSourcePatchResult {
  const frontmatterReplacements = collectFrontmatterReplacement(
    source,
    before.extraFrontmatter,
    after.extraFrontmatter,
  );
  if (!frontmatterReplacements) {
    return { ok: false, reason: "The managed frontmatter change could not be located safely." };
  }

  const importReplacements = collectImportReplacements(
    source,
    before.imports,
    after.imports,
  );
  if (!importReplacements) {
    return { ok: false, reason: "The changed import could not be located safely." };
  }
  const replacements: Replacement[] = [
    ...frontmatterReplacements,
    ...importReplacements,
  ];
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
  rebaseModelSourceRanges(after, replacements);
  return { ok: true, source: next };
}
