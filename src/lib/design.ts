import type {
  DesignFontsourceRuntimeStatus,
  DesignIconRuntimeStatus,
  DesignIconResolveResult,
  DesignIconSearchRequest,
  DesignIconSearchResult,
  DesignPatch,
  DesignClassRenameResult,
  DesignSnapshot,
  DesignTokenMutationInput,
  DesignTokenMutationPreview,
  DesignTokenMutationResult,
  DesignTokenSourceSelectionInput,
  StylesheetInfo,
  StylesheetReadResult,
  StylesheetWriteResult,
} from "../../shared/design";

function api() {
  if (!window.aria) {
    throw new Error(
      "Aria desktop bridge is unavailable. Restart the app with npm run dev.",
    );
  }
  if (!window.aria.design) {
    throw new Error(
      "Design API missing from preload. Stop the app and run npm run dev again.",
    );
  }
  return window.aria.design;
}

export function getDesignSnapshot(
  projectPath: string,
): Promise<DesignSnapshot> {
  return api().getSnapshot(projectPath);
}

export function detectIconRuntime(
  projectPath: string,
): Promise<DesignIconRuntimeStatus> {
  return api().detectIconRuntime(projectPath);
}

export function detectFontsourceRuntime(
  projectPath: string,
): Promise<DesignFontsourceRuntimeStatus> {
  return api().detectFontsourceRuntime(projectPath);
}

export function searchProjectIcons(
  projectPath: string,
  request: DesignIconSearchRequest,
): Promise<DesignIconSearchResult> {
  return api().searchIcons(projectPath, request);
}

export function resolveProjectIcons(
  projectPath: string,
  ids: readonly string[],
): Promise<DesignIconResolveResult> {
  return api().resolveIcons(projectPath, [...ids]);
}

export function patchDesignSystem(
  projectPath: string,
  patch: DesignPatch,
  expectedRevision?: string,
): Promise<DesignSnapshot> {
  // Vue reactive proxies are not structured-cloneable across Electron IPC.
  const plain = JSON.parse(JSON.stringify(patch)) as DesignPatch;
  return api().patch(projectPath, plain, expectedRevision);
}

export function previewDesignTokenMutation(
  projectPath: string,
  input: DesignTokenMutationInput,
): Promise<DesignTokenMutationPreview> {
  return api().previewTokenMutation(projectPath, { ...input });
}

export function applyDesignTokenMutation(
  projectPath: string,
  input: DesignTokenMutationInput,
): Promise<DesignTokenMutationResult> {
  return api().applyTokenMutation(projectPath, { ...input });
}

export function selectDesignTokenSource(
  projectPath: string,
  input: DesignTokenSourceSelectionInput,
): Promise<DesignTokenMutationResult> {
  return api().selectTokenSource(projectPath, { ...input });
}

export function ensureDesignEntry(
  projectPath: string,
): Promise<{ relativePath: string; created: boolean }> {
  return api().ensureEntry(projectPath);
}

export function listStylesheets(
  projectPath: string,
): Promise<StylesheetInfo[]> {
  return api().listStylesheets(projectPath);
}

export function scanClassUsage(
  projectPath: string,
  classNames: string[],
): Promise<Record<string, number>> {
  return api().scanClassUsage(projectPath, classNames);
}

export function renameClassAcrossProject(
  projectPath: string,
  from: string,
  to: string,
): Promise<DesignClassRenameResult> {
  return api().renameClass(projectPath, from, to)
}

export function readStylesheet(
  projectPath: string,
  relativePath: string,
): Promise<StylesheetReadResult> {
  return api().readStylesheet(projectPath, relativePath);
}

export function writeStylesheet(
  projectPath: string,
  relativePath: string,
  content: string,
  expectedMtimeMs?: number | null,
): Promise<StylesheetWriteResult> {
  return api().writeStylesheet(
    projectPath,
    relativePath,
    content,
    expectedMtimeMs,
  );
}

export function createStylesheet(
  projectPath: string,
  name: string,
): Promise<StylesheetReadResult> {
  return api().createStylesheet(projectPath, name);
}

export function deleteStylesheet(
  projectPath: string,
  relativePath: string,
): Promise<{ ok: true }> {
  return api().deleteStylesheet(projectPath, relativePath);
}

export function revealStylesheet(
  projectPath: string,
  relativePath: string,
): Promise<{ path: string }> {
  return api().revealStylesheet(projectPath, relativePath);
}

export function uploadDesignFont(
  projectPath: string,
): Promise<{ canceled: true } | { family: string; file: string }> {
  return api().uploadFont(projectPath);
}

export function revealDesignFont(
  projectPath: string,
  relativeFile: string,
): Promise<{ path: string }> {
  return api().revealFont(projectPath, relativeFile);
}

export function deleteDesignFont(
  projectPath: string,
  relativeFile: string,
): Promise<{ ok: true }> {
  return api().deleteFont(projectPath, relativeFile);
}
