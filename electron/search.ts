import { z } from "zod";
import type { GlobalSearchResponse, GlobalSearchResult } from "../shared/search";
import { isNavigableScanPage } from "../shared/pages";
import { listEntries } from "./cms";
import { readCollections } from "./collections";
import { listMedia } from "./media";
import { scanProject } from "./workspace";

const SearchInputSchema = z.object({
  query: z.string().trim().max(128).default(""),
  limit: z.number().int().min(1).max(100).default(60),
}).strict();

function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      const substitution = previous[column - 1]! + (a[row - 1] === b[column - 1] ? 0 : 1);
      current[column] = Math.min(
        current[column - 1]! + 1,
        previous[column]! + 1,
        substitution,
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length]!;
}

function fuzzyWordScore(label: string, query: string): number {
  if (query.length < 3) return 0;
  const words = label.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  let best = 0;
  for (const word of words) {
    const distance = editDistance(word, query);
    const allowedDistance = Math.max(1, Math.floor(query.length / 3));
    if (distance <= allowedDistance) {
      best = Math.max(best, 45 - distance * 5);
    }
  }
  return best;
}

function scoreResult(result: GlobalSearchResult, query: string): number {
  if (!query) return result.kind === "destination" || result.kind === "command" ? 20 : 10;
  const label = result.label.toLocaleLowerCase();
  const detail = result.detail.toLocaleLowerCase();
  if (label === query) return 100;
  if (label.startsWith(query)) return 80;
  if (label.includes(query)) return 60;
  if (detail.includes(query)) return 35;
  return fuzzyWordScore(label, query);
}

export async function searchProject(
  projectPath: string,
  rawInput: unknown,
): Promise<GlobalSearchResponse> {
  const input = SearchInputSchema.parse(rawInput ?? {});
  const query = input.query.toLocaleLowerCase();
  const scan = await scanProject(projectPath);
  const collections = readCollections(projectPath).collections;
  const results: GlobalSearchResult[] = [];

  for (const page of scan.pages) {
    if (!isNavigableScanPage(page)) continue;
    results.push({
      kind: "page",
      id: `page:${page.file}`,
      label: page.title?.trim() || page.route,
      detail: page.file,
      route: page.route,
      file: page.file,
    });
  }
  for (const component of scan.components) {
    results.push({
      kind: "component",
      id: `component:${component.file}`,
      label: component.name,
      detail: component.file,
      file: component.file,
    });
  }
  for (const layout of scan.layouts) {
    results.push({
      kind: "layout",
      id: `layout:${layout.file}`,
      label: layout.name,
      detail: layout.file,
      file: layout.file,
    });
  }
  for (const collection of collections) {
    results.push({
      kind: "collection",
      id: `collection:${collection.id}`,
      label: collection.label,
      detail: collection.name,
      collectionName: collection.name,
    });
    const entries = listEntries(projectPath, {
      collectionId: collection.id,
      query: input.query || undefined,
      limit: 12,
    });
    for (const record of entries.items) {
      const locale = record.locales.find((item) => item.isSource) ?? record.locales[0]!;
      results.push({
        kind: "entry",
        id: `entry:${collection.id}:${record.entry.id}:${locale.locale}`,
        label: locale.title || locale.slug,
        detail: `${collection.label} · ${locale.slug}`,
        collectionName: collection.name,
        entryId: record.entry.id,
        locale: locale.locale,
      });
    }
  }
  for (const asset of listMedia(projectPath)) {
    results.push({
      kind: "media",
      id: `media:${asset.id}`,
      label: asset.name,
      detail: asset.file,
      assetId: asset.id,
    });
  }

  results.push(
    { kind: "destination", id: "destination:design", label: "Design", detail: "Colors, fonts, variables, and stylesheets", rail: "design" },
    { kind: "destination", id: "destination:settings", label: "Settings", detail: "Site, SEO, discovery, analytics, and Agent settings", rail: "settings" },
    { kind: "destination", id: "destination:history", label: "History", detail: "Review and restore project changes", rail: "settings", settingsTab: "history" },
    { kind: "command", id: "command:undo", label: "Undo Studio change", detail: "Restore the previous successful project mutation", command: "undo" },
    { kind: "command", id: "command:redo", label: "Redo Studio change", detail: "Reapply the last undone project mutation", command: "redo" },
    { kind: "command", id: "command:start-preview", label: "Start preview server", detail: "Run the local Astro development server", command: "start-preview" },
  );

  const ranked = results
    .map((result, index) => ({ result, index, score: scoreResult(result, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return {
    query: input.query,
    results: ranked.slice(0, input.limit).map((item) => item.result),
    truncated: ranked.length > input.limit,
  };
}
