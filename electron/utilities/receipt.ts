import fs from "node:fs";
import path from "node:path";
import {
  canonicalDirectory,
  removePathTracked,
  resolveWithinRoot,
  writeTextFileAtomic,
} from "../pathSafety";
import type { PackageManager } from "../deps";
import type { AstroConfigPatchMode } from "./astroConfig";

export type TailwindUtilityReceipt = {
  version: 1;
  library: "tailwind";
  tailwindVersion: 4;
  activatedAt: string;
  packageManager: PackageManager;
  connection: "installed" | "connected";
  packagesOwned: string[];
  config: {
    relativePath: string;
    created: boolean;
    importOwned: boolean;
    pluginPatch: AstroConfigPatchMode;
    createdHash?: string;
  };
  stylesheet: {
    relativePath: string;
    created: boolean;
    importOwned: boolean;
    beforeHash: string | null;
  };
  sourceImports: Array<{
    relativePath: string;
    createdFrontmatter: boolean;
  }>;
};

const RECEIPT_VERSION = 1;

export function utilityReceiptPath(projectPath: string): string {
  const root = canonicalDirectory(projectPath);
  return resolveWithinRoot(root, path.join(root, ".aria", "utilities.json"), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string =>
    typeof item === "string" && item.trim().length > 0,
  ).map((item) => item.trim().replace(/\\/g, "/")))];
}

function normalizeSourceImports(value: unknown): TailwindUtilityReceipt["sourceImports"] {
  if (!Array.isArray(value)) return [];
  const normalized: TailwindUtilityReceipt["sourceImports"] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      normalized.push({
        relativePath: item.trim().replace(/\\/g, "/"),
        createdFrontmatter: false,
      });
    } else if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      if (typeof record.relativePath !== "string" || !record.relativePath.trim()) continue;
      normalized.push({
        relativePath: record.relativePath.trim().replace(/\\/g, "/"),
        createdFrontmatter: record.createdFrontmatter === true,
      });
    }
  }
  return normalized.filter((item, index, all) =>
    all.findIndex((candidate) => candidate.relativePath === item.relativePath) === index,
  );
}

export function readTailwindReceipt(
  projectPath: string,
): TailwindUtilityReceipt | null {
  const file = utilityReceiptPath(projectPath);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    const config = raw.config as Record<string, unknown> | undefined;
    const stylesheet = raw.stylesheet as Record<string, unknown> | undefined;
    if (
      raw.version !== RECEIPT_VERSION ||
      raw.library !== "tailwind" ||
      raw.tailwindVersion !== 4 ||
      !config ||
      !stylesheet ||
      typeof config.relativePath !== "string" ||
      typeof stylesheet.relativePath !== "string"
    ) {
      return null;
    }
    const manager = raw.packageManager;
    if (!new Set(["npm", "pnpm", "yarn", "bun"]).has(String(manager))) {
      return null;
    }
    const pluginPatch = config.pluginPatch;
    if (!new Set(["none", "array-item", "plugins-block", "vite-block", "created"])
      .has(String(pluginPatch))) {
      return null;
    }
    return {
      version: 1,
      library: "tailwind",
      tailwindVersion: 4,
      activatedAt:
        typeof raw.activatedAt === "string" ? raw.activatedAt : "",
      packageManager: manager as PackageManager,
      connection: raw.connection === "connected" ? "connected" : "installed",
      packagesOwned: normalizeStringList(raw.packagesOwned),
      config: {
        relativePath: config.relativePath.replace(/\\/g, "/"),
        created: config.created === true,
        importOwned: config.importOwned === true,
        pluginPatch: pluginPatch as AstroConfigPatchMode,
        ...(typeof config.createdHash === "string"
          ? { createdHash: config.createdHash }
          : {}),
      },
      stylesheet: {
        relativePath: stylesheet.relativePath.replace(/\\/g, "/"),
        created: stylesheet.created === true,
        importOwned: stylesheet.importOwned === true,
        beforeHash:
          typeof stylesheet.beforeHash === "string"
            ? stylesheet.beforeHash
            : null,
      },
      sourceImports: normalizeSourceImports(raw.sourceImports),
    };
  } catch {
    return null;
  }
}

export function writeTailwindReceipt(
  projectPath: string,
  receipt: TailwindUtilityReceipt,
): void {
  const file = utilityReceiptPath(projectPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeTextFileAtomic(file, `${JSON.stringify(receipt, null, 2)}\n`);
}

export function removeTailwindReceipt(projectPath: string): void {
  const file = utilityReceiptPath(projectPath);
  if (fs.existsSync(file)) removePathTracked(file, { force: true });
}
