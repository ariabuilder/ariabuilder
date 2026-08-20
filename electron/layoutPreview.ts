import { readFileSync } from "node:fs";
import {
  buildComposerLayoutContract,
  composerPageUsesLayoutFile,
} from "../shared/composer/layoutAuthoring";
import { parseAstro } from "../shared/composer/parseAstro";
import { deriveComposerComponentPreviewData } from "../shared/composer/componentAuthoring";
import { isNavigableScanPage } from "../shared/pages";
import type {
  LayoutPreviewConsumer,
  LayoutPreviewManifest,
  ScanComponent,
  ScanPage,
} from "../shared/types";
import { canonicalDirectory, resolveWithinRoot } from "./pathSafety";
import { scanProject } from "./workspace";

function isPreviewableConsumer(page: ScanPage): boolean {
  return (
    isNavigableScanPage(page) &&
    !page.route.split("/").some((segment) => segment.includes("[") || segment.includes("]"))
  );
}

function toConsumer(page: ScanPage): LayoutPreviewConsumer {
  return {
    route: page.route,
    file: page.file,
    mtimeMs: page.mtimeMs,
    ...(page.title ? { title: page.title } : {}),
    previewable: isPreviewableConsumer(page),
  };
}

export function chooseLayoutRepresentativeRoute(
  consumers: readonly LayoutPreviewConsumer[],
): string | null {
  const previewable = consumers.filter((consumer) => consumer.previewable);
  if (!previewable.length) return null;
  const home = previewable.find((consumer) => consumer.route === "/");
  if (home) return home.route;
  return [...previewable].sort(
    (a, b) => b.mtimeMs - a.mtimeMs || a.route.localeCompare(b.route),
  )[0]!.route;
}

function uniqueDiagnostics(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

async function parseProjectFile(root: string, relativeFile: string) {
  const absolute = resolveWithinRoot(root, relativeFile, { rejectFinalSymlink: true });
  return parseAstro(readFileSync(absolute, "utf8"), { filename: absolute });
}

export async function buildLayoutPreviewInventory(
  projectPath: string,
  input?: { pages: ScanPage[]; layouts: ScanComponent[] },
): Promise<LayoutPreviewManifest[]> {
  const root = canonicalDirectory(projectPath);
  const scanned = input ?? (await scanProject(root));
  const astroPages = scanned.pages.filter((page) => /\.astro$/i.test(page.file));

  const parsedPages = await Promise.all(
    astroPages.map(async (page) => {
      try {
        const parsed = await parseProjectFile(root, page.file);
        return parsed.editable ? { page, model: parsed.model } : null;
      } catch {
        return null;
      }
    }),
  );

  return Promise.all(
    scanned.layouts.map(async (layout) => {
      const consumers = parsedPages
        .filter(
          (entry) =>
            entry && composerPageUsesLayoutFile(entry.model, entry.page.file, layout.file),
        )
        .map((entry) => toConsumer(entry!.page))
        .sort((a, b) => a.route.localeCompare(b.route));

      try {
        const parsed = await parseProjectFile(root, layout.file);
        if (!parsed.editable) {
          return {
            layout,
            slots: [],
            diagnostics: [parsed.reason],
            consumers,
            representativeRoute: chooseLayoutRepresentativeRoute(consumers),
          };
        }

        const contract = buildComposerLayoutContract(parsed.model);
        const previewData = deriveComposerComponentPreviewData(
          parsed.model.propSchema,
          contract.slots
            .filter((slot) => slot.static)
            .map((slot) => slot.name ?? "default"),
        );
        const diagnostics = [
          ...contract.diagnostics,
          ...previewData.diagnostics.map((diagnostic) => diagnostic.message),
        ];
        if (!contract.defaultSlot) {
          diagnostics.push("No Page content slot found.");
        }

        return {
          layout,
          slots: contract.slots.map((slot) => ({
            id: slot.id,
            name: slot.name,
            label: slot.label,
            hasFallback: slot.hasFallback,
            static: slot.static,
            mutable: slot.mutable,
          })),
          diagnostics: uniqueDiagnostics(diagnostics),
          consumers,
          representativeRoute: chooseLayoutRepresentativeRoute(consumers),
        };
      } catch (error) {
        return {
          layout,
          slots: [],
          diagnostics: [error instanceof Error ? error.message : String(error)],
          consumers,
          representativeRoute: chooseLayoutRepresentativeRoute(consumers),
        };
      }
    }),
  );
}
