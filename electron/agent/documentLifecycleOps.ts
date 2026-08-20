/**
 * Closed-document lifecycle helpers for agent tools:
 * save, duplicate, and layout-slot mutations with mtime fencing.
 */

import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  assignComposerPageNodesToSlot,
  deleteComposerLayoutSlot,
  insertComposerLayoutSlot,
  renameComposerLayoutSlot,
  renameComposerPageSlotAssignments,
} from "../../shared/composer/layoutAuthoring";
import type { AstroDocumentModel } from "../../shared/composer/types";
import { commitComposerEditTransaction } from "../composer/transaction";
import { parseComposerPage, resolveComposerPageFile } from "../composer/parsePage";
import { canonicalDirectory, resolveWithinRoot, writeTextFileAtomic } from "../pathSafety";
import { createComponent, createLayout, createPage } from "../workspace";

export type DocumentKind = "page" | "component" | "layout";

function toPosix(value: string): string {
  return value.split(/[\\/]/).join("/");
}

export type ClosedDocResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: "CONFLICT" | "INVALID_INPUT";
      message: string;
      currentMtimeMs?: number;
    };

export function saveClosedDocument(input: {
  projectPath: string;
  file: string;
  source: string;
  expectedMtimeMs: number;
  expectedSource?: string;
}): ClosedDocResult<{
  file: string;
  mtimeMs: number | null;
  revisions: Array<{ relativeFile: string; mtimeMs: number }>;
}> {
  const result = commitComposerEditTransaction({
    projectPath: input.projectPath,
    sources: [
      {
        relativeFile: input.file,
        source: input.source,
        expectedMtimeMs: input.expectedMtimeMs,
        expectedSource: input.expectedSource,
      },
    ],
  });
  if (!result.ok) {
    return {
      ok: false,
      code: "CONFLICT",
      message: result.message,
      currentMtimeMs: result.conflicts[0]?.mtimeMs,
    };
  }
  const revision = result.revisions.find(
    (item) => toPosix(item.relativeFile) === toPosix(input.file),
  );
  return {
    ok: true,
    data: {
      file: toPosix(input.file),
      mtimeMs: revision?.mtimeMs ?? null,
      revisions: result.revisions,
    },
  };
}

export type DuplicateDocumentResult =
  | {
      kind: "page";
      sourceFile: string;
      file: string;
      route: string;
      mtimeMs: number;
    }
  | {
      kind: "component" | "layout";
      sourceFile: string;
      file: string;
      name: string;
      mtimeMs: number;
    };

export function duplicateDocument(input: {
  projectPath: string;
  kind: DocumentKind;
  sourceFile: string;
  name: string;
}): ClosedDocResult<DuplicateDocumentResult> {
  const absolute = resolveComposerPageFile(input.projectPath, input.sourceFile);
  if (!existsSync(absolute)) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: `Source document not found: ${input.sourceFile}`,
    };
  }
  const source = readFileSync(absolute, "utf8");
  let created:
    | { kind: "page"; file: string; route: string }
    | { kind: "component" | "layout"; file: string; name: string };
  try {
    created =
      input.kind === "page"
        ? { kind: "page", ...createPage(input.projectPath, input.name) }
        : input.kind === "component"
          ? {
              kind: "component",
              ...createComponent(input.projectPath, input.name),
            }
          : { kind: "layout", ...createLayout(input.projectPath, input.name) };
  } catch (error) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  // create* writes a blank scaffold; overwrite with the source document body.
  const root = canonicalDirectory(input.projectPath);
  const targetAbsolute = resolveWithinRoot(root, created.file, {
    rejectFinalSymlink: true,
  });
  mkdirSync(path.dirname(targetAbsolute), { recursive: true });
  writeTextFileAtomic(targetAbsolute, source);
  const mtimeMs = Math.floor(statSync(targetAbsolute).mtimeMs);
  const common = {
    sourceFile: toPosix(input.sourceFile),
    file: created.file,
    mtimeMs,
  };
  return created.kind === "page"
    ? { ok: true, data: { kind: "page", ...common, route: created.route } }
    : {
        ok: true,
        data: { kind: created.kind, ...common, name: created.name },
      };
}

export type LayoutSlotOperation =
  | {
      operation: "insert";
      slotName: string | null;
      parentPath?: string | null;
      index?: number;
    }
  | { operation: "rename"; path: string; nextName: string }
  | { operation: "delete"; path: string }
  | {
      operation: "assign_nodes";
      slotName: string | null;
      nodePaths: string[];
    }
  | {
      operation: "rename_page_assignments";
      from: string;
      to: string;
    };

export async function updateLayoutSlots(input: {
  projectPath: string;
  file: string;
  expectedMtimeMs: number;
  plane: "layout" | "page";
  op: LayoutSlotOperation;
}): Promise<
  ClosedDocResult<{
    file: string;
    mtimeMs: number | null;
    operation: string;
    selectPath?: string | null;
    renamedAssignments?: number;
  }>
> {
  const parsed = await parseComposerPage({
    projectPath: input.projectPath,
    relativeFile: input.file,
  });
  if (!parsed.editable || !("model" in parsed) || !parsed.model) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message:
        !parsed.editable && "reason" in parsed
          ? parsed.reason || "Document is not editable"
          : "Document is not editable",
    };
  }
  if (
    parsed.mtimeMs != null &&
    Math.floor(parsed.mtimeMs) !== Math.floor(input.expectedMtimeMs)
  ) {
    return {
      ok: false,
      code: "CONFLICT",
      message: "Document changed on disk. Reload before updating slots.",
      currentMtimeMs: Math.floor(parsed.mtimeMs),
    };
  }

  const model = parsed.model as AstroDocumentModel;
  let selectPath: string | null | undefined;
  let renamedAssignments: number | undefined;

  if (input.op.operation === "insert") {
    if (input.plane !== "layout") {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: 'insert slot requires plane: "layout".',
      };
    }
    const result = insertComposerLayoutSlot(model, input.op.slotName, {
      parentPath: input.op.parentPath ?? null,
      index: input.op.index ?? model.nodes.length,
    });
    if (!result.ok) {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: result.reason || "Unable to insert slot.",
      };
    }
    selectPath = result.selectPath;
  } else if (input.op.operation === "rename") {
    if (input.plane !== "layout") {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: 'rename slot requires plane: "layout".',
      };
    }
    const result = renameComposerLayoutSlot(model, input.op.path, input.op.nextName);
    if (!result.ok) {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: result.reason || "Unable to rename slot.",
      };
    }
    selectPath = result.selectPath;
  } else if (input.op.operation === "delete") {
    if (input.plane !== "layout") {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: 'delete slot requires plane: "layout".',
      };
    }
    const result = deleteComposerLayoutSlot(model, input.op.path);
    if (!result.ok) {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: result.reason || "Unable to delete slot.",
      };
    }
    selectPath = result.selectPath;
  } else if (input.op.operation === "assign_nodes") {
    if (input.plane !== "page") {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: 'assign_nodes requires plane: "page".',
      };
    }
    const result = assignComposerPageNodesToSlot(
      model,
      input.op.nodePaths,
      input.op.slotName,
    );
    if (!result.ok) {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: result.reason || "Unable to assign nodes to slot.",
      };
    }
    selectPath = result.selectPath;
  } else {
    if (input.plane !== "page") {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: 'rename_page_assignments requires plane: "page".',
      };
    }
    renamedAssignments = renameComposerPageSlotAssignments(
      model,
      input.op.from,
      input.op.to,
    );
  }

  const committed = commitComposerEditTransaction({
    projectPath: input.projectPath,
    page: {
      relativeFile: input.file,
      model,
      expectedMtimeMs: input.expectedMtimeMs,
    },
  });
  if (!committed.ok) {
    return {
      ok: false,
      code: "CONFLICT",
      message: committed.message,
      currentMtimeMs: committed.conflicts[0]?.mtimeMs,
    };
  }
  const revision = committed.revisions.find(
    (item) => toPosix(item.relativeFile) === toPosix(input.file),
  );
  return {
    ok: true,
    data: {
      file: toPosix(input.file),
      mtimeMs: revision?.mtimeMs ?? null,
      operation: input.op.operation,
      selectPath,
      renamedAssignments,
    },
  };
}
