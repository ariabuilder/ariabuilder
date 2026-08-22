export type UtilityLibraryId = "tailwind";

export type UtilityLibraryStatus =
  | "inactive"
  | "partial"
  | "active"
  | "blocked";

export type UtilityLibraryOwnership = "none" | "project" | "aria";

export type UtilityDiagnosticSeverity = "info" | "warning" | "error";

export type UtilityDiagnostic = {
  code: string;
  severity: UtilityDiagnosticSeverity;
  message: string;
  files?: string[];
};

export type UtilityLibraryInspection = {
  id: UtilityLibraryId;
  name: string;
  status: UtilityLibraryStatus;
  ownership: UtilityLibraryOwnership;
  management: "installed" | "connected" | null;
  version: number | null;
  packageManager: "npm" | "pnpm" | "yarn" | "bun";
  installed: boolean;
  configured: boolean;
  stylesheet: string | null;
  configFile: string | null;
  paletteAliasCount: number;
  collisionCount: number;
  primaryAction: "activate" | "connect" | null;
  canDisable: boolean;
  diagnostics: UtilityDiagnostic[];
};

export type UtilityManagerInspection = {
  libraries: UtilityLibraryInspection[];
};

export type UtilityActionProgress = {
  actionId: string;
  projectPath: string;
  library: UtilityLibraryId;
  action: "activate" | "disable";
  phase:
    | "preflight"
    | "packages"
    | "configuration"
    | "validation"
    | "preview"
    | "complete";
  message: string;
  log?: string;
};

export type UtilityActionResult = {
  ok: true;
  actionId: string;
  inspection: UtilityManagerInspection;
  changedFiles: string[];
};
