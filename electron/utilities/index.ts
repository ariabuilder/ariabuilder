import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  UtilityActionProgress,
  UtilityActionResult,
  UtilityLibraryId,
} from "../../shared/utilities";
import { runProjectPackageMutation } from "../deps";
import {
  defaultEntryRelativePath,
  resolveDesignEntryRelativePath,
} from "../design/discovery";
import { getDesignSnapshot } from "../design";
import {
  canonicalDirectory,
  removePathTracked,
  writeTextFileAtomic,
} from "../pathSafety";
import { getSession, restartSessionRuntime } from "../sessions";
import {
  assertManagedAstroConfigIntact,
  createAstroConfigWithTailwind,
  patchAstroConfig,
  removeManagedAstroConfig,
  type AstroConfigPatch,
} from "./astroConfig";
import {
  findAstroConfig,
  findTailwindStylesheet,
  inspectUtilityManager,
  projectDependencyNames,
  resolveProjectFile,
} from "./inspection";
import {
  readTailwindReceipt,
  removeTailwindReceipt,
  writeTailwindReceipt,
  type TailwindUtilityReceipt,
} from "./receipt";
import { runAstroSync } from "./runner";
import {
  assertManagedSourceImportIntact,
  planGlobalStylesheetImports,
  preserveManagedSourceImport,
  removeManagedSourceImport,
  type SourceImportEdit,
} from "./sourceImports";
import {
  applyTailwindThemeBridge,
  assertManagedTailwindStylesheetIntact,
  collectProjectCssForTailwindCollisions,
  normalizeTailwindStylesheetAfterRemoval,
  removeManagedTailwindStylesheet,
} from "./themeBridge";
import { scanUtilityUsage } from "./usage";

type ProgressReporter = (progress: UtilityActionProgress) => void;

type ActivationPlan = {
  connection: "installed" | "connected";
  packagesToAdd: string[];
  packagesOwned: string[];
  configRelativePath: string;
  configAbsolutePath: string;
  configCreated: boolean;
  configPatch: AstroConfigPatch;
  stylesheetRelativePath: string;
  stylesheetAbsolutePath: string;
  stylesheetCreated: boolean;
  stylesheetBeforeHash: string | null;
  stylesheetContent: string;
  stylesheetImportOwned: boolean;
  sourceEdits: SourceImportEdit[];
};

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function report(
  reporter: ProgressReporter,
  actionId: string,
  projectPath: string,
  action: "activate" | "disable",
  phase: UtilityActionProgress["phase"],
  message: string,
  log?: string,
): void {
  reporter({
    actionId,
    projectPath,
    library: "tailwind",
    action,
    phase,
    message,
    ...(log ? { log } : {}),
  });
}

function requireTailwind(library: UtilityLibraryId): void {
  if (library !== "tailwind") throw new Error("Unsupported utility library.");
}

function blockingMessage(projectPath: string): string | null {
  const library = inspectUtilityManager(projectPath).libraries[0]!;
  const errors = library.diagnostics.filter((item) => item.severity === "error");
  return errors.length ? errors.map((item) => item.message).join(" ") : null;
}

function prepareActivation(projectPath: string): ActivationPlan {
  const root = canonicalDirectory(projectPath);
  const inspection = inspectUtilityManager(root).libraries[0]!;
  const blocked = blockingMessage(root);
  if (blocked) throw new Error(blocked);
  if (readTailwindReceipt(root)) {
    throw new Error("Tailwind is already managed by Aria.");
  }
  const connection = inspection.configured ? "connected" : "installed";
  const dependencies = projectDependencyNames(root);
  const packagesToAdd = connection === "installed"
    ? [
        ...(dependencies.has("tailwindcss") ? [] : ["tailwindcss@^4"]),
        ...(dependencies.has("@tailwindcss/vite") ? [] : ["@tailwindcss/vite@^4"]),
      ]
    : [];
  const packagesOwned = packagesToAdd.map((item) => item.replace(/@\^4$/, ""));

  const existingConfig = findAstroConfig(root);
  const configRelativePath = existingConfig ?? "astro.config.mjs";
  const configAbsolutePath = resolveProjectFile(root, configRelativePath, true);
  const configCreated = !existingConfig;
  const configPatch = configCreated
    ? {
        content: createAstroConfigWithTailwind(),
        changed: true,
        importOwned: true,
        pluginPatch: "created" as const,
      }
    : patchAstroConfig(
        fs.readFileSync(configAbsolutePath, "utf8"),
        configRelativePath,
      );

  const stylesheetRelativePath = connection === "connected"
    ? findTailwindStylesheet(root)
    : resolveDesignEntryRelativePath(root) ?? defaultEntryRelativePath();
  if (!stylesheetRelativePath) {
    throw new Error("Tailwind is configured, but its global stylesheet could not be found.");
  }
  const stylesheetAbsolutePath = resolveProjectFile(root, stylesheetRelativePath, true);
  const stylesheetCreated = !fs.existsSync(stylesheetAbsolutePath);
  const currentStylesheet = stylesheetCreated ? "/* Site styles */\n" : fs.readFileSync(stylesheetAbsolutePath, "utf8");
  const design = getDesignSnapshot(root);
  const stylesheetPatch = applyTailwindThemeBridge(
    currentStylesheet,
    design.colors.palettes,
    design.colors.semantic,
    {
      ensureTailwindImport: connection === "installed",
      collisionContent: collectProjectCssForTailwindCollisions(root),
    },
  );

  const sourcePlan = connection === "installed"
    ? planGlobalStylesheetImports(root, stylesheetRelativePath)
    : { edits: [], blockedFiles: [], targetCount: 1 };
  if (sourcePlan.blockedFiles.length) {
    throw new Error(
      `Aria could not prove global stylesheet coverage for: ${sourcePlan.blockedFiles.slice(0, 8).join(", ")}. Add a static Astro layout to these Markdown pages and try again.`,
    );
  }
  if (connection === "installed" && sourcePlan.targetCount === 0) {
    throw new Error("No Astro page or layout was found to import the global stylesheet.");
  }
  return {
    connection,
    packagesToAdd,
    packagesOwned,
    configRelativePath,
    configAbsolutePath,
    configCreated,
    configPatch,
    stylesheetRelativePath,
    stylesheetAbsolutePath,
    stylesheetCreated,
    stylesheetBeforeHash: stylesheetCreated
      ? null
      : sha256(normalizeTailwindStylesheetAfterRemoval(currentStylesheet)),
    stylesheetContent: stylesheetPatch.content,
    stylesheetImportOwned: stylesheetPatch.importOwned,
    sourceEdits: sourcePlan.edits,
  };
}

async function restartManagedPreview(
  root: string,
  reporter: ProgressReporter,
  actionId: string,
  action: "activate" | "disable",
): Promise<void> {
  const session = getSession(root);
  if (!session?.live || session.previewOwnership !== "aria") return;
  report(reporter, actionId, root, action, "preview", "Restarting the Aria preview.");
  try {
    await restartSessionRuntime(root);
  } catch (error) {
    report(
      reporter,
      actionId,
      root,
      action,
      "preview",
      "Setup is complete, but the preview could not restart.",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function activateUtilityLibrary(
  projectPath: string,
  library: UtilityLibraryId,
  reporter: ProgressReporter = () => undefined,
): Promise<UtilityActionResult> {
  requireTailwind(library);
  const root = canonicalDirectory(projectPath);
  const actionId = randomUUID();
  report(reporter, actionId, root, "activate", "preflight", "Checking the project.");
  const plan = prepareActivation(root);
  const changedFiles = new Set<string>();

  if (plan.packagesToAdd.length) {
    report(reporter, actionId, root, "activate", "packages", "Installing Tailwind 4 in the project.");
    await runProjectPackageMutation(root, "add", plan.packagesToAdd, (log) =>
      report(reporter, actionId, root, "activate", "packages", "Installing project packages.", log),
    );
    changedFiles.add("package.json");
  }

  report(reporter, actionId, root, "activate", "configuration", "Configuring Tailwind and global styles.");
  if (plan.configPatch.changed) {
    writeTextFileAtomic(plan.configAbsolutePath, plan.configPatch.content);
    changedFiles.add(plan.configRelativePath);
  }
  fs.mkdirSync(path.dirname(plan.stylesheetAbsolutePath), { recursive: true });
  writeTextFileAtomic(plan.stylesheetAbsolutePath, plan.stylesheetContent);
  changedFiles.add(plan.stylesheetRelativePath);
  for (const edit of plan.sourceEdits) {
    writeTextFileAtomic(edit.absolutePath, edit.after);
    changedFiles.add(edit.relativePath);
  }

  const receipt: TailwindUtilityReceipt = {
    version: 1,
    library: "tailwind",
    tailwindVersion: 4,
    activatedAt: new Date().toISOString(),
    packageManager: inspectUtilityManager(root).libraries[0]!.packageManager,
    connection: plan.connection,
    packagesOwned: plan.packagesOwned,
    config: {
      relativePath: plan.configRelativePath,
      created: plan.configCreated,
      importOwned: plan.configPatch.importOwned,
      pluginPatch: plan.configPatch.pluginPatch,
      ...(plan.configCreated ? { createdHash: sha256(plan.configPatch.content) } : {}),
    },
    stylesheet: {
      relativePath: plan.stylesheetRelativePath,
      created: plan.stylesheetCreated,
      importOwned: plan.stylesheetImportOwned,
      beforeHash: plan.stylesheetBeforeHash,
    },
    sourceImports: plan.sourceEdits.map((edit) => ({
      relativePath: edit.relativePath,
      createdFrontmatter: edit.createdFrontmatter,
    })),
  };
  writeTailwindReceipt(root, receipt);
  changedFiles.add(".aria/utilities.json");

  report(reporter, actionId, root, "activate", "validation", "Validating the Astro project.");
  await runAstroSync(root, (log) =>
    report(reporter, actionId, root, "activate", "validation", "Running Astro sync.", log),
  );
  const inspection = inspectUtilityManager(root);
  const current = inspection.libraries[0]!;
  if (current.status !== "active" || current.ownership !== "aria") {
    throw new Error("Tailwind setup finished, but Aria could not verify the configuration.");
  }
  await restartManagedPreview(root, reporter, actionId, "activate");
  report(reporter, actionId, root, "activate", "complete", "Tailwind is ready.");
  return { ok: true, actionId, inspection, changedFiles: [...changedFiles].sort() };
}

function commentsOnly(content: string): boolean {
  return content.replace(/\/\*[\s\S]*?\*\//g, "").trim().length === 0;
}

export async function disableUtilityLibrary(
  projectPath: string,
  library: UtilityLibraryId,
  reporter: ProgressReporter = () => undefined,
): Promise<UtilityActionResult> {
  requireTailwind(library);
  const root = canonicalDirectory(projectPath);
  const actionId = randomUUID();
  const receipt = readTailwindReceipt(root);
  if (!receipt) throw new Error("Tailwind is not managed by Aria.");
  report(reporter, actionId, root, "disable", "preflight", "Checking whether managed setup can be removed safely.");

  if (receipt.connection === "installed") {
    const usages = scanUtilityUsage(root);
    if (usages.length) {
      const summary = usages.slice(0, 8).map((item) => `${item.relativePath}: ${item.token}`).join(", ");
      throw new Error(`Tailwind utilities are in use. Remove them before disabling Tailwind. ${summary}`);
    }
  }

  const configAbsolute = resolveProjectFile(root, receipt.config.relativePath);
  const configContent = fs.readFileSync(configAbsolute, "utf8");
  let nextConfig: string | null = configContent;
  if (receipt.config.created) {
    if (!receipt.config.createdHash || sha256(configContent) !== receipt.config.createdHash) {
      throw new Error("The Aria-created Astro config changed. Preserve those edits before disabling Tailwind.");
    }
    nextConfig = null;
  } else if (receipt.config.pluginPatch !== "none" || receipt.config.importOwned) {
    assertManagedAstroConfigIntact(
      configContent,
      receipt.config.pluginPatch,
      receipt.config.importOwned,
    );
    nextConfig = removeManagedAstroConfig(
      configContent,
      receipt.config.pluginPatch,
      receipt.config.importOwned,
    );
  }

  const stylesheetAbsolute = resolveProjectFile(root, receipt.stylesheet.relativePath);
  const stylesheetContent = fs.readFileSync(stylesheetAbsolute, "utf8");
  assertManagedTailwindStylesheetIntact(
    stylesheetContent,
    receipt.stylesheet.importOwned,
  );
  const nextStylesheet = removeManagedTailwindStylesheet(
    stylesheetContent,
    receipt.stylesheet.importOwned,
  );
  const stylesheetChangedSinceActivation = receipt.stylesheet.beforeHash !== null
    ? sha256(nextStylesheet) !== receipt.stylesheet.beforeHash
    : !commentsOnly(nextStylesheet);
  const sourceEdits = receipt.sourceImports.map((sourceImport) => {
    const absolutePath = resolveProjectFile(root, sourceImport.relativePath);
    const before = fs.readFileSync(absolutePath, "utf8");
    assertManagedSourceImportIntact(before);
    return {
      relativePath: sourceImport.relativePath,
      absolutePath,
      after: stylesheetChangedSinceActivation
        ? preserveManagedSourceImport(before)
        : removeManagedSourceImport(before, sourceImport.createdFrontmatter),
    };
  });

  if (receipt.packagesOwned.length) {
    report(reporter, actionId, root, "disable", "packages", "Removing Aria-installed Tailwind packages.");
    await runProjectPackageMutation(root, "remove", receipt.packagesOwned, (log) =>
      report(reporter, actionId, root, "disable", "packages", "Removing project packages.", log),
    );
  }

  report(reporter, actionId, root, "disable", "configuration", "Removing Aria-managed Tailwind setup.");
  if (nextConfig === null) removePathTracked(configAbsolute, { force: true });
  else if (nextConfig !== configContent) writeTextFileAtomic(configAbsolute, nextConfig);
  for (const edit of sourceEdits) writeTextFileAtomic(edit.absolutePath, edit.after);
  if (receipt.stylesheet.created && commentsOnly(nextStylesheet)) {
    removePathTracked(stylesheetAbsolute, { force: true });
  } else {
    writeTextFileAtomic(stylesheetAbsolute, nextStylesheet);
  }
  removeTailwindReceipt(root);

  report(reporter, actionId, root, "disable", "validation", "Validating the Astro project.");
  await runAstroSync(root, (log) =>
    report(reporter, actionId, root, "disable", "validation", "Running Astro sync.", log),
  );
  await restartManagedPreview(root, reporter, actionId, "disable");
  const inspection = inspectUtilityManager(root);
  if (inspection.libraries[0]!.ownership === "aria") {
    throw new Error("Aria could not verify that managed Tailwind setup was removed.");
  }
  report(reporter, actionId, root, "disable", "complete", "Managed Tailwind setup was removed.");
  return {
    ok: true,
    actionId,
    inspection,
    changedFiles: [
      ".aria/utilities.json",
      receipt.config.relativePath,
      receipt.stylesheet.relativePath,
      ...receipt.sourceImports.map((item) => item.relativePath),
      ...(receipt.packagesOwned.length ? ["package.json"] : []),
    ].filter((value, index, all) => all.indexOf(value) === index).sort(),
  };
}

export { inspectUtilityManager } from "./inspection";
export { syncManagedTailwindThemeBridge } from "./themeBridge";
