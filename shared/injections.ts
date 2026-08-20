import type { AnalyticsProviderId, CodeSnippetPlacement } from "./types";

export type InjectionScope = "layout" | "page" | "component";

export type InjectionOrigin = "source" | "aria";

export type InjectionFindingKind = "analytics" | "snippet";

/** Byte span of one HTML tag (or paired noscript) in a source file. */
export type InjectionSpan = {
  file: string;
  start: number;
  end: number;
};

/**
 * A source-backed injection. Settings does not copy the HTML;
 * this pointer is the source of truth until the user edits the file.
 */
export type SourceInjectionFinding = {
  id: string;
  kind: InjectionFindingKind;
  file: string;
  scope: InjectionScope;
  placement: CodeSnippetPlacement;
  enabled: boolean;
  rawHtml: string;
  spans: InjectionSpan[];
  name: string;
  providerId?: AnalyticsProviderId;
  fields?: Record<string, string>;
  /** How each field was found in source, when it was an Astro/JS expression. */
  fieldMeta?: Record<string, import("./analytics/sourceExpressions").SourceFieldOrigin>;
};

export type InjectionScanResult = {
  scannedAt: string;
  analytics: SourceInjectionFinding[];
  snippets: SourceInjectionFinding[];
  /** Layout to insert new site-wide injections, or null when none exist. */
  targetLayout: string | null;
};

export type UpdateSourceInjectionInput =
  | {
      op: "edit";
      id: string;
      code?: string;
      name?: string;
      placement?: CodeSnippetPlacement;
      fields?: Record<string, string>;
    }
  | {
      op: "setEnabled";
      id: string;
      enabled: boolean;
    }
  | {
      op: "delete";
      id: string;
    }
  | {
      op: "addSnippet";
      name: string;
      placement: CodeSnippetPlacement;
      code: string;
    }
  | {
      op: "addAnalytics";
      providerId: AnalyticsProviderId;
      fields: Record<string, string>;
    };

export type UpdateSourceInjectionResult = {
  scan: InjectionScanResult;
  settings?: import("./types").SiteSettings;
  usedMiddleware?: boolean;
};

export const INJECTION_DISABLED_BEGIN = "<!-- aria:injection-disabled-begin -->";
export const INJECTION_DISABLED_END = "<!-- aria:injection-disabled-end -->";
export const SNIPPET_NAME_COMMENT_PREFIX = "aria:snippet-name:";
