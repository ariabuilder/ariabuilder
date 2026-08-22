import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  UtilityDiagnostic,
  UtilityLibraryInspection,
  UtilityManagerInspection,
} from "../../shared/utilities";
import { detectComposerFrameworks } from "../composer/frameworks";
import { resolveInstallCommand } from "../deps";
import { getDesignSnapshot } from "../design";
import { canonicalDirectory, resolveWithinRoot } from "../pathSafety";
import {
  analyzeAstroConfig,
  assertManagedAstroConfigIntact,
} from "./astroConfig";
import { readTailwindReceipt, utilityReceiptPath } from "./receipt";
import {
  buildTailwindThemeAliases,
  assertManagedTailwindStylesheetIntact,
  collectProjectCssForTailwindCollisions,
  tailwindStylesheetHasImport,
  TAILWIND_THEME_BEGIN,
} from "./themeBridge";

const CONFIG_CANDIDATES = [
  "astro.config.mjs",
  "astro.config.ts",
  "astro.config.js",
  "astro.config.cjs",
];
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".astro",
  ".aria",
  "dist",
  ".vercel",
  ".wrangler",
]);

type PackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function readManifest(root: string): PackageManifest {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  } catch {
    return {};
  }
}

function dependencyVersion(manifest: PackageManifest, name: string): string | null {
  return manifest.dependencies?.[name] ?? manifest.devDependencies?.[name] ?? null;
}

function installedVersion(root: string, name: string): string | null {
  try {
    const file = path.join(root, "node_modules", ...name.split("/"), "package.json");
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

function firstVersion(value: string | null): { major: number; minor: number } | null {
  const match = value?.match(/(\d+)\.(\d+)/);
  return match ? { major: Number(match[1]), minor: Number(match[2]) } : null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function walkCss(directory: string, out: string[], limit = 400): void {
  if (!fs.existsSync(directory) || out.length >= limit) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (out.length >= limit) return;
    if (entry.name.startsWith(".") || SKIP_DIRECTORIES.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walkCss(absolute, out, limit);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".css")) out.push(absolute);
  }
}

export function findAstroConfig(root: string): string | null {
  return CONFIG_CANDIDATES.find((relative) => fs.existsSync(path.join(root, relative))) ?? null;
}

export function findTailwindStylesheet(root: string): string | null {
  const files: string[] = [];
  walkCss(path.join(root, "src"), files);
  walkCss(path.join(root, "styles"), files);
  for (const absolute of files) {
    try {
      if (tailwindStylesheetHasImport(fs.readFileSync(absolute, "utf8"))) {
        return path.relative(root, absolute).split(path.sep).join("/");
      }
    } catch {
      // Ignore unreadable stylesheets and keep scanning.
    }
  }
  return null;
}

export function inspectUtilityManager(projectPath: string): UtilityManagerInspection {
  const root = canonicalDirectory(projectPath);
  const manifest = readManifest(root);
  const diagnostics: UtilityDiagnostic[] = [];
  const tailwindSpec = dependencyVersion(manifest, "tailwindcss");
  const viteSpec = dependencyVersion(manifest, "@tailwindcss/vite");
  const tailwindVersion = firstVersion(installedVersion(root, "tailwindcss") ?? tailwindSpec);
  const astroVersion = firstVersion(installedVersion(root, "astro") ?? dependencyVersion(manifest, "astro"));
  const configFile = findAstroConfig(root);
  const configContent = configFile
    ? fs.readFileSync(path.join(root, configFile), "utf8")
    : null;
  const configAnalysis = configContent
    ? analyzeAstroConfig(configContent, configFile ?? undefined)
    : { configured: false, safeToPatch: true, localName: null };
  const detectedStylesheet = findTailwindStylesheet(root);
  const receipt = readTailwindReceipt(root);
  const stylesheet = receipt?.stylesheet.relativePath ?? detectedStylesheet;
  const receiptFileExists = fs.existsSync(utilityReceiptPath(root));
  const frameworks = detectComposerFrameworks(root);

  if (tailwindVersion && tailwindVersion.major !== 4) {
    diagnostics.push({
      code: "tailwind_version_unsupported",
      severity: "error",
      message: `Tailwind ${tailwindVersion.major} is detected. Aria currently manages Tailwind 4 projects only.`,
    });
  }
  if (!astroVersion || astroVersion.major < 5 || (astroVersion.major === 5 && astroVersion.minor < 2)) {
    diagnostics.push({
      code: "astro_version_unsupported",
      severity: "error",
      message: "Tailwind one-click setup requires Astro 5.2 or newer.",
    });
  }
  if (frameworks.detected.includes("unocss") && !detectedStylesheet) {
    diagnostics.push({
      code: "unocss_conflict",
      severity: "error",
      message: "UnoCSS is already configured. Remove it before Aria installs Tailwind.",
      files: frameworks.sources,
    });
  }
  if (!configAnalysis.configured && !configAnalysis.safeToPatch) {
    diagnostics.push({
      code: "astro_config_dynamic",
      severity: "error",
      message: configAnalysis.reason ?? "The Astro config cannot be patched safely.",
      ...(configFile ? { files: [configFile] } : {}),
    });
  }
  if (receiptFileExists && !receipt) {
    diagnostics.push({
      code: "receipt_invalid",
      severity: "error",
      message: "The Aria utility ownership file is invalid. Restore or remove .aria/utilities.json before continuing.",
      files: [".aria/utilities.json"],
    });
  }
  if (receipt) {
    try {
      const managedConfig = resolveWithinRoot(root, receipt.config.relativePath, {
        rejectFinalSymlink: true,
      });
      const managedConfigContent = fs.readFileSync(managedConfig, "utf8");
      if (receipt.config.created) {
        if (!receipt.config.createdHash || sha256(managedConfigContent) !== receipt.config.createdHash) {
          throw new Error("The Aria-created Astro config changed.");
        }
      } else {
        assertManagedAstroConfigIntact(
          managedConfigContent,
          receipt.config.pluginPatch,
          receipt.config.importOwned,
        );
      }
      for (const sourceImport of receipt.sourceImports) {
        const absolute = resolveWithinRoot(root, sourceImport.relativePath, {
          rejectFinalSymlink: true,
        });
        if (!fs.readFileSync(absolute, "utf8").includes("aria:utility-manager:tailwind")) {
          throw new Error(`The managed stylesheet import changed in ${sourceImport.relativePath}.`);
        }
      }
    } catch (error) {
      diagnostics.push({
        code: "managed_setup_changed",
        severity: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (tailwindSpec && !viteSpec) {
    diagnostics.push({
      code: "vite_plugin_missing",
      severity: "warning",
      message: "Tailwind is installed, but @tailwindcss/vite is missing.",
    });
  }

  let paletteAliasCount = 0;
  let collisionCount = 0;
  if (stylesheet) {
    try {
      const content = fs.readFileSync(path.join(root, stylesheet), "utf8");
      if (receipt) {
        assertManagedTailwindStylesheetIntact(
          content,
          receipt.stylesheet.importOwned,
        );
      }
      const snapshot = getDesignSnapshot(root);
      const aliases = buildTailwindThemeAliases(
        collectProjectCssForTailwindCollisions(root),
        snapshot.colors.palettes,
        snapshot.colors.semantic,
      );
      paletteAliasCount = aliases.aliasCount;
      collisionCount = aliases.collisions.length;
      if (aliases.collisions.length) {
        diagnostics.push({
          code: "palette_alias_collisions",
          severity: "warning",
          message: `Aria skipped ${aliases.collisions.length} Tailwind color alias${aliases.collisions.length === 1 ? "" : "es"} already defined by the project.`,
          files: [stylesheet],
        });
      }
      if (receipt && !content.includes(TAILWIND_THEME_BEGIN)) {
        diagnostics.push({
          code: "managed_theme_changed",
          severity: "error",
          message: "The Aria-managed Tailwind theme block changed.",
          files: [stylesheet],
        });
      }
    } catch (error) {
      diagnostics.push({
        code: "stylesheet_unreadable",
        severity: "error",
        message: error instanceof Error ? error.message : String(error),
        files: [stylesheet],
      });
    }
  }

  const installed = Boolean(tailwindSpec || viteSpec);
  const configured = Boolean(
    tailwindVersion?.major === 4 &&
    viteSpec &&
    configAnalysis.configured &&
    detectedStylesheet,
  );
  const hasEvidence = installed || configAnalysis.configured || Boolean(stylesheet);
  const blocked = diagnostics.some((item) => item.severity === "error");
  const status = blocked
    ? "blocked"
    : configured
      ? "active"
      : hasEvidence
        ? "partial"
        : "inactive";
  const ownership = receipt ? "aria" : configured ? "project" : "none";
  const library: UtilityLibraryInspection = {
    id: "tailwind",
    name: "Tailwind CSS",
    status,
    ownership,
    management: receipt?.connection ?? null,
    version: tailwindVersion?.major ?? null,
    packageManager: resolveInstallCommand(root).manager,
    installed,
    configured,
    stylesheet,
    configFile,
    paletteAliasCount,
    collisionCount,
    primaryAction: blocked || receipt
      ? null
      : configured
        ? "connect"
        : "activate",
    canDisable: Boolean(receipt && !blocked),
    diagnostics,
  };
  return { libraries: [library] };
}

export function projectDependencyNames(projectPath: string): Set<string> {
  const root = canonicalDirectory(projectPath);
  const manifest = readManifest(root);
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ]);
}

export function resolveProjectFile(
  projectPath: string,
  relativePath: string,
  allowMissing = false,
): string {
  const root = canonicalDirectory(projectPath);
  return resolveWithinRoot(root, path.join(root, ...relativePath.split("/")), {
    allowMissing,
    rejectFinalSymlink: true,
  });
}
