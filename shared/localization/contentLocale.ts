import { z } from "zod";
import { LocaleCodeSchema, type LocaleCode } from "../cms/locale";
import type { ProjectLocaleResolver } from "../composer/projectTranslations";

export const ContentDirectionSchema = z.enum(["ltr", "rtl"]);
export type ContentDirection = z.infer<typeof ContentDirectionSchema>;

const PATH_PREFIX_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?$/;

export const ContentLocaleDefinitionSchema = z.object({
  code: LocaleCodeSchema,
  label: z.string().trim().min(1).max(80),
  enabled: z.boolean().default(true),
  direction: ContentDirectionSchema,
  fallbacks: z.array(LocaleCodeSchema).max(12).default([]),
  /** Existing route segment without slashes. Empty means the canonical locale code. */
  pathPrefix: z
    .string()
    .trim()
    .max(64)
    .refine((value) => value === "" || PATH_PREFIX_PATTERN.test(value), {
      message: "Locale path prefix must be a single URL-safe segment",
    })
    .optional(),
});

export type ContentLocaleDefinition = z.infer<
  typeof ContentLocaleDefinitionSchema
>;

const ContentLocalizationBaseSchema = z.object({
  defaultLocale: LocaleCodeSchema,
  locales: z.array(ContentLocaleDefinitionSchema).min(1).max(50),
  resolver: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("path-prefix") }).strict(),
    z.object({
      kind: z.literal("query-param"),
      parameter: z.string().trim().min(1).max(80).regex(/^[A-Za-z][A-Za-z0-9_-]*$/),
    }).strict(),
  ]).default({ kind: "path-prefix" }),
});

type ParsedContentLocalizationSettings = z.infer<typeof ContentLocalizationBaseSchema>;
/** Resolver is optional at source/API boundaries for pre-resolver settings files. */
export type ContentLocalizationSettings = Omit<ParsedContentLocalizationSettings, "resolver"> & {
  resolver?: ProjectLocaleResolver;
};

export type ContentLocaleResolver = ProjectLocaleResolver;

export type ContentLocalizationIssue = {
  path: string;
  message: string;
};

const RTL_LANGUAGES = new Set([
  "ar",
  "ckb",
  "dv",
  "fa",
  "he",
  "ku",
  "ps",
  "sd",
  "ug",
  "ur",
  "yi",
]);

export function inferContentDirection(code: string): ContentDirection {
  return RTL_LANGUAGES.has(code.split("-")[0]?.toLowerCase() ?? "")
    ? "rtl"
    : "ltr";
}

export const DEFAULT_CONTENT_LOCALIZATION: ContentLocalizationSettings = {
  defaultLocale: "en",
  resolver: { kind: "path-prefix" },
  locales: [
    {
      code: "en",
      label: "English",
      enabled: true,
      direction: "ltr",
      fallbacks: [],
    },
  ],
};

/**
 * Produce a plain locale-policy value without structuredClone.
 * This deliberately reads properties from Vue proxies and rebuilds plain
 * arrays/objects so the result is safe at Electron IPC boundaries.
 */
export function cloneContentLocalization(
  value: ContentLocalizationSettings,
): ContentLocalizationSettings {
  return {
    defaultLocale: value.defaultLocale,
    ...(value.resolver
      ? { resolver: value.resolver.kind === "query-param"
          ? { kind: "query-param" as const, parameter: value.resolver.parameter }
          : { kind: "path-prefix" as const } }
      : {}),
    locales: value.locales.map((locale) => ({
      code: locale.code,
      label: locale.label,
      enabled: locale.enabled,
      direction: locale.direction,
      fallbacks: [...locale.fallbacks],
      ...(locale.pathPrefix === undefined
        ? {}
        : { pathPrefix: locale.pathPrefix }),
    })),
  };
}

function cycleFrom(
  start: LocaleCode,
  locales: Map<LocaleCode, ContentLocaleDefinition>,
): LocaleCode[] | null {
  const visiting = new Set<LocaleCode>();
  const visited = new Set<LocaleCode>();
  const stack: LocaleCode[] = [];

  function visit(code: LocaleCode): LocaleCode[] | null {
    if (visiting.has(code)) {
      const index = stack.indexOf(code);
      return [...stack.slice(index), code];
    }
    if (visited.has(code)) return null;
    visiting.add(code);
    stack.push(code);
    for (const fallback of locales.get(code)?.fallbacks ?? []) {
      const cycle = visit(fallback);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(code);
    visited.add(code);
    return null;
  }

  return visit(start);
}

export function validateContentLocalization(
  value: unknown,
): ContentLocalizationIssue[] {
  const parsed = ContentLocalizationBaseSchema.safeParse(value);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
  }

  const issues: ContentLocalizationIssue[] = [];
  const locales = new Map<LocaleCode, ContentLocaleDefinition>();
  const prefixes = new Map<string, LocaleCode>();
  for (const [index, locale] of parsed.data.locales.entries()) {
    if (locales.has(locale.code)) {
      issues.push({
        path: `locales.${index}.code`,
        message: `Locale ${locale.code} is configured more than once`,
      });
    }
    locales.set(locale.code, locale);
    const prefix = (locale.pathPrefix || locale.code).toLowerCase();
    const existing = prefixes.get(prefix);
    if (existing && existing !== locale.code) {
      issues.push({
        path: `locales.${index}.pathPrefix`,
        message: `URL prefix ${prefix} is already used by ${existing}`,
      });
    }
    prefixes.set(prefix, locale.code);
  }

  const source = locales.get(parsed.data.defaultLocale);
  if (!source) {
    issues.push({
      path: "defaultLocale",
      message: "Default locale must exist in the locale list",
    });
  } else if (!source.enabled) {
    issues.push({
      path: "defaultLocale",
      message: "Default locale must remain enabled",
    });
  }

  for (const [index, locale] of parsed.data.locales.entries()) {
    for (const fallback of locale.fallbacks) {
      if (fallback === locale.code) {
        issues.push({
          path: `locales.${index}.fallbacks`,
          message: "A locale cannot fall back to itself",
        });
      } else if (!locales.has(fallback)) {
        issues.push({
          path: `locales.${index}.fallbacks`,
          message: `Fallback locale ${fallback} is not configured`,
        });
      } else if (!locales.get(fallback)?.enabled) {
        issues.push({
          path: `locales.${index}.fallbacks`,
          message: `Fallback locale ${fallback} must be enabled`,
        });
      }
    }
  }

  for (const locale of parsed.data.locales) {
    const cycle = cycleFrom(locale.code, locales);
    if (cycle) {
      issues.push({
        path: "locales",
        message: `Fallback cycle detected: ${cycle.join(" → ")}`,
      });
      break;
    }
  }
  return issues;
}

export function parseContentLocalization(
  value: unknown,
): ContentLocalizationSettings {
  const parsed = ContentLocalizationBaseSchema.safeParse(value);
  if (!parsed.success || validateContentLocalization(parsed.data).length > 0) {
    return cloneContentLocalization(DEFAULT_CONTENT_LOCALIZATION);
  }
  return parsed.data;
}

export function assertContentLocalization(
  value: unknown,
): ContentLocalizationSettings {
  const parsed = ContentLocalizationBaseSchema.parse(value);
  const issues = validateContentLocalization(parsed);
  if (issues.length > 0) {
    throw new Error(issues.map((issue) => issue.message).join("; "));
  }
  return parsed;
}

export function localeUrlPrefix(
  settings: ContentLocalizationSettings,
  code: LocaleCode,
): string {
  const locale = settings.locales.find((item) => item.code === code);
  return locale?.pathPrefix || locale?.code || code;
}

export function fallbackChain(
  settings: ContentLocalizationSettings,
  code: LocaleCode,
): LocaleCode[] {
  const byCode = new Map(settings.locales.map((locale) => [locale.code, locale]));
  const result: LocaleCode[] = [];
  const seen = new Set<LocaleCode>([code]);
  const visit = (current: LocaleCode) => {
    for (const fallback of byCode.get(current)?.fallbacks ?? []) {
      if (seen.has(fallback)) continue;
      seen.add(fallback);
      result.push(fallback);
      visit(fallback);
    }
  };
  visit(code);
  if (!seen.has(settings.defaultLocale)) result.push(settings.defaultLocale);
  return result;
}
