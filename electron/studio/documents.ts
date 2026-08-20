import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { buildComposerLayerTree } from "../../shared/composer/layers";
import { parseAstro } from "../../shared/composer/parseAstro";
import type {
  ComponentDetailManifest,
  ScanComponent,
  StudioDocumentDeleteResult,
  StudioDocumentKind,
  StudioDocumentStructureNode,
  StudioDocumentUsage,
} from "../../shared/types";
import { buildLayoutPreviewInventory } from "../layoutPreview";
import {
  canonicalDirectory,
  removePathTracked,
  resolveWithinRoot,
  writeBinaryFileAtomic,
} from "../pathSafety";
import {
  findComponentUsageRecords,
  resolveComponentFilePath,
  scanProject,
} from "../workspace";

const DOCUMENT_EXTENSIONS = {
  component: new Set([".astro", ".tsx", ".jsx", ".vue", ".svelte"]),
  layout: new Set([".astro"]),
} satisfies Record<StudioDocumentKind, Set<string>>;

function documentDirectory(root: string, kind: StudioDocumentKind): string {
  const relative = kind === "component" ? "src/components" : "src/layouts";
  return resolveWithinRoot(root, path.join(root, relative), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
}

export function resolveStudioDocumentFile(
  projectPath: string,
  kind: StudioDocumentKind,
  relativeFile: string,
): string {
  const root = canonicalDirectory(projectPath);
  if (kind === "component") return resolveComponentFilePath(root, relativeFile);
  const directory = documentDirectory(root, kind);
  const absolute = resolveWithinRoot(root, path.resolve(root, relativeFile), {
    rejectFinalSymlink: true,
  });
  if (absolute !== directory && !absolute.startsWith(`${directory}${path.sep}`)) {
    throw new Error("Invalid layout path");
  }
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    throw new Error("Layout file not found");
  }
  if (!DOCUMENT_EXTENSIONS.layout.has(path.extname(absolute).toLowerCase())) {
    throw new Error("Unsupported layout file");
  }
  return absolute;
}

function displayName(file: string): string {
  const stem = path.basename(file, path.extname(file));
  return stem
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function usageKind(file: string): StudioDocumentUsage["kind"] {
  if (file.startsWith("src/pages/")) return "page";
  if (file.startsWith("src/layouts/")) return "layout";
  return "component";
}

function componentUsages(
  root: string,
  absolute: string,
  scan: Awaited<ReturnType<typeof scanProject>>,
): StudioDocumentUsage[] {
  const pages = new Map(scan.pages.map((page) => [page.file, page]));
  const components = new Map(scan.components.map((item) => [item.file, item]));
  const layouts = new Map(scan.layouts.map((item) => [item.file, item]));
  return findComponentUsageRecords(root, absolute)
    .map((usage) => {
      const page = pages.get(usage.file);
      const item = components.get(usage.file) ?? layouts.get(usage.file);
      return {
        kind: usageKind(usage.file),
        file: usage.file,
        label: page?.title || item?.name || displayName(usage.file),
        ...(page?.route ? { route: page.route } : {}),
        referenceCount: usage.referenceCount,
      } satisfies StudioDocumentUsage;
    })
    .sort((left, right) =>
      left.kind.localeCompare(right.kind) || left.label.localeCompare(right.label),
    );
}

function structureRows(
  rows: ReturnType<typeof buildComposerLayerTree>["content"],
): StudioDocumentStructureNode[] {
  return rows.map((row) => ({
    path: row.path,
    kind: row.semanticType,
    label: row.label,
    sourceLabel: row.sourceLabel,
    ...(row.commentPreview ? { textPreview: row.commentPreview } : {}),
    children: structureRows(row.children),
  }));
}

export async function inspectStudioComponent(
  projectPath: string,
  relativeFile: string,
): Promise<ComponentDetailManifest> {
  const root = canonicalDirectory(projectPath);
  const absolute = resolveStudioDocumentFile(root, "component", relativeFile);
  const scan = await scanProject(root);
  const component = scan.components.find((item) => item.file === relativeFile);
  if (!component) throw new Error("Component is no longer in the workspace inventory");

  const diagnostics: string[] = [];
  let props: ComponentDetailManifest["props"] = [];
  let slots: string[] = [];
  let structure: StudioDocumentStructureNode[] = [];
  if (path.extname(absolute).toLowerCase() !== ".astro") {
    diagnostics.push("This framework component can be opened as source but is not visually editable as Astro.");
  } else {
    const parsed = await parseAstro(readFileSync(absolute, "utf8"), { filename: absolute });
    if (!parsed.editable) {
      diagnostics.push(parsed.reason);
    } else {
      props = parsed.model.propSchema;
      slots = parsed.model.slots;
      const projection = buildComposerLayerTree(parsed.model, { pageDocument: false });
      structure = structureRows(
        projection.content.length ? projection.content : projection.document,
      );
    }
  }

  return {
    component,
    props,
    slots,
    structure,
    usages: componentUsages(root, absolute, scan),
    diagnostics,
  };
}

function normalizeDestinationName(name: string, extension: string): string {
  const withoutExtension = name.trim().replace(new RegExp(`${extension.replace(".", "\\.")}$`, "i"), "");
  const parts = withoutExtension
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .map((part) => part.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, ""));
  if (!parts.length || parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("Invalid document name");
  }
  return `${parts.join(path.sep)}${extension}`;
}

export function duplicateStudioDocument(
  projectPath: string,
  input: { kind: StudioDocumentKind; file: string; name: string },
): ScanComponent {
  const root = canonicalDirectory(projectPath);
  const source = resolveStudioDocumentFile(root, input.kind, input.file);
  const extension = path.extname(source).toLowerCase();
  if (!DOCUMENT_EXTENSIONS[input.kind].has(extension)) {
    throw new Error(`Unsupported ${input.kind} file`);
  }
  const directory = documentDirectory(root, input.kind);
  const relativeDestination = normalizeDestinationName(input.name, extension);
  const destination = resolveWithinRoot(root, path.join(directory, relativeDestination), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
  if (destination !== directory && !destination.startsWith(`${directory}${path.sep}`)) {
    throw new Error(`Invalid ${input.kind} destination`);
  }
  if (existsSync(destination)) throw new Error(`A ${input.kind} with that name already exists.`);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeBinaryFileAtomic(destination, readFileSync(source), { overwrite: false });
  const file = path.relative(root, destination).split(path.sep).join("/");
  const category = input.kind === "component"
    ? path.dirname(path.relative(directory, destination)).split(path.sep).join("/")
    : "";
  return {
    id: file,
    name: displayName(file),
    file,
    mtimeMs: statSync(destination).mtimeMs,
    ...(category && category !== "." ? { category } : {}),
  };
}

export async function deleteStudioDocument(
  projectPath: string,
  input: { kind: StudioDocumentKind; file: string },
): Promise<StudioDocumentDeleteResult> {
  const root = canonicalDirectory(projectPath);
  const absolute = resolveStudioDocumentFile(root, input.kind, input.file);
  const scan = await scanProject(root);
  const usages = input.kind === "component"
    ? componentUsages(root, absolute, scan)
    : (await buildLayoutPreviewInventory(root, scan)).find(
        (manifest) => manifest.layout.file === input.file,
      )?.consumers.map((consumer) => ({
        kind: "page" as const,
        file: consumer.file,
        label: consumer.title || consumer.route,
        route: consumer.route,
        referenceCount: 1,
      })) ?? [];
  if (usages.length) return { ok: false, code: "DOCUMENT_IN_USE", usages };
  removePathTracked(absolute);
  return { ok: true };
}
