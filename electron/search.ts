import { z } from "zod";
import type { GlobalSearchResponse, GlobalSearchResult } from "../shared/search";
import type { ProjectChange } from "../shared/types";
import { isNavigableScanPage } from "../shared/pages";
import { listEntries } from "./cms";
import { readCollections } from "./collections";
import { listMedia } from "./media";
import { canonicalDirectory } from "./pathSafety";
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

type SearchDependencies = {
  scanProject: typeof scanProject;
  readCollections: typeof readCollections;
  listEntries: typeof listEntries;
  listMedia: typeof listMedia;
};

const defaultDependencies: SearchDependencies = {
  scanProject,
  readCollections,
  listEntries,
  listMedia,
};

const INVENTORY_CHANGE_CATEGORIES = new Set<ProjectChange["category"]>([
  "asset",
  "config",
  "content",
  "structure",
]);

export class ProjectSearchService {
  private readonly inventories = new Map<string, Promise<GlobalSearchResult[]>>();

  public constructor(private readonly dependencies: SearchDependencies = defaultDependencies) {}

  private async buildInventory(projectPath: string): Promise<GlobalSearchResult[]> {
    const scan = await this.dependencies.scanProject(projectPath);
    const collections = this.dependencies.readCollections(projectPath).collections;
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
      let page = 1;
      while (true) {
        const entries = this.dependencies.listEntries(projectPath, {
          collectionId: collection.id,
          page,
          limit: 200,
        });
        for (const record of entries.items) {
          const locale = record.locales.find((item) => item.isSource) ?? record.locales[0];
          if (!locale) continue;
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
        if (entries.page * entries.limit >= entries.total) break;
        page += 1;
      }
    }
    for (const asset of this.dependencies.listMedia(projectPath)) {
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

    return results;
  }

  private inventory(projectPath: string): Promise<GlobalSearchResult[]> {
    const root = canonicalDirectory(projectPath);
    const cached = this.inventories.get(root);
    if (cached) return cached;
    const pending = this.buildInventory(root);
    this.inventories.set(root, pending);
    void pending.catch(() => {
      if (this.inventories.get(root) === pending) this.inventories.delete(root);
    });
    return pending;
  }

  public async searchProject(projectPath: string, rawInput: unknown): Promise<GlobalSearchResponse> {
    const input = SearchInputSchema.parse(rawInput ?? {});
    const query = input.query.toLocaleLowerCase();
    const results = await this.inventory(projectPath);

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

  public invalidate(projectPath: string, change?: Pick<ProjectChange, "category">): void {
    if (change?.category && !INVENTORY_CHANGE_CATEGORIES.has(change.category)) return;
    this.inventories.delete(canonicalDirectory(projectPath));
  }

  public dispose(projectPath: string): void {
    this.inventories.delete(canonicalDirectory(projectPath));
  }
}

const projectSearch = new ProjectSearchService();

export function searchProject(projectPath: string, rawInput: unknown): Promise<GlobalSearchResponse> {
  return projectSearch.searchProject(projectPath, rawInput);
}

export function invalidateProjectSearch(projectPath: string, change?: Pick<ProjectChange, "category">): void {
  projectSearch.invalidate(projectPath, change);
}

export function disposeProjectSearch(projectPath: string): void {
  projectSearch.dispose(projectPath);
}
